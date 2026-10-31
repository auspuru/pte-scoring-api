'use strict';
// Report-only projections. Never write attempts, invoke a grader or change marks.
const impact = require('./public/mock-impact-feedback');
const { PROFILES } = require('./full-mock/profiles');
const writing = require('./public/writing-lab-report');
const clean = value => typeof value === 'string' ? value.trim().slice(0,900) : '';
function evidence(result, answer) {
  const issue = (result?.feedbackIssues || []).find(row => row.affectsScore === true && row.evidence?.essayQuote && answer.includes(row.evidence.essayQuote));
  const error = (result?.errors || []).find(row => row.phrase && answer.includes(row.phrase));
  const trait=result?.gated?null:Object.keys(result?.scores||{}).filter(key=>Number.isFinite(result.maxima?.[key])&&result.maxima[key]>0&&result.scores[key]<result.maxima[key]&&typeof result.feedback?.[key]==='string').sort((a,b)=>result.scores[a]/result.maxima[a]-result.scores[b]/result.maxima[b])[0];
  return { advice:clean(issue?.suggestedChange || (trait&&result.feedback[trait]) || result?.improvements?.[0] || error?.explanation || result?.feedback?.content),
    strength:clean(result?.strengths?.[0]), quote:clean(issue?.evidence?.essayQuote || error?.phrase) };
}
function lab(a, summary = writing.summarize(a.questions, a.results, a)) {
  if (a.status !== 'submitted' || a.kind !== 'mock') return null;
  const key = a.module === 'listening' ? 'listening' : 'writing';
  const groups = summary.byType.map(g => ({ type:g.type,label:g.label,count:g.count,earned:g.total,possible:g.maximum,
    complete:g.marked === g.count && !a.questions.some((q,i) => q.type === g.type && writing.needsReview(a.results?.[i],q)) }));
  // Listening pools native points. Explain the actual displayed result.
  const weights = summary.weighting ? Object.fromEntries(summary.byType.map(g => [g.type,g.weight]))
    : Object.fromEntries(groups.map(g => [g.type,g.possible]));
  const items = a.questions.map((q,i) => {
    const r = a.results?.[i], g = groups.find(g => g.type === q.type);
    return {type:q.type,number:i+1,status:g.complete?'assessed':'pending',total:r?.total,maximum:r?.maximum,
      ...evidence(r,String(a.answers?.[i] || ''))};
  });
  return impact.build({scope:key,groups,profiles:{[key]:{weights}},relatedProfiles:PROFILES,items});
}
function speaking(a, report) {
  if (a.status !== 'submitted') return null;
  const groups = report.byType.map(g => ({type:g.type,label:g.label,count:g.count,earned:g.total,possible:g.maximum,complete:report.status==='assessed'&&g.marked===g.count}));
  const items = report.questions.map(row => {
    const response=a.responses?.[row.index], result=response?.content;
    const complete=row.total!==null&&!row.excluded;
    const acoustic=response?.azure, fresh=acoustic?.recordingHash===response?.recording?.hash;
    const trait=['pronunciation','fluency'].find(key=>complete&&row[key]<5&&row[key]>0);
    const delivery=trait&&fresh&&acoustic?.status==='assessed'?acoustic[trait]:null;
    const details=evidence(result,response?.transcript||'');
    // Never diagnose delivery from transcripts or archived GPT evidence.
    if(delivery&&(delivery.coaching||delivery.nextStep))details.advice=clean(delivery.coaching||delivery.nextStep);
    return {type:row.type,number:a.questions.slice(0,row.index+1).filter(q=>q.type!=='intro').length,
      status:complete?'assessed':'pending',total:row.total,maximum:row.maximum,...details};
  });
  return impact.build({scope:'speaking',groups,profiles:{speaking:{weights:Object.fromEntries(report.byType.map(g=>[g.type,g.weight]))}},relatedProfiles:PROFILES,items});
}
function labContext(a) {
  const feedback=lab(a);
  return {feedback, verifiedMarks:a.questions.map((q,i)=>{
    const r=a.results?.[i];
    return r&&!writing.needsReview(r,q)&&r.maximum===writing.maximumFor(q)&&writing.score90(r.total,r.maximum)!==null
      ? {index:i,total:r.total,maximum:r.maximum,scores:Object.fromEntries(Object.entries(r.scores||{}).filter(([key,value])=>['content','form','grammar','vocabulary','spelling','structure','linguistic','coherence'].includes(key)&&Number.isFinite(value))),maxima:Object.fromEntries(Object.entries(r.maxima||{}).filter(([key,value])=>['content','form','grammar','vocabulary','spelling','structure','linguistic','coherence'].includes(key)&&Number.isFinite(value)&&value>0)),gated:r.gated===true} : {index:i,status:'pending'};
  })};
}
module.exports={lab,speaking,labContext};
