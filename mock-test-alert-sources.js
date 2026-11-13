'use strict';
const writingReport=require('./public/writing-lab-report');
function pendingQuestions(a){
  const safeReasons=new Set(['Invalid scoring evidence','Missing feedback','Missing improvement advice','The form score must match the supplied deterministic form score','A claimed form failure contradicts the form score','Missing form explanation','Unsupported SST form gate: a substantial sentence is present; assess grammar and content separately']);
  return (a.questions||[]).flatMap((q,index)=>{
    const result=a.results?.[index],recovery=a.assessmentRecovery?.[index]||{};
    if(result&&!writingReport.needsReview(result,q))return [];
    const reason=result?.fallbackReason;
    const validationIssue=typeof reason==='string'&&(safeReasons.has(reason)||/^Invalid scoring trait: (content|form|grammar|vocabulary|spelling)$/.test(reason))?reason:null;
    const code=recovery.code;
    return [{questionNumber:index+1,task:q.type,status:['calling','held','exhausted','retry_wait','complete'].includes(recovery.status)?recovery.status:'pending',
      attempts:Number.isSafeInteger(recovery.attempts)?recovery.attempts:0,nextRetryAt:Number.isFinite(recovery.nextAt)?recovery.nextAt:null,uncertain:recovery.uncertain===true,
      failureCode:typeof code==='number'||['validation','provider','uncertain_provider_outcome','insufficient_quota','billing_hard_limit_reached','invalid_api_key','ETIMEDOUT','ECONNRESET'].includes(code)?code:null,
      provisional:result?.score_provisional===true||result?.needs_semantic_review===true,validationIssue}];
  });
}
function readingRecords(progress){
  return [...(Array.isArray(progress?.history)?progress.history:[]),progress?.session].filter(Boolean);
}
function snapshot(engine,a,record){
  if(!a)return null;
  const base={id:a.id,title:a.title||a.name,isMock:true,submitted:a.status==='submitted',finishedAt:Number(engine==='full'?(a.submittedAt??a.finishedAt):a.finishedAt),ready:false,held:false,pending:0};
  if(require('./mock-result-review').held(a))return {...base,held:true,pending:1};
  if(engine==='reading'){
    base.isMock=!a.practiceUid&&Array.isArray(a.questions)&&a.questions.length>0;
    if(!base.isMock)return null;
    base.submitted=a.done===true;
    base.pending=Number(!!a.pending||a.questions?.some(q=>q.type==='swt'&&a.answers?.[q.uid]?.[0]?.trim()&&!a.assessments?.[q.uid]));
    base.ready=base.submitted&&!base.pending;
    base.mediaError=!base.submitted&&Object.values(a.audioStates||{}).some(value=>value?.status==='error');
  }else if(engine==='writing'||engine==='listening'){
    base.isMock=a.kind==='mock'&&(engine==='listening'?a.module==='listening':a.module!=='listening');
    if(!base.isMock)return null;
    const summary=writingReport.summarize(a.questions||[],a.results||[],a);
    base.pending=summary.byType.reduce((total,row)=>total+row.count-row.marked,0);
    const overallRequired=engine==='writing'&&require('./writing-mock-overall').eligible(a);
    base.ready=summary.complete&&(!overallRequired||a.overallFeedback?.status==='complete');
    base.held=a.overallFeedback?.status==='unavailable';
  }else if(engine==='full'){
    const items=Object.values(a.assessment?.items||{});
    base.pending=Math.max(0,(record?.paper?.questions?.length||a.questionCount||65)-items.filter(row=>row.status==='assessed').length);
    base.ready=a.assessment?.status==='complete'&&base.pending===0;
    if(Object.keys(a.assessment?.exclusions||{}).length){
      try{
        const result=require('./full-mock/aggregation').aggregate(record.paper,a);
        base.pending=result.expectedCount-result.accountedCount;
        base.ready=a.assessment.status==='complete'&&result.ready;
      }catch{base.pending=Math.max(1,base.pending);base.ready=false;}
    }
    base.held=a.assessment?.status==='needs-attention';
    const failures=(a.events||[]).filter(row=>['media-failure','microphone-interrupted','local-storage-failure'].includes(row.reason));
    base.mediaError=failures.length>0;base.mediaErrorAt=Math.max(0,...failures.map(row=>Number(row.receivedAt)||0));
  }else if(engine==='speaking'){
    if(require('./speaking-mock-submission').blocked(a)){base.ready=false;base.held=a.submission.state==='incomplete';base.pending=(a.submission.pending?.length||0)+(a.submission.missing?.length||0)+(a.submission.unattempted?.length||0);return base;}
    base.ready=a.assessment?.status==='ready';
    if(!base.ready&&Array.isArray(a.questions)&&Array.isArray(a.responses)){
      base.ready=base.submitted&&require('./speaking-mock-report').summarize(a).azure.status==='assessed';
    }
  }else return null;
  return base;
}
function createSources({pool,speakingStore,writingStore,fullStore,loadReading}){
  const stores={speaking:speakingStore,writing:writingStore,listening:writingStore};
  const sources={};
  for(const engine of ['speaking','writing','listening','full']){
    const table=engine==='full'?'full_mock_attempts':engine==='speaking'?'speaking_mock_attempts':'writing_lab_attempts';
    const column=engine==='full'?'state':'data';
    sources[engine]={
      async get(uid,id){
        const record=engine==='full'?await fullStore.get(uid,id):await stores[engine].get(uid,id,{omitMockAudio:true});
        const value=snapshot(engine,engine==='full'?record?.state:record,record);
        return value&&['writing','listening'].includes(engine)?{...value,pendingQuestions:pendingQuestions(record)}:value;
      },
      async scan({since,cursor,limit}){
        if(!pool)return{rows:[],nextCursor:''};
        // Speaking submission notices do not need question text, transcripts or audio.
        const projection=engine==='speaking'?"data-'responses'-'questions'":column;
        const timestamps=engine==='full'?['submittedAt','finishedAt']:['finishedAt'];
        const submittedAt='COALESCE('+timestamps.map(field=>`CASE WHEN jsonb_typeof(${column}->'${field}')='number' THEN (${column}->>'${field}')::numeric END`).join(',')+',0)';
        const rows=(await pool.query(`SELECT username,${projection} AS value${engine==='full'?',paper':''} FROM ${table}
          WHERE id::text>$1 AND ${column}->>'status'='submitted'
          AND ${submittedAt} >= $2
          ORDER BY id LIMIT $3`,[cursor,since,limit])).rows;
        return{rows:rows.map(row=>({username:row.username,snapshot:snapshot(engine,row.value,engine==='full'?{paper:row.paper}:undefined)})).filter(row=>row.snapshot?.isMock),nextCursor:rows.length===limit?rows.at(-1).value.id:''};
      }
    };
  }
  sources.reading={
    async get(uid,id){const progress=await loadReading(uid);return snapshot('reading',readingRecords(progress).find(a=>a.id===id));},
    async scan({since,cursor,limit}){
      if(!pool)return{rows:[],nextCursor:''};
      const accounts=(await pool.query("SELECT username,data->'readingProgress' AS progress FROM user_data WHERE username>$1 AND data ? 'readingProgress' ORDER BY username LIMIT $2",[cursor,limit])).rows;
      const rows=accounts.flatMap(row=>readingRecords(row.progress).filter(a=>a.done&&Number(a.finishedAt)>=since).map(a=>({username:row.username,snapshot:snapshot('reading',a)}))).filter(row=>row.snapshot?.isMock);
      return{rows,nextCursor:accounts.length===limit?accounts.at(-1).username:''};
    }
  };
  return sources;
}
module.exports={createSources,snapshot,readingRecords};
