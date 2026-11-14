import {toggleMarkup,clipboardFountain} from './text-tools.js';
import {noteRanges,captureBlock,projectBlock,paintBlock} from './live-preview.js';

// Source is authoritative. Hidden notes survive a visible selection replacement.
export function replaceVisible(source,start,end,text,pairs=[],protectedRanges=noteRanges(source)){
  const notes=protectedRanges.map(([a,b])=>({index:a,0:source.slice(a,b)}));
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
main.preview-writing{outline:none;caret-color:currentColor;min-height:70vh;cursor:text;}
.peer-caret[hidden]{display:none!important;}
.preview-raw{display:block;box-sizing:border-box;width:100%;min-height:3em;resize:none;font:inherit;line-height:1.5;white-space:pre-wrap;border:1px solid #3594cf;border-radius:3px;padding:8px;color:inherit;background:transparent;caret-color:currentColor;}
.preview-slot{min-height:1.5em;white-space:pre-wrap;margin:0;}
.preview-number{user-select:none;}
.preview-syntax{color:#77818d;}
.preview-note{color:#77818d;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;}
.preview-hidden-slot{min-height:0;height:0;line-height:0;overflow:hidden;}
.preview-page-break{min-height:1.5em;border-top:1px dashed #ccd1d6;}
.preview-writing [data-token]{white-space:pre-wrap;}
.preview-writing:empty:before{content:'여기에 Fountain으로 작성하세요';opacity:.45;}
@media screen{.preview-writing .action,.preview-writing .screen-heading,.preview-writing .transition{margin-top:0;margin-bottom:0;}.preview-writing .character{margin-top:0;}}
@media print{.peer-caret,.preview-slot,.preview-raw,.preview-syntax,.preview-note{display:none!important;}.preview-page-break{break-after:page;visibility:hidden;}[data-raw-hidden]{display:revert!important;}}
`;

export class PreviewEditor{
  constructor({doc,input,getSnapshot,edits,getMode,getShowNotes=()=>false,onSelection=()=>{},onComposition=()=>{},apply,remember,undo,refresh,notify,save}){
    Object.assign(this,{doc,input,getSnapshot,edits,getMode,getShowNotes,onSelection,onComposition,apply,remember,undo,refresh,notify,save});
    this.blockCache=new WeakMap();
    this.main=doc.querySelector('main');this.enabled=false;this.composing=false;this.selection=null;this.points=[];this.pendingLine=null;
    doc.addEventListener('click',e=>this.click(e));
    doc.addEventListener('pointerdown',()=>{this.lastRestored=null;this.dragging=true;});
    doc.addEventListener('pointerup',()=>{this.dragging=false;this.syncSelection();});
    doc.addEventListener('beforeinput',e=>this.beforeInput(e));
    doc.addEventListener('keydown',e=>this.key(e));
    doc.addEventListener('paste',e=>this.paste(e));
    doc.addEventListener('cut',e=>this.cut(e));
    doc.addEventListener('drop',e=>{if(this.isEditing()){e.preventDefault();this.insert(e.dataTransfer.getData('text/plain'),'insertFromDrop');}});
    doc.addEventListener('dragover',e=>{if(this.isEditing())e.preventDefault();});
    doc.addEventListener('compositionstart',()=>{
      if(!this.enabled)return;
      this.composing=true;this.compositionSelection=this.readSelection();this.compositionVersion=this.edits.version;
      this.compositionSource=this.input.value;this.compositionDraft=this.input.value;this.remember();
    });
    doc.addEventListener('input',e=>{if(this.composing&&typeof e.data==='string')this.syncComposition(e.data);});
    doc.addEventListener('compositionend',e=>this.endComposition(e.data));
    doc.addEventListener('selectionchange',()=>this.syncSelection());
  }
  isEditing(){return this.enabled;}
  live(){return this.enabled&&this.getMode()!=='full';}
  busy(){return this.composing;}
  toggle(enabled){if(!this.finish())return false;this.enabled=enabled;this.selection=null;this.pendingLine=null;this.refresh();return true;}
  finish(){
    if(this.composing){this.notify('한글 입력을 마친 뒤 다시 실행해 주세요.');return false;}
    this.selection=null;this.pendingLine=null;this.refresh();return true;
  }
  click(e){
    if(!this.enabled||this.composing)return;
    const el=e.target.closest?.('[data-token], [data-insertion]');
    if(this.isEditing()){
      if(e.target.closest?.('.preview-number')){const record=this.getSnapshot()?.records.get(el?.dataset.token);if(record){this.selection={anchor:record.sourceStart,focus:record.sourceStart};this.restoreSelection();}}
      if(this.pendingLine!==null){const s=this.readSelection();if(s&&this.input.value.lastIndexOf('\n',Math.max(0,s.focus-1))+1!==this.pendingLine){this.pendingLine=null;this.selection=s;this.refresh();}}
      this.syncSelection();
    }
  }
  // Rebuild only from the canonical rendered screenplay; never serialize arbitrary HTML.
  decorate(originals=null){
    this.originals=originals;
    this.main.classList.toggle('preview-writing',this.isEditing());this.main.contentEditable=this.isEditing()?'true':'false';
    this.main.setAttribute('aria-label',this.live()?'대본 라이브 프리뷰':this.isEditing()?'대본 직접 편집':'대본 미리보기');
    this.main.setAttribute('role',this.isEditing()?'textbox':'document');this.main.setAttribute('aria-multiline','true');
    this.main.spellcheck=false;
    this.points=[];this.spans=[];this.nodeMaps=new WeakMap();if(!this.enabled)return;
    this.decorateLive();
  }
  // Empty source lines continue the previous dialogue until a second newline.
  placeSlot(el,pos,ranges){
    const previous=ranges.findLast(b=>b.rec.rawEnd===pos-1);
    if(previous&&['character','dialogue','parenthetical'].includes(previous.rec.type)){
      el.classList.add('dialogue');if(previous.el.nextElementSibling!==el)previous.el.after(el);return;
    }
    const next=ranges.find(b=>b.rec.rawStart>=pos);
    if(next){let top=next.el;while(top.parentElement!==this.main)top=top.parentElement;if(top.previousElementSibling!==el)top.before(el);}
    else if(this.main.lastElementChild!==el)this.main.append(el);
  }
  hiddenRanges(){return noteRanges(this.input.value).filter(([a])=>this.input.value.startsWith('[[',a)?!this.getShowNotes():!this.live());}
  skipHidden(pos,backward){
    const ranges=this.hiddenRanges();if(backward)ranges.reverse();
    for(const [a,b] of ranges)if(backward?(pos>a&&pos<=b):(pos>=a&&pos<b))pos=backward?a:b;
    return pos;
  }

  decorateLive(){
    const source=this.input.value,snap=this.getSnapshot();this.notes=noteRanges(source);this.liveBlocks=[];
    for(let el of this.main.querySelectorAll('[data-token]')){
      const rec=snap.records.get(el.dataset.token);if(!rec)continue;
      if(el.matches('hr,br')){const replacement=this.doc.createElement('p');for(const a of el.attributes)replacement.setAttribute(a.name,a.value);if(el.tagName==='HR')replacement.classList.add('preview-page-break');el.replaceWith(replacement);el=replacement;}
      const prior=this.blockCache.get(el),canonical=this.originals?.get(el)||el;
      const block=captureBlock(this.doc,canonical,rec);block.el=el;
      if(prior&&!this.originals?.reset.has(el))block.signature=prior.signature;
      this.blockCache.set(el,block);
      block.hidden=this.notes.some(([a,b])=>rec.rawStart>=a&&rec.rawEnd<=b);
      this.liveBlocks.push(block);
    }
    const slots=new Map([...this.main.querySelectorAll('[data-insertion]')].map(el=>[+el.dataset.line,el]));
    const covered=this.liveBlocks.slice().sort((a,b)=>a.rec.rawStart-b.rec.rawStart);let pos=0,cover=0,lineNumber=0;
    for(const line of source.split('\n')){
      while(cover<covered.length&&covered[cover].rec.rawEnd<=pos)cover++;
      if(!covered[cover]||pos<covered[cover].rec.rawStart){
        const existing=slots.get(lineNumber),el=existing||this.doc.createElement('p');slots.delete(lineNumber);el.className='preview-slot';el.dataset.insertion=pos;el.dataset.line=lineNumber;
        const rec={rawStart:pos,rawEnd:pos+line.length,sourceStart:pos,sourceEnd:pos+line.length,map:[],formatPairs:[]};
        const note=this.notes.some(([a,b])=>pos>=a&&pos+line.length<=b);
        const block={el,rec,units:new Map(),generated:'',signature:this.blockCache.get(el)?.signature??null,hidden:note};
        this.blockCache.set(el,block);this.placeSlot(el,pos,covered);this.liveBlocks.push(block);
      }pos+=line.length+1;lineNumber++;
    }
    for(const el of slots.values())el.remove();
    this.liveBlocks.sort((a,b)=>a.rec.rawStart-b.rec.rawStart);this.rebuildMaps=true;this.updateLive(false);
    if(this.selection)this.restoreSelection();
  }
  syncSelection(){
    if(!this.isEditing()||this.composing||this.updatingLive)return;const s=this.readSelection();if(!s)return;this.selection=s;
    if(!this.dragging)this.updateLive();
    this.onSelection({...this.selection},this.getSnapshot()?.version);
  }
  clearSelection(){this.selection=null;this.lastRestored=null;if(this.live()&&!this.composing)this.updateLive(false);}
  updateLive(restore=true){
    if(!this.enabled||this.composing||!this.liveBlocks||this.updatingLive)return;
    this.updatingLive=true;const source=this.input.value,win=this.doc.defaultView,scroll=win.scrollY;
    const before=this.caretRect();let changed=false;
    const start=this.selection?Math.min(this.selection.anchor,this.selection.focus):null,end=this.selection?Math.max(this.selection.anchor,this.selection.focus):null;
    const activeNotes=this.selection?this.notes.filter(([a,b])=>start<=b&&end>=a):[];
    for(const block of this.liveBlocks){
      const {rawStart:a,rawEnd:b}=block.rec;
      const key=JSON.stringify([this.getShowNotes(),this.live(),this.pendingLine,start!==null&&start<=b&&end>=a?[Math.max(a,start),Math.min(b,end)]:null,activeNotes.filter(([x,y])=>x<=b&&y>=a)]);
      if(block.visibilityKey===key)continue;block.visibilityKey=key;
      const runs=projectBlock(block,source,this.selection,this.notes,{live:this.live(),showNotes:this.getShowNotes(),pendingLine:this.pendingLine});
      changed=paintBlock(this.doc,block,runs)||changed;
      block.el.classList.toggle('preview-hidden-slot',!!block.hidden&&!runs.some(r=>r.classes.includes('preview-note')));
    }
    if(changed||this.rebuildMaps){
      this.rebuildMaps=false;
      this.points=[];this.spans=[];this.nodeMaps=new WeakMap();
      for(const block of this.liveBlocks){
        if(block.el.classList.contains('preview-hidden-slot'))continue;
        const nodes=[...block.el.children];for(let i=0;i<nodes.length;i++){
          const node=nodes[i].firstChild,run=block.runs[i];if(!node||run.classes==='preview-number')continue;this.nodeMaps.set(node,run.map);
          for(let j=0;j<run.map.length;j++){const [a,b]=run.map[j];this.points.push({node,offset:j,pos:a},{node,offset:j+1,pos:b});if(a!==b)this.spans.push([a,b]);}
        }
      }
      if(!this.points.length){
        const el=this.doc.createElement('p');el.className='preview-slot';el.dataset.insertion=source.length;el.textContent='​';this.main.append(el);
        this.nodeMaps.set(el.firstChild,[[source.length,source.length]]);this.points.push({node:el.firstChild,offset:0,pos:source.length});
      }
      if(restore&&this.selection){this.restoreSelection(false);const after=this.caretRect();if(before?.height&&after?.height&&before.top>=0&&before.bottom<=win.innerHeight)win.scrollTo(0,Math.max(0,scroll+after.top-before.top));else this.revealCaret();}
    }
    this.updatingLive=false;
  }
  caretRect(){const s=this.doc.getSelection();if(!s?.focusNode||!this.main.contains(s.focusNode))return null;const range=this.doc.createRange();range.setStart(s.focusNode,s.focusOffset);range.collapse(true);return range.getBoundingClientRect?.();}
  revealCaret(){const rect=this.caretRect(),win=this.doc.defaultView;if(rect?.height){if(rect.top<12)win.scrollBy(0,rect.top-12);else if(rect.bottom>win.innerHeight-12)win.scrollBy(0,rect.bottom-win.innerHeight+12);}}
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
  restoreSelection(reveal=true){
    if(!this.selection||!this.points.length)return;
    const backwards=this.selection.focus<this.selection.anchor;
    const outside=pos=>{const note=this.hiddenRanges().find(([a,b])=>pos>a&&pos<b);return note?note[backwards?0:1]:pos;};
    this.selection={anchor:outside(this.selection.anchor),focus:outside(this.selection.focus)};
    const nearest=pos=>this.points.reduce((a,b)=>Math.abs(b.pos-pos)<Math.abs(a.pos-pos)?b:a);
    const a=nearest(this.selection.anchor),f=nearest(this.selection.focus);this.main.focus({preventScroll:true});this.doc.getSelection().setBaseAndExtent(a.node,a.offset,f.node,f.offset);
    this.lastRestored={a,f,selection:{...this.selection}};
    if(reveal){this.revealCaret();this.onSelection({...this.selection},this.getSnapshot()?.version);}
  }
  insert(text,type='insertText',selection=this.readSelection()||this.selection,version=this.getSnapshot()?.version){
    if(!selection)return;let a=this.edits.map(Math.min(selection.anchor,selection.focus),version),b=this.edits.map(Math.max(selection.anchor,selection.focus),version);
    if(a===null||b===null){this.keepDraft(text);this.refresh();return;}
    const pairs=[...this.getSnapshot().records.values()].flatMap(r=>r.formatPairs||[]);
    if(!this.live()&&a===b&&text.includes('\n')){let next;do{next=pairs.find(p=>p.close[0]===a);if(next)a=b=next.close[1];}while(next);}
    if(a===b&&type.startsWith('delete')){
      const backward=type.includes('Backward'),pos=this.skipHidden(a,backward);
      const spans=this.spans.filter(s=>backward?s[1]<=pos:s[0]>=pos).sort((x,y)=>x[0]-y[0]),adjacent=backward?spans.at(-1):spans[0];
      const gap=adjacent?this.input.value.slice(backward?adjacent[1]:pos,backward?pos:adjacent[0]):'';
      if(!this.live()&&adjacent&&!gap.includes('\n'))[a,b]=deletionRange(this.input.value,backward?adjacent[1]:adjacent[0],backward);
      else [a,b]=deletionRange(this.input.value,pos,backward);
    }
    const result=replaceVisible(this.input.value,a,b,text,this.live()?[]:pairs,this.hiddenRanges());if(!result){this.notify('숨김 메모는 원본 화면에서 수정해 주세요.');this.refresh();return;}
    this.input.setSelectionRange(a,b);this.remember();
    const lineStart=result.text.lastIndexOf('\n',Math.max(0,result.start-1))+1;
    if(text.includes('\n'))this.pendingLine=null;else if(!this.live()&&a===lineStart&&/^[.@>#=~!]/.test(text))this.pendingLine=lineStart;
    this.apply(result.text,result.start,result.end,type,true);this.selection={anchor:this.input.selectionStart,focus:this.input.selectionEnd};this.refresh();
  }
  syncComposition(text){
    const s=this.compositionSelection;if(!s||this.edits.version!==this.compositionVersion)return;
    const result=replaceVisible(this.compositionSource,Math.min(s.anchor,s.focus),Math.max(s.anchor,s.focus),text,[],noteRanges(this.compositionSource).filter(([a])=>this.compositionSource.startsWith('[[',a)?!this.getShowNotes():!this.live()));
    if(!result)return;
    this.compositionDraft=result.text;
    this.onComposition(result.text,result.start,result.end);
  }
  endComposition(text){
    if(!this.composing)return;this.composing=false;
    const s=this.compositionSelection;this.compositionSelection=null;
    if(!s)return;
    if(this.edits.version!==this.compositionVersion){this.keepDraft(text);this.refresh();return;}
    this.input.value=this.compositionSource;this.selection=s;
    this.onComposition(this.compositionSource,s.anchor,s.focus);
    if(text)this.insert(text,'composition',s,this.compositionVersion);
    else this.refresh();
  }
  beforeInput(e){
    if(!this.isEditing()||!this.main.contains(e.target)||this.composing||e.isComposing)return;
    e.preventDefault();const type=e.inputType;
    if(type==='historyUndo'||type==='historyRedo'){this.history(type==='historyUndo'?-1:1);return;}
    if(type==='insertParagraph'||type==='insertLineBreak'){this.insert('\n',type);return;}
    if(type.startsWith('delete')){this.insert('',type);return;}
    if(type.startsWith('insert')&&e.data!==null){const r=type==='insertReplacementText'?e.getTargetRanges?.()[0]:null;let selection;if(r){const a=this.boundary(r.startContainer,r.startOffset),b=this.boundary(r.endContainer,r.endOffset);if(a!==null&&b!==null)selection={anchor:a,focus:b};}this.insert(e.data,type,selection||this.readSelection()||this.selection);return;}
    if(type.startsWith('format'))this.mark({formatBold:'**',formatItalic:'*',formatUnderline:'_'}[type]);
  }
  history(delta){this.undo(delta);this.selection=this.isEditing()?{anchor:this.input.selectionStart,focus:this.input.selectionEnd}:null;this.refresh();}
  mark(marker){
    if(!marker)return;
    const s=this.readSelection()||this.selection;if(!s)return;const a=Math.min(s.anchor,s.focus),b=Math.max(s.anchor,s.focus);
    this.input.setSelectionRange(a,b);this.remember();const result=toggleMarkup(this.input.value,a,b,marker);this.apply(result.text,result.start,result.end,'markup',false);this.selection={anchor:result.start,focus:result.end};this.refresh();
  }
  key(e){
    if(this.composing||e.isComposing)return;const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
    if(mod&&key==='s'){e.preventDefault();this.save(e.shiftKey);return;}
    if(!this.enabled)return;
    if(['arrowleft','arrowright','arrowup','arrowdown','home','end'].includes(key))this.lastRestored=null;
    if(this.live()&&this.main.contains(e.target)&&!e.altKey){
      const s=this.readSelection()||this.selection;
      if(s&&((!mod&&['arrowleft','arrowright'].includes(key))||(mod&&['home','end'].includes(key)))){
        e.preventDefault();const backward=key==='arrowleft'||key==='home';
        let pos=mod?(backward?0:this.input.value.length):!e.shiftKey&&s.anchor!==s.focus?(backward?Math.min(s.anchor,s.focus):Math.max(s.anchor,s.focus)):deletionRange(this.input.value,s.focus,backward)[backward?0:1];
        pos=this.skipHidden(pos,backward);this.selection={anchor:e.shiftKey?s.anchor:pos,focus:pos};this.updateLive(false);this.restoreSelection();return;
      }
    }
    if(mod&&key==='a'&&this.isEditing()&&this.main.contains(e.target)){e.preventDefault();this.selection={anchor:0,focus:this.input.value.length};this.restoreSelection();return;}
    if(mod&&key==='enter'){e.preventDefault();this.finish();return;}
    if(mod&&['z','y'].includes(key)){e.preventDefault();this.history(key==='y'||e.shiftKey?1:-1);return;}
    if(mod&&['b','i','u'].includes(key)){e.preventDefault();this.mark({b:'**',i:'*',u:'_'}[key]);}
  }
  paste(e){
    if(!this.enabled||this.composing)return;const text=clipboardFountain(e.clipboardData.getData('text/plain'),e.clipboardData.getData('text/html'));
    if(this.isEditing()){e.preventDefault();this.insert(text,'insertFromPaste');}
  }
  cut(e){if(!this.isEditing())return;const s=this.doc.getSelection();if(s?.isCollapsed)return;e.preventDefault();e.clipboardData.setData('text/plain',s.toString());this.insert('','deleteByCut');}
  keepDraft(text){
    this.notify('원고 위치가 바뀌었습니다. 아래 보관된 입력을 복사해 다시 반영해 주세요.');
    if(!text)return;let field=this.doc.querySelector('#preview-unapplied');if(!field){field=this.doc.createElement('textarea');field.id='preview-unapplied';field.className='preview-raw';field.setAttribute('aria-label','반영하지 못한 입력 보관');this.main.after(field);}field.value+=text;
  }
}
