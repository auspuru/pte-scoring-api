'use strict';
const fs=require('node:fs'),path=require('node:path'),{hash}=require('./scoring-jobs');
const manifest=require('./content/di-reference-manifest.json');
function descriptor(questionId,entry){return{version:manifest.version,questionId,source:structuredClone(entry.source),mappingHash:entry.mappingHash};}
function apply(question){
  if(question.type!=='di')return question;
  const entry=Object.hasOwn(manifest.entries,question.id)&&manifest.entries[question.id];if(!entry)throw Error('Missing verified DI metadata: '+question.id);
  const {source,mapping}=entry;
  if(hash(mapping)!==entry.mappingHash)throw Error('DI metadata checksum changed: '+question.id);
  if(source.kind==='image-sha256'){
    if(question.imageUrl!==entry.portalImageUrl||hash(fs.readFileSync(path.join(__dirname,'public',question.imageUrl)))!==source.sha256)throw Error('DI original image changed: '+question.id);
  }else if(source.kind!=='visual-sha256'||hash(question.visual)!==source.sha256)throw Error('DI structured image changed: '+question.id);
  return{...question,title:mapping.title,imageCategory:mapping.category,facts:structuredClone(mapping.facts),visual:structuredClone(mapping.visual),
    optionalFactIndices:[...mapping.optionalFactIndices],sample:entry.sample,imageReference:descriptor(question.id,entry)};
}
function referenceFor(question){
  if(!question.imageReference)return null; // Retain the exact body of legacy saved/prepared jobs.
  const ref=question.imageReference,entry=Object.hasOwn(manifest.entries,question.id)&&manifest.entries[question.id];
  if(!entry||ref.questionId!==question.id||typeof ref.version!=='string'||ref.version.length>100||!ref.version
    ||ref.source?.kind!==entry.source.kind||ref.source?.sha256!==entry.source.sha256||ref.mappingHash!==hash(require('./describe-image-feedback').mapping(question)))throw Error('DI reference does not match its question.');
  return structuredClone(ref);
}
// A new reattempt can refresh references for a known unchanged image without
// editing the previous attempt. Unknown historical questions retain snapshots.
const forNewAttempt=question=>question.type==='di'&&Object.hasOwn(manifest.entries,question.id)?apply(question):structuredClone(question);
module.exports={manifest,apply,referenceFor,forNewAttempt};
