import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {cleanNames,normalizeText,mapSelection,toggleMarkup,clipboardFountain,migrateLegacy} from '../src/text-tools.js';
import {parseScreenplay,renderPreview,exportReadableText,DEFAULT_SETTINGS,plainTextDoc} from '../src/screenplay.js';
import {FileSession} from '../src/file-store.js';
const dom=new JSDOM(),paste=(plain,html)=>clipboardFountain(plain,html,dom.window.DOMParser);
test('plain paste keeps single, double, trailing, and two-space dialogue breaks',()=>{
  const text='첫 줄\n둘째 줄\n\n새 문단\n  \n끝\n';assert.equal(paste(text,''),text);
});
test('Google Docs paragraphs do not introduce extra blank lines',()=>{
  const html='<b id="docs-internal-guid-123" style="font-weight:normal"><p><span>첫 줄</span></p><p><span style="font-weight:700">둘째 줄</span></p><p><br></p><p><em>새 문단</em></p></b>';
  assert.equal(paste('첫 줄\n둘째 줄\n\n새 문단',html),'첫 줄\n**둘째 줄**\n\n*새 문단*');
});
test('clipboard handles nested marks, whitespace, entities and emoji without changing text',()=>{
  assert.equal(paste('  한 글 😊 &\n다음','<p>  <b><i><u>한 글 😊 &amp;</u></i></b></p><p>다음</p>'),'  _***한 글 😊 &***_\n다음');
  assert.equal(paste('**있는 기호**','<p>**있는 기호**</p>'),'**있는 기호**');
  assert.equal(paste('실제 텍스트','<p>일치하지 않는 HTML</p>'),'실제 텍스트');
});
test('clipboard treats HTML scripts as inert and excludes their content',()=>{
  assert.equal(paste('대사','<script>evil()</script><p>대사</p>'),'대사');
});
test('B I U insert Fountain delimiters, toggle, and leave empty caret between them',()=>{
  for(const m of ['**','*','_']){const a=toggleMarkup('문장',0,2,m);assert.equal(a.text,m+'문장'+m);assert.equal(toggleMarkup(a.text,a.start,a.end,m).text,'문장');const empty=toggleMarkup('',0,0,m);assert.equal(empty.start,m.length);assert.equal(empty.text,m+m);}
  assert.equal(toggleMarkup('첫 줄\n둘째 줄',0,8,'**').text,'**첫 줄**\n**둘째 줄**');
});
test('only standard scene syntax is recognized by default',()=>{
  const e=parseScreenplay('# 섹션\n\nS#1 장소\n\n1. 장소\n\n.실제 장소');
  assert.deepEqual(e.model.tokens.map(t=>t.type),['section','action','action','scene_heading']);
});
test('B I U compose independently, including selected inner text and multiple lines',()=>{
  let edit={text:'문장',start:0,end:2};for(const mark of ['**','*','_'])edit=toggleMarkup(edit.text,edit.start,edit.end,mark);
  assert.equal(edit.text,'_***문장***_');edit=toggleMarkup(edit.text,edit.start,edit.end,'*');assert.equal(edit.text,'_**문장**_');
  assert.equal(toggleMarkup('**문장**',2,4,'*').text,'***문장***');
  const lines=toggleMarkup('첫 줄\n둘째 줄',0,8,'**');assert.equal(toggleMarkup(lines.text,lines.start,lines.end,'**').text,'첫 줄\n둘째 줄');
});
test('output numbering never rewrites manual source numbers',()=>{
  const text='.장소 #8A#\n\n.다른 장소';assert.equal(normalizeText(text,[],DEFAULT_SETTINGS),text);
  const e=parseScreenplay(text);assert.deepEqual(e.outputElements.map(e=>e.label),['1','2']);
  assert.match(exportReadableText(e),/^S#1\. 장소/);assert.match(exportReadableText(e),/S#2\. 다른 장소/);
});
test('source mode rewrites numbers idempotently after insert, reorder and delete',()=>{
  const s={...DEFAULT_SETTINGS,numberMode:'source'};
  const once=normalizeText('.셋 #99#\n\n.새 장면\n\n.첫 #1A#',[],s);
  assert.equal(once,'.셋 #1#\n\n.새 장면 #2#\n\n.첫 #3#');assert.equal(normalizeText(once,[],s),once);
  assert.equal(normalizeText('.첫 #3#\n\n.셋 #1#',[],s),'.첫 #1#\n\n.셋 #2#');
  assert.equal(normalizeText(once,[],{...s,autoNumbers:false}),once);
});
test('numbering and names skip comments and title metadata',()=>{
  const s={...DEFAULT_SETTINGS,numberMode:'source'},text='Title:\n    민서\n\n/*\n.장소\n민서\n*/\n\n[[\n.장소\n민서\n]]\n\n.실제 장소';
  assert.equal(normalizeText(text,['민서'],s),text+' #1#');
});
test('typing cue extensions preserves spaces; numbering replaces IDs without swallowing input',()=>{
  assert.equal(normalizeText('@민서 ',['민서'],DEFAULT_SETTINGS),'@민서 ');
  assert.equal(normalizeText('@민서 (전화) ^ ',['민서'],DEFAULT_SETTINGS),'@민서 (전화) ^ ');
  const s={...DEFAULT_SETTINGS,numberMode:'source'};
  assert.equal(normalizeText('.방  #1#',[],s),'.방  #1#');assert.equal(normalizeText('.방 장#8#',[],s),'.방 장#1#');
});
test('selection follows @ insertion and remains before automatically appended number',()=>{
  assert.deepEqual(mapSelection('.장소','.장소 #1#',3),[3,3]);
  assert.deepEqual(mapSelection('민서\n대사','@민서\n대사',5),[6,6]);
  const before='.장소 #9#\n\n대사',after='.장소 #10#\n\n대사';assert.deepEqual(mapSelection(before,after,before.length),[after.length,after.length]);
});
test('registered wrapped and literal parenthesized names support extensions and dual dialogue',()=>{
  assert.deepEqual(cleanNames('(인물)\n민서\n민서'),['(인물)','민서']);
  const text='(인물) (전화)\n대사\n\n(민서) ^\n(작게)\n다음 대사';
  const e=parseScreenplay(text,['(인물)','민서']);assert.equal(e.model.tokens.filter(t=>t.type==='character').length,2);assert.equal(e.model.tokens.filter(t=>t.type==='parenthetical').length,1);assert.match(renderPreview(e),/dual-dialogue-block/);
});
test('a registered parenthetical inside dialogue is still a direction',()=>{
  const text='@민서\n(인물)\n대사';assert.equal(normalizeText(text,['민서','(인물)'],DEFAULT_SETTINGS),text);
});
test('legacy migration preserves old marks, font and scenes without changing genuine sections',()=>{
  const old={version:1,title:'작품',names:['민서'],settings:{hashScenes:true,sNumberScenes:true,font:'바탕'},doc:plainTextDoc('# 장소\n\n민서\n대사')};
  old.doc.content[3].content[0].marks=[{type:'bold'}];const migrated=migrateLegacy(old);
  assert.equal(migrated.text,'.장소\n\n@민서\n**대사**');assert.equal(migrated.settings.font,'바탕');assert.equal(migrated.settings.hashScenes,false);
  old.settings.hashScenes=false;assert.match(migrateLegacy(old).text,/^# 장소/);
});
function fakeHandle(name){return {name,data:null,writes:0,async queryPermission(){return 'granted';},async createWritable(){const h=this;let data;return {async write(text){data=text;},async close(){h.data=data;h.writes++;},async abort(){}};}};}
test('Save reuses one chosen file; Save As switches only after success',async()=>{
  const one=fakeHandle('one.fountain'),two=fakeHandle('two.fountain');let picks=0;
  const fs=new FileSession({async showSaveFilePicker(){return ++picks===1?one:two;}});
  await fs.save('첫 원고','one.fountain');await fs.save('수정','one.fountain');assert.equal(picks,1);assert.equal(one.writes,2);assert.equal(one.data,'수정');
  await fs.save('새 원고','two.fountain',true);assert.equal(fs.handle,two);assert.equal(one.data,'수정');assert.equal(two.data,'새 원고');
});
test('cancelled Save As retains current file and saved state',async()=>{
  const fs=new FileSession({async showSaveFilePicker(){throw new DOMException('cancel','AbortError');}});fs.handle=fakeHandle('old');fs.lastSaved='old';
  await assert.rejects(fs.save('new','new',true),{name:'AbortError'});assert.equal(fs.handle.name,'old');assert.equal(fs.lastSaved,'old');assert.equal(fs.busy,false);
});
test('permission denied and write failures do not mark the document saved',async()=>{
  const fs=new FileSession({});fs.handle={async queryPermission(){return 'prompt';},async requestPermission(){return 'denied';}};fs.lastSaved='old';await assert.rejects(fs.save('new','name'));assert.equal(fs.lastSaved,'old');
  let aborted=false;fs.handle={async createWritable(){return {async write(){throw Error('disk full');},async abort(){aborted=true;}};}};
  await assert.rejects(fs.save('new','name'),/disk full/);assert.equal(fs.lastSaved,'old');assert.ok(aborted);
});
test('TXT keeps dialogue lines adjacent and uses selected numbering',()=>{
  const e=parseScreenplay('.방\n\n@민서\n첫 줄\n둘째 줄',[],{txtNumbering:'n.'});
  assert.match(exportReadableText(e),/^1\. 방\n\n민서\n첫 줄\n둘째 줄$/);
});
