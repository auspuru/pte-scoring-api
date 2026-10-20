'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createHash}=require('node:crypto');
const workspace=require('../public/portal-workspace'),catalogue=require('../public/practice-catalogue');
const source=fs.readFileSync(path.join(__dirname,'../public/index.js'),'utf8');
function portalFunction(name){const pattern=name==='openWritingLab'?'async function '+name+'(':'function '+name+'(';const start=source.indexOf(pattern);assert(start>=0,name);const end=source.indexOf('\n}\n',start);return source.slice(start,end+2);}
function harness(){
 const requests=[],activated=[],mockPages=[];
 const practiceHost={innerHTML:''},nodes=new Map([['practiceHubPane',practiceHost],['mockTestsPane',{innerHTML:''}]]);
 const doc={getElementById:id=>nodes.get(id),querySelectorAll:()=>[]};
 const context={PortalWorkspace:workspace,window:{},document:doc,crypto:{randomUUID:()=>String(requests.length)},savePortalEssayDraft(){},portalWorkspace:{activate(section){activated.push(section);return section;}},ensureWritingLabRuntimeLoaded:async()=>({open:async request=>requests.push(request)}),toast(){throw Error('Unexpected navigation error');},escapeHtml:s=>s};
 vm.createContext(context);vm.runInContext(portalFunction('openWritingLab')+'\n'+portalFunction('switchSection'),context);
 const controller=catalogue.createController({document:doc,navigate:(...args)=>context.switchSection(...args),launchReading(){},launchWriting(){},fetch:async url=>({ok:true,json:async()=>url.includes('reading-bank')?require('../public/reading-bank.json'):{spoken:[{id:'sst'}],dictation:[{id:'wfd'}],listeningPractice:['lmcma','lfi','hcs','lmcsa','smw','hiw'].map(type=>({id:type,type})),mocks:[],listeningMocks:[]}})});
 context.portalCatalogue={openPractice:controller.openPractice,openMocks:options=>mockPages.push(options)};
 return {context,controller,practiceHost,requests,activated,mockPages};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Every actual Listening Practice catalogue button reaches its task through both portal navigation functions',async()=>{
 const h=harness();await h.controller.openPractice();
 const listening=catalogue.groups.find(g=>g.id==='listening').tasks;
 for(const task of listening){
  assert(h.practiceHost.innerHTML.includes('data-practice-route="'+task.route+'"'));
  h.practiceHost.onclick({target:{closest:()=>({dataset:{practiceRoute:task.route}})}});await flush();
  const request=h.requests.at(-1);assert.equal(request.tab,workspace.routes[task.route].labTab,task.route+' must retain its task tab');assert.notEqual(request.tab,'mocks');assert.equal(h.activated.at(-1),task.route);
 }
 assert.equal(h.requests.length,8);assert.equal(h.mockPages.length,0,'Individual practice must not open the mock catalogue');
});
test('Listening mock catalogue and runner remain distinct from individual task buttons',async()=>{
 const h=harness();h.context.switchSection('listening-mocks');await flush();assert.equal(h.mockPages.length,1);assert.equal(h.mockPages[0].module,'listening');assert.equal(h.requests.length,0);
 h.context.switchSection('listening-run');await flush();assert.equal(h.requests[0].tab,'mocks');assert.equal(h.requests[0].module,'listening');
 await h.context.openWritingLab('invalid-task');assert.equal(h.requests.at(-1).tab,'mocks');
});
test('Lazy loaded Writing Lab and Progress URLs fingerprint their current source, alongside the main portal bundle',()=>{
 for(const name of ['writing-lab-client.js','student-progress.js']){
  const match=source.match(new RegExp("loadDeferredScript\\('/"+name.replaceAll('.','\\.')+"\\?v=([^']+)'"));assert(match,name+' loader');
  const hash=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../public',name))).digest('hex').slice(0,12);assert.equal(match[1],'sha256-'+hash,name+' must not reuse an immutable cached older script');
 }
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'),hash=createHash('sha256').update(source).digest('hex').slice(0,12);assert(html.includes('index.min.js?v=source-sha256-'+hash));
});
