(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReadingFibPatternBank=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const source={
    kind:'original-pattern-derived',
    contentStatus:'original',
    checkedAt:'2026-09-24',
    lastReviewed:'2026-09-24',
    note:'Original IPT Brisbane questions modelled on recurring grammar, collocation, word-form and contextual-vocabulary patterns seen in public PTE prediction files. No third-party passage text is reproduced.',
    references:[
      'https://ptenepal.com/blog/pte-prediction-sep21-27-2026-reading-writing-fib/',
      'https://ptenepal.com/blog/pte-prediction-aug30-sep6-2026-reading-fib/'
    ]
  };

  const dropdownSeeds=[
    {
      id:'ipt-pattern-rw-01',title:'Urban Heat',
      passage:'During summer, dark roofs and paved surfaces absorb large amounts of heat. Replacing some of these surfaces with reflective materials can [[1]] neighbourhood temperatures, but the effect is most [[2]] when the change is combined with shade from trees. Newly planted trees take years to become [[3]], so planners must [[4]] both immediate and long-term measures.',
      answers:['reduce','noticeable','mature','consider'],
      options:[
        ['reduce','raise','record','reduction'],
        ['noticeable','temporary','annual','noticeably'],
        ['mature','distant','brief','maturity'],
        ['consider','measure','ignore','consideration']
      ],
      skills:['verb collocation','adjective after linking verb','adjective complement','modal + base verb']
    },
    {
      id:'ipt-pattern-rw-02',title:'Research Replication',
      passage:'A scientific result that cannot be independently [[1]] should be treated with caution. Many journals therefore ask researchers to [[2]] their data and methods so that other teams can [[3]] the analysis. This process does not guarantee agreement, but it can reveal mistakes that might otherwise remain [[4]].',
      answers:['replicated','share','reproduce','hidden'],
      options:[
        ['replicated','summarised','delayed','replication'],
        ['share','protect','estimate','sharing'],
        ['reproduce','question','store','reproduction'],
        ['hidden','formal','frequent','hide']
      ],
      skills:['passive participle','ask + object + to-infinitive','modal + base verb','remain + adjective']
    },
    {
      id:'ipt-pattern-rw-03',title:'Public Transport',
      passage:'People are more likely to leave their cars at home when public transport is both frequent and [[1]]. A service may run often, but passengers will still avoid it if delays are [[2]] or information is unclear. Improving reliability can encourage commuters to [[3]] modes and may gradually reduce road [[4]].',
      answers:['reliable','unpredictable','switch','congestion'],
      options:[
        ['reliable','available','temporary','reliably'],
        ['unpredictable','minor','regular','unpredictably'],
        ['switch','compare','delay','switching'],
        ['congestion','capacity','maintenance','congested']
      ],
      skills:['parallel adjective','adjective complement','encourage + object + to-infinitive','noun collocation']
    },
    {
      id:'ipt-pattern-rw-04',title:'Sleep and Memory',
      passage:'Sleep does more than provide physical rest. During certain stages of sleep, the brain appears to [[1]] newly learned information and connect it with existing knowledge. Students who sleep poorly may remember fewer details, [[2]] they studied for the same amount of time. For this reason, regular sleep can be an important [[3]] of effective learning rather than time [[4]] from it.',
      answers:['consolidate','although','component','taken'],
      options:[
        ['consolidate','separate','observe','consolidation'],
        ['although','therefore','unless','during'],
        ['component','sequence','permission','componently'],
        ['taken','created','measured','taking']
      ],
      skills:['verb meaning','contrast connector','noun collocation','past participle']
    },
    {
      id:'ipt-pattern-rw-05',title:'Museum Labels',
      passage:'A museum label cannot include every fact known about an object. Curators must decide which details are most [[1]] to the story being told and which can be omitted. A short label should guide attention [[2]] overwhelming the visitor, while still making the source of important claims [[3]]. When evidence is uncertain, that uncertainty should be stated [[4]].',
      answers:['relevant','without','clear','openly'],
      options:[
        ['relevant','historic','visible','relevance'],
        ['without','during','toward','quietly'],
        ['clear','brief','formal','clearly'],
        ['openly','roughly','rarely','open']
      ],
      skills:['adjective + preposition','preposition + gerund','make + object + adjective','sentence adverb']
    },
    {
      id:'ipt-pattern-rw-06',title:'Remote Work',
      passage:'Remote work can widen access to jobs for people who live far from major offices, but it also changes how teams [[1]]. Informal questions that once took seconds across a desk may require a message or scheduled call. Managers therefore need to create [[2]] channels for communication and make expectations [[3]], especially when colleagues are working [[4]] different time zones.',
      answers:['collaborate','reliable','explicit','across'],
      options:[
        ['collaborate','calculate','reserve','collaboration'],
        ['reliable','occasional','private','reliably'],
        ['explicit','annual','remote','explicitly'],
        ['across','during','beside','widely']
      ],
      skills:['verb meaning','adjective + noun','make + object + adjective','preposition collocation']
    },
    {
      id:'ipt-pattern-rw-07',title:'Food Waste',
      passage:'Households often discard food because labels such as "best before" and "use by" are [[1]] as having the same meaning. In fact, one usually refers to quality while the other may relate to safety. Clearer guidance can help consumers make more [[2]] decisions, store food [[3]], and avoid throwing away products that are still safe to [[4]].',
      answers:['interpreted','informed','properly','eat'],
      options:[
        ['interpreted','printed','purchased','interpretation'],
        ['informed','formal','annual','information'],
        ['properly','locally','rarely','proper'],
        ['eat','store','discard','eating']
      ],
      skills:['passive participle','adjective collocation','adverb modifying verb','safe + to-infinitive']
    },
    {
      id:'ipt-pattern-rw-08',title:'Language Learning',
      passage:'Learners often understand new vocabulary more easily when they meet it in several contexts rather than in an isolated list. Repeated exposure helps them notice how a word is [[1]] with other words and whether it sounds formal or informal. Teachers can also encourage students to [[2]] meaning from context before checking a dictionary, [[3]] this requires enough surrounding information to make the guess [[4]].',
      answers:['combined','infer','provided','reasonable'],
      options:[
        ['combined','listed','translated','combination'],
        ['infer','memorise','repeat','inference'],
        ['provided','although','therefore','during'],
        ['reasonable','visible','temporary','reasonably']
      ],
      skills:['passive collocation','verb + meaning','condition connector','make + noun + adjective']
    },
    {
      id:'ipt-pattern-rw-09',title:'Water Management',
      passage:'Cities facing water shortages cannot rely on a single solution. Repairing leaks may reduce immediate losses, [[1]] long-term planning also requires changes in household use and industrial demand. Pricing can influence behaviour, but essential water must remain [[2]] to low-income households. Policies are more likely to succeed when residents understand why restrictions are introduced and believe they are applied [[3]] rather than [[4]].',
      answers:['while','accessible','fairly','selectively'],
      options:[
        ['while','because','therefore','within'],
        ['accessible','temporary','profitable','access'],
        ['fairly','briefly','locally','fair'],
        ['selectively','equally','openly','selective']
      ],
      skills:['contrast connector','remain + adjective','adverb manner','parallel adverb']
    },
    {
      id:'ipt-pattern-rw-10',title:'Digital Privacy',
      passage:'Online services collect information for many legitimate purposes, including security and personalisation. Problems arise when users do not know what is being collected or how long it will be [[1]]. A clear privacy notice should explain these practices in language that is easy to [[2]]. It should also allow users to make a [[3]] choice about optional tracking rather than assuming that silence means [[4]].',
      answers:['retained','understand','meaningful','consent'],
      options:[
        ['retained','published','measured','retention'],
        ['understand','compare','announce','understanding'],
        ['meaningful','technical','annual','meaningfully'],
        ['consent','permission','access','consenting']
      ],
      skills:['future passive participle','easy + to-infinitive','adjective collocation','noun meaning']
    },
    {
      id:'ipt-pattern-rw-11',title:'Archaeological Evidence',
      passage:'Archaeologists rarely interpret an object in isolation. Its location, surrounding materials and signs of wear may all [[1]] clues about how it was used. A tool found beside a hearth, for example, may have served a different purpose [[2]] an identical object found in a grave. Context therefore helps researchers move [[3]] simple description toward a more [[4]] interpretation of past behaviour.',
      answers:['provide','than','beyond','plausible'],
      options:[
        ['provide','reserve','translate','provision'],
        ['than','with','during','therefore'],
        ['beyond','among','beside','rarely'],
        ['plausible','visible','annual','plausibly']
      ],
      skills:['verb collocation','comparative connector','preposition collocation','adjective meaning']
    },
    {
      id:'ipt-pattern-rw-12',title:'Community Volunteering',
      passage:'Volunteer organisations depend on enthusiasm, but enthusiasm alone does not guarantee that a project will run [[1]]. New volunteers need clear instructions, appropriate training and someone they can contact when problems [[2]]. Organisations that provide this support are more likely to [[3]] volunteers, because people are willing to continue when their time feels useful and their contribution is [[4]].',
      answers:['smoothly','arise','retain','valued'],
      options:[
        ['smoothly','briefly','locally','smooth'],
        ['arise','remain','measure','arising'],
        ['retain','invite','observe','retention'],
        ['valued','recorded','limited','value']
      ],
      skills:['adverb manner','intransitive verb','verb meaning','passive participle']
    }
  ];

  const wordbankSeeds=[
    {
      id:'ipt-pattern-r-01',title:'Scholarship Application',
      passage:'Before applying for a scholarship, students should check their [[1]] carefully and note the closing [[2]]. Most applications require academic records and other [[3]] documents, which should be uploaded before the form is finally [[4]].',
      answers:['eligibility','deadline','supporting','submitted'],
      bank:['eligibility','deadline','supporting','submitted','permission','temporary','registered']
    },
    {
      id:'ipt-pattern-r-02',title:'Workplace Induction',
      passage:'New employees must [[1]] the induction session before receiving building access. The session explains emergency [[2]], reporting lines and basic security rules. Staff should ask for [[3]] whenever a procedure is unclear and report hazards [[4]].',
      answers:['attend','procedures','clarification','promptly'],
      bank:['attend','procedures','clarification','promptly','reserve','equipment','private']
    },
    {
      id:'ipt-pattern-r-03',title:'Library Borrowing',
      passage:'Books can usually be [[1]] online unless another reader has already reserved them. Items returned after the due date may attract an [[2]] charge. Students are advised to check availability [[3]] travelling to another campus and to return high-demand material [[4]].',
      answers:['renewed','overdue','before','promptly'],
      bank:['renewed','overdue','before','promptly','stored','annual','beside']
    },
    {
      id:'ipt-pattern-r-04',title:'Community Garden',
      passage:'Members of the community garden are allocated small [[1]] for growing vegetables and herbs. Each member is expected to [[2]] the area around their plot, while tools and compost are [[3]]. At the end of the season, surplus produce may be [[4]] with local food charities.',
      answers:['plots','maintain','shared','donated'],
      bank:['plots','maintain','shared','donated','routes','estimate','private']
    },
    {
      id:'ipt-pattern-r-05',title:'Weather Warning',
      passage:'Heavy rain is [[1]] overnight, and drivers are advised to avoid low-lying roads. Residents should [[2]] loose outdoor items and follow official [[3]] if conditions worsen. Do not enter floodwater, even when it appears [[4]].',
      answers:['expected','secure','updates','shallow'],
      bank:['expected','secure','updates','shallow','measured','delay','formal']
    },
    {
      id:'ipt-pattern-r-06',title:'Recycling Guide',
      passage:'Food containers should be [[1]] before they are placed in the recycling bin. Paper and cardboard must be kept [[2]], because heavily soiled material can [[3]] an entire load. Collection rules vary between councils, so residents should check which items are [[4]] locally.',
      answers:['rinsed','dry','contaminate','accepted'],
      bank:['rinsed','dry','contaminate','accepted','measured','brief','stored']
    },
    {
      id:'ipt-pattern-r-07',title:'University Orientation',
      passage:'Students should [[1]] for orientation before arriving on campus. The program includes a tour, advice on choosing subjects and time to meet academic [[2]]. A copy of the first-week [[3]] is available online, and late arrivals can attend a shorter session [[4]].',
      answers:['register','advisers','timetable','later'],
      bank:['register','advisers','timetable','later','translate','visitors','formal']
    },
    {
      id:'ipt-pattern-r-08',title:'Fitness Study',
      passage:'Participants in the study completed [[1]] exercise three times a week while researchers [[2]] heart rate and sleep. After eight weeks, the group showed small but consistent [[3]] in endurance. The researchers warned that the findings should be interpreted [[4]] because the sample was small.',
      answers:['moderate','monitored','improvements','cautiously'],
      bank:['moderate','monitored','improvements','cautiously','annual','stored','immediate']
    },
    {
      id:'ipt-pattern-r-09',title:'Hotel Booking',
      passage:'Guests are asked to [[1]] their reservation at least two days before arrival. Some rooms require a small [[2]], which is deducted from the final bill. The cancellation [[3]] depends on the booking type, and a digital [[4]] is sent after payment.',
      answers:['confirm','deposit','policy','receipt'],
      bank:['confirm','deposit','policy','receipt','measure','capacity','private']
    },
    {
      id:'ipt-pattern-r-10',title:'Road Safety Notice',
      passage:'Drivers approaching the school zone should reduce speed and watch for [[1]]. Visibility may be poor near parked vehicles, so children can appear [[2]]. A marked [[3]] is located near the main gate, and drivers must stop when the supervisor signals them to [[4]].',
      answers:['pedestrians','suddenly','crossing','wait'],
      bank:['pedestrians','suddenly','crossing','wait','passengers','annual','record']
    },
    {
      id:'ipt-pattern-r-11',title:'Account Security',
      passage:'Choose a password that is difficult to guess and do not [[1]] it across several services. If a login attempt looks [[2]], the system may ask you to verify your identity. Report unexpected messages [[3]] and change your password [[4]] if you think the account has been compromised.',
      answers:['reuse','suspicious','immediately','promptly'],
      bank:['reuse','suspicious','immediately','promptly','measure','ordinary','quiet']
    },
    {
      id:'ipt-pattern-r-12',title:'Laboratory Safety',
      passage:'Protective glasses must be worn [[1]] chemicals are being handled. Every container should be clearly [[2]], and waste must be disposed of using the correct procedure. If a spill occurs, students should notify the laboratory [[3]] rather than attempting to clean it [[4]].',
      answers:['whenever','labelled','supervisor','alone'],
      bank:['whenever','labelled','supervisor','alone','although','measured','equipment']
    }
  ];

  function dropdown(seed){
    return {
      ...seed,uid:seed.id,type:'dropdown',
      patternBased:true,patternSource:source,
      reasoning:{
        correct:'Use grammar first, then collocation and contextual vocabulary. These original IPT questions follow recurring patterns seen in current public PTE prediction material.',
        blanks:seed.answers.map((answer,i)=>({
          answer,
          skill:seed.skills[i],
          explanation:'Identify the grammar required around blank '+(i+1)+', then choose “'+answer+'” because it completes the natural collocation and meaning of the sentence.'
        }))
      }
    };
  }
  function wordbank(seed){
    return {
      ...seed,uid:seed.id,type:'wordbank',
      patternBased:true,patternSource:source,
      reasoning:{
        correct:'Use the sentence grammar to narrow the word class, then use collocation and meaning to select the best word from the bank.',
        blanks:seed.answers.map((answer,i)=>({
          answer,
          skill:'grammar + contextual vocabulary',
          explanation:'The surrounding grammar narrows the form required for blank '+(i+1)+', and “'+answer+'” gives the natural meaning and collocation.'
        }))
      }
    };
  }

  return {
    version:'prediction-pattern-2026-09-24.1',
    source,
    dropdown:dropdownSeeds.map(dropdown),
    wordbank:wordbankSeeds.map(wordbank)
  };
});