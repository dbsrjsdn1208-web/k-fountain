import {parseScreenplay,renderPreview,previewCSS,escapeHTML} from './screenplay.js';

export const printFlowCSS=`@media print {
  .character,.parenthetical { break-after:avoid-page; page-break-after:avoid; }
  .character + .dialogue,.character + .parenthetical,.parenthetical + .dialogue { break-before:avoid-page; page-break-before:avoid; }
  .dialogue { orphans:2; widows:2; }
  .dual-dialogue-block { break-inside:avoid-page; page-break-inside:avoid; }
  .peer-caret { display:none!important; }
}`;

// Always build from source, never from the editable or hidden preview DOM.
export function printHTML(text,names,settings,title,fonts=''){
  const body=renderPreview(parseScreenplay(text,names,settings));
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHTML(title)}</title><style>${fonts}\n${previewCSS(settings)}\n${printFlowCSS}</style></head><body><main>${body}</main></body></html>`;
}
export async function printDocument({doc,text,names,settings,title,fonts,restoreFocus}){
  doc.querySelector('#print-frame')?.remove();
  const frame=doc.createElement('iframe');frame.id='print-frame';frame.title='인쇄용 대본';frame.setAttribute('aria-hidden','true');frame.setAttribute('sandbox','allow-same-origin allow-modals');
  Object.assign(frame.style,{position:'fixed',left:'-10000px',top:'0',width:'900px',height:'700px',border:'0'});
  doc.body.append(frame);
  const output=frame.contentDocument;output.open();output.write(printHTML(text,names,settings,title,fonts));output.close();
  await output.fonts.ready;
  frame.contentWindow.addEventListener('afterprint',()=>{frame.remove();restoreFocus?.();},{once:true});
  frame.contentWindow.focus();frame.contentWindow.print();
}
