/**
 * @fileoverview Renders a parsed Fountain token list into HTML.
 * Derived from wixette/fountain2html f7a741d (Apache-2.0).
 * Modified: safe text, source mapping, optional section hiding, lyrics,
 * non-mutating rendering and optional sequential scene labels.
 */

import { TokenType, DualPosition } from './fountain_parser.js';
import {mapped,literal,replace,join,escape,visible} from './mapped-text.js';

const THEMES = [
  'default',

  'cjk',
  'colorful',
  'dark',
  'ocean',
];

const DEFAULT_THEME = 'default';

const INLINE_RE = {
  BOLD_ITALIC_UNDERLINE: /(_{1}\*{3}(?=.+\*{3}_{1})|\*{3}_{1}(?=.+_{1}\*{3}))(.+?)(\*{3}_{1}|_{1}\*{3})/g,
  BOLD_ITALIC: /(\*{3}(?=.+\*{3}))(.+?)(\*{3})/g,
  BOLD_UNDERLINE: /(_{1}\*{2}(?=.+\*{2}_{1})|\*{2}_{1}(?=.+_{1}\*{2}))(.+?)(\*{2}_{1}|_{1}\*{2})/g,
  BOLD: /(\*{2}(?=.+\*{2}))(.+?)(\*{2})/g,
  ITALIC_UNDERLINE: /(_{1}\*{1}(?=.+\*{1}_{1})|\*{1}_{1}(?=.+_{1}\*{1}))(.+?)(\*{1}_{1}|_{1}\*{1})/g,
  ITALIC: /(\*{1}(?=.+\*{1}))(.+?)(\*{1})/g,
  NOTE_INLINE: /(?:\[{2}(?!\[+))([\s\S]*?)(?:\]{2}(?!\[+))/g,
  UNDERLINE: /(_{1}(?=.+_{1}))(.+?)(_{1})/g,
};

// Inline HTML snippets to replace fountain syntax.
//
//
//
const INLINE_HTML = {
  BOLD_ITALIC_UNDERLINE: '<span class="bold italic underline">$2</span>',
  BOLD_ITALIC: '<span class="bold italic">$2</span>',
  BOLD_UNDERLINE: '<span class="bold underline">$2</span>',
  BOLD: '<span class="bold">$2</span>',
  ITALIC_UNDERLINE: '<span class="italic underline">$2</span>',
  ITALIC: '<span class="italic">$2</span>',
  LINE_BREAK: '<br />',
  NOTE_INLINE: '<!-- $1 -->',
  UNDERLINE: '<span class="underline">$2</span>',
};

const HTML_TEMPLATE = (title, body, theme) => `<!DOCTYPE html>
<html>
<meta charset="UTF-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="themes/${theme}/styles.css">
<script src=""></script>
<body>
<main>
${body}
</main>
</body>
</html>
`

function inlineMapped(value,pairs=[],showNotes=false) {
  const notes=[];
  value=replace(value,INLINE_RE.NOTE_INLINE,(m,c)=>{
    if(!showNotes)return literal('');
    const index=notes.push(join([literal('<span class="preview-note">'),c(0),literal('</span>')]))-1;
    return literal(`\uE002${index}\uE003`);
  });
  value=replace(value,/\\([*_])/g,(m,c)=>literal(m[1]==='*'?'\uE000':'\uE001',c(1).map[0]));
  for(const style of Object.keys(INLINE_RE)){
    if(style==='NOTE_INLINE')continue;
    value=replace(value,INLINE_RE[style],(m,c)=>{
      if(/^\s|\s$/.test(m[2]))return c(0);
      const open=c(1).map.filter(Boolean),close=c(3).map.filter(Boolean);
      if(open.length&&close.length)pairs.push({open:[open[0][0],open.at(-1)[1]],close:[close[0][0],close.at(-1)[1]]});
      const [before,after]=INLINE_HTML[style].split('$2');
      return join([literal(before),c(2),literal(after)]);
    });
  }
  value=replace(value,/[\uE000\uE001]/g,(m,c)=>literal(m[0]==='\uE000'?'*':'_',c(0).map[0]));
  value=replace(value,/\uE002(\d+)\uE003/g,(m,c)=>notes[+m[1]]||c(0));
  return replace(value,/\n/g,()=>literal('<br />'));
}
function inlineTagsToHtml(s){return inlineMapped(mapped(s||'')).text;}

function render(fountainObject, theme, options = {}) {
  if (!fountainObject || !fountainObject.tokens) {
    return '';
  }
  if (!theme || !THEMES.includes(theme)) {
    theme = DEFAULT_THEME;
  }

  let title = '';
  const titlePageBuf = [];
  const bodyBuf = [];

  for (const original of fountainObject.tokens) {
    const token={...original};
    const beforeBody=bodyBuf.length,beforeTitle=titlePageBuf.length;
    const formatPairs=[],formatted=token.type===TokenType.NOTE&&options.showNotes
      ?join([literal('<span class="preview-note">'),escape(token.note||mapped(`[[${token.text||''}]]`)),literal('</span>')])
      :inlineMapped(escape(mapped(token.text||'',token.sourceMap)),formatPairs,options.showNotes);
    const display=visible(formatted);let prefix='';
    token.text = formatted.text;
    switch (token.type) {
      // Title pages.
      case TokenType.TITLE:
        titlePageBuf.push(`<h1 class="title-page-title">${token.text}</h1>`);
        title = token.text.replace('<br />', ' ').replace(/<(?:.|\n)*?>/g, '');
        break;
      case TokenType.CREDIT:
        titlePageBuf.push(`<p class="title-page-credit">${token.text}</p>`);
        break;
      case TokenType.AUTHOR:
        titlePageBuf.push(`<p class="title-page-authors">${token.text}</p>`);
        break;
      case TokenType.AUTHORS:
        titlePageBuf.push(`<p class="title-page-authors">${token.text}</p>`);
        break;
      case TokenType.SOURCE:
        titlePageBuf.push(`<p class="title-page-source">${token.text}</p>`);
        break;
      case TokenType.NOTES:
        titlePageBuf.push(`<p class="title-page-notes">${token.text}</p>`);
        break;
      case TokenType.DRAFT_DATE:
        titlePageBuf.push(`<p class="title-page-draft-date">${token.text}</p>`);
        break;
      case TokenType.DATE:
        titlePageBuf.push(`<p class="title-page-date">${token.text}</p>`);
        break;
      case TokenType.CONTACT:
        titlePageBuf.push(`<p class="title-page-contact">${token.text}</p>`);
        break;
      case TokenType.COPYRIGHT:
        titlePageBuf.push(`<p class="title-page-copyright">${token.text}</p>`);
        break;

      // Dialogues.
      case TokenType.SCENE_HEADING:
        prefix=options.sceneLabel&&token.sequence?`${options.sceneLabel(token.sequence)} `:options.showManualNumbers&&token.sceneNumber?escape(mapped(String(token.sceneNumber))).text+' ':'';
        bodyBuf.push(`<h2 class="screen-heading"${token.sceneNumber ? ` id="${String(token.sceneNumber).replace(/[^\w.-]/g,'')}"` : ''}>${prefix}${token.text}</h2>`);
        break;
      case TokenType.TRANSITION:
        bodyBuf.push(`<h2 class="transition">${token.text}</h2>`);
        break;
      case TokenType.DUAL_DIALOGUE_BEGIN:
        bodyBuf.push('<div class="dual-dialogue-block">');
        break;
      case TokenType.DIALOGUE_BEGIN:
        bodyBuf.push(`<div class="dialogue-block${token.dual === DualPosition.UNKNOWN ? '' : ` dual-${token.dual}`}">`);
        break;
      case TokenType.CHARACTER:
        bodyBuf.push(`<h3 class="character">${token.text}</h3>`);
        break;
      case TokenType.PARENTHETICAL:
        bodyBuf.push(`<p class="parenthetical">${token.text}</p>`);
        break;
      case TokenType.DIALOGUE:
        bodyBuf.push(`<p class="dialogue">${token.text}</p>`);
        break;
      case TokenType.DIALOGUE_END:
        bodyBuf.push('</div>');
        break;
      case TokenType.DUAL_DIALOGUE_END:
        bodyBuf.push('</div>');
        break;

      // Others.
      case TokenType.SECTION:
        if(!options.hideOutline)bodyBuf.push(`<p class="section section-${token.depth}" depth="${token.depth}">${token.text}</p>`);
        break;
      case TokenType.SYNOPSIS:
        if(!options.hideOutline)bodyBuf.push(`<p class="synopsis">${token.text}</p>`);
        break;
      case TokenType.NOTE:
        if(options.showNotes)bodyBuf.push(`<p class="note">${token.text}</p>`);
        break;
      case TokenType.ACTION:
        bodyBuf.push(`<p class="action">${token.text}</p>`);
        break;
      case TokenType.LYRIC:
        bodyBuf.push(`<p class="lyric italic">${token.text}</p>`);break;
      case TokenType.CENTERED:
        bodyBuf.push(`<p class="centered">${token.text}</p>`);
        break;
      case TokenType.PAGE_BREAK:
        bodyBuf.push('<hr />');
        break;
      case TokenType.LINE_BREAK:
        bodyBuf.push('<br />');
        break;
    }
    const buffer=titlePageBuf.length>beforeTitle?titlePageBuf:bodyBuf.length>beforeBody?bodyBuf:null;
    if(buffer&&Number.isInteger(token.sourceLine)){
      const last=buffer.length-1;
      buffer[last]=buffer[last].replace(/^<(h1|h2|h3|p|hr|br)(?=[ >])/,(m)=>`${m} data-source="${token.sourceLine}" data-token="${token.sourceId}"`);
      const generated=visible(mapped(prefix)).text;
      if(options.navigation&&/data-token=/.test(buffer[last]))options.navigation.set(String(token.sourceId),{type:token.type,rawStart:token.rawStart,rawEnd:token.rawEnd,sourceStart:token.sourceStart,sourceEnd:token.sourceEnd,formatPairs,text:generated+display.text,map:[...Array.from({length:generated.length},()=>[token.sourceStart,token.sourceStart]),...display.map]});
    }
  }

  const titlePage = titlePageBuf.length?`<div class="title-page">\n${titlePageBuf.join('\n')}\n</div>`:'';
  const body = `${titlePage}\n${bodyBuf.join('\n')}`;
  return HTML_TEMPLATE(title, body, theme);
}

export {
  inlineTagsToHtml,
  render,
};
