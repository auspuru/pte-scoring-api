'use strict';

const VERSION = 'local-scoring-2026-09-23.1';
const STOP = new Set(('the a an and or but to of in on for with by from as at is are was were be been being this that these those it its their his her into than then while if so such can could would should may might will do does did have has had about over under between through during before after also very more most much many some any each both other another which who whom whose when where why how').split(' '));

function words(text) {
  return String(text || '').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) || [];
}
function stem(word) {
  let w = String(word || '').toLowerCase();
  if (w.length > 6 && w.endsWith('ing')) w = w.slice(0,-3);
  else if (w.length > 5 && w.endsWith('ied')) w = w.slice(0,-3)+'y';
  else if (w.length > 5 && w.endsWith('ed')) w = w.slice(0,-2);
  else if (w.length > 5 && w.endsWith('es')) w = w.slice(0,-2);
  else if (w.length > 4 && w.endsWith('s')) w = w.slice(0,-1);
  return w;
}
function concepts(text) {
  return words(text).filter(w => w.length > 2 && !STOP.has(w)).map(stem);
}
function set(text) { return new Set(concepts(text)); }
function overlap(reference, response) {
  const ref = [...new Set(concepts(reference))], actual = set(response);
  if (!ref.length) return { ratio:0, matched:0, total:0, matchedTerms:[] };
  const matchedTerms = ref.filter(w => actual.has(w));
  return { ratio:matchedTerms.length/ref.length, matched:matchedTerms.length, total:ref.length, matchedTerms };
}
function splitSentences(text) {
  return String(text || '').trim().split(/(?<=[.!?])\s+|\n+/).map(s=>s.trim()).filter(Boolean);
}
function bestEvidence(reference, response, maxWords=12) {
  const candidates=splitSentences(response);
  let best='',score=0;
  for(const sentence of candidates){
    const hit=overlap(reference,sentence);
    if(hit.ratio>score){score=hit.ratio;best=sentence;}
  }
  if(!best)return '';
  return best.split(/\s+/).slice(0,maxWords).join(' ');
}
function ideaCoverage(ideas,response) {
  return (Array.isArray(ideas)?ideas:Object.values(ideas||{})).filter(Boolean).map((idea,index)=>{
    const hit=overlap(idea,response);
    const status=hit.ratio>=0.42&&hit.matched>=2?'covered':hit.ratio>=0.2&&hit.matched>=1?'partial':'missing';
    return {index,idea:String(idea),...hit,status,evidence:status==='missing'?'':bestEvidence(idea,response)};
  });
}
function summaryContent(ideas,response,max=4) {
  const coverage=ideaCoverage(ideas,response);
  const covered=coverage.filter(x=>x.status==='covered').length;
  const partial=coverage.filter(x=>x.status==='partial').length;
  const avg=coverage.length?coverage.reduce((n,x)=>n+x.ratio,0)/coverage.length:0;
  let score=0;
  if(covered>=3&&avg>=0.42)score=max;
  else if(covered>=2||covered===1&&partial>=2)score=Math.max(1,max-1);
  else if(covered>=1||partial>=2)score=Math.max(1,max-2);
  else if(partial>=1)score=1;
  const confidence=coverage.length&&avg>=0.42&&covered>=Math.min(3,coverage.length)?'high':avg>=0.25?'medium':'low';
  return {score,confidence,coverage,averageCoverage:avg,covered,partial};
}
function promptRelevance(prompt,response) {
  const hit=overlap(prompt,response);
  return {...hit,evidence:bestEvidence(prompt,response)};
}
function paragraphCount(text) {
  const explicit=String(text||'').trim().split(/\n\s*\n/).filter(Boolean).length;
  return explicit>1?explicit:1;
}
function sentenceStats(text) {
  const s=splitSentences(text), lengths=s.map(x=>words(x).length);
  const avg=lengths.length?lengths.reduce((a,b)=>a+b,0)/lengths.length:0;
  const variation=lengths.length>=3&&Math.max(...lengths)-Math.min(...lengths)>=8;
  return {count:s.length,average:avg,variation};
}
function connectors(text) {
  return (String(text||'').match(/\b(?:however|moreover|furthermore|therefore|consequently|although|whereas|while|because|since|thus|hence|additionally|firstly|secondly|finally|in conclusion|on the other hand|for example|for instance)\b/gi)||[]).length;
}
function obviousGrammarIssues(text) {
  const checks=[
    /\b(?:people|students|researchers|children|they|we)\s+(?:is|was|has)\b/i,
    /\b(?:he|she|it|the author|the student)\s+(?:are|were|have)\b/i,
    /\bdoes not has\b/i,/\bdid not went\b/i,/\bi is\b/i
  ];
  return checks.filter(re=>re.test(String(text||''))).length;
}
function lexicalDiversity(text) {
  const all=words(text).filter(w=>w.length>2);
  if(!all.length)return 0;
  return new Set(all).size/all.length;
}
function essay(question,answer,{formScore=2}={}) {
  const count=words(answer).length,relevance=promptRelevance(question,answer),sent=sentenceStats(answer),paras=paragraphCount(answer),links=connectors(answer),issues=obviousGrammarIssues(answer),diversity=lexicalDiversity(answer);
  const developed=count>=180&&sent.count>=5;
  let content=relevance.ratio>=0.32&&developed?6:relevance.ratio>=0.24&&count>=140?5:relevance.ratio>=0.18?4:relevance.ratio>=0.11?3:relevance.ratio>0?2:1;
  const grammar=issues>=3?0:issues?1:2;
  const vocabulary=diversity>=0.52?2:diversity>=0.35?1:0;
  const linguistic=sent.count>=6&&sent.variation?6:sent.count>=5?5:sent.count>=3?4:sent.count>=2?3:1;
  const coherence=paras>=4&&links>=3?6:paras>=3&&links>=2?5:sent.count>=4&&links>=1?4:sent.count>=3?3:2;
  const spelling=2;
  const scores={content,form:formScore,spelling,grammar,vocabulary,linguistic,coherence};
  scores.total=Object.values(scores).reduce((a,b)=>a+b,0);
  const evidence=relevance.evidence;
  return {
    version:VERSION,scoringMode:'local',scores,
    promptCoverage:[{requirement:String(question).slice(0,500),status:relevance.ratio>=0.24?'addressed':relevance.ratio>=0.11?'partial':'missing',evidence:relevance.ratio>=0.11?evidence:'',nextStep:relevance.ratio>=0.24?'':'Develop an explicit answer to the question and support it with relevant reasoning.'}],
    feedback:{
      content:content>=5?'The response stays relevant and develops the topic.':'The local scorer found only partial topic coverage; make the answer to the prompt more explicit and develop it.',
      form:count+' words.',
      spelling:'No reliable meaning-changing spelling error was identified by the local fallback.',
      grammar:grammar===2?'No obvious meaning-blocking grammar pattern was detected locally.':'Review basic agreement and verb-form errors.',
      vocabulary:vocabulary===2?'Vocabulary shows useful range.':'Increase precise topic vocabulary and reduce repetition.',
      linguistic:linguistic>=5?'Sentence structure shows useful variety.':'Use a clearer mix of complete simple and complex sentences.',
      coherence:coherence>=5?'Organisation and linking are clear.':'Strengthen paragraph organisation and explicit logical links.'
    },
    errors:[],optionalRefinements:[],templateDetector:'ok',templateNote:'Local fallback does not penalise taught template scaffolding.',templateEvidence:[],
    strengths:['A local score was produced without depending on an external language model.'],
    improvements:scores.total<26?['Use the prompt wording to make every required part explicit.','Develop each main idea with a reason or explanation.','Retry AI feedback later for finer semantic and language comments.']:[],
    overallVerdict:'Local practice estimate generated from prompt relevance, development, structure and language signals.',
    sampleStatus:'unavailable',sampleKind:'unavailable',sampleResponse:'',sampleWordCount:0,sampleSourceIdeas:[],
    sampleNote:'Your local score is ready. The personalised Band 9 sample requires the optional AI reviewer; retry it later if you want that extra feedback.',
    wordCount:count
  };
}
function speaking(q,response) {
  const facts=Array.isArray(q?.facts)?q.facts:[];
  const coverage=ideaCoverage(facts,response);
  const weights=coverage.map(x=>x.status==='covered'?1:x.status==='partial'?0.5:0);
  const ratio=weights.length?weights.reduce((a,b)=>a+b,0)/weights.length:0;
  let total=ratio>=0.85?6:ratio>=0.68?5:ratio>=0.5?4:ratio>=0.34?3:ratio>=0.18?2:ratio>0?1:0;
  if(q?.type==='rts'){
    const goal=promptRelevance(q.text||'',response);
    if(goal.ratio<0.08)total=Math.min(total,2);
    else if(goal.ratio>=0.22)total=Math.max(total,4);
  }
  return {
    version:VERSION,maximum:6,total,assessment:'Content-only local practice estimate',pronunciation:null,fluency:null,
    deliveryStatus:'Teacher review — not assessed by local text scoring',scoringMode:'local',
    overview: total>=5?'The response covers most of the supplied content points. Delivery still needs teacher or audio-based review.':total>=3?'The response covers part of the task, but important content is missing or underdeveloped.':'The response contains limited recoverable task content in the confirmed transcript.',
    strengths:coverage.filter(x=>x.status==='covered').slice(0,3).map(x=>'Covered: '+x.idea),
    improvements:coverage.filter(x=>x.status!=='covered').slice(0,3).map(x=>'Add or clarify: '+x.idea),
    coverage:coverage.map(x=>({point:x.idea,status:x.status,evidence:x.evidence,feedback:x.status==='covered'?'This point is represented in the transcript.':x.status==='partial'?'This point is only partly represented; make it clearer.':'Include this relevant point in your response.'}))
  };
}
module.exports={VERSION,words,concepts,overlap,ideaCoverage,summaryContent,promptRelevance,essay,speaking,obviousGrammarIssues};
