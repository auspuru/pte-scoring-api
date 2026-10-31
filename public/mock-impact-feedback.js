(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MockImpactFeedback=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const VERSION='mock-impact-feedback-2026-10-31.1';
  const clean=value=>typeof value==='string'?value.trim().slice(0,900):'';
  const skillName=key=>key==='overall'?'Overall':key[0].toUpperCase()+key.slice(1);
  const GUIDANCE={
    ra:'Read a short passage aloud, then check your recording for omitted or replaced words.',
    rs:'Listen for meaningful phrases, repeat them in order, then check omitted or replaced words.',
    di:'Describe the main pattern, accurate supporting details and meaningful comparisons.',
    rl:'Note the main message and supporting connections, then retell them as connected ideas.',
    asq:'Practise understanding short questions and giving a concise, accurate answer.',
    sgd:'Note each speaker’s position and explain the important agreements and differences.',
    rts:'Address the listener directly, explain the situation and make an appropriate request.',
    swt:'Combine the main message and essential connections into one complete sentence, then check grammar.',
    essay:'Develop a clear position with relevant reasons and examples, then check sentence structure and spelling.',
    dropdown:'Read around each gap and check grammar, word combinations and meaning.',
    wordbank:'Identify the required word class, then check the phrase and passage meaning.',
    reorder:'Find the opening paragraph, then connect references and adjacent ideas.',
    mcma:'Find evidence for every selected option; incorrect selections can reduce your marks.',
    mcsa:'Identify the passage’s main claim and eliminate choices that change its meaning.',
    sst:'Capture the main message and supporting connections, then check grammar and spelling.',
    lmcma:'Support each selection with what you heard; incorrect selections can reduce your marks.',
    lfi:'Anticipate the missing word from the sentence, then check its exact spelling.',
    hcs:'Match the main message and supporting connections rather than isolated words.',
    lmcsa:'Listen for the answer to the question and check the speaker’s intended meaning.',
    smw:'Use sentence structure and the speaker’s argument to predict the missing ending.',
    hiw:'Follow the transcript while listening and select only words that differ.',
    wfd:'Rebuild the sentence in order, then check every word, ending and spelling.'
  };
  const valid=g=>g&&g.complete===true&&Number.isFinite(g.earned)&&Number.isFinite(g.possible)
    &&g.possible>0&&g.earned>=0&&g.earned<=g.possible;
  function evidence(result, answer) {
    const issue = (Array.isArray(result?.feedbackIssues)?result.feedbackIssues:[]).find(row => row.affectsScore === true && row.evidence?.essayQuote && answer.includes(row.evidence.essayQuote));
    const error = (Array.isArray(result?.errors)?result.errors:[]).find(row => row.phrase && answer.includes(row.phrase));
    const trait=result?.gated?null:Object.keys(result?.scores||{}).filter(key=>Number.isFinite(result.maxima?.[key])&&result.maxima[key]>0&&result.scores[key]<result.maxima[key]&&typeof result.feedback?.[key]==='string').sort((a,b)=>result.scores[a]/result.maxima[a]-result.scores[b]/result.maxima[b])[0];
    return { advice:clean(issue?.suggestedChange || (trait&&result.feedback[trait]) || result?.improvements?.[0] || error?.explanation || result?.feedback?.content),
      strength:clean(result?.strengths?.[0]), quote:clean(issue?.evidence?.essayQuote || error?.phrase) };
  }
  function forLab(a, summary, needsReview, relatedProfiles={}) {
    if (a.status !== 'submitted' || a.kind !== 'mock') return null;
    const key = a.module === 'listening' ? 'listening' : 'writing';
    const groups = summary.byType.map(g => ({ type:g.type,label:g.label,count:g.count,earned:g.total,possible:g.maximum,
      complete:g.marked === g.count && !a.questions.some((q,i) => q.type === g.type && needsReview(a.results?.[i],q)) }));
    // Listening pools native points. Explain the actual displayed result.
    const weights = summary.weighting ? Object.fromEntries(summary.byType.map(g => [g.type,g.weight]))
      : Object.fromEntries(groups.map(g => [g.type,g.possible]));
    const items = a.questions.map((q,i) => {
      const r = a.results?.[i], g = groups.find(g => g.type === q.type);
      return {type:q.type,number:i+1,status:g.complete?'assessed':'pending',total:r?.total,maximum:r?.maximum,
        ...evidence(r,String(a.answers?.[i] || ''))};
    });
    return build({scope:key,groups,profiles:{[key]:{weights}},relatedProfiles,items});
  }
  function build({groups=[],profiles={},items=[],scope='full',relatedProfiles={}}={}){
    const byType=new Map(groups.map(g=>[g.type,g]));
    const routing=Object.keys(relatedProfiles).length?relatedProfiles:profiles;
    function point(row,key,strength=false){
      const g=row.group,related=Object.entries(routing).filter(([skill,p])=>skill!=='overall'&&Object.hasOwn(p.weights||p,g.type)).map(([skill])=>skillName(skill));
      const examples=items.filter(item=>item.type===g.type&&item.status==='assessed'&&Number.isFinite(item.total)&&item.maximum>0&&item.total>=0&&item.total<=item.maximum
        &&(strength?item.total/item.maximum>=.8:item.total<item.maximum)).slice(0,2).map(item=>({
          number:item.number,earned:item.total,possible:item.maximum,
          observation:clean(strength?item.strength:item.advice),quote:strength?'':clean(item.quote)
        }));
      const label=clean(g.label)||g.type;
      return {type:g.type,label,skills:related,
        reason:strength?label+' supported your '+skillName(key)+' result with strong saved performance.'
          :label+' is among the largest areas of lost contribution to your '+skillName(key)+' result.',
        instruction:strength?'Maintain this performance with regular short practice.':GUIDANCE[g.type]||'Review your saved response and the reference answer.',
        examples};
    }
    const sections=Object.entries(profiles).map(([key,profile])=>{
      const weights=profile.weights||profile;
      const entries=Object.entries(weights).filter(([,w])=>w==='<1'||Number.isFinite(w)&&w>0);
      const complete=entries.length>0&&entries.length===Object.keys(weights).length&&entries.every(([type])=>valid(byType.get(type)));
      const rows=entries.flatMap(([type,weight])=>{
        const group=byType.get(type);if(!valid(group))return [];
        const fraction=group.earned/group.possible;
        return [{group,fraction,low:weight==='<1'?0:weight*(1-fraction),high:(weight==='<1'?1:weight)*(1-fraction),support:weight==='<1'?0:weight*fraction}];
      });
      // Unknown published weights remain intervals. Their upper bounds order
      // candidates conservatively; no exact weight or promised gain is invented.
      const gaps=rows.filter(r=>r.fraction<1).sort((a,b)=>b.high-a.high||b.low-a.low||a.group.type.localeCompare(b.group.type));
      const ordered=!gaps.some((row,index)=>index>0&&gaps[index-1].low<row.high);
      const priorities=complete?gaps.slice(0,3).map(row=>point(row,key)):[];
      const strengths=complete?rows.filter(r=>r.fraction>=.8&&r.group.earned>0).sort((a,b)=>b.support-a.support||a.group.type.localeCompare(b.group.type)).slice(0,2).map(row=>point(row,key,true)):[];
      const summary=!complete?'Feedback for '+skillName(key)+' is waiting for verified assessments. Missing assessments are not learning weaknesses.'
        :!priorities.length?'You earned all available marks contributing to '+skillName(key)+' in this mock. Maintain this performance.'
        :'Prioritise '+priorities.map(p=>p.label).join(', ')+'. These priorities reflect both your saved performance and each task’s contribution to '+skillName(key)+'.';
      return {key,label:skillName(key),ordered,status:complete?'complete':'pending',summary,strengths,priorities};
    });
    const primary=sections.find(p=>p.key==='overall')||sections[0];
    return {version:VERSION,status:primary?.status||'pending',scope,
      summary:primary?.summary||'No verified scoring profile is available for this mock.',
      notice:scope==='full'?'Overall and each skill have separate priorities. Integrated tasks can support more than one skill.'
        :'Priorities explain this sectional result. Related skills show where these tasks also contribute; they are not full-test skill scores.',
      profiles:sections,priorities:primary?.priorities||[]};
  }
  return {VERSION,GUIDANCE,build,valid,evidence,forLab};
});
