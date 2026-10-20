(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ListeningTasks=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const types=['lmcma','lfi','hcs','lmcsa','smw','hiw'];
  const isObjective=q=>types.includes(q?.type);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function parse(text){try{const a=JSON.parse(text);return Array.isArray(a)?a:[];}catch(_){return [];}}
  function render(q,text){
    const a=parse(text);
    if(q.type==='lfi')return '<div class="listening-transcript">'+esc(q.passage).replace(/\[\[(\d+)\]\]/g,(_,n)=>'<label class="listening-blank"><span class="listening-blank-number">'+n+'</span><input type="text" data-listening-blank="'+(n-1)+'" value="'+esc(a[n-1]||'')+'" aria-label="Blank '+n+'" spellcheck="false" autocorrect="off" autocomplete="off"></label>')+'</div>';
    if(q.type==='hiw')return '<div class="listening-transcript" aria-label="Transcript: select incorrect words">'+String(q.passage||'').split(/\s+/).map((word,i)=>'<button type="button" class="listening-word" data-listening-word="'+i+'" aria-pressed="'+a.includes(i)+'">'+esc(word)+'</button>').join(' ')+'</div>';
    return '<fieldset class="listening-choices"><legend>'+esc(q.type==='lmcma'?'Select all correct answers. Incorrect selections lose marks.':'Select one answer.')+'</legend>'+(q.choices||[]).map((choice,i)=>'<label><input type="'+(q.type==='lmcma'?'checkbox':'radio')+'" name="listening-choice" data-listening-choice="'+i+'" '+(a.includes(i)?'checked':'')+'><span>'+esc(choice)+'</span></label>').join('')+'</fieldset>';
  }
  function bind(host,q,editor,onInput,canEdit){
    const save=a=>{if(!canEdit())return;editor.value=JSON.stringify(a);onInput();};
    host.querySelectorAll('[data-listening-choice]').forEach(input=>input.addEventListener('change',()=>{
      const i=Number(input.dataset.listeningChoice), a=parse(editor.value).filter(x=>x!==i);
      if(input.checked)a.push(i);
      save(q.type==='lmcma'?a.sort((x,y)=>x-y):input.checked?[i]:[]);
    }));
    host.querySelectorAll('[data-listening-blank]').forEach(input=>input.addEventListener('input',()=>{
      const a=parse(editor.value);a[Number(input.dataset.listeningBlank)]=input.value;save(a);
    }));
    host.querySelectorAll('[data-listening-word]').forEach((button,wordIndex,buttons)=>button.addEventListener('click',()=>{
      if(!canEdit())return;
      const i=Number(button.dataset.listeningWord), a=parse(editor.value), selected=!a.includes(i);
      button.setAttribute('aria-pressed',String(selected));save(selected?[...a,i].sort((x,y)=>x-y):a.filter(x=>x!==i));
    }));
    const words=[...host.querySelectorAll('[data-listening-word]')];
    words.forEach((button,i)=>{
      button.setAttribute('tabindex',i===0?'0':'-1');
      button.addEventListener('keydown',event=>{
        if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
        event.preventDefault();
        const next=event.key==='Home'?0:event.key==='End'?words.length-1:Math.max(0,Math.min(words.length-1,i+(event.key==='ArrowRight'?1:-1)));
        words.forEach(word=>word.setAttribute('tabindex','-1'));words[next].setAttribute('tabindex','0');words[next].focus();
      });
    });
  }
  function response(q,text){
    const a=parse(text);
    if(!a.length)return 'No answer submitted.';
    if(q.type==='lfi')return a.map((value,i)=>'Blank '+(i+1)+': '+(value||'—')).join('\n');
    return a.map(i=>q.type==='hiw'?String(q.passage).split(/\s+/)[i]:q.choices?.[i]).filter(Boolean).join('\n')||'No answer submitted.';
  }
  function correct(q){return q.type==='lfi'?q.answers.map((word,i)=>'Blank '+(i+1)+': '+word).join('\n'):response(q,JSON.stringify(q.answers||[q.answer]));}
  function setEditable(host,enabled){host.querySelectorAll?.('[data-listening-choice],[data-listening-blank],[data-listening-word]').forEach(input=>{input.disabled=!enabled;});}
  function review(q,text){
    const selected=parse(text),corrects=q.answers||[q.answer];
    if(q.type==='lfi')return '<h3>Blank-by-blank review</h3>'+q.answers.map((word,i)=>{const answer=String(selected[i]||''),ok=answer.trim().toLowerCase()===word.toLowerCase();return '<div class="studio-review-row"><strong>Blank '+(i+1)+'</strong> <span class="'+(ok?'studio-correct':'studio-incorrect')+'">'+esc(answer||'Unanswered')+'</span> → <b>'+esc(word)+'</b> · '+(ok?'Correct':'Check spelling and the word you heard')+'</div>';}).join('');
    if(q.type==='hiw'){
      const written=q.passage.split(/\s+/),heard=q.text.split(/\s+/);
      return '<h3>Word-by-word review</h3>'+[...new Set([...corrects,...selected.filter(i=>Number.isInteger(i)&&i>=0&&i<written.length)])].sort((a,b)=>a-b).map(i=>'<div class="studio-review-row"><strong>'+esc(written[i])+'</strong> '+(corrects.includes(i)?'→ <b>'+esc(heard[i])+'</b> · <span class="'+(selected.includes(i)?'studio-correct':'studio-incorrect')+'">'+(selected.includes(i)?'Correct selection':'Missed mismatch'):'<span class="studio-incorrect">Unnecessary selection')+'</span></div>').join('');
    }
    return '<h3>Answer review</h3>'+q.choices.map((choice,i)=>'<div class="studio-review-row"><strong>'+String.fromCharCode(65+i)+'.</strong> '+esc(choice)+'<br><span class="'+(corrects.includes(i)?'studio-correct':selected.includes(i)?'studio-incorrect':'muted')+'">'+(corrects.includes(i)?selected.includes(i)?'✓ Correct selection':'Correct answer · not selected':selected.includes(i)?'Incorrect selection':'Not selected')+'</span></div>').join('');
  }
  function wordDiff(expected,actual){
    const words=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu,' ').trim().split(/\s+/).filter(Boolean).slice(0,500);
    const a=words(expected),b=words(actual),dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
    let i=0,j=0,out=[];while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){out.push({kind:'match',word:a[i++]});j++;}else if(j<b.length&&(i===a.length||dp[i][j+1]>dp[i+1][j]))out.push({kind:'extra',word:b[j++]});else out.push({kind:'missing',word:a[i++]});}
    return '<div class="studio-word-diff">'+out.map(w=>'<span class="'+w.kind+'" title="'+w.kind+'">'+esc(w.word)+'</span>').join('')+'</div><p class="muted">Green: matched · Amber: missing · Red: extra or misspelled. This comparison explains the sentence; the score above comes from your assessment.</p>';
  }
  return {isObjective,parse,render,bind,response,correct,review,setEditable,wordDiff};
});
