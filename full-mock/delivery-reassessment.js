'use strict';
const { digest } = require('./paper');
const { fail } = require('./store');
const { aggregate } = require('./aggregation');
const { recordingBytes } = require('./report');
const TYPES = new Set(['ra','rs','di','rl','sgd','rts']);
const fingerprint = state => digest({paper:state.paperHash,snapshot:state.assessment?.snapshotHash,responses:state.responses,items:state.assessment?.items,exclusions:state.assessment?.exclusions,publication:state.instructorReview});
const continuous=require('../azure-continuous-delivery');
const delivery=require('../speaking-delivery');
const savedPolicy=state=>state.assessment?.snapshot?.configuration?.delivery?.version||delivery.PREVIOUS_VERSION;
function create({store,validate,now=Date.now,assess=continuous.assessRecording,assessContent,assemble=require('./recording').assemble,providerConfiguration=()=>assess===continuous.assessRecording?continuous.configuration():{ready:true}}) {
  const jobs=new Map();
  async function read(owner,id) {
    const record=await store.get(owner,id);if(!record)throw fail('Attempt not found.',404);
    check(record.state,record.paper);return record;
  }
  function check(state,paper) {
    validate(state);
    if(state.status!=='submitted'||digest(paper)!==state.paperHash||require('../mock-result-review').held(state)||state.assessment.status==='processing'||state.assessment.lease?.expiresAt>now())throw fail('A submitted, settled Full Mock attempt is required.',409);
    aggregate(paper,state);
  }
  function activateEarlier(state,paper){
    const marks=require('./aggregation');if(marks.availableMarks(state)&&aggregate(paper,state).ready)return null;
    const review=require('../mock-result-review'),ledger=state.instructorReview;
    if(ledger?.status==='published'&&!review.publicationValid(state,'full'))throw fail('The earlier instructor publication cannot be verified. Original marks are retained.');
    const before={assessment:structuredClone(state.assessment),instructorReview:structuredClone(ledger||null),profiles:aggregate(paper,state).profiles};
    state.assessment.completionPolicy={version:marks.COMPLETION_POLICY,snapshotHash:state.assessment.snapshotHash};
    for(const [index,q]of paper.questions.entries())if(!state.assessment.items[q.id]){const response=state.responses[index+1];if(!response?.sealed)throw fail('A saved response is not sealed.');state.assessment.items[q.id]={status:'pending',inputHash:marks.inputHash(response),snapshotHash:state.assessment.snapshotHash,reason:'assessment-unavailable',stages:{}};}
    require('./exclusions').releaseAvailable(state,paper,now());
    if(ledger?.status==='published')ledger.publication.exclusionsHash=require('../scoring-jobs').hash(state.assessment.exclusions||{});
    if(!aggregate(paper,state).ready)throw fail('The saved attempt has an input or assessment integrity issue. Original marks are retained.');
    state.assessment.status='complete';state.assessment.recovery={...state.assessment.recovery,status:'complete'};delete state.assessment.recovery.nextAt;
    return {...before,activatedAt:now(),policy:structuredClone(state.assessment.completionPolicy)};
  }
  function eligible(paper,state) {
    const report=aggregate(paper,state);
    return paper.questions.flatMap((candidate,index)=>{
      const response=state.responses[index+1],job=state.assessment.items[candidate.id];
      const segments=response?.segments.filter(s=>!s.cancelled&&s.chunkCount!==0)||[];
      const content=job?.stages?.content?.value, limits=require('./adapters').maxima(candidate.question), excluded=report.items[index]?.status==='excluded';
      const recoverable=excluded&&job?.status==='failed'&&job.inputHash===require('./aggregation').inputHash(response)&&job.snapshotHash===state.assessment.snapshotHash
        &&job.stages?.transcription?.status==='complete'&&typeof job.stages.transcription.value==='string'&&!!job.stages.transcription.value.trim()
        &&job.stages?.content?.status==='complete'&&Number.isInteger(content?.total)&&content.total>0&&content.total<=limits.content&&content.maximum===limits.content
        &&!content.score_provisional&&!content.needs_semantic_review&&(['ra','rs'].includes(candidate.question.type)||content.scoringMode==='ai'&&content.contentStatus==='assessed');
      const sameInput=job?.inputHash===require('./aggregation').inputHash(response);
      const needsContent=typeof assessContent==='function'&&(!job||['failed','pending'].includes(job.status))&&response?.sealed
        &&(!job||job.snapshotHash===state.assessment.snapshotHash)
        &&(!sameInput||!Object.values(job.stages||{}).some(stage=>stage?.uncertain||stage?.status==='running'));
      return TYPES.has(candidate.question.type)&&(job?.status==='assessed'&&!job.result?.gated||recoverable||needsContent)&&segments.length===1 ? [{id:candidate.id,number:index+1,type:candidate.question.type,previous:recoverable?{content:content.total,pronunciation:null,fluency:null}:needsContent?{content:job?.stages?.content?.status==='complete'?content?.total:null,pronunciation:null,fluency:null}:job.result.scores,segment:segments[0].id,needsContent,sameInput}] : [];
    });
  }
  function replace(state,op,paper) {
    const job=state.assessment.items[op.questionId];
    if(op.preparedResult){
      job.status='assessed';job.inputHash=op.inputHash;job.result=structuredClone(op.preparedResult);job.stages=structuredClone(op.preparedStages);delete job.reason;
      if(job.result.gated)return;
      if(op.result.contentOnly){job.stages.delivery={status:'partial',traits:structuredClone(op.preparedStages.delivery?.traits||{}),uncertain:!!op.deliveryUncertain};return;}
    }
    if(job.status==='failed'){
      const candidate=paper.questions.find(q=>q.id===op.questionId),content=job.stages.content.value;
      job.result=require('./adapters').result(candidate.question,{content:content.total,pronunciation:op.result.pronunciation.score,fluency:op.result.fluency.score},{nativeVersion:content.version});
      job.status='assessed';delete job.reason;
    }
    for(const key of ['pronunciation','fluency'])job.result.scores[key]=op.result[key].score;
    job.result.total=Object.keys(job.result.maxima).reduce((sum,key)=>sum+job.result.scores[key],0);
    job.result.maximum=Object.values(job.result.maxima).reduce((sum,value)=>sum+value,0);
    delete job.result.partialDelivery;delete job.result.unavailableTraits;
    job.stages.delivery={status:'complete',uncertain:false,traits:Object.fromEntries(['pronunciation','fluency'].map(key=>[key,{score:op.result[key].score,raw:op.result[key].raw,version:op.result.version,provider:'azure',evidence:[]}]))};
  }
  // A published instructor review seals the hashes of confirmed jobs. When an
  // admin explicitly replaces delivery marks, update only those job/delivery
  // hashes and archive both ledgers with the operation. This preserves the
  // original exclusion and its publication evidence without weakening review
  // validation for any unrelated question or stage.
  function applyReplacement(state,items,{operation,at,paper}={}) {
    const policy=require('../mock-result-review'),review=state.instructorReview;
    const published=review?.version===policy.VERSION&&review.status==='published';
    let before;
    if(published){
      if(!policy.publicationValid(state,'full'))throw fail('The earlier instructor publication cannot be verified. Original marks are retained.',409);
      before=structuredClone(review.confirmed);
    }
    for(const item of items)replace(state,item,paper);
    if(!published)return null;
    const ids=items.map(item=>item.questionId),inScope=key=>ids.some(id=>key===id||key===id+':delivery'||key.startsWith(id+':delivery:')||items.some(item=>item.questionId===id&&item.preparedResult&&(key===id+':content'||key===id+':transcription')));
    const current=policy.confirmed(state,'full'),after=structuredClone(before);
    for(const key of Object.keys(after))if(inScope(key))delete after[key];
    for(const [key,value] of Object.entries(current))if(inScope(key))after[key]=value;
    review.confirmed=after;
    if(!policy.publicationValid(state,'full'))throw fail('The earlier instructor publication could not be preserved. Original marks are retained.',409);
    const hash=require('../scoring-jobs').hash;
    return {version:'full-mock-instructor-delivery-amendment-2026-11-06.1',operation,at,questionIds:ids,
      originalPublicationOperation:review.publication.operation,beforeConfirmed:before,beforeHash:hash(before),
      afterConfirmed:structuredClone(after),afterHash:hash(after)};
  }
  function selectedIssues(paper,report,items) {
    const selected=new Set(items.map(item=>item.questionId));
    return report.items.filter(item=>selected.has(item.id)&&item.status!=='assessed')
      .map(item=>({id:item.id,number:paper.questions.findIndex(candidate=>candidate.id===item.id)+1,type:item.type,status:item.status}));
  }
  function view(owner,id,record) {
    return {owner,attemptId:id,paperId:record.paper.id,paperVersion:record.paper.version,evidenceHash:fingerprint(record.state),profiles:aggregate(record.paper,record.state).profiles,questions:eligible(record.paper,record.state),operations:Object.fromEntries(Object.entries(record.state.deliveryReassessments||{}).map(([id,op])=>{const value=structuredClone(op);if(op.batch){value.completedCount=op.items.filter(item=>item.status==='complete').length;value.failedCount=op.items.filter(item=>['failed','confirmation-pending'].includes(item.status)).length;}if(['review','partial'].includes(op.status)&&op.evidenceHash===fingerprint(record.state)){try{const proposed=structuredClone(record.state),items=op.batch?op.items.filter(item=>item.status==='complete'):[op];applyReplacement(proposed,items,{paper:record.paper});const preview=aggregate(record.paper,proposed);value.proposedProfiles=preview.profiles;value.proposalIssues=[...preview.items.filter(item=>!['assessed','excluded'].includes(item.status)).map(item=>({id:item.id,number:record.paper.questions.findIndex(candidate=>candidate.id===item.id)+1,type:item.type,status:item.status})),...selectedIssues(record.paper,preview,items)];value.proposalReady=preview.ready&&value.proposalIssues.length===0;if(preview.ready&&value.proposalIssues.length)value.proposalError='A confirmed selected recording would remain excluded. Its replacement was not published.';}catch(error){value.proposalReady=false;value.proposalError=error.status?error.message:'The proposed report could not be verified. Original marks are retained.';}}return [id,value];}))};
  }
  async function inspect(owner,id){const record=await read(owner,id);for(const [operation,op] of Object.entries(record.state.deliveryReassessments||{}))if(op.batch&&(['queued','running','paused'].includes(op.status)||op.autoPublish&&!op.autoPublishError&&['review','partial'].includes(op.status)))schedule(owner,id,operation);const value=view(owner,id,record);value.provider=providerConfiguration();value.questions=value.questions.map(q=>({...q,blocked:blocked(record.state,q.id)||value.provider.ready===false&&!q.needsContent}));return value;}
  function blocked(state,questionId) {
    const job=state.assessment?.items?.[questionId];if(job?.result?.partialDelivery&&job.stages?.delivery?.uncertain)return true;
    if(['failed','pending'].includes(job?.status)&&Object.values(job.stages||{}).some(stage=>stage?.uncertain||stage?.status==='running'))return true;
    return Object.values(state.deliveryReassessments||{}).some(op=>op.batch
      ? op.items.some(item=>item.questionId===questionId&&((['running','confirmation-pending'].includes(item.status)||item.status==='queued'&&['queued','running','paused'].includes(op.status))||['review','partial'].includes(op.status)&&item.status==='complete'&&op.evidenceHash===fingerprint(state)||op.status==='published'&&item.deliveryUncertain))
      : op.questionId===questionId&&(['running','confirmation-pending'].includes(op.status)||op.status==='review'&&op.evidenceHash===fingerprint(state)));
  }
  function schedule(owner,id,operation) {
    const key=owner+':'+id+':'+operation;if(jobs.has(key))return;
    const job=Promise.resolve().then(()=>workBatch(owner,id,operation)).catch(async()=>{try{await store.update(owner,id,state=>{const op=state.deliveryReassessments?.[operation];if(op&&['queued','running'].includes(op.status)){op.status='paused';op.message='Background processing paused. Original marks and completed results are saved. Refresh status to resume unsent recordings.';}return state;});}catch{console.warn('[azure-delivery-batch] Reassessment paused; original marks retained.');}}).finally(()=>jobs.delete(key));jobs.set(key,job);
  }
  async function workBatch(owner,id,operation) {
    while(true){
      const record=await read(owner,id);let claimed;
      await store.update(owner,id,state=>{
        claimed=null;check(state,record.paper);const op=state.deliveryReassessments?.[operation];
        if(!op?.batch||!['queued','running','paused'].includes(op.status))return state;
        if(fingerprint(state)!==op.evidenceHash){op.status='stale';op.message='Saved scores or recordings changed. No replacement was published.';return state;}
        for(const item of op.items)if(item.status==='running'&&item.leaseExpiresAt<=now()){item.status='confirmation-pending';item.message='The earlier request did not save a confirmed receipt before its worker lease ended. It will not be sent again automatically; original marks remain.';}
        if(op.items.some(item=>item.status==='running'))return state;
        const item=op.items.find(item=>item.status==='queued');
        if(!item){op.status=op.items.every(item=>item.status==='complete')?'review':'partial';op.completedAt=now();return state;}
        item.status='running';item.startedAt=now();item.leaseExpiresAt=now()+10*60*1000;op.status='running';claimed=structuredClone(item);return state;
      });
      if(!claimed){
        const saved=await store.get(owner,id),op=saved?.state.deliveryReassessments?.[operation];
        if(op?.autoPublish&&!op.autoPublishError&&['review','partial'].includes(op.status)&&op.items.some(item=>item.status==='complete')){
          try{await publishBatch(owner,id,{operation,confirmPublish:true,confirmPartial:true});}
          catch(error){await store.update(owner,id,state=>{const current=state.deliveryReassessments?.[operation];if(current&&['review','partial'].includes(current.status)){current.autoPublishError=true;current.message=error.status?error.message:'The updated report could not be verified. Original marks are retained.';}return state;});}
        }
        return;
      }
      let result,audio,sent=false,error,preparedResult,preparedStages,deliveryUncertain=false,deliveryMessage;
      const contentOnly=()=>({version:'content-only',contentOnly:true,pronunciation:{score:preparedResult?.scores?.pronunciation??null,raw:null},fluency:{score:preparedResult?.scores?.fluency??null,raw:null}});
      try{
        const candidate=record.paper.questions.find(q=>q.id===claimed.questionId),number=record.paper.questions.indexOf(candidate)+1;
        audio=await recordingBytes(owner,id,record.state.responses[number],claimed.segment,store.getChunk);
        if(claimed.needsContent){
          const decoded=await assemble(owner,id,candidate.question,record.state.responses[number],{getChunk:store.getChunk});
          if(decoded.status!=='ready')throw Object.assign(Error('The recording could not be prepared for assessment.'),{providerStarted:false});
          const value=await assessContent(record.state,candidate.question,record.state.responses[number],{recording:decoded.recording,previous:claimed.contentStages||{},checkpoint:async stages=>store.update(owner,id,state=>{
            const op=state.deliveryReassessments[operation],item=op?.items.find(row=>row.questionId===claimed.questionId);
            if(fingerprint(state)!==op.evidenceHash||item?.status!=='running'||item.startedAt!==claimed.startedAt)throw fail('Saved evidence changed during reassessment.',409);
            item.contentStages=structuredClone(stages);return state;
          })});
          const {stages,...prepared}=value;preparedStages=stages;preparedResult=prepared;
          if(prepared.partialDelivery&&!prepared.gated){for(const key of ['pronunciation','fluency']){const trait=stages.delivery?.traits?.[key];if(Number.isFinite(trait?.score)&&trait.score>=0&&trait.score<=5)prepared.scores[key]=trait.score;}
            const included=Object.keys(prepared.maxima).filter(key=>prepared.scores[key]!=null);prepared.total=included.reduce((n,key)=>n+prepared.scores[key],0);prepared.maximum=included.reduce((n,key)=>n+prepared.maxima[key],0);prepared.unavailableTraits=['pronunciation','fluency'].filter(key=>prepared.scores[key]==null);if(!prepared.unavailableTraits.length){delete prepared.partialDelivery;delete prepared.unavailableTraits;}}
          const valid=prepared.version===require('./adapters').VERSION&&(require('./aggregation').nativeValid(prepared,require('./adapters').maxima(candidate.question))||require('./aggregation').partialValid(prepared,require('./adapters').maxima(candidate.question),stages,candidate.question.type));
          if(!valid)throw Object.assign(Error('The content assessment could not be confirmed.'),{providerStarted:false,uncertain:Object.values(stages||{}).some(stage=>stage?.uncertain)});
          if(prepared.gated)result={version:'native-content-gate',pronunciation:{score:0,raw:null},fluency:{score:0,raw:null}};
        }
        const configured=providerConfiguration();if(!configured.ready&&!result){if(preparedResult){result=contentOnly();deliveryMessage='Content assessment confirmed. Azure delivery marks were unavailable.';}else throw Object.assign(Error(configured.message),{providerStarted:false});}
        if(!result){await store.update(owner,id,state=>{const op=state.deliveryReassessments[operation];if(fingerprint(state)!==op.evidenceHash)throw fail('Saved inputs changed before sending.',409);const item=op.items.find(item=>item.questionId===claimed.questionId);item.providerStartedAt=now();return state;});
          sent=true;result=await assess({mime:audio.mime,data:audio.bytes.toString('base64')});
          if(assess===continuous.assessRecording)result=delivery.reband(result,{questionType:candidate.question.type,bandPolicy:savedPolicy(record.state)});}
        if(!result?.version||!result.contentOnly&&!['pronunciation','fluency'].every(k=>Number.isFinite(result[k]?.score)&&result[k].score>=0&&result[k].score<=5))throw Error('Invalid Azure result');
      }catch(caught){if(preparedResult&&!preparedResult.gated&&caught.status!==409){result=contentOnly();deliveryUncertain=sent&&caught.providerStarted!==false;deliveryMessage='Content assessment confirmed. Azure delivery marks were unavailable.';}else error=caught;}
      await store.update(owner,id,state=>{
        const op=state.deliveryReassessments[operation],item=op.items.find(item=>item.questionId===claimed.questionId);
        if(!['running','confirmation-pending'].includes(item.status)||item.startedAt!==claimed.startedAt)throw fail('Reassessment operation changed.',409);
        if(['published','discarded','stale'].includes(op.status)){if(result){item.lateResult=result;item.lateCompletedAt=now();}return state;}
        if(error){const uncertain=error.uncertain===true||sent&&error.providerStarted!==false;item.status=uncertain?'confirmation-pending':'failed';item.message=uncertain?'The assessment did not return a confirmed result. This recording will not be sent again automatically; its original marks are retained.':'The saved recording could not be assessed. Its original marks are retained. Check recording availability and provider configuration.';}
        else{item.status='complete';item.result=result;item.recordingHash=require('./store').hash(audio.bytes);if(preparedResult){item.preparedResult=preparedResult;item.preparedStages=preparedStages;}if(deliveryMessage){item.message=deliveryMessage;item.deliveryUncertain=deliveryUncertain;}}
        item.completedAt=now();
        if(!op.items.some(item=>['queued','running'].includes(item.status))){op.status=op.items.every(item=>item.status==='complete')?'review':'partial';op.completedAt=now();}
        return state;
      });
    }
  }
  async function sendBatch(owner,id,body) {
    const {operation,evidenceHash}=body;
    if(!/^[a-zA-Z0-9:-]{8,100}$/.test(operation||''))throw fail('A stable reassessment operation is required.',400);
    const record=await read(owner,id),available=eligible(record.paper,record.state),previous=record.state.deliveryReassessments?.[operation];
    if(previous){if(!previous.batch||body.all===true&&!previous.all||body.all!==true&&digest(previous.questionIds)!==digest(body.questionIds)||!!previous.autoPublish!==(body.autoPublish===true))throw fail('Operation belongs to another selection.',409);return inspect(owner,id);}
    const questionIds=body.all===true?available.filter(q=>!blocked(record.state,q.id)).map(q=>q.id):body.questionIds;
    if(!Array.isArray(questionIds)||!questionIds.length||questionIds.length>65||new Set(questionIds).size!==questionIds.length||questionIds.some(id=>typeof id!=='string'))throw fail('Select at least one available saved speaking recording.',400);
    const configured=providerConfiguration();if(!configured.ready&&!questionIds.some(id=>available.find(q=>q.id===id)?.needsContent))throw fail(configured.message,409);
    await store.update(owner,id,state=>{
      check(state,record.paper);state.deliveryReassessments||={};const old=state.deliveryReassessments[operation];
      if(old){if(!old.batch||digest(old.questionIds)!==digest(questionIds))throw fail('Operation belongs to another selection.',409);return state;}
      if(fingerprint(state)!==evidenceHash)throw fail('Saved evidence changed. Reload the attempt before sending.',409);
      if(Object.values(state.deliveryReassessments).some(op=>(op.batch&&['queued','running','paused','review','partial'].includes(op.status)||!op.batch&&op.status==='review')&&op.evidenceHash===evidenceHash))throw fail('Finish or discard the current reassessment before starting another batch.',409);
      const rows=eligible(record.paper,state);
      if(questionIds.some(id=>!rows.some(q=>q.id===id)||blocked(state,id)))throw fail('A selected recording is unavailable or has an earlier unconfirmed request. Refresh its status.',409);
      const needsEarlierPublication=!aggregate(record.paper,state).ready||!require('./aggregation').availableMarks(state)&&questionIds.some(id=>rows.find(q=>q.id===id).needsContent);
      if(needsEarlierPublication&&body.autoPublish!==true)throw fail('Use the current admin recording controls to reassess and publish this earlier attempt.');
      const earlierPublication=needsEarlierPublication?activateEarlier(state,record.paper):null;
      state.deliveryReassessments[operation]={batch:true,all:body.all===true,autoPublish:body.autoPublish===true,questionIds:[...questionIds],evidenceHash:fingerprint(state),status:'queued',at:now(),...(earlierPublication?{earlierPublication}:{}),items:questionIds.map(questionId=>{const row=rows.find(q=>q.id===questionId);return{questionId,number:row.number,type:row.type,segment:row.segment,status:'queued',previous:structuredClone(state.assessment.items[questionId]),previousScores:structuredClone(row.previous),...(row.needsContent?{needsContent:true,inputHash:require('./aggregation').inputHash(state.responses[row.number]),contentStages:row.sameInput?structuredClone(state.assessment.items[questionId].stages||{}):{}}:{})};})};return state;
    });
    schedule(owner,id,operation);return inspect(owner,id);
  }
  async function publishBatch(owner,id,{operation,confirmPublish,confirmPartial}) {
    if(confirmPublish!==true)throw fail('Confirm replacement of the published marks.',400);
    const record=await read(owner,id);
    await store.update(owner,id,state=>{
      check(state,record.paper);const op=state.deliveryReassessments?.[operation];if(op?.status==='published')return state;
      if(!op?.batch||!['review','partial'].includes(op.status)||op.evidenceHash!==fingerprint(state))throw fail('The batch is not ready or the saved evidence changed.',409);
      const completed=op.items.filter(item=>item.status==='complete');
      if(!completed.length||op.status==='partial'&&confirmPartial!==true)throw fail('Confirm publication of only the completed recordings; unavailable recordings keep their original marks.',409);
      if(completed.some(item=>digest(item.previous)!==digest(state.assessment.items[item.questionId])))throw fail('Previous scores changed. Reload the saved attempt.',409);
      const before=op.earlierPublication?.profiles||aggregate(record.paper,state).profiles,at=now();
      const instructorReviewAmendment=applyReplacement(state,completed,{operation,at,paper:record.paper});
      const after=aggregate(record.paper,state),issues=selectedIssues(record.paper,after,completed);if(issues.length)throw fail('Confirmed recordings would remain excluded or unassessed: '+issues.map(row=>'Q'+row.number).join(', ')+'. Original marks are retained.',409);if(!after.ready)throw fail('The replacement report could not be verified.',409);
      for(const item of completed)item.publishedScores=structuredClone(state.assessment.items[item.questionId].result.scores);
      Object.assign(op,{status:'published',publishedAt:at,beforeProfiles:before,afterProfiles:after.profiles,...(instructorReviewAmendment?{instructorReviewAmendment}:{})});return state;
    });return inspect(owner,id);
  }
  async function send(owner,id,body) {
    if(Array.isArray(body.questionIds)||body.all===true)return sendBatch(owner,id,body);
    const {operation,questionId,evidenceHash}=body;
    if(!/^[a-zA-Z0-9:-]{8,100}$/.test(operation||'')||typeof questionId!=='string')throw fail('A stable operation and question are required.',400);
    const record=await read(owner,id);const configured=providerConfiguration();if(!configured.ready)throw fail(configured.message,409);let claimed=false;
    await store.update(owner,id,state=>{
      claimed=false;check(state,record.paper);state.deliveryReassessments||={};
      const existing=state.deliveryReassessments[operation];
      if(existing){if(existing.questionId!==questionId)throw fail('Operation belongs to another question.',409);return state;}
      if(fingerprint(state)!==evidenceHash)throw fail('Saved evidence changed. Inspect again.',409);
      if(blocked(state,questionId))throw fail('An earlier request for this recording needs confirmation, or its proposed replacement must be published or discarded.',409);
      if(Object.values(state.deliveryReassessments).some(op=>op.batch&&['queued','running','paused','review','partial'].includes(op.status)&&op.evidenceHash===evidenceHash))throw fail('Finish or discard the current batch before starting another recording.',409);
      if(Object.values(state.deliveryReassessments).some(op=>['running','confirmation-pending'].includes(op.status)))throw fail('An earlier Azure request needs confirmation before another can start.',409);
      if(Object.values(state.deliveryReassessments).some(op=>op.status==='review'&&op.evidenceHash===evidenceHash))throw fail('Publish or discard the proposed replacement before sending another recording.',409);
      const row=eligible(record.paper,state).find(q=>q.id===questionId);if(!row)throw fail('This question is not eligible for delivery replacement.',409);
      if(row.needsContent)throw fail('Use the selected-recordings control to assess and publish this saved recording.',409);
      state.deliveryReassessments[operation]={questionId,segment:row.segment,evidenceHash,status:'running',at:now(),previous:structuredClone(state.assessment.items[questionId])};claimed=true;return state;
    });
    if(!claimed)return inspect(owner,id);
    try {
      const row=eligible(record.paper,record.state).find(q=>q.id===questionId);
      const audio=await recordingBytes(owner,id,record.state.responses[row.number],row.segment,store.getChunk);
      let result=await assess({mime:audio.mime,data:audio.bytes.toString('base64')});
      if(assess===continuous.assessRecording)result=delivery.reband(result,{questionType:row.type,bandPolicy:savedPolicy(record.state)});
      if(!result.version||!['pronunciation','fluency'].every(k=>Number.isFinite(result[k]?.score)&&result[k].score>=0&&result[k].score<=5))throw Error('Invalid Azure result');
      await store.update(owner,id,state=>{const op=state.deliveryReassessments[operation];if(op.status!=='running')throw fail('Operation changed.',409);op.result=result;op.recordingHash=require('./store').hash(audio.bytes);op.status='review';op.completedAt=now();return state;});
    } catch(error) {
      await store.update(owner,id,state=>{const op=state.deliveryReassessments[operation];if(op.status==='running'){op.status='confirmation-pending';op.message='The request did not complete with a verified result. Original marks are retained; do not resend until the provider request is resolved.';}return state;});
    }
    return inspect(owner,id);
  }
  async function publish(owner,id,{operation,confirmPublish,confirmPartial}) {
    const initial=await store.get(owner,id);if(initial?.state.deliveryReassessments?.[operation]?.batch)return publishBatch(owner,id,{operation,confirmPublish,confirmPartial});
    if(confirmPublish!==true)throw fail('Confirm replacement of the published marks.',400);
    const record=await read(owner,id);
    await store.update(owner,id,state=>{
      check(state,record.paper);const op=state.deliveryReassessments?.[operation];
      if(op?.status==='published')return state;
      if(op?.status!=='review'||op.evidenceHash!==fingerprint(state)||digest(op.previous)!==digest(state.assessment.items[op.questionId]))throw fail('Scores or inputs changed. Inspect the saved attempt again.',409);
      const before=aggregate(record.paper,state).profiles,at=now();
      const instructorReviewAmendment=applyReplacement(state,[op],{operation,at,paper:record.paper});
      const after=aggregate(record.paper,state),issues=selectedIssues(record.paper,after,[op]);if(issues.length)throw fail('Confirmed recording would remain excluded or unassessed: Q'+issues[0].number+'. Original marks are retained.',409);if(!after.ready)throw fail('The replacement report could not be verified.',409);
      op.publishedScores=structuredClone(state.assessment.items[op.questionId].result.scores);
      Object.assign(op,{status:'published',publishedAt:at,beforeProfiles:before,afterProfiles:after.profiles,...(instructorReviewAmendment?{instructorReviewAmendment}:{})});return state;
    });return inspect(owner,id);
  }
  async function discard(owner,id,{operation}) {
    await read(owner,id);
    await store.update(owner,id,state=>{const op=state.deliveryReassessments?.[operation];if(!op||!['review','partial','stale','discarded'].includes(op.status))throw fail('Only a completed, unpublished review can be discarded.',409);op.status='discarded';op.discardedAt=now();return state;});
    return inspect(owner,id);
  }
  async function recover(){for(const row of await store.deliveryQueue())schedule(row.uid,row.id,row.operation);}
  return {inspect,send,publish,discard,recover,drain:async()=>{while(jobs.size)await Promise.allSettled([...jobs.values()]);}};
}
module.exports={create,fingerprint};
