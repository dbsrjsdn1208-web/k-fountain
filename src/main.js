import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/700.css';
import './style.css';
import {DEFAULT_SETTINGS,escapeHTML as esc,parseScreenplay,renderPreview,previewCSS,exportReadableText} from './screenplay.js';
import {cleanNames,normalizeText,normalizeNewlines,mapSelection,toggleMarkup,clipboardFountain,migrateLegacy} from './text-tools.js';
import {FileSession,handleDB} from './file-store.js';
import {SourceEdits,installPreviewNavigation} from './preview-navigation.js';

const STORAGE='k-fountain.document.v2',LEGACY='jangmyeon.document.v1';
const SAMPLE='.기차역, 플랫폼 / 새벽\n\n첫 기차의 안내 방송이 흐른다.\n\n@민서 (작게)\n이번에는 **정말** 가는 거야.\n\n@도윤\n돌아와도 돼.\n\n.기차 안 / 아침\n\n_돌아오는 길은 언제나 여기 있을 테니까._';
function validate(value){
  if(value?.version===1)value=migrateLegacy(value);
  if(value?.version!==2||typeof value.text!=='string'||!Array.isArray(value.names))throw Error('읽을 수 없는 원고입니다.');
  const settings={...DEFAULT_SETTINGS,...value.settings,hashScenes:false,sNumberScenes:false,numericScenes:false,numbering:'n'};
  settings.font=String(settings.font||DEFAULT_SETTINGS.font).slice(0,150);
  settings.size=[10,11,12,13,14].includes(+settings.size)?+settings.size:12;
  settings.numberMode=settings.numberMode==='source'?'source':'output';
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
document.querySelector('#app').innerHTML=`
<header id="header-panel"><div class="title">K-파운틴</div><p>Fountain으로 쓰고, 대본으로 미리 봅니다.<br><span>Ctrl+B 굵게 · Ctrl+I 기울임 · Ctrl+U 밑줄</span></p><button id="install" hidden>앱 설치</button></header>
<div id="top-panel"><div class="file-tools"><button id="new">새 문서</button><button id="open">열기</button><input id="title" aria-label="파일 이름" value="${esc(state.title)}"><button id="save" title="Ctrl+S">저장</button><button id="save-as" title="Ctrl+Shift+S">다른 이름으로 저장</button></div><div class="output-tools"><button id="pdf">PDF / 인쇄</button><button id="docx">DOCX</button><button id="txt">TXT</button><button id="settings">설정</button></div></div>
<div id="main-app"><textarea id="fountain-editor" aria-label="Fountain 원고" spellcheck="false" wrap="soft" placeholder=".장소 / 시간&#10;&#10;@인물&#10;대사"></textarea><section id="html-render"><iframe id="preview" title="대본 미리보기" sandbox="allow-same-origin allow-modals"></iframe></section></div>
<footer id="footer-panel"><span id="file-status">${recovered?'임시 원고 복원됨':'파일을 저장해 주세요'}</span><span id="recovery-status"></span><span class="credit"><a href="https://github.com/wixette/fountain2html" target="_blank" rel="noopener">fountain2html</a> · Apache-2.0</span></footer>
<input id="file-input" type="file" accept=".fountain,.txt,.json" hidden>
<dialog id="settings-dialog"><div class="dialog-heading"><h2>설정</h2><button type="button" data-close="settings-dialog" aria-label="설정 닫기">닫기</button></div><p class="hint">바꾸는 즉시 적용되며 다음 실행에도 유지됩니다.</p>
<label>글꼴 이름<input id="font" type="text" maxlength="150" placeholder="예: 맑은 고딕, 나눔명조"></label><p class="hint">기기에 설치된 글꼴 이름을 입력하세요. 없는 글꼴은 기본 글꼴로 표시됩니다.</p>
<div class="setting-row"><label>글자 크기<select id="size">${[10,11,12,13,14].map(n=>`<option value="${n}">${n} pt</option>`).join('')}</select></label><label>출력 테마<select id="theme"><option value="default">Default</option><option value="cjk">CJK</option><option value="dark">Dark</option><option value="ocean">Ocean</option><option value="colorful">Colorful</option></select></label></div>
<label>장면 번호 자동<select id="number-mode"><option value="output">출력만 갱신 — 원고 유지</option><option value="source">원고에도 반영 — #1#, #2#</option><option value="off">끄기 — 직접 쓴 번호 유지</option></select></label><p class="hint">장면은 .장소 또는 INT. / EXT.로 시작합니다. #는 Fountain의 섹션 기호입니다. 원고 반영을 끄더라도 이미 쓴 번호는 지워지지 않습니다.</p>
<label class="check"><input id="auto-characters" type="checkbox">등록된 인물명에 @ 자동 추가</label><label>등록 인물<textarea id="names" rows="5" placeholder="한 줄에 한 명씩&#10;민서&#10;(인물)"></textarea></label><p class="hint">민서 (전화), (민서), (인물), 동시 대사 ^를 지원합니다. 지문과 대사 중 지시문은 그대로 둡니다.</p>
<label class="check"><input id="bold-characters" type="checkbox">인물명 굵게 출력</label><label class="check"><input id="follow" type="checkbox">미리보기가 작성 위치 따라가기</label><label class="check"><input id="hide-outline" type="checkbox">출력에서 섹션·시놉시스 숨기기</label>
<details><summary>사용 방법</summary><p>.장소 / 시간 → 장면<br>@인물 (전화) → 인물명<br>(작게) → 대사 지시문<br>두 번째 인물명 뒤 ^ → 동시 대사<br>=== → 페이지 나누기<br>**굵게** · *기울임* · _밑줄_<br>Ctrl+S → 같은 파일에 저장<br>Ctrl+Shift+S → 다른 이름으로 저장</p><p>구글 독스에서 붙여넣은 강조는 Fountain 기호로 바뀝니다. PDF는 인쇄 창에서 PDF 저장을 선택하세요. DOCX는 구글 독스에서 열어 편집할 수 있습니다.</p><p id="save-support"></p></details></dialog>
<dialog id="txt-dialog"><div class="dialog-heading"><h2>TXT 내보내기</h2><button data-close="txt-dialog">닫기</button></div><label>장면 번호 표시<select id="txt-numbering"><option value="S#n.">S#1. 장소</option><option value="S#n">S#1 장소</option><option value="n.">1. 장소</option><option value="n">1 장소</option></select></label><p class="hint">Fountain 기호를 뺀 읽기용 대본입니다. 원본 파일은 변경하지 않습니다.</p><button id="export-txt">TXT 저장</button></dialog>
<dialog id="replace-dialog"><h2>현재 원고를 닫을까요?</h2><p>파일에 저장하지 않은 변경 내용이 있습니다.</p><div class="dialog-actions"><button data-decision="cancel">취소</button><button data-decision="discard">저장하지 않고 계속</button><button data-decision="save">저장 후 계속</button></div></dialog>`;
const input=$('#fountain-editor'),frame=$('#preview');input.value=state.text;
const sourceEdits=new SourceEdits(input.value);
let navigationSnapshot=null,suppressFollow=false;
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),5000);}
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
previewDoc.open();previewDoc.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>K-파운틴</title><style id="fonts"></style><style id="style"></style></head><body><main></main></body></html>');previewDoc.close();
const faces=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules].filter(r=>r.type===5).map(r=>r.cssText);}catch{return [];}}).join('\n');
previewDoc.querySelector('#fonts').textContent=faces;
function renderNow(){
  const key=JSON.stringify([state.names,state.settings]);
  if(input.value!==previewText||key!==previewKey){
    elements=parseScreenplay(input.value,state.names,state.settings);
    const scroll=frame.contentWindow.scrollY,html=renderPreview(elements),main=previewDoc.querySelector('main');
    if(main.innerHTML!==html)main.innerHTML=html;
    navigationSnapshot={records:elements.navigation,version:sourceEdits.version};
    if(key!==previewKey){previewDoc.querySelector('#style').textContent=previewCSS(state.settings);input.style.fontFamily=`${JSON.stringify(state.settings.font)},"Noto Serif KR",serif`;}
    frame.contentWindow.scrollTo(0,scroll);previewText=input.value;previewKey=key;
  }followCaret();
}
function followCaret(){
  if(!elements||composing||suppressFollow||document.activeElement!==input)return;
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
installPreviewNavigation({doc:previewDoc,input,edits:sourceEdits,getSnapshot:()=>navigationSnapshot,isComposing:()=>composing,onNavigate:()=>{suppressFollow=true;}});
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
input.addEventListener('keyup',followCaret);input.addEventListener('click',()=>{suppressFollow=false;followCaret();});input.addEventListener('select',followCaret);
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&!composing){event.preventDefault();saveFile(event.shiftKey);}});
function filename(){return (state.title.trim()||'제목 없는 시나리오').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.fountain$/i,'');}
function download(data,name,type='text/plain;charset=utf-8'){const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function saveFile(as=false){
  if(composing){toast('한글 입력을 마친 뒤 저장해 주세요.');return false;}
  normalize();record('normalize');changed();const text=input.value;
  try{
    if(files.supported){await files.save(text,filename()+'.fountain',as);state.title=files.handle.name.replace(/\.fountain$/i,'');$('#title').value=state.title;handleDB('put',files.handle).catch(()=>{});}
    else{download(text,filename()+'.fountain');files.lastSaved=text;toast('다운로드했습니다. 같은 파일 덮어쓰기는 Chrome·Edge에서 지원됩니다.');}
    dirty=input.value!==files.lastSaved;updateStatus();saveRecovery();return true;
  }catch(error){if(error.name!=='AbortError')toast('저장하지 못했습니다. '+error.message);return false;}
}
async function confirmReplace(){
  if(!dirty&&files.lastSaved!==null)return true;
  const dialog=$('#replace-dialog');dialog.returnValue='cancel';dialog.showModal();
  const decision=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
  return decision==='discard'||decision==='save'&&await saveFile();
}
document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>$('#replace-dialog').close(b.dataset.decision));
function setDocument(next,handle=null,saved=null){state=validate(next);input.value=state.text;sourceEdits.reset(input.value);navigationSnapshot=null;suppressFollow=false;files.handle=handle;files.lastSaved=saved;dirty=saved!==input.value;$('#title').value=state.title;resetHistory();previewText=null;syncSettings();changed();input.scrollTop=0;frame.contentWindow.scrollTo(0,0);if(handle)handleDB('put',handle).catch(()=>{});else handleDB('delete').catch(()=>{});}
async function load(file,text,handle=null){
  if(file.size>10*1024*1024)throw Error('10MB 이하의 파일을 선택해 주세요.');
  const next=/\.json$/i.test(file.name)?validate(JSON.parse(text)):{...state,text:normalizeNewlines(text),title:file.name.replace(/\.[^.]+$/,'')};
  if(await confirmReplace())setDocument(next,handle,handle?normalizeNewlines(text):null);
}
$('#open').onclick=async()=>{try{if(window.showOpenFilePicker){const picked=await files.open();await load(picked.file,picked.text,picked.handle);}else $('#file-input').click();}catch(e){if(e.name!=='AbortError')toast(e.message);}};
$('#file-input').onchange=async event=>{try{const file=event.target.files[0];if(file)await load(file,await file.text());}catch(e){toast(e.message);}event.target.value='';};
input.addEventListener('dragover',e=>e.preventDefault());
input.addEventListener('drop',async e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();try{const file=e.dataTransfer.files[0];await load(file,await file.text());}catch(error){toast(error.message);}});
$('#new').onclick=async()=>{if(await confirmReplace()){setDocument({...state,text:'',title:'제목 없는 시나리오'});input.focus();}};
$('#save').onclick=()=>saveFile();$('#save-as').onclick=()=>saveFile(true);
$('#title').oninput=e=>{state.title=e.target.value;updateStatus();queueRecovery();};
function syncSettings(){
  $('#font').value=state.settings.font;$('#size').value=state.settings.size;$('#theme').value=state.settings.theme;
  $('#number-mode').value=state.settings.autoNumbers?state.settings.numberMode:'off';$('#txt-numbering').value=state.settings.txtNumbering;$('#names').value=state.names.join('\n');
  for(const [id,key]of Object.entries({'auto-characters':'autoCharacters','bold-characters':'boldCharacters',follow:'follow','hide-outline':'hideOutline'}))$('#'+id).checked=state.settings[key];
}
function settingChanged(normalizeSource=false){if(normalizeSource){normalize();record('settings');}changed();}
$('#settings').onclick=()=>{syncSettings();$('#settings-dialog').showModal();};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#settings-dialog').addEventListener('close',()=>input.focus());
$('#font').oninput=e=>{state.settings.font=e.target.value.trim()||DEFAULT_SETTINGS.font;settingChanged();};
$('#size').onchange=e=>{state.settings.size=+e.target.value;settingChanged();};
$('#theme').onchange=e=>{state.settings.theme=e.target.value;settingChanged();};
$('#number-mode').onchange=e=>{state.settings.autoNumbers=e.target.value!=='off';state.settings.numberMode=e.target.value==='source'?'source':'output';settingChanged(true);};
$('#names').oninput=e=>{state.names=cleanNames(e.target.value);settingChanged();};
$('#names').onblur=()=>settingChanged(true);
for(const [id,key]of Object.entries({'auto-characters':'autoCharacters','bold-characters':'boldCharacters',follow:'follow','hide-outline':'hideOutline'}))$('#'+id).onchange=e=>{state.settings[key]=e.target.checked;settingChanged(id==='auto-characters');};
$('#save-support').textContent=files.supported?'처음에 저장 위치를 선택하면 Ctrl+S로 같은 파일에 저장합니다.':'이 브라우저는 파일 다운로드만 지원합니다. 같은 파일에 저장하려면 Chrome·Edge에서 여세요.';
async function saveExport(blob,extension){
  if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:filename()+'.'+extension,id:'k-fountain-export',types:[{description:extension.toUpperCase(),accept:{'text/plain':['.txt']}}]});const writable=await handle.createWritable();try{await writable.write(blob);await writable.close();}catch(e){try{await writable.abort();}catch{}throw e;}}
  else download(blob,filename()+'.'+extension);
}
$('#pdf').onclick=async()=>{renderNow();await previewDoc.fonts.ready;previewDoc.title=state.title;frame.contentWindow.focus();frame.contentWindow.print();};
$('#docx').onclick=async()=>{
  // Open the picker within the user gesture, before loading the export library.
  try{const handle=window.showSaveFilePicker?await window.showSaveFilePicker({suggestedName:filename()+'.docx',id:'k-fountain-export',types:[{description:'Word 문서',accept:{'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}}]}):null;
    renderNow();const {docxBlob}=await import('./exports.js'),blob=await docxBlob(elements,state.title,state.settings);
    if(handle){const writable=await handle.createWritable();try{await writable.write(blob);await writable.close();}catch(e){try{await writable.abort();}catch{}throw e;}}else download(blob,filename()+'.docx');toast('DOCX를 저장했습니다.');
  }catch(e){if(e.name!=='AbortError')toast('DOCX 저장 실패: '+e.message);}
};
$('#txt').onclick=()=>{$('#txt-numbering').value=state.settings.txtNumbering;$('#txt-dialog').showModal();};
$('#txt-numbering').onchange=e=>{state.settings.txtNumbering=e.target.value;queueRecovery();};
$('#export-txt').onclick=async()=>{try{renderNow();await saveExport(exportReadableText(elements),'txt');$('#txt-dialog').close();toast('TXT를 저장했습니다.');}catch(e){if(e.name!=='AbortError')toast(e.message);}};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install').hidden=false;});
$('#install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install').hidden=true;}};
window.addEventListener('appinstalled',()=>{$('#install').hidden=true;});
if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
window.addEventListener('pagehide',saveRecovery);
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveRecovery();});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
resetHistory();syncSettings();renderNow();
if(recoveryProblem)toast('기존 복구본을 읽지 못했습니다. 기존 데이터는 보존되어 있습니다.');else saveRecovery();
if(recovered){const startupRevision=revision;handleDB('get').then(async handle=>{if(!handle||revision!==startupRevision)return;files.handle=handle;try{if(await handle.queryPermission({mode:'read'})==='granted'){const text=normalizeNewlines(await (await handle.getFile()).text());if(revision===startupRevision)files.lastSaved=text;}}catch{}dirty=files.lastSaved!==input.value;updateStatus();}).catch(()=>{});}
