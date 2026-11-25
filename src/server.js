import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {DateTime} from 'luxon';
import {setupDatabase,root} from '../scripts/database.mjs';
import {Scheduler,FakeCalendar,SchedulingError} from './scheduling.js';
import {OwnerSchedule} from './owner.js';
import {BusinessSettings} from './settings.js';

export async function createApplication(config){
 const pool=new pg.Pool(config),scheduler=new Scheduler(pool,new FakeCalendar()),owner=new OwnerSchedule(pool),settings=new BusinessSettings(pool);
 const files={'/':'index.html','/app.js':'app.js','/base.css':'base.css','/schedule.js':'schedule.js','/schedule-data.js':'schedule-data.js','/schedule.css':'schedule.css'};
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  try{
   const address=server.address(),origin=`http://127.0.0.1:${address.port}`;
   if(req.headers.host!==`127.0.0.1:${address.port}`)return send(403,{error:'invalid_host'});
   if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'invalid_origin'});
   const url=new URL(req.url,origin),business='demo';
   if(req.method==='GET'&&files[url.pathname]){
    const file=files[url.pathname];res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    return res.end(await readFile(join(root,'public',file)));
   }
   if(req.method==='GET'){
    if(url.pathname==='/api/catalog')return send(200,await settings.get(business));
    if(url.pathname==='/api/owner/day')return send(200,await owner.list(business,url.searchParams.get('day')??''));
    if(url.pathname==='/api/owner/range')return send(200,await owner.listRange(business,url.searchParams.get('from')??'',url.searchParams.get('to')??''));
    if(url.pathname==='/api/slots')return send(200,await scheduler.slots(business,url.searchParams.get('service')??'',url.searchParams.get('day')??''));
    return send(404,{error:'not_found'});
   }
   if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
   if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(413,{error:'body_too_large'});}
   let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'invalid_json'});}
   if(!body||typeof body!=='object'||Array.isArray(body))return send(400,{error:'invalid_request'});
   const localTime=(day,time)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}$/.test(time))throw new SchedulingError('invalid_request');
    const dt=DateTime.fromISO(`${day}T${time}`,{zone:'America/New_York'});
    if(!dt.isValid||dt.toFormat('yyyy-MM-dd')!==day||dt.toFormat('HH:mm')!==time)throw new SchedulingError('invalid_request');
    return dt.toISO();
   };
   if(url.pathname==='/api/owner/book')return send(200,await scheduler.book(business,body));
   if(url.pathname==='/api/owner/move')return send(200,await scheduler.move(business,{id:body.id,start:localTime(body.day,body.time),key:body.key}));
   if(url.pathname==='/api/owner/block')return send(200,await owner.block(business,{start:localTime(body.day,body.startTime),end:localTime(body.day,body.endTime),key:body.key}));
   if(url.pathname==='/api/owner/cancel')return send(200,await owner.cancel(business,body.id));
   return send(404,{error:'not_found'});
  }catch(error){send(error instanceof SchedulingError?409:500,{error:error instanceof SchedulingError?error.message:'internal_error'});}
 });
 return {server,pool,async close(){if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await pool.end();}};
}
if(process.env.CHAIR_EXTRACT_TEST!=='1'){
 const app=await createApplication(await setupDatabase());
 const port=Number(process.env.CHAIR_EXTRACT_PORT??4327);
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('invalid_port');
 app.server.listen(port,'127.0.0.1',()=>console.log(`Fictional scheduling demo: http://127.0.0.1:${port}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
