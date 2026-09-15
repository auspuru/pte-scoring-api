'use strict';
const plan = {
  topic: 'Late Submission and Mark Deduction',
  question: "Some universities deduct marks from students' work if it is given in late. What is your opinion? Suggest some alternative actions.",
  question_type: 'opinion_alternatives', target_band_level: 'band9', band6Mode: 'just_phrases',
  generation_mode: 'natural', vocabulary_level: 3, stance: 'largely disagree', idea_source: 'ai',
  selected_ideas: { reasons: ['hurts students who are already struggling', 'ignores students with family problems'],
    solutions: ['ask students to explain why they are late', 'give students help before the deadline'] },
  paragraph_roles: { bp1: 'reasons supporting opinion', bp2: 'suggest alternative actions', conclusion: 'clear opinion and summary of alternatives' },
  user_preferences: { target_exam: 'pte', idea_source: 'ai', writing_style: 'natural' }
};
// The reported failure: a pro-deduction introduction followed by opposing ideas and planning notes.
const reported = `===INTRO===
The topic of whether universities should take marks away from students who hand in their work late has become increasingly important in recent years and has attracted different opinions. Its significance lies in its impact on individuals and society in various ways. This essay will largely agree that mark deductions can be fair, but it will also suggest some better ways that universities can handle late work, supported by relevant examples.
===BP1===
Idea 1: hurts students who are already struggling

Explanation: Some students find university life very hard. They may be behind in their studies, feel stressed, or have low grades already. If their marks are cut even more because of a late submission, it can make things much worse for them. Instead of helping them catch up, the punishment pushes them further behind.

Example Phrases:
- "For students who are already finding it hard to keep up, losing extra marks can make things even more difficult..."
- "A student who is struggling with their studies may fall even further behind if marks are taken away for being late..."

Idea 2: ignores students with family problems

Explanation: Not all students have the same home life. Some students have sick parents, young children to look after, or serious problems at home. These things are out of their control. Taking marks away without asking why the work was late is not fair, because it treats every student the same, even when their situations are very different.

Example Phrases:
- "Some students may be late because they have serious problems at home, such as a sick family member..."
- "It is not fair to cut marks without first finding out if the student had personal or family reasons for being late..."
===BP2===
Idea 1: ask students to explain why they are late

Explanation: Before taking any marks away, universities can ask students to give a reason for handing in their work late. This gives students a chance to explain their situation. If the reason is good, such as a family emergency or illness, the university can decide not to punish them. This is a kinder and fairer way to handle the problem.

Example Phrases:
- "Universities could ask students to write a short explanation if they cannot hand in their work on time..."
- "If a student has a good reason for being late, the university should listen before deciding to remove marks..."

Idea 2: give students help before the deadline

Explanation: Instead of waiting for students to miss the deadline and then punishing them, universities can check in with students early. Teachers can ask if students are on track and offer help if someone is falling behind. This way, students get the support they need before it is too late, and there is less need for any kind of punishment.

Example Phrases:
- "Teachers could check with students a week before the deadline to see if they need any help..."
- "If universities offer more support early on, students are less likely to hand in their work late..."
===CONCL===
In conclusion, the question of whether universities should take marks away for late work has both fair points and real problems that strongly influence student outcomes. While some level of deadline rules can be useful, it is also important to look at each student's situation carefully.
Therefore, it is essential to use fairer ways, such as asking for reasons and giving early help, while reducing the use of automatic mark deductions, in order to achieve long-term progress for all students.`;

const coherent = `===INTRO===
Universities need submission deadlines to organise assessment and encourage responsibility. However, I largely disagree with automatically deducting marks for late work because this can penalise students whose circumstances prevent timely submission. Reviewing their reasons and providing support before deadlines would offer fairer alternatives.
===BP1===
Automatic deductions can hurt students who are already struggling academically. Reducing their marks further may discourage them without addressing why they missed a deadline. For example, a student having difficulty understanding an assignment may benefit more from targeted guidance than an additional penalty. Such deductions can also ignore students with family problems. A student caring for a sick parent might submit an otherwise strong assignment late because of an unexpected emergency. In that situation, the lower mark would partly reflect personal circumstances rather than the student's understanding of the subject.
===BP2===
Universities should first ask students to explain why their work is late. A clear extension process could allow staff to consider illness or caring responsibilities while maintaining consistent expectations. For instance, a student facing a family emergency could receive a short extension after discussing the circumstances with a tutor. Universities should also give students help before the deadline. Brief progress checks and accessible consultations would identify difficulties early. A student who cannot interpret an assignment question could then receive clarification and complete the task on time, reducing the need for penalties.
===CONCL===
Although deadlines remain necessary, automatic mark deductions can disadvantage struggling students and overlook family emergencies. Universities should assess individual explanations and offer timely academic support. Therefore, a fair response to late work should address its causes while preserving reasonable submission expectations.`;
module.exports = { plan, reported, coherent };
