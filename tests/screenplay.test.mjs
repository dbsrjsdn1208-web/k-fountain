import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {JSDOM} from 'jsdom';
import {clipboardFountain} from '../src/text-tools.js';
import {parse as baseParse} from '../vendor/fountain2html/src/fountain_parser.js';
import {parse} from '../src/engine/fountain_parser.js';
import {inlineTagsToHtml} from '../src/engine/fountain_html_renderer.js';
import {plainTextDoc,parseScreenplay,renderPreview,prepareSource,previewCSS,exportFountain,DEFAULT_SETTINGS} from '../src/screenplay.js';
import {docxBuffer} from '../src/exports.js';
const from=(s,settings={},names=['민수','영희'])=>parseScreenplay(plainTextDoc(s),names,settings);
const tokens=s=>parse(s).tokens;

test('incomplete scene spacing and non-title metadata never discard written lines',()=>{
 assert.equal(tokens('.방  ')[0].text,'.방  ');
 assert.deepEqual(tokens('.방\n바로 다음 지문').map(t=>t.text),['방','바로 다음 지문']);
 assert.equal(tokens('첫 문장\nTitle: 문장 안 제목')[0].text,'첫 문장\nTitle: 문장 안 제목');
 assert.equal(tokens('지문\nAuthor: 사람')[0].text,'지문\nAuthor: 사람');
});
const clean=ts=>ts.map(({sourceLine,sourceStart,sourceEnd,sourceMap,sourceId,rawStart,rawEnd,note,...t})=>t);
const upstream=fs.readFileSync(new URL('../vendor/fountain2html/src/fountain_parser.test.js',import.meta.url),'utf8');
for(const m of upstream.matchAll(/const (TEXT_\d+) = `([\s\S]*?)`/g)){
  test('production parser matches upstream fixture '+m[1],()=>{
    const actual=clean(tokens(m[2])),expected=baseParse(m[2]).tokens;
    // The fork additionally preserves the explicit two-space trailing line break.
    if(m[1]==='TEXT_9')assert.equal(actual.pop().type,'line_break');
    assert.deepEqual(actual,expected);
  });
}
test('Korean markers are optional; standard sections remain sections when disabled',()=>{
  const text='# 구성\n\nS#23. 장소\n\n3. 장소';
  assert.deepEqual(from(text,{hashScenes:false,sNumberScenes:false,numericScenes:false}).model.tokens.map(t=>t.type),['section','action','action']);
  assert.equal(from(text,{hashScenes:true,sNumberScenes:true,numericScenes:true}).model.tokens.filter(t=>t.type==='scene_heading').length,3);
});
test('custom numbering is sequential after insert, deletion, reorder',()=>{
  const e=from('.셋째\n\n.새 장면\n\n.첫째 #98#',{numbering:'n',numberMode:'source'});
  assert.deepEqual(e.outputElements.filter(e=>e.type==='scene').map(e=>[e.displayText,e.label]),[['셋째','1'],['새 장면','2'],['첫째','3']]);
  assert.match(exportFountain(e),/\.첫째 #3#/);
});
test('disabling automatic numbering preserves original alphanumeric scene IDs',()=>{
  const e=from('INT. HOUSE - DAY #1A#',{autoNumbers:false});assert.equal(e.model.tokens[0].sceneNumber,'1A');assert.match(exportFountain(e),/#1A#/);assert.doesNotMatch(renderPreview(e),/S#1/);
});
test('registered names match exactly, including parentheses and simultaneous speech',()=>{
  const e=from('민수 (전화)\n안녕\n\n영희 ^\n잘 가\n\n민수가 문을 연다.');
  const html=renderPreview(e);assert.match(html,/dual-dialogue-block/);assert.match(html,/class="character">민수 \(전화\)/);assert.match(html,/class="action">민수가 문을 연다/);
  assert.doesNotMatch(html,/@민수|영희 \^/);
  assert.equal(from('민수\n대사',{autoCharacters:false}).model.tokens[0].type,'action');
});
test('Korean auto-recognition does not rewrite title fields or comments',()=>{
  const doc=plainTextDoc('Title:\n    민수\nAuthor:\n    영희\n\n/*\n민수\n# 장면 메모\n*/\n\n[[\n영희\n]]\n\n민수\n대사');
  const source=prepareSource(doc,['민수','영희'],DEFAULT_SETTINGS);
  assert.match(source,/Title:\n    민수\nAuthor:\n    영희/);assert.match(source,/\/\*\n민수\n# 장면 메모/);assert.match(source,/\[\[\n영희\n\]\]/);assert.match(source,/@민수\n대사/);
});
test('original single line breaks become br; paragraph breaks become separate p',()=>{
  const html=renderPreview(from('첫 줄\n둘째 줄\n\n새 문단'));assert.match(html,/첫 줄<br \/>둘째 줄/);assert.equal((html.match(/class="action"/g)||[]).length,2);
});
test('two-space blank lines stay inside dialogue instead of ending it',()=>{
  const e=from('@민수\n첫 대사\n  \n다음 대사');assert.equal(e.model.tokens.filter(t=>t.type==='dialogue').length,1);assert.match(renderPreview(e),/첫 대사<br \/>  <br \/>다음 대사/);
});
test('all title fields survive import, display and Fountain export, including colons',()=>{
  const text='Title: 작품\nCredit: 각본\nAuthor: 작가\nSource: 원작\nNotes: 메모\nDraft date: 2026\nDate: 2026\nContact: https://example.com/a:b\nCopyright: 작가\n\n.장소';
  const e=from(text);for(const type of ['title','credit','author','source','notes','draft_date','date','contact','copyright'])assert.ok(e.model.tokens.find(t=>t.type===type),type);
  assert.match(renderPreview(e),/https:\/\/example.com\/a:b/);assert.match(exportFountain(e),/Contact: https:\/\/example.com\/a:b/);
});
test('lyrics, centered text, transitions and forced action are implemented',()=>{
  assert.deepEqual(tokens('~첫 소절\n~둘째 소절\n\n>끝<\n\n>전환\n\n!INT. 실제 지문').map(t=>t.type),['lyric','centered','transition','action']);
  assert.equal(tokens('CUT TO: ')[0].type,'action');assert.equal(tokens('INT/EXT. ROOM - DAY')[0].type,'scene_heading');
});
test('standalone and inline notes, multiline boneyards and outline visibility',()=>{
  const e=from('/* 숨김\n계속 숨김 */\n\n[[여러 줄\n메모]]\n\n보이는 [[비공개]] 지문\n\n## 구성\n\n= 시놉시스');
  const html=renderPreview(e);assert.doesNotMatch(html,/계속 숨김/);const d=new JSDOM(html);assert.doesNotMatch(d.window.document.body.textContent,/여러 줄|비공개/);assert.match(d.window.document.body.textContent,/구성|시놉시스/);
  const hidden=renderPreview(from('## 구성\n\n= 시놉시스',{hideOutline:true}));assert.doesNotMatch(hidden,/구성|시놉시스/);
});
test('page breaks, escape syntax, and nested emphasis',()=>{
  const e=from('===\n\n_***모두***_ **굵게** *기울임* _밑줄_ \\*일반\\*');const html=renderPreview(e);assert.match(html,/<hr/);assert.match(html,/bold italic underline/);assert.match(html,/\*일반\*/);
  assert.doesNotMatch(inlineTagsToHtml('첫 줄 *아직\n다음 줄*'),/class="italic"/);
  assert.doesNotMatch(inlineTagsToHtml('He dialed *69 and then *23, and then hung up.'),/class="italic"/);
});
test('all HTML from manuscripts is escaped before entering the preview',()=>{
  const html=renderPreview(from('<img src=x onerror=alert(1)>\n\n[[--><script>evil()</script>]]'));
  assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);
});
test('arbitrary font names are retained, with safely quoted CSS and shared layout',()=>{
  assert.match(previewCSS({font:'나눔명조'}),/font-family:"나눔명조"/);
  assert.match(previewCSS({font:'Custom Font'}),/--default-line-height: 1.5em/);
  assert.match(previewCSS({font:'Custom Font'}),/--standard-screenplay-margins: 1in 1in 1in 1.25in/);
});
test('native clipboard rich text and literal Fountain syntax both work',()=>{
  const dom=new JSDOM();
  const source=clipboardFountain('굵게기울임밑줄','<p><span style="font-weight:700">굵게</span><span style="font-style:italic">기울임</span><span style="text-decoration:underline">밑줄</span></p>',dom.window.DOMParser);
  assert.equal(source,'**굵게***기울임*_밑줄_');
  const html=renderPreview(from('**굵게** *기울임* _밑줄_'));assert.match(html,/bold/);assert.match(html,/italic/);assert.match(html,/underline/);dom.window.close();
});
test('DOCX keeps full title metadata, forced breaks, emphasis and simultaneous dialogue',async()=>{
  const e=from('Title: 작품\nAuthor: 작가\nContact: 연락처\n\n# 장소\n\n민수\n**첫 줄**\n둘째 줄\n\n영희 ^\n_대사_\n\n===\n\n~노래');
  const zip=unzipSync(new Uint8Array(await docxBuffer(e,'작품',DEFAULT_SETTINGS))),xml=strFromU8(zip['word/document.xml']);assert.match(xml,/<w:tbl>/);assert.match(xml,/작가/);assert.match(xml,/연락처/);assert.match(xml,/<w:br/);assert.match(xml,/<w:b\/>/);assert.match(xml,/<w:u /);
});
