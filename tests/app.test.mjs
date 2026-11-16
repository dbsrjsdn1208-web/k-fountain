import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM,VirtualConsole} from 'jsdom';
const compiled=await build({entryPoints:['src/main.js'],bundle:true,format:'iife',write:false,plugins:[{name:'omit-styles',setup(b){b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));}}]});
async function app(){
  // jsdom does not implement upstream's nested @page rules; browser QA checks layout.
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented.*(?:scroll|navigation)|Could not parse CSS stylesheet/.test(e.message))errors.push(e.message);});
  const dom=new JSDOM('<!doctype html><div id="app"></div><div id="toast"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(value=''){this.returnValue=value;this.open=false;this.dispatchEvent(new w.Event('close'));};
  let writes=[],picks=0;const handle={name:'test.fountain',async queryPermission(){return 'granted';},async createWritable(){return {async write(text){writes.push(text);},async close(){},async abort(){}};}};
  w.showSaveFilePicker=async()=>{picks++;return handle;};w.eval(compiled.outputFiles[0].text);
  const q=s=>w.document.querySelector(s),input=q('#fountain-editor');q('#preview').contentWindow.Range.prototype.getBoundingClientRect=()=>({top:0,bottom:0,height:0});
  const edit=(text,type='insertText',composition=false)=>{input.dispatchEvent(new w.InputEvent('beforeinput',{inputType:type,bubbles:true}));input.value=text;input.setSelectionRange(text.length,text.length);input.dispatchEvent(new w.InputEvent('input',{inputType:type,bubbles:true,isComposing:composition}));};
  const flush=()=>new Promise(r=>w.setTimeout(r,40));
  return {dom,w,q,input,edit,flush,errors,writes,get picks(){return picks;}};
}
test('textarea shortcuts, undo, selection and IME compose through actual app listeners',async()=>{
  const a=await app();try{
    a.edit('한글');a.input.setSelectionRange(0,2);a.input.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(a.input.value,'**한글**');
    a.input.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(a.input.value,'한글');
    a.input.dispatchEvent(new a.w.CompositionEvent('compositionstart'));a.edit('민서','insertCompositionText',true);assert.equal(a.input.value,'민서');
    a.input.dispatchEvent(new a.w.CompositionEvent('compositionend'));assert.equal(a.input.value,'민서');
    a.edit('민서정');assert.equal(a.input.value,'민서정');a.edit('민서\n','insertLineBreak');assert.equal(a.input.value,'@민서\n');assert.equal(a.input.selectionStart,4);
    await a.flush();assert.deepEqual(a.errors,[]);
  }finally{a.dom.window.close();}
});
test('settings apply live, source numbering keeps insertion caret and output mode preserves source',async()=>{
  const a=await app();try{
    a.q('#number-mode').value='source';a.q('#number-mode').dispatchEvent(new a.w.Event('change'));
    a.edit('.방');assert.equal(a.input.value,'.방 #1#');assert.equal(a.input.selectionStart,2);
    a.edit('.방 #5#\n\n.문 #90#');assert.equal(a.input.value,'.방 #1#\n\n.문 #2#');
    a.q('#number-mode').value='output';a.q('#number-mode').dispatchEvent(new a.w.Event('change'));
    a.edit('.방 #9#');assert.equal(a.input.value,'.방 #9#');
    a.q('#font').value='맑은 고딕';a.q('#font').dispatchEvent(new a.w.Event('input'));await a.flush();assert.match(a.input.style.fontFamily,/맑은 고딕/);
    assert.match(a.q('#preview').contentDocument.querySelector('main').textContent,/1 방/);assert.deepEqual(a.errors,[]);
  }finally{a.dom.window.close();}
});
test('actual paste event preserves plain paragraph boundaries and converts inline marks',async()=>{
  const a=await app();try{
    a.edit('');const event=new a.w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:type=>type==='text/plain'?'첫 줄\n둘째 줄\n\n끝':'<p>첫 줄</p><p><b>둘째 줄</b></p><p><br></p><p><u>끝</u></p>'}});a.input.dispatchEvent(event);
    assert.equal(a.input.value,'첫 줄\n**둘째 줄**\n\n_끝_');await a.flush();const d=a.q('#preview').contentDocument;assert.equal(d.querySelectorAll('.action').length,2);assert.match(d.querySelector('main').innerHTML,/<br/);
    assert.deepEqual(a.errors,[]);
  }finally{a.dom.window.close();}
});
test('Save button reuses the file; changed text is not falsely marked saved during async save',async()=>{
  const a=await app();try{
    a.edit('첫 원고');a.q('#save').click();await a.flush();a.edit('수정 원고');a.q('#save').click();await a.flush();assert.equal(a.picks,1);assert.deepEqual(a.writes,['첫 원고','수정 원고']);assert.match(a.q('#file-status').textContent,/파일에 저장됨/);
    a.q('#save-as').click();await a.flush();assert.equal(a.picks,2);a.edit('다시 수정');assert.match(a.q('#file-status').textContent,/변경됨/);
    assert.deepEqual(a.errors,[]);
  }finally{a.dom.window.close();}
});

test('preview character click does not normalize source or add undo history',async()=>{
  const a=await app();try{
    a.edit('이전 원고','insertFromPaste');a.edit('민서','insertFromPaste');await a.flush();
    const doc=a.q('#preview').contentDocument,p=doc.querySelector('[data-token]');
    const original=doc.createRange.bind(doc);doc.createRange=()=>{const r=original();r.getClientRects=()=>{const end=r.startContainer.nodeType===3?r.endOffset:r.startContainer.textContent.length;return [{left:r.startOffset*10,right:end*10,top:10,bottom:30,width:(end-r.startOffset)*10,height:20}];};r.getBoundingClientRect=()=>r.getClientRects()[0];return r;};
    a.input.focus();for(const type of ['pointerdown','click'])p.dispatchEvent(new a.w.MouseEvent(type,{bubbles:true,button:0,detail:1,clientX:(p.textContent.length-1)*10+2,clientY:20}));
    assert.equal(a.input.selectionStart,1);assert.equal(a.input.value,'민서');assert.equal(a.w.document.activeElement,a.input);
    a.input.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(a.input.value,'이전 원고');assert.deepEqual(a.errors,[]);
  }finally{a.dom.window.close();}
});

test('preview toggle defaults off, mode persists, and live edits reach the real file save handler',async()=>{
  const a=await app();try{
    assert.equal(a.q('#preview-edit').getAttribute('aria-pressed'),'false');assert.equal(a.q('#preview-edit-mode').value,'source');
    a.edit('.방 #8#\n\n@민서\n원래 대사');await a.flush();a.q('#preview-edit').click();const d=a.q('#preview').contentDocument,main=d.querySelector('main'),node=d.querySelector('.dialogue').firstChild.firstChild;d.getSelection().setBaseAndExtent(node,0,node,node.length);d.dispatchEvent(new d.defaultView.Event('selectionchange'));main.dispatchEvent(new d.defaultView.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:'마지막 수정'}));a.q('#save').click();await a.flush();assert.match(a.writes[0],/마지막 수정/);assert.ok(!d.querySelector('.preview-raw'));
    a.q('#preview-edit-mode').value='full';a.q('#preview-edit-mode').dispatchEvent(new a.w.Event('change'));a.w.dispatchEvent(new a.w.Event('pagehide'));assert.equal(JSON.parse(a.w.localStorage.getItem('k-fountain.document.v2')).settings.previewEditMode,'full');a.q('#preview-edit').click();await a.flush();assert.equal(d.querySelector('main').contentEditable,'false');assert.deepEqual(a.errors,[]);
  }finally{a.dom.window.close();}
});

test('PDF print receives the last live edit with cursor syntax removed',async()=>{
  const a=await app();try{
    a.edit('.방\n\n원래 **대사**');await a.flush();a.q('#preview-edit').click();const frame=a.q('#preview'),d=frame.contentDocument,main=d.querySelector('main'),node=d.querySelector('.bold').firstChild;
    d.getSelection().setBaseAndExtent(node,0,node,node.length);d.dispatchEvent(new d.defaultView.Event('selectionchange'));
    main.dispatchEvent(new d.defaultView.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:'최종'}));
    let printed='';const append=a.w.document.body.append.bind(a.w.document.body);a.w.document.body.append=(el)=>{append(el);if(el.id==='print-frame'){Object.defineProperty(el.contentDocument,'fonts',{value:{ready:Promise.resolve()}});el.contentWindow.focus=()=>{};el.contentWindow.print=()=>{printed=el.contentDocument.querySelector('main').textContent;assert.equal(el.contentDocument.querySelectorAll('.preview-syntax,.preview-note').length,0);};}};
    await a.q('#pdf').onclick();assert.match(printed,/최종/);assert.ok(!printed.includes('**'));assert.match(a.input.value,/\*\*최종\*\*/);assert.deepEqual(a.errors,[]);
  }finally{a.dom.window.close();}
});

test('preview movement updates source selection without taking focus or adding history',async()=>{
 const a=await app();try{
  a.edit('@민서\n첫 대사\n둘째 대사');await a.flush();a.q('#preview-edit').click();
  const d=a.q('#preview').contentDocument,main=d.querySelector('main'),node=d.querySelector('.dialogue span').firstChild;
  main.focus();d.getSelection().setBaseAndExtent(node,2,node,2);d.dispatchEvent(new d.defaultView.Event('selectionchange'));await a.flush();
  assert.equal(a.input.selectionEnd,6);assert.notEqual(a.w.document.activeElement,a.input);
  a.q('#view').click();a.q('#view-source').click();assert.equal(a.input.hidden,true);a.q('#view-source').click();assert.equal(a.input.hidden,false);
  assert.equal(a.input.value,'@민서\n첫 대사\n둘째 대사');assert.deepEqual(a.errors,[]);
 }finally{a.dom.window.close();}
});
test('notes toggle renders in reading and editing modes without altering source',async()=>{
 const a=await app();try{
  const text='앞[[메모]]뒤\n\n[[여러 줄\n\n메모 끝]]';a.edit(text);await a.flush();const d=a.q('#preview').contentDocument;
  assert.ok(!d.querySelector('main').textContent.includes('메모'));
  a.q('#show-notes').checked=true;a.q('#show-notes').dispatchEvent(new a.w.Event('change'));await a.flush();assert.match(d.querySelector('main').textContent,/메모 끝/);
  a.q('#preview-edit').click();assert.match(d.querySelector('main').textContent,/메모 끝/);
  a.q('#show-notes').checked=false;a.q('#show-notes').dispatchEvent(new a.w.Event('change'));await a.flush();assert.ok(!d.querySelector('main').textContent.includes('메모'));assert.equal(a.input.value,text);assert.deepEqual(a.errors,[]);
 }finally{a.dom.window.close();}
});

test('new document detaches the previous destination and saves with a fresh picker',async()=>{
 const a=await app();try{a.edit('이전 원고');await a.q('#save').onclick();const before=a.picks;
 await a.q('#new').onclick();assert.equal(a.input.value,'');assert.equal(a.q('#title').value,'제목 없는 시나리오');
 a.edit('새 원고');await a.q('#save').onclick();assert.equal(a.picks,before+1);assert.equal(JSON.parse(a.w.localStorage.getItem('k-fountain.history.v1'))[0].text,'이전 원고');
 }finally{a.dom.window.close();}
});
test('changing the title requests a new destination instead of silently overwriting',async()=>{
 const a=await app();try{a.edit('이전 원고');await a.q('#save').onclick();const before=a.picks;
 a.q('#title').value='?';a.q('#title').dispatchEvent(new a.w.Event('input'));a.edit('다른 내용');await a.q('#save').onclick();assert.equal(a.picks,before+1);
 }finally{a.dom.window.close();}
});
test('new document cannot replace the manuscript while a save picker is pending',async()=>{
 const a=await app();try{a.edit('저장 중 원고');let release;a.w.showSaveFilePicker=()=>new Promise(resolve=>release=resolve);
 const saving=a.q('#save').onclick();await a.q('#new').onclick();assert.equal(a.input.value,'저장 중 원고');
 release({name:'pending.fountain',async createWritable(){return {async write(){},async close(){}};}});await saving;assert.equal(a.q('#title').value,'pending');
 }finally{a.dom.window.close();}
});
