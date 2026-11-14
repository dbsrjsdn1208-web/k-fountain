// Keep unchanged paragraphs alive, including their text nodes and native caret.
// The canonical copy is separate from the live editor's visible syntax.
const canonical = new WeakMap();
const documents = new WeakMap();
const tokenHTML=/<(h[1-3]|p)\b([^>]*\bdata-token="[^"]+"[^>]*)>([\s\S]*?)<\/\1>|<(hr|br)\b([^>]*\bdata-token="[^"]+"[^>]*)\/?\s*>/g;
export function updatePreviewDOM(main, html, live = false) {
  const parts=[];
  const skeleton=html.replace(tokenHTML,(whole,tag,attrs,inner,empty,emptyAttrs)=>{
    parts.push({whole,tag:tag||empty,attrs:attrs||emptyAttrs,inner:inner||''});
    return `<${tag||empty}${(attrs||emptyAttrs).replace(/data-source="[^"]*"/,'')}></${tag||empty}>`;
  });
  const previous=documents.get(main), originals=new Map();originals.reset=new WeakSet();
  if(previous?.skeleton===skeleton&&previous.live===live&&previous.parts.every(p=>main.contains(p.node))){
    const template=main.ownerDocument.createElement('template');
    for(let i=0;i<parts.length;i++){
      const part=parts[i],old=previous.parts[i],node=old.node;part.node=node;
      if(part.whole===old.whole)part.original=old.original;
      else {template.innerHTML=part.whole;part.original=template.content.firstElementChild;}
      originals.set(node,part.original);
      if(part.attrs!==old.attrs){for(const attr of [...node.attributes])if(!part.original.hasAttribute(attr.name))node.removeAttribute(attr.name);for(const attr of part.original.attributes)node.setAttribute(attr.name,attr.value);}
      if(part.inner!==old.inner){node.innerHTML=part.inner;originals.reset.add(node);canonical.set(node,part.inner);}
    }
    documents.set(main,{skeleton,parts,live});return originals;
  }
  const template = main.ownerDocument.createElement('template');
  template.innerHTML = html;
  function sync(parent, freshParent) {
    const old = [...parent.childNodes], fresh = [...freshParent.childNodes];
    for (let i = 0; i < fresh.length; i++) {
      const next = fresh[i]; let node = old[i];
      if (!node || node.nodeType !== next.nodeType || node.nodeName !== next.nodeName) {
        const copy = next.cloneNode(true);
        if (node) node.replaceWith(copy); else parent.append(copy);
        node = copy;
      }
      if (node.nodeType === 3) { if (node.data !== next.data) node.data = next.data; continue; }
      if (node.nodeType !== 1) continue;
      for (const attr of [...node.attributes]) if (!next.hasAttribute(attr.name)) node.removeAttribute(attr.name);
      for (const attr of next.attributes) if (node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name, attr.value);
      if (next.hasAttribute('data-token')) {
        originals.set(node, next);
        if (canonical.get(node) !== next.innerHTML || !live && node.innerHTML !== next.innerHTML) {
          node.innerHTML = next.innerHTML; originals.reset.add(node);
        }
        canonical.set(node, next.innerHTML);
      } else sync(node, next);
    }
    for (let i = fresh.length; i < old.length; i++) old[i].remove();
  }
  // Insertion slots belong to the live projection, not the Fountain renderer.
  for (const slot of main.querySelectorAll('[data-insertion]')) slot.remove();
  sync(main, template.content);
  const nodes=[...main.querySelectorAll('[data-token]')];
  for(let i=0;i<parts.length;i++){parts[i].node=nodes[i];parts[i].original=originals.get(nodes[i]);}
  documents.set(main,{skeleton,parts,live});
  return originals;
}
