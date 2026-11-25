import {test,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {DateTime} from 'luxon';
import {databaseConfig} from '../scripts/database.mjs';
import {Scheduler,FakeCalendar} from '../src/scheduling.js';
import {OwnerSchedule} from '../src/owner.js';
import {BusinessSettings} from '../src/settings.js';
import {createApplication} from '../src/server.js';
const pool=new pg.Pool(databaseConfig('test')),calendar=new FakeCalendar();
const scheduler=new Scheduler(pool,calendar,()=>DateTime.fromISO('2026-11-25T08:00:00Z')),owner=new OwnerSchedule(pool),settings=new BusinessSettings(pool);
const input={serviceId:'cut',start:'2026-11-26T10:00:00-05:00',name:'Fictional Customer',key:'booking-one',confirmed:true};
beforeEach(async()=>{await pool.query('TRUNCATE outbox,mutation_receipts,reservations');calendar.periods=[];calendar.unavailable=false;await pool.query("UPDATE businesses SET opens=540,closes=1020,weekdays=ARRAY[1,2,3,4,5,6,7],day_schedule='{}'");await pool.query("UPDATE services SET duration=30,buffer=15,price=3500,active=true WHERE id='cut'");});
after(()=>pool.end());
test('twenty concurrent bookings have one winner and one local event',async()=>{
 const results=await Promise.allSettled(Array.from({length:20},(_,i)=>scheduler.book('demo',{...input,key:`race-${i}`})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await pool.query('SELECT 1 FROM reservations')).rowCount,1);assert.equal((await pool.query('SELECT 1 FROM outbox')).rowCount,1);
});
test('retry recovers committed booking during calendar failure; changed payload rejected',async()=>{
 const saved=await scheduler.book('demo',input);calendar.unavailable=true;
 assert.equal((await scheduler.book('demo',input)).id,saved.id);await assert.rejects(scheduler.book('demo',{...input,name:'Other Fixture'}),/idempotency_conflict/);
});
test('duration and buffer block overlap but allow the exact adjacent boundary',async()=>{
 await scheduler.book('demo',input);const slots=await scheduler.slots('demo','cut','2026-11-26');
 assert.equal(slots.includes('2026-11-26T10:30:00.000-05:00'),false);assert.ok(slots.includes('2026-11-26T10:45:00.000-05:00'));
});
test('current baseline intentionally permits only one appointment per shop at a time',async()=>{
 await scheduler.book('demo',input);await assert.rejects(scheduler.book('demo',{...input,key:'second'}),/slot_taken/);
 await scheduler.book('other',input);assert.equal((await pool.query('SELECT 1 FROM reservations')).rowCount,2);
});
test('unavailable calendar and busy fixture do not create records',async()=>{
 calendar.periods=[{start:'2026-11-26T15:00:00Z',end:'2026-11-26T16:00:00Z'}];await assert.rejects(scheduler.book('demo',input),/slot_taken/);
 calendar.unavailable=true;await assert.rejects(scheduler.book('demo',input),/calendar_unavailable/);assert.equal((await pool.query('SELECT 1 FROM reservations')).rowCount,0);
});
test('hours, confirmation and unknown business are enforced',async()=>{
 await assert.rejects(scheduler.book('demo',{...input,start:'2026-11-26T08:00:00-05:00'}),/outside_schedule/);
 await assert.rejects(scheduler.book('demo',{...input,confirmed:false}),/invalid_request/);
 await assert.rejects(scheduler.book('unknown',input),/not_found/);
});
test('manual block prevents booking and retry cannot revive a cancelled block',async()=>{
 const request={start:input.start,end:'2026-11-26T11:00:00-05:00',key:'block'};const block=await owner.block('demo',request);
 await assert.rejects(scheduler.book('demo',input),/slot_taken/);await owner.cancel('demo',block.id);
 assert.equal((await owner.block('demo',request)).active,false);await scheduler.book('demo',input);
});
test('failed move rolls back; successful move retains original price and duration',async()=>{
 const saved=await scheduler.book('demo',input);await owner.block('demo',{start:'2026-11-26T11:00:00-05:00',end:'2026-11-26T12:00:00-05:00',key:'block'});
 await assert.rejects(scheduler.move('demo',{id:saved.id,start:'2026-11-26T11:00:00-05:00',key:'bad-move'}),/slot_taken/);
 assert.equal((await pool.query('SELECT starts FROM reservations WHERE id=$1',[saved.id])).rows[0].starts.toISOString(),saved.starts.toISOString());
 await settings.service('demo',{id:'cut',name:'Changed service',price:5000,duration:60,buffer:0});
 const request={id:saved.id,start:'2026-11-26T13:00:00-05:00',key:'move'};const moved=await scheduler.move('demo',request);
 assert.equal(moved.price,3500);assert.equal(moved.ends-moved.starts,1800000);calendar.unavailable=true;assert.equal((await scheduler.move('demo',request)).id,saved.id);
});
test('cancel is retry-safe and isolated to the business',async()=>{
 const saved=await scheduler.book('demo',input);await assert.rejects(owner.cancel('other',saved.id),/not_found/);
 await owner.cancel('demo',saved.id);await owner.cancel('demo',saved.id);assert.equal((await owner.list('demo','2026-11-26')).length,0);assert.equal((await pool.query("SELECT 1 FROM outbox WHERE kind='booking_cancelled'")).rowCount,1);
});
test('service retirement rejects new bookings while saved result is recoverable',async()=>{
 const saved=await scheduler.book('demo',input);await settings.serviceAvailability('demo',{id:'cut',active:false});
 assert.equal((await scheduler.book('demo',input)).id,saved.id);await assert.rejects(scheduler.book('demo',{...input,key:'new',start:'2026-11-26T13:00:00-05:00'}),/service_unavailable/);
});
test('closed day and breaks remove corresponding availability',async()=>{
 await pool.query(`UPDATE businesses SET day_schedule='{"4":{"opens":540,"closes":1020,"blocked":[[600,660]]}}' WHERE id='demo'`);
 await assert.rejects(scheduler.book('demo',input),/outside_schedule/);await pool.query(`UPDATE businesses SET day_schedule='{"4":null}' WHERE id='demo'`);
 assert.deepEqual(await scheduler.slots('demo','cut','2026-11-26'),[]);
});
test('range results preserve business-local boundaries and tenant isolation',async()=>{
 await scheduler.book('demo',input);await scheduler.book('other',input);
 assert.equal((await owner.listRange('demo','2026-11-26','2026-11-27')).length,1);
 await assert.rejects(owner.listRange('demo','2026-11-27','2026-11-26'),/invalid_date_range/);
});
test('HTTP app supports booking and reconnect persistence; rejects cross-origin writes',async()=>{
 const instance=await createApplication(databaseConfig('test'));await new Promise<void>(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${instance.server.address().port}`;
 try{
  assert.equal((await fetch(base+'/')).status,200);const catalog=await(await fetch(base+'/api/catalog')).json();assert.equal(catalog.hours.display_name,'Juniper Demo Barbers');
  const day=DateTime.now().setZone('America/New_York').plus({days:2}).toISODate();const starts=await(await fetch(base+`/api/slots?service=cut&day=${day}`)).json();assert.ok(starts.length);
  const options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,start:starts[0]})};
  assert.equal((await fetch(base+'/api/owner/book',{...options,headers:{...options.headers,origin:'https://example.invalid'}})).status,403);
  assert.equal((await fetch(base+'/api/owner/book',options)).status,200);
  const reconnected=new pg.Client(databaseConfig('test'));await reconnected.connect();try{assert.equal((await reconnected.query('SELECT 1 FROM reservations')).rowCount,1);}finally{await reconnected.end();}
  assert.equal((await(await fetch(base+`/api/owner/day?day=${day}`)).json()).length,1);
 }finally{await instance.close();}
});
