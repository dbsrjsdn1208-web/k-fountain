import {createSourceMeasure,previewViewportAnchor,renderedPositionRect} from './preview-navigation.js';

const clamp=(top,max)=>Math.max(0,Math.min(top,max));

export function installScrollSync({input,frame,getSnapshot,edits,enabled,getEditor}){
  const win=input.ownerDocument.defaultView,preview=frame.contentWindow,doc=frame.contentDocument;
  const sourceMeasure=createSourceMeasure(input);
  const panes={source:{scroller:input,watch:input},preview:{scroller:doc.scrollingElement||doc.documentElement,watch:preview}};
  let pending=null,animation=0;

  function quiet(which){
    const until=win.performance.now()+85;
    for(const [name,pane] of Object.entries(panes)){
      if(!which||which===name)pane.quietUntil=until;
    }
    if(!which||pending===which)pending=null;
  }

  function apply(which){
    if(!which||!enabled())return;
    const snapshot=getSnapshot();
    if(!snapshot||snapshot.version!==edits.version)return;
    const maps=getEditor()?.nodeMaps;
    const from=panes[which].scroller;
    const other=which==='source'?'preview':'source',to=panes[other].scroller;
    const fromMax=from.scrollHeight-from.clientHeight,toMax=to.scrollHeight-to.clientHeight;
    if(fromMax<=0||toMax<=0)return;
    let top;
    if(from.scrollTop<=1)top=0;
    else if(from.scrollTop>=fromMax-1)top=toMax;
    else{
      sourceMeasure.prepare();
      const y=from.clientHeight*.2,targetY=to.clientHeight*.2;
      if(which==='source'){
        let lo=0,hi=input.value.length;
        const reference=from.scrollTop+y;
        while(lo<hi){
          const mid=(lo+hi)>>>1;
          if(sourceMeasure.rect(mid).bottom<=reference)lo=mid+1;else hi=mid;
        }
        let rect=renderedPositionRect(doc,snapshot.records,lo,maps);
        if(!rect?.height){
          // A separator has no glyph in the reading pane. Use the next source
          // position only when it is one empty line away.
          const next=input.value.indexOf('\n',lo);
          if(next>=0&&!input.value.slice(lo,next).trim())rect=renderedPositionRect(doc,snapshot.records,next+1,maps);
        }
        if(!rect?.height)return;
        const offset=sourceMeasure.rect(lo).top-from.scrollTop-y;
        top=to.scrollTop+rect.top-targetY-offset;
      }else{
        const anchor=previewViewportAnchor(doc,snapshot.records,y,maps);
        if(!anchor)return;
        const rect=sourceMeasure.rect(anchor.selection.focus);
        top=rect.top-targetY-(anchor.top-y);
      }
    }
    top=clamp(top,toMax);
    if(Math.abs(to.scrollTop-top)<1)return;
    to.scrollTop=top;
    panes[other].expected=to.scrollTop;
  }

  for(const [name,pane] of Object.entries(panes)){
    const allow=()=>{pane.quietUntil=0;pane.expected=null;};
    pane.watch.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)allow();},{passive:true});
    pane.watch.addEventListener('touchmove',allow,{passive:true});
    pane.watch.addEventListener('keydown',event=>{
      if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(event.key))allow();
    });
    pane.watch.addEventListener('pointerdown',event=>{
      const left=name==='source'?input.getBoundingClientRect().left:0;
      if(event.clientX>=left+pane.scroller.clientWidth)allow();else quiet(name);
    });
    pane.watch.addEventListener('scroll',()=>{
      if(pane.expected!==null&&pane.expected!==undefined&&Math.abs(pane.scroller.scrollTop-pane.expected)<1){pane.expected=null;return;}
      pane.expected=null;
      if(win.performance.now()<(pane.quietUntil||0)||!enabled())return;
      pending=name;
      if(!animation)animation=win.requestAnimationFrame(()=>{
        animation=0;const which=pending;pending=null;apply(which);
      });
    },{passive:true});
  }
  return {quiet};
}
