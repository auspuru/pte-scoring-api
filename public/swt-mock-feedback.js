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
  const dependency=Array.isArray(a.missing_dependencies)?a.missing_dependencies.find(x=>text(x?.missing_context)):null;
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
   const phrase=quote(answer,item?.phrase),fix=text(item?.correction);if(!phrase||typeof item?.correction!=='string'||language.some(x=>x.phrase===phrase&&x.fix===fix))continue;
   language.push({phrase,fix,reason:text(item.explanation),optional:item.affectsScore===false,required:item.affectsScore===true});
  }
  const why=needsContent?text(dependency?.explanation)||text(a.relationship_explanation)||text(a.synthesis?.explanation):'';
  return {version:1,status:'complete',content:{full:fullContent,
   overview:needsContent&&!why?text(raw.feedback?.content||raw.overallVerdict||raw.overview):'',action,why,
   quote:needsContent?(wordBudget?editTarget:quote(answer,dependency?.effect)||quote(answer,a.synthesis?.evidence)):'',
   sourceQuote:needsContent?(wordBudget?editSource:quote(source,dependency?.missing_context)||quote(source,a.synthesis?.sourceQuote)):'',
   repair:wordBudget?revised:'',...(wordBudget?{wordBudget}:{})},language,
   form:{valid,reason:valid===false||gated?strings(raw.reasons).join(' '):''},strengths:valid===false?[]:strings(raw.strengths)};
 }
 function render(value,answer='',key='swt'){
  const data=value?.version===1?value:{version:1,status:'pending'},pending=data.status!=='complete';
  const id='swt-mock-'+String(key).replace(/[^a-zA-Z0-9_-]/g,'-');
  const section=(n,title,body)=>'<section class="swt-mock-section"><h4><span>'+n+'</span>'+title+'</h4><div>'+body+'</div></section>';
  if(pending)return '<div class="swt-mock-feedback" data-swt-mock-feedback>'+section(1,'Content & meaning','<p>Feedback is being prepared. Your submitted response is saved; no learning judgement is available yet.</p>')+section(2,'Grammar & spelling','<p>Language feedback is not ready yet.</p>')+section(3,'Form','<p>Assessment is incomplete. Keep your saved response; an assessment delay does not indicate a writing error.</p>')+'</div>';
  const c=data.content||{},form=data.form||{},count=words(answer),language=[];
  for(const x of data.language||[]){
   if(!quote(answer,x.phrase)||typeof x.fix!=='string')continue;
   const start=answer.indexOf(x.phrase),reason=text(x.reason).replace(/^Optional refinement\s*[—–-]\s*no score deduction\.\s*/i,'');
   const after=words(answer.slice(0,start)+x.fix+answer.slice(start+x.phrase.length));
   if(x.optional&&(!reason||after<5||after>75||answer.indexOf(x.phrase,start+1)>=0))continue;
   language.push({...x,reason,after});
  }
  const budget=c.wordBudget;
  const validBudget=!c.full&&budget&&budget.revisedCount===words(c.repair)&&budget.revisedCount>=5&&budget.revisedCount<=75
   && budget.wordsSaved===count-budget.revisedCount;
  let content=c.full?'<p>Full Content marks. Your summary connects the essential ideas. Clear, simple words work well when they keep the meaning.</p>':
   (c.overview?'<p>'+esc(c.overview)+'</p>':!c.why&&!validBudget?'<p>Review the saved feedback alongside the original passage.</p>':'')+(validBudget&&c.action?'<h5>Your priority</h5><p>'+esc(c.action)+'</p>':'')+
   (quote(answer,c.quote)?'<div class="swt-mock-evidence"><strong>You wrote</strong><q>'+esc(c.quote)+'</q></div>':'')+
   (c.sourceQuote?'<div class="swt-mock-evidence"><strong>'+(validBudget?'Keep this part of the passage':'The passage says')+'</strong><q>'+esc(c.sourceQuote)+'</q></div>':'')+
   (c.why?'<p><strong>Why this matters</strong><br>'+esc(c.why)+'</p>':'')+
   (data.strengths?.length?'<details><summary>What worked well</summary><ul>'+data.strengths.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details>':'');
  if(validBudget){
   content+='<details class="swt-mock-repair"><summary>See an example with this edit</summary><p>'+esc(c.repair)+'</p></details>';
   content+='<p class="swt-mock-muted">'+budget.revisedCount+' of 75 words after the edit'+(budget.wordsSaved>0?' · '+budget.wordsSaved+' '+(budget.wordsSaved===1?'word':'words')+' saved':'')+'</p>';
  }
  let annotated='',at=0;const located=[];
  for(let i=0;i<language.length;i++){const x=language[i],start=answer.indexOf(x.phrase);if(start<0||answer.indexOf(x.phrase,start+1)>=0||located.some(v=>v.start<start+x.phrase.length&&v.end>start))continue;located.push({start,end:start+x.phrase.length,index:i});}
  for(const x of located.sort((a,b)=>a.start-b.start)){const issue=language[x.index];annotated+=esc(answer.slice(at,x.start))+'<button type="button" class="swt-mock-word'+(issue.optional?' optional':'')+'" data-swt-mock-fix="'+x.index+'" aria-expanded="false" aria-controls="'+id+'-fix-'+x.index+'">'+esc(issue.phrase)+'</button>';at=x.end;}annotated+=esc(answer.slice(at));
  const corrections=language.map((x,i)=>'<details id="'+id+'-fix-'+i+'" data-swt-mock-correction="'+i+'"><summary>'+esc(x.phrase)+' → '+esc(text(x.fix)||'Delete this text')+'</summary><p><strong>'+(x.optional?'Optional refinement · no marks lost':x.required?'Correction':'Saved language suggestion')+'</strong></p><p>'+esc(x.reason||'Review this suggestion in context before your next practice attempt.')+'</p>'+(x.optional&&x.after>count?'<p class="swt-mock-muted">'+x.after+' of 75 words after this change alone.</p>':'')+'</details>').join('');
  const grammar=(form.valid===false?'<p>Fix the sentence requirements first. Separate language feedback is not available for this response.</p>':
   '<p class="swt-mock-muted">'+(language.length?'Select an underlined phrase or expand a correction to see the reason.':'No exact language correction is available in this saved assessment.')+'</p><div class="swt-mock-answer">'+annotated+'</div>'+corrections);
  let formBody='<p>'+count+' words'+(count>=5&&count<=75?' · Within 5–75 words':' · Review the 5–75 word requirement')+'</p><p>'+esc(form.valid===true?'One complete sentence meets the saved form checks.':form.reason||'Check the saved task feedback and the one-sentence requirement.')+'</p>';
  if(count===75)formBody+='<p class="swt-mock-muted">75 is the maximum. A shorter summary can earn full marks.</p>';
  if(count>75){
   const extra=count-75;
   formBody+='<p class="swt-mock-muted">Cut at least '+extra+' '+(extra===1?'word':'words')+'. Start with repeated points or optional examples.</p>';
  }
  return '<div class="swt-mock-feedback" data-swt-mock-feedback>'+section(1,'Content & meaning',content)+section(2,'Grammar & spelling',grammar)+section(3,'Form',formBody)+'</div>';
 }
 function install(doc){if(!doc||doc.__swtMockFeedbackInstalled)return;doc.__swtMockFeedbackInstalled=true;doc.addEventListener('click',e=>{const button=e.target.closest?.('[data-swt-mock-fix]'),root=button?.closest('[data-swt-mock-feedback]');if(!root)return;const panel=root.querySelector('[data-swt-mock-correction="'+Number(button.dataset.swtMockFix)+'"]');if(!panel)return;panel.open=true;button.setAttribute('aria-expanded','true');panel.scrollIntoView?.({block:'nearest'});});}
 return {project,render,install};
});
