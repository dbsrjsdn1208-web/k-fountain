export class FileSession {
  constructor(api=globalThis){this.api=api;this.handle=null;this.lastSaved=null;this.busy=false;this.beforeWrite=null;}
  get supported(){return typeof this.api.showSaveFilePicker==='function';}
  async open(){
    const [handle]=await this.api.showOpenFilePicker({types:[{description:'Fountain 원고',accept:{'text/plain':['.fountain','.txt']}}],multiple:false});
    const file=await handle.getFile();return {handle,file,text:await file.text()};
  }
  async save(text,name,as=false){
    if(this.busy)throw Error('이전 저장이 끝난 뒤 다시 시도해 주세요.');
    this.busy=true;
    try{
      const handle=as||!this.handle?await this.api.showSaveFilePicker({suggestedName:name,id:'k-fountain-source',startIn:this.handle||'documents',types:[{description:'Fountain 원고',accept:{'text/plain':['.fountain']}}]}):this.handle;
      if(handle.queryPermission&&await handle.queryPermission({mode:'readwrite'})!=='granted'){
        if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('파일 저장 권한이 필요합니다. 다시 저장하거나 다른 이름으로 저장해 주세요.');
      }
      if(this.beforeWrite&&handle.getFile){const old=await handle.getFile();const previous=await old.text();if(previous&&previous!==text)await this.beforeWrite({title:handle.name,text:previous});}
      const stream=await handle.createWritable();
      try{await stream.write(text);await stream.close();}catch(error){try{await stream.abort();}catch{}throw error;}
      this.handle=handle;this.lastSaved=text;return handle;
    }finally{this.busy=false;}
  }
}
export function handleDB(action,value){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('k-fountain-files',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('handles');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('handles',action==='get'?'readonly':'readwrite'),s=tx.objectStore('handles');
      const op=action==='get'?s.get('current'):action==='delete'?s.delete('current'):s.put(value,'current');
      tx.oncomplete=()=>{db.close();resolve(op.result);};tx.onerror=()=>{db.close();reject(tx.error);};
    };
  });
}
