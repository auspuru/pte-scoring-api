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
    host.querySelectorAll('[data-listening-word]').forEach(button=>button.addEventListener('click',()=>{
      if(!canEdit())return;
      const i=Number(button.dataset.listeningWord), a=parse(editor.value), selected=!a.includes(i);
      button.setAttribute('aria-pressed',String(selected));save(selected?[...a,i].sort((x,y)=>x-y):a.filter(x=>x!==i));
    }));
  }
  function response(q,text){
    const a=parse(text);
    if(!a.length)return 'No answer submitted.';
    if(q.type==='lfi')return a.map((value,i)=>'Blank '+(i+1)+': '+(value||'—')).join('\n');
    return a.map(i=>q.type==='hiw'?String(q.passage).split(/\s+/)[i]:q.choices?.[i]).filter(Boolean).join('\n')||'No answer submitted.';
  }
  function correct(q){return q.type==='lfi'?q.answers.map((word,i)=>'Blank '+(i+1)+': '+word).join('\n'):response(q,JSON.stringify(q.answers||[q.answer]));}
  return {isObjective,parse,render,bind,response,correct};
});
