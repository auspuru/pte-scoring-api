(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReadingFibQuality=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='grammar-vocab-2026-09-24.1';

  const set=value=>new Set(value.split('|').map(x=>x.trim()).filter(Boolean));
  const GROUPS={
    noun:set('colleagues|development|dialogue|difference|features|industry|offerings|role|strain|trial|understanding|variation|acceptance|archipelago|arrangements|aspect|biases|composition|disadvantage|interests|journal|marketing|proposals|puzzle|screening|settlements|treatise|solutions|judgement|generations|interaction|memory|clarification|exposure|status|consumption|habitat|process|duties|seasons|novelty|confidence|experience|restrictions|safety|support|effects|bonding|causes|pattern|distances|aqueducts|flow|crops|interventions|responsibility|practice|skills|gardens|wellbeing|fields|needs|trails|scenery|environment|evidence|activity|processes|curriculum|leadership|form|ability|people|display|opportunity|control|stay|groups|standards|burnout|success|system|appointment|property|premium|concentration|lessons|review|problems|management'),
    verb:set('absorb|apply|converge|depend|mitigate|paralyse|produce|reduce|struggle|acknowledges|indicates|adapt|determines|examine|interpret|magnify|retains|stand|prevent|follow|pay|support|strengthen|preserve|illuminate|acquire|occurs|give|vary|maintain|influence|change|create|expand|spread|enable|occur|adapt|apply|creates|turns|encourage|extend|subsidise|distort|understand|reject|provide|avoid|improve|organise|donate|expose|transform|communicate|combines|represent|rebuild|attract|automate|monitor|send|treat|increase|invite|state|decide|remove|disrupt|express|affect|estimate|receive|highlight|attach'),
    adjective:set('Calm|Gentle|appalling|consistent|denser|difficult|emerging|heavier|hot|important|informed|irresistible|mistaken|narrow|obscure|open|recyclable|resilient|revised|tailored|warm|analogous|binding|distinct|fragmented|homogeneous|infallible|interconnected|negligible|regular|transparent|aground|clean|limited|common|hidden|formal|appealing|direct|practical|willing|cyclical|required|stable|efficient|tougher|essential|easy|unexpected|engaging'),
    adverb:set('gradually|necessarily|only|rather|thus far|Specifically|clearly|quickly|effectively|increasingly'),
    gerund:set('addressing|developing|eliminating|extrapolating|focussing|functioning|presenting|replacing|increasing|operating|preserving|waking|changing'),
    past:set('calibrated|came|attracted|brought|enabled|emerged|eroded|scurried|wasted|inherited|recognised|reinforced|understood|consumed|developed|grown|sorted|removed|combined|shared|needed'),
    connector:set('In fact|yet'),
    preposition:set('according to|by|to|with|beside'),
    infinitive:set('to help|to respond'),
    modal:set('can'),
    verbPhrase:set('are to|had to listen|is seen'),
    phrase:set('with reasonable')
  };
  const LABELS={
    noun:'noun',verb:'base or finite verb',adjective:'adjective',adverb:'adverb',
    gerund:'-ing form',past:'past or participle form',connector:'linking expression',
    preposition:'preposition',infinitive:'to-infinitive phrase',modal:'modal verb',
    verbPhrase:'verb phrase',phrase:'phrase'
  };
  const POOLS={
    noun:['boundary','ceremony','device','permission','priority','surface','sequence','identity','capacity','resource','method','location'],
    verb:['calculate','borrow','announce','divide','wander','permit','measure','repair','observe','translate','store','dismiss'],
    adjective:['temporary','silent','legal','remote','domestic','annual','visible','formal','stable','separate','random','urban'],
    adverb:['deliberately','roughly','locally','rarely','strictly','briefly','widely','eventually','quietly','indirectly'],
    gerund:['measuring','borrowing','arranging','observing','dividing','recording','repairing','translating','storing','announcing'],
    past:['measured','borrowed','arranged','observed','divided','recorded','repaired','translated','stored','announced'],
    connector:['however','therefore','meanwhile','instead','similarly','otherwise','consequently','nevertheless'],
    preposition:['during','among','toward','within','without','beside','across','beyond'],
    infinitive:['to measure','to borrow','to divide','to record','to repair','to translate'],
    modal:['should','must','might','would','could'],
    verbPhrase:['was able to','has been','might have','used to be','was expected to'],
    phrase:['with limited','under formal','without any','by several','for certain']
  };
  // Make generated decoys classify according to the pool they come from.
  // The pools intentionally use words that are semantically distant from the
  // target answer; classification here is about grammatical role, not meaning.
  for(const [type,pool] of Object.entries(POOLS)){
    if(!GROUPS[type])GROUPS[type]=new Set();
    for(const value of pool)GROUPS[type].add(value);
  }

  const GRAMMAR_TRAP={
    noun:'adverb',verb:'noun',adjective:'noun',adverb:'adjective',gerund:'adjective',
    past:'noun',connector:'noun',preposition:'adverb',infinitive:'noun',modal:'noun',
    verbPhrase:'noun',phrase:'adverb'
  };

  function hash(value){
    let n=2166136261;
    for(const ch of String(value||'')){n^=ch.charCodeAt(0);n=Math.imul(n,16777619);}
    return n>>>0;
  }
  function normal(value){return String(value||'').trim();}
  function classify(value){
    const answer=normal(value);
    for(const [type,values] of Object.entries(GROUPS))if(values.has(answer))return type;
    const lower=answer.toLowerCase();
    if(/^to\s+\w+/.test(lower))return 'infinitive';
    if(/\s/.test(answer))return 'phrase';
    if(/ly$/.test(lower))return 'adverb';
    if(/ing$/.test(lower))return 'gerund';
    if(/(?:ed|en)$/.test(lower))return 'past';
    if(/(?:ous|ive|ful|less|able|ible|al|ic|ary|ory|ent|ant)$/.test(lower))return 'adjective';
    if(/(?:tion|sion|ment|ness|ity|ship|ance|ence|ism|age|ure)$/.test(lower))return 'noun';
    return 'noun';
  }
  function pick(pool,count,seed,exclude=[]){
    const blocked=new Set(exclude.map(x=>normal(x).toLowerCase()));
    const candidates=(pool||[]).filter(x=>!blocked.has(normal(x).toLowerCase()));
    if(!candidates.length)return [];
    const out=[],start=hash(seed)%candidates.length;
    for(let step=0;step<candidates.length&&out.length<count;step++){
      const value=candidates[(start+step*3)%candidates.length];
      if(!out.includes(value))out.push(value);
    }
    return out;
  }
  function dropdownOptions(answer,seed){
    const type=classify(answer),same=pick(POOLS[type]||POOLS.noun,2,seed+':vocab',[answer]);
    const trapType=GRAMMAR_TRAP[type]||'noun';
    const trap=pick(POOLS[trapType]||POOLS.noun,1,seed+':grammar',[answer,...same])[0];
    return [answer,...same,trap].filter((value,index,all)=>all.indexOf(value)===index).slice(0,4);
  }
  function wordbank(answers,seed){
    const clean=(answers||[]).map(normal).filter(Boolean);
    const decoys=[];
    for(let i=0;i<3;i++){
      const answer=clean[i%Math.max(1,clean.length)]||'';
      const type=classify(answer),candidate=pick(POOLS[type]||POOLS.noun,1,seed+':bank:'+i,[...clean,...decoys])[0];
      if(candidate)decoys.push(candidate);
    }
    if(decoys.length<3)decoys.push(...pick(POOLS.noun,3-decoys.length,seed+':bank:fallback',[...clean,...decoys]));
    return [...clean,...decoys.slice(0,3)];
  }
  function context(passage,index,answer){
    const token='[['+(index+1)+']]',source=String(passage||''),at=source.indexOf(token);
    if(at<0)return answer;
    const before=source.slice(0,at).trim().split(/\s+/).slice(-7).join(' ');
    const after=source.slice(at+token.length).trim().split(/\s+/).slice(0,7).join(' ');
    return [before,answer,after].filter(Boolean).join(' ');
  }
  function explanation(q,answer,index){
    const type=classify(answer),label=LABELS[type]||'word form',sample=context(q.passage,index,answer);
    if(q.type==='dropdown'){
      return 'Grammar first: this position requires a '+label+'. Then use vocabulary and collocation: “'+answer+'” is the natural fit in “'+sample+'”. Two distractors have a usable grammatical form but the wrong meaning/collocation, while one option is a grammar/word-form trap.';
    }
    return 'Use grammar to identify that this blank needs a '+label+', then use vocabulary and collocation to choose “'+answer+'” in “'+sample+'”. The word bank contains other grammatically plausible words, so meaning and natural word combination decide the answer.';
  }
  function strengthen(question,seed){
    const q=JSON.parse(JSON.stringify(question||{}));
    if(!['dropdown','wordbank'].includes(q.type)||!Array.isArray(q.answers)||!q.answers.length)return q;
    const key=String(seed||q.uid||q.id||q.title||'fib');
    if(q.type==='dropdown')q.options=q.answers.map((answer,i)=>dropdownOptions(answer,key+':'+i));
    else q.bank=wordbank(q.answers,key);
    const previous=Array.isArray(q.reasoning?.blanks)?q.reasoning.blanks:[];
    q.reasoning={
      ...(q.reasoning||{}),
      correct:'Read the grammar around each blank first, then use vocabulary, collocation and sentence meaning. The wrong choices are designed to test form and contextual word choice rather than near-synonym guessing. No specialist subject knowledge is required.',
      blanks:q.answers.map((answer,i)=>({
        ...(previous[i]||{}),
        answer,
        skill:'grammar + vocabulary/collocation',
        explanation:explanation(q,answer,i)
      }))
    };
    q.fibQuality={version:VERSION,focus:'grammar-vocabulary',sameFormVocabularyDistractors:true,grammarTrap:q.type==='dropdown'};
    return q;
  }
  function audit(question){
    const q=strengthen(question,'audit:'+(question?.uid||question?.id||'q'));
    if(q.type==='dropdown'){
      return q.options.every((row,i)=>row.length===4&&new Set(row).size===4&&row.includes(q.answers[i])
        &&row.filter(x=>classify(x)===classify(q.answers[i])).length>=3
        &&row.some(x=>classify(x)!==classify(q.answers[i])));
    }
    if(q.type==='wordbank')return q.bank.length===q.answers.length+3&&q.answers.every(a=>q.bank.includes(a))&&new Set(q.bank).size===q.bank.length;
    return true;
  }
  return{VERSION,classify,dropdownOptions,wordbank,strengthen,audit};
});