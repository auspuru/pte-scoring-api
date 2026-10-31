'use strict';
const fs=require('node:fs'),path=require('node:path'),{hash}=require('./scoring-jobs');
const VERSION='india-land-use-reference-2026-10-31.1';
const QUESTION_HASH='f347e012d74ad3248dd1e891345750a9eb9c4d4ac21c7fbe1edcd2750d013547';
const IMAGE_SHA256='ede267351b791246f361a2c34c4ba1fddf4aca54aa0d02a0192ce6e626cd8578';
const IMAGE_URL='/assets/di-predictions-20260930/3000137.png';
// Checked against these exact original image bytes and its retained readable
// display. These are source facts, not required details or a sample response.
const SUPPLEMENT=[
  'The legend uses yellow for arable land, dark green for forests, brown for non-agricultural land, bright green for plantations, pink for scrub and grass, and orange for unproductive land.',
  'Yellow arable land is widespread across the northern plains and is interspersed with other land uses through central and southern India.',
  'Dark-green forests form prominent areas in the northeast, a belt across central India, and stretches along the western side of the peninsula.',
  'Orange unproductive land occupies a large area in the far north and another broad area in the northwest.',
  'Pink scrub and grass appears in scattered patches, particularly in western and southern parts of the map.',
  'The map uses a categorical land-use legend; it does not display numerical percentages, land-area values or a numerical scale.'
];
function prepare(question){
  // A changed or unrelated historical snapshot must never adopt this repair.
  if(question?.id!=='di-pred-3000137'||question.type!=='di'||hash(question)!==QUESTION_HASH)return {question};
  if(question.imageUrl!==IMAGE_URL||hash(fs.readFileSync(path.join(__dirname,'public',IMAGE_URL)))!==IMAGE_SHA256)
    throw Object.assign(Error('The retained reference image could not be verified.'),{status:422,code:'reference_image_mismatch'});
  const facts=[...question.facts,...SUPPLEMENT],reviewQuestion={...question,facts,visual:{...question.visual,description:facts.join(' ')}};
  const mappingHash=hash(require('./describe-image-feedback').mapping(reviewQuestion));
  reviewQuestion.imageReference={...question.imageReference,version:VERSION,mappingHash};
  return {question:reviewQuestion,reference:{version:VERSION,originalQuestionHash:QUESTION_HASH,imageSha256:IMAGE_SHA256,
    mappingHash,facts}};
}
module.exports={VERSION,QUESTION_HASH,IMAGE_SHA256,prepare};
