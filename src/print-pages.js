import {CONTINUATION_LABELS} from './screenplay.js';

// Use the same page geometry during measurement and in the print dialog.
export const paginationCSS=`
  @page { size:A4 portrait; margin:0; @bottom-right { content:none; } }
  body { margin:0; padding:0; font-size:var(--font-size-print); }
  h1,h2,h3,p { font-size:var(--font-size-print); }
  .print-sheet {
    position:relative; box-sizing:border-box; width:210mm; height:296.8mm;
    display:flex; flex-direction:column; padding:var(--standard-screenplay-margins);
    break-after:page;
  }
  .print-sheet:last-child { break-after:auto; }
  .print-sheet main { display:flow-root; flex:1 1 0; min-height:0; max-width:none; margin:0; }
  .print-content { display:flow-root; }
  .print-sheet .title-page { break-after:auto; }
  .print-more { margin-left:6em; }
  .dual-dialogue-block .print-more { margin-left:2em; }
  .dual-dialogue-block > .dialogue-block { min-width:0; }
  .print-folio { position:absolute; bottom:12mm; right:25.4mm; font:12px Courier New,monospace; }
  .print-content .character,.print-content .parenthetical { break-after:avoid; }
`;

const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const words=new Intl.Segmenter(undefined,{granularity:'word'});
const trailingContinuation=/\s*\((?:CONT['’]D|이어서)\)\s*$/i;

// A break occupies one position. Text runs retain their original inline styles.
function indexInline(element) {
  let text='';
  function index(node) {
    const start=text.length;
    const children=node.nodeType===1&&node.tagName!=='BR'?[...node.childNodes].map(index):[];
    if(node.nodeType===3)text+=node.data;
    if(node.nodeName==='BR')text+='\n';
    return {node,children,start,end:text.length};
  }
  const root=index(element);
  return {text,root};
}

function sliceInline({root},start,end) {
  function slice(entry) {
    const {node,children,start:from,end:to}=entry;
    if(end<=from||start>=to)return null;
    if(start<=from&&to<=end)return node.cloneNode(true);
    if(node.nodeType===3)return node.ownerDocument.createTextNode(node.data.slice(Math.max(0,start-from),end-from));
    const copy=node.cloneNode(false);
    for(const child of children){const piece=slice(child);if(piece)copy.append(piece);}
    return copy;
  }
  return slice(root);
}

function flow(parts,speech) {
  const boundaries=[{part:0,offset:0}], fallback=[...boundaries];
  const indexed=parts.map(indexInline);
  for(const [part,item] of indexed.entries()){
    const after={part:part+1,offset:0};
    // A stage direction stays with what follows it.
    if(speech&&!parts[part].classList.contains('dialogue'))continue;
    for(const {index,segment} of words.segment(item.text)){
      const offset=index+segment.length;
      if(offset<item.text.length)boundaries.push({part,offset});
    }
    for(const {index,segment} of graphemes.segment(item.text)){
      const offset=index+segment.length;
      if(offset<item.text.length)fallback.push({part,offset});
    }
    boundaries.push(after);fallback.push(after);
  }
  const end={part:parts.length,offset:0};
  if(boundaries.at(-1).part!==end.part){boundaries.push(end);fallback.push(end);}
  return {indexed,boundaries,fallback,end};
}

function fragment(model,from,to) {
  const pieces=[];
  for(let i=from.part;i<model.indexed.length&&i<=to.part;i++){
    const item=model.indexed[i],start=i===from.part?from.offset:0,end=i===to.part?to.offset:item.text.length;
    if(end>start)pieces.push(sliceInline(item,start,end));
  }
  return pieces;
}

function completed(model,pos){return pos.part===model.end.part;}
function after(a,b){return a.part>b.part||a.part===b.part&&a.offset>b.offset;}

function speechColumn(block){
  const cue=block.firstElementChild;
  return {...flow([...block.children].slice(1),true),block,cue};
}

function speechPiece(model,from,to,labels) {
  const column=model.block.cloneNode(false);
  if(!after(to,from))return column;
  const cue=model.cue.cloneNode(true);
  if(from.part||from.offset){
    if(!trailingContinuation.test(cue.textContent))cue.append(' '+labels.continued);
  }
  column.append(cue,...fragment(model,from,to));
  if(!completed(model,to)){
    const more=column.ownerDocument.createElement('p');
    more.className='print-more';more.textContent=labels.more;column.append(more);
  }
  return column;
}

function furthest(model,start,check) {
  if(check(model.end))return model.end;
  // Prefer word breaks. A very long word can still wrap by grapheme.
  for(const points of [model.boundaries,model.fallback]){
    let lo=0,hi=points.length-1,best=start;
    while(lo<=hi){
      const mid=(lo+hi)>>1,point=points[mid];
      if(!after(point,start)){lo=mid+1;continue;}
      if(check(point)){best=point;lo=mid+1;}else hi=mid-1;
    }
    if(after(best,start))return best;
  }
  return start;
}

export function paginatePrint(doc,language='en') {
  const source=doc.querySelector('main');
  const pages=doc.createElement('div');pages.className='print-pages';
  doc.body.append(pages);
  const labels=CONTINUATION_LABELS[language]||CONTINUATION_LABELS.en;
  let sheet,area,content,used=0;
  function newPage(){
    sheet=doc.createElement('section');sheet.className='print-sheet';
    area=doc.createElement('main');content=doc.createElement('div');content.className='print-content';
    area.append(content);sheet.append(area);pages.append(sheet);
    const folio=doc.createElement('span');folio.className='print-folio';folio.textContent=String(pages.children.length);sheet.append(folio);
    used=0;
  }
  function fits(){return content.getBoundingClientRect().height<=area.getBoundingClientRect().height-0.5;}
  function tryPiece(node){
    content.append(node);
    const ok=fits();node.remove();return ok;
  }
  function append(node){content.append(node);used++;}
  function finishTitle(){sheet.querySelector('.print-folio').hidden=true;newPage();}

  try{
    newPage();
    // Headless DOM implementations without layout can still read the plain output.
    if(!area.clientHeight){pages.remove();return;}
    for(const block of [...source.children]){
      if(block.tagName==='HR'){if(used)newPage();continue;}
      if(block.tagName==='BR'&&!used)continue;
      const whole=block.cloneNode(true);
      const title=block.classList.contains('title-page');
      if(tryPiece(whole)){append(whole);if(title)finishTitle();continue;}
      const dual=block.classList.contains('dual-dialogue-block');
      const speech=dual||block.classList.contains('dialogue-block');
      // Keep short speeches and paragraphs together when a fresh page suffices.
      if(used){
        const prior={sheet,area,content,used};
        newPage();
        if(tryPiece(whole)){append(whole);if(title)finishTitle();continue;}
        sheet.remove();
        ({sheet,area,content,used}=prior);
      }
      const models=speech?(dual?[...block.children]:[block]).map(speechColumn):[flow([block],false)];
      let starts=models.map(()=>({part:0,offset:0}));
      while(models.some((model,i)=>!completed(model,starts[i]))){
        function piece(ends){
          if(!speech)return fragment(models[0],starts[0],ends[0])[0];
          const columns=models.map((model,i)=>speechPiece(model,starts[i],ends[i],labels));
          if(!dual)return columns[0];
          const row=block.cloneNode(false);row.append(...columns);return row;
        }
        const ends=[...starts];
        for(const [i,model] of models.entries()){
          if(completed(model,starts[i]))continue;
          ends[i]=furthest(model,starts[i],end=>{
            const candidate=[...ends];candidate[i]=end;
            const node=piece(candidate);return node&&tryPiece(node);
          });
        }
        if(!ends.some((end,i)=>after(end,starts[i]))){
          if(used){newPage();continue;}
          throw Error('한 페이지에 들어가지 않는 대본 요소가 있습니다.');
        }
        append(piece(ends));starts=ends;
        if(models.some((model,i)=>!completed(model,starts[i]))){if(title)finishTitle();else newPage();}
      }
      if(title)finishTitle();
    }
    if(!used&&pages.children.length>1)sheet.remove();
    source.remove();
  }catch(error){pages.remove();throw error;}
}
