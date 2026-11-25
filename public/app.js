import {renderOwnerSchedule} from './schedule.js';
const app=document.querySelector('#app');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,body){const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
try{
 const catalog=await api('/api/catalog');let selectedDay,refresh;
 const bookingForm=()=>`<form id="book-form"><label>Fictional customer name<input name="name" value="Demo Customer" maxlength="100" required></label><label>Service<select name="service">${catalog.services.filter(s=>s.active).map(s=>`<option value="${escape(s.id)}">${escape(s.name)} · ${s.duration} min</option>`).join('')}</select></label><label>Available start<select name="start" required></select></label><button>Save appointment</button><p role="status"></p></form>`;
 async function wireBooking(){
  const form=document.querySelector('#book-form'),slots=form.elements.start,button=form.querySelector('button'),status=form.querySelector('[role=status]');let key=crypto.randomUUID(),revision=0;
  async function load(){const token=++revision;slots.innerHTML='';button.disabled=true;status.textContent='Checking availability…';try{const values=await api(`/api/slots?service=${encodeURIComponent(form.elements.service.value)}&day=${selectedDay}`);if(token!==revision)return;for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=new Intl.DateTimeFormat('en-US',{timeZone:catalog.hours.timezone,hour:'numeric',minute:'2-digit'}).format(new Date(value));slots.append(option);}button.disabled=!values.length;status.textContent=values.length?'':'No available starts on this day.';}catch(error){if(token===revision)status.textContent=error.message;}}
  form.oninput=()=>{key=crypto.randomUUID();};form.elements.service.onchange=load;
  form.onsubmit=async event=>{event.preventDefault();button.disabled=true;status.textContent='Saving…';try{await api('/api/owner/book',{name:form.elements.name.value,serviceId:form.elements.service.value,start:slots.value,key,confirmed:true});form.closest('dialog').close();await refresh(selectedDay);}catch(error){status.textContent=error.message;button.disabled=false;}};
  await load();
 }
 refresh=await renderOwnerSchedule(app,{api,catalog,login:()=>{},bookingForm,wireBooking,setDay:day=>{selectedDay=day;}});
}catch(error){app.textContent=`Unable to open scheduling workspace: ${error.message}`;}
