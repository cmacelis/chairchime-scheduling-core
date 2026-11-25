import { DateTime } from 'luxon';
import { randomUUID, createHash } from 'node:crypto';
import type { Pool } from 'pg';

export type Busy = { start: string; end: string };
export interface CalendarProvider { busy(business: string, start: string, end: string): Promise<Busy[]> }
export class FakeCalendar implements CalendarProvider {
  unavailable = false;
  periods: Busy[] = [];
  async busy(): Promise<Busy[]> { if (this.unavailable) throw new Error('calendar_unavailable'); return this.periods; }
}
export class SchedulingError extends Error {}
const fail = (code: string): never => { throw new SchedulingError(code); };
export function normalizePhone(value:string) {
  if(typeof value!=='string'||value.length>40)return fail('invalid_phone');
  const digits=value.replace(/[\s().+-]/g,'');
  if(/^\d{10}$/.test(digits))return `+1${digits}`;
  if(/^1\d{10}$/.test(digits))return `+${digits}`;
  return fail('invalid_phone');
}
export function normalizeEmail(value:unknown):string|null {
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||value.length>254)return fail('invalid_email');
  const email=value.trim().toLowerCase();
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))return fail('invalid_email');
  return email;
}
const overlaps = (start: number, end: number, periods: Busy[]) => periods.some(p => start < Date.parse(p.end) && end > Date.parse(p.start));
export class Scheduler {
  constructor(private pool: Pool, private calendar: CalendarProvider, private now: () => DateTime = () => DateTime.utc()) {}
  async slots(business: string, serviceId: string, day: string) {
    const { rows: [b] } = await this.pool.query('SELECT * FROM businesses WHERE id=$1', [business]);
    const { rows: [s] } = await this.pool.query('SELECT * FROM services WHERE business_id=$1 AND id=$2 AND active', [business, serviceId]);
    if (!b) return fail('not_found');
    if (!s) return fail('service_unavailable');
    const date = DateTime.fromISO(day, { zone: b.timezone });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !date.isValid) return fail('invalid_date');
    const start = date.startOf('day'), end = start.plus({ days: 1 });
    const external = await this.calendar.busy(business, start.toISO()!, end.toISO()!);
    const { rows } = await this.pool.query('SELECT starts,occupied_until FROM reservations WHERE business_id=$1 AND active AND starts < $3 AND occupied_until > $2', [business, start.toISO(), end.toISO()]);
    const periods = [...external, ...rows.map(r => ({ start: r.starts.toISOString(), end: r.occupied_until.toISOString() }))];
    const slots: string[] = [];
    // Walk real instants: missing DST times never appear, repeated times retain their offsets.
    for (let t = start; t < end; t = t.plus({ minutes: 15 })) {
      const occupiedEnd = t.plus({ minutes: s.duration + s.buffer });
      if (this.validTime(b, t, occupiedEnd) && !overlaps(t.toMillis(), occupiedEnd.toMillis(), periods)) slots.push(t.toISO()!);
    }
    return slots;
  }
  private validTime(b: any, start: DateTime, end: DateTime) {
    const local = start.setZone(b.timezone), localEnd = end.setZone(b.timezone);
    const day=(b.day_schedule??{})[String(local.weekday)] as {opens:number;closes:number;blocked?:Array<[number,number]>}|undefined;
    const opens=day?.opens??b.opens, closes=day?.closes??b.closes;
    if(day===null||day?.opens===null)return false;
    const startMin=local.hour*60+local.minute, endMin=localEnd.hour*60+localEnd.minute;
    const blocked=(day?.blocked??[]).some(([from,to])=>startMin<to&&endMin>from);
    return !blocked && b.weekdays.includes(local.weekday) && local.minute % 15 === 0 && local.second === 0 && local.millisecond === 0 &&
      startMin >= opens && localEnd.toISODate() === local.toISODate() &&
      localEnd.hour * 60 + localEnd.minute <= closes &&
      start >= this.now().plus({ minutes: b.notice_minutes }) && start <= this.now().plus({ days: b.horizon_days });
  }
  async move(business:string,input:{id:string;start:string;key:string}) {
    if(!/^[0-9a-f-]{36}$/i.test(input.id)||!input.key||input.key.length>200||!/(Z|[+-]\d{2}:\d{2})$/.test(input.start)) return fail('invalid_request');
    const fingerprint=createHash('sha256').update(JSON.stringify(['move',input.id,input.start])).digest('hex');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows:[b]}=await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE',[business]);
      if(!b)return fail('not_found');
      const {rows:[receipt]}=await client.query('SELECT * FROM mutation_receipts WHERE business_id=$1 AND request_key=$2',[business,input.key]);
      if(receipt){if(receipt.fingerprint!==fingerprint)return fail('idempotency_conflict');await client.query('COMMIT');return receipt.result;}
      const {rows:[prior]}=await client.query("SELECT * FROM reservations WHERE business_id=$1 AND id=$2 AND active AND kind='appointment'",[business,input.id]);
      if(!prior)return fail('not_found');
      const start=DateTime.fromISO(input.start),end=start.plus({milliseconds:prior.ends-prior.starts}),occupied=end.plus({milliseconds:prior.occupied_until-prior.ends});
      if(!start.isValid||!this.validTime(b,start,occupied))return fail('outside_schedule');
      const busy=await this.calendar.busy(business,start.toISO()!,occupied.toISO()!);
      if(overlaps(start.toMillis(),occupied.toMillis(),busy))return fail('slot_taken');
      const {rows:[moved]}=await client.query('UPDATE reservations SET starts=$3,ends=$4,occupied_until=$5 WHERE business_id=$1 AND id=$2 RETURNING *',[business,input.id,start.toISO(),end.toISO(),occupied.toISO()]);
      await client.query('INSERT INTO mutation_receipts VALUES($1,$2,$3,$4)',[business,input.key,fingerprint,JSON.stringify(moved)]);
      await client.query("INSERT INTO outbox(reservation_id,kind) VALUES($1,$2)",[input.id,`booking_moved:${input.key}`]);
      await client.query('COMMIT');return moved;
    }catch(error:any){await client.query('ROLLBACK');if(error.code==='23P01')return fail('slot_taken');throw error;}finally{client.release();}
  }
  async book(business: string, input: { serviceId: string; start: string; name: string; key: string; confirmed: boolean; email?:string; expectedPriceCents?:number; expectedDurationMinutes?:number }) {
    if (!input.confirmed || !input.name?.trim() || input.name.length > 100 || !input.key || input.key.length > 200 || !/(Z|[+-]\d{2}:\d{2})$/.test(input.start)) return fail('invalid_request');
    if(input.expectedPriceCents!==undefined&&(!Number.isInteger(input.expectedPriceCents)||input.expectedPriceCents<0))return fail('invalid_request');
    if(input.expectedDurationMinutes!==undefined&&(!Number.isInteger(input.expectedDurationMinutes)||input.expectedDurationMinutes<=0))return fail('invalid_request');
    const email=normalizeEmail(input.email);
    const fingerprint = createHash('sha256').update(JSON.stringify([input.serviceId,input.start,input.name.trim(),email,...(input.expectedPriceCents!==undefined||input.expectedDurationMinutes!==undefined?[input.expectedPriceCents,input.expectedDurationMinutes]:[])])).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [b] } = await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [business]);
      if (!b) return fail('not_found');
      const { rows: [prior] } = await client.query('SELECT * FROM reservations WHERE business_id=$1 AND request_key=$2', [business,input.key]);
      if (prior) {
        if (prior.request_fingerprint !== fingerprint) return fail('idempotency_conflict');
        await client.query('COMMIT'); return prior;
      }
      const { rows: [service] } = await client.query('SELECT * FROM services WHERE business_id=$1 AND id=$2 AND active', [business,input.serviceId]);
      if (!service) return fail('service_unavailable');
      if((input.expectedPriceCents!==undefined&&input.expectedPriceCents!==service.price)||(input.expectedDurationMinutes!==undefined&&input.expectedDurationMinutes!==service.duration))return fail('service_changed');
      const start = DateTime.fromISO(input.start), end = start.plus({ minutes: service.duration }), occupiedEnd = end.plus({ minutes: service.buffer });
      if (!start.isValid || !this.validTime(b,start,occupiedEnd)) return fail('outside_schedule');
      const periods = await this.calendar.busy(business,start.toISO()!,occupiedEnd.toISO()!);
      if (overlaps(start.toMillis(),occupiedEnd.toMillis(),periods)) return fail('slot_taken');
      const { rows: [booking] } = await client.query(`INSERT INTO reservations(id,business_id,kind,starts,ends,occupied_until,customer_name,service_id,price,request_key,request_fingerprint,customer_email) VALUES($1,$2,'appointment',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [randomUUID(),business,start.toISO(),end.toISO(),occupiedEnd.toISO(),input.name.trim(),service.id,service.price,input.key,fingerprint,email]);
      await client.query("INSERT INTO outbox(reservation_id,kind) VALUES($1,'booking_recorded')",[booking.id]);
      await client.query('COMMIT'); return booking;
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error.code === '23P01') return fail('slot_taken');
      throw error;
    } finally { client.release(); }
  }
}
