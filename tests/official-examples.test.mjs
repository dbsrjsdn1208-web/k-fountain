import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from '../src/engine/fountain_parser.js';
import {inlineTagsToHtml} from '../src/engine/fountain_html_renderer.js';
const {examples}=JSON.parse(fs.readFileSync(new URL('./fixtures/official-examples.json',import.meta.url),'utf8'));
const tokens=i=>parse(examples[i].text.replaceAll('{two spaces}','  ')).tokens;
const count=(i,type)=>tokens(i).filter(t=>t.type===type).length;
test('official scene headings, numbering variants and ellipsis action',()=>{
  assert.equal(count(0,'scene_heading'),1);assert.equal(count(1,'scene_heading'),1);assert.equal(count(1,'action'),1);assert.equal(count(2,'scene_heading'),1);
  // The documentation lists multiple independent scene-number examples together.
  for(const line of examples[4].text.split('\n'))assert.equal(parse(line).tokens[0].type,'scene_heading');
});
test('official action paragraphs and intentional indentation',()=>{
  assert.equal(count(5,'action'),3);assert.match(tokens(6)[1].text,/^ {4}Scott/);
});
test('official character extensions and @ mixed-case names',()=>{
  assert.equal(count(7,'character'),1);assert.equal(count(8,'character'),2);assert.equal(tokens(9).find(t=>t.type==='character').text,'McCLANE');
});
test('official dialogue, parentheticals, simultaneous speech and lyrics',()=>{
  assert.equal(count(10,'dialogue'),1);assert.equal(count(11,'dialogue'),1);assert.equal(count(12,'parenthetical'),1);assert.equal(count(13,'dual_dialogue_begin'),1);assert.equal(count(14,'lyric'),1);
});
test('official transitions and centered text',()=>{
  assert.equal(count(15,'transition'),1);assert.equal(count(16,'transition'),1);assert.equal(count(17,'centered'),1);assert.equal(count(18,'centered'),1);
});
test('official emphasis nesting, escaped stars and significant spaces',()=>{
  assert.match(inlineTagsToHtml(examples[19].text),/italic/);assert.match(inlineTagsToHtml(examples[20].text),/underline/);
  assert.match(inlineTagsToHtml(examples[21].text),/class="bold">\*9765\*/);
  assert.doesNotMatch(inlineTagsToHtml(examples[22].text),/class=/);
  assert.match(inlineTagsToHtml(examples[23].text),/class="italic"/);
  assert.doesNotMatch(inlineTagsToHtml(examples[24].text),/class=/);
});
test('official title page and optional draft-only title page',()=>{
  assert.deepEqual(tokens(26).map(t=>t.type),['title','credit','author','source','draft_date','contact']);assert.equal(tokens(27)[0].type,'draft_date');
});
test('official page break and all five line-break examples',()=>{
  assert.equal(count(28,'page_break'),1);assert.equal(count(29,'action'),3);
  assert.equal(count(30,'character'),1);assert.equal(count(31,'character'),0);
  assert.equal(count(32,'dialogue'),2);assert.equal(count(33,'action'),1);assert.equal(count(34,'dialogue'),2);
});
test('official indentation, notes, comments, sections and synopses',()=>{
  assert.equal(count(35,'character'),2);assert.equal(count(36,'note'),1);assert.equal(count(37,'action'),1);
  assert.equal(count(38,'scene_heading'),1);assert.equal(count(39,'section'),1);assert.equal(count(40,'section'),5);assert.equal(count(41,'synopsis'),2);
});
test('official completed screenplay contains title, scenes, speeches and dual dialogue',()=>{
  for(const type of ['title','author','contact','scene_heading','action','character','dialogue','dual_dialogue_begin','parenthetical','centered','transition'])assert.ok(count(42,type)>0,type);
});
