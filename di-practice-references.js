'use strict';
const {manifest}=require('./di-reference'),history=require('./content/di-reference-history.json');
// Availability applies to starting new scored practice, never to saved work.
function available(question){
  const entry=question?.type==='di'&&manifest.entries[question.id],hold=entry?.assessmentAvailability;
  return !(hold?.status==='needs-clearer-source'&&hold.sourceSha256===entry.source.sha256);
}
function forAttempt(attempt,current){
  if(attempt.questionSnapshot)return attempt.questionSnapshot;
  const entry=current?.type==='di'&&history.entries[current.id];
  if(!entry)return current;
  // Pre-update practice did not save DI snapshots. Retain its old reference,
  // including samples and descriptor, instead of silently adopting this review.
  const {mapping}=entry;
  return {...current,title:mapping.title,imageCategory:mapping.category,
    facts:structuredClone(mapping.facts),visual:structuredClone(mapping.visual),
    optionalFactIndices:[...mapping.optionalFactIndices],sample:entry.sample,
    imageReference:{version:history.version,questionId:current.id,
      source:structuredClone(entry.source),mappingHash:entry.mappingHash}};
}
module.exports={available,forAttempt};
