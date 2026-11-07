export const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const styles = m => ({ bold: m?.some(x=>x.type==='bold') || false, italic: m?.some(x=>x.type==='italic') || false, underline: m?.some(x=>x.type==='underline') || false });
export function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const prev = out.at(-1);
    if (prev && !!prev.bold===!!r.bold && !!prev.italic===!!r.italic && !!prev.underline===!!r.underline) prev.text+=r.text;
    else out.push({...r});
  }
  return out;
}
export function sliceRuns(runs, start=0, end=Infinity) {
  let offset=0;
  return mergeRuns(runs.map(r=>{ const a=Math.max(start-offset,0), b=Math.min(end-offset,r.text.length); offset+=r.text.length; return {...r,text:r.text.slice(a,Math.max(a,b))}; }));
}
export function documentLines(doc) {
  const lines=[]; let blockPos=0;
  for (const block of doc.content || []) {
    let pos=blockPos+1, runs=[], start=pos;
    const flush=()=>{ const text=runs.map(r=>r.text).join(''); lines.push({index:lines.length,text,runs:mergeRuns(runs),pos:start,end:pos}); runs=[]; start=pos+1; };
    for (const node of block.content || []) {
      if (node.type==='hardBreak') { flush(); pos++; }
      else if (node.type==='text') { runs.push({text:node.text,...styles(node.marks)}); pos+=node.text.length; }
    }
    flush(); blockPos=pos+1;
  }
  return lines;
}

export function matchCharacter(text,names) {
  const trimmed=text.trim(); const explicit=trimmed.startsWith('@'); const body=explicit?trimmed.slice(1):trimmed;
  const dual=/\^\s*$/.test(body); const clean=body.replace(/\s*\^\s*$/,'').trim();
  for(const name of [...names].sort((a,b)=>b.length-a.length)) {
    for(const cue of [name,`(${name})`]) {
      if(!clean.startsWith(cue))continue;
      const extension=clean.slice(cue.length).trim();
      if(!extension||/^(?:\([^()]*\)\s*)+$/.test(extension))return {name,extension,dual,explicit,label:clean};
    }
  }
  if(explicit && /^\([^()]+\)(?:\s*\([^()]*\))*$/.test(clean))return {name:clean.match(/^\([^()]+\)/)[0],extension:clean.replace(/^\([^()]+\)/,'').trim(),dual,explicit,label:clean};
  const match=clean.match(/^([^()]+?)(\s*(?:\([^()]*\)\s*)*)$/);
  if(!match) return null;
  const name=match[1].trim();
  if(!name || (!explicit && !names.includes(name))) return null;
  return {name,extension:match[2].trim(),dual,explicit,label:clean};
}
export function matchScene(text) {
  const t=text.trim();
  // Parse prefixes separately so an unfinished S#23 cannot backtrack into scene 2, title 3.
  let rest=null;
  if(/^S\s*#/i.test(t)) rest=t.match(/^S\s*#\s*\d+(?:\.\s*|\s+)(\S.*)$/i)?.[1]??null;
  else if(/^#(?!#)/.test(t)) rest=t.slice(1).trimStart().replace(/^\d+\.?(?:\s+|$)/,'');
  else if(/^\.(?!\.)/.test(t)) rest=t.slice(1).trimStart();
  else rest=t.match(/^\d+\.\s+(\S.*)$/)?.[1]??null;
  if(rest) { const title=rest.replace(/\s+#[\w.-]+#\s*$/,'').trim(); if(title) {const start=text.indexOf(rest);return {title,start,end:start+title.length};} }
  if(/^(?:INT\.?\/EXT\.?|INT|EXT|EST|INT\/EXT|I\/E)(?:\.|\s)/i.test(t)) {
    const title=t.replace(/\s+#[\w.-]+#\s*$/,'').trim(); return {title,start:text.indexOf(t),end:text.indexOf(t)+title.length};
  }
  return null;
}
export function sceneLabel(n,format='S#n.') {return format.replace('n',String(n));}

export function groupElements(elements) {
  const groups=[];
  for(let i=0;i<elements.length;) {
    const e=elements[i];
    if(e.type==='character') {
      const items=[e];i++;
      while(i<elements.length && ['dialogue','parenthetical'].includes(elements[i].type)) items.push(elements[i++]);
      const prior=groups.at(-1); let before=groups.length-1;
      while(before>=0 && groups[before].kind==='blank') before--;
      const left=groups[before];
      if(e.dual && left?.kind==='speech') {
        groups.splice(before);groups.push({kind:'dual',left:left.items,right:items});
      } else groups.push({kind:'speech',items,unpairedDual:e.dual});
    } else {groups.push({kind:e.type,items:[e]});i++;}
  }
  return groups;
}
