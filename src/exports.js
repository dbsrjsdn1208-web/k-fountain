import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, PageBreak } from 'docx';
import { groupElements } from './screenplay.js';

export function makeDocx(elements, title, settings) {
  elements=elements.outputElements||elements;
  const font=settings.font, size=settings.size*2;
  const paragraph=(e)=>new Paragraph({
    children:e.runs.length?e.runs.flatMap(r=>r.text.split('\n').map((part,i)=>new TextRun({text:part,break:i?1:undefined,bold:(e.type==='character'&&settings.boldCharacters!==false)||r.bold,italics:e.type==='lyric'||r.italic,underline:r.underline?{}:undefined,font,size}))):[],
    alignment:['character','centered'].includes(e.type)?AlignmentType.CENTER:e.type==='transition'?AlignmentType.RIGHT:AlignmentType.LEFT,
    indent:['dialogue','parenthetical'].includes(e.type)?{left:1000,right:1000}:undefined,
    spacing:{before:e.type==='scene'?240:e.type==='character'?100:0,after:e.type==='scene'?160:0,line:340},
    keepNext:['scene','character','parenthetical'].includes(e.type),
  });
  const line=e=> e.type==='scene'?new Paragraph({children:[new TextRun({text:`${e.label} `,bold:true,font,size}),...e.runs.map(r=>new TextRun({text:r.text,bold:true,italics:r.italic,underline:r.underline?{}:undefined,font,size}))],spacing:{before:260,after:180,line:340},keepNext:true}):paragraph(e);
  const none={style:BorderStyle.NONE,size:0,color:'FFFFFF'};
  const children=[];
  const titleTypes=new Set(['title','credit','author','authors','source','notes','draft_date','date','contact','copyright']);
  let hadTitle=false,enteredBody=false;
  for(const g of groupElements(elements)) {
    if(g.kind==='hidden'||(settings.hideOutline&&['section','synopsis'].includes(g.kind)))continue;
    if(titleTypes.has(g.kind)){
      hadTitle=true;
      children.push(new Paragraph({children:g.items.flatMap(e=>e.runs.flatMap(r=>r.text.split('\n').map((text,i)=>new TextRun({text,break:i?1:undefined,bold:g.kind==='title'||r.bold,italics:r.italic,underline:r.underline?{}:undefined,font,size:g.kind==='title'?size*1.5:size})))),alignment:['title','credit','author','authors','source'].includes(g.kind)?AlignmentType.CENTER:AlignmentType.RIGHT,spacing:{before:200,after:200,line:340}}));continue;
    }
    if(!enteredBody){enteredBody=true;if(hadTitle)children.push(new Paragraph({children:[new PageBreak()]}));}
    if(g.kind==='pagebreak'){children.push(new Paragraph({children:[new PageBreak()]}));continue;}
    if(g.kind==='dual') {
      children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:{top:none,bottom:none,left:none,right:none,insideHorizontal:none,insideVertical:none},rows:[new TableRow({children:[g.left,g.right].map(items=>new TableCell({width:{size:50,type:WidthType.PERCENTAGE},children:items.map(e=>paragraph({...e,type:e.type==='character'?'character':e.type==='parenthetical'?'parenthetical':'action'}))}))})]}));
    } else children.push(...g.items.map(line));
  }
  return new Document({creator:'K-파운틴',title,description:'한국어 시나리오',styles:{default:{document:{run:{font,size},paragraph:{spacing:{line:340}}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1361,right:1361}}},children}]});
}
export async function docxBlob(elements,title,settings) {return Packer.toBlob(makeDocx(elements,title,settings));}
export async function docxBuffer(elements,title,settings) {return Packer.toBuffer(makeDocx(elements,title,settings));}
