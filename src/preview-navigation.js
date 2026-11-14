const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const caretMeasurements=new WeakMap();
const caretStyleProperties=['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','fontStretch','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','textAlign','direction','tabSize','paddingTop','paddingBottom','paddingLeft','paddingRight','overflowWrap','wordBreak'];
export function invalidateCaretMeasurement(input){caretMeasurements.delete(input);}
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
export function measureCaret(input,pos){
  const doc=input.ownerDocument,css=doc.defaultView.getComputedStyle(input);
  const key=JSON.stringify([input.clientWidth,input.wrap,...caretStyleProperties.map(p=>css[p])]),cached=caretMeasurements.get(input);
  if(cached?.key===key&&cached.text===input.value&&cached.pos===pos)return cached.rect;
  const mirror=doc.createElement('div');
  mirror.setAttribute('aria-hidden','true');
  for(const property of caretStyleProperties)mirror.style[property]=css[property];
  Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none',boxSizing:'border-box',width:input.clientWidth+'px',whiteSpace:input.wrap==='off'?'pre':'pre-wrap',overflowWrap:input.wrap==='off'?'normal':'break-word',border:'0',margin:'0'});
  const before=doc.createTextNode(input.value.slice(0,pos)),marker=doc.createElement('span');
  // Keep following text: it controls word wrapping at the insertion point.
  const next=segmenter.segment(input.value.slice(pos))[Symbol.iterator]().next().value?.segment||'';
  marker.textContent=next||'\u200b';
  mirror.append(before,marker,doc.createTextNode(input.value.slice(pos+next.length)));doc.body.append(mirror);
  try{
    const base=mirror.getBoundingClientRect(),rect=marker.getBoundingClientRect(),top=rect.top-base.top,bottom=rect.bottom-base.top;
    const result={top,bottom,left:rect.left-base.left,right:rect.right-base.left,height:rect.height};
    caretMeasurements.set(input,{key,text:input.value,pos,rect:result});return result;
  }finally{mirror.remove();}
}
export function revealCaret(input,pos){
    const {top,bottom,left,right}=measureCaret(input,pos);
    const margin=Math.min(24,input.clientHeight/4),viewTop=input.scrollTop,viewBottom=viewTop+input.clientHeight;
    if(top<viewTop)input.scrollTop=Math.max(0,top-margin);
    else if(bottom>viewBottom)input.scrollTop=Math.max(0,bottom-input.clientHeight+margin);
    if(input.wrap==='off'){if(left<input.scrollLeft+margin)input.scrollLeft=Math.max(0,left-margin);else if(right>input.scrollLeft+input.clientWidth-margin)input.scrollLeft=right-input.clientWidth+margin;}
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
