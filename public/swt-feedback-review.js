/* Evidence-led SWT review UI. Reads saved feedback; never grades or changes marks. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./swt-feedback'):root.SwtStudentFeedback);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SwtFeedbackReview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(feedback){
  'use strict';
  const clean=v=>typeof v==='string'?v.trim():'';
  const list=v=>Array.isArray(v)?v:[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const words=t=>clean(t).split(/\s+/).filter(Boolean).length;
  function exact(text,quote){quote=clean(quote);return quote&&text.includes(quote)?quote:'';}
  function location(text,phrase,span){
    phrase=exact(text,phrase);if(!phrase)return null;
    if(span!=null){
      const tokens=[...text.matchAll(/\S+/g)];
      if(!Array.isArray(span)||span.length!==2||!span.every(Number.isInteger)||span[0]<1||span[1]<span[0]||span[1]>tokens.length)return null;
      const start=tokens[span[0]-1].index,end=tokens[span[1]-1].index+tokens[span[1]-1][0].length;
      return text.slice(start,end)===phrase?{start,end}:null;
    }
    const start=text.indexOf(phrase);
    return text.indexOf(phrase,start+1)<0?{start,end:start+phrase.length}:null;
  }
  function model(data,passage,text){
    text=String(text||'');const state=feedback.build(data),a=data.content_details?.summary_assessment||{},wordCount=words(text);
    const pending=state.provisional||data.ai_feedback_degraded===true;
    const valid=Number((data.diagnostic_trait_scores||data.trait_scores||{}).form)>=1;
    const annotations=[];const claimed=[];
    if(!pending&&valid)for(const raw of [...list(data.grammar_details?.grammar_annotations),...list(data.vocabulary_details?.vocabulary_annotations)]){
      if(!raw||!clean(raw.fix)||!exact(text,raw.phrase))continue;
      const phrase=exact(text,raw.phrase),range=location(text,phrase,raw.phrase_span);if(!range)continue;const {start,end}=range;
      if(claimed.some(r=>r.start<end&&r.end>start))continue;
      const optional=raw.affects_score!==true;
      const kind=/spell/i.test(raw.type||'')?'Spelling':list(data.vocabulary_details?.vocabulary_annotations).includes(raw)?'Word choice':'Grammar';
      const fix=clean(raw.fix),reason=clean(raw.meaning_effect)||clean(raw.rationale).replace(/^Optional refinement\s*[—–-]\s*no score deduction\.\s*/i,'');
      const after=words(text.slice(0,start)+fix+text.slice(end));
      if(optional&&(!reason||after<5||after>75))continue;
      annotations.push({phrase,fix,start,end,optional,kind,reason,after});
      claimed.push({start,end});
    }
    const dependency=list(a.missing_dependencies).find(d=>d&&clean(d.missing_context));
    const weakSynthesis=['partial','limited','assembly','fragments'].includes(a.synthesis?.quality);
    const contentIssue=!pending&&valid&&!state.contentFull&&(state.contentGated||Number(data.trait_scores?.content)<Number(data.trait_scores?.content_max||4)||weakSynthesis);
    const source=String(passage?.text||'');
    const edit=a.content_edit;
    const budgeted=edit&&Object.hasOwn(edit,'revised_word_count');
    const editTarget=exact(text,edit?.target), editSource=exact(source,edit?.source_evidence);
    const revised=clean(edit?.revised);
    const revisedCount=words(revised);
    const wordBudget=contentIssue&&budgeted&&editTarget&&editSource&&(!edit.cut||exact(text,edit.cut))
      && wordCount===edit.original_word_count&&revisedCount===edit.revised_word_count
      && revisedCount>=5&&revisedCount<=75&&revised===clean(a.repair)
      ? { revisedCount, wordsSaved:wordCount-revisedCount } : null;
    const quote=contentIssue?(wordBudget?editTarget:exact(text,dependency?.effect)||exact(text,a.synthesis?.evidence)):'';
    const sourceQuote=contentIssue?(wordBudget?editSource:exact(source,dependency?.missing_context)||exact(source,a.synthesis?.sourceQuote)):'';
    const action=contentIssue?(wordBudget
      ? (edit.operation==='replace'&&editTarget===text.trim()
        ? 'Use the short wording in the example below to connect the main ideas.'
        : clean(edit.advice)||clean(a.next_step))
      : dependency ? 'Use a short phrase to include the context this idea depends on.'
        : a.synthesis?.quality==='fragments' ? 'Choose the main idea and connect it to essential support in one sentence.'
          : 'Keep a short phrase for the main idea and connect it to essential support.') : '';
    const why=contentIssue?(clean(dependency?.explanation)||clean(a.relationship_explanation)||clean(a.synthesis?.explanation)
      ||clean(data.content_details?.feedback_note)||clean(data.content_details?.notes)):'';
    const complete=t=>words(t)>=5&&words(t)<=75&&/[.!?]$/.test(t)&&t.split(/[.!?]+(?:\s+|$)/).filter(v=>v.trim()).length===1;
    let languageDraft='';
    const required=annotations.filter(x=>!x.optional).sort((a,b)=>b.start-a.start);
    if(!contentIssue&&required.length){
      languageDraft=text;
      for(const item of required)languageDraft=languageDraft.slice(0,item.start)+item.fix+languageDraft.slice(item.end);
      if(!complete(languageDraft))languageDraft='';
    }
    return {state,pending,valid,annotations,quote,sourceQuote,contentIssue,action,why,repair:wordBudget?revised:'',languageDraft,wordBudget,
      usable:!!wordBudget,text,wordCount,languageAdvice:state.priorities.filter(p=>/grammar|wording/i.test(p.title))};
  }
  function heading(n,title,status){return '<div class="swt-review-heading"><h2><span>'+n+'</span>'+title+'</h2><span class="swt-review-status">'+esc(status)+'</span></div>';}
  function section(n,title,status,body,id){return '<section class="swt-review-section" id="'+id+'">'+heading(n,title,status)+'<div class="swt-review-body">'+body+'</div></section>';}
  function annotationHtml(m){let at=0,out='';for(const item of [...m.annotations].sort((a,b)=>a.start-b.start)){
    const index=m.annotations.indexOf(item);out+=esc(m.text.slice(at,item.start))+'<button type="button" class="swt-word-fix '+(item.optional?'optional':item.kind==='Spelling'?'spelling':'grammar')+'" data-review-fix="'+index+'" aria-expanded="false" aria-controls="swtReviewCorrection" aria-label="'+esc(item.kind+' correction: '+item.phrase)+'">'+esc(item.phrase)+'</button>';at=item.end;
  }return out+esc(m.text.slice(at));}
  function render(m){
    let content=m.pending?'<p class="swt-review-note">Your response is saved. A complete assessment is not available yet. There is no confirmed learning judgement to act on.</p>':!m.valid?'<p class="swt-review-note">Repair the form first. The awarded zero does not establish a separate content or language weakness.</p>':m.contentIssue?
      '<h3>Your priority</h3><p>'+esc(m.action)+'</p>'+(m.quote?'<div class="swt-review-evidence"><strong>You wrote</strong><q>'+esc(m.quote)+'</q><button type="button" class="btn btn-ghost" data-review-locate>Locate in saved answer</button></div>':'')+
      (m.sourceQuote?'<div class="swt-review-evidence"><strong>'+(m.wordBudget?'Keep this part of the passage':'The passage says')+'</strong><q>'+esc(m.sourceQuote)+'</q></div>':'')+
      (m.why?'<p><strong>Why this needs attention</strong><br>'+esc(m.why)+'</p>':'')+
      '<button type="button" class="btn btn-ghost" data-review-source>Review the original passage</button>':
      '<p class="swt-review-good">'+(m.state.contentFull?'Full Content marks. Your summary connects the essential ideas. Clear, simple words work well when they keep the meaning.':'Review the saved feedback alongside the passage.')+'</p>';
    if(m.repair&&m.wordBudget){
      const {revisedCount,wordsSaved}=m.wordBudget;
      content+='<details class="swt-review-suggestion"><summary>See an example with this edit</summary><div><p class="swt-review-revision">'+esc(m.repair)+'</p><button type="button" class="btn" data-review-use>Use in my revision draft</button></div></details>';
      content+='<p class="swt-help">'+revisedCount+' of 75 words after the edit'+(wordsSaved>0?' · '+wordsSaved+' '+(wordsSaved===1?'word':'words')+' saved':'')+'</p>';
    }
    let grammar=m.pending?'<p>Language feedback is not ready yet.</p>':!m.valid?'<p>Repair the sentence form first. No complete language assessment is claimed here.</p>':
      '<div class="swt-review-legend"><span>Grammar / word choice</span><span>Spelling</span><span>Optional</span></div><p class="swt-help">'+(m.annotations.length?'Select an underlined phrase to see the change and why it helps.':'No exact language correction is available in this saved feedback.')+'</p><p class="swt-review-annotated">'+annotationHtml(m)+'</p><div id="swtReviewCorrection" class="swt-review-correction" role="region" aria-live="polite" aria-label="Selected language correction" hidden></div>';
    if(!m.pending&&m.valid&&m.languageAdvice.length)grammar+='<div class="swt-review-note">'+m.languageAdvice.map(p=>'<p>'+esc(p.detail)+'</p>').join('')+'</div>';
    if(m.annotations.some(x=>x.optional))grammar+='<p class="swt-help">Optional suggestions did not cost marks. Keep your total within 75 words.</p>';
    if(m.languageDraft)grammar+='<button type="button" class="btn" data-review-use="language">Use these language corrections in my draft</button>';
    let form=m.pending?'<p>Assessment is incomplete. Your saved answer remains available.</p>':'<ul class="swt-review-form"><li class="'+(m.wordCount>=5&&m.wordCount<=75?'good':'warn')+'">'+m.wordCount+' words · '+(m.wordCount>=5&&m.wordCount<=75?'Within 5–75 words':'Use 5–75 words')+'</li><li class="'+(m.valid?'good':'warn')+'">'+(m.valid?'One complete sentence within the form requirements.':esc(m.state.priorities[0]?.detail||'Join your ideas into one complete sentence and check the word limit.'))+'</li></ul>';
    if(!m.pending&&m.wordCount===75)form+='<p class="swt-help">75 is the maximum. A shorter summary can earn full marks.</p>';
    if(!m.pending&&m.wordCount>75){
      const extra=m.wordCount-75;
      form+='<p class="swt-help">Cut at least '+extra+' '+(extra===1?'word':'words')+'. Start with repeated points or optional examples.</p>';
    }
    const revision=m.pending?'':section(4,'Revise & practise','Original preserved','<p>'+(m.action?esc(m.action):'Use the feedback above while improving your sentence. Further revision is optional when no repair is needed.')+'</p><button type="button" class="btn btn-primary" data-review-edit>Open revision draft</button><div id="swtReviewEditor" hidden><label for="swtReviewDraft">Your revision</label><textarea id="swtReviewDraft" rows="5" spellcheck="false">'+esc(m.text)+'</textarea><p class="swt-help"><span id="swtReviewWords">'+m.wordCount+'</span> words · One complete sentence · 5–75 words</p><div class="swt-review-actions"><button type="button" class="btn btn-primary" data-review-save>Save revision draft</button><button type="button" class="btn" data-review-continue>Continue to writing</button><button type="button" class="btn btn-ghost" data-review-undo hidden>Undo suggestion</button></div><p id="swtReviewSaveStatus" role="status" aria-live="polite"></p><p class="swt-help">Saving a draft does not assess it or replace your submitted answer. Submit deliberately from the writing screen for new feedback.</p></div>','swtReviewRevision');
    return section(1,'Content & meaning',m.pending?'Assessment incomplete':!m.valid?'Repair form first':m.contentIssue?'Priority repair':'Review saved feedback',content,'swtReviewContent')+
      section(2,'Grammar & spelling',m.pending?'Assessment incomplete':!m.valid?'Repair form first':m.annotations.some(x=>!x.optional)?'Corrections to review':m.annotations.length?'Optional refinements':'Review saved feedback',grammar,'swtReviewLanguage')+
      section(3,'Form',m.pending?'Assessment incomplete':m.valid?'Meets form checks':'Needs attention',form,'swtReviewForm')+revision;
  }
  function mount(target,data,passage,text,options={}){
    const m=model(data,passage,text);target.innerHTML=render(m);
    const valid=()=>options.isCurrent?.()!==false;
    const q=s=>target.querySelector(s);let undo=null;
    const original=()=>target.ownerDocument.getElementById('annotatedSubmission');
    const open=()=>{q('#swtReviewEditor').hidden=false;q('#swtReviewDraft').focus();};
    target.onclick=event=>{
      const button=event.target.closest('button');if(!button||!target.contains(button)||!valid())return;
      if(button.hasAttribute('data-review-fix')){
        const item=m.annotations[Number(button.dataset.reviewFix)];if(!item)return;
        target.querySelectorAll('[data-review-fix]').forEach(el=>el.setAttribute('aria-expanded',String(el===button)));
        const panel=q('#swtReviewCorrection');panel.hidden=false;
        panel.innerHTML='<strong>'+esc(item.optional?'Optional '+item.kind.toLowerCase():item.kind)+'</strong><h3><s>'+esc(item.phrase)+'</s> → '+esc(item.fix)+'</h3><p>'+esc(item.reason||'Review this suggested correction in context before revising.')+'</p>'+(item.optional&&item.after>m.wordCount?'<p class="swt-help">'+item.after+' of 75 words after this change alone.</p>':'');
      }
      if(button.hasAttribute('data-review-source')){const source=target.ownerDocument.getElementById('annotatedPassage');source?.closest('details')?.setAttribute('open','');source?.scrollIntoView({block:'center'});source?.focus();}
      if(button.hasAttribute('data-review-locate')&&original()&&m.quote){target.ownerDocument.getElementById('sbsTabSummary')?.click();const el=original(),start=m.text.indexOf(m.quote);el.innerHTML=esc(m.text.slice(0,start))+'<mark>'+esc(m.quote)+'</mark>'+esc(m.text.slice(start+m.quote.length));el.scrollIntoView({block:'center'});el.focus();}
      if(button.hasAttribute('data-review-edit'))open();
      if(button.hasAttribute('data-review-use')){
        const draft=button.dataset.reviewUse==='language'?m.languageDraft:m.repair;
        if(draft){undo=q('#swtReviewDraft').value;q('#swtReviewDraft').value=draft;q('#swtReviewWords').textContent=words(draft);q('[data-review-undo]').hidden=false;open();}
      }
      if(button.hasAttribute('data-review-undo')&&undo!==null){q('#swtReviewDraft').value=undo;undo=null;q('#swtReviewWords').textContent=words(q('#swtReviewDraft').value);button.hidden=true;}
      if(button.hasAttribute('data-review-save')||button.hasAttribute('data-review-continue')){
        const saved=options.saveDraft?.(q('#swtReviewDraft').value);
        q('#swtReviewSaveStatus').textContent=saved===false?'This device could not save the draft. Keep a copy before leaving.':'Revision draft saved. Your submitted answer is unchanged.';
        if(saved!==false&&button.hasAttribute('data-review-continue'))options.continueWriting?.();
      }
    };
    target.oninput=e=>{if(e.target.id==='swtReviewDraft'&&valid()){q('#swtReviewWords').textContent=words(e.target.value);q('#swtReviewSaveStatus').textContent='Draft edited. Save when ready.';}};
    return m;
  }
  return {model,render,mount};
});
