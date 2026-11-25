'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const workspace=require('../public/portal-workspace');
const read=name=>fs.readFileSync(require.resolve('../public/'+name),'utf8');
const portal=read('index.js');
function functions(start,end){return portal.slice(portal.indexOf('function '+start+'('),portal.indexOf(end,portal.indexOf('function '+start+'(')));}
function progressContext(extra={}){
 const {document}=parseHTML('<html><head></head><body><div id="progressPane"></div></body></html>');
 const ctx={document,Date,AbortSignal,...extra};ctx.window=ctx;
 vm.createContext(ctx);vm.runInContext(read('student-progress.js'),ctx);return ctx;
}
test('Recent questions merge all practice engines newest first, retaining exact older SWT attempts and pending feedback',()=>{
 const ctx=progressContext();
 const m=ctx.StudentProgress.model({reading:{history:[{id:'read',practiceUid:'audio:1',done:true,finishedAt:40,questions:[{type:'hcs'}]}]},essays:[{id:'essay',questionTitle:'My essay',date:20,scores:{total:18}}],swt:{910498:[{text:'Newest summary',timestamp:50},{text:'Older summary',timestamp:10}]}},[{id:'sst',kind:'sst',status:'submitted',startedAt:30,total:null}], [{id:'rts',type:'rts',status:'submitted',startedAt:60,result:null}]);
 assert.deepEqual(Array.from(m.activity,a=>a.engine),['speaking','swt','reading','writing','essay','swt']);
 assert.equal(m.activity[0].status,'Assessment pending');
 assert.equal(m.activity[1].passageId,'910498');assert.equal(m.activity[1].timestamp,50);
 assert.equal(m.activity.at(-1).responseText,'Older summary');
 assert.equal(m.activity[2].route,'listening-hcs-bank');
});
test('Recent rows show exact saved marks and scales, retain zeros, and distinguish provisional and missing results',()=>{
 const ctx=progressContext();
 const data={essays:[{id:'older',date:1,scores:{total:0}},{id:'newer',date:2,scores:{total:21}},{id:'missing',date:3,scores:{total:null}}],essayDraft:{essayText:'An unfinished answer',updatedAt:20},swt:{1:[{timestamp:4,trait_scores:{content:3,form:1,grammar:2,vocabulary:2},overall_score:80},{timestamp:5,overall_score:72},{timestamp:6,score_provisional:true,overall_score:90}]},reading:{history:[{id:'reading-zero',practiceUid:'q1',done:true,startedAt:7,earned:0,possible:3,questions:[{type:'mcma'}]},{id:'reading-pending',practiceUid:'q2',done:true,pending:true,startedAt:8,earned:2,possible:3,questions:[{type:'mcma'}]}]}};
 const writing=[{id:'wfd',kind:'wfd',status:'submitted',startedAt:9,total:7,maximum:9},{id:'sst-pending',kind:'sst',status:'submitted',startedAt:10,total:null,maximum:12}];
 const speaking=[{id:'confirmed',type:'di',status:'submitted',startedAt:11,result:{total:5,maximum:6,scoringMode:'ai'}},{id:'provisional',type:'di',status:'submitted',startedAt:12,result:{total:6,maximum:6,scoringMode:'local'}}];
 const before=JSON.stringify({data,writing,speaking}),rows=ctx.StudentProgress.model(data,writing,speaking).activity;
 const score=id=>rows.find(r=>r.id===id).scoreText;
 assert.equal(score('older'),'0 / 26');assert.equal(score('newer'),'21 / 26');assert.equal(score('missing'),'Score unavailable');assert.equal(rows.some(row=>row.id==='essay-draft'),false);
 assert.equal(score('1:4'),'8 / 9');assert.equal(score('1:5'),'72 / 90 estimate');assert.equal(score('1:6'),'Pending');
 assert.equal(score('reading-zero'),'0 / 3');assert.equal(score('reading-pending'),'Pending');assert.equal(score('wfd'),'7 / 9');assert.equal(score('sst-pending'),'Pending');
 assert.equal(score('confirmed'),'5 / 6 content');assert.equal(score('provisional'),'Pending');
 assert.equal(JSON.stringify({data,writing,speaking}),before,'Displaying scores must never change saved marks');
});
test('Simple progress rows open exact responses, retain older pages, and reject a stale account click',async()=>{
 let user={uid:'alice',token:'alice-session'};const opened=[],routed=[];
 const ctx=progressContext();const essays=Array.from({length:23},(_,i)=>({id:'essay-'+i,date:i+1,questionTitle:i===22?'<img src=x onerror=alert(1)>':'Essay '+i,scores:{total:20}}));
 const controller=ctx.StudentProgress.create({document:ctx.document,identity:()=>user,navigate:r=>routed.push(r),review:a=>opened.push(a),loadLocal:async()=>({essays}),fetch:async()=>({ok:true,json:async()=>[]})});
 await controller.open();const host=ctx.document.getElementById('progressPane');
 assert.equal(host.querySelector('h3').textContent,'Recently submitted answers');
 assert.equal(host.querySelectorAll('[data-progress-attempt]').length,20);assert.equal(host.querySelector('.progress-attempt-score').textContent,'Score: 20 / 26');
 assert.equal(host.querySelectorAll('img').length,0);
 assert.doesNotMatch(host.textContent,/Task trends|Suggested focus|Cross-task percentages/);
 await host.onclick({target:host.querySelector('[data-progress-attempt="0"]')});
 assert.equal(opened[0].id,'essay-22');assert.deepEqual(routed,[]);
 host.querySelector('[data-progress-more]').click();
 assert.equal(host.querySelectorAll('[data-progress-attempt]').length,23);
 user={uid:'bob',token:'bob-session'};
 await host.onclick({target:host.querySelector('[data-progress-attempt="1"]')});assert.equal(opened.length,1);
});
test('Saved response links preserve attempt identities across every engine and URL refresh',()=>{
 const calls=[];const ctx={PortalWorkspace:workspace,switchSection:(...x)=>calls.push(x),resumePortalEssay:()=>calls.push(['draft'])};
 vm.createContext(ctx);vm.runInContext(functions('reviewSavedPractice','function openStudentProgress('),ctx);
 for(const entry of [{engine:'essay',id:'essay-old'},{engine:'swt',passageId:'910498',timestamp:'2026-10-01T00:00:00Z'},{engine:'speaking',id:'speaking-old',route:'speaking-rts'},{engine:'reading',id:'reading-old',route:'reading-dropdown'},{engine:'writing',id:'sst-old',route:'spoken-text'}])ctx.reviewSavedPractice(entry);
 for(const [route,options] of calls){
  const parsed=workspace.requestFromHash(options.routeHash,null,'alice');
  assert.equal(workspace.routeFromHash(options.routeHash),route);
  const request=parsed.essayRequest||parsed.swtRequest||parsed.speakingRequest||parsed.readingRequest||parsed.labRequest;
  assert.ok(request.attemptId||request.timestamp);
 }
 assert.equal(calls[2][1].speakingRequest.navigation,true,'Loaded Speaking runtime receives the complete review request');
 assert.equal(calls[4][1].labRequest.attemptId,'sst-old');
});
test('SWT review shows the selected historical response, not the newest answer or an editable draft',()=>{
 const older={text:'Older saved answer',timestamp:'2026-10-01T00:00:00Z',trait_scores:{content:2},feedback:'Older feedback'};
 const latest={text:'Latest saved answer',timestamp:'2026-10-02T00:00:00Z'};const shown=[],screens=[];
 const data={history:{910498:[latest,older]},scores:{910498:{__text:latest.text,__timestamp:latest.timestamp,feedback:'Latest feedback'}}};
 const ctx={passages:[{id:910498,title:'Origin of Species'},{id:1,title:'Other'}],LocalStore:{get:k=>data[k]},localAccountProgress:()=>data,currentUserId:'alice',sessionToken:'alice-token',portalWorkspace:{current:()=> 'swt'},loadStoredData(){},populatePassageDropdowns(){},getPteStorageKey:k=>k,setSwtPracticeMode(){},updateResultsNav(){},showResults:(...a)=>shown.push(a),showSwtScreen:s=>screens.push(s),toast:()=>assert.fail('Unexpected missing-response notice')};
 vm.createContext(ctx);vm.runInContext(functions('openSavedSwtResponse','function reviewSavedPractice('),ctx);
 ctx.openSavedSwtResponse({passageId:'910498',timestamp:older.timestamp,responseText:older.text});
 assert.equal(shown[0][0].feedback,'Older feedback');assert.equal(shown[0][3],older.text);assert.equal(ctx.currentPassageId,1);assert.equal(screens[0],'swtResultsScreen');
 assert.equal(data.history[910498][0].text,latest.text);
});
test('My Next Steps has no student or admin entry points or background loader',()=>{
 const html=read('index.html'),admin=read('admin.html');
 assert.doesNotMatch(html,/nav-next-steps|nextStepsPane|nextStepsDashboardCard/);
 assert.doesNotMatch(portal,/StudentInterventions|scheduleInterventionRefresh|interventions-client|launchAssignedQuestion/);
 assert.doesNotMatch(admin,/admin-interventions\.js/);
 assert.equal(workspace.routeFromHash('#/next-steps'),'progress');
 assert.equal(workspace.requestFromHash('#/next-steps?plan=old').routeHash,'#/progress');
 assert.match(portal,/api\/interventions\/swt-selection\/practice/,'Standalone SWT phrase practice remains available');
});
