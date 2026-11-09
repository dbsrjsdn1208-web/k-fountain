import {toggleMarkup,clipboardFountain} from './text-tools.js';

// Source is authoritative. Hidden notes survive a visible selection replacement.
export function replaceVisible(source,start,end,text,pairs=[]){
  const notes=[...source.matchAll(/\/\*[\s\S]*?\*\/|\[\[[\s\S]*?\]\]/g)];
  let kept='';
  for(const m of notes){const a=m.index,b=a+m[0].length;if(b<=start||a>=end)continue;
    if(start>a||end<b)return null;
    kept+=m[0];
  }
  let left=source.slice(0,start),right=source.slice(end),closing='',opening='',removedBefore=0;
  const emptyPairs=text===''?pairs.filter(p=>start===p.open[1]&&end===p.close[0]):[];
  for(const p of emptyPairs.sort((a,b)=>b.open[0]-a.open[0])){left=left.slice(0,p.open[0])+left.slice(p.open[1]);removedBefore+=p.open[1]-p.open[0];right=right.slice(p.close[1]-end);}
  for(const p of pairs){
    const [a,b]=p.open,[c,d]=p.close;
    if(start===end)continue;
    if(start>=b&&start<c&&end>=d)closing=source.slice(c,d)+closing;
    if(start<=a&&end>b&&end<=c)opening+=source.slice(a,b);
  }
  return {text:left+text+closing+kept+opening+right,start:start-removedBefore+text.length,end:start-removedBefore+text.length};
}
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export function deletionRange(text,pos,backward){
  if(backward){let last=0;for(const s of graphemes.segment(text.slice(0,pos)))last=s.index;return [last,pos];}
  return [pos,pos+(graphemes.segment(text.slice(pos))[Symbol.iterator]().next().value?.segment.length||0)];
}

export const editorCSS=`
main.preview-writing{outline:none;caret-color:currentColor;min-height:70vh;}
.preview-raw{display:block;box-sizing:border-box;width:100%;min-height:3em;resize:none;font:inherit;line-height:1.5;white-space:pre-wrap;border:1px solid #3594cf;border-radius:3px;padding:8px;color:inherit;background:transparent;caret-color:currentColor;}
.preview-slot{min-height:1.5em;white-space:pre-wrap;margin:0;}
.preview-number{user-select:none;}
.preview-writing [data-token]{white-space:pre-wrap;}
.preview-writing:empty:before{content:'여기에 Fountain으로 작성하세요';opacity:.45;}
@media screen{.preview-writing .action,.preview-writing .screen-heading,.preview-writing .transition{margin-top:0;margin-bottom:0;}.preview-writing .character{margin-top:0;}}
@media print{.preview-slot,.preview-raw{display:none!important;}[data-raw-hidden]{display:revert!important;}}
`;

export class PreviewEditor{
  constructor({doc,input,getSnapshot,edits,getMode,apply,remember,undo,refresh,notify,save}){
    Object.assign(this,{doc,input,getSnapshot,edits,getMode,apply,remember,undo,refresh,notify,save});
    this.main=doc.querySelector('main');this.enabled=false;this.raw=null;this.composing=false;this.selection=null;this.points=[];this.pendingLine=null;
    doc.addEventListener('click',e=>this.click(e));
    doc.addEventListener('pointerdown',()=>{this.lastRestored=null;});
    doc.addEventListener('beforeinput',e=>this.beforeInput(e));
    doc.addEventListener('keydown',e=>this.key(e));
    doc.addEventListener('paste',e=>this.paste(e));
    doc.addEventListener('cut',e=>this.cut(e));
    doc.addEventListener('drop',e=>{if(this.full()){e.preventDefault();this.insert(e.dataTransfer.getData('text/plain'),'insertFromDrop');}});
    doc.addEventListener('dragover',e=>{if(this.full())e.preventDefault();});
    doc.addEventListener('compositionstart',e=>{if(!this.enabled)return;this.composing=true;this.compositionSelection=this.full()?this.readSelection():null;this.compositionVersion=this.edits.version;});
    doc.addEventListener('compositionend',e=>{if(!this.enabled)return;this.composing=false;
      if(this.raw){this.commitRaw();return;}
      if(this.full()&&this.compositionSelection){this.selection=this.compositionSelection;this.insert(e.data||'','composition',this.selection,this.compositionVersion);this.compositionSelection=null;}
    });
    doc.addEventListener('selectionchange',()=>{if(this.full()&&!this.composing){const s=this.readSelection();if(s)this.selection=s;}});
    doc.addEventListener('input',e=>{if(e.target===this.raw?.field&&!this.composing)this.commitRaw();});
    // Finish on an explicit outside click, not window blur (IME/copy/app switching).
  }
  full(){return this.enabled&&this.getMode()==='full';}
  busy(){return this.composing||!!this.raw;}
  toggle(enabled){if(!this.finish())return false;this.enabled=enabled;this.selection=null;this.pendingLine=null;this.refresh();return true;}
  finish(){
    if(this.composing){this.notify('한글 입력을 마친 뒤 다시 실행해 주세요.');return false;}
    if(this.raw&&!this.commitRaw())return false;
    if(this.raw){this.raw.field.remove();this.raw.element.style.display='';delete this.raw.element.dataset.rawHidden;this.raw=null;}
    this.pendingLine=null;this.refresh();return true;
  }
  commitRaw(){
    const r=this.raw;if(!r)return true;
    const start=this.edits.map(r.start,r.version),end=this.edits.map(r.end,r.version);
    if(start===null||end===null||this.input.value.slice(start,end)!==r.original){this.notify('원고 위치가 바뀌었습니다. 입력창의 내용을 복사해 원고에 반영해 주세요.');return false;}
    if(r.field.value===r.original)return true;
    const text=this.input.value.slice(0,start)+r.field.value+this.input.value.slice(end);
    this.remember();this.apply(text,start+r.field.selectionStart,start+r.field.selectionEnd,'preview-source',false);
    r.start=start;r.end=start+r.field.value.length;r.original=r.field.value;r.version=this.edits.version;
    r.field.style.height='auto';r.field.style.height=Math.max(60,r.field.scrollHeight+4)+'px';return true;
  }
  click(e){
    if(!this.enabled||this.composing||e.target===this.raw?.field)return;
    const el=e.target.closest?.('[data-token], [data-insertion]');
    if(this.full()){
      if(e.target.closest?.('.preview-number')){const record=this.getSnapshot()?.records.get(el?.dataset.token);if(record){this.selection={anchor:record.sourceStart,focus:record.sourceStart};this.restoreSelection();}}
      if(this.pendingLine!==null){const s=this.readSelection();if(s&&this.input.value.lastIndexOf('\n',Math.max(0,s.focus-1))+1!==this.pendingLine){this.pendingLine=null;this.selection=s;this.refresh();}}
      return;
    }
    if(!el){this.finish();return;}
    const snap=this.getSnapshot(),rec=snap?.records.get(el.dataset.token),insertion=el.dataset.insertion;
    if(!rec&&insertion===undefined)return;
    let start=rec?.rawStart??+insertion,end=rec?.rawEnd??+insertion,version=snap.version;
    // Another paragraph may have changed since this DOM was rendered.
    start=this.edits.map(start,version);end=this.edits.map(end,version);
    if(start===null||end===null){this.notify('원고 위치가 바뀌었습니다. 다시 클릭해 주세요.');return;}
    if(this.raw){if(!this.commitRaw())return;this.raw.field.remove();this.raw.element.style.display='';delete this.raw.element.dataset.rawHidden;this.raw=null;}
    const field=this.doc.createElement('textarea');field.className='preview-raw';field.setAttribute('aria-label','문단 Fountain 원문');field.spellcheck=false;field.value=this.input.value.slice(start,end);
    el.after(field);el.style.display='none';el.dataset.rawHidden='true';
    this.raw={element:el,field,start,end,original:field.value,version:this.edits.version};field.style.height=Math.max(60,field.scrollHeight+4)+'px';field.focus();field.setSelectionRange(field.value.length,field.value.length);
  }
  // Rebuild only from the canonical rendered screenplay; never serialize arbitrary HTML.
  decorate(){
    this.main.classList.toggle('preview-writing',this.full());this.main.contentEditable=this.full()?'true':'false';
    this.main.setAttribute('aria-label',this.full()?'대본 직접 편집':'대본 미리보기');
    this.main.setAttribute('role',this.full()?'textbox':'document');this.main.setAttribute('aria-multiline','true');
    this.points=[];this.spans=[];this.nodeMaps=new WeakMap();if(!this.enabled)return;
    const snap=this.getSnapshot(),source=this.input.value;
    const elements=[...this.main.querySelectorAll('[data-token]')];
    if(this.full())for(const element of elements){
      const rec=snap.records.get(element.dataset.token);if(!rec)continue;
      let map=rec.map;
      if(this.pendingLine!==null&&rec.rawStart<=this.pendingLine&&rec.rawEnd>=this.pendingLine){element.textContent=source.slice(rec.rawStart,rec.rawEnd);map=Array.from({length:element.textContent.length},(_,i)=>[rec.rawStart+i,rec.rawStart+i+1]);}
      const walker=this.doc.createTreeWalker(element,4),nodes=[];let n;while(n=walker.nextNode())nodes.push(n);
      let offset=0;
      for(const node of nodes){const spans=map.slice(offset,offset+node.length);offset+=node.length;this.nodeMaps.set(node,spans);
        for(let i=0;i<spans.length;i++){const span=spans[i];if(!span||span[0]===span[1])continue;this.spans.push(span);this.points.push({node,offset:i,pos:span[0]},{node,offset:i+1,pos:span[1]});}
      }
      // Isolate generated numbering so native editing cannot alter it.
      const first=element.firstChild;let generated=0;while(generated<map.length&&map[generated]?.[0]===map[generated]?.[1])generated++;
      if(generated&&first?.nodeType===3&&first.length>=generated){const tail=first.splitText(generated),label=this.doc.createElement('span');label.className='preview-number';label.contentEditable='false';first.replaceWith(label);label.append(first);this.nodeMaps.set(tail,map.slice(generated,generated+tail.length));this.points=this.points.filter(p=>p.node!==first);for(let i=0;i<tail.length;i++){const span=map[generated+i];if(span&&span[0]!==span[1])this.points.push({node:tail,offset:i,pos:span[0]},{node:tail,offset:i+1,pos:span[1]});}}
    }
    // Blank source lines are real insertion positions, not layout-only margins.
    const ranges=elements.map(el=>({el,rec:snap.records.get(el.dataset.token)})).filter(x=>x.rec).sort((a,b)=>a.rec.rawStart-b.rec.rawStart);
    const hidden=[...source.matchAll(/\/\*[\s\S]*?\*\/|\[\[[\s\S]*?\]\]/g)].map(m=>[m.index,m.index+m[0].length]);
    let pos=0;for(const line of source.split('\n')){
      const covered=ranges.some(x=>pos>=x.rec.rawStart&&pos<x.rec.rawEnd);
      const concealed=hidden.some(([a,b])=>pos>=a&&pos+line.length<=b);
      if(this.full()&&!covered&&!concealed){
        const slot=this.doc.createElement('p');slot.className='preview-slot';slot.dataset.insertion=pos;slot.append(this.doc.createTextNode(line||'\u200b'));
        const next=ranges.find(x=>x.rec.rawStart>=pos);if(next)next.el.before(slot);else this.main.append(slot);
        const map=line?Array.from({length:line.length},(_,i)=>[pos+i,pos+i+1]):[[pos,pos]];this.nodeMaps.set(slot.firstChild,map);
        for(let i=0;i<map.length;i++){this.points.push({node:slot.firstChild,offset:i,pos:map[i][0]},{node:slot.firstChild,offset:i+1,pos:map[i][1]});if(line)this.spans.push(map[i]);}
      }pos+=line.length+1;
    }
    if(!this.main.querySelector('[data-token], [data-insertion]')){const slot=this.doc.createElement('p');slot.className='preview-slot';slot.dataset.insertion=source.length;slot.textContent='\u200b';this.main.append(slot);this.nodeMaps.set(slot.firstChild,[[source.length,source.length]]);this.points.push({node:slot.firstChild,offset:0,pos:source.length});}
    if(this.full()&&this.selection)this.restoreSelection();
  }
  boundary(node,offset){
    if(!node||!this.main.contains(node))return null;
    const number=(node.nodeType===3?node.parentElement:node).closest?.('.preview-number');
    if(number){const el=number.closest('[data-token]');return this.getSnapshot()?.records.get(el.dataset.token)?.sourceStart??null;}
    if(node.nodeType===3){const map=this.nodeMaps.get(node);if(!map)return null;return offset<map.length?map[offset]?.[0]??null:map.at(-1)?.[1]??null;}
    const children=[...node.childNodes],after=children[offset];
    const points=this.points.filter(p=>node.contains(p.node));
    if(after){const first=this.points.find(p=>after===p.node||after.contains?.(p.node));if(first)return first.pos;}
    return points.at(-1)?.pos??null;
  }
  readSelection(){const s=this.doc.getSelection();if(!s?.anchorNode)return null;const r=this.lastRestored;if(r&&s.anchorNode===r.a.node&&s.anchorOffset===r.a.offset&&s.focusNode===r.f.node&&s.focusOffset===r.f.offset)return r.selection;const anchor=this.boundary(s.anchorNode,s.anchorOffset),focus=this.boundary(s.focusNode,s.focusOffset);return anchor===null||focus===null?null:{anchor,focus};}
  restoreSelection(){
    if(!this.selection||!this.points.length)return;
    const nearest=pos=>this.points.reduce((a,b)=>Math.abs(b.pos-pos)<Math.abs(a.pos-pos)?b:a);
    const a=nearest(this.selection.anchor),f=nearest(this.selection.focus);this.main.focus({preventScroll:true});this.doc.getSelection().setBaseAndExtent(a.node,a.offset,f.node,f.offset);
    this.lastRestored={a,f,selection:{...this.selection}};
    const range=this.doc.createRange();range.setStart(f.node,f.offset);range.collapse(true);const rect=range.getBoundingClientRect?.(),win=this.doc.defaultView;
    if(rect?.height){if(rect.top<12)win.scrollBy(0,rect.top-12);else if(rect.bottom>win.innerHeight-12)win.scrollBy(0,rect.bottom-win.innerHeight+12);}
  }
  insert(text,type='insertText',selection=this.readSelection()||this.selection,version=this.getSnapshot()?.version){
    if(!selection)return;let a=this.edits.map(Math.min(selection.anchor,selection.focus),version),b=this.edits.map(Math.max(selection.anchor,selection.focus),version);
    if(a===null||b===null){this.keepDraft(text);this.refresh();return;}
    const pairs=[...this.getSnapshot().records.values()].flatMap(r=>r.formatPairs||[]);
    if(a===b&&text.includes('\n')){let next;do{next=pairs.find(p=>p.close[0]===a);if(next)a=b=next.close[1];}while(next);}
    if(a===b&&type.startsWith('delete')){
      const backward=type.includes('Backward'),pos=a;
      const spans=this.spans.filter(s=>backward?s[1]<=pos:s[0]>=pos).sort((x,y)=>x[0]-y[0]),adjacent=backward?spans.at(-1):spans[0];
      const gap=adjacent?this.input.value.slice(backward?adjacent[1]:pos,backward?pos:adjacent[0]):'';
      if(adjacent&&!gap.includes('\n'))[a,b]=deletionRange(this.input.value,backward?adjacent[1]:adjacent[0],backward);
      else [a,b]=deletionRange(this.input.value,pos,backward);
    }
    const result=replaceVisible(this.input.value,a,b,text,pairs);if(!result){this.notify('숨김 메모는 원문 편집에서 수정해 주세요.');this.refresh();return;}
    this.input.setSelectionRange(a,b);this.remember();
    const lineStart=result.text.lastIndexOf('\n',Math.max(0,result.start-1))+1;
    if(text.includes('\n'))this.pendingLine=null;else if(a===lineStart&&/^[.@>#=~!]/.test(text))this.pendingLine=lineStart;
    this.apply(result.text,result.start,result.end,type,true);this.selection={anchor:this.input.selectionStart,focus:this.input.selectionEnd};this.refresh();
  }
  beforeInput(e){
    if(!this.full()||!this.main.contains(e.target)||this.composing||e.isComposing)return;
    e.preventDefault();const type=e.inputType;
    if(type==='historyUndo'||type==='historyRedo'){this.history(type==='historyUndo'?-1:1);return;}
    if(type==='insertParagraph'||type==='insertLineBreak'){this.insert('\n',type);return;}
    if(type.startsWith('delete')){this.insert('',type);return;}
    if(type.startsWith('insert')&&e.data!==null){const r=type==='insertReplacementText'?e.getTargetRanges?.()[0]:null;let selection;if(r){const a=this.boundary(r.startContainer,r.startOffset),b=this.boundary(r.endContainer,r.endOffset);if(a!==null&&b!==null)selection={anchor:a,focus:b};}this.insert(e.data,type,selection||this.readSelection()||this.selection);return;}
    if(type.startsWith('format'))this.mark({formatBold:'**',formatItalic:'*',formatUnderline:'_'}[type]);
  }
  history(delta){if(this.raw&&!this.finish())return;this.undo(delta);this.selection=this.full()?{anchor:this.input.selectionStart,focus:this.input.selectionEnd}:null;this.refresh();}
  mark(marker){
    if(!marker)return;
    if(this.raw){const f=this.raw.field,r=toggleMarkup(f.value,f.selectionStart,f.selectionEnd,marker);f.value=r.text;f.setSelectionRange(r.start,r.end);this.commitRaw();return;}
    const s=this.readSelection()||this.selection;if(!s)return;const a=Math.min(s.anchor,s.focus),b=Math.max(s.anchor,s.focus);
    this.input.setSelectionRange(a,b);this.remember();const result=toggleMarkup(this.input.value,a,b,marker);this.apply(result.text,result.start,result.end,'markup',false);this.selection={anchor:result.start,focus:result.end};this.refresh();
  }
  key(e){
    if(!this.enabled||this.composing||e.isComposing)return;const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
    if(['arrowleft','arrowright','arrowup','arrowdown','home','end'].includes(key))this.lastRestored=null;
    if(mod&&key==='a'&&this.full()&&this.main.contains(e.target)){e.preventDefault();this.selection={anchor:0,focus:this.input.value.length};this.restoreSelection();return;}
    if(mod&&key==='s'){e.preventDefault();if(this.finish())this.save(e.shiftKey);return;}
    if(mod&&key==='enter'){e.preventDefault();this.finish();return;}
    if(mod&&['z','y'].includes(key)){e.preventDefault();this.history(key==='y'||e.shiftKey?1:-1);return;}
    if(mod&&['b','i','u'].includes(key)){e.preventDefault();this.mark({b:'**',i:'*',u:'_'}[key]);}
  }
  paste(e){
    if(!this.enabled||this.composing)return;const text=clipboardFountain(e.clipboardData.getData('text/plain'),e.clipboardData.getData('text/html'));
    if(this.raw&&e.target===this.raw.field){e.preventDefault();const f=this.raw.field;f.setRangeText(text,f.selectionStart,f.selectionEnd,'end');this.commitRaw();}
    else if(this.full()){e.preventDefault();this.insert(text,'insertFromPaste');}
  }
  cut(e){if(!this.full())return;const s=this.doc.getSelection();if(s?.isCollapsed)return;e.preventDefault();e.clipboardData.setData('text/plain',s.toString());this.insert('','deleteByCut');}
  keepDraft(text){
    this.notify('원고 위치가 바뀌었습니다. 아래 보관된 입력을 복사해 다시 반영해 주세요.');
    if(!text)return;let field=this.doc.querySelector('#preview-unapplied');if(!field){field=this.doc.createElement('textarea');field.id='preview-unapplied';field.className='preview-raw';field.setAttribute('aria-label','반영하지 못한 입력 보관');this.main.after(field);}field.value+=text;
  }
}
