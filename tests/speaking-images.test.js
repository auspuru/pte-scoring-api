'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),images=require('../public/speaking-images');
const q={title:'Rainfall <chart>',imageUrl:'/assets/original.png',displayImageUrl:'/assets/clear.svg',imageLegend:[['Forests','#007541']]};
test('clear images retain a safe canonical fallback and escaped accessible labels',()=>{
  const html=images.image(q);assert.match(html,/src="\/assets\/clear.svg"/);assert.match(html,/data-original-image="\/assets\/original.png"/);assert.match(html,/Rainfall &lt;chart&gt;/);assert.match(html,/decoding="async"/);
  assert.equal(images.source({imageUrl:'//external.example/image.png',displayImageUrl:'/assets/clear.svg'}),'');
  assert.equal(images.source({...q,displayImageUrl:'javascript:alert(1)'}),q.imageUrl);
  assert.equal(images.source({...q,displayImageUrl:'/\\external.example/image.png'}),q.imageUrl);
  assert.equal(images.source({imageUrl:'/speaking-image/di-1.svg'}),'/speaking-image/di-1.svg');
  const legend=images.legend({...q,imageLegend:[...q.imageLegend,['<Unsafe>','#ffffff'],['Invalid','red; display:none']]});
  assert.match(legend,/Forests/);assert.match(legend,/&lt;Unsafe&gt;/);assert.doesNotMatch(legend,/display:none/);
});
test('failed enhanced downloads retry the saved original only once without a request loop',()=>{
  const listeners=[],host={addEventListener:(...args)=>listeners.push(args)};images.bindFallback(host);images.bindFallback(host);assert.equal(listeners.length,1);assert.equal(listeners[0][2],true);
  const target={tagName:'IMG',dataset:{originalImage:q.imageUrl},src:q.displayImageUrl};listeners[0][1]({target});assert.equal(target.src,q.imageUrl);assert.equal(target.dataset.originalImage,undefined);
  target.src='failed-original';listeners[0][1]({target});assert.equal(target.src,'failed-original');
});
function viewer(width,height,naturalWidth,naturalHeight){
  const viewport={clientWidth:width,clientHeight:height,scrollTop:50,scrollLeft:30},picture={naturalWidth,naturalHeight,style:{}},output={},minus={},plus={},events=new Map();
  const nodes={'img':picture,'[data-image-viewport]':viewport,'[data-image-scale]':output,'[data-image-action="out"]':minus,'[data-image-action="in"]':plus};
  const dialog={innerHTML:'',classList:{add(){}},querySelector:s=>nodes[s],showModal(){this.open=true;},close(){this.open=false;},addEventListener(){}};
  const api=images.create({addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)});api.open(dialog,q);
  return{api,dialog,viewport,picture,output,minus,plus,events,click(action){dialog.onclick({target:{closest:()=>({dataset:{imageAction:action}})},stopPropagation(){}});}};
}
test('portrait and landscape viewers fit both axes, zoom without distortion and scroll larger details',()=>{
  for(const args of [[1200,680,1450,1680],[360,440,1512,771],[1200,680,6693,3977]]){
    const v=viewer(...args),fit=parseFloat(v.picture.style.width);assert(v.dialog.open);assert(fit<=args[0]-32+1);assert(fit*args[3]/args[2]<=args[1]-32+1);assert.equal(v.picture.style.height,'auto');
    v.click('in');assert(Math.abs(parseFloat(v.picture.style.width)-fit*1.25)<=1);assert.equal(v.output.textContent,'125%');
    for(let n=0;n<50;n++)v.click('in');assert.equal(v.plus.disabled,true);assert(parseFloat(v.picture.style.width)>args[0]);
    v.click('fit');assert.equal(v.picture.style.width,fit+'px');assert.equal(v.viewport.scrollLeft,0);assert.equal(v.viewport.scrollTop,0);assert.equal(v.minus.disabled,true);
    v.viewport.clientWidth=280;v.events.get('resize')();assert(parseFloat(v.picture.style.width)<=249);
    assert.match(v.dialog.innerHTML,/aria-label="Close image"/);assert.match(v.dialog.innerHTML,/Forests/);v.click('close');assert.equal(v.dialog.open,false);assert.equal(v.events.size,0);assert.equal(v.picture.onload,null);
  }
});
test('closing or leaving a viewer removes handlers and ignores a late image load',()=>{
  const v=viewer(1000,600,1512,771),late=v.picture.onload;v.api.close();const old=v.picture.style.width;late();assert.equal(v.picture.style.width,old);assert.equal(v.events.size,0);assert.equal(v.dialog.onclick,null);
  v.api.open(v.dialog,{imageUrl:'/old/saved.png'});assert.match(v.dialog.innerHTML,/src="\/old\/saved.png"/);assert.doesNotMatch(v.dialog.innerHTML,/clear.svg/);v.dialog.onclose();assert.equal(v.dialog.open,false);
});
