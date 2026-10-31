'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const data=require('../public/essay-guidance-data'),guide=require('../public/essay-guidance');
const bank=require('../content/writing-lab.json').predictionEssays;
const source=fs.readFileSync(path.join(__dirname,'../public/index.js'),'utf8');

test('all reviewed prompts have complete exact-span explanations and three justified alternatives',()=>{
  assert.equal(data.guides.length,32);
  assert.equal(new Set(data.guides.map(q=>q.n)).size,32);
  assert.equal(data.guides.reduce((n,q)=>n+q.approaches.length,0),96);
  const seen=new Set();
  for(const q of data.guides){
    assert(q.meaning&&q.requirements&&q.experience&&q.check&&q.pitfall);
    for(const variant of [q,...q.aliases]){
      assert(!seen.has(guide.normalize(variant.prompt)),`duplicate binding ${q.n}`);seen.add(guide.normalize(variant.prompt));
      assert(variant.promptBreakdown.length>=2);
      for(const part of variant.promptBreakdown){assert(variant.prompt.includes(part.quote),`Q${q.n}: ${part.quote}`);assert(part.explanation.length>40);}
      assert.equal(guide.lookup(variant.prompt).n,q.n);
    }
    for(const a of q.approaches)for(const key of ['label','stance','bp1_heading','bp1','example1','bp2_heading','bp2','example2','why'])assert(a[key]?.length>0,`Q${q.n} ${key}`);
  }
});
test('30 live predictions match reviewed wording, without renumbering or attaching excluded topics',()=>{
  assert.equal(bank.length,33);
  const covered=bank.filter(q=>guide.lookup(q.text));
  assert.equal(covered.length,30);
  assert.deepEqual(bank.filter(q=>!guide.lookup(q.text)).map(q=>q.predictionNumber),[24,32,33]);
  assert.equal(guide.lookup(bank[0].text).n,2,'Portal #1 is handbook Q2, not handbook Q1');
  for(const q of covered){const html=guide.bodyHTML(q.text,guide.lookup(q.text));assert(html.includes('data-guide-prompt'));}
});
test('binding accepts typography but rejects changed instructions, evidence rules and similar topics',()=>{
  const q=data.guides[0];
  assert.equal(guide.lookup(q.prompt.replace(/'/g,'’').replace(/ /g,'  ')).n,q.n);
  assert.equal(guide.lookup(q.prompt.replace('Suggest some alternative actions.','Discuss the advantages.')),null);
  assert.equal(guide.lookup(data.guides[1].prompt.replace('your own experience','examples')),null);
  assert.equal(guide.lookup('Television relaxation and companionship'),null);
  const or=data.guides.find(q=>/experiences? or examples/i.test(q.prompt));
  assert(or);assert.equal(guide.lookup(or.prompt.replace(/(experiences?) or examples/i,'$1 and examples')),null);
  assert.equal(or.personalRequired,false);
  assert(!guide.bodyHTML(or.prompt,or).includes('replace them with a relevant experience that actually happened to you'));
  assert.deepEqual(data.guides.filter(q=>q.personalRequired).map(q=>q.n),[2,3,9,18,23,25]);
});
test('one-page markup puts each explanation immediately after its own button and escapes custom prompts',()=>{
  const html=guide.bodyHTML(data.guides[0].prompt,data.guides[0]);
  assert(html.indexOf('Understand the question')<html.indexOf('Choose an approach'));
  assert.doesNotMatch(html,/role="tab|data-guide-plan|Plan your essay/);
  for(const id of ['0','1','2','own'])assert.match(html,new RegExp('aria-controls="essay-guide-route-'+id+'"[\\s\\S]*?</button><section id="essay-guide-route-'+id+'"[^>]* hidden'));
  assert.equal((html.match(/data-guide-explanation hidden/g)||[]).length,4);
  assert(guide.bodyHTML('<img src=x onerror=alert(1)>',null).includes('&lt;img'));
  assert(!guide.bodyHTML('<img src=x>',null).includes('<img'));
  assert.match(html,/selecting an approach does not affect your marks/);
});
test('seen and auto-show preferences are bound to account, exact prompt and version; unavailable storage is safe',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const controller=guide.createController({storage}),q=data.guides[0].prompt;
  assert.equal(controller.shouldShow('alice',q),true);assert.equal(controller.shouldShow('',q),false);
  values.set('ipt_essay_guide:'+data.version+':alice',JSON.stringify({seen:[guide.normalize(q)]}));
  assert.equal(controller.shouldShow('alice',q),false);assert.equal(controller.shouldShow('bob',q),true);
  assert.equal(controller.shouldShow('alice',data.guides[1].prompt),true);
  values.set('ipt_essay_guide:'+data.version+':alice',JSON.stringify({autoShow:false}));
  assert.equal(controller.shouldShow('alice',data.guides[1].prompt),false);
  assert.equal(controller.shouldShow('alice','Unreviewed question wording'),false);
  values.set('ipt_essay_guide:'+data.version+':alice','corrupt');assert.equal(controller.shouldShow('alice',q),true);
  assert.equal(guide.createController({storage:{getItem(){throw Error('blocked');}}}).shouldShow('alice',q),true);
});

function integration(){
  const state={view:'write',writeStep:1,questionText:data.guides[0].prompt,questionTitle:'Synthetic question',selectedQuestionId:'q',essayText:'',timerStartedAt:null};
  const ctx={practiceState:state,currentUserId:'alice',sessionToken:'token-a',portalWorkspace:{current:()=>ctx.section},section:'practice',calls:[],document:{getElementById:()=>({focus:()=>ctx.calls.push('focus')})},resetPracticeTimer(){ctx.calls.push('reset');state.timerStartedAt=null;},renderPracticeMain(){ctx.calls.push('render');},toast(){ctx.calls.push('toast');},window:{PortalExamMode:{isActive:()=>ctx.exam},EssayGuide:{shouldShow:()=>true,open(options){ctx.pending=options;return true;}}}};
  vm.createContext(ctx);
  for(const name of ['startExamSimulator','openPracticeEssayGuide']){
    const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);
    vm.runInContext(source.slice(start,end),ctx);
  }
  return ctx;
}
test('before-start guide does not start the clock; one continuation enters the editor only once',()=>{
  const c=integration();c.startExamSimulator();assert.equal(c.practiceState.writeStep,1);assert.deepEqual(c.calls,[]);
  c.pending.onContinue();assert.equal(c.practiceState.writeStep,2);assert.equal(c.practiceState.timerStartedAt,null);
  assert.deepEqual(c.calls,['reset','render','focus']);c.pending.onContinue();c.startExamSimulator();assert.equal(c.calls.length,3);
});
test('stale callbacks cannot start another account, question, workspace or exam',()=>{
  for(const mutate of [c=>c.currentUserId='bob',c=>c.sessionToken='token-b',c=>c.practiceState.questionText='Changed prompt',c=>c.practiceState.selectedQuestionId='other',c=>c.section='writing-run',c=>c.exam=true]){
    const c=integration();c.startExamSimulator();mutate(c);assert.equal(c.pending.isCurrent(),false);c.pending.onContinue();assert.equal(c.practiceState.writeStep,1);assert.deepEqual(c.calls,[]);
  }
});
test('manual guidance preserves the essay and running timestamp and cannot open in mocks',()=>{
  const c=integration();c.practiceState.writeStep=2;c.practiceState.essayText='My retained draft';c.practiceState.timerStartedAt=12345;
  c.openPracticeEssayGuide();assert.equal(c.pending.mode,'resume');assert(c.pending.isCurrent());c.pending.onContinue();
  assert.equal(c.practiceState.essayText,'My retained draft');assert.equal(c.practiceState.timerStartedAt,12345);assert.deepEqual(c.calls,['focus']);
  c.section='writing-run';c.openPracticeEssayGuide();assert.equal(c.pending.isCurrent(),false);
});
test('unreviewed prompts and disabled guidance still enter writing normally',()=>{
  const c=integration();c.window.EssayGuide.shouldShow=()=>false;c.startExamSimulator();assert.equal(c.practiceState.writeStep,2);assert.equal(c.pending,undefined);
  const missing=integration();delete missing.window.EssayGuide;missing.startExamSimulator();assert.equal(missing.practiceState.writeStep,2);
});
test('production asset hashes are current and the guide is only wired into standalone practice',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  for(const file of ['essay-guidance.js','essay-guidance-data.js','essay-guidance.css','index.js']){
    const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../public',file))).digest('hex').slice(0,12);
    assert(html.includes((file==='index.js'?'index.min.js?v=source-':file+'?v=')+'sha256-'+hash),file);
  }
  assert(html.indexOf('essay-guidance-data.js')<html.indexOf('essay-guidance.js'));
  assert(html.indexOf('essay-guidance.js')<html.indexOf('index.min.js'));
  for(const file of ['writing-lab-client.js','full-mock-client.js'])assert(!fs.readFileSync(path.join(__dirname,'../public',file),'utf8').includes('EssayGuide'));
});
