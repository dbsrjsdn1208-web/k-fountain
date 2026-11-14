// A source-backed projection: syntax visibility never changes the manuscript.
export const noteRanges=source=>[...source.matchAll(/\/\*[\s\S]*?\*\/|\[\[[\s\S]*?\]\]/g)].map(m=>[m.index,m.index+m[0].length]);
const touches=(selection,a,b)=>selection&&Math.min(selection.anchor,selection.focus)<=b&&Math.max(selection.anchor,selection.focus)>=a;
const lineAt=(source,p)=>p===0?0:source.lastIndexOf('\n',p-1)+1;
const lineEnd=(source,p)=>{const n=source.indexOf('\n',p);return n<0?source.length:n;};

export function captureBlock(doc,el,rec){
  const units=new Map(),walker=doc.createTreeWalker(el,4);let node,offset=0,generated='';
  while(node=walker.nextNode()){
    const styles=[];let parent=node.parentElement;
    while(parent&&parent!==el){for(const c of ['bold','italic','underline'])if(parent.classList.contains(c)&&!styles.includes(c))styles.push(c);parent=parent.parentElement;}
    for(let i=0;i<node.length;i++){
      const span=rec.map[offset++];if(!span)continue;
      if(span[0]===span[1]){generated+=node.data[i];continue;}
      const old=units.get(span[0]);if(old&&old.end===span[1])old.text+=node.data[i];else units.set(span[0],{end:span[1],text:node.data[i],styles:styles.sort().join(' ')});
    }
  }
  return {el,rec,units,generated,signature:null};
}

export function projectBlock(block,source,selection,notes,{live=true,showNotes=false,pendingLine=null}={}){
  const {rec,units}=block,pairs=rec.formatPairs||[],runs=[];
  const add=(text,start,end,classes='')=>{const last=runs.at(-1);if(last&&last.classes===classes){last.text+=text;last.map.push(...Array.from({length:text.length},(_,i)=>end-start===text.length?[start+i,start+i+1]:[start,end]));}else runs.push({text,classes,map:Array.from({length:text.length},(_,i)=>end-start===text.length?[start+i,start+i+1]:[start,end])});};
  if(block.generated)add(block.generated,rec.sourceStart,rec.sourceStart,'preview-number');
  const selectedPairs=pairs.filter(p=>touches(selection,p.open[0],p.close[1]));
  for(let i=rec.rawStart;i<rec.rawEnd;){
    const note=notes.find(([a,b])=>i>=a&&i<b);
    if(note){const end=Math.min(note[1],rec.rawEnd);if(source.startsWith('[[',note[0])?showNotes:live&&touches(selection,...note))add(source.slice(i,end),i,end,'preview-note');i=end;continue;}
    const unit=units.get(i);
    if(unit){
      if(unit.end-i>unit.text.length&&live&&touches(selection,i,unit.end)){
        const raw=source.slice(i,unit.end),extra=raw.length-unit.text.length;add(raw.slice(0,extra),i,i+extra,('preview-syntax '+unit.styles).trim());add(unit.text,i+extra,unit.end,unit.styles);
      }else add(unit.text,i,unit.end,unit.styles);
      i=unit.end;continue;
    }
    const pair=pairs.find(p=>i>=p.open[0]&&i<p.open[1]||i>=p.close[0]&&i<p.close[1]);
    let show=false,styles='';
    if(pair){show=live&&selectedPairs.includes(pair);styles=units.get(pair.open[1])?.styles||'';}
    else show=live?touches(selection,lineAt(source,i),lineEnd(source,i)):pendingLine!==null&&lineAt(source,i)===pendingLine;
    if(show)add(source[i],i,i+1,('preview-syntax '+styles).trim());
    else if(source[i]==='\n')add('\n',i,i+1);
    i++;
  }
  if(!runs.some(r=>r.classes!=='preview-number'))add('\u200b',rec.rawStart,rec.rawStart);
  return runs;
}

export function paintBlock(doc,block,runs){
  const signature=JSON.stringify(runs.map(({text,classes})=>[text,classes]));block.runs=runs;
  if(block.signature===signature)return false;
  const fragment=doc.createDocumentFragment();
  for(const run of runs){const span=doc.createElement('span');if(run.classes)span.className=run.classes;if(run.classes==='preview-number')span.contentEditable='false';span.textContent=run.text;fragment.append(span);}
  block.el.replaceChildren(fragment);block.signature=signature;return true;
}
