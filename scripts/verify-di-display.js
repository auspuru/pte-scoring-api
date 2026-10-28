'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
function verify(){
  const {manifest,forQuestion}=require('../di-image-display'),bank=require('../content/speaking-bank'),mocks=require('../content/speaking-mocks');
  const supplied=require('../content/di-user-predictions.json'),root=path.join(__dirname,'../public'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(Object.keys(manifest.entries).length,supplied.length,'Clear-image coverage differs from supplied images.');
  for(const original of supplied){
    const q=bank.questions.find(q=>q.id===original.id),e=manifest.entries[q.id];
    assert.equal(q.imageUrl,e.originalImageUrl);assert.equal(hash(fs.readFileSync(path.join(root,q.imageUrl))),e.originalSha256,'Original image changed: '+q.id);
    assert.equal(q.imageReference.source.sha256,e.originalSha256);assert.equal(q.imageReference.source.kind,'image-sha256');
    assert.match(e.displayImageUrl,/^\/assets\/di-display-20261028\/\d+-[a-f0-9]{12}\.(svg|webp|png|jpg)$/);
    const bytes=fs.readFileSync(path.join(root,e.displayImageUrl));assert.equal(hash(bytes),e.displaySha256,'Clear image changed: '+q.id);assert.equal(bytes.length,e.bytes);
    assert(e.displayImageUrl.includes('-'+e.displaySha256.slice(0,12)+'.'));assert.equal(forQuestion(q).displayImageUrl,e.displayImageUrl);
    assert.notEqual(e.originalImageUrl,e.displayImageUrl);assert(!e.displayImageUrl.includes('speaking-image/'));
    if(e.derivation==='source-resampling'){assert(e.displayDimensions.every((size,i)=>size>=e.originalDimensions[i]*2));assert(e.roundTripRmse<=.025);}
    if(e.derivation==='verified-vector'){assert.match(bytes.toString(),/<svg/);assert(!/<script|<foreignObject|\bonload=|\bhref=/i.test(bytes.toString()));}
  }
  const images=mocks.papers.flatMap(p=>p.questions.filter(q=>q.type==='di'));
  for(const q of images)assert(forQuestion(q).displayImageUrl,'Mock clear image missing: '+q.id);
  return{images:supplied.length,mockPlacements:images.length,version:manifest.version};
}
if(require.main===module)console.log(verify());
module.exports={verify};
