import {prepareSource,fountainRuns,DEFAULT_SETTINGS,numberSceneLine} from './screenplay.js';
import {parse} from './engine/fountain_parser.js';

export const normalizeNewlines=s=>s.replace(/\r\n?/g,'\n');
export function cleanNames(value){return [...new Set(value.split(/[\n,]/).map(s=>s.trim().replace(/^@/,'')).filter(s=>s&&!/[\n^<>]/.test(s)))];}
export function normalizeText(text,names,settings){
  const cfg={...DEFAULT_SETTINGS,...settings},source=prepareSource(text,names,cfg);
  if(!cfg.autoNumbers||cfg.numberMode!=='source')return source;
  const lines=source.split('\n');let number=0;
  for(const token of parse(source).tokens)if(token.type==='scene_heading')lines[token.sourceLine]=numberSceneLine(lines[token.sourceLine],++number);
  return lines.join('\n');
}
// Map selection through small line changes; automatic @ / #n# edits do not move the caret to the end.
export function mapSelection(before,after,start,end=start){
  const a=before.split('\n'),b=after.split('\n');
  if(a.length!==b.length)return [Math.min(start,after.length),Math.min(end,after.length)];
  function map(pos){let oldOffset=0,newOffset=0;
    for(let i=0;i<a.length;i++){
      if(pos<=oldOffset+a[i].length){
        const x=a[i],y=b[i];let prefix=0,suffix=0;
        while(prefix<Math.min(x.length,y.length)&&x[prefix]===y[prefix])prefix++;
        while(suffix<Math.min(x.length,y.length)-prefix&&x[x.length-1-suffix]===y[y.length-1-suffix])suffix++;
        const col=pos-oldOffset;
        return newOffset+(col<=prefix?col:col>=x.length-suffix?Math.max(prefix,col+y.length-x.length):Math.min(y.length-suffix,col));
      }oldOffset+=a[i].length+1;newOffset+=b[i].length+1;
    }return after.length;
  }return [map(start),map(end)];
}
export function toggleMarkup(text,start,end,marker){
  const n=marker.length;
  if(start===end){
    if(text.slice(start-n,start)===marker&&text.slice(end,end+n)===marker)return {text:text.slice(0,start-n)+text.slice(end+n),start:start-n,end:start-n};
    return {text:text.slice(0,start)+marker+marker+text.slice(end),start:start+n,end:start+n};
  }
  const surrounding=text.slice(0,start).match(/(_?\*{0,3})$/)?.[1]||'';
  if(surrounding&&text.slice(end,end+surrounding.length)===[...surrounding].reverse().join('')){start-=surrounding.length;end+=surrounding.length;}
  const flag=marker==='_'?'underline':marker==='**'?'bold':'italic';
  const lines=text.slice(start,end).split('\n').map(line=>{
    const [,left,body,right]=line.match(/^(\s*)(.*?)(\s*)$/);let value=body,underline=false,bold=false,italic=false;
    if(value.startsWith('_')&&value.endsWith('_')&&value.length>2){underline=true;value=value.slice(1,-1);}
    const match=value.match(/^(\*{1,3})([^*][\s\S]*?)\1$/);
    if(match){bold=match[1].length>=2;italic=match[1].length%2===1;value=match[2];}
    return {left,right,value,underline,bold,italic};
  });
  const remove=lines.filter(l=>l.value).every(l=>l[flag]);
  const wrapped=lines.map(l=>{if(!l.value)return l.left+l.right;l[flag]=!remove;const stars='*'.repeat((l.bold?2:0)+(l.italic?1:0)),u=l.underline?'_':'';return l.left+u+stars+l.value+stars+u+l.right;}).join('\n');
  return {text:text.slice(0,start)+wrapped+text.slice(end),start,end:start+wrapped.length};
}

// Keep text/plain's exact paragraphs; HTML supplies only inline emphasis.
// Clipboard HTML is parsed in an inert document and never attached to the page.
export function clipboardFountain(plain,html,DOMParserClass=globalThis.DOMParser){
  plain=normalizeNewlines(plain||'');
  if(!html||!DOMParserClass)return plain;
  const doc=new DOMParserClass().parseFromString(html,'text/html'),chars=[];
  const walk=(node,marks={})=>{
    if(node.nodeType===3){for(const ch of node.nodeValue)chars.push({ch,...marks});return;}
    if(node.nodeType!==1||['SCRIPT','STYLE','META','LINK'].includes(node.tagName))return;
    const next={...marks},s=node.style;
    if(['B','STRONG'].includes(node.tagName))next.bold=true;
    if(['I','EM'].includes(node.tagName))next.italic=true;
    if(node.tagName==='U')next.underline=true;
    if(s.fontWeight)next.bold=s.fontWeight==='bold'||Number(s.fontWeight)>=600;
    if(s.fontStyle)next.italic=s.fontStyle==='italic'||s.fontStyle==='oblique';
    if(s.textDecoration||s.textDecorationLine)next.underline=/underline/.test(s.textDecoration+' '+s.textDecorationLine);
    if(node.tagName==='BR')chars.push({ch:'\n'});
    for(const child of node.childNodes)walk(child,next);
    if(['P','DIV','LI','H1','H2','H3','TR'].includes(node.tagName))chars.push({ch:'\n'});
  };walk(doc.body);
  if(!plain)plain=chars.map(c=>c.ch).join('').replace(/\n$/,'');
  const significant=chars.filter(c=>!(/\s/u.test(c.ch)));
  const input=[...plain];
  if(input.filter(c=>!(/\s/u.test(c))).join('')!==significant.map(c=>c.ch).join(''))return plain;
  let index=0;const tagged=input.map(ch=>/\s/u.test(ch)?{text:ch}:{text:ch,...significant[index++]});
  // Spaces inside a marked phrase inherit only the styles shared by both ends.
  for(let i=0;i<tagged.length;){if(!/^[ \t\u00a0]$/.test(tagged[i].text)){i++;continue;}
    let end=i;while(end<tagged.length&&/^[ \t\u00a0]$/.test(tagged[end].text))end++;
    for(let k=i;k<end;k++)for(const key of ['bold','italic','underline'])tagged[k][key]=!!tagged[i-1]?.[key]&&!!tagged[end]?.[key];i=end;
  }
  const runs=[];
  for(const r of tagged){const prev=runs.at(-1);if(r.text!=='\n'&&prev&&prev.text!=='\n'&&['bold','italic','underline'].every(k=>!!prev[k]===!!r[k]))prev.text+=r.text;else runs.push({...r});}
  return fountainRuns(runs);
}

export function migrateLegacy(value){
  if(value?.version!==1||value.doc?.type!=='doc'||!Array.isArray(value.doc.content)||!Array.isArray(value.names))throw Error('읽을 수 없는 구버전 원고입니다.');
  const settings={...DEFAULT_SETTINGS,...value.settings};
  const text=prepareSource(value.doc,value.names,settings);
  return {version:2,text,title:String(value.title||'제목 없는 시나리오'),names:cleanNames(value.names.join('\n')),settings:{...settings,hashScenes:false,sNumberScenes:false,numericScenes:false,numberMode:'output',numbering:'n',txtNumbering:settings.numbering||'S#n.'}};
}
