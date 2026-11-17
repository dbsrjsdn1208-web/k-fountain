export const VIEW_DEFAULTS={source:true,preview:true,size:14,horizontal:32,vertical:45};
const clamp=(n,min,max,fallback)=>Number.isFinite(+n)?Math.max(min,Math.min(max,+n)):fallback;
export function validateView(value={}){
  const view={source:value.source!==false,preview:value.preview!==false,size:clamp(value.size??14,10,40,14),horizontal:clamp(value.horizontal??32,20,80,32),vertical:clamp(value.vertical??45,20,80,45)};
  if(!view.source&&!view.preview)view.source=true;
  return view;
}
export function installViewControls({doc,input,frame,isBusy=()=>false,onLayout=()=>{},restoreFocus=()=>{}}){
  const win=doc.defaultView,key='k-fountain.view.v1',$=s=>doc.querySelector(s),main=$('#main-app'),divider=$('#pane-divider');
  const choices=[...doc.querySelectorAll('[data-layout]')];
  let view={...VIEW_DEFAULTS},pending=null,focusPending=false,drag=null;
  try{view=validateView(JSON.parse(win.localStorage.getItem(key)||'{}'));}catch{}
  const narrow=win.matchMedia('(max-width:700px)');
  const apply=()=>{
    input.hidden=!view.source;frame.parentElement.hidden=!view.preview;divider.hidden=!(view.source&&view.preview);
    main.classList.toggle('single-pane',divider.hidden);
    main.style.setProperty('--source-share',view[narrow.matches?'vertical':'horizontal']);
    input.style.fontSize=view.size+'px';
    const layout=view.source?(view.preview?'split':'source'):'preview';
    for(const choice of choices)choice.setAttribute('aria-pressed',String(choice.dataset.layout===layout));
    $('#source-size').value=view.size;
    divider.setAttribute('aria-orientation',narrow.matches?'horizontal':'vertical');
    divider.setAttribute('aria-valuenow',String(view[narrow.matches?'vertical':'horizontal']));
    try{win.localStorage.setItem(key,JSON.stringify(view));}catch{}
    onLayout(view);
  };
  const change=patch=>{if(isBusy()){pending={...(pending||{}),...patch};return;}view=validateView({...view,...patch});apply();};
  const flush=()=>{if(pending&&!isBusy()){const patch=pending;pending=null;change(patch);if(focusPending){focusPending=false;restoreFocus();}}};
  function selectLayout(layout,{focus=false}={}){
    change({source:layout!=='preview',preview:layout!=='source'});
    if(focus){if(isBusy())focusPending=true;else restoreFocus();}
  }
  for(const choice of choices)choice.onclick=()=>selectLayout(choice.dataset.layout,{focus:true});
  $('#source-size').onchange=e=>change({size:e.target.value});
  $('#view-reset').onclick=()=>change({...VIEW_DEFAULTS});
  input.addEventListener('wheel',e=>{if(!e.ctrlKey||!e.deltaY)return;e.preventDefault();change({size:view.size+(e.deltaY<0?1:-1)});},{passive:false});
  const ratio=e=>{const r=main.getBoundingClientRect();return 100*(narrow.matches?(e.clientY-r.top)/r.height:(e.clientX-r.left)/r.width);};
  divider.addEventListener('pointerdown',e=>{
    if(e.button!==0||isBusy())return;e.preventDefault();drag=e.pointerId;divider.setPointerCapture(drag);main.classList.add('resizing');
  });
  divider.addEventListener('pointermove',e=>{if(drag===e.pointerId)change({[narrow.matches?'vertical':'horizontal']:ratio(e)});});
  const end=()=>{drag=null;main.classList.remove('resizing');};
  divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);divider.addEventListener('lostpointercapture',end);
  divider.addEventListener('dblclick',()=>change({horizontal:32,vertical:45}));
  divider.addEventListener('keydown',e=>{
    const axis=narrow.matches?'vertical':'horizontal',down=narrow.matches?'ArrowDown':'ArrowRight',up=narrow.matches?'ArrowUp':'ArrowLeft';
    if([down,up,'Home','End'].includes(e.key)){e.preventDefault();change({[axis]:e.key==='Home'?20:e.key==='End'?80:view[axis]+(e.key===down?5:-5)});}
  });
  narrow.addEventListener('change',apply);apply();
  return {get state(){return {...view};},flush,selectLayout};
}
