import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {PreviewEditor,replaceVisible,deletionRange} from '../src/preview-editor.js';
import {SourceEdits} from '../src/preview-navigation.js';
import {parseScreenplay,renderPreview,exportReadableText} from '../src/screenplay.js';
import {normalizeText} from '../src/text-tools.js';
import {docxBuffer} from '../src/exports.js';
import {unzipSync,strFromU8} from 'fflate';
function app(text,mode='full'){
  const dom=new JSDOM('<textarea></textarea><main></main>',{pretendToBeVisual:true}),doc=dom.window.document,input=doc.querySelector('textarea'),main=doc.querySelector('main');input.value=text;
  const edits=new SourceEdits(text);let snapshot,editor,model,history=[text],idx=0;const notices=[];
  const render=()=>{if(editor?.busy())return;model=parseScreenplay(input.value,['민서','도윤']);main.innerHTML=renderPreview(model);snapshot={version:edits.version,records:model.navigation};editor?.decorate();};
  editor=new PreviewEditor({doc,input,edits,getSnapshot:()=>snapshot,getMode:()=>mode,notify:x=>notices.push(x),save:()=>{},remember:()=>{},undo:d=>{if(history[idx+d]!==undefined){input.value=history[idx+=d];edits.record(input.value);}},apply:(value,start,end,type,auto)=>{input.value=auto?normalizeText(value,['민서','도윤'],{}):value;input.setSelectionRange(start,end);edits.record(input.value);history=history.slice(0,idx+1);history.push(input.value);idx++;},refresh:render});render();editor.toggle(true);
  const select=(a,b=a)=>{editor.selection={anchor:a,focus:b};editor.restoreSelection();};
  const type=(data,inputType='insertText')=>main.dispatchEvent(new dom.window.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType,data}));
  return {dom,doc,input,main,editor,edits,notices,select,type,render,get model(){return model;},close:()=>dom.window.close()};
}
test('raw mode includes scene markers, character caret and exact repeated paragraph',()=>{
  const a=app('.방 #8#\n\n@민서 ^\n안녕\n(작게)\n안녕','source');
  const paragraphs=[...a.main.querySelectorAll('.dialogue')];paragraphs.at(-1).click();assert.equal(a.editor.raw.field.value,'안녕');
  a.editor.raw.field.value='다음 말';a.editor.raw.field.dispatchEvent(new a.dom.window.Event('input',{bubbles:true}));assert.equal(a.input.value,'.방 #8#\n\n@민서 ^\n안녕\n(작게)\n다음 말');
  a.editor.finish();a.main.querySelector('.screen-heading').click();assert.equal(a.editor.raw.field.value,'.방 #8#');a.editor.finish();a.main.querySelector('.character').click();assert.equal(a.editor.raw.field.value,'@민서 ^');a.close();
});
test('full mode replaces visible text and supports shared undo and redo',()=>{
  const a=app('첫 **굵게** 끝');a.select(4,6);a.type('강조');assert.equal(a.input.value,'첫 **강조** 끝');a.editor.history(-1);assert.equal(a.input.value,'첫 **굵게** 끝');a.editor.history(1);assert.match(a.input.value,/강조/);a.close();
});
test('full mode creates scenes and dialogue from an empty manuscript with real newlines',()=>{
  const a=app('');a.select(0);a.type('.방','insertFromPaste');a.type(null,'insertParagraph');a.type(null,'insertParagraph');a.type('@민서','insertFromPaste');a.type(null,'insertParagraph');a.type('안녕 😊');assert.equal(a.input.value,'.방\n\n@민서\n안녕 😊');assert.equal(a.main.querySelector('.dialogue').textContent,'안녕 😊');a.close();
});
test('cross-paragraph edits preserve hidden notes and can be undone',()=>{
  const a=app('첫 문단\n\n[[비밀 메모]]\n\n둘째 문단');a.select(1,a.input.value.length-1);a.type('새 내용');assert.match(a.input.value,/\[\[비밀 메모\]\]/);assert.match(a.input.value,/새 내용/);a.editor.history(-1);assert.equal(a.input.value,'첫 문단\n\n[[비밀 메모]]\n\n둘째 문단');a.close();
});
test('composition does not render over IME; commits one final edit',()=>{
  const a=app('처음');a.select(2);const initial=a.main.firstChild;a.main.dispatchEvent(new a.dom.window.CompositionEvent('compositionstart',{bubbles:true}));a.type('ㅎ','insertCompositionText');assert.equal(a.input.value,'처음');a.render();assert.equal(a.main.firstChild,initial);a.main.dispatchEvent(new a.dom.window.CompositionEvent('compositionend',{bubbles:true,data:'한글'}));assert.equal(a.input.value,'처음한글');a.editor.history(-1);assert.equal(a.input.value,'처음');a.close();
});
test('generated scene labels are protected and raw edit changes export immediately',()=>{
  const a=app('.방 #88#');assert.equal(a.main.querySelector('.preview-number').contentEditable,'false');a.editor.toggle(false);assert.equal(a.main.contentEditable,'false');a.close();
  const b=app('원래 문장','source');b.main.querySelector('.action').click();b.editor.raw.field.value='수정 문장';b.editor.finish();assert.match(exportReadableText(b.model),/수정 문장/);b.close();
});
test('visible edits preserve paired emphasis across partial selections',()=>{
  assert.equal(replaceVisible('**굵게** 뒤',3,9,'새',[{open:[0,2],close:[4,6]}]).text,'**굵새**');
  assert.deepEqual(deletionRange('가😊나',3,true),[1,3]);
  assert.equal(replaceVisible('**굵게**',2,4,'',[{open:[0,2],close:[4,6]}]).text,'');
});
test('stale raw editing preserves the draft and refuses a wrong destination',()=>{
  const a=app('원고','source');a.main.querySelector('.action').click();a.editor.raw.field.value='내 수정';a.input.value='완전히 변경';a.edits.record(a.input.value);assert.equal(a.editor.finish(),false);assert.equal(a.editor.raw.field.value,'내 수정');assert.equal(a.input.value,'완전히 변경');assert.ok(a.notices.length);a.close();
});
test('typing new scenes after emphasized endings keeps all new source lines addressable',()=>{
  const a=app('_마지막 문장_');a.select(a.input.value.length-1);
  for(const part of ['\n','\n','.새 장면','\n','\n','@민서','\n','새 대사입니다.']){
    if(part==='\n')a.type(null,'insertParagraph');else for(const c of part)a.type(c);
  }
  assert.equal(a.input.value,'_마지막 문장_\n\n.새 장면\n\n@민서\n새 대사입니다.');assert.equal(a.main.querySelector('.dialogue').textContent,'새 대사입니다.');a.close();
});
test('dual dialogue both sides, emoji deletion and markup shortcuts retain source identity',()=>{
  const a=app('@민서\n왼쪽 😊\n\n@도윤 ^\n오른쪽');const pos=a.input.value.indexOf('오른쪽');a.select(pos,pos+3);a.type('오른편');assert.match(a.input.value,/@도윤 \^\n오른편/);const emoji=a.input.value.indexOf('😊');a.select(emoji+2);a.type(null,'deleteContentBackward');assert.ok(!a.input.value.includes('😊'));assert.match(a.input.value,/@민서\n왼쪽 /);a.select(4,6);a.editor.mark('**');assert.match(a.input.value,/\*\*왼쪽\*\*/);a.close();
});
test('line splitting and merging, paste, and latest DOCX/TXT output use the edited manuscript',async()=>{
  const a=app('가나다');a.select(1);a.type(null,'insertParagraph');assert.equal(a.input.value,'가\n나다');a.type(null,'deleteContentBackward');assert.equal(a.input.value,'가나다');a.select(0,3);a.type('첫 줄\n\n둘째 **최신** 문장','insertFromPaste');assert.match(exportReadableText(a.model),/최신/);const file=await docxBuffer(a.model,'검사',a.model.settings),zip=unzipSync(new Uint8Array(file));assert.match(strFromU8(zip['word/document.xml']),/최신/);a.close();
});

test('select all replaces the whole source, including hidden boundary markers, but retains notes',()=>{
  const a=app('.카페\n\n[[남길 메모]]\n\n@민서\n마지막 **대사**');
  a.main.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'a',ctrlKey:true}));
  assert.deepEqual(a.editor.readSelection(),{anchor:0,focus:a.input.value.length});
  a.type('.새 장소\n\n@도윤\n새 대사','insertFromPaste');
  assert.equal(a.input.value,'.새 장소\n\n@도윤\n새 대사[[남길 메모]]');
  a.editor.history(-1);assert.equal(a.input.value,'.카페\n\n[[남길 메모]]\n\n@민서\n마지막 **대사**');a.close();
});
