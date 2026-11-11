'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{hash}=require('../scoring-jobs');
function verify(academyManifest){
  const {manifest,referenceFor}=require('../di-reference'),questions=[...require('../content/speaking-bank').questions.filter(q=>q.type==='di'),...[...require('../content/speaking-mocks-web-images.json'),...require('../content/speaking-mock-4-user-images-20261111.json'),...require('../content/speaking-mock-5-web-images-20261111.json')].map(q=>require('../di-reference').apply(q))];
  assert.equal(questions.length,Object.keys(manifest.entries).length,'DI question/reference count differs.');
  for(const q of questions){
    const entry=manifest.entries[q.id];assert(entry,'Missing DI reference '+q.id);
    assert.equal(hash(require('../describe-image-feedback').mapping(q)),entry.mappingHash,'Scorer reference drift '+q.id);
    assert.deepEqual(referenceFor(q).source,entry.source);assert.equal(q.sample,entry.sample,'Sample reference drift '+q.id);
    assert(q.sample.split(/\s+/).length<=100);assert(q.optionalFactIndices.every(i=>Number.isInteger(i)&&i>=0&&i<q.facts.length));
  }
  if(academyManifest)assert.deepEqual(manifest,JSON.parse(fs.readFileSync(academyManifest,'utf8')),'Portal/Academy DI metadata is out of sync.');
  return{questions:questions.length,version:manifest.version};
}
if(require.main===module)console.log('DI metadata verified:',verify(process.argv[2]));
module.exports={verify};
