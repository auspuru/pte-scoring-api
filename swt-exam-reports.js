'use strict';

// Independent student-reported *real-exam encounters*, distinct from source-report counts.
// A student can revise or withdraw their report; repeat submissions never accumulate.
// Session token identity, not a client-supplied username, owns the row.
const IMPORT_BATCH='nov23-2026-swt';
const MAX_EXAM_ENCOUNTERS=50;
function validateTimesSeen(value) {
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<0 || value>MAX_EXAM_ENCOUNTERS) return null;
  return value;
}
function validPassageId(id) {
  const s=String(id ?? '');
  const n=Number(s);
  return /^\d+$/.test(s) && Number.isSafeInteger(n) && n>0 ? n : null;
}
function normalizeReportRows(communityRows=[], userRows=[]) {
  const byId=Object.create(null);
  for(const row of communityRows){
    const id=validPassageId(row.passage_id);
    if(id===null) continue;
    byId[id]={studentReportedTimes:Number(row.total_encounters)||0,reporterCount:Number(row.reporter_count)||0,myTimes:0};
  }
  for(const row of userRows){
    const id=validPassageId(row.passage_id);
    if(id===null)continue;
    if(!byId[id])byId[id]={studentReportedTimes:0,reporterCount:0,myTimes:0};
    byId[id].myTimes=Number(row.times_seen)||0;
  }
  return byId;
}
const publicSummarySql=`
  SELECT passage_id, COALESCE(SUM(times_seen),0)::integer AS total_encounters,
         COUNT(*)::integer AS reporter_count
  FROM swt_exam_occurrence_reports GROUP BY passage_id
`;
function installSwtExamReports(app,{pool,verifyToken,getAccount,getPassage,rateLimiter=null}){
  const auth=async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    const username=verifyToken(req.get('x-session-token')||''); // no impersonation tokens
    if(!username)return res.status(401).json({error:'Please sign in to report questions.'});
    try{
      const account=await getAccount(username);
      if(!account||account.blocked)return res.status(403).json({error:'Account unavailable.'});
      req.swtReportUsername=username;
      return next();
    }catch(e){return res.status(503).json({error:'Account verification unavailable.'});}
  };
  app.get('/api/swt/exam-reports',auth,async(req,res)=>{
    if(!pool)return res.status(503).json({error:'Exam reporting requires the database.'});
    try{
      const [community,mine]=await Promise.all([
        pool.query(publicSummarySql),
        pool.query('SELECT passage_id,times_seen FROM swt_exam_occurrence_reports WHERE username=$1',[req.swtReportUsername])
      ]);
      return res.json({reports:normalizeReportRows(community.rows,mine.rows)});
    }catch(e){console.error('[swt-exam-reports] read failed',e.message);return res.status(500).json({error:'Could not load report counts.'});}
  });
  const middleware=rateLimiter?[auth,rateLimiter]:[auth];
  app.post('/api/swt/exam-reports/:passageId',...middleware,async(req,res)=>{
    if(!pool)return res.status(503).json({error:'Exam reporting requires the database.'});
    const passageId=validPassageId(req.params.passageId);
    const timesSeen=validateTimesSeen(req.body?.timesSeen);
    if(passageId===null)return res.status(400).json({error:'Invalid question ID.'});
    if(timesSeen===null)return res.status(400).json({error:'Enter a whole number of real exam encounters from 0 to '+MAX_EXAM_ENCOUNTERS+'.'});
    try{
      const passage=await getPassage(passageId);
      if(!passage || passage.questionSet!==IMPORT_BATCH)return res.status(404).json({error:'This question is not available for exam reporting.'});
      if(timesSeen===0){
        await pool.query('DELETE FROM swt_exam_occurrence_reports WHERE username=$1 AND passage_id=$2',[req.swtReportUsername,passageId]);
      }else{
        await pool.query(`
          INSERT INTO swt_exam_occurrence_reports(username,passage_id,times_seen,updated_at)
          VALUES($1,$2,$3,NOW())
          ON CONFLICT(username,passage_id)
          DO UPDATE SET times_seen=EXCLUDED.times_seen,updated_at=NOW()
        `,[req.swtReportUsername,passageId,timesSeen]);
      }
      const aggregate=await pool.query(`
        SELECT COALESCE(SUM(times_seen),0)::integer AS total_encounters,
               COUNT(*)::integer AS reporter_count
        FROM swt_exam_occurrence_reports WHERE passage_id=$1
      `,[passageId]);
      const row=aggregate.rows[0]||{};
      return res.json({success:true,passageId,report:{myTimes:timesSeen,studentReportedTimes:Number(row.total_encounters)||0,reporterCount:Number(row.reporter_count)||0}});
    }catch(e){console.error('[swt-exam-reports] save failed',e.message);return res.status(500).json({error:'Your report could not be saved.'});}
  });
}
module.exports={IMPORT_BATCH,MAX_EXAM_ENCOUNTERS,validateTimesSeen,validPassageId,normalizeReportRows,installSwtExamReports};
