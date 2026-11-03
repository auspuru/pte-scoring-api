'use strict';
const fs=require('node:fs');
const {assemble,selections,manifest}=require('../full-mock/additional-papers');
const {validatePaper,digest,putImmutable,registeredPapers}=require('../full-mock/paper');
const {scoringSnapshot}=require('../full-mock/audit');
const root=require('node:path').resolve(__dirname,'..');
if(process.argv.includes('--freeze')) {
  fs.writeFileSync('docs/additional-full-mocks-manifest.json',JSON.stringify(manifest(),null,2)+'\n');
  const file='content/full-mock/papers/catalogue.json',index=JSON.parse(fs.readFileSync(file));
  index.activeVersions={...(index.activeVersions||{}),'full-mock-1':index.activeVersion};
  for(const selection of selections){
    const paper=assemble(selection),issues=validatePaper(paper,{root});if(issues.length)throw Error(issues.join('\n'));
    const file=`content/full-mock/papers/${paper.id}.v1.json`;putImmutable(root,file,JSON.stringify(paper,null,2)+'\n');
    const entry={id:paper.id,version:1,sha256:digest(paper),title:paper.title,status:paper.status,available:false,scoredQuestionCount:65,taskTypeCount:22,file};
    const old=index.papers.find(p=>p.id===paper.id&&p.version===1);if(old&&digest(old)!==digest(entry))throw Error('Registered paper drift');
    if(!old)index.papers.push(entry);index.activeVersions[paper.id]=1;
    const benchmark=structuredClone(require('../content/full-mock/benchmark-template.json'));benchmark.context.paperHash=digest(paper);
    putImmutable(root,`content/full-mock/${paper.id}-benchmark-template.json`,JSON.stringify(benchmark,null,2)+'\n');
  }
  fs.writeFileSync(file,JSON.stringify(index,null,2)+'\n');
  const lock=require('../content/full-mock/scoring-lock.json');lock.baseCommit='3a5f57485b4818f278b3ea6f915a697c2fa495ca';lock.scope='Two additional selectable Full Mocks and exact registry/selected-paper assessment wiring. Native graders, models, weights, timing and historical papers remain unchanged.';lock.snapshot=scoringSnapshot(root);
  fs.writeFileSync('content/full-mock/scoring-lock.json',JSON.stringify(lock,null,2)+'\n');
}
for(const p of registeredPapers())console.log({id:p.id,version:p.version,questions:p.questions.length,hash:digest(p)});
