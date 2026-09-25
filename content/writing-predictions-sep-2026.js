'use strict';

// September 2026 prediction-aligned practice bank.
// Source IDs/titles are drawn from the public PTE Nepal weekly prediction index
// for 21-27 September 2026. Practice passages/transcripts below are original
// adaptations for this portal, not copies of third-party passage text.
const userSst = require('./user-sst-predictions');

const source = {
  provider: 'PTE Nepal',
  week: '21-27 September 2026',
  checkedAt: '2026-09-23',
  lastReviewed: '2026-09-24',
  contentStatus: 'adapted',
  swtUrl: 'https://ptenepal.com/blog/pte-prediction-sep21-27-2026-summarize-written-text/',
  sstUrl: 'https://ptenepal.com/blog/pte-prediction-sep21-27-2026-summarize-spoken-text/',
  wfdUrl: 'https://ptenepal.com/blog/pte-prediction-sep21-27-2026-write-from-dictation/'
};

const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
const sentence = value => clean(value).replace(/[.?!]+$/, '');

function makeSwt(item, index) {
  const text = [...item.notes, swtExtensions[item.sourceId] || ''].map(clean).filter(Boolean).join(' ');
  const sample = swtSamples[item.sourceId];
  if (!sample) throw new Error('Missing teacher-editable SWT sample for source ' + item.sourceId);
  return {
    id: 'pred26-swt-' + String(index + 1).padStart(2, '0'),
    type: 'swt',
    title: item.title,
    minutes: 10,
    text,
    keyPoints: item.notes.slice(0, 4).map(clean),
    sample: clean(sample),
    sampleReview: {
      authoring: 'manual-synthesis',
      automatedValidation: 'required',
      teacherEditable: true,
      humanReview: 'pending'
    },
    editorialReview: {
      standard: 'swt-200-300',
      automatedValidation: 'required',
      humanReview: 'pending'
    },
    predictionSource: { ...source, task: 'swt', sourceId: item.sourceId, sourceTitle: item.title }
  };
}

function sstSample(notes) {
  const selected = notes.slice(0, 3);
  let words = selected.join(' ').trim().split(/\s+/).filter(Boolean).length;
  if (words < 50 && notes[3]) selected.push(notes[3]);
  return sentence(selected[0]) + '; ' + sentence(selected[1]).replace(/^./, c => c.toLowerCase()) +
    '; and ' + selected.slice(2).map(note => sentence(note).replace(/^./, c => c.toLowerCase())).join('; ') + '.';
}

function makeSst(item, index) {
  const text = item.notes.map(clean).join(' ');
  return {
    id: 'pred26-sst-' + String(index + 1).padStart(2, '0'),
    type: 'sst',
    title: item.title,
    topic: item.topic,
    minutes: 10,
    voice: ['nova', 'onyx', 'alloy', 'fable'][index % 4],
    text,
    keyPoints: item.notes.slice(0, 4).map(clean),
    sample: sstSample(item.notes),
    predictionSource: { ...source, task: 'sst', sourceId: item.sourceId, sourceTitle: item.title }
  };
}

const swtSamples = Object.freeze({
  '6000322': 'Archaeological human remains provide rare evidence about diet, disease, migration and living conditions, yet reburial rules protecting cultural and ethical interests can restrict later scientific study, so museums and researchers must balance community respect, preservation and education because improving research methods and future techniques may reveal answers unavailable to current technology.',
  '6000281': 'Rather than relying on one anti-inflammatory food, nutrition research supports balanced eating patterns rich in vegetables, fruit, whole grains, legumes, nuts and unsaturated oils, because repeated choices across meals matter more than seasonality alone and can replace heavily processed foods, refined sugar, salt and saturated fat.',
  '6000195': 'Modern security problems increasingly involve smaller conflicts with armed groups, weak state authority and irregular tactics rather than conventional national armies, and because violence can grow without a clear declaration or front line, creating wider instability while international rules are difficult to enforce where institutions cannot reliably investigate or punish violations, prevention must accompany limited military responses.',
  '6000478': 'Microloans can widen financial participation by giving small enterprises that lack conventional bank access modest capital for equipment, stock or transport, but high repayment pressure, weak planning and unstable income can create stress, so useful programs combine credit with realistic repayment terms and practical cash-flow support.',
  '6000475': 'Darwin developed his ideas about species gradually through observation, travel and comparison of natural evidence, with the Beagle revealing geographical and biological patterns that challenged fixed species, while the controversial argument delayed publication until he had gathered stronger supporting evidence, refined natural selection and discussed his thinking with other scientists.',
  '6000470': 'Future teachers need more than digital-tool skills, so teacher education should connect technology with subject methods and real lesson design, using modelling, worked examples and supervised practice to show how tools can support questioning, collaboration and feedback while keeping pedagogy, rather than software itself, in control.',
  '6000469': 'Electric vehicles reduce local exhaust pollution and offer quiet operation, but their environmental value depends on electricity and battery production, while range, charging time, price and charging stations remain practical concerns; moreover, battery manufacturing requires energy and materials with environmental and supply-chain impacts, so climate benefits grow most when direct emissions fall alongside low-carbon electricity.',
  '6000467': 'The Wright brothers treated flight as a practical engineering problem, combining bicycle repair and mechanical skills with study of balance, control, wing shape and moving air, then using earlier research, gliders and repeated tests to challenge assumptions, while workshop experience helped them create lightweight structures and adjust components as new evidence emerged from each experiment.',
  '6000466': 'Industrial growth and rising consumption are increasing pressure on forests, minerals, fresh water and fossil fuels, and although extraction supports jobs and development, poor management causes pollution, habitat loss and emissions while scarcity raises costs for households and industries and creates competition, so recycling, efficient product design and renewable energy can reduce demand for finite resources.',
  '6000465': 'Cities concentrate employment, education, health services and cultural activities, creating opportunities while high population density can support public transport and efficient services, but rapid urbanisation without enough housing and infrastructure increases congestion, pollution, expensive housing and inequality, so green space, walkable neighbourhoods, reliable transport and mixed housing are essential for improving daily life and reducing road and energy pressure.',
  '6000327': 'Because aircraft need large amounts of energy without heavy fuel systems, aviation is difficult to decarbonise; hydrogen may reduce direct carbon dioxide emissions, but it requires new tanks, airport infrastructure and safety procedures, and engine testing is still needed to evaluate performance and other emissions under real conditions.',
  '6000272': 'Learning is easier when new information connects with existing ideas, experiences and skills, but prior knowledge can also contain incorrect assumptions, so teachers should activate it through questions, review and examples, then identify gaps and make useful links explicit before introducing more difficult material.',
  '6000237': 'A bank overdraft lets a business spend beyond a positive current-account balance within an agreed limit, helping firms manage seasonal cash flow when expenses arrive before customer payments; farms may finance seed, feed and labour before crops or livestock generate income, but because the overdraft can be repayable on demand, delayed sales or unexpected losses can expose the business to serious risk.',
  '6000235': 'The New Woman reflected changing expectations about women’s education, employment, marriage and public life, as writers questioned middle-class women’s economic dependence and argued for careers and property control, while supporters linked independence to education and legal rights and critics feared challenges to family roles; literature and journalism then spread these tensions through fictional characters and new choices.',
  '6000222': 'Complaining can create social connection when people feel understood after sharing a difficult experience, but it becomes unhelpful when groups compete over the worst problems and constant negativity becomes a way to belong; in workplaces and families, repeated negative conversations can shape expectations and make positive comments socially risky, although discussing real frustration can still expose unfair conditions and encourage practical support.',
  '6000213': 'Because house mice have travelled with people for centuries and often settle in new places through food stores, cargo and transport, researchers can compare ancient and modern mouse DNA to trace relationships between regions, using these genetic patterns alongside archaeology when written records or human artefacts are limited.',
  '6000199': 'Solar power converts sunlight into usable energy without exhaust emissions at generation, offering renewable, relatively quiet systems that scale from homes to large plants, but output varies with weather, season and location and therefore needs storage, flexible demand or other generation, while significant upfront installation costs must be weighed against generally lower routine maintenance.',
  '6000183': 'Early modern English coffee houses became social spaces for exchanging news, ideas and business information, helped by low entry costs and shared newspapers, and they evolved into club-like meeting places for professions and interests before changing trade made imported drinks more affordable at home and altered their urban role.'
});

const swtExtensions = Object.freeze({
  '6000322': 'Long-term curation can also allow researchers to revisit earlier interpretations when new evidence or improved analytical methods become available. At the same time, communities may reasonably expect institutions to explain why remains are retained and how decisions are made. The strongest policies therefore avoid treating either scientific access or reburial as an automatic rule, and instead use consultation, documented reasons and periodic review to decide what is appropriate in each case.',
  '6000281': 'This approach also shifts attention from isolated ingredients to everyday habits, portion choices and the overall balance of a person’s diet. A meal pattern can contain many nutritious foods and still be difficult to sustain if it is too restrictive, expensive or disconnected from normal routines. For that reason, practical dietary advice usually works best when it encourages gradual replacement of heavily processed choices with varied whole foods that people can continue eating consistently.',
  '6000195': 'Civilian protection is especially difficult when authority is fragmented and armed actors move between populated areas rather than operating from clearly separated battle lines. This makes intelligence, diplomacy and local institutional capacity important parts of prevention because security agencies need reliable information before violence spreads. Measures that rebuild trust, support lawful policing and reduce incentives for recruitment can therefore complement military responses and help prevent short local crises from developing into persistent regional instability before institutions are overwhelmed by a wider crisis.',
  '6000478': 'The effect of a loan also depends on what the borrower can realistically do with the money and how predictable future income will be. Credit used for productive equipment may create new earning opportunities, whereas borrowing simply to meet repeated shortfalls can deepen financial pressure. Responsible programs therefore need to consider affordability, business conditions and the borrower’s wider circumstances rather than assuming that access to credit alone is evidence of successful development.',
  '6000475': 'The eventual publication of Darwin’s argument also shows the importance of communication in science. Evidence has to be organised into a form that other researchers can examine, challenge and compare with alternative explanations. Scientific influence therefore depends not only on generating an idea but also on showing how observations support it and allowing later work to test its implications. The development of evolutionary theory became a continuing research program rather than a conclusion reached once and for all.',
  '6000470': 'Digital competence is therefore partly a matter of professional judgement. A tool that encourages participation in one class may create distraction or unnecessary complexity in another, so trainees need to evaluate both learning benefits and practical limitations. Planning should consider accessibility, classroom management and the quality of student thinking, not simply whether a device is available. Repeated practice with feedback helps future teachers learn when technology genuinely improves a lesson and when a simpler method would be more effective.',
  '6000469': 'The environmental comparison also changes across locations because electricity systems, driving patterns and vehicle lifetimes are different. A car charged mainly from cleaner generation may offer larger lifetime benefits than one relying on more carbon-intensive electricity, while recycling and battery reuse can influence material impacts after the vehicle leaves service. Transport policy therefore has to consider the full system, including energy supply, vehicle production, charging access and alternatives such as public transport, walking and cycling.',
  '6000467': 'Their method also reduced the risk of treating a failed experiment as a final answer. Each unsuccessful test produced information about what needed to change next, allowing the brothers to refine one part of the machine while preserving useful features elsewhere. This iterative process linked theory with practical craftsmanship. It also demonstrates why reliable measurements matter in engineering: when published assumptions conflict with repeated observations, designers need enough evidence to decide whether the model, the measurement or the physical design should be revised.',
  '6000466': 'Resource efficiency also matters after products have been sold. Goods that are durable, repairable and recyclable can reduce the need for repeated extraction, while wasteful designs shift environmental costs to future production. Policy can influence these choices through standards, pricing and disclosure, but households and firms also respond to convenience and cost. Sustainable resource management therefore requires changes across extraction, manufacturing, consumption and recovery rather than relying on a single technology or asking one group to carry the entire burden.',
  '6000465': 'Planning decisions also shape whether the benefits of urban growth are shared widely. New jobs and services may exist within a city yet remain difficult to reach when transport is unreliable or housing near opportunities is unaffordable. Public space, schools, health services and safe walking routes therefore need to be considered together with commercial development. A city becomes more resilient when growth improves access for existing residents instead of simply increasing land values or pushing lower-income households farther from essential services.',
  '6000327': 'Producing hydrogen is another part of the challenge because the climate outcome depends on the energy used to make the fuel. Large-scale adoption would also require reliable supply chains, training and standards so that airports can handle hydrogen safely and consistently. These requirements mean that demonstrations and prototypes are useful but not sufficient evidence on their own. The technology has to prove that it can operate efficiently at realistic scale while fitting into a broader aviation system that includes other low-carbon options.',
  '6000272': 'The quality of prior knowledge matters as much as the amount a learner possesses. Familiar ideas can accelerate understanding when they are accurate, but they can also make misconceptions feel convincing because the new material is interpreted through an incorrect framework. Effective lessons therefore give students chances to explain their reasoning, compare examples and revise earlier assumptions. This process turns existing knowledge into something that can be tested and reorganised rather than treating it as a fixed collection of facts that simply needs to be recalled.',
  '6000237': 'Because the balance can move up and down with daily transactions, an overdraft is flexible in a way that a fixed loan may not be. That flexibility can be useful when the timing of payments is uncertain, but it can also hide a persistent shortage of working capital if the account rarely returns to credit. Managers therefore need to distinguish between a temporary cash-flow gap and a deeper financial problem, since repeated dependence on short-term borrowing may require changes to costs, pricing or longer-term finance.',
  '6000235': 'Debate about the New Woman also showed that cultural change does not happen uniformly. Greater educational or professional opportunity for some women did not remove barriers faced by everyone, and public discussion often reflected the assumptions of particular social groups. The image was therefore both a symbol of possibility and a source of controversy. Studying the term helps historians see how legal reform, economic independence and representations in popular culture interacted while expectations about gender were being questioned and renegotiated.',
  '6000222': 'The effect of a complaint often depends on what happens after it is expressed. Naming a problem can be constructive when listeners help clarify the issue, identify what can be changed and agree on a next step. By contrast, repeating the same frustration without new information may strengthen a negative group identity and discourage people from noticing workable improvements. Productive conversations therefore combine emotional acknowledgement with proportion, evidence and action, allowing people to feel heard without making dissatisfaction the only shared language of the group.',
  '6000213': 'Researchers gain the strongest evidence when mouse genetics are compared with independent archaeological or historical information. A matching pattern can strengthen an interpretation of contact between places, whereas a mismatch may reveal later trade, repeated introductions or gaps in the surviving record. The approach is therefore most useful as one line of evidence among several. It illustrates a broader principle in historical research: indirect biological traces can answer questions about human activity when they are interpreted carefully and their limitations are made explicit.',
  '6000199': 'The value of solar generation also depends on how well it is integrated with demand. Electricity produced in the middle of a sunny day is more useful when homes, businesses or storage systems can use or shift that energy, while modern grids need to manage periods when output falls quickly. Planning therefore involves more than installing panels. It includes forecasting, network investment, storage, efficient appliances and market rules that help different sources work together while maintaining reliable supply throughout changing weather and seasons.',
  '6000183': 'These social spaces also show how a commercial product can influence patterns of communication. The drink itself mattered, but so did the routines that developed around purchasing it, reading shared information and meeting particular groups of people. As consumption moved increasingly into private homes, some of those functions changed or migrated elsewhere. The history of tea and coffee therefore provides a wider example of how trade, price, fashion and social institutions interact, with everyday habits reflecting broader economic and cultural changes over time.'
});

const swtSeeds = [
  { sourceId:'6000322', title:'Compulsory Reburial', notes:[
    'Archaeological human remains can provide evidence about diet, disease, migration and living conditions that is difficult to recover from other material.',
    'Rules that require remains to be reburied after a short period can protect cultural and ethical interests, but they can also restrict later scientific study.',
    'The difficulty is that research methods continue to improve, so future techniques may answer questions that cannot be investigated with current technology.',
    'Museums and researchers therefore have to balance respect for communities with preservation, education and the long-term value of carefully curated collections.',
    'A transparent policy should explain who is consulted, how remains are stored, when reburial is appropriate and whether exceptional research access can continue.',
    'The broader debate shows that responsible archaeology depends on both ethical treatment of people from the past and thoughtful protection of evidence for future generations.'
  ]},
  { sourceId:'6000281', title:'Anti-inflammatory Food', notes:[
    'Nutrition researchers increasingly focus on overall eating patterns rather than treating one food as a simple cure for inflammation.',
    'Diets rich in vegetables, fruit, whole grains, legumes, nuts and unsaturated oils tend to provide fibre and nutrients while limiting heavily processed foods.',
    'Seasonal produce can be useful because it is often fresh and varied, although seasonality itself does not automatically make a food anti-inflammatory.',
    'What matters most is the repeated combination of foods across meals and the extent to which the diet replaces excess refined sugar, salt and saturated fat.',
    'Individual needs still differ, so people with medical conditions or allergies may need professional advice rather than copying a general menu.',
    'The practical message is to build a balanced pattern that can be maintained over time instead of searching for one fashionable ingredient.'
  ]},
  { sourceId:'6000195', title:'Mini War', notes:[
    'Modern security problems do not always resemble conventional wars fought openly between organised national armies.',
    'Smaller conflicts may involve armed groups, weak state authority, irregular tactics and attacks that blur the boundary between military and civilian spaces.',
    'Because these conflicts can develop without a clear declaration or front line, governments may receive little warning before local violence creates wider instability.',
    'International rules remain important, yet enforcement becomes difficult when groups operate in territories where institutions cannot reliably investigate or punish violations.',
    'Responses based only on military force may therefore miss political, economic and social conditions that allow violence to continue.',
    'Effective security policy needs prevention, functioning institutions, cooperation across borders and protection of civilians alongside carefully limited use of force.'
  ]},
  { sourceId:'6000478', title:'Microloan', notes:[
    'Microloans provide relatively small amounts of finance to people or businesses that may not qualify for conventional bank lending.',
    'For a small enterprise, access to modest capital can support equipment purchases, stock, transport or other investments that increase earning capacity.',
    'Such lending can widen financial participation, especially for borrowers who lack property, a long credit history or easy access to formal banking.',
    'However, small loans are not automatically beneficial because high repayment pressure, weak business planning or unstable income can still create serious financial stress.',
    'Programs are more useful when credit is combined with clear information, realistic repayment schedules and practical support for managing cash flow.',
    'Microfinance should therefore be judged by whether it strengthens sustainable livelihoods rather than simply by the number of loans that are issued.'
  ]},
  { sourceId:'6000475', title:'Origin of Species', notes:[
    'Charles Darwin developed his ideas about species gradually after years of observation, travel, reading and comparison of evidence from the natural world.',
    'His voyage on the Beagle exposed him to geographical patterns and biological differences that challenged the belief that species were completely fixed.',
    'Darwin did not publish immediately because he understood that the argument was controversial and believed it required a much stronger body of supporting evidence.',
    'Over the following years he refined the concept of natural selection and discussed parts of his thinking with other scientists before presenting it widely.',
    'When On the Origin of Species appeared in 1859, it attracted intense scientific and public debate while also influencing later research across biology.',
    'The history of the book illustrates how major scientific theories often emerge through sustained evidence gathering rather than a single sudden discovery.'
  ]},
  { sourceId:'6000470', title:'Pre-service Teachers', notes:[
    'Future teachers need more than the ability to operate digital tools because classroom technology is useful only when it supports a clear learning purpose.',
    'Teacher education programs can connect technology courses with subject methods so trainees practise choosing tools for real lessons rather than learning software in isolation.',
    'A common difficulty is that trainees may understand a device or application but still struggle to design activities that help students think about subject content.',
    'Worked examples, modelling and supervised teaching practice can show how technology changes questioning, collaboration, feedback and the organisation of a lesson.',
    'Trainees also need opportunities to reflect on what worked, what distracted learners and how an activity could be adapted for different classes.',
    'The aim is therefore thoughtful integration in which pedagogy leads the choice of technology instead of technology determining the lesson.'
  ]},
  { sourceId:'6000469', title:'Electric Cars', notes:[
    'Electric vehicles offer quiet operation and can reduce local exhaust pollution, but their overall environmental value depends on how electricity and batteries are produced.',
    'Range, charging time, purchase price and access to reliable charging stations remain practical concerns for drivers considering a switch from conventional cars.',
    'Battery technology has improved substantially, yet manufacturing still requires energy and materials that have environmental and supply-chain impacts.',
    'Electric cars produce fewer direct emissions on the road, while the climate benefit becomes larger when the electricity system also shifts toward low-carbon generation.',
    'Public policy can support the transition through charging infrastructure, recycling standards, cleaner power and transport planning that reduces unnecessary car travel.',
    'The long-term goal is not simply to replace every engine but to create a transport system that is cleaner, efficient and convenient.'
  ]},
  { sourceId:'6000467', title:'Wright Brothers', notes:[
    'The Wright brothers approached flight as a practical engineering problem and drew on skills developed through bicycle repair, mechanical work and careful experimentation.',
    'Rather than relying only on powerful engines, they studied balance, control, wing shape and the behaviour of machines in moving air.',
    'They read earlier research, built gliders and used repeated tests to identify weaknesses in existing assumptions about lift and control.',
    'Their workshop experience helped them create lightweight structures and adjust components precisely as new evidence emerged from each experiment.',
    'Progress depended on combining published knowledge with measurements from their own trials instead of accepting earlier figures without question.',
    'Their success shows how innovation often comes from systematic testing, interdisciplinary skills and willingness to revise a design after failure.'
  ]},
  { sourceId:'6000466', title:'Natural Resources', notes:[
    'Industrial growth and rising consumption have increased pressure on forests, minerals, fresh water and fossil fuels in many parts of the world.',
    'Extracting these resources can support jobs and development, but poorly managed production may also cause pollution, habitat loss, soil damage and greenhouse emissions.',
    'Scarcity can raise costs for households and industries while creating competition between regions that depend on the same limited materials.',
    'Recycling, efficient product design and renewable energy can reduce demand for some finite resources without requiring societies to stop economic activity altogether.',
    'Governments and businesses also need better monitoring so environmental costs are considered when investment and production decisions are made.',
    'Long-term resource security depends on using materials more efficiently and protecting natural systems that cannot easily be restored once damaged.'
  ]},
  { sourceId:'6000465', title:'City Life', notes:[
    'Cities concentrate employment, education, health services and cultural activities, which can create opportunities that are difficult to provide in dispersed settlements.',
    'High population density can also support public transport and efficient services, but only when housing and infrastructure keep pace with growth.',
    'Rapid urbanisation may increase congestion, pollution, expensive housing and inequality when planning fails to protect access to essential services.',
    'Green space, walkable neighbourhoods, reliable transport and mixed housing can improve daily life while reducing pressure on roads and energy use.',
    'Successful urban policy therefore has to consider inclusion as well as economic growth, because residents experience a city differently according to income and location.',
    'A liveable city is one that combines opportunity with affordable services, environmental quality and public spaces that people can use safely.'
  ]},
  { sourceId:'6000327', title:'Hydrogen-powered Flight', notes:[
    'Aviation is difficult to decarbonise because aircraft need large amounts of energy while also keeping fuel systems light enough for efficient flight.',
    'Hydrogen could reduce direct carbon dioxide emissions in some aircraft, but storing the fuel requires new tanks, airport systems and safety procedures.',
    'Engine tests are important because hydrogen combustion can still produce other emissions and because performance changes under real operating conditions.',
    'Battery aircraft may suit shorter journeys, while sustainable fuels and hydrogen could play different roles across regional and long-distance routes.',
    'The transition will require aircraft manufacturers, airports, energy suppliers and regulators to develop compatible infrastructure rather than changing one component alone.',
    'Hydrogen is therefore a promising option, but its value will depend on clean production, technical reliability and evidence from full-scale testing.'
  ]},
  { sourceId:'6000272', title:'Prior Knowledge', notes:[
    'Learning becomes easier when new information can be connected to ideas, experiences and skills that a learner already understands.',
    'Prior knowledge helps people interpret unfamiliar material, but incorrect assumptions can also lead them to misunderstand a new concept.',
    'Teachers often begin a topic by asking questions, reviewing earlier lessons or using examples that reveal what students already know.',
    'This activation process allows the teacher to make useful links explicit and to identify gaps that need clarification before more difficult material is introduced.',
    'Students benefit when they explain connections in their own words rather than simply being told that two topics are related.',
    'Effective teaching therefore treats prior knowledge as a starting point to examine and organise, not as a guarantee that existing understanding is complete.'
  ]},
  { sourceId:'6000237', title:'Bank Overdraft', notes:[
    'A bank overdraft allows a business to spend beyond the positive balance in its current account up to an agreed limit.',
    'This flexibility can be useful for firms with seasonal cash flow because expenses may occur weeks or months before customers pay for goods and services.',
    'Farm businesses are a common example, since seed, feed and labour may need financing before crops or livestock generate income.',
    'The main risk is that an overdraft can be repayable on demand, leaving a business exposed when sales are delayed or an unexpected loss reduces cash inflow.',
    'Interest rates may also change, making the cost of borrowing harder to predict than a fixed repayment schedule.',
    'An overdraft can therefore solve short-term timing problems, but managers still need cash-flow planning and a realistic strategy for repayment.'
  ]},
  { sourceId:'6000235', title:'New Women', notes:[
    'The idea of the New Woman emerged during debates about changing expectations for women in education, employment, marriage and public life.',
    'Writers used the concept to question whether middle-class women should remain economically dependent or have greater freedom to build careers and control property.',
    'Supporters connected independence with wider access to education and legal rights, while critics feared that established family and social roles were being challenged.',
    'Literature and journalism helped spread the debate because fictional characters could represent new choices and the tensions surrounding them.',
    'The term did not describe one single type of woman, and its meaning changed according to the political and cultural views of those using it.',
    'The discussion remains historically important because it reveals how social change is argued through both practical reforms and changing public images.'
  ]},
  { sourceId:'6000222', title:'Human Complaints', notes:[
    'Complaining can create social connection because people often feel understood when another person listens to a difficult experience.',
    'The same behaviour can become unhelpful when groups compete to describe the worst problem or treat constant negativity as the main way to belong.',
    'In workplaces and families, repeated negative conversations may shape expectations and make positive comments seem unusual or even socially risky.',
    'This does not mean people should ignore real problems, since discussing frustration can identify unfair conditions and encourage practical support.',
    'The important distinction is between problem-focused discussion that leads somewhere and habitual complaint that reinforces helplessness without action.',
    'Healthy groups make room for difficulties while also recognising progress, solutions and experiences that are going well.'
  ]},
  { sourceId:'6000213', title:'House Mice', notes:[
    'House mice have travelled with people for centuries, making their genetic patterns useful evidence for studying historical human movement.',
    'Because mice can hide in food stores, cargo and transport, populations often become established in new places soon after human settlement expands there.',
    'Researchers compare ancient and modern DNA to identify relationships between mouse populations from different regions and time periods.',
    'These biological clues can complement archaeological evidence where written records or human artefacts are limited or difficult to interpret.',
    'The method has limits because animal movement is not a perfect copy of human migration and later trade can mix previously separate populations.',
    'Even so, combining genetics with archaeology can reveal routes of contact and settlement that would be difficult to reconstruct from one source alone.'
  ]},
  { sourceId:'6000199', title:'Solar Energy', notes:[
    'Solar power converts sunlight into usable energy without producing exhaust emissions at the point where electricity is generated.',
    'Its main advantages are a renewable energy source, relatively quiet operation and the ability to install systems at scales ranging from homes to large power plants.',
    'Output varies with weather, season and location, so electricity systems need storage, flexible demand or other generation when sunlight is limited.',
    'Upfront installation costs can be significant even though routine maintenance is often lower than for machines with many moving parts.',
    'Manufacturing panels also uses materials and energy, which means recycling and responsible supply chains matter as the industry grows.',
    'Solar energy is most effective as part of a broader clean-energy system that combines generation, storage, efficient buildings and modern electricity networks.'
  ]},
  { sourceId:'6000183', title:'Tea and Coffee Drinkers', notes:[
    'Coffee houses became important social spaces in early modern England because customers came not only to drink but also to exchange news, ideas and business information.',
    'Their low entry cost and shared newspapers helped create places where people from particular professions or interests could meet regularly.',
    'These venues gradually developed identities similar to clubs, with customers choosing locations where they expected to find useful contacts and familiar discussion.',
    'Changes in trade later made imported drinks more affordable at home and altered the role that coffee houses played in daily urban life.',
    'Tea also became deeply associated with British habits, showing that national food and drink traditions can change considerably over time.',
    'The history of these beverages demonstrates how consumption, commerce and social interaction can shape one another.'
  ]}
];

const sstSeeds = [
  {sourceId:'13000624', title:'Innovation and Uniqueness', topic:'Business', notes:[
    'A strong business idea is rarely created from nothing; it usually combines existing knowledge in a way that solves a problem more effectively.',
    'Novelty matters, but usefulness matters as well, because an unusual idea has little value if it does not improve an experience, product or process.',
    'Entrepreneurs should therefore test whether customers understand the idea, whether it can be delivered reliably and whether competitors can copy it easily.',
    'Innovation continues after launch as feedback reveals weaknesses and new possibilities.',
    'The central lesson is that uniqueness comes from purposeful improvement and execution, not simply from being different.'
  ]},
  {sourceId:'13000686', title:'Management', topic:'Business', notes:[
    'Managers work under time pressure, but continuing education can broaden the perspectives they bring to difficult decisions.',
    'Reading outside a narrow professional field exposes leaders to different ways of thinking about people, markets and organisations.',
    'Formal study is valuable when it helps a manager connect experience with concepts such as strategy, motivation, ethics and organisational design.',
    'Experience alone can produce habits that work in one situation but fail in another.',
    'Effective managers keep learning so they can explain their decisions, adapt methods and lead teams with a wider understanding of the organisation.'
  ]},
  {sourceId:'13000685', title:'Emotions', topic:'Psychology', notes:[
    'People differ in how strongly their moods change, with some experiencing sharp emotional swings and others remaining comparatively steady.',
    'Emotional health does not require constant excitement because a calm sense of satisfaction can be more sustainable than repeated extreme highs.',
    'A moderate level of challenge can support attention and growth, while excessive stress may reduce judgement and well-being.',
    'Contentment also does not mean passivity; it can coexist with ambition and effort.',
    'The useful goal is emotional balance, where people can respond to problems without being controlled by every temporary feeling.'
  ]},
  {sourceId:'13000684', title:'Defining Need', topic:'Language and society', notes:[
    'The word need can describe very different things depending on context, from a strong personal desire to an essential condition for survival or function.',
    'Saying that someone needs a holiday expresses preference differently from saying that a plant needs water.',
    'Social policy adds another layer because communities debate which goods and services should count as basic needs.',
    'Psychological needs such as belonging and recognition can also influence behaviour even though they are not physical necessities.',
    'Clear communication therefore requires speakers to identify which meaning of need they are using instead of assuming the word is self-explanatory.'
  ]},
  {sourceId:'13000683', title:'Produce Hygiene', topic:'Health', notes:[
    'Washing fresh produce can remove soil and reduce some surface contamination before food is eaten or prepared.',
    'Running water is usually appropriate, while firm produce can be cleaned with a brush that is kept for food use.',
    'Pre-washed packaged greens may not need another wash if the label says they are ready to eat, because extra handling can introduce contamination.',
    'Cleaning the sink, hands and utensils is just as important as rinsing the food itself.',
    'Good produce hygiene is therefore a simple routine that combines clean water, clean equipment and attention to package instructions.'
  ]},
  {sourceId:'13000677', title:'Science and Human Values', topic:'Science and ethics', notes:[
    'Scientific research can explain what is possible, but evidence alone does not decide how every discovery should be used.',
    'Choices about medicine, artificial intelligence, genetics and the environment involve values such as fairness, privacy, responsibility and harm.',
    'Ethical debate should be informed by accurate science so that decisions are not based on fear or misinformation.',
    'At the same time, technical experts need to hear from communities affected by the consequences of new technologies.',
    'Responsible progress combines reliable evidence with transparent discussion about the human purposes that innovation is meant to serve.'
  ]},
  {sourceId:'13000675', title:'Threatening with Losses', topic:'Behavioural psychology', notes:[
    'People often react more strongly to the possibility of losing something they already have than to an equally sized potential gain.',
    'This tendency, commonly described as loss aversion, can influence decisions about money, health and personal goals.',
    'Messages framed around avoiding a loss may therefore attract more attention than messages promising a future benefit.',
    'However, communicators should not exaggerate threats because fear-based messages can become manipulative or reduce trust.',
    'Understanding loss aversion is most useful when it helps people notice how framing affects judgement and make more deliberate choices.'
  ]},
  {sourceId:'13000674', title:'Shifting Economic Priorities', topic:'Economics', notes:[
    'An economy built heavily around private cars can create jobs and mobility while also encouraging congestion, fuel use and dispersed urban development.',
    'Diversifying investment toward public transport, renewable energy and efficient urban infrastructure can create different industries and employment opportunities.',
    'The transition is not immediate because workers, businesses and communities depend on existing supply chains.',
    'Policy needs to support retraining and new investment while improving alternatives that people can actually use.',
    'Changing economic priorities works best when environmental goals are linked with practical plans for employment, transport and regional development.'
  ]},
  {sourceId:'13000673', title:'Railway Cards', topic:'Transport', notes:[
    'Rail travel cards can make frequent journeys cheaper and reduce the time passengers spend purchasing individual tickets.',
    'Different schemes may target students, older travellers, commuters or families, so the value depends on a passenger’s actual pattern of travel.',
    'Some cards provide discounts while others work as prepaid or subscription products.',
    'Travellers should compare eligibility rules, peak-hour limits and the number of trips required before the card becomes economical.',
    'The main advantage is convenience, but a travel card is useful only when its conditions match the way the passenger normally travels.'
  ]},
  {sourceId:'13000672', title:'Recruitment Types', topic:'Human resources', notes:[
    'Organisations can fill vacancies by recruiting internally or by searching for candidates outside the existing workforce.',
    'Internal recruitment can reward employees, reduce induction time and use knowledge the organisation already has.',
    'External recruitment can widen the talent pool and bring skills or perspectives that are not available inside the company.',
    'Both methods have costs, and relying on only one approach can limit fairness or flexibility.',
    'A sound recruitment strategy chooses the method that fits the role while using transparent criteria to compare candidates consistently.'
  ]},
  {sourceId:'13000671', title:'Computers', topic:'Technology', notes:[
    'Computers support communication, analysis, record keeping and automated tasks across education, health, business and many other fields.',
    'Their speed and storage capacity can improve productivity, but greater dependence on digital systems also creates risks.',
    'Cybersecurity failures, unequal access and loss of basic manual processes can become serious problems when organisations digitise without planning.',
    'People still need judgement to decide what data means and whether an automated result is appropriate.',
    'The value of computers therefore comes from combining technical capability with responsible design, security and human oversight.'
  ]},
  {sourceId:'13000669', title:'New Employee Orientation', topic:'Workplace learning', notes:[
    'Orientation helps new employees understand how an organisation works before they are expected to perform independently.',
    'A useful program explains responsibilities, safety, workplace policies, communication channels and where to obtain technical or personal support.',
    'Meeting colleagues and managers early can reduce uncertainty and help newcomers understand how their role connects with the wider team.',
    'Too much information in one session is easily forgotten, so important guidance should remain accessible afterwards.',
    'Effective orientation is a process of integration rather than a single presentation on the employee’s first day.'
  ]},
  {sourceId:'13000668', title:"Travel's Overrated Value", topic:'Society', notes:[
    'Travel can broaden experience, but distance alone does not guarantee learning or personal growth.',
    'People can pass through many places without reflecting on culture, history or the lives of local residents.',
    'Meaningful learning can also happen through local communities, books, digital resources and sustained contact with people from different backgrounds.',
    'Tourism may bring economic benefits while also increasing emissions, crowding and pressure on local traditions.',
    'The value of travel depends less on how far someone goes than on the attention, respect and reflection they bring to the experience.'
  ]},
  {sourceId:'13000667', title:'Information Technology', topic:'Technology', notes:[
    'Information technology allows organisations to store, process and exchange data at a scale that has transformed work and public services.',
    'Digital systems can improve access to education, healthcare and communication across long distances.',
    'The same systems create responsibilities around privacy, cybersecurity, reliability and unequal access.',
    'Organisations need clear rules for who can use data and how failures are detected and corrected.',
    'Technology creates the greatest benefit when convenience and innovation are matched by security, accountability and support for users.'
  ]},
  {sourceId:'13000616', title:'Paper Rejection', topic:'Academic research', notes:[
    'Rejection is common in academic publishing and can be especially discouraging for researchers at the beginning of their careers.',
    'A rejected paper is not always worthless because reviewers may identify weak evidence, unclear argument or missing literature that can be improved.',
    'Researchers should separate useful criticism from comments that are less relevant to the goals of the study.',
    'Revising carefully before sending the work to another journal can strengthen both the paper and the author’s future research practice.',
    'Persistence matters, but so does learning from feedback rather than submitting the same unchanged manuscript repeatedly.'
  ]},
  {sourceId:'13000523', title:'Journalism and Internet', topic:'Media', notes:[
    'Online journalism can combine written reporting with photographs, audio, video and links to background material in a single story.',
    'Digital tools also make research faster because reporters can search documents, contact sources and check earlier coverage quickly.',
    'At the same time, speed increases the risk of publishing unverified information before facts have been confirmed.',
    'Traditional news organisations have also faced economic pressure as audiences and advertising moved online.',
    'The internet changes the tools and business model of journalism, but careful verification and clear sourcing remain central to credible reporting.'
  ]},
  {sourceId:'13000517', title:'Bee Hives', topic:'Biology', notes:[
    'A honeybee colony functions through highly specialised roles that allow thousands of insects to behave as a coordinated system.',
    'The queen lays eggs, workers gather food and maintain the hive, and male drones have a narrower reproductive role.',
    'Worker bees perform demanding tasks throughout short lives, while new generations continually replace those that die.',
    'Communication and division of labour allow the colony to regulate food, temperature and care for developing bees.',
    'Studying a hive shows how cooperation among individuals can produce behaviour that is more complex than the actions of any single bee.'
  ]}
];

const wfdSeeds = [
 ['20003618','Flexible online study','Online classes can give learners more control over the pace of study.'],
 ['20002509','Laptop use in lectures','Students may use a laptop during this lecture for taking notes.'],
 ['20001102','Vehicle repair','In my view the damaged car should be repaired as soon as possible.'],
 ['20001096','Morning traffic','Traffic becomes especially heavy on the main roads early in the morning.'],
 ['20001068','Closing the door','Please shut the door carefully when you leave the classroom.'],
 ['20000436','Museum opening hours','The city museum closes on one Thursday morning each month.'],
 ['20000177','Limits of a theory','There is no doubt that this theory still has several important limitations.'],
 ['20000056','Science library location','The science library is currently on the ground floor of the main library.'],
 ['20003754','Writing on pages','Students are encouraged to make useful notes on every page.'],
 ['20003753','Tact','Tact means expressing a clear point without creating unnecessary conflict.'],
 ['20003751','Modern architecture','Her design combines several of the strongest features of modern architecture.'],
 ['20003708','Honey uses','Honey is widely used both as a food and as a health product.'],
 ['20003706','Creative careers','Art and design can be highly competitive professional fields.'],
 ['20003694','Research grants','Universities often need external grants to support major research projects.'],
 ['20003682','Laboratory procedures','The laboratory manual explains all of the required experimental procedures.'],
 ['20003680','Academic debate','There continues to be considerable debate about this topic.'],
 ['20003678','Climate adaptation','Farmers need practical ways to adapt to changing climate conditions.'],
 ['20003676','Packaging','Packaging can strongly influence how buyers respond to a product.'],
 ['20003674','Automatic door','Keep the key with you because the front door locks automatically.'],
 ['20003673','Photography in geography','Photography can provide useful evidence for geographical field research.'],
 ['20003658','Coursework','Coursework gives students time to explore a subject in greater depth.'],
 ['20003657','Professional degrees','A university qualification is required for entry into many professions.'],
 ['20003650','Mathematics and data','Mathematics provides an essential foundation for understanding and analysing data.'],
 ['20003649','University football','Football is played at the university throughout the academic year.'],
 ['20003645','Engaging learners','Teachers are looking for new ways to keep learners actively engaged.'],
 ['20003637','Restroom directions','Go through the hall and turn right to reach the restroom.'],
 ['20003625','Extension requests','Requests for assignment extensions should be submitted before the deadline.'],
 ['20003600','Airport documents','Passengers must show a passport and boarding pass at the gate.'],
 ['20003599','Seminar assembly','Students should assemble in the seminar hall before the announcement begins.'],
 ['20003593','Marine environment','Pollution and unsustainable development have seriously damaged marine environments.'],
 ['20003592','Social trends','Designers need to keep up with important changes in social trends.'],
 ['20003583','Lunchroom drinks','Coffee and tea are available for staff in the lunchroom.'],
 ['20003576','Published articles','A new collection of academic articles has recently been published.'],
 ['20003552','Laptop use','You may use a laptop during the lecture if necessary.'],
 ['20002745','Applied mathematics','The course combines theoretical mathematics with practical applications.'],
 ['20002579','Optional tutorials','Optional tutorials will be offered during the final week of term.']
];

const swt = swtSeeds.map(makeSwt);
const sst = [...userSst.sst, ...sstSeeds.map(makeSst)];
const wfd = wfdSeeds.map(([sourceId,label,text], index) => ({
  id: 'pred26-wfd-' + String(index + 1).padStart(2, '0'),
  type: 'wfd',
  title: label,
  minutes: 4,
  timeGroup: 'dictation',
  voice: ['nova', 'onyx', 'alloy', 'fable'][index % 4],
  text,
  sample: text,
  predictionSource: { ...source, task:'wfd', sourceId, sourceTitle:label }
}));

module.exports = {
  version: '2026-09-23.1',
  source,
  userSource: userSst.source,
  swt,
  sst,
  wfd
};
