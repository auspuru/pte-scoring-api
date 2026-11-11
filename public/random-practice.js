(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RandomPracticeUI=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function createController(env,{getUserId,launchSpeaking,launchWriting}){
    let host,owner='',epoch=0,visible=false,busy=false,catalog=[],history=[],type='',count=5,limit=12;
    const identity=()=>String(getUserId()||'').trim().toLowerCase();
    const valid=ticket=>visible&&ticket===epoch&&owner===identity();
    function token(){try{return env.sessionStorage?.getItem('pte_impersonate_token')||env.sessionStorage?.getItem('pte_session_token')||env.localStorage?.getItem('pte_session_token')||'';}catch{return '';}}
    async function api(path){const r=await env.fetch('/api/practice-sets'+path,{headers:{'x-session-token':token()},cache:'no-store',signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw Error(data.error||'Practice sets could not load. Please retry.');return data;}
    function leave(){visible=false;epoch++;busy=false;}
    function reset(){leave();owner='';catalog=[];history=[];type='';count=5;host?.replaceChildren();}
    async function open(){
      if(owner&&owner!==identity())reset();owner=identity();if(!owner)return;
      visible=true;busy=false;host=env.document.getElementById('randomPracticePane');const ticket=++epoch;
      host.innerHTML='<div class="rp-page"><p role="status">Loading practice sets…</p></div>';
      try{const [data,rows]=await Promise.all([api('/catalog'),api('/attempts')]);if(!valid(ticket))return;catalog=data.types;history=rows;render();}
      catch(error){if(valid(ticket)){host.innerHTML='<div class="rp-page"><h2>Random practice sets</h2><p role="alert">'+esc(error.message)+'</p><button class="portal-button" data-rp="reload">Retry</button></div>';host.onclick=click;}}
    }
    function render(){
      if(!catalog.some(row=>row.type===type))type=catalog[0]?.type||'';
      const row=catalog.find(row=>row.type===type);if(!row?.counts.includes(count))count=row?.counts[0]||5;
      host.innerHTML='<div class="rp-page"><header class="catalogue-heading"><h2>Choose your practice set</h2><p>Choose one question type and how many questions to practise. We pick the questions for you.</p></header>'
        +'<section class="rp-setup" aria-labelledby="rp-setup-heading"><h3 id="rp-setup-heading">Build your practice set</h3><div class="rp-fields"><label>Question type<select id="practice-set-type">'+catalog.map(t=>'<option value="'+esc(t.type)+'"'+(t.type===type?' selected':'')+'>'+esc(t.label)+'</option>').join('')+'</select></label><label>Number of questions<select id="practice-set-count">'+(row?.counts||[]).map(n=>'<option value="'+n+'"'+(n===count?' selected':'')+'>'+n+' questions</option>').join('')+'</select></label></div><p class="rp-pool">'+esc(row?.available||0)+' different questions available. Each set contains no repeated questions.</p>'
        +'<p>Your overall practice score and individual results are saved after you finish.</p><button class="portal-button primary" id="practice-set-start" data-rp="start"'+(!row?.counts.length?' disabled':'')+'>Start random practice</button><p id="rp-notice" role="alert"></p></section>'
        +'<section class="rp-history" aria-labelledby="rp-history-heading"><h3 id="rp-history-heading">Your saved practice sets</h3>'+(history.length?'<ul>'+history.slice(0,limit).map((a,i)=>'<li><div><h4>'+esc(a.title)+'</h4><p>'+esc(new Date(a.startedAt).toLocaleString())+' · '+(a.status==='active'?'In progress':a.ready?'Completed':'Preparing results')+'</p></div><strong class="rp-score">'+(a.ready&&Number.isFinite(a.score90)?esc(a.score90)+'<small> / 90</small>':'—')+'</strong><div class="rp-actions"><button class="portal-button" data-rp="resume" data-index="'+i+'">'+(a.status==='active'?'Continue':a.ready?'View results':'View status')+'</button>'+(a.status==='submitted'?'<button class="portal-button" data-rp="again" data-index="'+i+'">New random set</button>':'')+'</div></li>').join('')+'</ul>'+(history.length>limit?'<button class="portal-button" data-rp="more">Show more</button>':''):'<p>No saved practice sets yet.</p>')+'</section></div>';
      host.onclick=click;host.onchange=event=>{if(event.target.id==='practice-set-type'){type=event.target.value;render();}if(event.target.id==='practice-set-count')count=Number(event.target.value);};
    }
    async function launch(config,attempt){
      if(busy||owner!==identity())return;busy=true;const button=env.document.getElementById('practice-set-start');if(button)button.disabled=true;
      try{const request=attempt?{attemptId:attempt.id}:{practiceSet:{type:config.type,count:config.count}};await(config.type==='wfd'?launchWriting(request):launchSpeaking(request));}
      catch(error){const node=env.document.getElementById('rp-notice');if(node)node.textContent=error.message;}
      finally{busy=false;if(button?.isConnected)button.disabled=false;}
    }
    async function click(event){const button=event.target.closest('[data-rp]');if(!button||button.disabled)return;
      if(button.dataset.rp==='reload')return open();if(button.dataset.rp==='start')return launch({type,count});
      if(button.dataset.rp==='more'){limit+=12;render();return;}
      const row=history[Number(button.dataset.index)];if(!row)return;
      if(button.dataset.rp==='resume')return launch(row,row);if(button.dataset.rp==='again')return launch(row);
    }
    return{open,leave,reset};
  }
  return{createController};
});
