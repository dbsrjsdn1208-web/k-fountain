import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/700.css';
import './style.css';
import {DEFAULT_SETTINGS,escapeHTML as esc,parseScreenplay,renderPreview,previewCSS,exportReadableText} from './screenplay.js';
import {cleanNames,normalizeText,normalizeNewlines,mapSelection,toggleMarkup,clipboardFountain,migrateLegacy} from './text-tools.js';
import {FileSession,handleDB} from './file-store.js';
import {SourceEdits,installPreviewNavigation,revealCaret,sourceViewportAnchor,previewViewportAnchor,placeSourceAnchor,placePreviewAnchor} from './preview-navigation.js';
import {PreviewEditor,editorCSS} from './preview-editor.js';
import {installViewControls} from './view-controls.js';
import {installSceneOutline,installToolbarMenus} from './workspace-ui.js';
import {printDocument} from './print-document.js';

const STORAGE='k-fountain.document.v2',LEGACY='jangmyeon.document.v1';
const SAMPLE='.기차역, 플랫폼 / 새벽\n\n첫 기차의 안내 방송이 흐른다.\n\n@민서 (작게)\n이번에는 **정말** 가는 거야.\n\n@도윤\n돌아와도 돼.\n\n.기차 안 / 아침\n\n_돌아오는 길은 언제나 여기 있을 테니까._';
function validate(value){
  if(value?.version===1)value=migrateLegacy(value);
  if(value?.version!==2||typeof value.text!=='string'||!Array.isArray(value.names))throw Error('읽을 수 없는 원고입니다.');
  const settings={...DEFAULT_SETTINGS,...value.settings,hashScenes:false,sNumberScenes:false,numericScenes:false,numbering:'n'};
  settings.font=String(settings.font||DEFAULT_SETTINGS.font).slice(0,150);
  settings.size=[10,11,12,13,14].includes(+settings.size)?+settings.size:12;
  settings.numberMode=settings.numberMode==='source'?'source':'output';
  settings.continuationLanguage=settings.continuationLanguage==='ko'?'ko':'en';
  settings.previewEditMode=settings.previewEditMode==='full'?'full':'source';
  if(!['default','cjk','dark','ocean','colorful'].includes(settings.theme))settings.theme='default';
  if(!['S#n.','S#n','n.','n'].includes(settings.txtNumbering))settings.txtNumbering='S#n.';
  return {version:2,text:normalizeNewlines(value.text),title:String(value.title||'제목 없는 시나리오').slice(0,150),names:cleanNames(value.names.join('\n')),settings};
}
let state={version:2,text:SAMPLE,title:'제목 없는 시나리오',names:['민서','도윤'],settings:{...DEFAULT_SETTINGS}};
let recovered=false,recoveryProblem=false;
try{const saved=localStorage.getItem(STORAGE)||localStorage.getItem(LEGACY);if(saved){state=validate(JSON.parse(saved));recovered=true;}}catch{recoveryProblem=true;}
const $=s=>document.querySelector(s),files=new FileSession();
let elements,framePending=0,composing=false,dirty=false,previewText=null,previewKey='',toastTimer,recoveryTimer,revision=0;
let history=[],historyIndex=-1,lastEditTime=0,lastEditType='',installPrompt;
let previewEditor,viewControls,sceneOutline,outlineVersion,lastPane='source',lastPreviewSelection=null,followFrame=0;
let viewedPane='source',switchingWorkspace=false;
document.querySelector('#app').innerHTML=`
<header id="header-panel"><div class="title">K-파운틴</div><button id="install" hidden>앱 설치</button></header>
<div id="top-panel">
  <div class="file-tools">
    <button id="scenes" aria-expanded="false" aria-controls="scene-panel">장면</button>
    <div class="toolbar-group">
      <button id="file-menu-button" data-toolbar-menu aria-expanded="false" aria-controls="file-menu">파일</button>
      <div id="file-menu" class="toolbar-menu toolbar-menu-start" role="group" aria-label="파일 작업" hidden>
        <button id="new" data-menu-command>새 문서</button>
        <button id="open" data-menu-command>열기</button>
        <button id="save-as" data-menu-command>다른 이름으로 저장 <kbd>Ctrl+Shift+S</kbd></button>
      </div>
    </div>
    <input id="title" aria-label="파일 이름" value="${esc(state.title)}">
    <button id="save" title="Ctrl+S">저장</button>
  </div>
  <div id="writing-modes" role="group" aria-label="작성 화면">
    <button id="mode-source" aria-pressed="false">원본</button>
    <button id="mode-live" aria-pressed="false">라이브 미리보기</button>
    <button id="mode-split" aria-pressed="true">나란히</button>
  </div>
  <div class="output-tools">
    <button id="preview-edit" aria-pressed="false">미리보기 편집</button>
    <div class="toolbar-group">
      <button id="export-menu-button" data-toolbar-menu aria-expanded="false" aria-controls="export-menu">내보내기</button>
      <div id="export-menu" class="toolbar-menu" role="group" aria-label="내보내기 형식" hidden>
        <button id="pdf" data-menu-command>PDF / 인쇄</button>
        <button id="docx" data-menu-command>Word 문서 (.docx)</button>
        <button id="txt" data-menu-command>읽기용 텍스트 (.txt)</button>
      </div>
    </div>
    <div class="toolbar-group">
      <button id="view" data-toolbar-menu aria-expanded="false" aria-controls="view-menu">보기</button>
      <div id="view-menu" class="toolbar-menu" role="group" aria-label="화면 배치" hidden>
        <button id="mode-reading" aria-pressed="false" data-menu-command>읽기 미리보기</button>
        <label for="source-size">원본 글자 크기 <input id="source-size" type="number" min="10" max="40" step="1"> px</label>
        <small>원본에서 Ctrl+휠로 조절</small>
        <button id="view-reset">화면 배치 초기화</button>
      </div>
    </div>
    <button id="settings">설정</button>
  </div>
</div>
<div id="workspace">
  <aside id="scene-panel" aria-labelledby="scene-heading" hidden>
    <div class="scene-panel-heading"><h2 id="scene-heading">장면 목록</h2><button id="scene-close" type="button">닫기</button></div>
    <input type="search" aria-label="장면 제목 또는 번호 찾기" placeholder="장면 찾기">
    <nav aria-label="장면 이동"><ol id="scene-list"></ol><p id="scene-empty" aria-live="polite"></p></nav>
  </aside>
  <div id="main-app"><textarea id="fountain-editor" aria-label="Fountain 원고" spellcheck="false" wrap="soft" placeholder=".장소 / 시간&#10;&#10;@인물&#10;대사"></textarea><div id="pane-divider" role="separator" tabindex="0" aria-label="원본과 미리보기 크기 조절" aria-valuemin="20" aria-valuemax="80"></div><section id="html-render"><iframe id="preview" title="대본 미리보기" sandbox="allow-same-origin allow-modals"></iframe></section></div>
</div>
<footer id="footer-panel"><span id="file-status">${recovered?'임시 원고 복원됨':'파일을 저장해 주세요'}</span><span id="recovery-status"></span><span class="credit"><a href="https://github.com/wixette/fountain2html" target="_blank" rel="noopener">fountain2html</a> · Apache-2.0</span></footer>
<input id="file-input" type="file" accept=".fountain,.txt,.json" hidden>
<dialog id="settings-dialog"><div class="dialog-heading"><h2>설정</h2><button type="button" data-close="settings-dialog" aria-label="설정 닫기">닫기</button></div><p class="hint">바꾸는 즉시 적용되며 다음 실행에도 유지됩니다.</p>
<label>미리보기 편집 방식<select id="preview-edit-mode"><option value="source">라이브 프리뷰 — 옵시디언 방식</option><option value="full">미리보기 전체 작성</option></select></label><p class="hint">라이브 프리뷰는 대본 위에서 바로 작성하며 커서 주변의 Fountain 기호를 보여 줍니다. 방향키와 Enter로 계속 이어 쓰세요. 전체 작성은 기호를 숨긴 서식 위에서 편집합니다.</p>
<label>글꼴 이름<input id="font" type="text" maxlength="150" placeholder="예: 맑은 고딕, 나눔명조"></label><p class="hint">기기에 설치된 글꼴 이름을 입력하세요. 없는 글꼴은 기본 글꼴로 표시됩니다.</p>
<div class="setting-row"><label>글자 크기<select id="size">${[10,11,12,13,14].map(n=>`<option value="${n}">${n} pt</option>`).join('')}</select></label><label>출력 테마<select id="theme"><option value="default">Default</option><option value="cjk">CJK</option><option value="dark">Dark</option><option value="ocean">Ocean</option><option value="colorful">Colorful</option></select></label></div>
<label>장면 번호 자동<select id="number-mode"><option value="output">출력만 갱신 — 원고 유지</option><option value="source">원고에도 반영 — #1#, #2#</option><option value="off">끄기 — 직접 쓴 번호 유지</option></select></label><p class="hint">장면은 .장소 또는 INT. / EXT.로 시작합니다. #는 Fountain의 섹션 기호입니다. 원고 반영을 끄더라도 이미 쓴 번호는 지워지지 않습니다.</p>
<label class="check"><input id="auto-characters" type="checkbox">등록된 인물명에 @ 자동 추가</label><label>등록 인물<textarea id="names" rows="5" placeholder="한 줄에 한 명씩&#10;민서&#10;(인물)"></textarea></label><p class="hint">민서 (전화), (민서), (인물), 동시 대사 ^를 지원합니다. 지문과 대사 중 지시문은 그대로 둡니다.</p>
<label class="check"><input id="bold-characters" type="checkbox">인물명 굵게 출력</label><label class="check"><input id="show-notes" type="checkbox">미리보기에 [[메모]] 표시</label><p class="hint">인쇄·PDF·DOCX·읽기용 TXT에는 항상 제외합니다. 숨긴 메모는 원본에서 수정하세요.</p><label class="check"><input id="follow" type="checkbox">양쪽 화면이 작성 위치 따라가기</label><label class="check"><input id="hide-outline" type="checkbox">출력에서 섹션·시놉시스 숨기기</label>
<label>PDF 대사 계속 표기<select id="continuation-language"><option value="en">영문 (MORE) / (CONT'D)</option><option value="ko">한글 (계속) / (이어서)</option></select></label><p class="hint">페이지를 넘겨 이어지는 대사에 자동으로 넣습니다.</p>
<details><summary>사용 방법</summary><p>.장소 / 시간 → 장면<br>@인물 (전화) → 인물명<br>(작게) → 대사 지시문<br>두 번째 인물명 뒤 ^ → 동시 대사<br>=== → 페이지 나누기<br>**굵게** · *기울임* · _밑줄_<br>Ctrl+S → 같은 파일에 저장<br>Ctrl+Shift+S → 다른 이름으로 저장</p><p>구글 독스에서 붙여넣은 강조는 Fountain 기호로 바뀝니다. PDF는 인쇄 창에서 PDF 저장을 선택하세요. DOCX는 구글 독스에서 열어 편집할 수 있습니다.</p><p id="save-support"></p></details></dialog>
<dialog id="txt-dialog"><div class="dialog-heading"><h2>TXT 내보내기</h2><button data-close="txt-dialog">닫기</button></div><label>장면 번호 표시<select id="txt-numbering"><option value="S#n.">S#1. 장소</option><option value="S#n">S#1 장소</option><option value="n.">1. 장소</option><option value="n">1 장소</option></select></label><p class="hint">Fountain 기호를 뺀 읽기용 대본입니다. 원본 파일은 변경하지 않습니다.</p><button id="export-txt">TXT 저장</button></dialog>
<dialog id="replace-dialog"><h2>현재 원고를 닫을까요?</h2><p>파일에 저장하지 않은 변경 내용이 있습니다.</p><div class="dialog-actions"><button data-decision="cancel">취소</button><button data-decision="discard">저장하지 않고 계속</button><button data-decision="save">저장 후 계속</button></div></dialog>`;
const input=$('#fountain-editor'),frame=$('#preview');input.value=state.text;
const sourceEdits=new SourceEdits(input.value);
let navigationSnapshot=null,suppressFollow=false;
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),5000);}
function preserveRecovery(entry){
  const key='k-fountain.history.v1';let saved;
  try{saved=JSON.parse(localStorage.getItem(key)||'[]');if(!Array.isArray(saved))throw Error();}
  catch{throw Error('복구 기록을 읽을 수 없어 안전을 위해 저장을 중단했습니다.');}
  if(saved.at(-1)?.text===entry.text&&saved.at(-1)?.title===entry.title)return;
  saved.push({...entry,at:new Date().toISOString()});saved=saved.slice(-30);
  for(;;){try{localStorage.setItem(key,JSON.stringify(saved));return;}catch{if(saved.length<=1)throw Error('덮어쓰기 전 복구본을 보관할 공간이 없습니다. 다른 이름으로 저장해 주세요.');saved.shift();}}
}
files.beforeWrite=preserveRecovery;
function snapshot(){return {text:input.value,start:input.selectionStart,end:input.selectionEnd};}
function resetHistory(){history=[snapshot()];historyIndex=0;lastEditTime=0;}
function record(type='command'){
  const next=snapshot(),now=Date.now();if(history[historyIndex]?.text===next.text){history[historyIndex]=next;return;}
  history=history.slice(0,historyIndex+1);
  if(type===lastEditType&&['insertText','deleteContentBackward','deleteContentForward'].includes(type)&&now-lastEditTime<600&&historyIndex>0)history[historyIndex]=next;
  else{history.push(next);historyIndex++;}
  if(history.length>200){history.shift();historyIndex--;}
  lastEditTime=now;lastEditType=type;
}
function restoreHistory(delta){const next=history[historyIndex+delta];if(!next)return;historyIndex+=delta;input.value=next.text;input.setSelectionRange(next.start,next.end);lastEditTime=0;changed();}
function applyText(text,start,end=start,type='command'){const scroll=input.scrollTop;input.value=text;input.setSelectionRange(start,end);input.scrollTop=scroll;record(type);changed();}
function normalize(deferCue=false){
  if(composing)return;const previous=input.value;let next=normalizeText(previous,state.names,state.settings);
  if(deferCue){const line=previous.slice(0,input.selectionStart).split('\n').length-1,a=previous.split('\n'),b=next.split('\n');if(!a[line]?.trimStart().startsWith('@')&&b[line]?.trimStart().startsWith('@')){b[line]=b[line].replace('@','');next=b.join('\n');}}
  if(next!==previous){const [start,end]=mapSelection(previous,next,input.selectionStart,input.selectionEnd),scroll=input.scrollTop;input.value=next;input.setSelectionRange(start,end);input.scrollTop=scroll;}
}
function changed(){sourceEdits.record(input.value);state.text=input.value;revision++;dirty=files.lastSaved!==input.value;updateStatus();queueRender();queueRecovery();}
function updateStatus(){const name=files.handle?.name||state.title+'.fountain';$('#file-status').textContent=files.handle?`${name} · ${dirty?'변경됨':'파일에 저장됨'}`:files.lastSaved!==null?`${name} · ${dirty?'변경됨':'다운로드됨'}`:'파일 저장 위치 미지정';}
function queueRecovery(){clearTimeout(recoveryTimer);recoveryTimer=setTimeout(saveRecovery,350);}
function saveRecovery(){try{state.text=input.value;localStorage.setItem(STORAGE,JSON.stringify(state));$('#recovery-status').textContent='임시 복구본 보관됨';return true;}catch{$('#recovery-status').textContent='임시 복구본 저장 실패';return false;}}
function queueRender(){if(!framePending)framePending=requestAnimationFrame(()=>{framePending=0;renderNow();});}
const previewDoc=frame.contentDocument;
previewDoc.open();previewDoc.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>K-파운틴</title><style id="fonts"></style><style id="style"></style></head><body><main tabindex="-1"></main></body></html>');previewDoc.close();
const faces=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules].filter(r=>r.type===5).map(r=>r.cssText);}catch{return [];}}).join('\n');
previewDoc.querySelector('#fonts').textContent=faces;
function renderNow(){
  if(previewEditor?.busy())return;
  const key=JSON.stringify([state.names,state.settings]);
  if(input.value!==previewText||key!==previewKey){
    elements=parseScreenplay(input.value,state.names,state.settings);
    const scroll=frame.contentWindow.scrollY,html=renderPreview(elements,{showNotes:state.settings.showNotes}),main=previewDoc.querySelector('main');
    if(main.innerHTML!==html)main.innerHTML=html;
    navigationSnapshot={records:elements.navigation,version:sourceEdits.version};
    if(key!==previewKey){previewDoc.querySelector('#style').textContent=previewCSS(state.settings)+editorCSS;input.style.fontFamily=`${JSON.stringify(state.settings.font)},"Noto Serif KR",serif`;}
    frame.contentWindow.scrollTo(0,scroll);previewEditor?.decorate();previewText=input.value;previewKey=key;
    outlineVersion=sourceEdits.version;
    const entries=elements.model.tokens.filter(token=>token.type==='scene_heading').map(token=>({
      pos:token.rawStart, title:elements[token.sourceLine]?.displayText||token.text,
      label:elements[token.sourceLine]?.label||'',
    }));
    sceneOutline.update(entries,input.selectionEnd);
  }followCaret();
}
function followCaret(){
  if(!elements||composing||suppressFollow||!state.settings.follow||frame.parentElement.hidden||document.activeElement!==input)return;
  const line=input.value.slice(0,input.selectionEnd).split('\n').length-1;
  const source=elements[line]?.previewSource??line,target=previewDoc.querySelector(`[data-source="${source}"]`);
  if(!target||!state.settings.follow)return;
  let rect=target.getBoundingClientRect();const breaks=target.querySelectorAll('br'),relative=line-source;
  if(relative>0&&breaks[relative-1]){const range=previewDoc.createRange();range.selectNodeContents(target);range.setStartAfter(breaks[relative-1]);if(breaks[relative])range.setEndBefore(breaks[relative]);const rs=range.getClientRects();if(rs.length)rect=rs[0];}
  if(target.matches('.action,.dialogue')){
    const rawLine=input.value.slice(0,input.selectionEnd).split('\n').at(-1);
    let remaining=rawLine.replace(/\[\[.*?\]\]/g,'').replace(/(?<!\\)[*_]/g,'').replace(/\\([*_])/g,'$1').length,physicalLine=0,found=false;
    const walker=previewDoc.createTreeWalker(target,5);let node;
    while((node=walker.nextNode())&&!found){
      if(node.nodeType===1&&node.tagName==='BR'){physicalLine++;continue;}
      if(node.nodeType!==3||physicalLine!==relative)continue;
      if(remaining<=node.length){const range=previewDoc.createRange(),at=Math.max(0,remaining-1);range.setStart(node,at);range.setEnd(node,Math.min(node.length,at+1));const r=range.getBoundingClientRect();if(r.height)rect=r;found=true;}else remaining-=node.length;
    }
  }
  if(rect.top<20||rect.bottom>frame.clientHeight-20)frame.contentWindow.scrollBy(0,rect.top-frame.clientHeight*.35);
}
function previewSelection(selection,version){
  if(!selection)return;
  const anchor=sourceEdits.map(selection.anchor,version),focus=sourceEdits.map(selection.focus,version);
  if(anchor===null||focus===null)return;
  lastPreviewSelection={anchor,focus,version:sourceEdits.version};lastPane=viewedPane='preview';
  input.setSelectionRange(Math.min(anchor,focus),Math.max(anchor,focus),focus<anchor?'backward':'forward');
  sceneOutline.locate(focus);
  if(followFrame||switchingWorkspace)return;
  followFrame=requestAnimationFrame(()=>{
    followFrame=0;if(lastPane!=='preview'||!lastPreviewSelection||previewEditor.busy()||!state.settings.follow||input.hidden)return;
    const pos=sourceEdits.map(lastPreviewSelection.focus,lastPreviewSelection.version);if(pos===null)return;
    suppressFollow=true;revealCaret(input,pos);
  });
}
function restoreWorkFocus(){
  if(!frame.parentElement.hidden&&(lastPane==='preview'||input.hidden)){
    const fromSource=lastPane==='source';
    lastPane='preview';
    if(previewEditor.enabled&&fromSource){focusPreviewAtSource();return;}
    if(previewEditor.enabled&&lastPreviewSelection){
      const anchor=sourceEdits.map(lastPreviewSelection.anchor,lastPreviewSelection.version),focus=sourceEdits.map(lastPreviewSelection.focus,lastPreviewSelection.version);
      if(anchor!==null&&focus!==null){previewEditor.selection={anchor,focus};previewEditor.updateLive(false);previewEditor.restoreSelection();return;}
    }
    previewDoc.querySelector('main').focus({preventScroll:true});
  }else if(!input.hidden)input.focus({preventScroll:true});
}
function sourceSelection(){
  const {selectionStart:start,selectionEnd:end,selectionDirection}=input;
  return selectionDirection==='backward'?{anchor:end,focus:start}:{anchor:start,focus:end};
}
function focusPreviewAtSource(){
  previewEditor.selection=sourceSelection();
  previewEditor.updateLive(false);
  previewEditor.restoreSelection();
}
function layoutChanged(){
  updateWorkspaceButtons();
  if(switchingWorkspace)return;
  requestAnimationFrame(()=>{
    if(composing||previewEditor.busy())return;
    if(input.hidden&&document.activeElement===input){lastPane='preview';restoreWorkFocus();}
    else if(frame.parentElement.hidden&&document.activeElement===frame){lastPane='source';restoreWorkFocus();}
    if(state.settings.follow){
      if(lastPane==='preview'&&lastPreviewSelection&&!input.hidden){const pos=sourceEdits.map(lastPreviewSelection.focus,lastPreviewSelection.version);if(pos!==null)revealCaret(input,pos);}
      else if(lastPane==='source'){revealCaret(input,input.selectionEnd);followCaret();}
    }
    if(!frame.parentElement.hidden&&lastPane==='preview'&&previewEditor.enabled)previewEditor.revealCaret();
  });
}
previewEditor=new PreviewEditor({doc:previewDoc,input,edits:sourceEdits,getSnapshot:()=>navigationSnapshot,getMode:()=>input.hidden?'source':state.settings.previewEditMode||'source',getShowNotes:()=>state.settings.showNotes===true,onSelection:previewSelection,
  apply:(text,start,end,type,auto)=>{suppressFollow=true;input.value=text;input.setSelectionRange(start,end);if(auto)normalize(true);record(type);changed();},
  remember:()=>{if(history[historyIndex]?.text===input.value)history[historyIndex]=snapshot();},undo:restoreHistory,
  refresh:()=>{previewText=null;renderNow();},notify:toast,save:saveFile});
function jumpToScene(scene){
  const pos=sourceEdits.map(scene.pos,outlineVersion);
  if(pos===null){renderNow();return;}
  renderNow();
  const target=[...previewDoc.querySelectorAll('.screen-heading[data-token]')].find(heading=>navigationSnapshot.records.get(heading.dataset.token)?.rawStart===pos);
  input.setSelectionRange(pos,pos);
  suppressFollow=true;
  if(!input.hidden)revealCaret(input,pos);
  if(lastPane==='preview'&&previewEditor.enabled&&!frame.parentElement.hidden){
    previewEditor.selection={anchor:pos,focus:pos};
    previewEditor.updateLive(false);
    previewEditor.restoreSelection();
  }else if(!input.hidden)input.focus({preventScroll:true});
  else previewDoc.querySelector('main').focus({preventScroll:true});
  if(!frame.parentElement.hidden)target?.scrollIntoView?.({block:'nearest'});
  sceneOutline.locate(pos);
}
function updateWorkspaceButtons(){
  const singlePreview=input.hidden,sourceOnly=frame.parentElement.hidden,editing=previewEditor.enabled;
  $('#mode-source').setAttribute('aria-pressed',String(sourceOnly));
  $('#mode-live').setAttribute('aria-pressed',String(singlePreview&&editing));
  $('#mode-split').setAttribute('aria-pressed',String(!singlePreview&&!sourceOnly));
  $('#mode-reading').setAttribute('aria-pressed',String(singlePreview&&!editing));
  $('#preview-edit').setAttribute('aria-pressed',String(editing&&!sourceOnly));
}
function switchWorkspace(layout,editing,pane,origin=viewedPane){
  if(composing||previewEditor.busy()){toast('한글 입력을 마친 뒤 화면을 바꿔 주세요.');return;}
  switchingWorkspace=true;suppressFollow=true;
  try{
    if(followFrame){cancelAnimationFrame(followFrame);followFrame=0;}
    renderNow();
    const selection=sourceSelection();
    const records=navigationSnapshot.records;
    const readPreview=!frame.parentElement.hidden&&(input.hidden||origin==='preview');
    const preferred=previewEditor.enabled?previewEditor.readSelection():!input.hidden&&viewedPane==='source'?selection:null;
    const anchor=(readPreview?previewViewportAnchor(previewDoc,records,previewEditor,preferred):null)||
      (!input.hidden&&sourceViewportAnchor(input,selection))||{...selection,ratio:null};
    lastEditTime=0;
    viewControls.selectLayout(layout);
    if(editing||previewEditor.enabled)previewEditor.toggle(editing);
    input.setSelectionRange(Math.min(anchor.anchor,anchor.focus),Math.max(anchor.anchor,anchor.focus),anchor.focus<anchor.anchor?'backward':'forward');
    if(!input.hidden)placeSourceAnchor(input,anchor.focus,anchor.ratio);
    if(pane==='preview'&&!frame.parentElement.hidden){
      lastPane=viewedPane='preview';
      if(editing){
        previewEditor.selection={anchor:anchor.anchor,focus:anchor.focus};
        previewEditor.updateLive(false);
        previewEditor.restoreSelection(false);
        previewSelection(previewEditor.selection,navigationSnapshot.version);
      }else previewDoc.querySelector('main').focus({preventScroll:true});
    }else if(!input.hidden)input.focus({preventScroll:true});
    if(!frame.parentElement.hidden)placePreviewAnchor(previewDoc,navigationSnapshot.records,previewEditor,anchor.focus,anchor.ratio);
    sceneOutline.locate(anchor.focus);
    updateWorkspaceButtons();
  }finally{switchingWorkspace=false;}
}
$('#mode-source').onclick=()=>switchWorkspace('source',false,'source');
$('#mode-live').onclick=()=>switchWorkspace('preview',true,'preview');
$('#mode-reading').onclick=()=>switchWorkspace('preview',false,'preview');
$('#mode-split').onclick=()=>switchWorkspace('split',previewEditor.enabled,previewEditor.enabled&&viewedPane==='preview'?'preview':'source');
$('#preview-edit').onclick=()=>switchWorkspace(input.hidden?'preview':'split',!previewEditor.enabled,'preview',frame.parentElement.hidden?'source':'preview');
input.addEventListener('focus',()=>{lastPane=viewedPane='source';previewEditor.clearSelection();});
for(const type of ['pointerdown','wheel','touchmove']){
  input.addEventListener(type,()=>{viewedPane='source';},{passive:true});
  previewDoc.addEventListener(type,()=>{viewedPane='preview';},{passive:true});
}
installPreviewNavigation({doc:previewDoc,input,edits:sourceEdits,getSnapshot:()=>navigationSnapshot,isComposing:()=>composing||previewEditor.enabled||input.hidden,onNavigate:()=>{suppressFollow=true;}});
input.addEventListener('beforeinput',event=>{
  suppressFollow=false;
  if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){event.preventDefault();restoreHistory(event.inputType==='historyUndo'?-1:1);return;}
  if(history[historyIndex]?.text===input.value)history[historyIndex]=snapshot();
});
input.addEventListener('input',event=>{if(!composing&&!event.isComposing){normalize(true);record(event.inputType||'input');}changed();});
input.addEventListener('compositionstart',()=>{composing=true;});
input.addEventListener('compositionend',()=>{composing=false;normalize(true);record('composition');changed();});
// Do not rewrite the source on blur: selecting text in the preview is read-only.
input.addEventListener('paste',event=>{
  if(composing)return;event.preventDefault();const value=clipboardFountain(event.clipboardData.getData('text/plain'),event.clipboardData.getData('text/html'));
  input.setRangeText(value,input.selectionStart,input.selectionEnd,'end');normalize();record('paste');changed();
});
input.addEventListener('keydown',event=>{
  suppressFollow=false;
  if(composing||event.isComposing)return;const key=event.key.toLowerCase();
  if((event.ctrlKey||event.metaKey)&&['b','i','u'].includes(key)){event.preventDefault();history[historyIndex]=snapshot();const edit=toggleMarkup(input.value,input.selectionStart,input.selectionEnd,{b:'**',i:'*',u:'_'}[key]);applyText(edit.text,edit.start,edit.end);return;}
  if((event.ctrlKey||event.metaKey)&&(key==='z'||key==='y')){event.preventDefault();restoreHistory(key==='y'||event.shiftKey?1:-1);}
});
const sourcePositionChanged=()=>{sceneOutline.locate(input.selectionEnd);followCaret();};
input.addEventListener('keyup',sourcePositionChanged);input.addEventListener('click',()=>{suppressFollow=false;sourcePositionChanged();});input.addEventListener('select',sourcePositionChanged);
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&!composing){event.preventDefault();saveFile(event.shiftKey);}});
function filename(){return (state.title.trim()||'제목 없는 시나리오').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.fountain$/i,'');}
function download(data,name,type='text/plain;charset=utf-8'){const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function saveFile(as=false){
  if(files.busy){toast('저장이 진행 중입니다. 완료 후 다시 시도해 주세요.');return false;}
  if(!previewEditor.finish())return false;
  if(composing){toast('한글 입력을 마친 뒤 저장해 주세요.');return false;}
  normalize();record('normalize');changed();const text=input.value;
  try{
    if(files.supported){await files.save(text,filename()+'.fountain',as||!!files.handle&&state.title!==files.handle.name.replace(/\.fountain$/i,''));state.title=files.handle.name.replace(/\.fountain$/i,'');$('#title').value=state.title;handleDB('put',files.handle).catch(()=>{});}
    else{download(text,filename()+'.fountain');files.lastSaved=text;toast('다운로드했습니다. 같은 파일 덮어쓰기는 Chrome·Edge에서 지원됩니다.');}
    dirty=input.value!==files.lastSaved;updateStatus();saveRecovery();return true;
  }catch(error){if(error.name!=='AbortError')toast('저장하지 못했습니다. '+error.message);return false;}
}
async function confirmReplace(){
  if(files.busy){toast('저장이 진행 중입니다. 완료 후 문서를 바꿔 주세요.');return false;}
  if(!previewEditor.finish())return false;
  if(!dirty&&files.lastSaved!==null)return true;
  const dialog=$('#replace-dialog');dialog.returnValue='cancel';dialog.showModal();
  const decision=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
  return decision==='discard'||decision==='save'&&await saveFile();
}
document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>$('#replace-dialog').close(b.dataset.decision));
function setDocument(next,handle=null,saved=null){if(files.busy)throw Error('저장이 진행 중입니다. 완료 후 문서를 바꿔 주세요.');const validated=validate(next);if(input.value)preserveRecovery({title:state.title,text:input.value});state=validated;input.value=state.text;sourceEdits.reset(input.value);lastPreviewSelection=null;navigationSnapshot=null;suppressFollow=false;files.handle=handle;files.lastSaved=saved;dirty=saved!==input.value;$('#title').value=state.title;resetHistory();previewText=null;syncSettings();changed();input.scrollTop=0;frame.contentWindow.scrollTo(0,0);if(handle)handleDB('put',handle).catch(()=>{});else handleDB('delete').catch(()=>{});}
async function load(file,text,handle=null){
  if(file.size>10*1024*1024)throw Error('10MB 이하의 파일을 선택해 주세요.');
  const next=/\.json$/i.test(file.name)?validate(JSON.parse(text)):{...state,text:normalizeNewlines(text),title:file.name.replace(/\.[^.]+$/,'')};
  if(await confirmReplace())setDocument(next,handle,handle?normalizeNewlines(text):null);
}
$('#open').onclick=async()=>{try{if(window.showOpenFilePicker){const picked=await files.open();await load(picked.file,picked.text,picked.handle);}else $('#file-input').click();}catch(e){if(e.name!=='AbortError')toast(e.message);}};
$('#file-input').onchange=async event=>{try{const file=event.target.files[0];if(file)await load(file,await file.text());}catch(e){toast(e.message);}event.target.value='';};
input.addEventListener('dragover',e=>e.preventDefault());
input.addEventListener('drop',async e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();try{const file=e.dataTransfer.files[0];await load(file,await file.text());}catch(error){toast(error.message);}});
$('#new').onclick=async()=>{try{if(await confirmReplace()){setDocument({...state,text:'',title:'제목 없는 시나리오'});input.focus();}}catch(e){toast(e.message);}};
$('#save').onclick=()=>saveFile();$('#save-as').onclick=()=>saveFile(true);
$('#title').oninput=e=>{state.title=e.target.value;updateStatus();queueRecovery();};
function syncSettings(){
  $('#preview-edit-mode').value=state.settings.previewEditMode||'source';
  $('#continuation-language').value=state.settings.continuationLanguage||'en';
  $('#font').value=state.settings.font;$('#size').value=state.settings.size;$('#theme').value=state.settings.theme;
  $('#number-mode').value=state.settings.autoNumbers?state.settings.numberMode:'off';$('#txt-numbering').value=state.settings.txtNumbering;$('#names').value=state.names.join('\n');
  for(const [id,key]of Object.entries({'auto-characters':'autoCharacters','bold-characters':'boldCharacters',follow:'follow','hide-outline':'hideOutline','show-notes':'showNotes'}))$('#'+id).checked=state.settings[key];
}
function settingChanged(normalizeSource=false){if(normalizeSource){normalize();record('settings');}changed();}
$('#settings').onclick=()=>{syncSettings();$('#settings-dialog').showModal();};
$('#preview-edit-mode').onchange=e=>{if(!previewEditor.finish()){e.target.value=state.settings.previewEditMode||'source';return;}state.settings.previewEditMode=e.target.value;previewEditor.selection=null;settingChanged();};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#settings-dialog').addEventListener('close',restoreWorkFocus);
$('#font').oninput=e=>{state.settings.font=e.target.value.trim()||DEFAULT_SETTINGS.font;settingChanged();};
$('#size').onchange=e=>{state.settings.size=+e.target.value;settingChanged();};
$('#continuation-language').onchange=e=>{state.settings.continuationLanguage=e.target.value;queueRecovery();};
$('#theme').onchange=e=>{state.settings.theme=e.target.value;settingChanged();};
$('#number-mode').onchange=e=>{state.settings.autoNumbers=e.target.value!=='off';state.settings.numberMode=e.target.value==='source'?'source':'output';settingChanged(true);};
$('#names').oninput=e=>{state.names=cleanNames(e.target.value);settingChanged();};
$('#names').onblur=()=>settingChanged(true);
for(const [id,key]of Object.entries({'auto-characters':'autoCharacters','bold-characters':'boldCharacters',follow:'follow','hide-outline':'hideOutline','show-notes':'showNotes'}))$('#'+id).onchange=e=>{state.settings[key]=e.target.checked;settingChanged(id==='auto-characters');};
$('#save-support').textContent=files.supported?'처음에 저장 위치를 선택하면 Ctrl+S로 같은 파일에 저장합니다.':'이 브라우저는 파일 다운로드만 지원합니다. 같은 파일에 저장하려면 Chrome·Edge에서 여세요.';
async function saveExport(blob,extension){
  if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:filename()+'.'+extension,id:'k-fountain-export',types:[{description:extension.toUpperCase(),accept:{'text/plain':['.txt']}}]});const writable=await handle.createWritable();try{await writable.write(blob);await writable.close();}catch(e){try{await writable.abort();}catch{}throw e;}}
  else download(blob,filename()+'.'+extension);
}
$('#pdf').onclick=async()=>{if(!previewEditor.finish())return;try{await printDocument({doc:document,text:input.value,names:state.names,settings:state.settings,title:state.title,fonts:faces,restoreFocus:restoreWorkFocus});}catch(error){toast('인쇄 준비 실패: '+error.message);}};
$('#docx').onclick=async()=>{
  if(!previewEditor.finish())return;
  // Open the picker within the user gesture, before loading the export library.
  try{const handle=window.showSaveFilePicker?await window.showSaveFilePicker({suggestedName:filename()+'.docx',id:'k-fountain-export',types:[{description:'Word 문서',accept:{'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}}]}):null;
    renderNow();const {docxBlob}=await import('./exports.js'),blob=await docxBlob(elements,state.title,state.settings);
    if(handle){const writable=await handle.createWritable();try{await writable.write(blob);await writable.close();}catch(e){try{await writable.abort();}catch{}throw e;}}else download(blob,filename()+'.docx');toast('DOCX를 저장했습니다.');
  }catch(e){if(e.name!=='AbortError')toast('DOCX 저장 실패: '+e.message);}
};
$('#txt').onclick=()=>{$('#txt-numbering').value=state.settings.txtNumbering;$('#txt-dialog').showModal();};
$('#txt-numbering').onchange=e=>{state.settings.txtNumbering=e.target.value;queueRecovery();};
$('#export-txt').onclick=async()=>{if(!previewEditor.finish())return;try{renderNow();await saveExport(exportReadableText(elements),'txt');$('#txt-dialog').close();toast('TXT를 저장했습니다.');}catch(e){if(e.name!=='AbortError')toast(e.message);}};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install').hidden=false;});
$('#install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install').hidden=true;}};
window.addEventListener('appinstalled',()=>{$('#install').hidden=true;});
if('serviceWorker'in navigator&&location.protocol!=='file:'){
  const ready=()=>navigator.serviceWorker.controller?.postMessage({type:'K_FOUNTAIN_READY',version:document.querySelector('meta[name="k-fountain-version"]')?.content});
  navigator.serviceWorker.addEventListener('controllerchange',ready);
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(ready).catch(()=>{});
}
window.addEventListener('pagehide',saveRecovery);
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveRecovery();});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
sceneOutline=installSceneOutline({panel:$('#scene-panel'),button:$('#scenes'),previewDoc,onJump:jumpToScene,canJump:()=>!composing&&!previewEditor.busy()});
installToolbarMenus($('#top-panel'),previewDoc);
viewControls=installViewControls({doc:document,input,frame,isBusy:()=>composing||previewEditor.busy(),onLayout:layoutChanged});
for(const doc of [document,previewDoc])doc.addEventListener('compositionend',()=>queueMicrotask(()=>viewControls.flush()));
resetHistory();syncSettings();renderNow();
if(recoveryProblem)toast('기존 복구본을 읽지 못했습니다. 기존 데이터는 보존되어 있습니다.');else saveRecovery();
// Recovered text must never silently reconnect to a separately persisted file handle.
// The first save after reopening always asks for a destination.
