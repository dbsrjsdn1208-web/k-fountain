import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {parse} from '../src/engine/fountain_parser.js';
import {parseScreenplay,renderPreview} from '../src/screenplay.js';
import {SourceEdits,mappedPosition,hitText,revealCaret,installPreviewNavigation,invalidateCaretMeasurement} from '../src/preview-navigation.js';
import {previewPoint} from '../src/peer-carets.js';

function preview(source,names=[]){const elements=parseScreenplay(source,names);const dom=new JSDOM(renderPreview(elements));return {elements,dom,doc:dom.window.document};}
function verifyMap(source,names=[]){
  const p=preview(source,names);
  for(const node of p.doc.querySelectorAll('[data-token]')){
    const record=p.elements.navigation.get(node.dataset.token);assert.equal(node.textContent,record.text);
    assert.equal(record.text.length,record.map.length);
    for(let i=0;i<record.text.length;i++){const span=record.map[i];if(span&&span[0]!==span[1])assert.equal(source.slice(...span),record.text[i],`${record.text} at ${i}`);}
  }return p;
}
test('repeated dialogue and parentheticals retain their own exact ranges',()=>{
  const source='@민서\n안녕\n(잠깐)\n안녕\n(잠깐)\n안녕';const ts=parse(source).tokens.filter(t=>t.text);
  assert.deepEqual(ts.map(t=>t.sourceLine),[0,1,2,3,4,5]);
  assert.deepEqual(ts.filter(t=>t.text==='안녕').map(t=>t.sourceStart),[4,12,20]);
  for(const t of ts)assert.equal(source.slice(t.sourceStart,t.sourceEnd),t.text);
  verifyMap(source).dom.window.close();
});
test('multiline, emphasis, hidden notes, escapes, entities and emoji map to actual characters',()=>{
  verifyMap('!첫 줄 **굵게**\n둘째 _***강조***_ [[숨김 메모]] 다음 😊 & <글자>\n\\*문자\\* 한글 e\u0301').dom.window.close();
});
test('dual dialogue, titles, lyrics, centered lines and registered cues carry ranges',()=>{
  verifyMap('Title: **작품**\nAuthor: 저자\n\n.방 #7#\n\n민서 (전화)\n안녕\n둘째 줄\n\n(인물) ^\n(작게)\n안녕\n\n~노래\n~다음\n\n>가운데<\n>둘째<',['민서','(인물)']).dom.window.close();
});
test('comments and CRLF preserve original offsets',()=>{
  const source='/* 긴 주석\r\n여러 줄 */\r\n\r\n@민서\r\n안녕\r\n(잠깐)\r\n안녕';
  const tokens=parse(source).tokens.filter(t=>t.text==='안녕');assert.equal(tokens[1].sourceStart,source.lastIndexOf('안녕'));assert.equal(tokens[1].sourceLine,6);
});
test('generated scene numbers navigate to the title, not source numbering or dot',()=>{
  const source='.기차역 #88#';const p=preview(source),record=[...p.elements.navigation.values()][0];assert.equal(record.text,'1 기차역');assert.equal(mappedPosition(record,{index:0,after:false}),1);assert.equal(mappedPosition(record,{index:0,after:true}),1);p.dom.window.close();
});
test('rendering keeps tokens immutable and source IDs unique',()=>{
  const e=parseScreenplay('@민서\n안녕\n(잠깐)\n안녕'),before=JSON.stringify(e.model);renderPreview(e);renderPreview(e);assert.equal(JSON.stringify(e.model),before);assert.equal(new Set(e.model.tokens.map(t=>t.sourceId)).size,e.model.tokens.length);
});
test('stale preview maps positions through edits and rejects replaced content',()=>{
  const edits=new SourceEdits('첫 줄\n둘째 줄');edits.record('새로\n첫 줄\n둘째 줄');assert.equal(edits.map(4,0),7);edits.record('새로\n첫 줄\n바뀜');assert.equal(edits.map(5,0),null);
  const other=new SourceEdits('대사');other.record('@대사');assert.equal(other.map(0,0),1);assert.equal(other.map(2,0),3);
});
test('unmappable characters never produce a guessed destination',()=>{
  assert.equal(mappedPosition({map:[null]},{index:0,after:false}),null);assert.equal(mappedPosition(null,{index:0,after:false}),null);
});

test('replacing a document invalidates old snapshots, including after more edits',()=>{
  const edits=new SourceEdits('old');edits.record('old!');const version=edits.version;
  edits.reset('new');assert.equal(edits.map(1,version),null);edits.record('new!');assert.equal(edits.map(1,version),null);assert.equal(edits.map(1,version+1),1);
  for(let i=0;i<201;i++)edits.record(edits.text+'x');assert.equal(edits.map(0,version+1),null);
});

test('caret mirror keeps visible positions still, reveals outside positions, and cleans up',()=>{
  const dom=new JSDOM('<textarea style="font:14px/20px monospace;padding:10px;tab-size:4"></textarea>'),w=dom.window,input=w.document.querySelector('textarea');input.value='긴 문단 😊 뒤';input.scrollTop=100;
  Object.defineProperties(input,{clientWidth:{value:240},clientHeight:{value:200}});
  let top=105,mirror;
  w.HTMLElement.prototype.getBoundingClientRect=function(){if(this.tagName==='SPAN'){mirror=this.parentNode;return {top,bottom:top+20,left:0,right:10};}return {top:0,left:0};};
  revealCaret(input,5);assert.equal(input.scrollTop,100);assert.equal(mirror.style.width,'240px');assert.equal(mirror.style.fontFamily,'monospace');assert.equal(mirror.style.whiteSpace,'pre-wrap');assert.equal(mirror.querySelector('span').textContent,'😊');assert.equal(mirror.isConnected,false);
  top=480;invalidateCaretMeasurement(input);revealCaret(input,5);assert.equal(input.scrollTop,324);
  top=20;invalidateCaretMeasurement(input);revealCaret(input,5);assert.equal(input.scrollTop,0);dom.window.close();
});

test('passive preview caret uses exact source ranges without changing text or selection',()=>{
  const source='.방 #88#\n\n@민서\n반복\n(작게)\n반복',p=preview(source),before=p.doc.body.innerHTML;
  const point=previewPoint(p.doc,p.elements.navigation,source.lastIndexOf('반복')+1);
  assert.equal(point.node.data,'반복');assert.equal(point.offset,1);assert.equal(point.node.parentElement.dataset.source,'5');
  const scene=previewPoint(p.doc,p.elements.navigation,1);assert.equal(scene.node.data.slice(scene.offset),'방');
  assert.equal(p.doc.body.innerHTML,before);assert.equal(p.doc.getSelection().rangeCount,0);p.dom.window.close();
});

// Geometry test doubles exercise gesture and glyph boundaries; real wrapping
// and scroll geometry are checked separately in the browser.
function gestures(){
  const dom=new JSDOM('<textarea></textarea><p data-token="0">가😊나</p>'),w=dom.window,doc=w.document,input=doc.querySelector('textarea'),el=doc.querySelector('p');input.value='가😊나';
  const original=doc.createRange.bind(doc);doc.createRange=()=>{const r=original();r.getClientRects=()=>[{left:r.startOffset*10,right:(r.endOffset||4)*10,top:10,bottom:30,width:((r.endOffset||4)-r.startOffset)*10,height:20}];return r;};
  const edits=new SourceEdits(input.value),record={text:input.value,map:[[0,1],[1,2],[2,3],[3,4]]};let navigated=0;
  installPreviewNavigation({doc,input,edits,getSnapshot:()=>({version:0,records:new Map([['0',record]])}),onNavigate:()=>navigated++});
  function event(type,x,y,detail=1){el.dispatchEvent(new w.MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0,detail}));}
  return {dom,doc,input,el,event,get navigated(){return navigated;}};
}
test('glyph hit testing excludes paragraph margins and avoids splitting surrogate pairs',()=>{
  const g=gestures();assert.equal(hitText(g.el,70,20),null);const left=hitText(g.el,12,20),right=hitText(g.el,28,20);assert.equal(left.index,1);assert.equal(right.index,2);assert.equal(right.after,true);g.dom.window.close();
});
test('dragging and double clicking preview text do not transfer focus or alter source',()=>{
  const g=gestures();g.event('pointerdown',5,20);g.event('click',30,20);assert.equal(g.navigated,0);g.event('pointerdown',5,20);g.event('click',5,20,2);assert.equal(g.navigated,0);assert.equal(g.input.value,'가😊나');g.dom.window.close();
});
