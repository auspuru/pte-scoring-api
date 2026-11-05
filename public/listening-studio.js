(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./practice-studio'):root.PracticeStudio);if(typeof module==='object'&&module.exports)module.exports=api;else root.ListeningStudio=api;})(typeof globalThis!=='undefined'?globalThis:this,function(practice){
  'use strict';
  const tasks=[['sst','SST','Summarise Spoken Text','spoken-text'],['lmcma','MA','Multiple Choice, Multiple Answers','listening-lmcma'],['lfi','FIB','Fill in the Blanks','listening-lfi'],['hcs','HCS','Highlight Correct Summary','listening-hcs'],['lmcsa','SA','Multiple Choice, Single Answer','listening-lmcsa'],['smw','SMW','Select Missing Word','listening-smw'],['hiw','HIW','Highlight Incorrect Words','listening-hiw'],['wfd','WFD','Write From Dictation','dictation']];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const help={sst:'Listen first. Note the topic, two supporting ideas and a conclusion. Connect the ideas in a 50–70 word summary.',wfd:'Listen to the whole sentence, then type exactly what you hear. Check small words, plurals and spelling.',lfi:'Read ahead and type each missing word as you hear it. Use Tab and Shift+Tab to move between blanks. Check spelling.',hiw:'Select words that differ from the recording; select again to undo. Use arrow keys to move between words and Space or Enter to select. Incorrect selections lose points.',hcs:'Choose the summary that captures the main idea and supporting points. A true detail alone may not summarise the whole recording.',lmcma:'Select every option supported by the recording. Incorrect selections lose points, with a minimum of zero for the question.',lmcsa:'Read the question and choose the one option supported by the recording.',smw:'Listen to the context before the beep. Choose the missing word or phrase that best completes the recording.'};
  function questions(catalog,type){return type==='sst'?catalog?.spoken||[]:type==='wfd'?catalog?.dictation||[]:(catalog?.listeningPractice||[]).filter(q=>q.type===type);}
  const attemptMode=a=>a.mode==='practice'?'practice':'exam';
  function latest(history,id,mode='practice'){
    return history.filter(a=>String(a.testId)===String(id)&&attemptMode(a)===mode)
      .sort((a,b)=>new Date(b.startedAt).getTime()-new Date(a.startedAt).getTime())[0];
  }
  function visibleQuestions({items,history=[],bookmarks=[],search='',filter='all',mode='practice'}){
    const query=search.trim().toLowerCase();
    const matches=globalThis.PortalUx?new Set(globalThis.PortalUx.search(items.map((q,index)=>({q,text:[index+1,q.id,q.title,q.topic].join(' ')})),query,['text']).map(row=>row.q)):null;
    return items.map((q,index)=>({q,index,last:latest(history,q.id,mode),records:history.filter(a=>String(a.testId)===String(q.id)&&attemptMode(a)===mode)})).filter(({q,index,last,records})=>
      (!query||(matches?matches.has(q):[index+1,q.id,q.title,q.topic].join(' ').toLowerCase().includes(query)))&&
      (filter==='all'||filter==='new'&&!records.length||filter==='draft'&&records.some(a=>a.status!=='submitted')||filter==='done'&&records.some(a=>a.status==='submitted')||filter==='bookmarked'&&bookmarks.includes(q.id)));
  }
  function rows({items,history=[],bookmarks=[],activeId,search='',filter='all',mode='practice',compact=false}){
    const visible=visibleQuestions({items,history,bookmarks,search,filter,mode});
    return practice.libraryRows(visible.map(({q,index,last})=>{const records=history.filter(a=>String(a.testId)===String(q.id)&&attemptMode(a)===mode),draft=records.filter(a=>a.status!=='submitted').sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0],done=records.filter(a=>a.status==='submitted').length;return {id:q.id,number:index+1,title:q.title,status:done?'Completed · '+done+' saved attempts':draft?'In progress':'Not attempted',detail:[q.prediction?'Prediction':'',bookmarks.includes(q.id)?'Bookmarked':''].filter(Boolean).join(' · '),actions:'<button type="button" class="portal-button" data-listening-open="'+esc(q.id)+'">Practise →</button>'+(draft?'<button type="button" class="portal-button practice-library-resume" data-listening-attempt="'+esc(draft.id)+'" data-listening-question="'+esc(q.id)+'">Resume draft</button>':'')};}));
  }
  function wrap(content,{type,mode='practice',mock=false,items=[],history=[],bookmarks=[],activeId,search='',filter='all',library=false}){
    const task=tasks.find(t=>t[0]===type), title=task?.[2]||'Listening sectional mock';
    const nav=mock?'':'<div class="studio-tools"><button type="button" class="studio-home" data-portal="practice-hub">← All practice</button><details class="studio-task-switcher"><summary>Change task</summary><nav class="studio-task-nav" aria-label="Listening tasks">'+tasks.map(([id,short,label,route])=>'<button type="button" data-listening-type="'+id+'" data-listening-route="'+route+'" '+(id===type?'aria-current="page"':'')+'><span>'+short+'</span><b>'+label+'</b></button>').join('')+'</nav></details></div>';
    const modes=mock?'<span class="studio-mock-label">Protected sectional mock</span>':'<div class="studio-modes" role="group" aria-label="Practice mode"><button type="button" data-listening-mode="practice" aria-pressed="'+(mode==='practice')+'">Practice</button><button type="button" data-listening-mode="exam" aria-pressed="'+(mode==='exam')+'">Exam-style</button></div>';
    const aside='';
    return '<div class="listening-studio '+(mock?'studio-mock':'studio-focused')+'">'+nav+(library&&!mock?'':'<header class="studio-heading"><div><p>Listening '+(mock?'sectional mock':'practice')+'</p><h1>'+esc(mock?'Listening sectional mock':title)+'</h1>'+(mock?'<span>Stay focused on the current question.</span>':'')+'</div>'+modes+'</header>')+'<div class="studio-layout"><div class="studio-center">'+content+'</div>'+aside+'</div></div>';
  }
  return {tasks,help,questions,rows,wrap,latest,visibleQuestions,attemptMode};
});
