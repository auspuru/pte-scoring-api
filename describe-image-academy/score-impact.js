// Scoring source: auspuru/Describe@e0141316c42516c56692b961a999b90efd848c33 (backend/score-impact.js).
'use strict';

// Detect an explicitly optional rationale, never assign a higher mark.
// A disputed deduction is withheld rather than converted into an invented 6/6.
function onlyPolish(value){
  if(typeof value!=='string')return false;
  const text=value.replace(/\b(?:no|without)\s+(?:extra\s+)?(?:listener\s+)?(?:effort|disruption|contradiction|confusion|error)s?\b/gi,'')
    .replace(/\b(?:does?\s+not|doesn't|do\s+not)\s+(?:obscure|disrupt|change|affect|alter|prevent)\b[^.!?]*/gi,'');
  const polish=/\boptional(?:ly)?\b|\b(?:cosmetic|stylistic)\b|\bcould\s+(?:improve|be\s+improved)\s+(?:slightly|a\s+little)\b|\b(?:more\s+(?:clearly|explicitly|directly|smoothly)|smoother\s+wording)\b/i.test(text);
  const meaningful=/\b(?:wrong|incorrect|inaccurate|contradict\w*|revers\w*|mislead\w*|unintelligible|unclear|obscur\w*|disrupt\w*|fragment\w*|disconnected|confus\w*|missing|misses|omits?|omitted|lacks?|absent|undeveloped|underdeveloped|unexplained|listener\s+effort)\b|\b(?:hard|harder|difficult)\s+to\s+(?:follow|understand|interpret)\b/i.test(text);
  return polish&&!meaningful;
}
function optionalOnlyDeduction(content){
  if(!Number.isInteger(content?.score)||content.score>=6||content.score<4||content.accuracy==='major-errors')return false;
  if((content.evidence||[]).some(e=>e.kind==='inaccurate'))return false;
  const gap=content.scoreImpact;
  // A separately supported meaningful gap takes precedence over an optional tip.
  if(gap&&typeof gap==='object'&&!onlyPolish(gap.observation+' '+gap.impact))return false;
  return onlyPolish(content.reason||'');
}
module.exports={onlyPolish,optionalOnlyDeduction};
