'use strict';
const {hash}=require('./scoring-jobs'),report=require('./speaking-mock-report'),completion=require('./speaking-mock-completion');
const continuous=require('./azure-continuous-delivery');
const delivery=require('./speaking-delivery');
const fail=(message,status=409)=>Object.assign(Error(message),{status});
function metadata(response){const r=structuredClone(response||{});if(r.recording)delete r.recording.data;return r;}
function originalAzureRaw(a,index){
 const recordingHash=a.responses[index]?.recording?.hash;
 const valid=response=>response?.recording?.hash===recordingHash&&response.azure?.status==='assessed'
  &&(!response.azure.recordingHash||response.azure.recordingHash===recordingHash)
  &&['pronunciation','fluency'].every(key=>Number.isFinite(response.azure[key]?.raw)&&response.azure[key].raw>=0&&response.azure[key].raw<=100);
 const operations=Object.values(a.deliveryReassessments||{}).sort((left,right)=>(left.at||0)-(right.at||0));
 for(const operation of operations)for(const item of operation.items||[])if(item.index===index&&valid(item.previous))return item.previous.azure;
 return valid(a.responses[index])?a.responses[index].azure:null;
}
const fingerprint=a=>hash({id:a.id,questions:a.questions,profile:a.assessmentProfile,responses:a.responses.map(metadata),exclusions:a.assessmentExclusions,review:a.instructorReview,submission:a.submission});
const profiles=a=>({speaking:{practiceIndex:report.summarize(a).azure.overallScore}});
function create({store,jobStore,transcribe,callModel,gradeContent=(q,text)=>require('./speaking-scoring').grade(q,text,callModel,{academyDescribeImage:true}),
 assess=continuous.assessRecording,providerConfiguration=()=>assess===continuous.assessRecording?continuous.configuration():{ready:true},rebandCurrent=assess===continuous.assessRecording,quietRecording=completion.quiet,now=Date.now}={}){
 const running=new Map();let recovering=false;
 function check(a){if(!a)throw fail('Speaking mock attempt not found.',404);const summary=report.summarize(a).azure;if(a.status!=='submitted'||a.submission?.state==='finalizing'||require('./mock-result-review').held(a)||a.lease?.expiresAt>now()||!summary.coverageValid||!summary.supported)throw fail('A submitted, settled Speaking mock attempt is required.');}
 async function read(owner,id){const a=await store.get(owner,id,{omitMockAudio:true});check(a);const rows=jobStore?await jobStore.list(owner,id):[];if(rows.some(row=>['pending','running','retry_wait'].includes(row.status)))throw fail('Assessment work is active. Refresh when it has settled.');return {a,rows};}
 function settled(q,r,index,rows){const value=metadata(r),row=rows.find(row=>row.data.index===index&&row.data.recordingHash===r?.recording?.hash&&row.data.questionHash===hash(q)),patch=row?.data.patch||{};
  if(!report.validContent(q,value.content)&&report.validContent(q,patch.content))value.content=structuredClone(patch.content);
  if(!value.transcript?.trim()&&patch.transcriptionStatus==='assessed'&&typeof patch.transcript==='string'){value.transcript=patch.transcript;value.transcriptionStatus='assessed';}
  if(patch.azure?.status==='assessed'){const before=report.deliveryTraits(value,'azure'),after=report.deliveryTraits({...value,azure:patch.azure},'azure');
   if(['pronunciation','fluency'].some(key=>before[key]===null&&after[key]!==null)){const next=structuredClone(patch.azure);for(const key of ['pronunciation','fluency'])if(before[key]!==null)next[key]=value.azure?.[key];value.azure=next;}
  }return value;
 }
 function activateEarlier(a,rows){if(completion.active(a)&&report.summarize(a).azure.status==='assessed')return null;const review=require('./mock-result-review'),ledger=a.instructorReview;
  if(ledger?.status==='published'&&!review.publicationValid(a,'speaking'))throw fail('The earlier instructor publication cannot be verified.');
  const before={responses:a.responses.map(metadata),assessment:structuredClone(a.assessment||null),grading:structuredClone(a.grading||null),profile:structuredClone(a.assessmentProfile||null),instructorReview:structuredClone(ledger||null),profiles:profiles(a),jobHashes:rows.map(row=>({id:row.id,hash:hash(row)})),activatedAt:now()};
  a.assessmentProfile={...a.assessmentProfile,completionPolicy:completion.policy(a.questions)};
  for(const [index,q]of a.questions.entries()){if(q.type==='intro'||!a.responses[index]?.recording||report.exclusionFor(a,q,index))continue;const r=a.responses[index];if(!completion.replacement(a,index)){const {recording,...marks}=settled(q,r,index,rows);Object.assign(r,marks);}r.assessmentOutcome=completion.receipt(q,r,report.validContent(q,r.content)?'available':r.transcriptionStatus==='assessed'&&!r.transcript?.trim()?'unintelligible-audio':'assessment-unavailable',now());}
  if(ledger?.status==='published'){const confirmed=review.confirmed(a,'speaking');if(Object.entries(ledger.confirmed).some(([key,value])=>confirmed[key]!==value))throw fail('A confirmed earlier mark changed.');ledger.confirmed=confirmed;if(!review.publicationValid(a,'speaking'))throw fail('The earlier instructor publication could not be preserved.');}
  a.assessment={...a.assessment,status:'ready',publishedAt:now(),omissions:completion.omissions(a,now())};a.grading={status:'complete'};
  if(report.summarize(a).azure.status!=='assessed')throw fail('The saved attempt has an input or assessment integrity issue.');return before;
 }
 function blocked(a,index,rows){return rows.some(row=>row.data.index===index&&row.data.recordingHash===a.responses[index]?.recording?.hash&&Object.values(row.data.stages||{}).some(s=>s.status==='calling'||s.failure==='uncertain_provider_outcome'))
  ||Object.values(a.deliveryReassessments||{}).some(op=>op.items?.some(item=>item.index===index&&(['running','confirmation-pending'].includes(item.status)||['queued','running','paused','review','partial'].includes(op.status)&&['queued','complete'].includes(item.status)&&op.evidenceHash===fingerprint(a)))||op.status==='published'&&op.items?.some(item=>item.index===index&&item.deliveryUncertain));}
 function eligible(a,rows){return a.questions.flatMap((q,index)=>{
  const r=a.responses[index],marks=report.questionResult(a,q,r,index,'azure');if(q.type==='intro'||!report.WEIGHTS[q.type]||!r?.recording?.hash||r.content?.total===0&&!marks.excluded)return [];
  const savedEvidence=completion.replacement(a,index)?metadata(r):settled(q,r,index,rows),valid=report.validContent(q,savedEvidence.content),previous={content:marks.excluded?null:marks.content,pronunciation:marks.excluded?null:marks.pronunciation,fluency:marks.excluded?null:marks.fluency};
  return [{id:q.id,number:a.questions.slice(0,index+1).filter(q=>q.type!=='intro').length,index,type:q.type,previous,needsContent:!valid,restore:!!marks.excluded||marks.total===null,savedRawAvailable:!!originalAzureRaw(a,index),savedEvidence,blocked:blocked(a,index,rows)}];
 });}
 function apply(a,op){
  const review=require('./mock-result-review'),ledger=a.instructorReview,published=ledger?.status==='published';
  if(published&&!review.publicationValid(a,'speaking'))throw fail('The earlier instructor publication cannot be verified. Original marks are retained.');
  const beforeLedger=published?structuredClone(ledger.confirmed):null;
  op.status='published';op.publishedAt=now();
  const complete=op.items.filter(item=>item.status==='complete');
  for(const item of complete){const r=a.responses[item.index],q=a.questions[item.index];if(hash(metadata(r))!==hash(item.previous))throw fail('Previous marks changed. Reload the saved attempt.');
   Object.assign(r,structuredClone(item.proposed));if(!item.result.contentOnly&&r.manualDeliveryOverrides)delete r.manualDeliveryOverrides.azure;
   r.assessmentOutcome=completion.receipt(q,r,'available',now());item.appliedHash=completion.evidence(q,r);r.deliveryReplacement={operation:op.operation,evidenceHash:item.appliedHash};
  }
  if(published){const next=review.confirmed(a,'speaking'),scope=new Set(complete.flatMap(item=>['content','pronunciation','fluency'].map(key=>item.index+':'+key)));
   for(const key of scope){delete ledger.confirmed[key];if(next[key])ledger.confirmed[key]=next[key];}
   if(!review.publicationValid(a,'speaking'))throw fail('The earlier instructor publication could not be preserved.');
   op.instructorReviewAmendment={beforeConfirmed:beforeLedger,afterConfirmed:structuredClone(ledger.confirmed)};
  }
  const after=report.summarize(a).azure,invalid=complete.filter(item=>{const row=after.questions.find(row=>row.index===item.index);return !row||row.excluded||row.total===null;});
  if(invalid.length)throw fail('Confirmed recordings would remain excluded or unassessed: '+invalid.map(item=>'Q'+item.number).join(', ')+'. Original marks are retained.');
  if(after.status!=='assessed')throw fail('The replacement report could not be verified. Original marks are retained.');
  for(const item of complete){const row=after.questions.find(row=>row.index===item.index);item.publishedScores={content:row.content,pronunciation:row.pronunciation,fluency:row.fluency};}
  a.grading={status:'complete'};a.assessment={...a.assessment,status:'ready'};return after;
 }
 function view(owner,a,rows){const provider=providerConfiguration();return {owner,attemptId:a.id,paperId:a.paperId,paperVersion:a.version||'saved',engine:'speaking',evidenceHash:fingerprint(a),profiles:profiles(a),provider,questions:eligible(a,rows).map(({savedEvidence,...q})=>({...q,blocked:q.blocked||provider.ready===false&&!q.savedRawAvailable&&!q.needsContent&&!q.restore})),operations:Object.fromEntries(Object.entries(a.deliveryReassessments||{}).map(([id,operation])=>{
  const op=structuredClone(operation);op.completedCount=op.items.filter(item=>item.status==='complete').length;op.failedCount=op.items.filter(item=>['failed','confirmation-pending'].includes(item.status)).length;
  if(['review','partial'].includes(op.status)&&op.evidenceHash===fingerprint(a)&&op.completedCount){try{const copy=structuredClone(a),proposal=copy.deliveryReassessments[id];apply(copy,proposal);op.proposedProfiles=profiles(copy);op.proposalReady=true;}catch(error){op.proposalReady=false;op.proposalError=error.status?error.message:'The proposed report could not be verified.';}}
  return [id,op];
 }))};}
 async function inspect(owner,id){const {a,rows}=await read(owner,id);for(const [key,op] of Object.entries(a.deliveryReassessments||{}))if(['queued','running','paused'].includes(op.status)||op.autoPublish&&!op.autoPublishError&&['review','partial'].includes(op.status)&&op.items.some(item=>item.status==='complete'))schedule(owner,id,key);return view(owner,a,rows);}
 function schedule(owner,id,operation){const key=owner+':'+id+':'+operation;if(running.has(key))return;const task=work(owner,id,operation).catch(async()=>{await store.update(owner,id,a=>{const op=a?.deliveryReassessments?.[operation];if(op&&['queued','running'].includes(op.status)){op.status='paused';op.message='Processing paused. Completed receipts are saved. Refresh status to resume unsent recordings.';}return a;}).catch(()=>{});}).finally(()=>running.delete(key));running.set(key,task);}
 async function work(owner,id,operation){while(true){let claimed;await store.update(owner,id,a=>{check(a);const op=a.deliveryReassessments?.[operation];claimed=null;if(!op||!['queued','running','paused'].includes(op.status))return a;
   if(op.evidenceHash!==fingerprint(a)){op.status='stale';op.message='Saved inputs or scores changed. No replacement was published.';return a;}
   for(const item of op.items)if(item.status==='running'&&item.leaseUntil<=now()){item.status='confirmation-pending';item.message='The earlier request has no confirmed receipt. It will not be sent again automatically.';}
   if(op.items.some(item=>item.status==='running'))return a;const item=op.items.find(item=>item.status==='queued');
   if(!item){op.status=op.items.every(item=>item.status==='complete')?'review':'partial';return a;}
   item.status='running';item.startedAt=now();item.leaseUntil=now()+600000;op.status='running';claimed=structuredClone(item);return a;
  });
  if(!claimed){const a=await store.get(owner,id,{omitMockAudio:true}),op=a?.deliveryReassessments?.[operation];if(op?.autoPublish&&!op.autoPublishError&&['review','partial'].includes(op.status)&&op.items.some(item=>item.status==='complete'))try{await publish(owner,id,{operation,confirmPublish:true,confirmPartial:true});}catch(error){await store.update(owner,id,a=>{const op=a.deliveryReassessments[operation];if(['review','partial'].includes(op.status)){op.autoPublishError=true;op.message=error.status?error.message:'The updated report could not be verified. Original marks are retained.';}return a;});}return;}
  let proposed,result,error,sent=false,deliveryUncertain=false;
  const saveStage=async(name,stage)=>store.update(owner,id,a=>{const op=a.deliveryReassessments[operation],item=op.items.find(item=>item.index===claimed.index);if(op.evidenceHash!==fingerprint(a)||item.status!=='running'||item.startedAt!==claimed.startedAt)throw fail('Saved evidence changed during reassessment.');item.stages||={};item.stages[name]=stage;return a;});
  async function paid(name,call,valid){await saveStage(name,{status:'calling',at:now()});try{const value=await call();if(!valid(value))throw fail('The assessment did not return a confirmed result.',503);await saveStage(name,{status:'ready',at:now()});return value;}catch(error){await saveStage(name,{status:'failed',uncertain:error.uncertain===true,at:now()});throw error;}}
  try{const saved=await store.getResponse(owner,id,claimed.index),q=saved?.question,r=saved?.response,recording=r?.recording;
   if(!recording||hash(metadata(r))!==hash(claimed.previous)||hash(q)!==claimed.questionHash||!['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg'].includes(recording.mime))throw fail('The saved recording changed or is unavailable.');
   const bytes=Buffer.from(recording.data||'','base64');if(!bytes.length||bytes.length>12*1024*1024||hash(bytes)!==recording.hash)throw fail('The saved recording could not be verified.');
   proposed={};const evidence=claimed.savedEvidence||{};if(!r.transcript?.trim()&&evidence.transcriptionStatus==='assessed'){proposed.transcript=evidence.transcript;proposed.transcriptionStatus='assessed';}if(!report.validContent(q,r.content)&&report.validContent(q,evidence.content))proposed.content=evidence.content;if(!r.azure&&evidence.azure)proposed.azure=evidence.azure;
   let text=proposed.transcript||r.transcript||'';let content=proposed.content||r.content;
   if(!report.validContent(q,content)){
    if(!text.trim()){if(await quietRecording(recording))throw fail('The recording is too quiet to assess.');text=await paid('transcription',()=>transcribe(recording),v=>typeof v==='string'&&!!v.trim());proposed.transcript=text;proposed.transcriptionStatus='assessed';}
    content=await paid('content',()=>gradeContent(q,text),v=>report.validContent(q,v));proposed.content=content;
   }
   if(content.total===0){result={version:'native-content-gate',pronunciation:{score:0},fluency:{score:0}};}
   else try{const a=await store.get(owner,id,{omitMockAudio:true}),savedRaw=originalAzureRaw(a,claimed.index);
    if(savedRaw){result=delivery.reband({version:'azure-saved-question-raw-2026-11-06.1',pronunciation:{raw:savedRaw.pronunciation.raw},fluency:{raw:savedRaw.fluency.raw}},
      {questionType:q.type,bandPolicy:delivery.VERSION});await saveStage('azure',{status:'ready',source:'saved-original-raw',at:now()});}
    else{const config=providerConfiguration();if(!config.ready)throw Object.assign(Error('Azure delivery is unavailable.'),{providerStarted:false});await saveStage('azure',{status:'calling',at:now()});sent=true;
      result=await assess(recording);
      if(rebandCurrent)result=delivery.reband(result,{questionType:q.type,bandPolicy:delivery.VERSION});}
    if(!result?.version||!['pronunciation','fluency'].every(key=>Number.isFinite(result[key]?.score)&&result[key].score>=0&&result[key].score<=5))throw Error('Azure delivery was not confirmed.');
    proposed.azure={status:'assessed',recordingHash:recording.hash,assessedAt:now(),deliveryVersion:result.version,deliveryProvider:'azure',pronunciation:result.pronunciation,fluency:result.fluency};await saveStage('azure',{status:'ready',at:now()});
   }catch(caught){deliveryUncertain=sent&&caught.providerStarted!==false;if(!claimed.needsContent&&!claimed.restore)throw caught;
    const traits=report.deliveryTraits(r,'azure');result={version:'available-content',contentOnly:true,pronunciation:{score:traits.pronunciation},fluency:{score:traits.fluency}};await saveStage('azure',{status:'failed',uncertain:deliveryUncertain,at:now()});
   }
  }catch(caught){error=caught;}
  await store.update(owner,id,a=>{const op=a.deliveryReassessments[operation],item=op.items.find(item=>item.index===claimed.index);if(item.status!=='running'||item.startedAt!==claimed.startedAt)return a;
   if(error){item.status=sent&&error.providerStarted!==false||error.uncertain?'confirmation-pending':'failed';item.message='This recording did not receive a confirmed reassessment. Its previous result is retained.';}
   else{item.status='complete';item.result=result;item.proposed=proposed;item.deliveryUncertain=deliveryUncertain;}
   item.completedAt=now();if(!op.items.some(item=>['queued','running'].includes(item.status)))op.status=op.items.every(item=>item.status==='complete')?'review':'partial';return a;});
 }}
 async function send(owner,id,body){const {operation,evidenceHash}=body;if(!/^[a-zA-Z0-9:-]{8,100}$/.test(operation||''))throw fail('A stable reassessment operation is required.',400);const {a,rows}=await read(owner,id);
  const prior=a.deliveryReassessments?.[operation];if(prior){if(!!prior.all!==(body.all===true)||!body.all&&hash(prior.questionIds)!==hash(body.questionIds)||!!prior.autoPublish!==(body.autoPublish===true))throw fail('This operation belongs to another selection.');return inspect(owner,id);}
  const available=eligible(a,rows),ids=body.all?available.filter(q=>!q.blocked).map(q=>q.id):body.questionIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>27||new Set(ids).size!==ids.length||ids.some(id=>!available.some(q=>q.id===id&&!q.blocked)))throw fail('Select available saved recordings.',400);
  const config=providerConfiguration();if(!config.ready&&!ids.every(id=>{const q=available.find(q=>q.id===id);return q.savedRawAvailable||q.needsContent||q.restore;}))throw fail(config.message||'Azure Speech is unavailable.');
  await store.update(owner,id,current=>{check(current);current.deliveryReassessments||={};const previous=current.deliveryReassessments[operation];if(previous){if(hash(previous.questionIds)!==hash(ids)||!!previous.autoPublish!==(body.autoPublish===true))throw fail('This operation belongs to another selection.');return current;}if(fingerprint(current)!==evidenceHash)throw fail('Saved evidence changed. Inspect this attempt again.');
   if(Object.values(current.deliveryReassessments).some(op=>['queued','running','paused','review','partial'].includes(op.status)))throw fail('Finish or discard the current reassessment first.');
   const needsEarlierPublication=report.summarize(current).azure.status!=='assessed'||!completion.active(current)&&ids.some(id=>{const q=available.find(q=>q.id===id);return q.needsContent||q.restore;});
   if(needsEarlierPublication&&body.autoPublish!==true)throw fail('Use the current admin recording controls to reassess and publish this earlier attempt.');
   const earlierPublication=needsEarlierPublication?activateEarlier(current,rows):null;
   current.deliveryReassessments[operation]={operation,owner,batch:true,all:body.all===true,autoPublish:body.autoPublish===true,status:'queued',at:now(),questionIds:[...ids],evidenceHash:fingerprint(current),...(earlierPublication?{earlierPublication}:{}),items:ids.map(id=>{const q=available.find(q=>q.id===id);return {questionId:id,index:q.index,number:q.number,type:q.type,needsContent:q.needsContent,restore:q.restore,savedEvidence:q.savedEvidence,questionHash:hash(current.questions[q.index]),previous:metadata(current.responses[q.index]),previousScores:q.previous,status:'queued'};})};return current;});schedule(owner,id,operation);return inspect(owner,id);
 }
 async function publish(owner,id,{operation,confirmPublish,confirmPartial}){if(confirmPublish!==true)throw fail('Confirm replacement of published scores.',400);await read(owner,id);await store.update(owner,id,a=>{check(a);const op=a.deliveryReassessments?.[operation];if(op?.status==='published')return a;if(!op||!['review','partial'].includes(op.status)||op.evidenceHash!==fingerprint(a))throw fail('The reassessment is not ready or saved evidence changed.');if(!op.items.some(item=>item.status==='complete')||op.status==='partial'&&confirmPartial!==true)throw fail('Confirm publication of the completed recordings.');op.beforeProfiles=op.earlierPublication?.profiles||profiles(a);apply(a,op);op.afterProfiles=profiles(a);return a;});return inspect(owner,id);}
 async function discard(owner,id,{operation}){await read(owner,id);await store.update(owner,id,a=>{const op=a.deliveryReassessments?.[operation];if(!op||!['review','partial','stale','discarded'].includes(op.status))throw fail('Only an unpublished proposal can be discarded.');op.status='discarded';return a;});return inspect(owner,id);}
 async function recover(){if(recovering)return;recovering=true;try{for(const row of await store.deliveryQueue())schedule(row.owner,row.id,row.operation);}finally{recovering=false;}}
 return {inspect,send,publish,discard,recover,drain:async()=>{while(running.size)await Promise.allSettled([...running.values()]);}};
}
module.exports={create,fingerprint,metadata};
