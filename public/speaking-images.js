(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SpeakingImages=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const local=url=>typeof url==='string'&&/^\/(?!\/)[^\s\\]+$/.test(url)?url:'';
  const original=q=>local(q?.imageUrl),source=q=>original(q)&&(local(q?.displayImageUrl)||original(q));
  function image(q,className=''){
    const src=source(q),canonical=original(q);if(!src)return '';
    return '<img class="'+esc(className)+'" src="'+esc(src)+'" alt="'+esc(q.title||'Image to describe')+'" decoding="async"'+(src!==canonical?' data-original-image="'+esc(canonical)+'"':'')+'>';
  }
  function legend(q){
    const items=Array.isArray(q?.imageLegend)?q.imageLegend.filter(v=>Array.isArray(v)&&typeof v[0]==='string'&&/^#[a-f0-9]{6}$/i.test(v[1])):[];
    return items.length?'<ul class="speaking-image-legend" aria-label="Image legend">'+items.map(([label,color])=>'<li><span aria-hidden="true" style="background:'+color+'"></span>'+esc(label)+'</li>').join('')+'</ul>':'';
  }
  // Capture image errors because they do not bubble. Try the saved original
  // once; a broken fallback must not create a request loop.
  const bound=new WeakSet();
  function bindFallback(host){
    if(!host?.addEventListener||bound.has(host))return;bound.add(host);
    host.addEventListener('error',event=>{
      const img=event.target,canonical=local(img?.dataset?.originalImage);
      if(img?.tagName!=='IMG'||!canonical)return;
      delete img.dataset.originalImage;img.src=canonical;
    },true);
  }
  function create(env){
    let dialog,zoom=1,base=1,picture,viewport,resize;
    function update(){
      if(!picture||!viewport)return;
      const width=picture.naturalWidth||1200,height=picture.naturalHeight||800;
      base=Math.min(Math.max(1,viewport.clientWidth-32)/width,Math.max(1,viewport.clientHeight-32)/height);
      picture.style.width=Math.round(width*base*zoom)+'px';picture.style.height='auto';
      const scale=dialog.querySelector('[data-image-scale]');if(scale)scale.textContent=Math.round(zoom*100)+'%';
      const minus=dialog.querySelector('[data-image-action="out"]'),plus=dialog.querySelector('[data-image-action="in"]');
      if(minus)minus.disabled=zoom<=1;if(plus)plus.disabled=zoom>=8;
    }
    function close(){
      if(resize)env.removeEventListener?.('resize',resize);resize=null;
      if(picture)picture.onload=null;
      const previous=dialog;dialog=picture=viewport=null;
      if(previous){previous.onclick=null;previous.onclose=null;previous.close?.();}
    }
    function open(node,q){
      if(!node||!source(q))return;close();dialog=node;zoom=1;
      dialog.classList?.add('speaking-image-viewer');
      dialog.innerHTML='<header><h3>'+esc(q.title||'Question image')+'</h3><button type="button" class="portal-button" data-image-action="close" aria-label="Close image">Close</button></header>'
        +'<nav class="speaking-image-zoom" aria-label="Image zoom"><button type="button" class="portal-button" data-image-action="out" aria-label="Zoom out">−</button><output data-image-scale>100%</output><button type="button" class="portal-button" data-image-action="in" aria-label="Zoom in">+</button><button type="button" class="portal-button" data-image-action="fit">Fit to screen</button></nav>'
        +'<div class="speaking-image-viewport" data-image-viewport tabindex="0" aria-label="Question image; scroll to see enlarged details">'+image(q)+'</div>'+legend(q);
      bindFallback(dialog);
      picture=dialog.querySelector?.('img');viewport=dialog.querySelector?.('[data-image-viewport]');
      if(!picture||!viewport||!dialog.showModal){env.open?.(source(q),'_blank','noopener,noreferrer');return;}
      picture.onload=()=>{if(dialog===node)update();};
      dialog.onclick=e=>{
        const action=e.target.closest('[data-image-action]')?.dataset.imageAction;if(!action)return;e.stopPropagation();
        if(action==='close')return close();
        if(action==='fit')zoom=1;else if(action==='in')zoom=Math.min(8,zoom+.25);else if(action==='out')zoom=Math.max(1,zoom-.25);
        update();if(action==='fit'){viewport.scrollLeft=0;viewport.scrollTop=0;}
      };
      dialog.onclose=()=>close();dialog.showModal();update();
      resize=()=>{if(dialog===node)update();};env.addEventListener?.('resize',resize);
    }
    return{open,close};
  }
  return{source,original,image,legend,bindFallback,create};
});
