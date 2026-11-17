export function installToolbarMenus(toolbar, previewDoc) {
  const doc=toolbar.ownerDocument;
  let opened=null;
  function close(restore=false) {
    if(!opened)return;
    const {button,panel}=opened;
    opened=null;
    button.setAttribute('aria-expanded','false');
    panel.hidden=true;
    if(restore)button.focus();
  }
  for(const button of toolbar.querySelectorAll('[data-toolbar-menu]')) {
    const panel=doc.getElementById(button.getAttribute('aria-controls'));
    button.addEventListener('click',event=>{
      const wasOpen=opened?.button===button;
      close();
      if(wasOpen)return;
      opened={button,panel};
      button.setAttribute('aria-expanded','true');
      panel.hidden=false;
      if(event.detail===0)panel.querySelector('button,input')?.focus();
    });
    panel.addEventListener('click',event=>{
      if(event.target.closest('[data-menu-command]'))close(true);
    },{capture:true});
  }
  doc.addEventListener('pointerdown',event=>{
    if(opened&&!opened.button.contains(event.target)&&!opened.panel.contains(event.target))close();
  });
  doc.addEventListener('focusin',event=>{
    if(opened&&!opened.button.contains(event.target)&&!opened.panel.contains(event.target))close();
  });
  doc.addEventListener('keydown',event=>{
    if(opened&&event.key==='Escape'){event.preventDefault();close(true);}
  });
  previewDoc.addEventListener('pointerdown',()=>close());
}

export function installSceneOutline({panel,button,previewDoc,onJump,canJump}) {
  const doc=panel.ownerDocument,list=panel.querySelector('#scene-list'),search=panel.querySelector('input');
  const narrow=doc.defaultView.matchMedia('(max-width:700px)');
  let scenes=[],signature='',current=null,activeIndex=-1,activeButton=null;
  function markCurrent() {
    const next=list.querySelector('[data-scene="'+activeIndex+'"]');
    if(next===activeButton)return;
    activeButton?.removeAttribute('aria-current');
    activeButton=next;
    activeButton?.setAttribute('aria-current','location');
  }
  function locate(pos) {
    current=pos;
    let low=0,high=scenes.length;
    while(low<high){
      const mid=(low+high)>>>1;
      if(scenes[mid].pos<=pos)low=mid+1;else high=mid;
    }
    if(low-1!==activeIndex){
      activeIndex=low-1;
      if(!panel.hidden)markCurrent();
    }
  }
  function render() {
    if(panel.hidden)return;
    const query=search.value.trim().toLocaleLowerCase();
    const rows=doc.createDocumentFragment();
    for(const [index,scene] of scenes.entries()){
      if(query&&!(scene.label+' '+scene.title).toLocaleLowerCase().includes(query))continue;
      const item=doc.createElement('li'),jump=doc.createElement('button');
      jump.type='button';
      jump.dataset.scene=index;
      if(scene.label){
        const number=doc.createElement('span');
        number.className='scene-number';
        number.textContent=scene.label+' ';
        jump.append(number);
      }
      jump.append(scene.title);
      item.append(jump);
      rows.append(item);
    }
    list.replaceChildren(rows);
    panel.querySelector('#scene-empty').hidden=!!list.childElementCount;
    panel.querySelector('#scene-empty').textContent=scenes.length?'검색 결과가 없습니다.':'장면 제목을 추가하면 여기에 표시됩니다.';
    markCurrent();
    activeButton?.scrollIntoView?.({block:'nearest'});
  }
  function show(visible,restore=false) {
    panel.hidden=!visible;
    button.setAttribute('aria-expanded',String(visible));
    if(visible){render();search.focus();}
    else if(restore)button.focus();
  }
  function jump(item) {
    const scene=scenes[Number(item?.dataset.scene)];
    if(!scene||!canJump())return;
    if(narrow.matches)show(false);
    onJump(scene);
  }
  button.addEventListener('click',()=>show(panel.hidden));
  panel.querySelector('#scene-close').addEventListener('click',()=>show(false,true));
  panel.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();show(false,true);}
    if(event.target===search&&event.key==='Enter'){event.preventDefault();jump(list.querySelector('button'));}
  });
  search.addEventListener('input',render);
  list.addEventListener('click',event=>jump(event.target.closest('[data-scene]')));
  const dismiss=()=>{if(!panel.hidden&&narrow.matches)show(false);};
  doc.addEventListener('pointerdown',event=>{
    if(!panel.contains(event.target)&&!button.contains(event.target))dismiss();
  });
  previewDoc.addEventListener('pointerdown',dismiss);
  return {
    update(entries,pos){
      const next=JSON.stringify(entries);
      if(next!==signature){signature=next;scenes=entries;locate(pos);render();}
      else if(pos!==current)locate(pos);
    },
    locate,
  };
}
