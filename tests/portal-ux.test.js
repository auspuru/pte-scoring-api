'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function context(){const ctx={Date};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'public/vendor/fuse.js/7.5.0/fuse.min.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(root,'public/portal-ux.js'),'utf8'),ctx);return ctx;}
test('Question search tolerates typos, preserves exact IDs and original objects, and returns nothing for unrelated words',()=>{
 const ctx=context(),items=[{id:'rl-1',title:'Neurons and intensity'},{id:'rl-10',title:'Language development'},{id:'rl-100',title:'Climate'}];
 assert.equal(ctx.PortalUx.search(items,'neuronn',['id','title'])[0],items[0]);
 assert.deepEqual(Array.from(ctx.PortalUx.search(items,'rl-10',['id','title'])),[items[1],items[2]]);
 assert.deepEqual(Array.from(ctx.PortalUx.search(items,'zxqvknb',['id','title'])),[]);
 assert.equal(ctx.PortalUx.search(items,'',['id']),items);
});
test('Activity uses Brisbane calendar days, excludes drafts and future dates, and does not convert scores',()=>{
 const ctx=context(),now=Date.parse('2026-11-04T15:00:00Z');
 const days=ctx.PortalUx.activityDays([{at:'2026-11-04T14:05:00Z',status:'Feedback ready'},{at:'2026-11-04T13:59:00Z',status:'Assessment pending'},{at:now,status:'Saved draft'},{at:'2026-11-06T14:00:00Z',status:'Feedback ready'},{at:'invalid'}],now);
 assert.equal(days.at(-1).day,'2026-11-05');assert.equal(days.at(-1).count,1);assert.equal(days.at(-2).count,1);assert.equal(days.reduce((n,d)=>n+d.count,0),2);
});
test('Fuzzy catalogue matching preserves Listening mode/bookmarks and mock module/status filters',()=>{
 const ctx=context();vm.runInContext(fs.readFileSync(path.join(root,'public/listening-studio.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(root,'public/practice-catalogue.js'),'utf8'),ctx);
 const items=[{id:'sst-a',title:'Neuron intensity'},{id:'sst-b',title:'Language'}],history=[{testId:'sst-a',mode:'exam',status:'submitted'}];
 const visible=ctx.ListeningStudio.visibleQuestions({items,history,search:'neuronn',filter:'new',mode:'practice'});assert.equal(visible.length,1);assert.equal(visible[0].q,items[0]);assert.equal(visible[0].index,0);
 assert.equal(ctx.ListeningStudio.visibleQuestions({items,search:'neuronn',filter:'bookmarked',bookmarks:['sst-b']}).length,0);
 const mocks=[{id:'a',title:'Speaking Sectional Mock',mode:'sectional',module:'speaking',number:1},{id:'b',title:'Writing Sectional Mock',mode:'sectional',module:'writing',number:2}];
 assert.equal(ctx.PracticeCatalogue.filterMocks(mocks,{module:'speaking',search:'sectonal',attempt:'unattempted'},{a:{status:'Done'}}).length,0);
 assert.equal(ctx.PracticeCatalogue.filterMocks(mocks,{module:'speaking',search:'sectonal',attempt:'attempted'},{a:{status:'Done'}})[0],mocks[0]);
});
test('Pinned browser assets and licence notices match the installed packages and are served locally',()=>{
 const manifest=require('../public/vendor/manifest.json');assert.equal(new Set(manifest.map(a=>a.package)).size,5);
 for(const row of manifest){const file=fs.readFileSync(path.join(root,'public',row.path));assert.equal(file.length,row.bytes);assert.equal(crypto.createHash('sha256').update(file).digest('hex'),row.sha256);assert.equal(require(path.join(root,'node_modules',row.package,'package.json')).version,row.version);}
 for(const name of ['fuse.js','wavesurfer.js','chart.js','tabulator-tables'])assert(manifest.some(a=>a.package===name&&/LICENSE/.test(a.path)));
});
test('Practice controllers retain the reviewed standalone navigation and exact native capture, saving, mock and report implementation',()=>{
 const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 const speaking=fs.readFileSync(path.join(root,'public/speaking-practice.js'),'utf8').split('\n').filter(line=>!line.includes('if(globalThis.PortalUx)return globalThis.PortalUx.search(')&&!line.includes('env.PortalUx?.recording(node);')).join('\n');
 const reading=fs.readFileSync(path.join(root,'public/reading-practice.js'),'utf8').split('\n').filter(line=>!line.includes('if(globalThis.PortalUx)return globalThis.PortalUx.search(')).join('\n');
 assert.equal(sha(speaking),'4f4d97d6355d2fbbd579b71ad65b69a66f0529debb81e9452ef00c797f0e466a');
 assert.equal(sha(reading),'33da5a971faaf84561f23afe000b9891e3d8e9041575be0eb29eb0956f521832');
});
