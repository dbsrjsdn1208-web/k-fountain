import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installViewControls,validateView} from '../src/view-controls.js';
import {printHTML} from '../src/print-document.js';
import {parseScreenplay,renderPreview,exportReadableText} from '../src/screenplay.js';

function viewApp(){
  const dom=new JSDOM('<div class="view-tools"><button id="view"></button><div id="view-menu" hidden><input id="view-source" type="checkbox"><input id="view-preview" type="checkbox"><input id="source-size"><button id="view-reset"></button></div></div><div id="main-app"><textarea id="fountain-editor"></textarea><div id="pane-divider"></div><section><iframe></iframe></section></div>',{url:'https://example.test'});
  const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),input=q('textarea'),frame=q('iframe'),media={matches:false,addEventListener(_,fn){this.update=fn;}};
  w.matchMedia=()=>media;let busy=false,layouts=0;
  const controller=installViewControls({doc,input,frame,isBusy:()=>busy,onLayout:()=>layouts++});
  const change=(selector,value)=>{const el=q(selector);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('change'));};
  return {dom,w,q,input,frame,media,controller,change,set busy(v){busy=v;},get layouts(){return layouts;},close:()=>w.close()};
}
test('view preferences clamp sizes and always retain a visible pane',()=>{
  assert.deepEqual(validateView({source:false,preview:false,size:500,horizontal:0,vertical:200}),{source:true,preview:false,size:40,horizontal:20,vertical:80});
  assert.equal(validateView({size:'bad'}).size,14);
});
test('pane toggles preserve DOM and text, store preferences and disable hiding the last pane',()=>{
  const a=viewApp();a.input.value='보존';const frame=a.frame;
  a.change('#view-source',false);assert.equal(a.input.hidden,true);assert.equal(a.q('#view-preview').disabled,true);assert.equal(a.q('#pane-divider').hidden,true);
  a.change('#view-source',true);a.change('#view-preview',false);assert.equal(a.q('#view-source').disabled,true);assert.equal(a.frame,frame);assert.equal(a.input.value,'보존');
  assert.equal(JSON.parse(a.w.localStorage.getItem('k-fountain.view.v1')).preview,false);a.q('#view-reset').click();assert.equal(a.frame.parentElement.hidden,false);assert.equal(a.input.style.fontSize,'14px');a.close();
});
test('Ctrl-wheel changes source size only and waits for composition to finish',()=>{
  const a=viewApp(),wheel=ctrl=>{const e=new a.w.WheelEvent('wheel',{ctrlKey:ctrl,deltaY:-100,cancelable:true});a.input.dispatchEvent(e);return e.defaultPrevented;};
  assert.equal(wheel(false),false);assert.equal(a.input.style.fontSize,'14px');assert.equal(wheel(true),true);assert.equal(a.input.style.fontSize,'15px');
  a.busy=true;a.change('#view-source',false);a.change('#source-size',30);assert.equal(a.input.hidden,false);assert.equal(a.input.style.fontSize,'15px');
  a.busy=false;a.controller.flush();assert.equal(a.input.hidden,true);assert.equal(a.input.style.fontSize,'30px');a.close();
});
test('splitter keyboard controls retain separate horizontal and vertical ratios',()=>{
  const a=viewApp(),divider=a.q('#pane-divider'),press=key=>divider.dispatchEvent(new a.w.KeyboardEvent('keydown',{key,cancelable:true}));
  press('ArrowRight');assert.equal(a.controller.state.horizontal,37);press('End');assert.equal(a.controller.state.horizontal,80);
  a.media.matches=true;a.media.update();press('ArrowUp');assert.equal(a.controller.state.vertical,40);assert.equal(a.controller.state.horizontal,80);assert.equal(divider.getAttribute('aria-orientation'),'horizontal');a.close();
});
test('print and readable output always exclude notes, even with blank lines and visible notes enabled',()=>{
  const source='.방\n\n앞[[메모 **별표** <img src=x>]]뒤\n\n[[여러 줄\n\n비밀]]\n\n@민서\n**대사**',settings={showNotes:true,font:'맑은 고딕',size:12};
  const model=parseScreenplay(source,[],settings),shown=new JSDOM(renderPreview(model,{showNotes:true}));
  assert.match(shown.window.document.body.textContent,/여러 줄\n\n비밀/);assert.match(shown.window.document.body.textContent,/\*\*별표\*\*/);assert.equal(shown.window.document.querySelectorAll('img').length,0);
  const output=new JSDOM(printHTML(source,[],settings,'검사'));
  assert.ok(!output.window.document.querySelector('main').textContent.includes('비밀'));assert.ok(!output.window.document.querySelector('main').textContent.includes('메모'));assert.equal(output.window.document.querySelector('.bold').textContent,'대사');assert.ok(!exportReadableText(model).includes('비밀'));
  shown.window.close();output.window.close();
});
