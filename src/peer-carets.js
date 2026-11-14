import {measureCaret,invalidateCaretMeasurement} from './preview-navigation.js';

// A passive position marker in the other pane. It never takes focus or edits text.
export function previewPoint(doc, records, pos, editor) {
  if (editor?.enabled) {
    let best=null, distance=Infinity;
    for (const p of editor.points) { const d=Math.abs(p.pos-pos);if(d<distance){distance=d;best=p;} }
    return best;
  }
  for (const el of doc.querySelectorAll('[data-token]')) {
    const record=records?.get(el.dataset.token);
    if(!record || pos<record.rawStart || pos>record.rawEnd)continue;
    let boundary=0, distance=Infinity;
    for(let i=0;i<record.map.length;i++) {
      const span=record.map[i];if(!span||span[0]===span[1])continue;
      for(const [at,offset] of [[span[0],i],[span[1],i+1]])if(Math.abs(at-pos)<distance){distance=Math.abs(at-pos);boundary=offset;}
    }
    if(distance===Infinity)continue;
    const walker=doc.createTreeWalker(el,4);let node;
    while(node=walker.nextNode()){if(boundary<=node.length)return {node,offset:boundary};boundary-=node.length;}
  }
  if(!doc.querySelector('[data-token]'))return {empty:doc.querySelector('main')};
  return null;
}
export function installPeerCarets({input,frame,getSnapshot,getEditor}) {
  const doc=input.ownerDocument, preview=frame.contentDocument;
  function marker(d){const el=d.createElement('div');el.className='peer-caret';el.setAttribute('aria-hidden','true');el.hidden=true;
    Object.assign(el.style,{position:'fixed',width:'2px',background:'#1684d8',pointerEvents:'none',zIndex:'30'});d.body.append(el);return el;}
  const sourceMarker=marker(doc),previewMarker=marker(preview);
  function show(el,x,y,height,clip){
    if(!height||x<clip.left||x>clip.right||y<clip.top||y+height>clip.bottom){el.hidden=true;return;}
    Object.assign(el.style,{left:x+'px',top:y+'px',height:height+'px'});el.hidden=false;
  }
  function update(){
    sourceMarker.hidden=previewMarker.hidden=true;
    if(doc.activeElement===input&&!frame.parentElement.hidden){
      const pos=input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd;
      const point=previewPoint(preview,getSnapshot()?.records,pos,getEditor());if(!point)return;
      if(point.empty){const r=point.empty.getBoundingClientRect(),height=parseFloat(preview.defaultView.getComputedStyle(point.empty).lineHeight)||24;show(previewMarker,r.left,r.top,height,{left:0,top:0,right:frame.clientWidth,bottom:frame.clientHeight});return;}
      const range=preview.createRange();range.setStart(point.node,point.offset);range.collapse(true);
      let r=range.getBoundingClientRect?.();
      if(!r?.height&&point.node.length){const previous=point.offset>0;range.setStart(point.node,previous?point.offset-1:0);range.setEnd(point.node,previous?point.offset:1);const glyph=range.getBoundingClientRect?.();if(glyph)r={...glyph,left:previous?glyph.right:glyph.left,top:glyph.top,height:glyph.height};}
      if(r)show(previewMarker,r.left,r.top,r.height,{left:0,top:0,right:frame.clientWidth,bottom:frame.clientHeight});
    }else if(doc.activeElement===frame&&getEditor()?.enabled&&!input.hidden){
      const pos=input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd;
      const r=measureCaret(input,pos),box=input.getBoundingClientRect();
      show(sourceMarker,box.left+input.clientLeft+r.left-input.scrollLeft,box.top+input.clientTop+r.top-input.scrollTop,r.height,box);
    }
  }
  for(const target of [input,doc.defaultView,preview.defaultView]){target.addEventListener('scroll',update);target.addEventListener('resize',update);}
  doc.fonts?.addEventListener('loadingdone',()=>{invalidateCaretMeasurement(input);update();});
  doc.addEventListener('focusin',update);preview.addEventListener('focusin',update);
  return {update};
}
