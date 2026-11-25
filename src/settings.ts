import { DateTime } from 'luxon';
import type { Pool } from 'pg';
import { SchedulingError } from './scheduling.js';
export type Hours = { opens:number;closes:number;weekdays:number[];notice_minutes:number;horizon_days:number;day_schedule?:Record<string,{opens:number;closes:number;blocked?:Array<[number,number]>}|null> };
export class BusinessSettings {
 constructor(private pool:Pool){}
 async get(business:string){
  const {rows:[hours]}=await this.pool.query('SELECT id,display_name,timezone,opens,closes,weekdays,notice_minutes,horizon_days,business_info,day_schedule FROM businesses WHERE id=$1',[business]);
  if(!hours)throw new SchedulingError('not_found');
  const {rows:services}=await this.pool.query('SELECT * FROM services WHERE business_id=$1 ORDER BY price',[business]);
  return {hours,services};
 }
 async serviceAvailability(business:string,input:{id:string;active:boolean}){
  if(!input||typeof input.id!=='string'||typeof input.active!=='boolean')throw new SchedulingError('invalid_request');
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[business]);
   const result=await client.query('UPDATE services SET active=$3 WHERE business_id=$1 AND id=$2',[business,input.id,input.active]);
   if(!result.rowCount)throw new SchedulingError('not_found');
   await client.query('COMMIT');return {saved:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async hours(business:string,h:Hours){
  if(!h||![h.opens,h.closes,h.notice_minutes,h.horizon_days].every(Number.isInteger)||h.opens<0||h.closes>1439||h.closes<=h.opens||h.notice_minutes<0||h.notice_minutes>10080||h.horizon_days<1||h.horizon_days>365||!Array.isArray(h.weekdays)||!h.weekdays.length||h.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7)||Object.values(h.day_schedule??{}).some((d:any)=>d!==null&&(!Number.isInteger(d.opens)||!Number.isInteger(d.closes)||d.opens<0||d.closes>1439||d.closes<=d.opens||(d.blocked??[]).some((x:any)=>!Array.isArray(x)||x.length!==2||!x.every(Number.isInteger)||x[0]<0||x[1]>1439||x[1]<=x[0]))))throw new SchedulingError('invalid_request');
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   const {rows:[b]}=await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE',[business]);
   if(!b)throw new SchedulingError('not_found');
   const {rows}=await client.query("SELECT starts,occupied_until FROM reservations WHERE business_id=$1 AND active AND kind='appointment' AND occupied_until>now()",[business]);
   if(rows.some(r=>{const s=DateTime.fromJSDate(r.starts,{zone:b.timezone}),e=DateTime.fromJSDate(r.occupied_until,{zone:b.timezone}),day=h.day_schedule?.[String(s.weekday)],opens=day?.opens??h.opens,closes=day?.closes??h.closes,startMinute=s.hour*60+s.minute,endMinute=e.hour*60+e.minute;return day===null||!h.weekdays.includes(s.weekday)||startMinute<opens||endMinute>closes||(day?.blocked??[]).some(([from,to])=>startMinute<to&&endMinute>from)||s.toISODate()!==e.toISODate();}))throw new SchedulingError('existing_appointments_outside_hours');
   await client.query("UPDATE businesses SET opens=$2,closes=$3,weekdays=$4,notice_minutes=$5,horizon_days=$6,day_schedule=$7,business_info=COALESCE(business_info,'{}'::jsonb)||'{\"setup_hours_confirmed\":true}'::jsonb WHERE id=$1",[business,h.opens,h.closes,[...new Set(h.weekdays)],h.notice_minutes,h.horizon_days,JSON.stringify(h.day_schedule??{})]);
   await client.query('COMMIT');return {saved:true};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async service(business:string,s:{id:string;name:string;duration:number;buffer:number;price:number},create=false){
  if(!s||typeof s.id!=='string'||!s.id||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||![s.duration,s.buffer,s.price].every(Number.isInteger)||s.duration<15||s.duration>480||s.buffer<0||s.buffer>120||s.price<0||s.price>100000)throw new SchedulingError('invalid_request');
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');const businessRow=await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[business]);
   if(!businessRow.rowCount)throw new SchedulingError('not_found');
   if(create){
    if(!/^[0-9a-f-]{36}$/i.test(s.id))throw new SchedulingError('invalid_request');
    const prior=(await client.query('SELECT * FROM services WHERE business_id=$1 AND id=$2',[business,s.id])).rows[0];
    if(prior){
     if(prior.name!==s.name.trim()||prior.duration!==s.duration||prior.buffer!==s.buffer||prior.price!==s.price)throw new SchedulingError('idempotency_conflict');
    }else await client.query('INSERT INTO services(id,business_id,name,duration,buffer,price) VALUES($2,$1,$3,$4,$5,$6)',[business,s.id,s.name.trim(),s.duration,s.buffer,s.price]);
    await client.query('COMMIT');return {saved:true};
   }
   const result=await client.query('UPDATE services SET name=$3,duration=$4,buffer=$5,price=$6 WHERE business_id=$1 AND id=$2',[business,s.id,s.name.trim(),s.duration,s.buffer,s.price]);
   if(!result.rowCount)throw new SchedulingError('not_found');
   await client.query('COMMIT');return {saved:true};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
}
