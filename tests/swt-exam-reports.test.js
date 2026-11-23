'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validPassageId,normalizeReportRows,readSwtReportCounts,installSwtExamReports}=require('../swt-exam-reports');

test('validates passage IDs and rejects injection',()=>{
  assert.equal(validPassageId('950001'),950001);
  for(const id of [null,'','0','-1','1.5','1 OR 1=1','NaN',{}])assert.equal(validPassageId(id),null);
});
test('aggregates one report per student without exposing usernames',()=>{
  const data=normalizeReportRows([{passage_id:950001,reporter_count:'3'}],[{passage_id:950001}]);
  assert.deepEqual({...data[950001]},{reporterCount:3,myReported:true});
  assert.equal(data[950001].username,undefined);
});
test('reading community counts produces numeric question-ID map',async()=>{
  const data=await readSwtReportCounts({query:async()=>({rows:[{passage_id:'10',reporter_count:'3'}]})});
  assert.equal(data.get(10),3);
});
function fakeApp() {
  const routes={};return {routes,get:(p,...handlers)=>routes['GET '+p]=handlers,post:(p,...handlers)=>routes['POST '+p]=handlers};
}
async function invoke(handlers,request) {
  let status=200,result;
  request.get=key=>request.headers?.[key.toLowerCase()];
  const response={set(){return this;},status(n){status=n;return this;},json(data){result=data;return this;}};
  for(const handler of handlers) {
    let passed=false;
    await handler(request,response,()=>{passed=true;});
    if(!passed)break;
  }
  return {status,result};
}
const request=(username='studentA',passageId='7')=>({headers:{'x-session-token':username},params:{passageId},body:{username:'spoofed-other-user'}});
function db() {
  const reports=new Map(),queries=[];
  const pool={async query(sql,params=[]) {
    queries.push({sql,params});
    if(sql.includes('INSERT INTO swt_exam_question_reports')) {
      const key=params.join(':');
      if(reports.has(key))return {rowCount:0,rows:[]};
      reports.set(key,true);return {rowCount:1,rows:[{passage_id:params[1]}]};
    }
    if(sql.includes('WHERE passage_id=$1')) {
      const count=[...reports.keys()].filter(key=>key.endsWith(':'+params[0])).length;
      return {rows:[{reporter_count:count}]};
    }
    if(sql.includes('WHERE username=$1')) {
      return {rows:[...reports.keys()].filter(key=>key.startsWith(params[0]+':')).map(key=>({passage_id:Number(key.split(':')[1])}))};
    }
    if(sql.includes('GROUP BY passage_id')){
      const counts=new Map();
      for(const key of reports.keys()){const id=Number(key.split(':')[1]);counts.set(id,(counts.get(id)||0)+1);}
      return {rows:[...counts.entries()].map(([passage_id,reporter_count])=>({passage_id,reporter_count}))};
    }
    throw Error('Unexpected SQL');
  }};
  return {pool,queries,reports};
}
test('rejects unsigned or impersonation token',async()=>{
  const {pool}=db(),app=fakeApp();
  installSwtExamReports(app,{pool,verifyToken:t=>t==='valid'?'studentA':null,getAccount:async()=>({}),getPassage:async()=>({id:7})});
  assert.equal((await invoke(app.routes['POST /api/swt/exam-reports/:passageId'],request('invalid'))).status,401);
});
test('one click reports once; repeated clicks cannot inflate counts',async()=>{
  const {pool,reports}=db(),app=fakeApp();
  installSwtExamReports(app,{pool,verifyToken:t=>t,getAccount:async()=>({}),getPassage:async()=>({id:7})});
  const route=app.routes['POST /api/swt/exam-reports/:passageId'];
  const first=await invoke(route,request());
  const second=await invoke(route,request());
  assert.equal(first.status,200);assert.equal(first.result.report.reporterCount,1);
  assert.equal(first.result.alreadyReported,false);
  assert.equal(second.result.alreadyReported,true);
  assert.equal(second.result.report.reporterCount,1);
  assert.equal(reports.size,1);
});
test('different students each contribute one report',async()=>{
  const {pool}=db(),app=fakeApp();
  installSwtExamReports(app,{pool,verifyToken:t=>t,getAccount:async()=>({}),getPassage:async()=>({id:7})});
  const route=app.routes['POST /api/swt/exam-reports/:passageId'];
  await invoke(route,request('studentA'));
  const second=await invoke(route,request('studentB'));
  assert.equal(second.result.report.reporterCount,2);
  const mine=await invoke(app.routes['GET /api/swt/exam-reports'],request('studentB'));
  assert.equal(mine.result.reports[7].myReported,true);
});
test('old and newly imported SWT passages can be reported',async()=>{
  const {pool}=db(),app=fakeApp();
  installSwtExamReports(app,{pool,verifyToken:t=>t,getAccount:async()=>({}),getPassage:async id=>id===7?{id}:id===8?{id,questionSet:'nov23-2026-swt'}:null});
  const route=app.routes['POST /api/swt/exam-reports/:passageId'];
  assert.equal((await invoke(route,request('A','7'))).status,200);
  assert.equal((await invoke(route,request('B','8'))).status,200);
  assert.equal((await invoke(route,request('C','9'))).status,404);
});
test('account access is required',async()=>{
  const {pool}=db(),app=fakeApp();
  installSwtExamReports(app,{pool,verifyToken:t=>t,getAccount:async()=>({blocked:true}),getPassage:async()=>({id:7})});
  assert.equal((await invoke(app.routes['POST /api/swt/exam-reports/:passageId'],request())).status,403);
});
