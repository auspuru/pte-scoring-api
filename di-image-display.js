'use strict';
const manifest=require('./content/di-display-manifest.json');
// Display assets never replace the canonical image used for scoring or saved
// questions. A different question image must not inherit an old clear variant.
function forQuestion(q){
  const entry=q?.type==='di'&&Object.hasOwn(manifest.entries,q.id)&&manifest.entries[q.id];
  if(!entry||q.imageUrl!==entry.originalImageUrl)return {};
  if(q.imageReference&&(q.imageReference.source?.kind!=='image-sha256'||q.imageReference.source.sha256!==entry.originalSha256))return {};
  return {displayImageUrl:entry.displayImageUrl,imageLegend:structuredClone(entry.legend||[])};
}
module.exports={manifest,forQuestion};
