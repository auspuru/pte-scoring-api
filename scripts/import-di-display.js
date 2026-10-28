'use strict';
// Copy existing verified display assets; never generate or redraw an image.
// Usage: node scripts/import-di-display.js /path/to/Describe <source-commit>
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function importDisplay(sourceRoot,sourceCommit){
  if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw Error('Supply the reviewed Academy commit.');
  const root=path.resolve(__dirname,'..'),source=path.resolve(sourceRoot),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  const bank=require(path.join(source,'dist/data.json')),display=require(path.join(source,'dist/image-display.js'));
  const audit=require(path.join(source,'content/image-reference-audit.json')),upscales=require(path.join(source,'content/image-upscale-manifest.json'));
  const references=require('../content/di-reference-manifest.json'),supplied=require('../content/di-user-predictions.json'),entries={};
  for(const q of supplied){
    const academy=bank.find(x=>x.id===q.predictionSource.sourceId),entry=references.entries[q.id];
    const original=fs.readFileSync(path.join(root,'public',q.imageUrl));
    if(!academy||hash(original)!==academy.sha256||entry.source.sha256!==academy.sha256)throw Error('Original differs: '+q.id);
    const asset=display.source(academy),bytes=fs.readFileSync(path.join(source,'dist',asset));
    const review=audit.records.find(r=>r.questionId===academy.id),upscale=upscales.assets.find(r=>r.questionId===academy.id);
    if(asset===academy.images[0])throw Error('Missing reviewed display asset: '+q.id);
    const derivation=asset.endsWith('.svg')?'verified-vector':review?.displaySource||academy.id==='3000137'?'same-image-higher-resolution':'source-resampling';
    const imageUrl='/assets/di-display-20261028/'+academy.id+'-'+hash(bytes).slice(0,12)+path.extname(asset);
    fs.mkdirSync(path.join(root,'public/assets/di-display-20261028'),{recursive:true});
    fs.copyFileSync(path.join(source,'dist',asset),path.join(root,'public',imageUrl));
    entries[q.id]={originalImageUrl:q.imageUrl,originalSha256:academy.sha256,displayImageUrl:imageUrl,displaySha256:hash(bytes),bytes:bytes.length,
      derivation,academyAsset:asset,legend:display.legend(academy),
      ...(review?.displaySource?{source:review.displaySource}:{}),
      ...(upscale&&derivation==='source-resampling'?{originalDimensions:upscale.inputDimensions,displayDimensions:upscale.displayDimensions,roundTripRmse:upscale.roundTripRmse}:{}),
      ...(review?.limitations?.length?{limitations:review.limitations}:{})};
  }
  const manifest={version:'di-display-2026-10-28.1',sourceRepository:'auspuru/Describe',sourceCommit,
    purpose:'Verified display-only versions of the same supplied images. Canonical scoring images and references are unchanged.',
    limitation:'Resampling improves display size and edges but cannot recover unreadable source text. No image model or guessed values are used.',entries};
  fs.writeFileSync(path.join(root,'content/di-display-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return{images:Object.keys(entries).length,bytes:Object.values(entries).reduce((sum,e)=>sum+e.bytes,0)};
}
if(require.main===module)console.log(importDisplay(process.argv[2],process.argv[3]));
module.exports={importDisplay};
