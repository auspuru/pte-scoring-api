'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateTimesSeen,validPassageId,normalizeReportRows,installSwtExamReports}=require('../swt-exam-reports');
test('validates exact whole-number counts including withdraw',()=>{
  for(const n of [0,1,5,50])assert.equal(validateTimesSeen(n),n);
  for(const n of [-1,51,1.5,'5',null,NaN,Infinity])assert.equal(validateTimesSeen(n),null);
});
test('rejects invalid IDs and malicious route strings',()=>{
  assert.equal(validPassageId('950001'),950001);
  for(const id of ['0','-1','1 OR 1=1','1.5','NaN','',null])assert.equal(validPassageId(id),null);
});
test('aggregates student reports without leaking identity',()=>{
  const rows=normalizeReportRows([{passage_id:950001,total_encounters:'5',reporter_count:'2'}],[{passage_id:950001,times_seen:2}]);
  assert.deepEqual(rows['950001'],{studentReportedTimes:5,reporterCount:2,myTimes:2});
  assert.equal(rows['950001'].username,undefined);
});
function fakeApp(){
  const routes={};return {routes,get:(p,...handlers)=>routes['GET '+p]=handlers,post:(p,...handlers)=>routes['POST '+p]=handlers};
}
async function invoke(chain,req){
  let status=200,output,headers={};
  const res={get headers(){return headers},set(k,v){headers[k]=v;return this;},status(n){status=n;return this;},json(d){output=d;return this;}};
  req.get=k=>req.headers?.[k.toLowerCase()];
  for(const fn of chain){let called=false;await fn(req,res,()=>{called=true;});if(!called)break;}
  return {status,output,headers};
}
test('requires genuine login and rejects spoofed identity',async()=>{
  const app=fakeApp();installSwtExamReports(app,{pool:{query:async()=>({rows:[]})},verifyToken:t=>t==='good'?'student1':null,getAccount:async()=>({}),getPassage:async()=>({questionSet:'nov23-2026-swt'})});
  const ret=await invoke(app.routes['POST /api/swt/exam-reports/:passageId'],{headers:{'x-session-token':'bad'},params:{passageId:'950001'},body:{timesSeen:5,username:'student2'}});
  assert.equal(ret.status,401);
});
test('upsert does not add repetitions when user updates their total',async()=>{
  const calls=[],app=fakeApp();const pool={query:async(sql,params=[])=>{calls.push({sql,params});return {rows:[{total_encounters:3,reporter_count:1}]};}};
  installSwtExamReports(app,{pool,verifyToken:()=> 'student1',getAccount:async()=>({}),getPassage:async()=>({questionSet:'nov23-2026-swt'})});
  const ret=await invoke(app.routes['POST /api/swt/exam-reports/:passageId'],{headers:{'x-session-token':'valid'},params:{passageId:'950001'},body:{timesSeen:3,username:'student2'}});
  assert.equal(ret.status,200);assert.equal(calls[0].params[0],'student1');assert.equal(calls[0].params[2],3);
  assert.match(calls[0].sql,/ON CONFLICT\(username,passage_id\)/);
});
test('withdrawal deletes only the current student report',async()=>{
  const calls=[],app=fakeApp(),pool={query:async(sql,params=[])=>{calls.push({sql,params});return {rows:[{total_encounters:0,reporter_count:0}]};}};
  installSwtExamReports(app,{pool,verifyToken:()=> 'student1',getAccount:async()=>({}),getPassage:async()=>({questionSet:'nov23-2026-swt'})});
  const ret=await invoke(app.routes['POST /api/swt/exam-reports/:passageId'],{headers:{'x-session-token':'valid'},params:{passageId:'950001'},body:{timesSeen:0}});
  assert.equal(ret.status,200);assert.match(calls[0].sql,/DELETE/);assert.deepEqual(calls[0].params,['student1',950001]);
});
test('rejects reports for older or missing passages',async()=>{
 const app=fakeApp(),pool={query:async()=>{throw Error('should not query')}};
 installSwtExamReports(app,{pool,verifyToken:()=> 'student1',getAccount:async()=>({}),getPassage:async()=>({questionSet:'other'})});
 const ret=await invoke(app.routes['POST /api/swt/exam-reports/:passageId'],{headers:{'x-session-token':'valid'},params:{passageId:'950001'},body:{timesSeen:2}});
 assert.equal(ret.status,404);
});
