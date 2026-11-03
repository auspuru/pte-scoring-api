'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/index.js'),'utf8');
const snippet=source.slice(source.indexOf('function openSavedSwtResponse('),source.indexOf('function reviewSavedPractice('));
function fixture({history={},scores={},refresh=async()=>{}}={}){
 const shown=[],notices=[],screens=[];const progress={history,scores};
 const ctx={currentUserId:'alice',sessionToken:'synthetic-alice',portalWorkspace:{current:()=>ctx.route},route:'swt',passages:[{id:910174,title:'Synthetic passage'}],localAccountProgress:uid=>{assert.equal(uid,'alice');return progress;},LocalStore:{get:()=>null},setSwtPracticeMode(){},loadStoredData(){},populatePassageDropdowns(){},updateResultsNav(){},showResults:(...a)=>shown.push(a),showSwtScreen:a=>screens.push(a),toast:(...a)=>notices.push(a),refreshPracticeHistory:refresh};vm.createContext(ctx);vm.runInContext(snippet,ctx);return{ctx,shown,notices,screens,progress};
}
test('Saved SWT opens reconciled memory history when browser persistence failed, including an older confirmed zero',()=>{
 const old={timestamp:123,text:'Saved earlier response',overall_score:0,feedback:'Exact old feedback'},latest={timestamp:456,text:'Later response',overall_score:80};
 const f=fixture({history:{910174:[latest,old]},scores:{910174:{__timestamp:456,__text:latest.text,overall_score:80}}});
 f.ctx.openSavedSwtResponse({passageId:'910174',timestamp:'123',responseText:old.text});assert.equal(f.shown.length,1);assert.equal(f.shown[0][0].overall_score,0);assert.equal(f.shown[0][3],old.text);assert.equal(f.screens[0],'swtResultsScreen');assert.equal(f.notices.length,0);
});
test('Missing cache refreshes once and opens the exact restored response without scoring',async()=>{
 let calls=0;const saved={timestamp:'2026-11-03T00:00:00Z',text:'Cloud response',feedback:'Cloud feedback'};let f;
 f=fixture({refresh:async()=>{calls++;f.progress.history={910174:[saved]};return true;}});await f.ctx.openSavedSwtResponse({passageId:'910174',timestamp:saved.timestamp});assert.equal(calls,1);assert.equal(f.shown.length,1);assert.equal(f.shown[0][3],saved.text);
});
for(const change of ['account','token','route','newer-request'])test('Delayed saved response cannot overwrite '+change,async()=>{
 let finish;const wait=new Promise(r=>finish=r),f=fixture({refresh:()=>wait});const pending=f.ctx.openSavedSwtResponse({passageId:'910174',timestamp:123});
 f.progress.history={910174:[{timestamp:123,text:'Retained response'}]};
 if(change==='account')f.ctx.currentUserId='bob';if(change==='token')f.ctx.sessionToken='replacement';if(change==='route')f.ctx.route='progress';if(change==='newer-request')f.ctx.openSavedSwtResponse({passageId:'910174',timestamp:123});
 const before=f.shown.length;finish(true);await pending;assert.equal(f.shown.length,before);
});
test('A stale response identity or ambiguous URL does not open a different response',async()=>{
 for(const entry of [{timestamp:123,responseText:'Wrong text'},{timestamp:'123'}]){
  const f=fixture({history:{910174:[{timestamp:123,text:'One answer'},{timestamp:123,text:'Other answer'}]}});
  await f.ctx.openSavedSwtResponse({passageId:'910174',...entry});assert.equal(f.shown.length,0);assert.match(f.notices.at(-1)[0],/could not be loaded/);
 }
});
test('Attempted passage labels use the reconciled account history and stable passage IDs',()=>{
 const fragment=source.slice(source.indexOf('function loadStoredData('),source.indexOf('function setSwtPracticeMode('));
 const ctx={passages:[{id:910174},{id:910001}],attempted:new Set(),localAccountProgress:()=>({attempted:['910001'],history:{910174:[{timestamp:123,text:'Saved'}]}})};vm.createContext(ctx);vm.runInContext(fragment,ctx);ctx.loadStoredData();assert.deepEqual([...ctx.attempted],[910174,910001]);
});
