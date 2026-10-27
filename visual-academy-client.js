'use strict';
const {hash}=require('./scoring-jobs'),academy=require('./describe-image-academy'),rubric=require('./delivery-rubric');
const VERSION='academy-di-service-v1';
function createAcademyClient({origin=process.env.VISUAL_ACADEMY_SCORING_URL,secret=process.env.PTE_DI_SERVICE_KEY,request=fetch,toWav=require('./gpt-speaking-delivery').toWav}={}){
  const url=origin?new URL(origin):null;if(url&&(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'))throw Error('Invalid Academy service origin.');
  async function call(path,body){if(!url||!secret)throw Object.assign(Error('Academy service is not configured.'),{status:401});let response;
    try{response=await request(new URL(path,url),{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(Error('Academy connection interrupted.'),{status:503});}
    if(!response.ok)throw Object.assign(Error('Academy request failed.'),{status:response.status});return response.json();
  }
  return{available:!!url&&!!secret,async submit({id,question,recording,transcript,requested,onPrepared=async()=>{},expected}){
    const reference=require('./di-reference').referenceFor(question);
    const {wav}=await toWav(recording),normalizedHash=hash(wav);
    const body={id,version:VERSION,deliveryRubricVersion:rubric.RUBRIC_VERSION,recordingHash:recording.hash,normalizedHash,mapping:require('./describe-image-feedback').mapping(question),...(reference?{reference}:{}),transcript,requested,wav:wav.toString('base64')};
    const {wav:_,...metadata}=body;const inputHash=hash(metadata),prepared={id,inputHash,normalizedHash};
    if(expected&&JSON.stringify(expected)!==JSON.stringify(prepared))throw Object.assign(Error('Saved Academy audio preparation changed.'),{status:409});
    await onPrepared(prepared);const receipt=await call('/internal/v1/di/jobs',body);
    if(receipt.id!==id||receipt.version!==VERSION||receipt.inputHash!==inputHash)throw Error('Academy receipt mismatch.');return{id,inputHash,normalizedHash};
  },retry:(receipt,repair)=>call('/internal/v1/di/jobs/'+receipt.id+'/retry',repair),async poll(receipt,recordingHash){const result=await call('/internal/v1/di/jobs/'+receipt.id);
    if(result.id!==receipt.id||result.version!==VERSION||result.inputHash!==receipt.inputHash||result.normalizedHash!==receipt.normalizedHash||result.recordingHash!==recordingHash)throw Error('Academy result mismatch.');return result;
  }};
}
function contentResult(value,feedback){if(value?.status!=='scored'||value.max!==6||!Number.isInteger(value.score)||value.score<0||value.score>6)return null;
  return{version:academy.VERSION,contentPolicyVersion:academy.VERSION,academyPolicyVersion:value.policyVersion,source:'Describe Image Academy',serviceVersion:VERSION,maximum:6,total:value.score,contentStatus:'assessed',scoringMode:'ai',score_provisional:false,needs_semantic_review:false,
    academyAssessment:value,...(value.imageReference?{imageReference:structuredClone(value.imageReference)}:{}),overview:value.reason,strengths:feedback?.strength?[feedback.strength.why]:[],improvements:[value.nextStep],contentGate:value.score===0,academyFeedback:feedback||null,providerModel:value.model};
}
function deliveryResult(value,recordingHash,now=Date.now){if(!value)return null;const out={status:'assessed',recordingHash,assessedAt:now(),deliveryProvider:'visual-academy-openai',deliveryModel:value.model,deliveryRubricVersion:rubric.RUBRIC_VERSION,deliveryEvidence:{sufficient:true,durationSeconds:value.durationSeconds},serviceVersion:VERSION};
  for(const name of ['pronunciation','fluency']){const t=value[name];out[name]=t?.rubricVersion===rubric.RUBRIC_VERSION?{...t,maximum:5,coaching:t.nextStep}:null;}return out;
}
module.exports={VERSION,createAcademyClient,contentResult,deliveryResult};
