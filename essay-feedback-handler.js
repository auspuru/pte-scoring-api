'use strict';
const {randomUUID} = require('node:crypto');
const feedback = require('./public/essay-feedback');
const {enabledFor} = require('./essay-feedback-rollout');
const {essayResultForClient} = require('./essay-grading');
function createEssayGradeHandler({grader,verifyToken,getUserData,env=process.env,onError=()=>{}}) {
  return async (req,res) => {
    const {question,essay} = req.body || {};
    const sampleBand=String(req.body?.sampleBand ?? '9').trim().toLowerCase().replace(/^band\s*/,'');
    if(typeof question!=='string' || !question.trim() || question.length>5000 || typeof essay!=='string' || !essay.trim() || essay.length>20000) return res.status(400).json({error:'Provide an essay question and response within the size limits.'});
    if(!['6','7','8','9'].includes(sampleBand)) return res.status(400).json({error:'Choose a sample band from 6, 7, 8 or 9.'});
    try {
      const uid=verifyToken(req.get('x-session-token') || '');
      const feedbackV3=enabledFor(uid,env);
      let parent=null;
      if(feedbackV3 && req.body.parentAttemptId) {
        const history=(await getUserData(uid)).practiceHistory || [];
        parent=history.find(a=>a.id===req.body.parentAttemptId);
        if(!parent) return res.status(404).json({error:'The original essay attempt was not found in your account.'});
        if(parent.questionText?.trim()!==question.trim()) return res.status(409).json({error:'Revisions must answer the original question. Start a new attempt for a different question.'});
      }
      // Compare the writing problem, without carrying the previous deduction or
      // score rationale into an otherwise independent assessment of this draft.
      const revisionContext=parent?.feedbackVersion===feedback.VERSION ? {issues:(parent.feedbackIssues || []).filter(i=>i.priority!=='optional')
        .map(({id,code,category,priority,requirementId,trait,evidence,explanation,suggestedChange})=>({id,code,category,priority,requirementId,trait,evidence,explanation,suggestedChange}))} : null;
      const result=await grader.grade(question,essay,sampleBand,{feedbackV3,revisionContext,includeSample:req.body.includeSample!==false});
      const attemptId=typeof req.body.attemptId==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(req.body.attemptId)?req.body.attemptId:randomUUID();
      res.json(essayResultForClient(feedback.scope(result,{attemptId,parent}),req.get('x-essay-scoring-version') || ''));
    } catch(error) {
      onError(error);
      if(error.retryable===false) return res.status(503).json({code:'ESSAY_EVIDENCE_VALIDATION_FAILED',retryable:false,error:'The assessment evidence could not be verified. Your writing is safe. Please wait before submitting again.'});
      res.status(503).json({error:'The essay assessment could not be completed. Your writing is safe; please try again.'});
    }
  };
}
module.exports={createEssayGradeHandler};
