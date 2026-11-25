// Compatibility with pilot servers that expose only the authenticated day API.
export async function loadScheduleRange(api, from, to) {
  const parse = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value+'T12:00:00Z') : new Date(NaN);
  const start=parse(from),end=parse(to),count=Math.round((end-start)/86400000)+1;
  if(!Number.isFinite(count)||count<1||count>42||start.toISOString().slice(0,10)!==from||end.toISOString().slice(0,10)!==to)throw new Error('invalid_date_range');
  try{return await api(`/api/owner/range?from=${from}&to=${to}`);}catch(error){if(error.message!=='not_found')throw error;}
  const results=new Map();let cursor=0,failed;
  async function worker(){while(cursor<count&&!failed){const offset=cursor++;const date=new Date(start.getTime()+offset*86400000).toISOString().slice(0,10);try{const rows=await api(`/api/owner/day?day=${date}`);for(const row of rows)results.set(row.id,row);}catch(error){failed=error;}}}
  await Promise.all(Array.from({length:Math.min(4,count)},worker));
  if(failed)throw failed;
  return [...results.values()].sort((a,b)=>new Date(a.starts)-new Date(b.starts));
}
