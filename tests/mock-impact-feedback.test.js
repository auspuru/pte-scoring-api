'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const impact=require('../public/mock-impact-feedback');
const layout=require('../public/mock-report-ui');
const {lab,labContext}=require('../mock-feedback');
const {PROFILES}=require('../full-mock/profiles');
const group=(type,earned,possible=100)=>({type,label:type,count:1,earned,possible,complete:true});
test('Priorities follow weighted lost contribution, not lowest accuracy or question count',()=>{
  const input={groups:[group('di',60),{...group('ra',0),count:20}],profiles:{speaking:PROFILES.speaking}};
  input.profiles={speaking:{weights:{di:31,ra:9}}};
  const saved=JSON.stringify(input),feedback=impact.build(input);
  assert.deepEqual(feedback.priorities.map(p=>p.type),['di','ra']);
  assert.equal(JSON.stringify(input),saved);
  assert(!JSON.stringify(feedback).includes('weightedFraction'));
});
test('Overall and individual skills use independent profiles and correct integrated routes',()=>{
  const result=impact.build({groups:[group('rs',30),group('di',60)],profiles:{overall:{weights:{rs:7,di:15}},speaking:{weights:{rs:16,di:31}},listening:{weights:{rs:17}}}});
  assert.equal(result.profiles[0].priorities[0].type,'di');
  assert.equal(result.profiles[2].priorities[0].type,'rs');
  assert.deepEqual(result.profiles[0].priorities.find(p=>p.type==='rs').skills,['Speaking','Listening']);
  assert.deepEqual(result.profiles[0].priorities.find(p=>p.type==='di').skills,['Speaking']);
});
test('Pending, invalid and absent assessments are never converted into weaknesses or strengths',()=>{
  for(const bad of [{...group('essay',0),complete:false},group('essay',101),group('essay',NaN),group('essay',0,0)]){
    const result=impact.build({groups:[bad],profiles:{writing:{weights:{essay:31}}}});
    assert.equal(result.status,'pending');assert.deepEqual(result.priorities,[]);assert.deepEqual(result.profiles[0].strengths,[]);
  }
  assert.equal(impact.build({groups:[],profiles:{writing:{weights:{essay:31}}}}).status,'pending');
});
test('Confirmed blanks and zero gates remain lost contribution, while perfect results get no fabricated weakness',()=>{
  const zero=impact.build({groups:[group('essay',0)],profiles:{writing:{weights:{essay:31}}}});
  assert.equal(zero.priorities[0].type,'essay');assert.equal(zero.profiles[0].strengths.length,0);
  const perfect=impact.build({groups:[group('essay',100)],profiles:{writing:{weights:{essay:31}}}});
  assert.equal(perfect.priorities.length,0);assert.equal(perfect.profiles[0].strengths.length,1);
});
test('Published less-than-one weights remain bounded; no exact value or score gain is exposed',()=>{
  const result=impact.build({groups:[group('mcsa',0),group('di',80)],profiles:{overall:{weights:{mcsa:'<1',di:15}}}});
  assert.equal(result.priorities[0].type,'di');
  assert(!/0\.5|guarantee|increase.*points/i.test(JSON.stringify(result)));
});
test('Sectional Writing uses its saved task marks; Listening follows its actual native-point result',()=>{
  const a={kind:'mock',module:'writing',status:'submitted',questions:[{type:'swt'},{type:'essay'}],answers:['A summary.','An essay.'],results:[{total:0,maximum:9},{total:13,maximum:26}]};
  const saved=JSON.stringify(a),feedback=lab(a);
  assert.equal(feedback.priorities[0].type,'swt');
  assert(feedback.priorities[0].skills.includes('Reading'));
  assert.equal(JSON.stringify(a),saved);
  const listening={...a,module:'listening',questions:[{type:'hcs',maximum:1},{type:'lfi',answers:['a','b','c','d','e','f']}],answers:['',''],results:[{total:0,maximum:1},{total:3,maximum:6}]};
  assert.equal(lab(listening).priorities[0].type,'lfi');
  assert.equal(lab({...a,status:'active'}),null);
});
test('A changed confirmed grade updates score context; provisional marks stay pending',()=>{
  const a={kind:'mock',status:'submitted',questions:[{type:'essay'}],answers:['Original answer.'],results:[{total:13,maximum:26}]};
  const before=labContext(a);a.results[0].total=26;
  assert.notDeepEqual(labContext(a),before);assert.equal(lab(a).priorities.length,0);
  a.results[0].score_provisional=true;assert.equal(labContext(a).verifiedMarks[0].status,'pending');assert.equal(lab(a).status,'pending');
});
test('AI writing request receives verified marks; normalisation enforces contribution priority order and invalidates stale feedback',()=>{
  const overall=require('../writing-mock-overall');
  const a={kind:'mock',status:'submitted',questions:[{type:'swt',text:'Source'},{type:'essay',text:'Topic'}],answers:['A summary.','An essay.'],results:[{total:0,maximum:9},{total:13,maximum:26}]};
  const context=JSON.parse(overall.request(a,'fake').messages[0].content).scoreContext;
  assert.equal(context.verifiedMarks[0].total,0);assert.equal(context.feedback.priorities[0].type,'swt');
  const raw={summary:'Improve accuracy.',strengths:[],nextSteps:[{title:'Essay',advice:'Develop the argument.',questionIndices:[1]}],coverage:{q0:{observation:'Summary.',evidenceId:0,status:'reviewed'},q1:{observation:'Essay.',evidenceId:0,status:'reviewed'}}};
  const normal=overall.normalize(a,raw);assert.equal(normal.nextSteps[0].title,'Summarise Written Text');assert.deepEqual(normal.nextSteps[0].questionIndices,[0]);
  const before=overall.fingerprint(a);a.results[0].total=9;assert.notEqual(overall.fingerprint(a),before);
});
test('Speaking coaching uses active Azure marks, excludes authorised omissions, and cannot reuse stale acoustic advice',()=>{
  const reporting=require('../speaking-mock-report'),{speaking}=require('../mock-feedback');
  const a={id:'test',status:'submitted',questionCount:2,index:2,questions:[{type:'di'},{type:'rs'}],responses:[
    {recording:{hash:'a'},transcript:'Spoken evidence.',content:{total:3,maximum:6,scoringMode:'ai',improvements:['Connect the features.']},azure:{status:'assessed',recordingHash:'a',pronunciation:{score:3,coaching:'Practise clear endings.'},fluency:{score:5}}},
    {skipped:true}
  ]};
  const before=JSON.stringify(a),r=reporting.summarize(a).azure,feedback=speaking(a,r);
  assert.equal(feedback.status,'complete');assert(feedback.priorities.find(p=>p.type==='rs').skills.includes('Listening'));
  assert.equal(feedback.priorities.find(p=>p.type==='di').examples[0].observation,'Practise clear endings.');
  assert.equal(JSON.stringify(a),before);
  a.responses[0].azure.recordingHash='stale';assert.equal(speaking(a,reporting.summarize(a).azure).status,'pending');
  const excluded={...r,byType:r.byType.filter(g=>g.type!=='rs'),questions:r.questions.map(row=>row.type==='rs'?{...row,excluded:true,total:null}:row)};
  assert(!speaking(a,excluded).priorities.some(p=>p.type==='rs'));
});
test('Reading report replaces legacy first-question advice with contribution-aware priorities without scoring excluded audio',()=>{
  const reading=require('../public/reading-review');
  const session={name:'Saved mock',startedAt:1,finishedAt:60001,questions:[{type:'mcsa'},{type:'dropdown'}]};
  const total={percent:50,earned:4,possible:8,pending:0,excluded:1,rows:[{type:'mcsa',count:1,earned:0,gradedPossible:1,pending:0,excluded:0},{type:'dropdown',count:1,earned:4,gradedPossible:7,pending:0,excluded:0},{type:'hcs',count:1,earned:0,gradedPossible:0,pending:0,excluded:1}]};
  const {document}=parseHTML(reading.overview(session,total,{},[],{type:'all',filter:'all'}));
  assert(document.querySelector('[data-impact-profile="reading"]'));
  assert.match(document.querySelector('[data-reading-feedback]').textContent,/Fill in|dropdown/);
  assert(!document.querySelector('[data-impact-profile="reading"]').textContent.includes('hcs'));
});
test('Saved evidence is escaped, references actual questions, and ungrounded quotations are omitted',()=>{
  const a={kind:'mock',status:'submitted',questions:[{type:'essay'}],answers:['A real phrase.'],results:[{total:13,maximum:26,improvements:['<script>bad</script>'],errors:[{phrase:'Invented phrase',explanation:'Wrong quote'}]}]};
  const feedback=lab(a),markup=layout.impactFeedback(feedback),{document}=parseHTML(markup);
  assert.equal(document.querySelector('script'),null);assert.match(document.textContent||document.querySelector('section').textContent,/<script>/);
  assert.equal(feedback.priorities[0].examples[0].number,1);assert.equal(feedback.priorities[0].examples[0].quote,'');
});
test('Existing Full Mock reports refresh feedback without regrading or mutating saved marks and preserve historical weights',()=>{
  const {loadPaper,digest}=require('../full-mock/paper'),paper=loadPaper();
  const session=require('../full-mock/session'),assessment=require('../full-mock/assessment'),adapters=require('../full-mock/adapters');
  const {inputHash}=require('../full-mock/aggregation'),reports=require('../full-mock/report');
  const state=session.create(require('node:crypto').randomUUID(),paper,1000,{preview:true,assessmentSnapshot:assessment.snapshot()});
  session.end(state,paper,2000);
  for(const [index,candidate] of paper.questions.entries()){
    const q=candidate.question,maxima=adapters.maxima(q),scores={...maxima};
    if(q.type==='di')scores.content=0;
    if(q.type==='essay')for(const key of Object.keys(scores))scores[key]=0;
    state.assessment.items[candidate.id]={status:'assessed',inputHash:inputHash(state.responses[index+1]),snapshotHash:state.assessment.snapshotHash,result:adapters.result(q,scores),stages:{}};
  }
  const saved=JSON.stringify(state),report=reports.buildReport(paper,state);
  assert.equal(report.impactFeedback.profiles.length,5);assert.equal(report.priorities[0].type,'essay');
  assert.equal(JSON.stringify(state),saved);
  state.assessment.snapshot.weighting.profiles.overall.weights.di=100;
  state.assessment.snapshotHash=digest(state.assessment.snapshot);
  for(const job of Object.values(state.assessment.items))job.snapshotHash=state.assessment.snapshotHash;
  assert.equal(reports.buildReport(paper,state).priorities[0].type,'di');
});

test('Strength examples never present a saved correction quotation as evidence of success',()=>{
  const feedback=impact.build({groups:[group('essay',85)],profiles:{writing:{weights:{essay:31}}},items:[{type:'essay',number:1,status:'assessed',total:85,maximum:100,strength:'Relevant argument.',quote:'An actual error.'}]});
  assert.equal(feedback.profiles[0].strengths[0].examples[0].quote,'');
  assert.equal(feedback.profiles[0].priorities[0].examples[0].quote,'An actual error.');
});

test('Real RA and RS numeric error counts cannot break saved Speaking reports or history',()=>{
  const scoring=require('../speaking-scoring'),{present}=require('../speaking-mock');
  for(const type of ['ra','rs']){
    const q={id:'saved-'+type,type,text:'one two three four',title:'Saved question'},content=scoring.exact(q,'one two three');
    assert.equal(typeof content.errors,'number');assert(content.errors>0);
    const a={id:'saved-attempt',status:'submitted',questions:[q],index:1,questionCount:1,responses:[{recording:{hash:'saved'},transcript:'one two three',content,azure:{status:'assessed',pronunciation:{score:5},fluency:{score:5}}}]};
    const before=JSON.stringify(a),projection=present(a);
    assert.equal(projection.impactFeedback.status,'complete');assert.equal(JSON.stringify(a),before);
  }
});
