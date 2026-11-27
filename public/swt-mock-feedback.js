/* Shared read-only SWT coaching for submitted mock reports. No grading or answer writes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SwtMockFeedback=api;api.install(root.document);}})(typeof globalThis==='undefined'?this:globalThis,function(){
 'use strict';
 const text=v=>typeof v==='string'?v.trim():'';
 const strings=v=>Array.isArray(v)?v.filter(x=>typeof x==='string').map(text).filter(Boolean):[];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const quote=(source,value)=>text(value)&&source.includes(text(value))?text(value):'';
 const words=value=>text(value).split(/\s+/).filter(Boolean).length;
 function project(raw={},options={}){
  const answer=String(options.answer||''),source=String(options.source||'');
  if(options.confirmed!==true||raw.score_provisional||raw.needs_semantic_review||['local','unavailable'].includes(raw.scoringMode))return {version:1,status:'pending'};
  const a=raw.summary_assessment||{},scores=raw.diagnosticScores||raw.scores||options.scores||{},gated=options.gated===true||raw.gated===true;
  const formKnown=Number.isFinite(scores.form)&&(!gated||raw.diagnosticScores!=null);
  const valid=formKnown?scores.form>=1:null;
  const fullContent=valid!==false&&!gated&&Number.isFinite(scores.content)&&scores.content>=(raw.maxima?.content||options.maxima?.content||4);
  const needsContent=valid!==false&&!fullContent;
  const dependencies=Array.isArray(a.missing_dependencies)?a.missing_dependencies.filter(x=>text(x?.missing_context)):[];
  const dependency=dependencies[0];
  const edit=a.content_edit;
  const budgeted=edit&&Object.hasOwn(edit,'revised_word_count');
  const editTarget=quote(answer,edit?.target),editSource=quote(source,edit?.source_evidence);
  const revised=text(edit?.revised);
  const originalCount=words(answer),revisedCount=words(revised);
  const wordBudget=valid===true&&needsContent&&budgeted&&editTarget&&editSource&&(!edit.cut||quote(answer,edit.cut))
   && originalCount===edit.original_word_count&&revisedCount===edit.revised_word_count
   && revisedCount>=5&&revisedCount<=75&&revised===text(a.repair)
   ? {revisedCount,wordsSaved:originalCount-revisedCount} : null;
  const action=wordBudget
   ? (edit.operation==='replace'&&editTarget===answer.trim()
    ? 'Use the short wording in the example below to connect the main ideas.'
    : text(edit.advice)||text(a.next_step))
   : '';
  const language=[];
  if(valid!==false&&!gated)for(const item of Array.isArray(raw.errors)?raw.errors:[]){
   if(item?.affectsScore!==true)continue;
   const phrase=quote(answer,item.phrase);
   if(!phrase||typeof item.correction!=='string')continue;
   const span = Array.isArray(item.phraseSpan) && item.phraseSpan.length === 2 && item.phraseSpan.every(Number.isInteger) ? item.phraseSpan : null;
   const trait = ['grammar','vocabulary'].includes(item.trait) ? item.trait : null;
   const fix=text(item.correction);
   if(language.some(x=>x.phrase===phrase&&x.fix===fix&&x.span?.[0]===span?.[0]&&x.span?.[1]===span?.[1]))continue;
   language.push({phrase,fix,reason:text(item.explanation),required:true,...(span?{span}:{}),...(trait?{trait}:{})});
  }
  const why=needsContent?text(dependency?.explanation)||text(a.relationship_explanation)||text(a.synthesis?.explanation):'';
  return {version:1,status:'complete',content:{full:fullContent,
   overview:needsContent&&!why?text(raw.feedback?.content||raw.overallVerdict||raw.overview):'',action,why,
   quote:needsContent?(wordBudget?editTarget:quote(answer,dependency?.effect)||quote(answer,a.synthesis?.evidence)):'',
   sourceQuote:needsContent?(wordBudget?editSource:quote(source,dependency?.missing_context)||quote(source,a.synthesis?.sourceQuote)):'',
   repair:wordBudget?revised:'',...(wordBudget?{wordBudget}:{}),
   extraDependencies:needsContent?dependencies.slice(1).map(item=>({
    phrase:quote(answer,item.effect),reason:text(item.explanation),source:quote(source,item.missing_context)
   })).filter(item=>item.reason||item.source):[]},language,
   form:{valid,reason:valid===false||gated?strings(raw.reasons).join(' '):''},strengths:valid===false?[]:strings(raw.strengths)};
 }
 function locateCorrections(answer, language) {
  const tokens = [...answer.matchAll(/\S+/g)];
  const located = [];
  language.forEach((issue, index) => {
   const span = issue.span;
   const start = span ? tokens[span[0]-1]?.index : answer.indexOf(issue.phrase);
   if (!Number.isInteger(start) || start < 0) return;
   const end = span ? (tokens[span[1]-1]?.index ?? start) + (tokens[span[1]-1]?.[0]?.length ?? 0) : start + issue.phrase.length;
   if (answer.slice(start, end) !== issue.phrase || (!span && answer.indexOf(issue.phrase, start + 1) >= 0)) return;
   if (located.some(row => row.start < end && row.end > start)) return;
   located.push({start,end,index});
  });
  return located.sort((a,b)=>a.start-b.start);
 }
 function answerCard(title,body) {
  return '<section class="swt-submitted-card"><h4>'+title+'</h4>'+body+'</section>';
 }
 function reviewLayout(review, submitted, corrected, details) {
  const passage='<section class="swt-submitted-passage"><h4>Passage</h4>'+(review.instruction?'<p>'+esc(review.instruction)+'</p>':'')+
   '<div class="swt-submitted-text">'+esc(review.passage||'The saved passage is unavailable.')+'</div></section>';
  const answers='<div class="swt-submitted-columns">'+
   answerCard('Your submitted summary',submitted)+answerCard('Corrected summary',corrected)+
   '<details class="swt-submitted-card swt-submitted-sample"><summary>'+(review.plainSample?'Plain-English sample':'Sample summary')+
   '</summary><div class="swt-submitted-text">'+esc(review.sample||'No sample summary is available.')+'</div></details>'+'</div>';
  return '<div class="swt-submitted-review" data-swt-mock-feedback>'+passage+(review.traits||'')+answers+details+'</div>';
 }
 function render(value,answer='',key='swt',review=null){
  const data=value?.version===1?value:{version:1,status:'pending'},pending=data.status!=='complete';
  const id='swt-mock-'+String(key).replace(/[^a-zA-Z0-9_-]/g,'-');
  const section=(n,title,body)=>'<section class="swt-mock-section"><h4><span>'+n+'</span>'+title+'</h4><div>'+body+'</div></section>';
  const details=(content,grammar,form)=>'<div class="swt-mock-feedback"'+(review?'':' data-swt-mock-feedback')+'>'+
   section(1,'Content & meaning',content)+section(2,'Grammar & vocabulary',grammar)+section(3,'Form',form)+'</div>';
  if(pending){
   const pendingDetails=details('<p>Feedback is being prepared. Your submitted response is saved.</p>',
    '<p>Language feedback is not ready yet.</p>','<p>Form feedback is not ready yet.</p>');
   return review?reviewLayout(review,'<div class="swt-submitted-text">'+esc(answer||'No summary submitted.')+'</div>',
    '<p>A corrected summary is not available yet.</p>',pendingDetails):pendingDetails;
  }
  const c=data.content||{},form=data.form||{},count=words(answer);
  const language=(Array.isArray(data.language)?data.language:[]).filter(issue=>
   issue?.required===true&&quote(answer,issue.phrase)&&typeof issue.fix==='string');
  const budget=c.wordBudget;
  const validBudget=!c.full&&budget&&budget.revisedCount===words(c.repair)&&budget.revisedCount>=5&&budget.revisedCount<=75
   && budget.wordsSaved===count-budget.revisedCount;
  let content=c.full?'<p>Full Content marks. Your summary connects the main ideas.</p>':
   (c.overview?'<p>'+esc(c.overview)+'</p>':!c.why&&!validBudget?'<p>Review the saved feedback alongside the passage.</p>':'')+(validBudget&&c.action?'<h5>Your priority</h5><p>'+esc(c.action)+'</p>':'')+
   (quote(answer,c.quote)?'<div class="swt-mock-evidence"><strong>You wrote</strong><q>'+esc(c.quote)+'</q></div>':'')+
   (c.sourceQuote?'<div class="swt-mock-evidence"><strong>'+(validBudget?'Keep this part of the passage':'The passage says')+'</strong><q>'+esc(c.sourceQuote)+'</q></div>':'')+
   (c.why?'<p><strong>Why this matters</strong><br>'+esc(c.why)+'</p>':'')+
   (data.strengths?.length?'<details><summary>What worked well</summary><ul>'+data.strengths.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details>':'');
  if(Array.isArray(c.extraDependencies)&&c.extraDependencies.length)content+='<ul class="swt-scored-corrections">'+c.extraDependencies.map(item=>
   '<li>'+(quote(answer,item.phrase)?'<q>'+esc(item.phrase)+'</q> ':'')+esc(item.reason||item.source)+'</li>').join('')+'</ul>';
  if(validBudget){
   if(!review)content+='<details class="swt-mock-repair"><summary>See an example with this edit</summary><p>'+esc(c.repair)+'</p></details>';
   content+='<p class="swt-mock-muted">'+budget.revisedCount+' of 75 words after the edit'+(budget.wordsSaved>0?' · '+budget.wordsSaved+' '+(budget.wordsSaved===1?'word':'words')+' saved':'')+'</p>';
  }
  let annotated='',at=0;
  const located=locateCorrections(answer,language);
  for(const row of located){
   const issue=language[row.index];
   annotated+=esc(answer.slice(at,row.start))+'<button type="button" class="swt-mock-word" data-swt-mock-fix="'+row.index+'" aria-expanded="false" aria-controls="'+id+'-fix-'+row.index+'">'+esc(issue.phrase)+'</button>';
   at=row.end;
  }
  annotated+=esc(answer.slice(at));
  const corrections=language.map((issue,i)=>'<details id="'+id+'-fix-'+i+'" data-swt-mock-correction="'+i+'"><summary>'+esc(issue.phrase)+' → '+esc(text(issue.fix)||'Delete this text')+'</summary><p><strong>'+
   (issue.trait==='grammar'?'Grammar':issue.trait==='vocabulary'?'Vocabulary':'Correction')+'</strong></p>'+
   (issue.reason?'<p>'+esc(issue.reason)+'</p>':'')+'</details>').join('');
  const grammar=form.valid===false?'<p>Fix the sentence requirements first. Separate language feedback is not available for this response.</p>':
   '<p class="swt-mock-muted">'+(language.length?'Expand a correction to see the reason.':'No marked language corrections are available.')+'</p>'+
    (review?'':'<div class="swt-mock-answer">'+annotated+'</div>')+corrections;
  let formBody='<p>'+count+' words'+(count>=5&&count<=75?' · Within 5–75 words':' · Review the 5–75 word requirement')+'</p><p>'+esc(form.valid===true?'One complete sentence meets the saved form checks.':form.reason||'Check the saved task feedback and the one-sentence requirement.')+'</p>';
  if(count===75)formBody+='<p class="swt-mock-muted">75 is the maximum. A shorter summary can earn full marks.</p>';
  if(count>75){
   const extra=count-75;
   formBody+='<p class="swt-mock-muted">Cut at least '+extra+' '+(extra===1?'word':'words')+'. Start with repeated points or optional examples.</p>';
  }
  const feedback=details(content,grammar,formBody);
  if(!review)return feedback;
  let corrected=validBudget?'<p>Verified edit for Content.</p><div class="swt-submitted-text">'+esc(c.repair)+'</div>':'';
  if(!corrected&&form.valid===true&&located.length&&located.length===language.length){
   const revision=located.reduceRight((result,row)=>result.slice(0,row.start)+language[row.index].fix+result.slice(row.end),answer).replace(/\s+/g,' ').trim();
   const punctuation=revision.match(/[.!?]+(?=\s|["'”’)]*$)/g)||[];
   if(revision!==answer.trim()&&words(revision)>=5&&words(revision)<=75&&punctuation.length===1&&/[.!?]["'”’)]*$/.test(revision)){
    corrected='<p>Saved grammar and vocabulary corrections only.</p><div class="swt-submitted-text">'+esc(revision)+'</div>';
   }
  }
  if(!corrected)corrected='<p>No checked revision is available.</p>';
  return reviewLayout(review,'<div class="swt-submitted-text">'+(annotated||'No summary submitted.')+'</div>',corrected,feedback);
 }
 function install(doc){if(!doc||doc.__swtMockFeedbackInstalled)return;doc.__swtMockFeedbackInstalled=true;doc.addEventListener('click',e=>{const button=e.target.closest?.('[data-swt-mock-fix]'),root=button?.closest('[data-swt-mock-feedback]');if(!root)return;const panel=root.querySelector('[data-swt-mock-correction="'+Number(button.dataset.swtMockFix)+'"]');if(!panel)return;panel.open=true;button.setAttribute('aria-expanded','true');panel.scrollIntoView?.({block:'nearest'});});}
 return {project,render,install};
});
