(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReadingFibPatternBank=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const source={
    kind:'original-pattern-derived',
    contentStatus:'original',
    checkedAt:'2026-09-30',
    lastReviewed:'2026-09-30',
    note:'Original IPT Brisbane questions modelled on recurring grammar, collocation, word-form and contextual-vocabulary patterns seen in public PTE prediction files. No third-party passage text is reproduced.',
    references:[
      'https://ptenepal.com/blog/pte-prediction-sep21-27-2026-reading-writing-fib/',
      'https://ptenepal.com/blog/pte-prediction-aug30-sep6-2026-reading-fib/'
    ]
  };

  const dropdownSeeds=[
    {
      id:'ipt-pattern-rw-01',title:'Urban Heat',
      passage:"During summer, dark roofs and paved surfaces absorb large amounts of heat. Replacing some of these surfaces with reflective materials can [[1]] neighbourhood temperatures, but the effect is most [[2]] when the change is combined with shade from trees. Newly planted trees take years to become [[3]], so planners must [[4]] both immediate and long-term measures. Heat is not distributed evenly across a city. Streets with little vegetation often remain warm after sunset, while nearby parks cool more quickly. A useful plan therefore begins with local measurements rather than a single citywide average. Residents can help identify places where waiting for a bus or walking to school becomes uncomfortable. These observations allow limited funding to be directed towards areas where changes are likely to benefit the greatest number of people.",
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
      passage:"A scientific result that cannot be independently [[1]] should be treated with caution. Many journals therefore ask researchers to [[2]] their data and methods so that other teams can [[3]] the analysis. This process does not guarantee agreement, but it can reveal mistakes that might otherwise remain [[4]]. Publishing a conclusion is only one stage in the research process. Readers also need to understand how observations were collected, which cases were excluded and why particular comparisons were made. A detailed record allows later investigators to distinguish a disagreement about interpretation from a difference in procedure. Even when a second study produces a different result, the comparison can improve the original explanation by showing where its conclusions apply and where further evidence is needed.",
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
      passage:"People are more likely to leave their cars at home when public transport is both frequent and [[1]]. A service may run often, but passengers will still avoid it if delays are [[2]] or information is unclear. Improving reliability can encourage commuters to [[3]] modes and may gradually reduce road [[4]]. The whole journey matters to a passenger, not just the time spent on a vehicle. Safe walking routes, clear signs and convenient connections can make a service easier to use. Planners should therefore examine the experience of travelling from home to destination. Asking existing passengers about recurring difficulties provides useful information, but people who have stopped using the service should also be consulted. Their reasons may reveal barriers that regular users have learned to manage.",
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
      passage:"Sleep does more than provide physical rest. During certain stages of sleep, the brain appears to [[1]] newly learned information and connect it with existing knowledge. Students who sleep poorly may remember fewer details, [[2]] they studied for the same amount of time. For this reason, regular sleep can be an important [[3]] of effective learning rather than time [[4]] from it. Learning strategies are often judged by the number of hours spent at a desk. This measure overlooks the conditions under which information is studied and recalled. A learner who takes regular breaks and returns to material over several days may use study time more effectively than someone who works through the night. Keeping a simple record of study sessions can help students notice patterns in their concentration and plan a routine that is easier to sustain.",
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
      passage:"A museum label cannot include every fact known about an object. Curators must decide which details are most [[1]] to the story being told and which can be omitted. A short label should guide attention [[2]] overwhelming the visitor, while still making the source of important claims [[3]]. When evidence is uncertain, that uncertainty should be stated [[4]]. Visitors arrive with different interests and levels of background knowledge. Some want a quick overview, whereas others prefer a detailed account of how an object was made or acquired. Museums can respond by offering several layers of information, including a short introduction and an optional longer explanation. Testing draft labels with visitors can reveal unfamiliar terms or confusing references. The aim is to invite further exploration while allowing each visitor to decide how deeply to engage.",
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
      passage:"Remote work can widen access to jobs for people who live far from major offices, but it also changes how teams [[1]]. Informal questions that once took seconds across a desk may require a message or scheduled call. Managers therefore need to create [[2]] channels for communication and make expectations [[3]], especially when colleagues are working [[4]] different time zones. A successful arrangement requires more than providing staff with laptops. Teams need agreement about when a message requires an immediate response and when a written update is sufficient. Shared records of decisions can prevent colleagues from repeating work or missing important changes. Regular conversations also give employees an opportunity to explain difficulties that are not visible in a progress report. The most useful routines are reviewed periodically as the team and its responsibilities develop.",
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
      passage:"Households often discard food because labels such as \"best before\" and \"use by\" are [[1]] as having the same meaning. In fact, one usually refers to quality while the other may relate to safety. Clearer guidance can help consumers make more [[2]] decisions, store food [[3]], and avoid throwing away products that are still safe to [[4]]. Waste reduction also begins before food reaches the kitchen. Planning meals around ingredients already available can prevent unnecessary purchases, while smaller portions allow households to adjust to changing schedules. Shops can help by displaying storage advice clearly and offering quantities that suit different household sizes. Measuring what is thrown away over a week often reveals a recurring pattern. This practical information can guide changes that are more useful than simply telling consumers to be less wasteful.",
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
      passage:"Learners often understand new vocabulary more easily when they meet it in several contexts rather than in an isolated list. Repeated exposure helps them notice how a word is [[1]] with other words and whether it sounds formal or informal. Teachers can also encourage students to [[2]] meaning from context before checking a dictionary, [[3]] this requires enough surrounding information to make the guess [[4]]. Knowing a dictionary definition does not always mean that a learner can use a word confidently. Words may occur in familiar combinations, take particular prepositions or carry a different tone in different settings. Reading a range of ordinary texts helps make these patterns visible. Learners can record a short example alongside each new word and return to it later. Comparing examples encourages them to treat vocabulary as part of a sentence rather than as a collection of separate labels.",
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
      passage:"Cities facing water shortages cannot rely on a single solution. Repairing leaks may reduce immediate losses, [[1]] long-term planning also requires changes in household use and industrial demand. Pricing can influence behaviour, but essential water must remain [[2]] to low-income households. Policies are more likely to succeed when residents understand why restrictions are introduced and believe they are applied [[3]] rather than [[4]]. Water management involves choices about maintenance as well as new construction. A city may gain little from increasing supply if much of the water is lost before reaching users. Accurate records of consumption can help identify unusual changes and areas that need investigation. Public communication matters too: residents are more likely to cooperate when advice explains both the problem and the purpose of a proposed response. Different neighbourhoods may need different forms of support to make the same policy workable.",
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
      passage:"Online services collect information for many legitimate purposes, including security and personalisation. Problems arise when users do not know what is being collected or how long it will be [[1]]. A clear privacy notice should explain these practices in language that is easy to [[2]]. It should also allow users to make a [[3]] choice about optional tracking rather than assuming that silence means [[4]]. A notice is useful only if people can find and understand it at the point when they need to make a decision. Long documents written in technical language may satisfy a formal requirement while providing little practical guidance. Designers can improve understanding by presenting key choices clearly and placing additional detail nearby. The wording should describe the consequences of each choice. Testing with ordinary users can show whether the explanation communicates what its authors intended.",
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
      passage:"Archaeologists rarely interpret an object in isolation. Its location, surrounding materials and signs of wear may all [[1]] clues about how it was used. A tool found beside a hearth, for example, may have served a different purpose [[2]] an identical object found in a grave. Context therefore helps researchers move [[3]] simple description toward a more [[4]] interpretation of past behaviour. The process of excavation can itself change the evidence that researchers hope to understand. Careful recording is therefore essential before material is moved from its original position. Photographs, drawings and written descriptions preserve relationships that might otherwise be lost. Later specialists may ask questions that the excavation team did not anticipate. A complete record gives them a better chance of evaluating alternative explanations without relying entirely on the first investigator’s judgement.",
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
      passage:"Volunteer organisations depend on enthusiasm, but enthusiasm alone does not guarantee that a project will run [[1]]. New volunteers need clear instructions, appropriate training and someone they can contact when problems [[2]]. Organisations that provide this support are more likely to [[3]] volunteers, because people are willing to continue when their time feels useful and their contribution is [[4]]. People join voluntary projects for different reasons, including friendship, practical experience and a wish to support a cause. A single approach to organising work will not suit everyone. Offering manageable roles and explaining how each task contributes to the wider project can help newcomers find their place. Regular feedback allows organisers to identify problems early. Recognition need not be elaborate, but it should show that the organisation notices the effort people make and respects their other commitments.",
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
      passage:"Before applying for a scholarship, students should check their [[1]] carefully and note the closing [[2]]. Most applications require academic records and other [[3]] documents, which should be uploaded before the form is finally [[4]]. Applicants should allow time to contact referees and check that every attachment can be opened. Saving a draft does not complete the application, so a confirmation message should be retained.",
      answers:['eligibility','deadline','supporting','submitted'],
      bank:['eligibility','deadline','supporting','submitted','permission','temporary','registered']
    },
    {
      id:'ipt-pattern-r-02',title:'Workplace Induction',
      passage:"New employees must [[1]] the induction session before receiving building access. The session explains emergency [[2]], reporting lines and basic security rules. Staff should ask for [[3]] whenever a procedure is unclear and report hazards [[4]]. A short tour helps new staff locate exits and shared facilities. The guide remains available afterwards, allowing employees to check details without relying on memory alone.",
      answers:['attend','procedures','clarification','promptly'],
      bank:['attend','procedures','clarification','promptly','reserve','equipment','private']
    },
    {
      id:'ipt-pattern-r-03',title:'Library Borrowing',
      passage:"Books can usually be [[1]] online unless another reader has already reserved them. Items returned after the due date may attract an [[2]] charge. Students are advised to check availability [[3]] travelling to another campus and to return high-demand material [[4]]. Borrowers can view current loans through their account. Keeping contact details up to date ensures that reminders reach the correct address and helps staff resolve problems quickly.",
      answers:['renewed','overdue','before','promptly'],
      bank:['renewed','overdue','before','promptly','stored','annual','beside']
    },
    {
      id:'ipt-pattern-r-04',title:'Community Garden',
      passage:"Members of the community garden are allocated small [[1]] for growing vegetables and herbs. Each member is expected to [[2]] the area around their plot, while tools and compost are [[3]]. At the end of the season, surplus produce may be [[4]] with local food charities. A seasonal meeting gives members a chance to agree on watering arrangements. Keeping paths clear allows everyone to reach the shared facilities without damaging neighbouring crops.",
      answers:['plots','maintain','shared','donated'],
      bank:['plots','maintain','shared','donated','routes','estimate','private']
    },
    {
      id:'ipt-pattern-r-05',title:'Weather Warning',
      passage:"Heavy rain is [[1]] overnight, and drivers are advised to avoid low-lying roads. Residents should [[2]] loose outdoor items and follow official [[3]] if conditions worsen. Do not enter floodwater, even when it appears [[4]]. Local notices may change as more information becomes available. Households should keep essential contact details accessible and check whether planned journeys can be postponed until conditions improve.",
      answers:['expected','secure','updates','shallow'],
      bank:['expected','secure','updates','shallow','measured','delay','formal']
    },
    {
      id:'ipt-pattern-r-06',title:'Recycling Guide',
      passage:"Food containers should be [[1]] before they are placed in the recycling bin. Paper and cardboard must be kept [[2]], because heavily soiled material can [[3]] an entire load. Collection rules vary between councils, so residents should check which items are [[4]] locally. Keeping a simple guide beside the household bins can prevent mistakes. When a package contains several materials, residents may need to separate its parts before collection.",
      answers:['rinsed','dry','contaminate','accepted'],
      bank:['rinsed','dry','contaminate','accepted','measured','brief','stored']
    },
    {
      id:'ipt-pattern-r-07',title:'University Orientation',
      passage:"Students should [[1]] for orientation before arriving on campus. The program includes a tour, advice on choosing subjects and time to meet academic [[2]]. A copy of the first-week [[3]] is available online, and late arrivals can attend a shorter session [[4]]. Orientation also introduces the services available throughout the year. Meeting other students early can make it easier to ask questions and arrange study groups once classes begin.",
      answers:['register','advisers','timetable','later'],
      bank:['register','advisers','timetable','later','translate','visitors','formal']
    },
    {
      id:'ipt-pattern-r-08',title:'Fitness Study',
      passage:"Participants in the study completed [[1]] exercise three times a week while researchers [[2]] heart rate and sleep. After eight weeks, the group showed small but consistent [[3]] in endurance. The researchers warned that the findings should be interpreted [[4]] because the sample was small. The team recorded attendance to understand how regularly participants followed the program. A longer investigation would be needed before drawing conclusions about people outside this particular group.",
      answers:['moderate','monitored','improvements','cautiously'],
      bank:['moderate','monitored','improvements','cautiously','annual','stored','immediate']
    },
    {
      id:'ipt-pattern-r-09',title:'Hotel Booking',
      passage:"Guests are asked to [[1]] their reservation at least two days before arrival. Some rooms require a small [[2]], which is deducted from the final bill. The cancellation [[3]] depends on the booking type, and a digital [[4]] is sent after payment. Guests should check whether meals and parking are included in the quoted price. Keeping the booking details accessible makes it easier to resolve questions at reception.",
      answers:['confirm','deposit','policy','receipt'],
      bank:['confirm','deposit','policy','receipt','measure','capacity','private']
    },
    {
      id:'ipt-pattern-r-10',title:'Road Safety Notice',
      passage:"Drivers approaching the school zone should reduce speed and watch for [[1]]. Visibility may be poor near parked vehicles, so children can appear [[2]]. A marked [[3]] is located near the main gate, and drivers must stop when the supervisor signals them to [[4]]. Families are encouraged to use the designated entrance rather than crossing between vehicles. Clear arrival routines help reduce crowding and make the area easier for everyone to navigate.",
      answers:['pedestrians','suddenly','crossing','wait'],
      bank:['pedestrians','suddenly','crossing','wait','passengers','annual','record']
    },
    {
      id:'ipt-pattern-r-11',title:'Account Security',
      passage:"Choose a password that is difficult to guess and do not [[1]] it across several services. If a login attempt looks [[2]], the system may ask you to verify your identity. Report unexpected messages [[3]] and change your password [[4]] if you think the account has been compromised. Account alerts should be checked through the service’s usual application. Following an unfamiliar link can expose personal details, even when a message appears to come from a familiar organisation.",
      answers:['reuse','suspicious','immediately','promptly'],
      bank:['reuse','suspicious','immediately','promptly','measure','ordinary','quiet']
    },
    {
      id:'ipt-pattern-r-12',title:'Laboratory Safety',
      passage:"Protective glasses must be worn [[1]] chemicals are being handled. Every container should be clearly [[2]], and waste must be disposed of using the correct procedure. If a spill occurs, students should notify the laboratory [[3]] rather than attempting to clean it [[4]]. Before beginning an activity, students should locate the emergency equipment and read the instructions. Clear preparation allows the group to respond calmly if an unexpected problem interrupts the work.",
      answers:['whenever','labelled','supervisor','alone'],
      bank:['whenever','labelled','supervisor','alone','although','measured','equipment']
    }
  ];

  dropdownSeeds.push(...[
  {
    "id": "ipt-pattern-rw-13",
    "title": "Public Consultation",
    "passage": "Before changing a public space, a council needs to understand how it is used. A survey can [[1]] useful information, but written responses alone may overlook people who find the form difficult. Holding meetings at different times makes participation more [[2]]. Staff should also explain which decisions are still open to discussion. Otherwise, residents may assume that their comments will change matters already settled. After the consultation, a summary should [[3]] the main concerns and describe how they influenced the proposal. This closes the conversation and gives participants a reason to contribute again. Agreement is not always possible, but a transparent process can help maintain [[4]] even when a final decision disappoints some residents.",
    "answers": [
      "provide",
      "accessible",
      "identify",
      "trust"
    ],
    "options": [
      [
        "provide",
        "ignore",
        "remove",
        "provided"
      ],
      [
        "accessible",
        "expensive",
        "temporary",
        "access"
      ],
      [
        "identify",
        "conceal",
        "ignore",
        "identified"
      ],
      [
        "trust",
        "congestion",
        "capacity",
        "trusting"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-14",
    "title": "Repair Workshops",
    "passage": "A community repair workshop brings together people who want to keep everyday objects in use. Experienced volunteers [[1]] visitors through simple repairs rather than taking over every task. This approach allows participants to develop practical [[2]] and understand why an item stopped working. Organisers must decide which repairs can be completed safely with the available tools. Some objects require specialist attention and should be referred elsewhere. A successful session also needs time for discussion, because identifying a fault may involve several possible explanations. Keeping notes about common problems helps volunteers prepare future sessions. Although saving money is an obvious benefit, the workshop can also [[3]] connections between neighbours. Learning together makes repair feel more [[4]] than attempting an unfamiliar task alone.",
    "answers": [
      "guide",
      "skills",
      "strengthen",
      "manageable"
    ],
    "options": [
      [
        "guide",
        "prevent",
        "ignore",
        "guided"
      ],
      [
        "skills",
        "costs",
        "delays",
        "skilled"
      ],
      [
        "strengthen",
        "remove",
        "reduce",
        "strength"
      ],
      [
        "manageable",
        "annual",
        "distant",
        "manage"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-15",
    "title": "Digital Archives",
    "passage": "An archive can make its collections easier to explore by placing selected material online. The first step is to [[1]] objects accurately so that users can find relevant records. A photograph alone may not explain the date, location or purpose of an item. Descriptions should therefore include the available context and make gaps in the evidence [[2]]. Staff also need a consistent way to name files and record changes. Without this structure, a growing collection can become difficult to maintain. Digitisation does not remove the need to care for the original material, but it may [[3]] handling by allowing routine enquiries to be answered remotely. Regular review helps ensure that records remain [[4]] as new information becomes available and the collection develops.",
    "answers": [
      "describe",
      "explicit",
      "reduce",
      "accurate"
    ],
    "options": [
      [
        "describe",
        "discard",
        "remove",
        "described"
      ],
      [
        "explicit",
        "annual",
        "temporary",
        "explicitly"
      ],
      [
        "reduce",
        "increase",
        "ignore",
        "reduction"
      ],
      [
        "accurate",
        "temporary",
        "remote",
        "accurately"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-16",
    "title": "Peer Feedback",
    "passage": "Students often learn from explaining their work to someone else. A peer review activity should give them a clear [[1]] for the discussion, such as the organisation of an argument or the use of examples. Without guidance, comments may remain general and offer little help. Reviewers should point to specific parts of the work and explain the [[2]] of a suggested change. The writer then decides which comments to use and why. This encourages judgement rather than automatic acceptance of every suggestion. Teachers can model a useful response before students begin and allow time for questions. When feedback is respectful and [[3]], learners are more willing to share unfinished ideas. Repeating the activity also helps them become more [[4]] of similar issues in their own writing.",
    "answers": [
      "focus",
      "purpose",
      "constructive",
      "aware"
    ],
    "options": [
      [
        "focus",
        "permission",
        "sequence",
        "focused"
      ],
      [
        "purpose",
        "congestion",
        "capacity",
        "purposely"
      ],
      [
        "constructive",
        "annual",
        "distant",
        "construct"
      ],
      [
        "aware",
        "independent",
        "distant",
        "warily"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-17",
    "title": "Local Markets",
    "passage": "A weekly market can bring more than extra shopping opportunities to a neighbourhood. It gives small producers a place to [[1]] customers directly and hear what they value. Organisers need to consider access, shelter and the movement of visitors between stalls. A crowded layout may make the market look busy while reducing the [[2]] of the shopping experience. Clear signs and shared information can help new visitors find their way. Decisions about stall fees should balance operating costs with the aim of encouraging a varied range of sellers. Collecting regular feedback allows organisers to [[3]] practical problems before they become established. Over time, a dependable schedule helps the market become part of the community’s routine and supports its long-term [[4]].",
    "answers": [
      "reach",
      "quality",
      "address",
      "success"
    ],
    "options": [
      [
        "reach",
        "avoid",
        "ignore",
        "reached"
      ],
      [
        "quality",
        "congestion",
        "quantity",
        "qualified"
      ],
      [
        "address",
        "ignore",
        "create",
        "addressed"
      ],
      [
        "success",
        "permission",
        "congestion",
        "successful"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-18",
    "title": "Accessible Exhibitions",
    "passage": "An exhibition becomes more useful when visitors can engage with it in different ways. Written labels may be [[1]] by spoken descriptions, enlarged images or objects designed to be touched. These features should form part of the initial plan rather than being added after the layout is complete. Staff can learn about barriers by inviting people with different access needs to test the space. Their comments may reveal difficulties that are not [[2]] from a drawing. Simple changes, such as placing seats along a long route, can improve the experience for many visitors. Designers should also keep information easy to locate and instructions [[3]]. Reviewing the exhibition after opening allows the museum to [[4]] its arrangements in response to how the space is actually used.",
    "answers": [
      "supplemented",
      "apparent",
      "consistent",
      "adjust"
    ],
    "options": [
      [
        "supplemented",
        "replaced",
        "concealed",
        "supplement"
      ],
      [
        "apparent",
        "temporary",
        "annual",
        "apparently"
      ],
      [
        "consistent",
        "annual",
        "distant",
        "consistently"
      ],
      [
        "adjust",
        "ignore",
        "remove",
        "adjusted"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-19",
    "title": "Project Handover",
    "passage": "A project can lose momentum when responsibility moves from one team to another. A useful handover should [[1]] the decisions already made and explain the reasons behind them. A list of completed tasks is helpful, but it may not show which questions remain [[2]]. The incoming team also needs to know where documents are stored and who can answer particular enquiries. Arranging a short overlap gives both groups time to discuss details that a written report might miss. Records should be organised so that readers can distinguish current instructions from older versions. This reduces the chance of repeating work or following outdated advice. The purpose is to preserve [[3]] while allowing the new team to make informed changes and manage its responsibilities more [[4]].",
    "answers": [
      "summarise",
      "unresolved",
      "continuity",
      "effectively"
    ],
    "options": [
      [
        "summarise",
        "conceal",
        "discard",
        "summary"
      ],
      [
        "unresolved",
        "concealed",
        "discarded",
        "resolve"
      ],
      [
        "continuity",
        "congestion",
        "permission",
        "continuous"
      ],
      [
        "effectively",
        "rarely",
        "randomly",
        "effective"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-20",
    "title": "Community Libraries",
    "passage": "Small neighbourhood libraries often begin with a shelf of books donated by residents. Their success depends on a shared understanding of how the collection should be [[1]]. If damaged or unsuitable material accumulates, people may stop looking for something to read. A simple review routine keeps the shelves welcoming without making the service difficult to use. Volunteers can also ask neighbours what kinds of books they would like to see. This creates a more [[2]] collection than accepting every donation without question. The location matters: a shelf should be easy to reach and protected from the weather. Clear instructions help newcomers [[3]] in the exchange. When care is shared across several people, the library becomes less [[4]] on the availability of a single organiser.",
    "answers": [
      "maintained",
      "varied",
      "participate",
      "dependent"
    ],
    "options": [
      [
        "maintained",
        "discarded",
        "concealed",
        "maintain"
      ],
      [
        "varied",
        "concealed",
        "discarded",
        "vary"
      ],
      [
        "participate",
        "disappear",
        "hesitate",
        "participated"
      ],
      [
        "dependent",
        "remote",
        "annual",
        "depend"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-21",
    "title": "Survey Design",
    "passage": "A questionnaire may appear straightforward while asking questions that different people interpret differently. Before distributing it widely, researchers should [[1]] a draft with a small group of potential respondents. Asking participants to explain how they understood each question can reveal unclear wording. The order of questions also matters, because an earlier item may [[2]] how a later one is answered. Response choices should cover the likely possibilities without forcing people into a category that does not fit. Long forms can discourage completion, so every item needs a clear purpose. Researchers must balance detail with the [[3]] placed on participants. A carefully revised survey is more likely to produce [[4]] information that addresses the original question rather than merely generating a large number of responses.",
    "answers": [
      "test",
      "influence",
      "burden",
      "useful"
    ],
    "options": [
      [
        "test",
        "conceal",
        "discard",
        "tested"
      ],
      [
        "influence",
        "conceal",
        "remove",
        "influenced"
      ],
      [
        "burden",
        "permission",
        "congestion",
        "quietly"
      ],
      [
        "useful",
        "temporary",
        "distant",
        "use"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-22",
    "title": "Shared Workspaces",
    "passage": "A shared office needs arrangements that support both conversation and concentration. Open seating can [[1]] informal discussion, but constant interruptions may make careful work difficult. Providing quieter areas gives people a choice that suits the task they are doing. Teams should agree on how these spaces are used and make the expectations [[2]] to new members. Booking systems may help when demand is high, though rules should remain simple enough to follow. Managers can learn whether the arrangement is working by asking about specific experiences rather than relying on general satisfaction scores. Small changes to the layout or schedule may [[3]] recurring problems. The aim is to create a workplace that is [[4]] to different needs while still making collaboration convenient.",
    "answers": [
      "encourage",
      "clear",
      "resolve",
      "responsive"
    ],
    "options": [
      [
        "encourage",
        "prevent",
        "ignore",
        "encouragement"
      ],
      [
        "clear",
        "annual",
        "remote",
        "clearly"
      ],
      [
        "resolve",
        "create",
        "ignore",
        "resolved"
      ],
      [
        "responsive",
        "annual",
        "distant",
        "respond"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-23",
    "title": "Walking Routes",
    "passage": "Planning a walking route requires attention to the whole journey. A footpath may be pleasant along most of its length but still contain a crossing that makes it difficult to use. Local observations can [[1]] these gaps more effectively than a map alone. Residents who travel at different times may report different problems, including poor lighting or blocked paths. Planners should compare this feedback with direct inspection and record the [[2]] of each proposed change. Connecting isolated improvements can produce a route that people use more confidently. Clear maintenance responsibilities are also important, because an accessible path can become difficult when vegetation grows across it. Regular review helps [[3]] the benefits of the original work and ensures that the route remains [[4]] as the surrounding neighbourhood changes.",
    "answers": [
      "identify",
      "priority",
      "preserve",
      "usable"
    ],
    "options": [
      [
        "identify",
        "conceal",
        "ignore",
        "identified"
      ],
      [
        "priority",
        "congestion",
        "permission",
        "quietly"
      ],
      [
        "preserve",
        "remove",
        "ignore",
        "preservation"
      ],
      [
        "usable",
        "annual",
        "temporary",
        "use"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  },
  {
    "id": "ipt-pattern-rw-24",
    "title": "Learning Journals",
    "passage": "A learning journal gives students a place to record more than the work they have completed. They can [[1]] on which strategies helped them understand a difficult idea and which created confusion. Short, regular entries are often easier to maintain than a detailed account written at the end of a course. Teachers should explain the purpose clearly so that students do not treat the journal as another test of polished writing. Useful prompts ask for specific examples and encourage connections between activities. Looking back across several entries can reveal [[2]] in the way a learner approaches problems. This information helps students make more [[3]] choices about future study. The journal is most valuable when reflection leads to a practical [[4]] rather than ending with a description of what happened.",
    "answers": [
      "reflect",
      "patterns",
      "informed",
      "adjustment"
    ],
    "options": [
      [
        "reflect",
        "depend",
        "insist",
        "reflected"
      ],
      [
        "patterns",
        "costs",
        "delays",
        "patterned"
      ],
      [
        "informed",
        "annual",
        "remote",
        "inform"
      ],
      [
        "adjustment",
        "permission",
        "congestion",
        "quietly"
      ]
    ],
    "skills": [
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary",
      "grammar + contextual vocabulary"
    ]
  }
]);
  wordbankSeeds.push(...[
  {
    "id": "ipt-pattern-r-13",
    "title": "Public Consultation",
    "passage": "The council invited residents to [[1]] on a proposed park layout. Comments could be submitted online or at a local meeting. A written [[2]] explained the main changes and showed where paths would be placed. Staff grouped similar responses before preparing a final [[3]]. Residents were then told how their suggestions had been considered. Publishing this account made the decision process more [[4]] and helped people understand why some requests were not adopted.",
    "answers": [
      "comment",
      "summary",
      "recommendation",
      "transparent"
    ],
    "bank": [
      "comment",
      "summary",
      "recommendation",
      "transparent",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-14",
    "title": "Repair Workshops",
    "passage": "Visitors to the repair workshop should [[1]] their item in advance. This allows volunteers to check whether suitable tools are available. Participants remain responsible for their belongings and are encouraged to [[2]] in the repair. Some faults cannot be resolved during a single session, so the organiser may suggest another [[3]]. Recording the outcome helps the group plan future events and gives volunteers a useful [[4]] of the most common problems.",
    "answers": [
      "register",
      "participate",
      "service",
      "record"
    ],
    "bank": [
      "register",
      "participate",
      "service",
      "record",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-15",
    "title": "Digital Archives",
    "passage": "The archive provides online [[1]] to selected photographs and letters. Each entry includes a description of the item and its known history. Users can [[2]] the collection by date or subject, although some records contain only limited information. Corrections should be sent to the archive team with supporting [[3]]. Staff review each suggestion before updating a record, ensuring that changes are documented and that the collection remains [[4]] for future users.",
    "answers": [
      "access",
      "search",
      "evidence",
      "reliable"
    ],
    "bank": [
      "access",
      "search",
      "evidence",
      "reliable",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-16",
    "title": "Peer Feedback",
    "passage": "During the workshop, each student will [[1]] a short draft with a partner. Reviewers should read the whole text before making comments and use the supplied [[2]] to guide their response. Suggestions need to refer to specific sentences rather than general impressions. Writers will have time to [[3]] their work afterwards. A final discussion encourages students to explain their decisions and reflect on how the feedback improved the [[4]] of their writing.",
    "answers": [
      "exchange",
      "checklist",
      "revise",
      "clarity"
    ],
    "bank": [
      "exchange",
      "checklist",
      "revise",
      "clarity",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-17",
    "title": "Local Markets",
    "passage": "Stallholders must [[1]] a space before attending the weekly market. The booking form asks for a description of the products and any equipment required. Organisers provide a site [[2]] showing entrances and loading areas. Sellers should arrive early enough to [[3]] their stall before visitors enter. At the end of the day, all materials must be removed so that the square is ready for its usual [[4]] the following morning.",
    "answers": [
      "reserve",
      "plan",
      "prepare",
      "activities"
    ],
    "bank": [
      "reserve",
      "plan",
      "prepare",
      "activities",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-18",
    "title": "Accessible Exhibitions",
    "passage": "Visitors can [[1]] an audio description of the exhibition at reception. Large-print guides are also available, and seats are placed along the main [[2]]. Staff can explain which displays include objects intended for handling. Guests are invited to provide [[3]] about any barriers they encounter. The museum reviews these comments regularly and uses them to make practical [[4]] that help a wider range of people enjoy the collection.",
    "answers": [
      "request",
      "route",
      "feedback",
      "improvements"
    ],
    "bank": [
      "request",
      "route",
      "feedback",
      "improvements",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-19",
    "title": "Project Handover",
    "passage": "Before leaving the project, staff should [[1]] their working records and identify any tasks still in progress. The handover note must include relevant contacts and the latest [[2]] of each document. A brief meeting gives the incoming team an opportunity to ask for [[3]]. Keeping an agreed record of the discussion prevents confusion later and helps ensure that responsibility for each remaining task is clearly [[4]].",
    "answers": [
      "organise",
      "version",
      "clarification",
      "assigned"
    ],
    "bank": [
      "organise",
      "version",
      "clarification",
      "assigned",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-20",
    "title": "Community Libraries",
    "passage": "The neighbourhood library welcomes books that are clean and in good [[1]]. Residents may borrow an item without registering, but should return it or contribute another book when possible. Volunteers [[2]] the shelves each week and remove damaged material. A notice explains the exchange rules and provides a contact for [[3]]. Sharing this responsibility helps keep the collection useful and encourages more residents to become [[4]] in the project.",
    "answers": [
      "condition",
      "inspect",
      "enquiries",
      "involved"
    ],
    "bank": [
      "condition",
      "inspect",
      "enquiries",
      "involved",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-21",
    "title": "Survey Design",
    "passage": "Researchers asked a small group to [[1]] the questionnaire before it was distributed more widely. Participants noted any wording that was difficult to understand. The team used these comments to [[2]] several questions and shorten the form. Each response option was checked for [[3]], helping respondents choose an answer that reflected their experience. This early review reduced confusion and improved the overall [[4]] of the information collected.",
    "answers": [
      "complete",
      "revise",
      "clarity",
      "quality"
    ],
    "bank": [
      "complete",
      "revise",
      "clarity",
      "quality",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-22",
    "title": "Shared Workspaces",
    "passage": "Members should [[1]] a meeting room through the shared calendar. Reservations need to include an end time so that other users can plan their work. Quiet areas are intended for tasks requiring [[2]], while conversations should move to the common space. Any problem with equipment should be reported to the [[3]]. Following these arrangements helps maintain a comfortable environment and ensures that shared facilities remain [[4]] to everyone.",
    "answers": [
      "book",
      "concentration",
      "coordinator",
      "available"
    ],
    "bank": [
      "book",
      "concentration",
      "coordinator",
      "available",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-23",
    "title": "Walking Routes",
    "passage": "The walking group will [[1]] at the library entrance before following a route through the neighbourhood. Participants should wear comfortable shoes and bring water. Volunteers will record any [[2]] that make the path difficult to use, including uneven surfaces and blocked crossings. The findings will be included in a short [[3]] for the council. Comparing observations from several walks helps establish which problems need the most [[4]] attention.",
    "answers": [
      "meet",
      "obstacles",
      "report",
      "urgent"
    ],
    "bank": [
      "meet",
      "obstacles",
      "report",
      "urgent",
      "despite",
      "temporary",
      "measured"
    ]
  },
  {
    "id": "ipt-pattern-r-24",
    "title": "Learning Journals",
    "passage": "Students should make a brief journal [[1]] after each workshop. The aim is to describe one useful idea and one question that remains unanswered. Reviewing earlier notes may help learners [[2]] connections between topics. Tutors will offer prompts, but students can choose examples relevant to their own experience. At the end of the course, the journal provides a useful [[3]] of progress and supports the development of a more effective study [[4]].",
    "answers": [
      "entry",
      "recognise",
      "record",
      "routine"
    ],
    "bank": [
      "entry",
      "recognise",
      "record",
      "routine",
      "despite",
      "temporary",
      "measured"
    ]
  }
]);

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
    version:'original-reading-2026-09-30.1',
    source,
    dropdown:dropdownSeeds.map(dropdown),
    wordbank:wordbankSeeds.map(wordbank)
  };
});