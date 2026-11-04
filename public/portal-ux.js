/* Optional presentation enhancements. Native controllers own attempts, timing and reports. */
(function(root,factory){
 const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.PortalUx=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(env){
 'use strict';
 const doc=env.document,loads=new Map(),resources=new Set();
 const assets={chart:['/vendor/chart.js/4.6.1/chart.umd.min.js','Chart'],table:['/vendor/tabulator-tables/6.7.1/tabulator.min.js','Tabulator'],wave:['/vendor/wavesurfer.js/8.0.5/wavesurfer.min.js','WaveSurfer']};
 function load(name){
  const [src,global]=assets[name];if(env[global])return Promise.resolve(env[global]);
  if(!loads.has(name))loads.set(name,new Promise((resolve,reject)=>{const script=doc.createElement('script');script.src=src;script.onload=()=>env[global]?resolve(env[global]):reject(Error('Unavailable enhancement'));script.onerror=()=>{loads.delete(name);script.remove();reject(Error('Unavailable enhancement'));};doc.head.appendChild(script);}));
  return loads.get(name);
 }
 function own(node,dispose){const item={node,dispose};resources.add(item);return()=>{if(resources.delete(item))dispose();};}
 function connected(node){return node.isConnected&&!node.closest('[hidden]');}
 function cleanup(){for(const item of [...resources])if(!connected(item.node)){resources.delete(item);item.dispose();}}
 if(doc&&env.MutationObserver)new env.MutationObserver(cleanup).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
 function search(items,query,keys){
  const text=String(query||'').trim();if(!text)return items;
  const exact=items.filter(item=>keys.some(key=>String(key.split('.').reduce((value,k)=>value?.[k],item)||'').toLowerCase().includes(text.toLowerCase())));
  if(exact.length||text.length<2||/^\d+$/.test(text))return exact;
  if(env.Fuse)return new env.Fuse(items,{keys,threshold:.32,ignoreLocation:true,minMatchCharLength:2,includeScore:true}).search(text).map(hit=>hit.item);
  return items.filter(item=>keys.some(key=>String(key.split('.').reduce((value,k)=>value?.[k],item)||'').toLowerCase().includes(text.toLowerCase())));
 }
 function activityDays(items,now=Date.now()){
  const key=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'Australia/Brisbane'}),today=key(now),anchor=Date.parse(today+'T12:00:00+10:00');
  const days=Array.from({length:7},(_,i)=>({day:key(anchor-(6-i)*86400000),count:0}));
  for(const item of items){const time=typeof item.at==='number'?item.at:Date.parse(item.at);if(!Number.isFinite(time)||item.status==='Saved draft')continue;const day=days.find(d=>d.day===key(time));if(day)day.count++;}
  return days;
 }
 function progress(host,items){
  if(!doc||!items.length)return;
  const section=doc.createElement('section');section.className='portal-ux-activity';
  section.innerHTML='<h3>Practice activity</h3><p class="progress-caption">Submitted questions over the last seven days · Brisbane time</p><div class="portal-ux-chart"><canvas role="img" aria-label="Submitted practice questions over the last seven days"></canvas></div><p class="portal-ux-chart-summary"></p>';
  host.querySelector('.progress-heading')?.after(section);
  const days=activityDays(items),label=day=>new Date(day+'T12:00:00+10:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',timeZone:'Australia/Brisbane'}),summary=section.querySelector('.portal-ux-chart-summary');summary.textContent=days.map(d=>label(d.day)+': '+d.count).join(' · ');
  load('chart').then(Chart=>{if(!connected(section))return;const chart=new Chart(section.querySelector('canvas'),{type:'bar',data:{labels:days.map(d=>label(d.day)),datasets:[{label:'Submitted questions',data:days.map(d=>d.count),backgroundColor:'#537b70',borderRadius:4,maxBarThickness:42}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}},x:{grid:{display:false}}}}});own(section,()=>chart.destroy());}).catch(()=>{section.querySelector('.portal-ux-chart').hidden=true;});
  table(host,items);
 }
 function table(host,items){
  const recent=host.querySelector('.progress-recent'),fallback=recent?.querySelector('.progress-attempts');if(!fallback)return;
  const panel=doc.createElement('div');panel.className='portal-ux-history';panel.innerHTML='<div class="portal-ux-history-tools"><label>Search saved questions<input type="search" placeholder="Search title, task or status" aria-label="Search saved questions"></label><button type="button" class="portal-button" aria-pressed="false">List view</button></div><p class="progress-caption" role="status"></p><div class="portal-ux-grid" aria-label="Saved question history"></div>';
  const more=recent.querySelector('[data-progress-more]');recent.appendChild(panel);panel.hidden=true;
  load('table').then(Tabulator=>{
   if(!connected(recent))return;
   const rows=items.map((item,index)=>({...item,rowIndex:index,dateValue:(typeof item.at==='number'?item.at:Date.parse(item.at))||0}));
   const textCell=cell=>{const node=doc.createElement('span');node.textContent=String(cell.getValue()??'');return node;};
   const grid=new Tabulator(panel.querySelector('.portal-ux-grid'),{data:rows,index:'rowIndex',layout:'fitColumns',pagination:true,paginationSize:20,paginationSizeSelector:[10,20,50],placeholder:'No matching saved questions',initialSort:[{column:'dateValue',dir:'desc'}],columns:[
    {title:'Question',field:'title',minWidth:210,widthGrow:3,formatter:textCell},
    {title:'Task',field:'task',minWidth:150,widthGrow:2,formatter:cell=>{const node=doc.createElement('span');node.textContent=cell.getValue()||cell.getRow().getData().title;return node;}},
    {title:'Date',field:'dateValue',sorter:'number',width:125,formatter:cell=>{const node=doc.createElement('span');node.textContent=cell.getValue()?new Date(cell.getValue()).toLocaleDateString('en-AU',{timeZone:'Australia/Brisbane'}):'Unavailable';return node;}},
    {title:'Status',field:'status',minWidth:150,formatter:textCell},
    {title:'Open',field:'rowIndex',width:100,headerSort:false,formatter:cell=>{const button=doc.createElement('button');button.type='button';button.className='portal-button';button.dataset.progressAttempt=String(cell.getValue());button.textContent=cell.getRow().getData().status==='Saved draft'?'Continue':'Review';button.setAttribute('aria-label',button.textContent+' '+cell.getRow().getData().title);return button;}}
   ]});
   const status=panel.querySelector('[role="status"]');status.textContent=rows.length+' saved questions';
   const input=panel.querySelector('input');input.oninput=()=>{const matches=new Set(search(rows,input.value,['title','task','status']).map(row=>row.rowIndex));grid.setFilter(row=>matches.has(row.rowIndex));status.textContent=matches.size+' of '+rows.length+' saved questions';};
   const toggle=panel.querySelector('button');let list=fallback.contains(doc.activeElement);const view=()=>{fallback.hidden=!list;if(more)more.hidden=!list;panel.querySelector('.portal-ux-grid').hidden=list;input.disabled=list;toggle.textContent=list?'Table view':'List view';toggle.setAttribute('aria-pressed',String(list));};toggle.onclick=()=>{list=!list;view();if(!list)grid.redraw(true);};
   panel.hidden=false;view();grid.on('tableBuilt',()=>grid.redraw(true));
   own(panel,()=>{grid.destroy();panel.remove();fallback.hidden=false;if(more)more.hidden=false;});
  }).catch(()=>panel.remove());
 }
 const waves=new WeakMap();
 function recording(node){
  const media=node?.querySelector('audio');if(!media||!doc)return;
  waves.get(node)?.();
  const panel=doc.createElement('details');panel.className='portal-ux-wave';panel.innerHTML='<summary>Explore your recording</summary><p class="progress-caption">Select a point on the waveform, then use the audio controls to listen.</p><div class="portal-ux-waveform"></div><label>Jump to time<input type="range" min="0" max="0" step="0.1" value="0" aria-label="Recording position"></label><p role="status"></p>';node.appendChild(panel);
  let dead=false,instance,loading=false;
  const slider=panel.querySelector('input'),status=panel.querySelector('[role="status"]');
  const update=()=>{const duration=media.duration;if(!Number.isFinite(duration))return;slider.max=String(duration);slider.value=String(media.currentTime);status.textContent=Math.floor(media.currentTime)+' / '+Math.floor(duration)+' seconds';};
  slider.oninput=()=>{if(Number.isFinite(media.duration))media.currentTime=Math.min(media.duration,Number(slider.value));};
  media.addEventListener('timeupdate',update);media.addEventListener('loadedmetadata',update);update();
  const dispose=own(panel,()=>{dead=true;instance?.destroy();media.pause();media.removeEventListener('timeupdate',update);media.removeEventListener('loadedmetadata',update);panel.remove();waves.delete(node);});waves.set(node,dispose);
  panel.addEventListener('toggle',()=>{if(!panel.open||loading||dead)return;loading=true;load('wave').then(WaveSurfer=>{if(dead||!connected(panel))return;instance=WaveSurfer.create({container:panel.querySelector('.portal-ux-waveform'),media,height:72,waveColor:'#a4bfb6',progressColor:'#315b50',cursorColor:'#173e35',normalize:false,interact:true});instance.on('error',()=>{panel.querySelector('.portal-ux-waveform').hidden=true;});}).catch(()=>{panel.querySelector('.portal-ux-waveform').hidden=true;});});
 }
 return{search,activityDays,progress,recording,cleanup};
});
