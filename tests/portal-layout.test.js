'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parseHTML}=require('linkedom'),layout=require('../public/portal-layout'),workspace=require('../public/portal-workspace');
test('Layout preserves native scoring, feedback, report styles, original IPT logo and audited practice controller hashes',()=>{for(const [file,hash]of Object.entries(require('../docs/portal-layout-preservation.json').files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),hash,file);});
test('Layout reuses existing controls, isolates native reports and routes saved history without reading or grading accounts',()=>{
 const {document:doc,window}=parseHTML('<body><div id="appShell"><aside id="portalSidebar"><button id="nav-dashboard">Home</button><button id="nav-practice-hub">Practice</button><button id="nav-mock-tests">Mock Tests</button><button id="nav-progress">My Progress</button><div class="sidebar-footer"><button id="userBadge">User</button></div></aside><button id="portalMenuToggle">Menu</button><div id="portalContent"><section id="practiceHubPane"><div class="practice-banners">'+['speaking','reading'].map(s=>'<details class="practice-banner '+s+'"><summary><h3>'+s+'</h3></summary><button data-practice-route="'+s+'">Existing task</button></details>').join('')+'</div></section><section id="savedResultsPane"></section><section id="speakingPane"><div class="speaking-exam-panel"></div><p class="speaking-intro">Original instructions</p></section></div></div></body>');
 const original=doc.getElementById('nav-practice-hub'),task=doc.querySelector('[data-practice-route]'),calls=[];let taps=0;original.onclick=()=>taps++;
 const env={document:doc,canUseSpeaking:()=>true,switchSection:(...args)=>calls.push(args)};const api=layout.install(env);assert.equal(doc.getElementById('nav-practice-hub'),original);original.click();assert.equal(taps,1);assert.equal(doc.querySelector('[data-practice-route]'),task);assert.equal(doc.querySelectorAll('.portal-layout-primary button').length,4);
 doc.querySelector('[data-layout-skill="reading"]').click();assert.equal(doc.querySelector('.practice-banner.reading').hidden,false);assert.equal(doc.querySelector('.practice-banner.speaking').hidden,true);
 assert(doc.getElementById('speakingPane').classList.contains('portal-layout-question'));const marker=doc.createElement('section');marker.className='speaking-result-card';marker.innerHTML='<div class="ipr-score-report">Existing report</div>';doc.getElementById('speakingPane').appendChild(marker);api.refresh();assert(doc.getElementById('speakingPane').classList.contains('portal-layout-report'));assert(!doc.getElementById('speakingPane').classList.contains('portal-layout-question'));assert.equal(marker.textContent,'Existing report');
 api.openResults();doc.querySelector('[data-saved-route="reading"]').click();assert.deepEqual(calls.pop(),['reading',{readingRequest:{history:true}}]);assert.equal(workspace.routeFromHash('#/results'),'saved-results');assert.equal(workspace.routes['speaking-history'].nav,'nav-saved-results');
});

test('Approved practice navigation preserves the original Speaking grading, upload and feedback functions',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/speaking-practice.js'),'utf8'),pins=require('../docs/portal-layout-preservation.json').practiceWorkspaceUpdates.preservedFunctions;
 for(const [name,expected] of Object.entries(pins)){
  const match=new RegExp('^    (?:async )?function '+name+'\\(','m').exec(source);assert(match,name);
  const offset=match.index+match[0].length,next=/^    (?:async )?function /m.exec(source.slice(offset));
  const body=source.slice(match.index,next?offset+next.index:source.length).trim();assert.equal(crypto.createHash('sha256').update(body).digest('hex'),expected,name);
 }
});

test('Writing workspace preserves the audited functions through the SWT item display update',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/index.js'),'utf8'),pins=require('../docs/portal-layout-preservation.json').practiceWritingUpdates.nativeFunctions;
 for(const [name,expected] of Object.entries(pins)){
  const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);assert(match,name);const offset=match.index+match[0].length,next=/^(?:async )?function /m.exec(source.slice(offset));
  let body=source.slice(match.index,next?offset+next.index:source.length).trim();
  if (name==='scoreSummary') {
   const wordLimit = `  if(words > 75){
    const excess = words - 75;
    toast('Cut at least ' + excess + (excess === 1 ? ' word' : ' words') + ' to reach 75. Start with repeated points or optional examples.');
    return;
  }`;
   assert(body.includes(wordLimit));
   body=body.replace(wordLimit,"  if(words > 75){ toast('Too long — maximum 75 words.'); return; }");
  }
  if (name==='showResults') {
   const itemDisplay = `    const swtItem = Number.isFinite(data.item_score_90);
    const writing = confirmed ? (swtItem ? display.score
      : Number.isFinite(rawScore) && Number.isFinite(rawMax) && rawMax > 0
        ? Math.round(10 + 80 * Math.max(0, Math.min(1, rawScore / rawMax))) : null) : null;
    readingEstimateEl.innerHTML = window.PteEstimateDisplay.render(reading, writing, {swtItem});`;
   assert(body.includes(itemDisplay));
   body=body.replace(itemDisplay,`    const writing = confirmed && Number.isFinite(rawScore) && Number.isFinite(rawMax) && rawMax > 0
      ? Math.round(10 + 80 * Math.max(0, Math.min(1, rawScore / rawMax))) : null;
    readingEstimateEl.innerHTML = window.PteEstimateDisplay.render(reading, writing);`);
  }
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'),expected,name);
 }
});

test('Reading workspace keeps the native answer scoring, explanations, completion and persistence byte-identical',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/reading-practice.js'),'utf8'),pins=require('../docs/portal-layout-preservation.json').practiceReadingUpdates.nativeFunctions;
 for(const [name,expected] of Object.entries(pins)){const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);assert(match,name);const offset=match.index+match[0].length,next=/^  (?:async )?function /m.exec(source.slice(offset));const body=source.slice(match.index,next?offset+next.index:source.length).trim();assert.equal(crypto.createHash('sha256').update(body).digest('hex'),expected,name);}
});

test('Listening workspace preserves native saving, grading, feedback, mock timer and integrity functions',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/writing-lab-client.js'),'utf8'),pins=require('../docs/portal-layout-preservation.json').practiceListeningUpdates.nativeFunctions;
 for(const [name,expected] of Object.entries(pins)){
  const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);assert(match,name);const offset=match.index+match[0].length,next=/^  (?:async )?function /m.exec(source.slice(offset));
  let body=source.slice(match.index,next?offset+next.index:source.length).trim();
  if (name==='reviewCard') {
   assert(body.includes('report.itemEstimate(q,r)'));
   assert(body.includes(',{swtItem:Number.isFinite(r.itemScore90)}'));
   body=body.replaceAll('report.itemEstimate(q,r)','report.score90(r.total,r.maximum)')
    .replace(',{swtItem:Number.isFinite(r.itemScore90)}','');
  }
  if (name==='mockReviewCard') {
   const itemEstimate = `    const swtEstimate=q.type==='swt'&&Number.isFinite(r?.itemScore90)&&!report.needsReview(r,q)
      ? '<strong>SWT item estimate '+esc(report.itemEstimate(q,r))+'/90</strong>' : '';
`;
   assert(body.includes(itemEstimate));
   body=body.replace(itemEstimate,'')
    .replace("+'</h2></div>'+swtEstimate+'</header>'+traits","+'</h2></div></header>'+traits");
  }
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'),expected,name);
 }
});
