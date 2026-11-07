// The actual Fountain parser and renderer are derived from wixette/fountain2html.
// This adapter only adds rich-text transport, Korean opt-ins and source mapping.
import {parse,TokenType} from './engine/fountain_parser.js';
import {render,inlineTagsToHtml} from './engine/fountain_html_renderer.js';
import themes from './engine/themes.js';
import {documentLines,matchCharacter,matchScene,sceneLabel,escapeHTML,mergeRuns,sliceRuns,groupElements} from './rich-text.js';
export {documentLines,matchCharacter,matchScene,sceneLabel,escapeHTML,groupElements};
export const DEFAULT_SETTINGS={font:'Noto Serif KR',size:12,numbering:'n',txtNumbering:'S#n.',numberMode:'output',follow:true,hashScenes:false,sNumberScenes:false,numericScenes:false,autoNumbers:true,autoCharacters:true,boldCharacters:true,hideOutline:false,theme:'default'};
export const FONT_OPTIONS=[]; // Kept only for compatibility with pre-v2 saved work.
export function plainTextDoc(text){return {type:'doc',content:text.replace(/\r\n?/g,'\n').split('\n').map(text=>({type:'paragraph',content:text?[{type:'text',text}]:[]}))};}
function escaped(s){return s.replace(/([\\*_])/g,'\\$1');}
export function fountainRuns(runs){return runs.map(r=>{
  if(!r.bold&&!r.italic&&!r.underline)return r.text;
  const left=r.text.match(/^\s*/)[0],right=r.text.match(/\s*$/)[0];let t=escaped(r.text.slice(left.length,r.text.length-right.length));if(!t)return r.text;
  if(r.bold&&r.italic)t=`***${t}***`;else if(r.bold)t=`**${t}**`;else if(r.italic)t=`*${t}*`;if(r.underline)t=`_${t}_`;return left+t+right;
}).join('');}
function decode(s){return s.replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));}
export function htmlRuns(html){
  const stack=[{}],runs=[];
  for(const part of html.split(/(<[^>]+>)/g)){
    if(!part)continue;
    if(/^<br\s*\/?\s*>$/i.test(part)){runs.push({text:'\n',...stack.at(-1)});continue;}
    if(/^<span\b/.test(part)){const c=part.match(/class="([^"]*)"/)?.[1]||'';stack.push({...stack.at(-1),bold:stack.at(-1).bold||/\bbold\b/.test(c),italic:stack.at(-1).italic||/\bitalic\b/.test(c),underline:stack.at(-1).underline||/\bunderline\b/.test(c)});continue;}
    if(part==='</span>'){if(stack.length>1)stack.pop();continue;}
    if(part.startsWith('<'))continue;
    runs.push({text:decode(part),...stack.at(-1)});
  }
  return mergeRuns(runs);
}
export function inlineRuns(runs){return htmlRuns(inlineTagsToHtml(escapeHTML(runs.map(r=>r.text).join(''))));}
export function prepareSource(doc,names,settings){
  const cfg={...DEFAULT_SETTINGS,...settings};
  const plain=typeof doc==='string';
  let inBoneyard=false,inNote=false,inTitle=false,bodyStarted=false;
  const sourceLines=documentLines(typeof doc==='string'?plainTextDoc(doc):doc);
  return sourceLines.map((line,index)=>{
    let text=fountainRuns(line.runs);
    const raw=line.text;
    const wasComment=inBoneyard||inNote;
    if(raw.includes('/*'))inBoneyard=true;if(raw.includes('*/'))inBoneyard=false;
    if(raw.includes('[['))inNote=true;if(raw.includes(']]'))inNote=false;
    if(wasComment||inBoneyard||inNote||raw.includes('/*')||raw.includes('[['))return text;
    if(!bodyStarted&&!inTitle&&/^(?:title|credit|author[s]?|source|notes|draft date|date|contact|copyright):/i.test(raw.trim()))inTitle=true;
    if(inTitle){if(!raw.trim()){inTitle=false;bodyStarted=true;}return text;}
    if(raw.trim())bodyStarted=true;
    const hash=cfg.hashScenes&&/^#(?!#)/.test(raw.trim());
    const sn=cfg.sNumberScenes&&/^S\s*#/i.test(raw.trim());
    const numeric=cfg.numericScenes&&/^\d+\.\s+/.test(raw.trim());
    const scene=(hash||sn||numeric)?matchScene(raw):null;
    if(scene)text='.'+fountainRuns(sliceRuns(line.runs,scene.start,scene.end));
    const cuePosition=index===0||!sourceLines[index-1].text.trim();
    const char=matchCharacter(raw,cfg.autoCharacters&&cuePosition?names:[]);
    if(char){if(plain){if(!char.explicit)text=raw.replace(/^(\s*)/,'$1@');}else{const start=raw.indexOf(raw.trim())+(char.explicit?1:0),end=raw.replace(/\s*\^\s*$/,'').trimEnd().length;text='@'+fountainRuns(sliceRuns(line.runs,start,end))+(char.dual?' ^':'');}}
    return text;
  }).join('\n');
}
const typeMap={scene_heading:'scene',page_break:'pagebreak',line_break:'blank',section:'section',synopsis:'synopsis',note:'hidden'};
const structural=new Set(['dialogue_begin','dialogue_end','dual_dialogue_begin','dual_dialogue_end']);
function preparedMap(original,prepared){
  const raw=original.split('\n'),lines=prepared.split('\n'),map=[];let offset=0;
  for(let i=0;i<lines.length;i++){
    const a=raw[i]||'',b=lines[i],leading=a.length-a.trimStart().length,inserted=b===a.slice(0,leading)+'@'+a.slice(leading);
    for(let j=0;j<b.length;j++){
      if(a===b)map.push([offset+j,offset+j+1]);
      else if(inserted)map.push(j===leading?[offset+j,offset+j]:[offset+j-(j>leading?1:0),offset+j+1-(j>leading?1:0)]);
      else map.push(null); // Legacy-only transforms cannot safely identify a clicked character.
    }
    offset+=a.length;if(i<lines.length-1){map.push([offset,offset+1]);offset++;}
  }return map;
}
export function parseScreenplay(doc,names=[],settings={}){
  const cfg={...DEFAULT_SETTINGS,...settings},lines=documentLines(typeof doc==='string'?plainTextDoc(doc):doc),source=prepareSource(doc,names,cfg),model=parse(source,typeof doc==='string'?{sourceText:doc,sourceMap:preparedMap(doc,source)}:{});
  const elements=lines.map(l=>({...l,type:l.text.trim()?'action':'blank',displayText:l.text,runs:l.runs}));
  const output=[];let seq=0,dual=false;
  for(const token of model.tokens){
    if(token.type==='scene_heading'){token.sequence=++seq;}
    if(token.type==='dialogue_begin'){dual=token.dual==='right';continue;}
    if(structural.has(token.type))continue;
    const type=typeMap[token.type]||token.type;
    const runs=htmlRuns(inlineTagsToHtml(escapeHTML(token.text||'')));
    const e={type,runs,text:token.text||'',displayText:runs.map(r=>r.text).join(''),index:token.sourceLine,pos:lines[token.sourceLine]?.pos||1,end:lines[token.sourceLine]?.end||1,number:token.sequence,label:type==='scene'?(cfg.autoNumbers?sceneLabel(token.sequence,cfg.numbering):(token.sceneNumber||'')):'',name:type==='character'?(matchCharacter('@'+(token.text||''),[])?.name||token.text):undefined,dual:type==='character'&&dual};
    output.push(e);
    if(elements[token.sourceLine]){
      // Keep the first visible token on a line (dialogue characters precede text).
      if(['action','blank'].includes(elements[token.sourceLine].type)||type==='scene')Object.assign(elements[token.sourceLine],e,{index:token.sourceLine});
    }
  }
  // All source lines within one upstream block follow the same rendered element.
  const sources=[...new Set(model.tokens.filter(t=>!structural.has(t.type)).map(t=>t.sourceLine))].sort((a,b)=>a-b);let cursor=0;
  for(let i=0;i<elements.length;i++){while(cursor+1<sources.length&&sources[cursor+1]<=i)cursor++;if(sources[cursor]<=i)elements[i].previewSource=sources[cursor];}
  elements.model=model;elements.source=source;elements.outputElements=output;elements.settings=cfg;
  return elements;
}
export function renderPreview(elements){
  const cfg=elements.settings;
  elements.navigation=new Map();
  const html=render(elements.model,cfg.theme,{navigation:elements.navigation,hideOutline:cfg.hideOutline,showManualNumbers:true,sceneLabel:cfg.autoNumbers?n=>escapeHTML(sceneLabel(n,cfg.numbering)):null});
  return html.match(/<main>\n([\s\S]*?)\n<\/main>/)?.[1]||'';
}
export function previewCSS(settings){
  const cfg={...DEFAULT_SETTINGS,...settings};
  const family=JSON.stringify(cfg.font||'Noto Serif KR');
  return (themes[cfg.theme]||themes.default)+`\n/* Korean customizations; upstream layout and breaks retained. */\nbody{font-family:${family},"Noto Serif KR",serif;} :root{--font-size-print:${cfg.size}pt;--font-size-screen:${cfg.size*(cfg.theme==='cjk'?1.5:4/3)}px;} .character{font-weight:${cfg.boldCharacters?'700':'400'};} .action{white-space:pre-wrap;} .lyric{font-style:italic;} [data-source].is-current{outline:1px solid #dbe4d6;outline-offset:4px;} @media print{[data-source].is-current{outline:0;}}`;
}
export function exportFountain(elements){
  const cfg=elements.settings;let lines=elements.source.split('\n');
  if(cfg.autoNumbers&&cfg.numberMode==='source')for(const t of elements.model.tokens)if(t.type===TokenType.SCENE_HEADING){const l=t.sourceLine;lines[l]=numberSceneLine(lines[l],t.sequence);}
  return lines.join('\n');
}
export function numberSceneLine(line,number){return /#[^#\n]+#[ \t]*$/.test(line)?line.replace(/#[^#\n]+#(?=[ \t]*$)/,`#${number}#`):line+` #${number}#`;}
export function exportReadableText(elements){return elements.outputElements.filter(e=>!['hidden','section','synopsis'].includes(e.type)).map((e,i,all)=>{
  const text=`${e.type==='scene'&&elements.settings.autoNumbers?sceneLabel(e.number,elements.settings.txtNumbering||'S#n.')+' ':e.type==='scene'&&e.label?e.label+' ':''}${e.displayText}`;
  return (i&&!(all[i-1].type==='character'||['dialogue','parenthetical'].includes(e.type))?'\n':'')+text;
}).join('\n');}
