/**
 * @fileoverview Parses a Fountain file into a token list.
 * Derived from wixette/fountain2html f7a741d (Apache-2.0).
 * Modified: source locations, title metadata, lyrics, forced action, whitespace,
 * and Fountain edge cases. The unmodified source and tests are in vendor/.
 */

import {mapped,literal,slice,replace,remove,trim} from './mapped-text.js';

const TokenType = {
  // Scene heading types (sorted alphabetically).
  AUTHOR: 'author',
  AUTHORS: 'authors',
  CONTACT: 'contact',
  COPYRIGHT: 'copyright',
  CREDIT: 'credit',
  DATE: 'date',
  DRAFT_DATE: 'draft_date',
  NOTES: 'notes',
  SOURCE: 'source',
  TITLE: 'title',

  // Top-level types (sorted alphabetically).
  ACTION: 'action',
  CENTERED: 'centered',
  CHARACTER: 'character',
  DIALOGUE_BEGIN: 'dialogue_begin',
  DIALOGUE_END: 'dialogue_end',
  DIALOGUE: 'dialogue',
  DUAL_DIALOGUE_BEGIN: 'dual_dialogue_begin',
  DUAL_DIALOGUE_END: 'dual_dialogue_end',
  LINE_BREAK: 'line_break',
  LYRIC: 'lyric',
  NOTE: 'note',
  PAGE_BREAK: 'page_break',
  PARENTHETICAL: 'parenthetical',
  SCENE_HEADING: 'scene_heading',
  SECTION: 'section',
  SYNOPSIS: 'synopsis',
  TRANSITION: 'transition',
};

const DualPosition = {
  LEFT: 'left',
  RIGHT: 'right',
  UNKNOWN: 'unknown',
};

const RE = {
  // Sorted alphabetically.
  BONEYARD: /\/\*.*?\*\//gms,
  CENTERED: /^(?:> *)(.+)(?: *<)(\n.+)*/g,
  DIALOGUE: /^(@[^\^\n]+|(?=[^\n]*[A-Z])[A-Z0-9*_ .\-'’]+(?:\([^\n]*\))?\s*)(\^?)?(?:\n(?!\n+))([\s\S]+)/,
  EXTRA_LINE_BREAKS: /^\n+|\n+$/,
  EXTRA_WHITESPACES: /^\t+|^ {3,}/gm,
  LINE_BREAKS: /\r\n|\r/g,
  NOTE: /^(?:\[{2}(?!\[+))(.+)?(?:\]{2})(?!\[+)$/s,
  PAGE_BREAK: /^={3,}$/,
  PARENTHETICAL: /^(\(.+\))$/,
  PARENTHETICAL_SPLITTER: /^(\([^\n]*\))[ \t]*(?:\n+|$)/gm,
  SCENE_HEADING: /^((?:\*{0,3}_?)?(?:(?:int\.?\/ext|int|ext|est|i\/e)[. ]).+)|^(?:\.(?!\.+))(.+)/i,
  SCENE_NUMBER: /( *#(.+)# *)/,
  SECTION: /^(#+)(?: *)(.*)/,
  SPLITTER: /\n{2,}/g,
  SYNOPSIS: /^(?:=(?!=+) *)(.*)/,
  TITLE_PAGE: /^((?:title|credit|author[s]?|source|notes|draft date|date|contact|copyright):)/gim,
  TRANSITION: /^((?:FADE (?:TO BLACK|OUT)|CUT TO BLACK)\.|.+ TO:)$|^(?:> *)(.+)/,
  TWO_SPACES_LINE_BREAK: /^ {2}$/,
};

// Upstream grammar/order retained; every slice carries original UTF-16 ranges.
function parse(fountainText, options = {}) {
  let input=mapped(fountainText,options.sourceMap);
  input=replace(input,RE.LINE_BREAKS,(m,c)=>literal('\n',[c(0).map[0][0],c(0).map.at(-1)[1]]));
  input=replace(input,RE.BONEYARD,(m,c)=>remove(c(0),/[^\n]/g));
  const blocks=[];let at=0;
  for(const m of input.text.matchAll(RE.SPLITTER)){blocks.push(slice(input,at,m.index));at=m.index+m[0].length;}
  blocks.push(slice(input,at));
  const tokenList=[],original=options.sourceText??fountainText,lineStarts=[0];
  for(const m of original.matchAll(/\r\n|\r|\n/g))lineStarts.push(m.index+m[0].length);
  function lineAt(pos){let lo=0,hi=lineStarts.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(lineStarts[mid]<=pos)lo=mid;else hi=mid;}return lo;}
  let blockStart=0;
  function push(type,value=null,extra={}){
    const spans=value?.map.filter(Boolean)||[],sourceStart=spans[0]?.[0]??blockStart,sourceEnd=spans.at(-1)?.[1]??sourceStart;
    const rawStart=lineStarts[lineAt(sourceStart)],lineEnd=original.indexOf('\n',Math.max(sourceStart,sourceEnd));
    tokenList.push({type,...(value?{text:value.text}:{}),sourceLine:lineAt(sourceStart),sourceStart,sourceEnd,rawStart,rawEnd:lineEnd<0?original.length:lineEnd,sourceMap:value?.map||[],...extra});
  }
  function match(value,re){const m=new RegExp(re.source,re.flags.replace('g','')+'d').exec(value.text);return m?{m,c:n=>m.indices[n]?slice(value,...m.indices[n]):literal('')}:null;}
  const firstBlock=blocks.findIndex(b=>b.text.trim());
  let dual=false;
  for(let i=blocks.length-1;i>=0;i--){
    const raw=remove(blocks[i],/^\n+|\n+$/g),block=remove(raw,RE.EXTRA_WHITESPACES);
    blockStart=raw.map[0]?.[0]??0;
    let found;
    RE.TITLE_PAGE.lastIndex=0;
    if(i===firstBlock&&RE.TITLE_PAGE.test(block.text)){
      const fields=[...block.text.matchAll(new RegExp(RE.TITLE_PAGE.source,'gim'))];
      for(let j=fields.length-1;j>=0;j--){
        const field=slice(block,fields[j].index,fields[j+1]?.index??block.text.length);
        const colon=field.text.indexOf(':');
        push(field.text.slice(0,colon).trim().toLowerCase().replace(' ','_'),trim(slice(field,colon+1)),{rawStart:field.map.find(Boolean)?.[0],rawEnd:trim(field).map.filter(Boolean).at(-1)?.[1]});
      }continue;
    }
    if(block.text.startsWith('!')){push(TokenType.ACTION,remove(raw,/^!/));continue;}
    if(block.text.startsWith('~')){push(TokenType.LYRIC,remove(block,/^~/gm));continue;}
    if((found=match(block,RE.SCENE_HEADING))){
      let value=found.m[1]!==undefined?found.c(1):found.c(2);
      if(!value.text.endsWith('  ')){
        const number=match(value,RE.SCENE_NUMBER),sceneNumber=number?.m[2]??null;
        if(number)value=remove(value,RE.SCENE_NUMBER);
        push(TokenType.SCENE_HEADING,value,{sceneNumber});
      }continue;
    }
    if((found=match(block,RE.CENTERED))){push(TokenType.CENTERED,remove(found.c(0),/^>|<$/gm));continue;}
    if((found=match(block,RE.TRANSITION))){push(TokenType.TRANSITION,found.m[1]!==undefined?found.c(1):found.c(2));continue;}
    const newline=block.text.indexOf('\n'),first=newline<0?'':block.text.slice(0,newline);
    const hasCaret=/\^[ \t]*$/.test(first),character=remove(slice(block,0,Math.max(0,newline)),/\^[ \t]*$/);
    const baseName=character.text.replace(/(?:\([^()]*\)\s*)+$/,'').trim();
    if(newline>=0&&(character.text.startsWith('@')||(/\p{Lu}/u.test(baseName)&&baseName===baseName.toUpperCase()))){
      if(character.text.endsWith('  ')){push(TokenType.ACTION,remove(raw,/\s+$/));continue;}
      if(hasCaret)push(TokenType.DUAL_DIALOGUE_END);
      push(TokenType.DIALOGUE_END);
      const body=slice(block,newline+1),parts=[];let cursor=0;
      for(const m of body.text.matchAll(new RegExp(RE.PARENTHETICAL_SPLITTER.source,'gmd'))){
        if(m.index>cursor)parts.push(slice(body,cursor,m.index));
        parts.push(slice(body,...m.indices[1]));cursor=m.index+m[0].length;
      }
      if(cursor<body.text.length)parts.push(slice(body,cursor));
      for(const part of parts.reverse())if(part.text.length)push(RE.PARENTHETICAL.test(part.text)?TokenType.PARENTHETICAL:TokenType.DIALOGUE,remove(part,/^\n|\n$/g));
      push(TokenType.CHARACTER,trim(remove(character,/^@/)));
      push(TokenType.DIALOGUE_BEGIN,null,{dual:hasCaret?DualPosition.RIGHT:dual?DualPosition.LEFT:DualPosition.UNKNOWN});
      if(dual)push(TokenType.DUAL_DIALOGUE_BEGIN);
      dual=hasCaret;continue;
    }
    if((found=match(block,RE.SECTION))){push(TokenType.SECTION,trim(found.c(2)),{depth:found.m[1].length});continue;}
    if((found=match(block,RE.SYNOPSIS))){push(TokenType.SYNOPSIS,trim(found.c(1)));continue;}
    if((found=match(trim(block),RE.NOTE))){push(TokenType.NOTE,trim(found.c(1)));continue;}
    if(RE.PAGE_BREAK.test(block.text)){push(TokenType.PAGE_BREAK);continue;}
    if(RE.TWO_SPACES_LINE_BREAK.test(block.text)){push(TokenType.LINE_BREAK);continue;}
    const action=remove(raw,/^!/);if(action.text)push(TokenType.ACTION,action);
  }
  tokenList.reverse();tokenList.forEach((t,id)=>t.sourceId=id);
  return {tokens:tokenList,metadata:{}};
}
export {parse,DualPosition,TokenType};
