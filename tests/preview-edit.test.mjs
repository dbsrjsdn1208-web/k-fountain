import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {PreviewEditor,replaceVisible,deletionRange} from '../src/preview-editor.js';
import {SourceEdits} from '../src/preview-navigation.js';
import {parseScreenplay,renderPreview,exportReadableText} from '../src/screenplay.js';
import {normalizeText} from '../src/text-tools.js';
import {docxBuffer} from '../src/exports.js';
import {unzipSync,strFromU8} from 'fflate';
function app(text,mode='full',options={}){
  const dom=new JSDOM('<textarea></textarea><main></main>',{pretendToBeVisual:true}),doc=dom.window.document,input=doc.querySelector('textarea'),main=doc.querySelector('main');input.value=text;
  const edits=new SourceEdits(text);let snapshot,editor,model,history=[text],idx=0;const notices=[];
  const render=()=>{if(editor?.busy())return;model=parseScreenplay(input.value,['민서','도윤']);main.innerHTML=renderPreview(model,{showNotes:options.showNotes});snapshot={version:edits.version,records:model.navigation};editor?.decorate();};
  editor=new PreviewEditor({doc,input,edits,getSnapshot:()=>snapshot,getMode:()=>mode,getShowNotes:()=>options.showNotes===true,onSelection:(...args)=>options.onSelection?.(...args),notify:x=>notices.push(x),save:()=>{},remember:()=>{},undo:d=>{if(history[idx+d]!==undefined){input.value=history[idx+=d];edits.record(input.value);}},apply:(value,start,end,type,auto)=>{input.value=auto?normalizeText(value,['민서','도윤'],{}):value;input.setSelectionRange(start,end);edits.record(input.value);history=history.slice(0,idx+1);history.push(input.value);idx++;},refresh:render});render();editor.toggle(true);
  const select=(a,b=a)=>{editor.selection={anchor:a,focus:b};if(editor.live())editor.updateLive(false);editor.restoreSelection();};
  const type=(data,inputType='insertText')=>main.dispatchEvent(new dom.window.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType,data}));
  return {dom,doc,input,main,editor,edits,notices,select,type,render,get model(){return model;},close:()=>dom.window.close()};
}
test('live mode reveals scene and cue syntax in place and edits the exact repeated paragraph',()=>{
  const a=app('.방 #8#\n\n@민서 ^\n안녕\n(작게)\n안녕','source');
  assert.equal(a.main.contentEditable,'true');assert.ok(!a.main.querySelector('textarea'));
  const end=a.input.value.length;a.select(end-2,end);a.type('다음 말');assert.equal(a.input.value,'.방 #8#\n\n@민서 ^\n안녕\n(작게)\n다음 말');
  a.select(1);assert.match(a.main.querySelector('.screen-heading').textContent,/\.방 #8#/);a.select(9);assert.equal(a.main.querySelector('.character').textContent,'@민서 ^');a.close();
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
test('generated scene labels are protected and live edit changes export immediately',()=>{
  const a=app('.방 #88#');assert.equal(a.main.querySelector('.preview-number').contentEditable,'false');a.editor.toggle(false);assert.equal(a.main.contentEditable,'false');a.close();
  const b=app('원래 문장','source');b.select(0,b.input.value.length);b.type('수정 문장');b.editor.finish();assert.match(exportReadableText(b.model),/수정 문장/);b.close();
});
test('visible edits preserve paired emphasis across partial selections',()=>{
  assert.equal(replaceVisible('**굵게** 뒤',3,9,'새',[{open:[0,2],close:[4,6]}]).text,'**굵새**');
  assert.deepEqual(deletionRange('가😊나',3,true),[1,3]);
  assert.equal(replaceVisible('**굵게**',2,4,'',[{open:[0,2],close:[4,6]}]).text,'');
});
test('stale live editing preserves the draft and refuses a wrong destination',()=>{
  const a=app('원고','source');a.select(0,2);const version=a.edits.version;a.input.value='완전히 변경';a.edits.record(a.input.value);a.editor.insert('내 수정','insertText',{anchor:0,focus:2},version);assert.equal(a.doc.querySelector('#preview-unapplied').value,'내 수정');assert.equal(a.input.value,'완전히 변경');assert.ok(a.notices.length);a.close();
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

test('live syntax follows only the focused emphasis while retaining formatting and untouched DOM',()=>{
  const a=app('앞 **굵게** 중간 _밑줄_ 끝\n\n다른 문단','source'),other=a.main.querySelectorAll('.action')[1],untouched=other.firstChild;
  const first=a.main.querySelector('.action');assert.equal(first.textContent,'앞 굵게 중간 밑줄 끝');
  a.select(5);assert.equal(first.textContent,'앞 **굵게** 중간 밑줄 끝');assert.ok(first.querySelector('.bold.preview-syntax'));assert.equal(other.firstChild,untouched);
  a.select(14);assert.equal(first.textContent,'앞 굵게 중간 _밑줄_ 끝');assert.equal(other.firstChild,untouched);
  a.select(a.input.value.length);assert.equal(first.textContent,'앞 굵게 중간 밑줄 끝');assert.equal(a.input.value,'앞 **굵게** 중간 _밑줄_ 끝\n\n다른 문단');
  a.editor.history(-1);assert.equal(a.input.value,'앞 **굵게** 중간 _밑줄_ 끝\n\n다른 문단');a.close();
});

test('live selection reveals intersected syntax and keeps backwards selection direction',()=>{
  const a=app('**굵게** 그리고 _밑줄_','source');a.select(14,3);assert.deepEqual(a.editor.readSelection(),{anchor:14,focus:3});assert.equal(a.main.querySelector('.action').textContent,a.input.value);
  a.select(8);assert.equal(a.main.querySelector('.action').textContent,'굵게 그리고 밑줄');a.close();
});

test('live arrows traverse source markers, paragraphs and whole emoji without changing undo',()=>{
  const a=app('.방\n\n@민서 ^\n가😊나','source');a.select(1);const key=(value,shiftKey=false)=>a.main.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:value,shiftKey}));
  key('ArrowLeft');assert.equal(a.editor.readSelection().focus,0);key('ArrowRight');assert.equal(a.editor.readSelection().focus,1);
  const emoji=a.input.value.indexOf('😊');a.select(emoji);key('ArrowRight');assert.equal(a.editor.readSelection().focus,emoji+2);key('ArrowLeft',true);assert.deepEqual(a.editor.readSelection(),{anchor:emoji+2,focus:emoji});
  a.select(4);key('ArrowLeft');assert.equal(a.editor.readSelection().focus,3);a.type(null,'deleteContentBackward');assert.equal(a.input.value,'.방\n@민서 ^\n가😊나');a.editor.history(-1);assert.equal(a.input.value,'.방\n\n@민서 ^\n가😊나');a.close();
});

test('visible square notes stay editable while boneyard still reveals only at the caret',()=>{
  const source='앞[[메모]]뒤\n\n/* 숨김\n여러 줄 */\n\n끝',a=app(source,'source',{showNotes:true});assert.ok(a.main.textContent.includes('메모'));assert.ok(!a.main.textContent.includes('여러 줄'));
  a.select(3,5);assert.match(a.main.textContent,/\[\[메모\]\]/);a.type('수정');assert.match(a.input.value,/앞\[\[수정\]\]뒤/);
  const pos=a.input.value.indexOf('여러 줄');a.select(pos,pos+4);assert.match(a.main.textContent,/여러 줄/);a.type('교체');assert.match(a.input.value,/\/\* 숨김\n교체 \*\//);
  a.select(a.input.value.length);assert.ok(a.main.textContent.includes('수정'));assert.ok(!a.main.textContent.includes('교체'));a.close();
});

test('live Korean composition and cancellation do not replace the active element or add partial edits',()=>{
  const a=app('**대사**','source');a.select(3);const node=a.doc.getSelection().focusNode,el=a.main.firstChild;
  a.main.dispatchEvent(new a.dom.window.CompositionEvent('compositionstart',{bubbles:true}));a.type('ㅎ','insertCompositionText');a.editor.updateLive();a.render();assert.equal(a.doc.getSelection().focusNode,node);assert.equal(a.main.firstChild,el);assert.equal(a.input.value,'**대사**');
  a.main.dispatchEvent(new a.dom.window.CompositionEvent('compositionend',{bubbles:true,data:'한글'}));assert.equal(a.input.value,'**대한글사**');a.editor.history(-1);assert.equal(a.input.value,'**대사**');
  a.select(2,4);a.main.dispatchEvent(new a.dom.window.CompositionEvent('compositionstart',{bubbles:true}));a.main.dispatchEvent(new a.dom.window.CompositionEvent('compositionend',{bubbles:true,data:''}));assert.equal(a.input.value,'**대사**');a.close();
});

test('live empty source, nested marks, escaped syntax and page breaks remain editable',()=>{
  const a=app('','source');a.select(0);for(const part of ['.방','\n','\n','@민서','\n','_***강조***_','\n','\n','===','\n','\n','\\*문자']){a.type(part,part==='\n'?'insertParagraph':'insertText');}
  assert.equal(a.input.value,'.방\n\n@민서\n_***강조***_\n\n===\n\n\\*문자');assert.ok(a.main.querySelector('.preview-page-break'));
  const pos=a.input.value.indexOf('강조');a.select(pos);assert.match(a.main.querySelector('.dialogue').textContent,/_\*\*\*강조\*\*\*_/);assert.ok(a.main.querySelector('.bold.italic.underline'));
  a.select(a.input.value.indexOf('\\*')+1);assert.match(a.main.lastElementChild.textContent,/\\\*문자/);a.select(0);assert.equal(a.main.lastElementChild.textContent,'*문자');a.close();
});

test('live cross-paragraph paste, delete and shortcuts share undo and final export content',async()=>{
  const a=app('.방\n\n@민서\n원래','source');a.main.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'a',ctrlKey:true}));a.type('.바깥\n\n@도윤\n새 대사','insertFromPaste');assert.equal(a.input.value,'.바깥\n\n@도윤\n새 대사');
  const start=a.input.value.indexOf('새 대사');a.select(start,start+4);a.editor.mark('**');assert.match(a.input.value,/\*\*새 대사\*\*/);a.select(start+2,start+6);a.type('최종');
  a.editor.finish();assert.equal(a.main.querySelectorAll('.preview-syntax').length,0);assert.match(exportReadableText(a.model),/최종/);const zip=unzipSync(new Uint8Array(await docxBuffer(a.model,'최종',a.model.settings)));assert.match(strFromU8(zip['word/document.xml']),/최종/);a.editor.history(-1);assert.match(a.input.value,/새 대사/);a.close();
});

for(const mode of ['source','full']){
  test(mode+': blank dialogue continuation keeps its container before typing and exits on second Enter',()=>{
    const a=app('@민서\n첫 대사',mode);a.select(a.input.value.length);a.type(null,'insertParagraph');
    let slot=a.main.querySelector('[data-insertion="9"]');assert.ok(slot.classList.contains('dialogue'));assert.ok(slot.parentElement.classList.contains('dialogue-block'));
    a.type('둘째 대사');assert.equal(a.main.querySelector('.dialogue').textContent,'첫 대사\n둘째 대사');
    a.type(null,'insertParagraph');a.type(null,'insertParagraph');slot=a.main.querySelector('[data-insertion="'+a.input.value.length+'"]');assert.equal(slot.parentElement,a.main);
    a.type('지문');assert.equal(a.main.querySelector('.action').textContent,'지문');a.editor.history(-1);a.type(null,'deleteContentBackward');
    slot=a.main.querySelector('[data-insertion="'+a.input.value.length+'"]');assert.ok(slot.parentElement.classList.contains('dialogue-block'));a.close();
  });
  test(mode+': separator stays after the previous speaker, including both dual columns',()=>{
    const source='@민서\n왼쪽\n\n@도윤 ^\n오른쪽\n',a=app(source,mode);
    const left=a.main.querySelector('.dual-left'),right=a.main.querySelector('.dual-right');
    assert.equal(a.main.querySelector('[data-insertion="7"]').parentElement,left);
    assert.equal(a.main.querySelector('[data-insertion="'+source.length+'"]').parentElement,right);a.close();
    const b=app('@민서\n(작게)\n',mode);assert.ok(b.main.querySelector('[data-insertion]').classList.contains('dialogue'));b.close();
  });
  test(mode+': hidden square notes never reveal and survive replacement and deletion',()=>{
    const source='앞[[메모]]뒤\n\n[[따로]]',a=app(source,mode);a.select(3,5);assert.ok(!a.main.textContent.includes('메모'));
    a.select(0,source.length);a.type('교체');assert.equal(a.input.value,'교체[[메모]][[따로]]');a.editor.history(-1);
    a.select(7);a.type(null,'deleteContentBackward');assert.equal(a.input.value,'[[메모]]뒤\n\n[[따로]]');a.close();
  });
  test(mode+': shown inline and standalone notes can be edited, but never exported',async()=>{
    const a=app('앞[[메모]]뒤\n\n[[따로]]',mode,{showNotes:true});assert.match(a.main.textContent,/\[\[따로\]\]/);
    a.select(3,5);a.type('수정');assert.equal(a.input.value,'앞[[수정]]뒤\n\n[[따로]]');assert.ok(!exportReadableText(a.model).includes('수정'));
    const zip=unzipSync(new Uint8Array(await docxBuffer(a.model,'메모',a.model.settings)));const xml=strFromU8(zip['word/document.xml']);assert.ok(!xml.includes('수정'));assert.ok(!xml.includes('따로'));a.close();
  });
}
test('hidden note keyboard navigation skips the complete range and source callbacks do not change history',()=>{
  const calls=[],a=app('앞[[메모]]뒤','source',{onSelection:s=>calls.push(s)});a.select(0);
  a.main.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowRight'}));assert.equal(a.editor.readSelection().focus,7);assert.equal(calls.at(-1).focus,7);
  a.main.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowLeft'}));assert.equal(a.editor.readSelection().focus,1);
  a.editor.history(-1);assert.equal(a.input.value,'앞[[메모]]뒤');a.close();
});
