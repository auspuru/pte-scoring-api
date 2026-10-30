'use strict';
const writingReport=require('./public/writing-lab-report');
function readingRecords(progress){
  return [...(Array.isArray(progress?.history)?progress.history:[]),progress?.session].filter(Boolean);
}
function snapshot(engine,a,record){
  if(!a)return null;
  const base={id:a.id,title:a.title||a.name,isMock:true,submitted:a.status==='submitted',finishedAt:Number(engine==='full'?(a.submittedAt??a.finishedAt):a.finishedAt),ready:false,held:false,pending:0};
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
    base.held=a.assessment?.status==='needs-attention';
    const failures=(a.events||[]).filter(row=>['media-failure','microphone-interrupted','local-storage-failure'].includes(row.reason));
    base.mediaError=failures.length>0;base.mediaErrorAt=Math.max(0,...failures.map(row=>Number(row.receivedAt)||0));
  }else if(engine==='speaking'){
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
        return snapshot(engine,engine==='full'?record?.state:record,record);
      },
      async scan({since,cursor,limit}){
        if(!pool)return{rows:[],nextCursor:''};
        // Speaking submission notices do not need question text, transcripts or audio.
        const projection=engine==='speaking'?"data-'responses'-'questions'":column;
        const timestamps=engine==='full'?['submittedAt','finishedAt']:['finishedAt'];
        const submittedAt='COALESCE('+timestamps.map(field=>`CASE WHEN jsonb_typeof(${column}->'${field}')='number' THEN (${column}->>'${field}')::numeric END`).join(',')+',0)';
        const rows=(await pool.query(`SELECT username,${projection} AS value FROM ${table}
          WHERE id::text>$1 AND ${column}->>'status'='submitted'
          AND ${submittedAt} >= $2
          ORDER BY id LIMIT $3`,[cursor,since,limit])).rows;
        return{rows:rows.map(row=>({username:row.username,snapshot:snapshot(engine,row.value)})).filter(row=>row.snapshot?.isMock),nextCursor:rows.length===limit?rows.at(-1).value.id:''};
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
