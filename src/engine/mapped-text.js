// UTF-16 source ranges survive every deletion/formatting step. No text search.
export function mapped(text, map=null){return {text,map:map||Array.from({length:text.length},(_,i)=>[i,i+1])};}
export function literal(text,span=null){return {text,map:Array.from({length:text.length},()=>span)};}
export function slice(value,start=0,end=value.text.length){return {text:value.text.slice(start,end),map:value.map.slice(start,end)};}
export function join(parts){return {text:parts.map(p=>p.text).join(''),map:parts.flatMap(p=>p.map)};}
export function replace(value,re,callback){
  const flags=[...new Set(re.flags+'gd')].join(''),rx=new RegExp(re.source,flags),parts=[];let at=0;
  for(const m of value.text.matchAll(rx)){
    parts.push(slice(value,at,m.index));
    const capture=n=>m.indices[n]?slice(value,...m.indices[n]):literal('');
    parts.push(callback(m,capture));at=m.index+m[0].length;if(!re.global)break;
  }parts.push(slice(value,at));return join(parts);
}
export const remove=(value,re)=>replace(value,re,()=>literal(''));
export const trim=value=>remove(value,/^\s+|\s+$/g);
export function escape(value){return replace(value,/[&<>"']/g,(m,c)=>literal({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m[0]],c(0).map[0]));}
export function visible(value){
  const withoutTags=replace(value,/<!--[\s\S]*?-->|<[^>]*>/g,()=>literal(''));
  return replace(withoutTags,/&(?:amp|lt|gt|quot|#39);/g,(m,c)=>literal({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[m[0]],c(0).map[0]));
}
