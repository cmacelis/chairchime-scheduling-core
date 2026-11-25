import { createHash, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Pool } from 'pg';
import { SchedulingError } from './scheduling.js';

// Authentication belongs at the API boundary. Every operation still scopes all
// reads and writes to the authenticated business and shares the booking lock.
export class OwnerSchedule {
  constructor(private pool: Pool) {}
  async list(business: string, day: string) {
    return this.listRange(business,day,day);
  }
  // Dates are inclusive business-local dates; SQL uses an exclusive next-day
  // boundary so DST changes and appointments spanning midnight remain correct.
  async listRange(business: string, from: string, to: string) {
    if (![from,to].every(day=>/^\d{4}-\d{2}-\d{2}$/.test(day))) throw new SchedulingError('invalid_date');
    const { rows: [b] } = await this.pool.query('SELECT timezone FROM businesses WHERE id=$1',[business]);
    if (!b) throw new SchedulingError('not_found');
    const start = DateTime.fromISO(from,{zone:b.timezone}).startOf('day');
    const last = DateTime.fromISO(to,{zone:b.timezone}).startOf('day');
    if (!start.isValid || !last.isValid || start.toISODate()!==from || last.toISODate()!==to) throw new SchedulingError('invalid_date');
    if (last<start || last.diff(start,'days').days>41) throw new SchedulingError('invalid_date_range');
    const { rows } = await this.pool.query('SELECT r.*,s.name AS service_name FROM reservations r LEFT JOIN services s ON s.business_id=r.business_id AND s.id=r.service_id WHERE r.business_id=$1 AND r.active AND r.starts < $3 AND r.occupied_until > $2 ORDER BY r.starts',[business,start.toISO(),last.plus({days:1}).toISO()]);
    return rows;
  }
  async block(business: string, input: {start:string;end:string;key:string}) {
    const start=DateTime.fromISO(input.start), end=DateTime.fromISO(input.end);
    if (![input.start,input.end].every(s=>/(Z|[+-]\d{2}:\d{2})$/.test(s)) || !start.isValid || !end.isValid || end<=start || end.diff(start,'days').days>31 || !input.key || input.key.length>200) throw new SchedulingError('invalid_request');
    const fingerprint=createHash('sha256').update(JSON.stringify(['block',start.toUTC().toISO(),end.toUTC().toISO()])).digest('hex');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lock=await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[business]);
      if (!lock.rowCount) throw new SchedulingError('not_found');
      const {rows:[prior]}=await client.query('SELECT * FROM reservations WHERE business_id=$1 AND request_key=$2',[business,input.key]);
      if(prior) {
        if(prior.request_fingerprint!==fingerprint) throw new SchedulingError('idempotency_conflict');
        await client.query('COMMIT'); return prior;
      }
      const {rows:[block]}=await client.query("INSERT INTO reservations(id,business_id,kind,starts,ends,occupied_until,request_key,request_fingerprint) VALUES($1,$2,'block',$3,$4,$4,$5,$6) RETURNING *",[randomUUID(),business,start.toISO(),end.toISO(),input.key,fingerprint]);
      await client.query('COMMIT'); return block;
    } catch(error:any) {
      await client.query('ROLLBACK');
      if(error.code==='23P01') throw new SchedulingError('slot_taken');
      throw error;
    } finally {client.release();}
  }
  async cancel(business:string,id:string) {
    if(!/^[0-9a-f-]{36}$/i.test(id)) throw new SchedulingError('invalid_request');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[business]);
      const {rows:[reservation]}=await client.query('UPDATE reservations SET active=false WHERE business_id=$1 AND id=$2 RETURNING *',[business,id]);
      if(!reservation) throw new SchedulingError('not_found');
      await client.query("INSERT INTO outbox(reservation_id,kind) VALUES($1,'booking_cancelled') ON CONFLICT DO NOTHING",[id]);
      await client.query('COMMIT');return reservation;
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
}
