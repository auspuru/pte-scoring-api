(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PracticeStorage=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PREFIX='ipt_practice_backup_v1:';
  function create({local,session,database}={}){
    const pending=new Map(),backups=new Map(),writes=new Map(),versions=new Map();let db=null,clock=Date.now();
    const area=get=>{try{return typeof get==='function'?get():get;}catch{return null;}};
    const read=(get,key)=>{try{return area(get)?.getItem(key)??null;}catch{return null;}};
    const scoped=key=>/^pte_.+_(?:attempted|summaries|scores|history|essays|essayLibraryDeleted|vocabProgress|scratch|scratchUpdatedAt|essay-question-drafts|question-drafts|practiceHistory|practiceHistoryDeleted|syncPending|currentId|studyPlan)$/.test(key)||/^ipt_(?:essay_draft|reading)_v1:/.test(key);
    const backupKey=key=>PREFIX+encodeURIComponent(key);
    const ready=new Promise(resolve=>{
      try{
        const api=area(database);if(!api)return resolve(false);
        const open=api.open('ipt-practice-recovery',1);
        open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('records'))open.result.createObjectStore('records',{keyPath:'key'});};
        open.onerror=open.onblocked=()=>resolve(false);
        open.onsuccess=()=>{
          db=open.result;db.onversionchange=()=>{db.close();db=null;};
          const tx=db.transaction('records','readonly'),get=tx.objectStore('records').getAll();
          get.onsuccess=()=>{for(const record of get.result||[]){if(scoped(record.key)&&(typeof record.value==='string'||record.value===null)){backups.set(record.key,record);clock=Math.max(clock,record.revision||0);}}};
          tx.oncomplete=()=>resolve(true);tx.onerror=tx.onabort=()=>resolve(false);
        };
      }catch{resolve(false);}
    });
    function sessionRecord(key){try{const r=JSON.parse(read(session,backupKey(key))||'null');return r?.version===1&&(typeof r.value==='string'||r.value===null)?r:null;}catch{return null;}}
    function recordFor(key){const a=sessionRecord(key),b=backups.get(key);return !a?b:!b?a:(a.revision||0)>=(b.revision||0)?a:b;}
    function getItem(key){
      key=String(key);const active=pending.get(key);if(active)return active.value;
      const value=read(local,key),record=recordFor(key);
      // A legacy tab may have written newer local data. Never replace an
      // independently changed local value with an older recovery snapshot.
      return record&&(value===null||value===record.expectedLocal||value===record.value)?record.value:value;
    }
    function journal(key,record,remove=false){
      const previous=writes.get(key)||Promise.resolve();
      const job=previous.catch(()=>false).then(async()=>{
        if(!await ready||!db||!scoped(key))return false;
        return new Promise(resolve=>{
          try{
            const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
            if(remove)store.delete(key);else store.put({...record,key});
            tx.oncomplete=()=>{if(remove)backups.delete(key);else backups.set(key,{...record,key});if(pending.get(key)===record){record.durable=true;pending.delete(key);}resolve(true);};
            tx.onerror=tx.onabort=()=>resolve(false);
          }catch{resolve(false);}
        });
      });
      writes.set(key,job);return job;
    }
    function setItem(key,value){
      key=String(key);value=String(value);
      const prior=pending.get(key);
      if(prior?.value===value){if(prior.durable)return;journal(key,prior);throw Error('Practice backup is pending.');}
      const record={version:1,value,revision:clock=Math.max(Date.now(),clock+1),expectedLocal:read(local,key),durable:false};
      pending.set(key,record);versions.set(key,record.revision);
      try{
        const storage=area(local);if(!storage)throw Error('Unavailable');storage.setItem(key,value);record.expectedLocal=value;
        try{area(session)?.removeItem(backupKey(key));}catch{}
        record.durable=true;pending.delete(key);backups.delete(key);journal(key,record,true);return;
      }catch{}
      let sessionSaved=false;
      try{const storage=area(session);if(!storage)throw Error('Unavailable');storage.setItem(backupKey(key),JSON.stringify(record));sessionSaved=true;record.durable=true;pending.delete(key);}catch{}
      journal(key,record);
      if(!sessionSaved)throw Error('Practice backup is pending or unavailable.');
    }
    function removeItem(key){
      key=String(key);const record={version:1,value:null,revision:clock=Math.max(Date.now(),clock+1),expectedLocal:read(local,key),durable:false};pending.set(key,record);versions.set(key,record.revision);
      try{const storage=area(local);if(!storage)throw Error('Unavailable');storage.removeItem(key);record.expectedLocal=null;area(session)?.removeItem(backupKey(key));record.durable=true;pending.delete(key);backups.delete(key);journal(key,record,true);return;}catch{}
      try{const storage=area(session);if(!storage)throw Error('Unavailable');storage.setItem(backupKey(key),JSON.stringify(record));record.durable=true;pending.delete(key);}catch{}
      journal(key,record);if(!record.durable)throw Error('Practice removal is pending.');
    }
    const isDurable=key=>!pending.has(String(key))||pending.get(String(key)).durable;
    async function flush(keys){
      const selected=keys.map(String),snapshot=selected.map(key=>versions.get(key));
      await Promise.all(selected.map(key=>writes.get(key)||Promise.resolve()));
      return selected.every((key,i)=>isDurable(key)&&versions.get(key)===snapshot[i]);
    }
    return{ready,getItem,setItem,removeItem,isDurable,flush,hasPendingWrites:()=>[...pending.values()].some(r=>!r.durable)};
  }
  return{create};
});
