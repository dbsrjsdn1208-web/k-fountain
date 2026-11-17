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
        return {index:entry.offset+(right?end-1:part.index),after:right};
      }
    }
  }return null;
}
export function mappedPosition(record,hit){
  if(!record||!hit)return null;const span=record.map[hit.index];return span?span[hit.after?1:0]:null;
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
// Kept outside layout/accessibility and updated only for a navigation click.
function withSourceMirror(input,read){
  const doc=input.ownerDocument,css=doc.defaultView.getComputedStyle(input),mirror=doc.createElement('div');
  mirror.setAttribute('aria-hidden','true');
  for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','fontStretch','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','textAlign','direction','tabSize','paddingTop','paddingBottom','paddingLeft','paddingRight','overflowWrap','wordBreak'])mirror.style[property]=css[property];
  Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none',boxSizing:'border-box',width:input.clientWidth+'px',whiteSpace:input.wrap==='off'?'pre':'pre-wrap',overflowWrap:input.wrap==='off'?'normal':'break-word',border:'0',margin:'0'});
  const text=doc.createTextNode(input.value+'\u200b');mirror.append(text);doc.body.append(mirror);
  try{
    const base=mirror.getBoundingClientRect();
    return read(text,pos=>sourceRect(doc,text,pos,base),mirror,base);
  }finally{mirror.remove();}
}

function sourceRect(doc,text,pos,base){
  const range=doc.createRange();
  range.setStart(text,pos);range.setEnd(text,Math.min(pos+1,text.length));
  const r=range.getBoundingClientRect?.();
  return r?{top:r.top-base.top,bottom:r.bottom-base.top,left:r.left-base.left,right:r.right-base.left}:null;
}

export function revealCaret(input,pos){
  const rect=withSourceMirror(input,(text,_,mirror,base)=>{
    const next=segmenter.segment(input.value.slice(pos))[Symbol.iterator]().next().value?.segment||'';
    const marker=input.ownerDocument.createElement('span');
    marker.textContent=next||'\u200b';
    mirror.replaceChildren(text.data.slice(0,pos),marker,input.value.slice(pos+next.length));
    const r=marker.getBoundingClientRect();
    return {top:r.top-base.top,bottom:r.bottom-base.top,left:r.left-base.left,right:r.right-base.left};
  });
  const {top,bottom,left,right}=rect;
  const margin=Math.min(24,input.clientHeight/4),viewTop=input.scrollTop,viewBottom=viewTop+input.clientHeight;
  if(top<viewTop)input.scrollTop=Math.max(0,top-margin);
  else if(bottom>viewBottom)input.scrollTop=Math.max(0,bottom-input.clientHeight+margin);
  if(input.wrap==='off'){
    if(left<input.scrollLeft+margin)input.scrollLeft=Math.max(0,left-margin);
    else if(right>input.scrollLeft+input.clientWidth-margin)input.scrollLeft=right-input.clientWidth+margin;
  }
}

export function sourceViewportAnchor(input,{anchor,focus}){
  return withSourceMirror(input,(text,measure)=>{
    const caret=measure(focus),top=input.scrollTop,height=input.clientHeight;
    if(!caret||!height)return {anchor,focus,ratio:null};
    if(caret.bottom>top&&caret.top<top+height)return {anchor,focus,ratio:(caret.top-top)/height};
    let low=0,high=input.value.length;
    while(low<high){
      const mid=(low+high)>>>1;
      if(measure(mid).bottom<=top+8)low=mid+1;else high=mid;
    }
    const pos=segmenter.segment(text.data).containing(low)?.index??low;
    return {anchor:pos,focus:pos,ratio:(measure(pos).top-top)/height};
  });
}

export function placeSourceAnchor(input,pos,ratio){
  if(ratio===null){revealCaret(input,pos);return;}
  const rect=withSourceMirror(input,(_,measure)=>measure(pos));
  if(rect)input.scrollTop=Math.max(0,rect.top-input.clientHeight*Math.max(0,Math.min(.9,ratio)));
}

function* previewTextNodes(doc,blocks,records,editor){
  for(const block of blocks){
    const record=records?.get(block.dataset.token);
    const walker=doc.createTreeWalker(block,4);
    let index=0,node;
    while((node=walker.nextNode())){
      const map=editor.enabled?editor.nodeMaps.get(node):record?.map.slice(index,index+node.length);
      if(map?.length)yield {node,map};
      index+=node.length;
    }
  }
}

function glyphRect(doc,node,index){
  const range=doc.createRange();
  range.setStart(node,index);range.setEnd(node,index+1);
  return range.getBoundingClientRect?.();
}

export function previewPositionRect(doc,records,editor,pos){
  const blocks=[...doc.querySelectorAll('[data-token],[data-insertion]')].filter(block=>{
    if(block.hasAttribute('data-insertion'))return Number(block.dataset.insertion)===pos;
    const r=records?.get(block.dataset.token);
    return r&&pos>=r.rawStart&&pos<=r.rawEnd;
  });
  let closest=null,distance=Infinity;
  for(const {node,map} of previewTextNodes(doc,blocks,records,editor)){
    for(const [index,span] of map.entries()){
      if(!span||span[0]===span[1])continue;
      const d=Math.min(Math.abs(span[0]-pos),Math.abs(span[1]-pos));
      if(d<distance){distance=d;closest={node,index};}
      if(span[0]===pos)return glyphRect(doc,node,index);
    }
  }
  return closest?glyphRect(doc,closest.node,closest.index):blocks[0]?.getBoundingClientRect();
}

export function previewViewportAnchor(doc,records,editor,selection=null){
  const height=doc.defaultView.innerHeight;
  const at=selection&&previewPositionRect(doc,records,editor,selection.focus);
  if(at?.height&&at.bottom>0&&at.top<height)return {...selection,ratio:at.top/height};
  const blocks=[...doc.querySelectorAll('[data-token],[data-insertion]')].filter(block=>{
    const rect=block.getBoundingClientRect();return rect.height&&rect.bottom>8&&rect.top<height;
  });
  let best=null;
  for(const {node,map} of previewTextNodes(doc,blocks,records,editor)){
    let low=0,high=node.length-1;
    while(low<high){
      const mid=(low+high)>>>1;
      if((glyphRect(doc,node,mid)?.bottom??0)<=8)low=mid+1;else high=mid;
    }
    for(let i=low;i<map.length;i++){
      const span=map[i];
      if(!span||span[0]===span[1])continue;
      const rect=glyphRect(doc,node,i);
      if(!rect?.height||rect.bottom<=8)continue;
      if(rect.top>=height)break;
      if(!best||rect.top<best.top)best={pos:span[0],top:rect.top};
      break;
    }
  }
  return best?{anchor:best.pos,focus:best.pos,ratio:best.top/height}:null;
}

export function placePreviewAnchor(doc,records,editor,pos,ratio){
  const rect=previewPositionRect(doc,records,editor,pos);
  if(rect?.height){
    const win=doc.defaultView;
    const top=win.innerHeight*Math.max(0,Math.min(.9,ratio??.25));
    win.scrollBy(0,rect.top-top);
  }
}

export function installPreviewNavigation({doc,input,getSnapshot,edits,onNavigate,isComposing=()=>false}){
  let down=null;
  doc.addEventListener('pointerdown',event=>{
    down=null;if(event.button!==0||isComposing())return;
    const element=event.target.closest?.('[data-token]');if(!element)return;
    const snapshot=getSnapshot(),record=snapshot?.records.get(element.dataset.token);
    const pos=mappedPosition(record,hitText(element,event.clientX,event.clientY));
    if(pos!==null)down={x:event.clientX,y:event.clientY,pos,version:snapshot.version};
  });
  doc.addEventListener('pointercancel',()=>down=null);
  doc.addEventListener('click',event=>{
    const start=down;down=null;
    if(!start||event.button!==0||event.detail>1||isComposing()||Math.hypot(event.clientX-start.x,event.clientY-start.y)>3||!doc.getSelection()?.isCollapsed)return;
    const pos=edits.map(start.pos,start.version);if(pos===null)return;
    onNavigate();input.focus({preventScroll:true});input.setSelectionRange(pos,pos);revealCaret(input,pos);
  });
}
