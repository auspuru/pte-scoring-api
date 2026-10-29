'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const layout=require('../public/mock-report-ui');
const reading=require('../public/reading-review');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function browser(markup){
  const {window,document}=parseHTML('<html><body><main>'+markup+'</main></body></html>');
  layout.install(window);
  return {window,document,host:document.querySelector('main'),click:selector=>document.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}))};
}
test('Score report preserves saved scores, escapes identity and uses the original IPT logo',()=>{
  const {document}=parseHTML(layout.hero({title:'<script>bad</script>',user:'Student <1>',overall:'76–80',skills:[{name:'Speaking',value:null},{name:'Reading',value:0}]}));
  assert.equal(document.querySelector('.ipr-logo').getAttribute('src'),'/assets/ipt-brisbane-logo.png');
  assert.equal(document.querySelector('script'),null);
  assert.equal(document.querySelector('.ipr-overall strong').textContent,'76–80');
  assert.deepEqual([...document.querySelectorAll('.ipr-ring strong')].map(n=>n.textContent),['Pending','0']);
  assert.match(document.querySelector('h2').textContent,/Student <1>/);
});
test('Async report refresh preserves selected tab and task filter, while another attempt opens its own score report',async()=>{
  const answers='<button data-mock-filter="all">All</button><button data-mock-filter="essay">Essay</button><article data-mock-question-type="essay">Saved essay</article><article data-mock-question-type="swt">Saved summary</article>';
  const markup=key=>layout.frame({key,title:'Writing mock',score:layout.hero({overall:69}),answers,feedback:'Saved advice'});
  const b=browser(markup('refresh-one'));
  b.click('[data-mock-tab="answers"]');b.click('[data-mock-filter="essay"]');
  assert.equal(b.document.querySelector('[data-mock-panel="answers"]').hidden,false);
  assert.equal(b.document.querySelector('[data-mock-question-type="swt"]').hidden,true);
  b.host.innerHTML=markup('refresh-one');await flush();
  assert.equal(b.document.querySelector('[data-mock-tab="answers"]').getAttribute('aria-selected'),'true');
  assert.equal(b.document.querySelector('[data-mock-filter="essay"]').getAttribute('aria-pressed'),'true');
  assert.equal(b.document.querySelector('[data-mock-question-type="swt"]').hidden,true);
  b.host.innerHTML=markup('refresh-other');await flush();
  assert.equal(b.document.querySelector('[data-mock-tab="score"]').getAttribute('aria-selected'),'true');
  assert.equal(b.document.querySelector('[data-mock-question-type="swt"]').hidden,false);
});
test('History answer action and feedback links open the correct panel without changing saved responses',async()=>{
  const b=browser('<button data-mock-target="history-attempt" data-mock-open="answers">Answers</button>');
  b.click('[data-mock-open]');
  b.host.innerHTML=layout.frame({key:'history-attempt',title:'Listening mock',answers:'<article id="answer-two" tabindex="-1" data-mock-question-type="wfd">Saved response</article>',feedback:'<button data-mock-jump="answer-two">Review</button>'});await flush();
  assert.equal(b.document.querySelector('[data-mock-panel="answers"]').hidden,false);
  b.click('[data-mock-tab="feedback"]');b.click('[data-mock-jump]');
  assert.equal(b.document.querySelector('[data-mock-panel="answers"]').hidden,false);
  assert.equal(b.document.querySelector('#answer-two').textContent,'Saved response');
  const tab=b.document.querySelector('[data-mock-tab="answers"]');
  const event=new b.window.Event('keydown',{bubbles:true,cancelable:true});event.key='End';tab.dispatchEvent(event);
  assert.equal(b.document.querySelector('[data-mock-tab="feedback"]').getAttribute('aria-selected'),'true');
});
test('Reading enhancement preserves native answer nodes and handlers through assessment refresh',async()=>{
  const overview=value=>'<div data-reading-hero>'+layout.hero({overall:value,unit:'%',scoreLabel:'Reading accuracy'})+'</div><div data-reading-analysis><button data-review-type="dropdown">Task breakdown '+value+'</button></div><div data-reading-feedback>Saved feedback</div>';
  const b=browser('<section class="reading-results-view" data-review-session="reading-refresh"><div class="reading-session-toolbar"><button data-action="home">Back</button><strong>Reading mock 1</strong></div><div data-review-overview>'+overview(50)+'</div><div class="reading-review-intro"><span data-review-retry>Retry</span></div><div class="reading-review-tools"><button data-review-filter="review">To improve</button></div><div data-review-empty hidden></div><div class="reading-complete-review"><article data-review-question="one"><audio controls></audio><button data-review-blank="0">Correct word</button></article></div></section>');
  await flush();
  const answer=b.document.querySelector('[data-review-question]'),audio=answer.querySelector('audio'),button=answer.querySelector('button');let clicks=0;button.addEventListener('click',()=>clicks++);
  assert.equal(b.document.querySelectorAll('.ipt-mock-report').length,1);
  assert.equal(b.document.querySelector('[data-action="home"]').closest('.ipr-actions')!==null,true);
  b.click('[data-mock-tab="analysis"]');b.click('[data-review-type]');
  assert.equal(b.document.querySelector('[data-mock-panel="answers"]').hidden,false);
  b.click('[data-review-blank]');assert.equal(clicks,1);
  b.document.querySelector('[data-review-overview]').innerHTML=overview(75);await flush();
  assert.equal(b.document.querySelector('[data-mock-tab="answers"]').getAttribute('aria-selected'),'true');
  assert.equal(b.document.querySelector('[data-review-question]')===answer,true);
  assert.equal(answer.querySelector('audio')===audio,true);
  assert.match(b.document.querySelector('[data-mock-panel="analysis"]').textContent,/75/);
  assert.equal(b.document.querySelectorAll('[data-reading-feedback]').length,1);
  b.click('[data-review-blank]');assert.equal(clicks,2);
});
test('Reading mock uses its native accuracy and keeps standalone practice review unchanged',()=>{
  const session={name:'Reading mock',startedAt:1000,finishedAt:61000,questions:[],assessments:{}};
  const total={percent:67,earned:2,possible:3,pending:0,excluded:0,rows:[]};
  const markup=reading.overview(session,total,{},[],{type:'all',filter:'all'}),{document}=parseHTML(markup);
  assert.equal(document.querySelector('.ipr-overall strong').textContent,'67');
  assert.equal(document.querySelector('.ipr-overall small').textContent,'%');
  assert.equal(document.querySelector('.ipr-logo').getAttribute('alt'),'IPT Brisbane');
  assert(!reading.overview({...session,practiceUid:'one'},total,{},[],{type:'all',filter:'all'}).includes('data-reading-hero'));
});
