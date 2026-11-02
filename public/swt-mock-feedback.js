/* Shared read-only SWT coaching for submitted mock reports. No grading or answer writes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SwtMockFeedback=api;api.install(root.document);}})(typeof globalThis==='undefined'?this:globalThis,function(){
 'use strict';
 const text=v=>typeof v==='string'?v.trim():'';
 const strings=v=>Array.isArray(v)?v.filter(x=>typeof x==='string').map(text).filter(Boolean):[];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const quote=(source,value)=>text(value)&&source.includes(text(value))?text(value):'';
 function project(raw={},options={}){
  const answer=String(options.answer||''),source=String(options.source||'');
  if(options.confirmed!==true||raw.score_provisional||raw.needs_semantic_review||['local','unavailable'].includes(raw.scoringMode))return {version:1,status:'pending'};
  const a=raw.summary_assessment||{},scores=raw.diagnosticScores||raw.scores||options.scores||{},gated=options.gated===true||raw.gated===true;
  const formKnown=Number.isFinite(scores.form)&&(!gated||raw.diagnosticScores!=null);
  const valid=formKnown?scores.form>=1:null;
  const needsContent=Number.isFinite(scores.content)&&scores.content<(raw.maxima?.content||options.maxima?.content||4)||['partial','limited'].includes(a.synthesis?.quality);
  const dependency=Array.isArray(a.missing_dependencies)?a.missing_dependencies.find(x=>text(x?.missing_context)):null;
  const language=[];
  if(valid!==false&&!gated)for(const item of Array.isArray(raw.errors)?raw.errors:[]){
   const phrase=quote(answer,item?.phrase),fix=text(item?.correction);if(!phrase||!fix||language.some(x=>x.phrase===phrase&&x.fix===fix))continue;
   language.push({phrase,fix,reason:text(item.explanation),optional:item.affectsScore===false,required:item.affectsScore===true});
  }
  return {version:1,status:'complete',content:{overview:valid===false?'':text(raw.feedback?.content||raw.overallVerdict||raw.overview),
   action:valid===false?'':needsContent?text(a.next_step)||strings(raw.improvements)[0]||'':'',
   why:valid===false?'':text(dependency?.explanation||a.synthesis?.explanation||a.relationship_explanation),
   quote:valid===false?'':quote(answer,dependency?.effect)||(['partial','limited'].includes(a.synthesis?.quality)?quote(answer,a.synthesis?.evidence):''),
   sourceQuote:valid===false?'':quote(source,dependency?.missing_context)||quote(source,a.synthesis?.sourceQuote),
   repair:valid===false||gated||!(needsContent||language.some(x=>x.required))?'':text(a.repair)},language,
   form:{valid,reason:valid===false||gated?strings(raw.reasons).join(' '):''},strengths:valid===false?[]:strings(raw.strengths)};
 }
 function render(value,answer='',key='swt'){
  const data=value?.version===1?value:{version:1,status:'pending'},pending=data.status!=='complete';
  const id='swt-mock-'+String(key).replace(/[^a-zA-Z0-9_-]/g,'-');
  const section=(n,title,body)=>'<section class="swt-mock-section"><h4><span>'+n+'</span>'+title+'</h4><div>'+body+'</div></section>';
  if(pending)return '<div class="swt-mock-feedback" data-swt-mock-feedback>'+section(1,'Content & meaning','<p>Feedback is being prepared. Your submitted response is saved; no learning judgement is available yet.</p>')+section(2,'Grammar & spelling','<p>Language feedback is not ready yet.</p>')+section(3,'Form','<p>Assessment is incomplete. Keep your saved response; an assessment delay does not indicate a writing error.</p>')+'</div>';
  const c=data.content||{},form=data.form||{},language=(data.language||[]).filter(x=>quote(answer,x.phrase)&&text(x.fix));
  let content=(c.overview?'<p>'+esc(c.overview)+'</p>':'<p>Review the saved feedback alongside the original passage.</p>')+(c.action?'<h5>Your priority</h5><p>'+esc(c.action)+'</p>':'')+
   (quote(answer,c.quote)?'<div class="swt-mock-evidence"><strong>You wrote</strong><q>'+esc(c.quote)+'</q></div>':'')+
   (c.sourceQuote?'<div class="swt-mock-evidence"><strong>The passage says</strong><q>'+esc(c.sourceQuote)+'</q></div>':'')+
   (c.why?'<p><strong>Why this matters</strong><br>'+esc(c.why)+'</p>':'')+
   (data.strengths?.length?'<details><summary>What worked well</summary><ul>'+data.strengths.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details>':'')+
   (c.repair?'<article class="swt-mock-repair"><h5>A possible repair</h5><p>'+esc(c.repair)+'</p>'+(c.action?'<h5>What this addresses</h5><p>'+esc(c.action)+'</p>':'')+'<small>A learning example. Your submitted answer and marks stay saved.</small></article>':'');
  let annotated='',at=0;const located=[];
  for(let i=0;i<language.length;i++){const x=language[i],start=answer.indexOf(x.phrase);if(start<0||answer.indexOf(x.phrase,start+1)>=0||located.some(v=>v.start<start+x.phrase.length&&v.end>start))continue;located.push({start,end:start+x.phrase.length,index:i});}
  for(const x of located.sort((a,b)=>a.start-b.start)){const issue=language[x.index];annotated+=esc(answer.slice(at,x.start))+'<button type="button" class="swt-mock-word'+(issue.optional?' optional':'')+'" data-swt-mock-fix="'+x.index+'" aria-expanded="false" aria-controls="'+id+'-fix-'+x.index+'">'+esc(issue.phrase)+'</button>';at=x.end;}annotated+=esc(answer.slice(at));
  const corrections=language.map((x,i)=>'<details id="'+id+'-fix-'+i+'" data-swt-mock-correction="'+i+'"><summary>'+esc(x.phrase)+' → '+esc(x.fix)+'</summary><p><strong>'+(x.optional?'Optional refinement':x.required?'Correction':'Saved language suggestion')+'</strong></p><p>'+esc(x.reason||'Review this suggestion in context before your next practice attempt.')+'</p></details>').join('');
  const grammar=(form.valid===false?'<p>Fix the sentence requirements first. Separate language feedback is not available for this response.</p>':
   '<p class="swt-mock-muted">'+(language.length?'Select an underlined phrase or expand a correction to see the reason.':'No exact language correction is available in this saved assessment.')+'</p><div class="swt-mock-answer">'+annotated+'</div>'+corrections);
  const count=String(answer).trim().split(/\s+/).filter(Boolean).length;
  const formBody='<p>'+count+' words'+(count>=5&&count<=75?' · Within 5–75 words':' · Review the 5–75 word requirement')+'</p><p>'+esc(form.valid===true?'One complete sentence meets the saved form checks.':form.reason||'Check the saved task feedback and the one-sentence requirement.')+'</p>';
  return '<div class="swt-mock-feedback" data-swt-mock-feedback>'+section(1,'Content & meaning',content)+section(2,'Grammar & spelling',grammar)+section(3,'Form',formBody)+'</div>';
 }
 function install(doc){if(!doc||doc.__swtMockFeedbackInstalled)return;doc.__swtMockFeedbackInstalled=true;doc.addEventListener('click',e=>{const button=e.target.closest?.('[data-swt-mock-fix]'),root=button?.closest('[data-swt-mock-feedback]');if(!root)return;const panel=root.querySelector('[data-swt-mock-correction="'+Number(button.dataset.swtMockFix)+'"]');if(!panel)return;panel.open=true;button.setAttribute('aria-expanded','true');panel.scrollIntoView?.({block:'nearest'});});}
 return {project,render,install};
});
