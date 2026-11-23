'use strict';

// One click = one student reporting that this SWT passage appeared in an
// official PTE exam. Multiple clicks never increase the count for a student.
function validPassageId(value) {
  const s=String(value ?? '');
  const id=Number(s);
  return /^\d+$/.test(s) && Number.isSafeInteger(id) && id>0 ? id : null;
}
const REPORT_COUNTS_SQL=`
  SELECT passage_id, COUNT(*)::integer AS reporter_count
  FROM swt_exam_question_reports GROUP BY passage_id
`;
async function readSwtReportCounts(pool) {
  if (!pool) return new Map();
  const result=await pool.query(REPORT_COUNTS_SQL);
  return new Map((result.rows||[]).map(row=>[Number(row.passage_id),Number(row.reporter_count)||0]));
}
function normalizeReportRows(communityRows=[], userRows=[]) {
  const reports=Object.create(null);
  for(const row of communityRows) {
    const id=validPassageId(row.passage_id);
    if(id===null)continue;
    reports[id]={reporterCount:Number(row.reporter_count)||0,myReported:false};
  }
  for(const row of userRows) {
    const id=validPassageId(row.passage_id);
    if(id===null)continue;
    if(!reports[id])reports[id]={reporterCount:0,myReported:false};
    reports[id].myReported=true;
  }
  return reports;
}
function installSwtExamReports(app,{pool,verifyToken,getAccount,getPassage,rateLimiter=null}) {
  const authenticate=async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    const username=verifyToken(req.get('x-session-token')||''); // never trust body user IDs or impersonation sessions
    if(!username)return res.status(401).json({error:'Please sign in to report a question.'});
    try {
      const account=await getAccount(username);
      if(!account||account.blocked)return res.status(403).json({error:'Your account is unavailable.'});
      req.swtReportUsername=username;next();
    }catch(e){return res.status(503).json({error:'Account verification unavailable.'});}
  };
  app.get('/api/swt/exam-reports',authenticate,async(req,res)=>{
    if(!pool)return res.status(503).json({error:'Reporting requires database access.'});
    try {
      const [community,mine]=await Promise.all([
        pool.query(REPORT_COUNTS_SQL),
        pool.query('SELECT passage_id FROM swt_exam_question_reports WHERE username=$1',[req.swtReportUsername])
      ]);
      return res.json({reports:normalizeReportRows(community.rows,mine.rows)});
    }catch(e){
      console.error('[swt-report] Could not fetch student reports',e.message);
      return res.status(500).json({error:'Could not load question reports.'});
    }
  });
  const middleware=rateLimiter?[authenticate,rateLimiter]:[authenticate];
  app.post('/api/swt/exam-reports/:passageId',...middleware,async(req,res)=>{
    if(!pool)return res.status(503).json({error:'Reporting requires database access.'});
    const passageId=validPassageId(req.params.passageId);
    if(passageId===null)return res.status(400).json({error:'Invalid question ID.'});
    try {
      const passage=await getPassage(passageId);
      if(!passage)return res.status(404).json({error:'Question not found.'});
      // UNIQUE(username,passage_id) guarantees one report per student.
      const inserted=await pool.query(`
        INSERT INTO swt_exam_question_reports (username,passage_id)
        VALUES ($1,$2) ON CONFLICT (username,passage_id) DO NOTHING
        RETURNING passage_id
      `,[req.swtReportUsername,passageId]);
      const counts=await pool.query(`
        SELECT COUNT(*)::integer AS reporter_count
        FROM swt_exam_question_reports WHERE passage_id=$1
      `,[passageId]);
      return res.json({success:true,passageId,alreadyReported:!(inserted.rowCount>0),
        report:{myReported:true,reporterCount:Number(counts.rows[0]?.reporter_count)||0}});
    }catch(e){
      console.error('[swt-report] Could not save student report',e.message);
      return res.status(500).json({error:'Could not save your report.'});
    }
  });
}
module.exports={validPassageId,normalizeReportRows,readSwtReportCounts,installSwtExamReports,REPORT_COUNTS_SQL};
