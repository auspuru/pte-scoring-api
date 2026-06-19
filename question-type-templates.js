/* =====================================================================
   QUESTION-TYPE TEMPLATE STRUCTURES  (IPT Brisbane Essay Builder)
   ---------------------------------------------------------------------
   PURPOSE
   The app currently feeds ONE generic skeleton (BAND9_TEMPLATE / BAND6_TEMPLATE)
   into the essay-generation prompt, with slashed cross-type options like
   "[advantages and disadvantages / causes and effects / problems and solutions]".
   The writer/AI then has to resolve those by hand, and the client even rewrites
   BP2 with ad-hoc string replacements to make a one-sided essay read correctly.

   This module replaces that with a CONCRETE skeleton per question type. Every
   seed essay maps to exactly one of these via its `type`, so the structure the
   AI follows always matches the actual question.

   These describe STRUCTURE only (paragraph roles + a band-9 skeleton). Vocabulary
   band (band6 vs band9) is handled by the existing band-vocab rules, so the same
   structure works for both — only the wording level changes.

   ---------------------------------------------------------------------
   COVERAGE — current seed list (35 essays -> 10 types)
     opinion_alternatives (1)      Late Submission and Mark Deduction
     agree_disagree (15)           Television…, Combining Study…, Experiential…,
                                   Public Transport…, Formal Exams…, Compulsory
                                   Foreign Language…, Parental Legal…, Mass Media…,
                                   Fewer Working Hours…, Maximum Wage…, Famous
                                   People & Privacy…, Experience is the Best
                                   Teacher…, AI & Foreign Language…, Travel &
                                   Quality of Education…, Growing Up in the 21st…
     advantages_disadvantages (6)  Studying Old Plays…, Digital Materials &
                                   Libraries…, Tourism in Less Developed…, Workers
                                   in Decision-Making…, Youth Unemployment…,
                                   Historic Buildings vs Modern Housing…
     positive_negative_impact (5)  Medical Technology…, Building Design…, Modern
                                   Inventions…, Shopping Malls…, Communication
                                   Methods…
     single_best_option (2)        The Most Pressing Global Problem, Studying
                                   Climate Change
     discuss_both_views (2)        Laws and Human Behaviour, The Value of Humanities
     responsibility (1)            Responsibility for Tackling Climate Change
     two_option_preference (1)     City vs Countryside Living
     cause_effect (1)              Work-Life Balance
     example_specific (1)          Age Restrictions

   Aliases handled by the selector: problems_benefits -> advantages_disadvantages,
   blessing_curse -> positive_negative_impact, opinion -> agree_disagree,
   causes_solutions/problem_solution/cause_solution share the problem_solution
   skeleton, causes_effects/problem_effect share the cause_effect skeleton.

   ---------------------------------------------------------------------
   INTEGRATION (server.js -> generateEssayPrompt)
     const tpl = getTypeTemplateStructure(plan.question_type, template);
     // then use tpl.intro / tpl.bp1 / tpl.bp2 / tpl.concl
     //   instead of template.intro / template.bp1 / template.bp2 / template.concl
   `template` (the band skeleton the client sends) is the fallback, so anything
   not covered here keeps today's behaviour exactly.
   ===================================================================== */

const QUESTION_TYPE_TEMPLATES = {

  // ---- STANCE + REASONS -------------------------------------------------
  agree_disagree: {
    bp1Role: "two reasons that support the chosen stance",
    bp2Role: "a third reason, or a limitation answered with a rebuttal",
    intro: `Introduce [paraphrase the topic] and note briefly why it matters to [the group/area affected]. Make your position unmistakable in one clear sentence: state whether you AGREE or DISAGREE (and how strongly) with [the statement]. Do not sit on the fence — the whole essay defends this one stance. [State your stance here, e.g. "I largely agree that …".]`,
    bp1: `Give the FIRST reason your stance is correct: [reason 1], explaining clearly why it holds. Support it with one concrete, everyday example — [a specific, relatable scenario, NOT "in many cases"]. Then add a SECOND reason: [reason 2], with its own short real example — [a second specific scenario]. Keep both reasons firmly on the same side as your stance.`,
    bp2: `Develop the argument further. Either give a THIRD supporting reason [reason 3] with an example, OR raise the most common opposing point [the counter-argument] and then rebut it — concede it briefly, then show why your stance still stands. Back the paragraph with one clear example — [a specific scenario]. Do NOT switch sides; any opposing point must be answered, not endorsed.`,
    concl: `Restate your position in fresh words (do not copy the introduction), summarise the two or three reasons that carried it, and finish with a forward-looking sentence that reaffirms why you [agree/disagree]. [End on your stance, e.g. "Overall, the benefits clearly outweigh the doubts, which is why I support …".]`
  },

  opinion: { __aliasOf: "agree_disagree" },

  // ---- STANCE + ALTERNATIVE ACTIONS -------------------------------------
  opinion_alternatives: {
    bp1Role: "support the chosen stance with two reasons",
    bp2Role: "propose alternative actions to take instead",
    intro: `Introduce [paraphrase the practice/policy in the question] and why it matters. State your opinion clearly — whether you AGREE or DISAGREE with [the practice] — and signal that you will also suggest better alternatives. [State your stance, e.g. "I disagree with … and believe other measures would work better."]`,
    bp1: `Justify your stance. Give [reason 1] for your position with a short everyday example — [a specific scenario] — and then [reason 2] with its own example. This paragraph is ONLY about why you hold your opinion, not yet about alternatives.`,
    bp2: `Now propose ALTERNATIVE ACTIONS that should be taken instead of [the practice]. Present [alternative action 1], explaining how it solves the underlying problem more fairly/effectively, with a brief example; then [alternative action 2] with its own short example. Make the alternatives practical and specific, not vague.`,
    concl: `Restate your opinion in new wording, briefly recap your main reason, and summarise the alternative actions you recommend as the better path forward. [Close by reaffirming your stance and pointing to the alternatives.]`
  },

  // ---- TWO SIDES --------------------------------------------------------
  advantages_disadvantages: {
    bp1Role: "the main advantages",
    bp2Role: "the main disadvantages",
    intro: `Introduce [paraphrase the topic] and why it is widely discussed. State that this essay will weigh the main ADVANTAGES against the main DISADVANTAGES of [the topic]. Only add an opinion sentence if the question explicitly asks for your view (e.g. "discuss … and give your opinion").`,
    bp1: `Focus entirely on ADVANTAGES. Present [advantage 1], explaining the benefit and who gains from it, with a concrete example — [a specific scenario]. Then add [advantage 2] with its own short example. Keep this paragraph 100% positive.`,
    bp2: `Focus entirely on DISADVANTAGES. Present [disadvantage 1], explaining the harm or cost and who is affected, with a concrete example — [a specific scenario]. Then add [disadvantage 2] with its own short example. Keep this paragraph 100% about drawbacks.`,
    concl: `Summarise both sides in a balanced way. If the question asked for an opinion, state clearly whether the advantages outweigh the disadvantages (or vice versa) and why; if it did not, give a measured closing judgement on managing the trade-off. [Final balanced sentence.]`
  },

  problems_benefits: { __aliasOf: "advantages_disadvantages" },

  // ---- POSITIVE / NEGATIVE IMPACT (also blessing/curse, good or bad) -----
  positive_negative_impact: {
    bp1Role: "the positive impacts / the case it is a blessing",
    bp2Role: "the negative impacts / the case it is a curse",
    intro: `Introduce [paraphrase the development/trend in the question] and why its impact is debated. State that this essay will examine its POSITIVE and NEGATIVE impacts on [the affected group/society]. If the question frames it as "a blessing or a curse" / "good or bad change", signal which way you ultimately lean.`,
    bp1: `Discuss the POSITIVE impacts. Give [positive impact 1] with a concrete example — [a specific scenario] — then [positive impact 2] with its own example. Show clearly who benefits and how.`,
    bp2: `Discuss the NEGATIVE impacts. Give [negative impact 1] with a concrete example — [a specific scenario] — then [negative impact 2] with its own example. Show clearly who is harmed and how.`,
    concl: `Weigh the positives against the negatives and give a clear verdict — overall beneficial, overall harmful, or beneficial only if [the key condition] is met — and justify it in one sentence. [Final verdict.]`
  },

  blessing_curse: { __aliasOf: "positive_negative_impact" },

  // ---- SINGLE BEST OPTION ("most pressing problem", "which area …") -------
  single_best_option: {
    bp1Role: "why the chosen option is the most important",
    bp2Role: "practical solutions / how to act on it",
    intro: `Introduce [paraphrase the broad area in the question]. From the range of possibilities, name the ONE you have chosen — [the selected problem/area] — and state that this essay will explain why it is the most pressing/important and what should be done about it. Commit to a single choice; do not list several.`,
    bp1: `Justify the choice. Give [reason 1 why it is the most serious/important] with a concrete consequence or example — [a specific scenario] — then [reason 2] with its own example. Make clear why it outranks the alternatives.`,
    bp2: `Set out practical SOLUTIONS / actions for [the selected problem/area]. Present [solution 1], explaining how it directly addresses the issue, then [solution 2] with a short example of it working. Keep solutions realistic and actionable (start with a verb where natural).`,
    concl: `Restate why [the selected problem/area] is the most pressing/important, recap the key solutions, and end with a forward-looking call to act. [Final sentence.]`
  },

  // ---- DISCUSS BOTH VIEWS + OPINION -------------------------------------
  discuss_both_views: {
    bp1Role: "the first view, presented fairly",
    bp2Role: "the second view, then your own opinion",
    intro: `Introduce [paraphrase the issue]. Note that opinion is divided: some hold [view A] while others hold [view B]. State that this essay will discuss BOTH views before giving your own opinion. You may name your leaning here or save it for the conclusion.`,
    bp1: `Present the FIRST view fairly, as its supporters would. Give [reason 1 people hold view A] with an example — [a specific scenario] — then [reason 2] with its own example. Explain the view sympathetically even if you disagree with it.`,
    bp2: `Present the SECOND view the same way: [reason 1 people hold view B] with an example, then [reason 2]. Then pivot to YOUR opinion in the last sentence or two — state which view you find more convincing and briefly why. [Your opinion sentence.]`,
    concl: `State clearly which view you favour overall, summarise the single strongest reason, and close. Do not introduce new arguments here. [Final judgement.]`
  },

  // ---- RESPONSIBILITY (who is responsible) ------------------------------
  responsibility: {
    bp1Role: "why the primary party bears the main responsibility",
    bp2Role: "the supporting role of other parties / shared responsibility",
    intro: `Introduce [paraphrase the issue and the candidate parties, e.g. governments, companies, individuals]. State your position on who should bear the MAIN responsibility — [the primary party] — while acknowledging others have a role. [Your position sentence.]`,
    bp1: `Argue why [the primary party] is mainly responsible. Give [reason 1] with a concrete example — [a specific scenario] — then [reason 2] with its own example. Show why this party has the greatest capacity or duty to act.`,
    bp2: `Acknowledge the SUPPORTING role of the other parties — [other party/parties] — explaining what they can realistically contribute, with an example, and why their role is secondary to [the primary party]. This keeps the answer balanced without abandoning your position.`,
    concl: `Restate who carries the main responsibility and why, note the shared contribution of the others, and finish with a sentence on how acting together produces the best outcome. [Final sentence.]`
  },

  // ---- TWO-OPTION PREFERENCE (choose between two) -----------------------
  two_option_preference: {
    bp1Role: "two reasons for preferring the chosen option",
    bp2Role: "a further benefit of the chosen option and a brief contrast",
    intro: `Introduce the choice between [option A] and [option B]. Acknowledge that both have merits, then state clearly which you prefer — [the chosen option] — and that this essay will explain why. [Your preference sentence.]`,
    bp1: `Give the FIRST reason you prefer [the chosen option]: [reason 1] with a concrete example from experience or daily life — [a specific scenario] — then [reason 2] with its own example. Keep the focus on the strengths of your choice.`,
    bp2: `Add a FURTHER benefit of [the chosen option] — [reason 3] with an example — and briefly contrast it with [the other option], conceding one point but showing why it does not change your preference. Do not switch sides.`,
    concl: `Restate your preference for [the chosen option], summarise the main reasons, and close with a personal, forward-looking sentence. [Final sentence.]`
  },

  // ---- CAUSE -> EFFECT --------------------------------------------------
  cause_effect: {
    bp1Role: "the main causes",
    bp2Role: "the resulting effects / consequences",
    intro: `Introduce [paraphrase the situation in the question]. State that this essay will examine the main CAUSES of [the situation] and the EFFECTS they produce on [the affected group]. If the question also asks "how important", state your view on its importance here.`,
    bp1: `Set out the main CAUSES. Give [cause 1], explaining the mechanism, with a concrete example — [a specific scenario] — then [cause 2] with its own example. Keep this paragraph about WHY it happens.`,
    bp2: `Set out the EFFECTS / consequences that follow. Give [effect 1] with a concrete example — [a specific scenario] — then [effect 2] with its own example. Link each effect back to the causes in BP1 so the chain is clear.`,
    concl: `Summarise how the causes lead to these effects, restate why the issue matters, and close with a brief forward-looking remark or measured suggestion. [Final sentence.]`
  },

  // ---- PROBLEM -> SOLUTION (problem_solution / cause_solution / causes_solutions)
  problem_solution: {
    bp1Role: "the key problems or causes",
    bp2Role: "matching, practical solutions",
    intro: `Introduce [paraphrase the problem area]. State that this essay will identify the key problems/causes of [the issue] and propose practical solutions for each.`,
    bp1: `Set out the key PROBLEMS / causes. Give [problem 1], explaining its impact, with a concrete example — [a specific scenario] — then [problem 2] with its own example.`,
    bp2: `Propose a SOLUTION for each problem above. Give [solution to problem 1], explaining how it works, then [solution to problem 2] with a short example of it succeeding. Pair each solution clearly to its problem and keep them realistic.`,
    concl: `Summarise the problems and the solutions that address them, and end with a forward-looking call to act. [Final sentence.]`
  },

  // ---- EXAMPLE-SPECIFIC (give an example, then justify) ------------------
  example_specific: {
    bp1Role: "the chosen example and its main justification",
    bp2Role: "impact, limitation, or recommendation",
    intro: `Introduce [paraphrase the question]. Name the SPECIFIC example/choice you will discuss — [the chosen example, e.g. a particular age, invention, or area] — and state what you will argue about it (why it is appropriate / its impact / your recommendation). Commit to one clear choice.`,
    bp1: `Present [the chosen example] and the MAIN justification for it. Give [reason 1] with support from study, observation, or personal experience — [a specific scenario] — then [reason 2] with its own example.`,
    bp2: `Discuss the wider IMPACT, a LIMITATION, or a RECOMMENDATION connected to your choice. Give [point 1] with an example, then [point 2], showing balanced judgement rather than only praise.`,
    concl: `Restate your specific choice and the core reason for it, add your recommendation, and close. [Final sentence.]`
  }

};

/* Resolve aliases once so the selector is a simple lookup. */
Object.keys(QUESTION_TYPE_TEMPLATES).forEach(k => {
  const v = QUESTION_TYPE_TEMPLATES[k];
  if (v && v.__aliasOf && QUESTION_TYPE_TEMPLATES[v.__aliasOf]) {
    QUESTION_TYPE_TEMPLATES[k] = QUESTION_TYPE_TEMPLATES[v.__aliasOf];
  }
});

/* Extra aliases for relation variants that share a skeleton. */
const TYPE_TEMPLATE_ALIASES = {
  causes_solutions: "problem_solution",
  cause_solution: "problem_solution",
  problem_effect: "cause_effect",
  causes_effects: "cause_effect",
  problems_effects: "cause_effect",
  compare_two_sides: "advantages_disadvantages"
};

/**
 * Return a concrete {intro, bp1, bp2, concl} structure for the question type.
 * Falls back to the band skeleton the client sent (so uncovered types are unchanged).
 * Carries over any non-paragraph fields from the fallback (e.g. notes).
 */
function getTypeTemplateStructure(questionType, fallbackTemplate) {
  const key = TYPE_TEMPLATE_ALIASES[questionType] || questionType;
  const t = QUESTION_TYPE_TEMPLATES[key];
  if (!t) return fallbackTemplate;
  return {
    ...(fallbackTemplate || {}),
    bp1Role: t.bp1Role,
    bp2Role: t.bp2Role,
    intro: t.intro,
    bp1: t.bp1,
    bp2: t.bp2,
    concl: t.concl
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QUESTION_TYPE_TEMPLATES, getTypeTemplateStructure, TYPE_TEMPLATE_ALIASES };
}
