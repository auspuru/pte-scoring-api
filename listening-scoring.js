'use strict';
const TYPES = new Set(['lmcma','lfi','hcs','lmcsa','smw','hiw']);
function maximum(q) {
  return ['lmcma','lfi','hiw'].includes(q.type) ? q.answers.length : 1;
}
function parse(text) {
  try { const value=JSON.parse(text); return Array.isArray(value)?value:[]; } catch (_) { return []; }
}
function grade(q,text) {
  if(!TYPES.has(q.type))return null;
  const a=parse(text), max=maximum(q); let total;
  if(q.type==='lfi') total=q.answers.filter((word,i)=>String(a[i]||'').trim().normalize('NFKC').toLowerCase()===word.toLowerCase()).length;
  else if(['lmcma','hiw'].includes(q.type)) total=Math.max(0,[...new Set(a)].reduce((sum,index)=>sum+(Number.isInteger(index)&&q.answers.includes(index)?1:-1),0));
  else total=a.length===1&&a[0]===q.answer?1:0;
  total=Math.min(max,total);
  return {version:'listening-objective-20261020',assessmentType:'Answer-key practice assessment',
    total,maximum:max,scores:{content:total},maxima:{content:max},gated:false,reasons:[],errors:[],
    feedback:{content:total+' of '+max+' points. '+q.explanation},
    strengths:total===max?['All answers are correct.']:[],
    improvements:total<max?[q.type==='lfi'?'Check each missing word against the transcript, including its spelling.':'Compare your selections with the answer key and the supporting transcript.']:[]};
}
module.exports={TYPES,maximum,parse,grade};
