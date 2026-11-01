(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./essay-guidance-data'));
  else root.EssayGuide=factory(root.EssayGuidanceData,root);
})(typeof globalThis!=='undefined'?globalThis:this,function(data,root){
  'use strict';
  // Typography and whitespace only. Never infer requirements from a title or number.
  const normalize=text=>String(text||'').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
  const index=new Map();
  for(const guide of data.guides){
    index.set(normalize(guide.prompt),guide);
    for(const alias of guide.aliases||[])index.set(normalize(alias.prompt),{...guide,...alias});
  }
  function lookup(prompt){return index.get(normalize(prompt))||null;}
  const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label=text=>text.charAt(0)+text.slice(1).toLowerCase();
  function approachHTML(guide,a,i){
    return `<article class="essay-guide-option"><button type="button" class="essay-guide-choice" data-guide-choice="${i}" aria-expanded="false" aria-controls="essay-guide-route-${i}"><strong>${esc(label(a.label))}</strong><span>${esc(a.stance)}</span><small>Show explanation below</small></button><section id="essay-guide-route-${i}" class="essay-guide-explanation" data-guide-explanation hidden aria-label="${esc(label(a.label))} explanation"><h4>How this answers the question</h4><p>${esc(a.why)}</p>${[1,2].map(n=>`<div class="essay-guide-reason"><h4>${esc(a['bp'+n+'_heading'].replace(/^BP[12]:\s*/,''))}</h4><p>${esc(a['bp'+n])}</p><p class="essay-guide-illustration"><strong>Possible illustration</strong>${esc(a['example'+n])}</p></div>`).join('')}<p class="essay-guide-note">${esc(guide.experience)} ${guide.personalRequired?'These illustrations explain the reasoning; replace them with a relevant experience that actually happened to you.':'Choose relevant support for your argument. Do not invent research, statistics or a first-person history.'}</p><details><summary>See a paragraph demonstration</summary><p class="essay-guide-note">Illustrative development, not a complete essay or a compulsory sentence pattern.</p>${[1,2].map(n=>`<p><strong>Body ${n}.</strong> ${esc(a['bp'+n])} For example, ${esc(a['example'+n].charAt(0).toLowerCase()+a['example'+n].slice(1))}</p>`).join('')}</details></section></article>`;
  }
  function bodyHTML(prompt,guide){
    return `<section class="essay-guide-question"><span class="essay-guide-eyebrow">The exact question</span><p data-guide-prompt>${esc(prompt)}</p></section>`+(guide?`<section aria-labelledby="essay-guide-understand"><h3 id="essay-guide-understand">Understand the question</h3><p class="essay-guide-meaning">${esc(guide.meaning)}</p><dl class="essay-guide-breakdown">${guide.promptBreakdown.map(p=>`<div><dt>“${esc(p.quote)}”</dt><dd>${esc(p.explanation)}</dd></div>`).join('')}</dl><div class="essay-guide-requirements"><h4>What your answer needs</h4><p>${esc(guide.requirements)}</p><p>${esc(guide.experience)}</p></div><p class="essay-guide-trap"><strong>Watch out</strong>${esc(guide.pitfall)}</p></section><section aria-labelledby="essay-guide-approaches"><h3 id="essay-guide-approaches">Choose an approach</h3><p class="essay-guide-note">Optional: select an approach to see its explanation directly below. These are alternative ways to answer; choose one coherent position or develop your own.</p><div class="essay-guide-options">${guide.approaches.map((a,i)=>approachHTML(guide,a,i)).join('')}<article class="essay-guide-option"><button type="button" class="essay-guide-choice" data-guide-choice="own" aria-expanded="false" aria-controls="essay-guide-route-own"><strong>My own approach</strong><span>Use a different relevant position and support it clearly.</span><small>Show explanation below</small></button><section id="essay-guide-route-own" class="essay-guide-explanation" data-guide-explanation hidden aria-label="Your own approach"><h4>Your argument is welcome</h4><p>Make sure it addresses the required parts: ${esc(guide.requirements)}</p><p>${esc(guide.experience)}</p><label for="essay-guide-own">Your position in one sentence (optional)</label><textarea id="essay-guide-own" rows="2" maxlength="1000" placeholder="What is your view, and why?"></textarea><p class="essay-guide-note">This note is only for this guide session. It is not saved or included in your essay or assessment.</p></section></article></div><p class="essay-guide-note">${esc(guide.check)} Your feedback assesses the essay you submit; selecting an approach does not affect your marks.</p></section>`:`<section><h3>Read each instruction carefully</h3><p>A detailed guide has not been reviewed for this exact question. Identify every part you need to answer, the position requested and any instruction about examples or your own experience.</p><p>You can continue writing with this prompt.</p></section>`);
  }
  function createController({document,storage}={}){
    let active=null;
    function key(owner){return 'ipt_essay_guide:'+data.version+':'+encodeURIComponent(owner);}
    function read(owner){try{const saved=JSON.parse(storage?.getItem(key(owner))||'{}');return {autoShow:saved.autoShow!==false,seen:Array.isArray(saved.seen)?saved.seen:[]};}catch(_){return {autoShow:true,seen:[]};}}
    function shouldShow(owner,prompt){const saved=read(owner);return !!owner&&!!lookup(prompt)&&saved.autoShow&&!saved.seen.includes(normalize(prompt));}
    function close(){
      if(!active)return;
      const current=active;active=null;
      current.dialog.close();current.dialog.remove();
      if(current.trigger?.isConnected)current.trigger.focus({preventScroll:true});
    }
    function open({owner,prompt,title='',mode='start',isCurrent=()=>true,onContinue=()=>{}}){
      if(!document||!owner||!isCurrent())return false;
      if(active)return true;
      const guide=lookup(prompt),dialog=document.createElement('dialog'),trigger=document.activeElement;
      dialog.className='essay-guide-dialog';dialog.id='essay-guide';
      dialog.setAttribute('aria-labelledby','essay-guide-title');
      dialog.innerHTML=`<div class="essay-guide-shell"><header class="essay-guide-header"><img class="essay-guide-logo" src="/assets/ipt-brisbane-logo.webp" alt="IPT Brisbane"><div><span class="essay-guide-eyebrow">Essay practice · ${esc(title||'Your question')}</span><h2 id="essay-guide-title" tabindex="-1">Understand &amp; approaches</h2></div><button type="button" class="essay-guide-close" data-guide-close aria-label="Close question guide">×</button></header><div class="essay-guide-body">${bodyHTML(prompt,guide)}</div><footer class="essay-guide-footer">${`<label class="essay-guide-preference"><input type="checkbox" data-guide-auto ${read(owner).autoShow?'checked':''}> Show guides before new questions</label>`}${mode==='start'?`<p class="essay-guide-note">You can skip the guide or reopen it while writing. Time mode starts on your first word.</p>`:'<p class="essay-guide-note">Your writing clock continues while this guide is open if Time mode has already started.</p>'}<div class="essay-guide-actions">${mode==='start'?'<button type="button" class="essay-guide-skip" data-guide-continue>Skip guide</button>':''}<button type="button" class="essay-guide-primary" data-guide-continue>${mode==='start'?'Start writing →':'Back to writing'}</button></div></footer></div>`;
      document.body.appendChild(dialog);active={dialog,trigger};
      dialog.querySelector('[data-guide-close]').addEventListener('click',close);
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
      for(const button of dialog.querySelectorAll('[data-guide-choice]'))button.addEventListener('click',()=>{
        if(!isCurrent()){close();return;}
        const selected=button.getAttribute('aria-controls');
        for(const option of dialog.querySelectorAll('[data-guide-choice]')){
          const chosen=option===button;option.setAttribute('aria-expanded',String(chosen));
          option.querySelector('small').textContent=chosen?'Explanation below':'Show explanation below';
        }
        for(const panel of dialog.querySelectorAll('[data-guide-explanation]'))panel.hidden=panel.id!==selected;
        // Keep the chosen card visible; its explanation follows it in DOM and visual order.
        button.scrollIntoView({block:'nearest'});
      });
      for(const button of dialog.querySelectorAll('[data-guide-continue]'))button.addEventListener('click',()=>{
        if(!active||active.dialog!==dialog)return;
        if(!isCurrent()){close();return;}
        const saved=read(owner);saved.autoShow=dialog.querySelector('[data-guide-auto]').checked;
        if(mode==='start')saved.seen=[...new Set([...saved.seen,normalize(prompt)])].slice(-64);
        try{storage?.setItem(key(owner),JSON.stringify(saved));}catch(_){/* Help remains usable without storage. */}
        close();if(isCurrent())onContinue();
      });
      dialog.showModal();dialog.querySelector('#essay-guide-title').focus();return true;
    }
    return {open,close,shouldShow};
  }
  let controller;
  function getController(){
    if(!controller&&root?.document){let storage;try{storage=root.localStorage;}catch(_){}controller=createController({document:root.document,storage});}
    return controller;
  }
  return {version:data.version,normalize,lookup,bodyHTML,createController,shouldShow:(...args)=>getController()?.shouldShow(...args),open:options=>getController()?.open(options),close:()=>getController()?.close()};
});
