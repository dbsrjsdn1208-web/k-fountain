const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const contains=(r,x,y)=>r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;

// Return a visible text boundary only when a real glyph/space was hit. Native
// caret APIs alone snap clicks in paragraph margins to unrelated text.
export function hitText(element,x,y){
  const doc=element.ownerDocument,nodes=[],walker=doc.createTreeWalker(element,4);let node,total=0;
  while((node=walker.nextNode())){nodes.push({node,offset:total});total+=node.length;}
  const caret=doc.caretPositionFromPoint?.(x,y),range=caret?null:doc.caretRangeFromPoint?.(x,y);
  const preferred=caret?.offsetNode||range?.startContainer,at=caret?.offset??range?.startOffset;
  const ordered=[...nodes].sort((a,b)=>(a.node===preferred?-1:0)-(b.node===preferred?-1:0));
  for(const entry of ordered){
    const whole=doc.createRange();whole.selectNodeContents(entry.node);
    if(![...whole.getClientRects()].some(r=>contains(r,x,y)))continue;
    let segments=[...segmenter.segment(entry.node.data)];
    if(entry.node===preferred&&Number.isInteger(at))segments.sort((a,b)=>Math.abs(a.index-at)-Math.abs(b.index-at));
    for(const part of segments){
      const r=doc.createRange(),end=part.index+part.segment.length;r.setStart(entry.node,part.index);r.setEnd(entry.node,end);
      for(const rect of r.getClientRects())if(contains(rect,x,y)){
        const right=x>=rect.left+rect.width/2;
        const textIndex=right?end-1:part.index;
        return {index:entry.offset+textIndex,textIndex,node:entry.node,after:right};
      }
    }
  }return null;
}
export function mappedPosition(record,hit){
  if(!record||!hit)return null;const span=record.map[hit.index];return span?span[hit.after?1:0]:null;
}

function* renderedText(doc,element,record,nodeMaps){
  const walker=doc.createTreeWalker(element,4);
  let offset=0,node;
  while((node=walker.nextNode())){
    yield {node,map:nodeMaps?nodeMaps.get(node)||[]:record.map.slice(offset,offset+node.length)};
    offset+=node.length;
  }
}

function characterRect(doc,node,index){
  const range=doc.createRange();
  range.setStart(node,index);range.setEnd(node,index+1);
  return range.getBoundingClientRect?.();
}

export function renderedPositionRect(doc,records,pos,nodeMaps){
  let closest=null,distance=Infinity;
  for(const el of doc.querySelectorAll('[data-token]')){
    const record=records.get(el.dataset.token);
    if(!record||pos<record.rawStart||pos>record.rawEnd)continue;
    for(const {node,map} of renderedText(doc,el,record,nodeMaps)){
      for(const [i,span] of map.entries()){
        if(!span||span[0]===span[1])continue;
        if(pos===span[0])return characterRect(doc,node,i);
        const d=Math.min(Math.abs(span[0]-pos),Math.abs(span[1]-pos));
        if(d<distance){closest={node,i};distance=d;}
      }
    }
  }
  return closest?characterRect(doc,closest.node,closest.i):null;
}

// Reading preview omits Fountain's paragraph separator lines. Their source
// caret still belongs at the preceding paragraph boundary, not nowhere.
export function previewPositionForSource(records,pos,source){
  if(!Number.isInteger(pos)||pos<0||pos>source.length)return null;
  const visible=[...records.values()].filter(r=>r.map.some(span=>span&&span[0]!==span[1]));
  if(visible.some(r=>r.rawStart<=pos&&pos<=r.rawEnd))return pos;
  const previous=visible.filter(r=>r.rawEnd<pos).sort((a,b)=>b.rawEnd-a.rawEnd)[0];
  if(previous&&!source.slice(previous.rawEnd,pos).trim())return previous.rawEnd;
  const next=visible.filter(r=>r.rawStart>pos).sort((a,b)=>a.rawStart-b.rawStart)[0];
  if(next&&!source.slice(pos,next.rawStart).trim())return next.rawStart;
  return null;
}

export function visiblePreviewAnchor(doc,records,selection){
  const height=doc.defaultView.innerHeight;
  const preferred=renderedPositionRect(doc,records,selection.focus);
  if(preferred?.height&&preferred.top>=0&&preferred.bottom<=height){
    return {selection,top:preferred.top};
  }
  return previewViewportAnchor(doc,records,0)||{selection,top:null};
}

export function previewViewportAnchor(doc,records,y,nodeMaps){
  const height=doc.defaultView.innerHeight;
  let best=null,distance=Infinity;
  for(const el of doc.querySelectorAll('[data-token]')){
    const block=el.getBoundingClientRect(),record=records.get(el.dataset.token);
    if(!record||!block.height||block.bottom<=0||block.top>=height)continue;
    for(const {node,map} of renderedText(doc,el,record,nodeMaps)){
      if(!map.length)continue;
      let lo=0,hi=map.length-1;
      while(lo<hi){
        const mid=(lo+hi)>>>1;
        if((characterRect(doc,node,mid)?.bottom??0)<=y)lo=mid+1;else hi=mid;
      }
      for(let i=lo;i<map.length;i++){
        const span=map[i];
        if(!span||span[0]===span[1])continue;
        const rect=characterRect(doc,node,i);
        if(!rect?.height||rect.bottom<=0)continue;
        if(rect.top>=height)break;
        const d=Math.max(rect.top-y,y-rect.bottom,0);
        if(d<distance){best={selection:{anchor:span[0],focus:span[0]},top:rect.top};distance=d;}
        break;
      }
    }
  }
  return best;
}

// A bounded history of exact edits relates an older rendered snapshot to the
// current textarea. A deleted/replaced hit has no safe destination.
export class SourceEdits{
  constructor(text=''){this.version=-1;this.reset(text);}
  reset(text){this.text=text;this.version++;this.edits=[];}
  record(text){
    if(text===this.text)return;
    const before=this.text;let start=0,tail=0;
    while(start<Math.min(before.length,text.length)&&before[start]===text[start])start++;
    while(tail<Math.min(before.length,text.length)-start&&before[before.length-1-tail]===text[text.length-1-tail])tail++;
    this.edits.push({version:++this.version,start,end:before.length-tail,added:text.length-start-tail});
    if(this.edits.length>200)this.edits.shift();this.text=text;
  }
  map(pos,version){
    if(!Number.isInteger(pos)||version>this.version||version<(this.edits[0]?.version??this.version+1)-1)return null;
    for(const edit of this.edits){if(edit.version<=version)continue;if(pos<edit.start)continue;
      if(edit.start===edit.end){pos+=edit.added;continue;}
      if(pos>=edit.end){pos+=edit.added-(edit.end-edit.start);continue;}
      return null;
    }return pos>=0&&pos<=this.text.length?pos:null;
  }
}

// Match the actual textarea's wrapping, including scrollbar width and tabs.
// The mirror stays outside layout and uses the same text wrapping as the source.
function mirrorStyle(input,mirror){
  const css=input.ownerDocument.defaultView.getComputedStyle(input);
  const properties=['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','fontStretch','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','textAlign','direction','tabSize','paddingTop','paddingBottom','paddingLeft','paddingRight','wordBreak'];
  const width=input.clientWidth+'px',wrap=input.wrap==='off';
  return Object.fromEntries([...properties.map(key=>[key,css[key]]),...Object.entries({width,whiteSpace:wrap?'pre':'pre-wrap',overflowWrap:wrap?'normal':'break-word',position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none',boxSizing:'border-box',border:'0',margin:'0'})]);
}

export function revealCaret(input,pos,{center=false}={}){
  const doc=input.ownerDocument,mirror=doc.createElement('div'),marker=doc.createElement('span');
  mirror.setAttribute('aria-hidden','true');
  Object.assign(mirror.style,mirrorStyle(input));
  const next=segmenter.segment(input.value.slice(pos))[Symbol.iterator]().next().value?.segment||'';
  marker.textContent=next||'\u200b';
  mirror.append(input.value.slice(0,pos),marker,input.value.slice(pos+next.length));doc.body.append(mirror);
  try{
    const base=mirror.getBoundingClientRect(),rect=marker.getBoundingClientRect();
    const top=rect.top-base.top,bottom=rect.bottom-base.top,left=rect.left-base.left,right=rect.right-base.left;
    const margin=Math.min(24,input.clientHeight/4),viewTop=input.scrollTop,viewBottom=viewTop+input.clientHeight;
    if(center)input.scrollTop=Math.max(0,(top+bottom-input.clientHeight)/2);
    else if(top<viewTop)input.scrollTop=Math.max(0,top-margin);
    else if(bottom>viewBottom)input.scrollTop=Math.max(0,bottom-input.clientHeight+margin);
    if(input.wrap==='off'){if(left<input.scrollLeft+margin)input.scrollLeft=Math.max(0,left-margin);else if(right>input.scrollLeft+input.clientWidth-margin)input.scrollLeft=right-input.clientWidth+margin;}
  }finally{mirror.remove();}
}

function installCtrlClick(target,{isComposing,readOrigin,navigate}){
  let down=null;
  target.addEventListener('pointerdown',event=>{
    down=null;if(!event.ctrlKey||event.button!==0||isComposing())return;
    const origin=readOrigin(event);
    if(origin!==null)down={x:event.clientX,y:event.clientY,origin};
  });
  target.addEventListener('pointercancel',()=>down=null);
  target.addEventListener('click',event=>{
    const start=down;down=null;
    if(!start||!event.ctrlKey||event.button!==0||event.detail>1||isComposing()||Math.hypot(event.clientX-start.x,event.clientY-start.y)>3)return;
    if(navigate(start.origin))event.preventDefault();
  });
}

export function installSourceNavigation({input,onNavigate,isComposing=()=>false}){
  installCtrlClick(input,{isComposing,readOrigin:()=>true,
    navigate:()=>input.selectionStart===input.selectionEnd&&onNavigate(input.selectionEnd)});
}

export function installPreviewNavigation({doc,input,getSnapshot,edits,onNavigate,isComposing=()=>false,getNodeMaps=()=>null}){
  function readOrigin(event){
    const element=event.target.closest?.('[data-token]');if(!element)return null;
    const snapshot=getSnapshot(),record=snapshot?.records.get(element.dataset.token);
    const hit=record&&hitText(element,event.clientX,event.clientY);
    if(!hit)return null;
    const nodeMaps=getNodeMaps();
    let pos;
    if(!nodeMaps)pos=mappedPosition(record,hit);
    else if(hit.node.parentElement.closest('.preview-number'))pos=record.sourceStart;
    else pos=nodeMaps.get(hit.node)?.[hit.textIndex]?.[hit.after?1:0]??null;
    return pos===null?null:{pos,version:snapshot.version};
  }
  installCtrlClick(doc,{isComposing,readOrigin,navigate(origin){
    if(!doc.getSelection()?.isCollapsed)return false;
    const pos=edits.map(origin.pos,origin.version);if(pos===null)return false;
    onNavigate(pos);input.focus({preventScroll:true});input.setSelectionRange(pos,pos);revealCaret(input,pos);
    return true;
  }});
}
