'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {create}=require('../public/practice-storage'),{createDraftStore}=require('../public/portal-workspace');
function area({failWrite=false,failRead=false}={}){const data=new Map();return{data,getItem:k=>{if(failRead)throw Error('Denied');return data.get(k)??null;},setItem:(k,v)=>{if(failWrite)throw Error('QuotaExceeded');data.set(k,String(v));},removeItem:k=>data.delete(k)};}
test('A full local cache falls back without removing its existing history and restores after reload',async()=>{
 const local=area({failWrite:true}),session=area(),key='pte_alice_summaries';local.data.set(key,'{"1":{"text":"Older saved text"}}');
 const store=create({local,session});await store.ready;store.setItem(key,'{"1":{"text":"New exact draft"}}');assert.equal(store.isDurable(key),true);
 const restored=create({local,session});await restored.ready;assert.equal(restored.getItem(key),'{"1":{"text":"New exact draft"}}');assert.equal(local.data.get(key),'{"1":{"text":"Older saved text"}}');assert.equal(session.data.size,1);
});
test('A backed-up value yields to an independent later legacy-tab local write',()=>{
 const local=area({failWrite:true}),session=area(),key='pte_alice_summaries';local.data.set(key,'old');const store=create({local,session});store.setItem(key,'recovery');local.data.set(key,'later legacy edit');assert.equal(store.getItem(key),'later legacy edit');
});
test('New durable local writes retire only their own temporary backup',()=>{
 const denied=area({failWrite:true}),session=area(),key='pte_alice_history';create({local:denied,session}).setItem(key,'retained');const local=area();create({local,session}).setItem(key,'current');assert.equal(session.data.size,0);assert.equal(create({local,session}).getItem(key),'current');
});
test('When every store is unavailable the current text is retained but no durable save is claimed',async()=>{
 const local=area({failWrite:true,failRead:true}),session=area({failWrite:true,failRead:true}),store=create({local,session}),key='pte_alice_summaries';
 assert.throws(()=>store.setItem(key,'Unsaved original'));assert.equal(store.getItem(key),'Unsaved original');assert.equal(store.isDurable(key),false);assert.equal(await store.flush([key]),false);assert.equal(store.hasPendingWrites(),true);
 const drafts=createDraftStore(store),state={view:'write',essayText:'Exact essay',questionText:'A question'};
 assert.equal(drafts.write('alice',state),false);assert.equal(drafts.read('alice').essayText,state.essayText);assert.equal(drafts.write('alice',state),false,'An identical retry must not turn memory-only into saved');assert.equal(drafts.read('bob'),null);
});
test('Removing a fallback prevents the old durable local answer from reappearing',()=>{
 const local=area({failWrite:true}),session=area(),key='pte_alice_history';local.data.set(key,'older');const store=create({local,session});store.setItem(key,'new');local.removeItem=()=>{throw Error('Denied');};store.removeItem(key);assert.equal(create({local,session}).getItem(key),null);
});
test('Practice storage keeps different account recovery keys separate',()=>{
 const local=area({failWrite:true}),session=area(),store=create({local,session});store.setItem('pte_alice_summaries','Alice draft');store.setItem('pte_bob_summaries','Bob draft');assert.equal(create({local,session}).getItem('pte_alice_summaries'),'Alice draft');assert.equal(create({local,session}).getItem('pte_bob_summaries'),'Bob draft');
});
test('Offline Essay history still includes server-backed in-memory attempts when the device cache is missing',()=>{
 const source=fs.readFileSync(require.resolve('../public/index'),'utf8'),start=source.indexOf('function getPracticeHistory('),end=source.indexOf('\nasync function savePracticeHistory',start),saved={id:'original',essayText:'Original answer',scores:{total:18}};
 const ctx={offlineMode:true,currentUserId:'alice',userProfile:{practiceHistory:[saved]},practiceHistoryDeleted:[],getCachedPracticeHistory:()=>[],mergePracticeHistoryClient:(a,b)=>[...a,...b]};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);assert.equal(ctx.getPracticeHistory()[0].id,saved.id);
});
