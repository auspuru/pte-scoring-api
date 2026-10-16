'use strict';
// Synthetic, anonymised teaching cases. These are expectations for human/live
// evaluation, not claims that mocked contract tests prove semantic accuracy.
const television=`I agree that television can help people relax and provide a sense of company, although it cannot replace close relationships. Its value depends on the programmes people choose and the amount of time they spend watching them.

After a demanding working day, a light comedy can give viewers a break from their worries. Following a familiar story requires less effort than dealing with work problems, so viewers may feel calmer for a while. This does not solve the source of stress, but a short period of entertainment can make the evening more enjoyable. People can then return to their responsibilities with a clearer mind.

Television can also make a quiet home feel less empty. Familiar presenters and regular programmes create a routine, while conversation and music provide background company. Someone living alone may therefore feel more comfortable during dinner. This benefit has limits because a programme cannot listen to the viewer or offer personal support. Television is most useful alongside phone calls, visits and activities that maintain real social contact.

Overall, television serves both functions when people use it sensibly. It offers accessible entertainment and temporary companionship, while genuine relationships remain essential for lasting emotional support. These benefits are useful within a balanced daily routine.`;
const transport=`I believe governments should prioritise reliable public transport over building new urban roads. Better bus and train services can improve access and reduce pressure on crowded streets.

First, public transport serves residents who cannot drive or cannot afford a car. A frequent bus connecting homes with workplaces allows these residents to accept jobs that would otherwise be difficult to reach. Accessible vehicles and stations also help older passengers travel more independently. Investment should therefore improve both the routes and their reliability, rather than simply adding a service that runs too rarely to be useful.

Second, well-connected services give existing drivers a realistic alternative. For example, a commuter may leave the car at home when a train offers a dependable journey and a convenient connection to the office. As more commuters share vehicles, fewer cars need to enter the centre during busy periods. The benefit depends on frequency and connections, because passengers will continue driving if the alternative makes their journey much harder.

In conclusion, public transport deserves priority because it widens access and can ease congestion. Funding should focus on practical networks that people can rely on throughout the day. These improvements can make daily travel easier for a wide range of residents.`;
const malls=`Shopping malls can provide useful services and employment, but their overall value depends on how they affect existing shops. I support carefully planned malls that meet local demand rather than assuming every new development is beneficial.

A shopping mall requires more workers, so employment will increase. This claim needs a qualification: one development can replace several existing shops. The net effect depends on whether new retail, security and cleaning positions exceed the jobs lost elsewhere. For example, a mall serving a growing neighbourhood may support additional work because it attracts demand that nearby businesses could not previously meet. A development moving the same customers between shops may have a smaller effect.

Malls can also make shopping more convenient. People can buy different products in one trip, and an indoor space may be easier to use in bad weather. However, this benefit depends on access. Reliable public transport, pedestrian entrances and affordable parking can help residents reach the facilities. Without these connections, a convenient interior may still be difficult for many people to use.

Overall, malls can improve shopping and provide work when demand and access justify them. Planning should consider both the new opportunities and the effects on existing businesses before claiming that a development will create a net benefit.`;
const automation=`Automation is beneficial because it can take over repetitive work and improve the speed of production. I believe that every business should introduce it as quickly as possible because workers will automatically have fewer working hours and more jobs.

Machines can perform repeated movements throughout the day. A factory using machines may finish more products in the same period, allowing managers to meet orders without asking employees to repeat the same physical action. This can reduce some tiring tasks and give staff time to check quality. People still need training to operate the equipment and respond when it stops working.

Automation will always reduce everyone's working hours and increase the number of jobs. Once a machine completes part of a task, every worker will be free to leave earlier and the company will recruit more staff. This means that there is no reason for employees to worry about changes to their roles. Employers can introduce equipment without discussing how work will be shared because the benefits happen automatically.

In conclusion, automation can improve the production process and remove some repetitive tasks. Its ability to complete work quickly is a clear advantage, and I therefore support its use in businesses. It will guarantee shorter working hours and additional employment for all workers.`;
const comparison=`Smartphones provide useful services, but they can also distract their users. Their influence is visible in communication, study and everyday routines, so both positive and negative effects deserve attention.

One advantage is convenient communication. People can contact family members quickly and share practical information when plans change. A student travelling to a new campus can also use a map to find the right building. Access to learning materials allows students to review unfamiliar ideas while travelling. These features can help users complete tasks and remain connected with people who matter to them.

On the other hand, frequent notifications can interrupt concentration. A person reading an important document may lose their place when messages arrive, making the task take longer. Social media can also encourage people to keep checking their phones during meals or conversations. This habit may reduce the attention they give to people nearby. Setting quiet periods and putting the phone away during focused work can help users manage these problems.

In conclusion, smartphones have advantages and disadvantages. They make communication and access to information easier, while notifications and constant checking can interfere with concentration. People can use settings and routines to control the interruptions. Both the helpful functions and the potential distractions are common parts of daily smartphone use.`;
const office=`The location of an office can affect how employees experience their working day. I believe that businesses should choose an office near the city centre because the area offers convenient services and transport.

An office near a train station can be easier for staff to reach. Employees may spend less time finding parking and have more choices about how they travel. For example, a worker who does not own a car can take a regular train instead of arranging a lift. This can make arriving at work more predictable and reduce the stress associated with a difficult commute.

Nearby cafes and shops can also improve the working day. Staff can buy lunch without making a long journey and complete small errands during a break. An office in a busy area may also be easier for clients to find. These practical benefits can make the location attractive to both employees and visitors, particularly when services remain available after normal working hours.

Inside the office, separate quiet rooms may help employees focus by reducing conversations around their desks.

In conclusion, offices near transport and useful services can make daily work more convenient. A central location gives staff better access and can support visits from clients. Businesses should compare travel options and nearby facilities when deciding where to establish an office, since these features affect the people who use it each day.`;
const cases=[
 {id:'reasons_or_experience',question:'Television helps people relax and acts as a companion for the lonely. To what extent do you agree? Give reasons or your own experience.',essay:television,forbidMissingKind:'own_experience',forbidCodes:['stance_conflict'],repeat:true},
 {id:'explicit_own_experience',question:'Television helps people relax and acts as a companion for the lonely. To what extent do you agree? Explain why with your own experience.',essay:television,expectMissingKind:'own_experience',repeat:true},
 {id:'one_sided_supported',question:'Governments should prioritise public transport over new urban roads. To what extent do you agree? Give reasons for your answer.',essay:transport,forbidCodes:['missing_counterargument','stance_conflict']},
 {id:'explanation_elsewhere',question:'Shopping malls benefit local communities. To what extent do you agree? Give reasons for your answer.',essay:malls,forbidCodes:['unsupported_inference','stance_conflict']},
 {id:'jobs_automation',question:'Automation improves working life. To what extent do you agree? Explain your reasons.',essay:automation,expectCodes:['unsupported_inference','development_gap'],expectMaterial:true},
 {id:'relative_comparison',question:'Smartphones have advantages and disadvantages. Are the disadvantages as great as the advantages? Explain your judgement.',essay:comparison,expectCodes:['comparison_missing','missing_requirement','development_gap'],expectMaterial:true},
 {id:'design_not_location',question:'How does the design of an office building affect the people who work there? Explain the effects of design features.',essay:office,expectCodes:['category_mismatch','missing_requirement','development_gap'],expectMaterial:true},
 {id:'stance_conflict',question:'Governments should prioritise public transport over new urban roads. To what extent do you agree? Give reasons for your answer.',essay:transport.replace('In conclusion, public transport deserves priority because it widens access and can ease congestion.','In conclusion, only new urban roads deserve government investment and public transport should receive none.'),expectCodes:['stance_conflict','development_gap'],expectMaterial:true}
];
module.exports={cases,television,transport,malls};
