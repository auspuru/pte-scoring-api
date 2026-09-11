Warning: truncated output (original token count: 197905)
Total output lines: 16630

// ============================================================
//  GLOBAL ERROR BOUNDARY — surface failures as a friendly toast
//  instead of silent console-only errors or a frozen UI.
// ============================================================
(function installErrorBoundary() {
  let lastErrorToastAt = 0;
  function friendlyErrorToast(detail) {
    // Throttle: at most one error toast per 4s so we don't spam
    const now = Date.now();
    if (now - lastErrorToastAt < 4000) return;
    lastErrorToastAt = now;
    // toast() may not be defined yet during early load — guard it
    if (typeof toast === 'function') {
      toast('Something went wrong, but your work is safe. Try again in a moment.', true);
    }
    console.warn('[error-boundary]', detail);
  }
  window.addEventListener('error', (ev) => {
    // Ignore benign ResizeObserver noise + cross-origin script errors with no detail
    const msg = ev.message || '';
    if (msg.includes('ResizeObserver') || msg === 'Script error.') return;
    friendlyErrorToast(msg || ev.error);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    // Ignore the browser-extension message-channel noise the user saw earlier
    const rmsg = (reason && reason.message) || String(reason || '');
    if (rmsg.includes('message channel closed') || rmsg.includes('listener indicated')) return;
    friendlyErrorToast(rmsg);
  });
})();

// ============================================================
//  STUDENT PORTAL — ADMIN ENTRY REMOVED
//  The student-facing application must never expose an admin navigation link,
//  admin launch button, or embedded admin modal. Protected backend maintenance
//  endpoints remain server-side and are not part of the student interface.
// ============================================================
function removeAdminPortalEntry() {
  const selectors = [
    '#nav-admin',
    '#adminModal',
    '[data-section="admin"]',
    '[data-target="admin"]',
    'a[href="/admin"]',
    'a[href="/admin.html"]',
    'a[href$="/admin"]',
    'a[href$="/admin.html"]',
    '[onclick*="openAdmin"]'
  ];
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach(el => el.remove());
  }
}

(function installAdminEntryRemoval() {
  sessionStorage.removeItem('pte_admin_key');
  const run = () => removeAdminPortalEntry();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
  // Some layouts are injected after authentication; remove any late-added entry.
  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

// ============================================================
//  STATE — Unified Client State
// ============================================================
let essays = [];
let currentId = null;
let currentPassageId = 1;
let currentFilter = 'all';
let currentZoom = 0.7;
let currentUserId = '';       // Custom session username
let currentUser = null;
let userProfile = null;       // Combined profile stashed locally
let offlineMode = false;      // True if offline fallback is chosen
let sessionToken = '';        // Custom sync authentication token

// SWT progress elements
let passages = [];
let swtResultPassage = null;
let swtResultSubmission = null;
let swtGradingPending = false;
const swtSampleChecks = new Map();
let adminKey = ''; // Student portal has no admin entry
let attempted = new Set();
let timerOn = false;
let timerSeconds = 0;
let timerInterval = null;
let lastSpellData = null;
let writeTab = 'write';

// Sync state
let syncQueued = false;
let syncTimer = null;
let lastSyncOk = true;
let syncRetryCount = 0;
let syncInFlight = null;
let syncInFlightSession = null;
let practiceHistoryDeleted = [];
let practiceSubmissionPending = false;
let practiceRevision = null;
let practiceRefreshInFlight = null;
let lastPracticeRefreshAt = 0;
const SYNC_MAX_RETRIES = 5;

// API configuration
const RAILWAY_URL = 'https://swt.up.railway.app';
const isLocalFile = location.protocol === 'file:';
const API_URL = isLocalFile ? RAILWAY_URL : '';

const BAND9_TEMPLATE = {
  intro: `The topic of [paraphrase topic] has become increasingly important in recent years, prompting varied opinions. Its significance lies in its influence on [specific group/area] across multiple dimensions. This essay will examine the [causes and effects / problems and solutions / advantages and disadvantages / positive and negative impacts] of [topic name] incorporating different perspectives and practical examples. [In my view, [insert your own opinion here — e.g., television offers both relaxation and entertainment, but should also be used in moderation].] (Include this line only when the question asks for your opinion.)`,
  bp1: `To begin with, one major [merit / cause / problem] is [point 1], as it leads to [explanation]. For example, [give a specific, topic-relevant example — name a real place, study, statistic, or scenario; NOT generic phrasing like "in many cases"] shows its [benefits / effects] in practice. Additionally, another significant [point in favour / reason / challenge] is [point 2], which [promotes / impacts] [explanation]. This can be illustrated by [give a SECOND specific, topic-relevant example], highlighting how [topic] contributes [positively / negatively] to [society / field].`,
  bp2: `On the other hand, one notable [demerit / negative effect / solution] is [point 1], which may [cause / prevent] [explanation]. For instance, [give a specific, topic-relevant example — a real place, study, statistic, or scenario] illustrates this [drawback / consequence] clearly. Furthermore, another [limitation / adverse consequence / measure to be taken] is [point 2], which results in [explanation]. A clear example of this is [give a SECOND specific, topic-relevant example], demonstrating the impact on [affected group / outcome].`,
  concl: `To conclude, [reword topic] presents [compelling advantages and disadvantages / notable causes and consequences / key problems and remedies] that significantly influence outcomes. Hence, prioritising [name the specific positive aspect of THIS topic — e.g., "well-planned public transport investment" or "supporting student mental health"] while addressing [name the specific drawback to mitigate for THIS topic — e.g., "the funding burden on local councils" or "the disruption to students from underprivileged backgrounds"] is essential for [topic-specific desired outcome — what good thing this leads to]. [Therefore, this reaffirms my earlier view that [echo the specific opinion from the introduction in fresh words — do NOT copy the intro verbatim, restate the same stance with a forward-looking framing].] (Include this Therefore sentence whenever the introduction stated an opinion — it gives the conclusion a stronger, more personal finish.)`,
  notes: `Use sophisticated Band 9 vocabulary (yet still student-friendly — words students recognize from class). Replace [square brackets] with topic-specific content. Choose ONE option when brackets show slashed alternatives based on question type. The "In my view..." line is optional — omit if the question doesn't ask for opinion. CRITICAL: Each body paragraph must contain TWO concrete topic-specific examples (one per supporting idea). Generic phrases like "in many places" or "as research shows" are NOT acceptable examples — use named places, real studies, named populations, or specific scenarios. CRITICAL: The conclusion's middle sentence ("Hence, prioritising...") must be REWRITTEN with topic-specific nouns — never copy it verbatim. If the introduction states an opinion, the conclusion must end with a "Therefore..." sentence that echoes that opinion in fresh wording.`
};
const BAND9_TEMPLATE_VERSION = 2;

const BAND9_TEMPLATE_LEGACY_V1 = {
  intro: `The topic of [paraphrase topic] has become increasingly important in recent years, prompting varied opinions. Its significance lies in its influence on [specific group/area] across multiple dimensions. This essay will examine the [causes and effects / problems and solutions / advantages and disadvantages / positive and negative impacts] of [topic name] incorporating different perspectives and practical examples. [In my view, [insert your own opinion here — e.g., television offers both relaxation and entertainment, but should also be used in moderation].] (Include this line only when the question asks for your opinion.)`,
  bp1: `To begin with, one major [merit / cause / problem] is [point 1], as it leads to [explanation]. For example, [example] shows its [benefits / effects] in practice. Additionally, another significant [point in favour / reason / challenge] is [point 2], which [promotes / impacts] [explanation]. This can be illustrated by [example], highlighting how [topic] contributes [positively / negatively] to [society / field].`,
  bp2: `On the other hand, one notable [demerit / negative effect / solution] is [point 1], which may [cause / prevent] [explanation], as seen in [example]. Furthermore, another [limitation / adverse consequence / measure to be taken] is [point 2], which results in [explanation].`,
  concl: `To conclude, [reword topic] presents [compelling advantages and disadvantages / notable causes and consequences / key problems and remedies] that significantly influence outcomes. Hence, prioritising the maximisation of its (advantages) and the alleviation of its (drawbacks) is essential for fostering long-term progress and collective well-being. [Therefore, [insert your own solution-oriented closing sentence — e.g., with the right strategies and proactive measures, these challenges can be transformed into opportunities for practical solutions and long-term improvement].] (This Therefore line is OPTIONAL — if you've already met the required word count, you can completely skip this sentence.)`
};

const BAND6_TEMPLATE = {
  intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Its significance lies in its impact on individuals and society in various ways. This essay will discuss the advantages and disadvantages of [topic], supported by relevant examples.`,
  bp1: `To begin with, one important benefit of [topic] is that [positive idea 1]. For example, [insert specific example related to positive idea 1]. Additionally, another key advantage is that [positive idea 2], leading to long-term growth and an improved quality of life. This can be clearly seen in modern society, where such positive impacts are becoming more common.`,
  bp2: `On the other hand, a major concern regarding [topic] is that [negative idea 1], as seen in various sectors today. Furthermore, this issue can result in [negative idea 2], including financial burden or reduced well-being for certain groups. However, with effective planning and appropriate measures, these challenges can be controlled and reduced.`,
  concl: `In conclusion, [topic rephrased] has both benefits and drawbacks that strongly influence outcomes. Therefore, it is essential to maximise the positive aspects while minimising the negative ones to achieve long-term progress.`,
  notes: `Use simple, clear Band 6 vocabulary. Keep sentences short and direct. Use everyday words students know. Avoid academic phrases like "incorporating different perspectives" or "fostering long-term progress" — use plain English instead. Do not include any "[EXTRA IDEA]" line in BP1. Do not include any "Therefore," solution line at the end of BP2. Keep paragraphs around 80-100 words each.`
};

const DEFAULT_TEMPLATE = BAND9_TEMPLATE;

// ============================================================
//  BAND 6 PER-TYPE EXAM FRAMES (mirror of server.js)
//  Used by paragraph regeneration so rewritten paragraphs follow
//  the same frames the server used for the full essay.
// ============================================================
const QUESTION_TYPE_TEMPLATES = {
  agree_disagree: {
    bp1Role: "your supporting reasons with examples",
    bp2Role: "limitations or drawbacks (balanced view)",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Some people believe that [restate the statement in simple words]. I [completely agree / mostly agree / mostly disagree / completely disagree] with this idea. This essay will explain my opinion with clear reasons and examples.`,
    bp1: `To begin with, one important reason for my opinion is that [supporting reason 1]. For example, [insert a simple everyday example related to reason 1]. Additionally, another key reason is that [supporting reason 2]. For example, [insert a simple everyday example related to reason 2].`,
    bp2: `On the other hand, there are some limitations of [topic]. One concern is that [drawback or limitation 1]. For example, [insert a simple everyday example related to this concern]. Furthermore, [drawback or limitation 2] can also create problems for some people. However, these points do not change my overall opinion.`,
    concl: `In conclusion, [topic rephrased] has strong reasons on my side, even though it also has some limitations. Therefore, I [restate your exact stance in fresh simple words] because [your strongest reason in a few words].`
  },

  opinion: {
    bp1Role: "your supporting reasons with examples",
    bp2Role: "limitations or drawbacks (balanced view)",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Some people think that [restate the idea in simple words]. In my opinion, [state your view clearly in simple words]. This essay will explain my opinion with clear reasons and examples.`,
    bp1: `To begin with, one important reason for my opinion is that [supporting reason 1]. For example, [insert a simple everyday example related to reason 1]. Additionally, another key reason is that [supporting reason 2]. For example, [insert a simple everyday example related to reason 2].`,
    bp2: `On the other hand, there are some limitations of [topic]. One concern is that [drawback or limitation 1]. For example, [insert a simple everyday example related to this concern]. Furthermore, [drawback or limitation 2] can also create problems for some people. However, these points do not change my overall opinion.`,
    concl: `In conclusion, [topic rephrased] has strong reasons on my side, even though it also has some limitations. Therefore, I believe that [restate your view in fresh simple words] because [your strongest reason in a few words].`
  },

  opinion_alternatives: {
    bp1Role: "support the chosen stance with two reasons",
    bp2Role: "propose alternative actions to take instead",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Some institutions believe that [the practice in simple words] is useful, but I [agree / partially disagree / completely disagree] with this practice. This essay will explain my opinion and suggest some better alternative actions.`,
    bp1: `To begin with, one important reason for my view is that [reason 1]. For example, [insert a simple everyday example related to reason 1]. Additionally, another key reason is that [reason 2]. For example, [insert a simple everyday example related to reason 2].`,
    bp2: `On the other hand, there are better alternative actions instead of [the practice]. One helpful option is to [alternative action 1]. For example, [insert a short everyday example of how it helps]. Furthermore, another practical step is to [alternative action 2]. For example, [insert a short everyday example of how it helps].`,
    concl: `In conclusion, although [the practice rephrased] has a purpose, it can be unfair in some cases. Therefore, it is better to [restate the strongest alternative action] so that [the positive outcome in simple words].`
  },

  advantages_disadvantages: {
    bp1Role: "the main advantages",
    bp2Role: "the main disadvantages",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. [If the question asks for your opinion, add one sentence: In my opinion, the advantages outweigh the disadvantages / the disadvantages outweigh the advantages.] This essay will discuss the main advantages and disadvantages of [topic], supported by relevant examples.`,
    bp1: `To begin with, one important benefit of [topic] is that [advantage 1]. For example, [insert a simple everyday example related to advantage 1]. Additionally, another key advantage is that [advantage 2]. For example, [insert a simple everyday example related to advantage 2].`,
    bp2: `On the other hand, one major concern regarding [topic] is that [disadvantage 1]. For example, [insert a simple everyday example related to disadvantage 1]. Furthermore, [disadvantage 2] is another drawback that affects some people. For example, [insert a simple everyday example related to disadvantage 2].`,
    concl: `In conclusion, [topic rephrased] brings both clear benefits and real drawbacks. Therefore, [state which side is stronger, or give a short balanced recommendation, in simple words] because [short reason].`
  },

  positive_negative_impact: {
    bp1Role: "the positive effects",
    bp2Role: "the negative effects",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Some people see this change as positive, while others see it as negative. In my opinion, it is a [mainly positive / mainly negative] development. This essay will look at both sides with examples.`,
    bp1: `To begin with, one important positive effect of [topic] is that [positive effect 1]. For example, [insert a simple everyday example related to this effect]. Additionally, another benefit is that [positive effect 2]. For example, [insert a simple everyday example related to this effect].`,
    bp2: `On the other hand, one major negative effect is that [negative effect 1]. For example, [insert a simple everyday example related to this effect]. Furthermore, [negative effect 2] can also cause problems for some people. For example, [insert a simple everyday example related to this effect].`,
    concl: `In conclusion, [topic rephrased] brings both positive and negative effects. Therefore, I believe it is a [mainly positive / mainly negative] development because [your strongest reason in a few words].`
  },

  problem_solution: {
    bp1Role: "the main problems or causes",
    bp2Role: "practical solutions matched to them",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This situation creates several [problems / difficulties] for [affected group in simple words]. This essay will discuss the main [problems / causes] and suggest some practical solutions.`,
    bp1: `To begin with, one major [problem / cause] is that [problem or cause 1]. For example, [insert a simple everyday example related to it]. Additionally, another serious [problem / cause] is that [problem or cause 2]. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, there are practical solutions to these [problems / causes]. One useful step is to [solution 1], which helps to deal with the first [problem / cause]. For example, [insert a short everyday example of how it helps]. Furthermore, another helpful measure is to [solution 2], which answers the second [problem / cause]. For example, [insert a short everyday example of how it helps].`,
    concl: `In conclusion, [topic rephrased] causes real [problems / difficulties], but they can be reduced with the right actions. Therefore, [restate the strongest solution] should be the first step because [short reason].`
  },

  cause_effect: {
    bp1Role: "the main causes",
    bp2Role: "the effects that follow",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This essay will explain the main [causes / problems] of this situation and the effects it has on [affected group in simple words].`,
    bp1: `To begin with, one major [cause / problem] is that [cause 1]. For example, [insert a simple everyday example related to it]. Additionally, another important [cause / problem] is that [cause 2]. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, these [causes / problems] lead to serious effects. One clear effect is that [effect 1]. For example, [insert a simple everyday example related to it]. Furthermore, [effect 2] is another result that affects many people. For example, [insert a simple everyday example related to it].`,
    concl: `In conclusion, [topic rephrased] happens for clear reasons and has real effects on daily life. Therefore, understanding [restate the main cause in a few words] is the first step to dealing with [the main effect in a few words].`
  },

  single_best_option: {
    bp1Role: "why the chosen problem is the most serious",
    bp2Role: "practical solutions for it",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. There are many serious problems in this area, but I believe the most pressing one is [chosen problem]. This essay will explain why this problem is so serious and what can be done about it.`,
    bp1: `To begin with, [chosen problem] is the most serious issue because [cause or challenge 1]. For example, [insert a simple everyday example related to it]. Additionally, [cause or challenge 2] makes the situation worse. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, there are practical solutions to this problem. One useful step is to [solution 1]. For example, [insert a short everyday example of how it helps]. Furthermore, another helpful measure is to [solution 2]. For example, [insert a short everyday example of how it helps].`,
    concl: `In conclusion, [chosen problem rephrased] is the most pressing problem and needs quick action. Therefore, [restate the strongest solution] should be the first step because [short reason].`
  },

  single_best_option_focus: {
    bp1Role: "why the chosen area matters most",
    bp2Role: "examples and practical solutions for that area",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This is a very broad topic, so this essay will focus on one area: [chosen focus area]. This essay will explain why this area matters and give examples and practical solutions for it.`,
    bp1: `To begin with, [chosen focus area] is an important area because [reason 1]. For example, [insert a simple everyday example related to it]. Additionally, [reason 2] also shows why this area needs attention. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, there are practical ways to deal with [chosen focus area]. One useful step is to [example or solution 1]. For example, [insert a short everyday example of how it helps]. Furthermore, another helpful step is to [example or solution 2]. For example, [insert a short everyday example of how it helps].`,
    concl: `In conclusion, [chosen focus area rephrased] is the area that deserves the most attention. Therefore, [restate the strongest example or solution] is the best way forward because [short reason].`
  },

  discuss_both_views: {
    bp1Role: "reasons behind the first view",
    bp2Role: "reasons behind the second view",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Some people believe that [view A in simple words], while others think that [view B in simple words]. This essay will discuss both views and then give my own opinion.`,
    bp1: `To begin with, people who support the first view say that [reason for view A]. For example, [insert a simple everyday example related to it]. Additionally, they also believe that [second reason for view A]. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, people who support the second view argue that [reason for view B]. For example, [insert a simple everyday example related to it]. Furthermore, they point out that [second reason for view B]. For example, [insert a simple everyday example related to it].`,
    concl: `In conclusion, both views have their own reasons. Therefore, in my opinion, [state which view you support in simple words] because [your strongest reason in a few words].`
  },

  responsibility: {
    bp1Role: "why the chosen group holds the main responsibility",
    bp2Role: "the supporting role and limits of the other groups",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. People disagree about who should take the main responsibility for this issue. In my opinion, [chosen group: the government / companies / individuals] should carry the main responsibility. This essay will explain my reasons with examples.`,
    bp1: `To begin with, [chosen group] should take the main responsibility because [reason 1]. For example, [insert a simple everyday example related to it]. Additionally, [reason 2] also shows why [chosen group] is in the best position to act. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, the other groups also have a supporting role. [Other group] can help by [supporting action]. For example, [insert a simple everyday example related to it]. However, they cannot solve the problem alone because [limitation in simple words].`,
    concl: `In conclusion, while everyone has a part to play, [chosen group rephrased] should lead the effort. Therefore, [restate who is mainly responsible] because [your strongest reason in a few words].`
  },

  two_option_preference: {
    bp1Role: "reasons for your chosen option",
    bp2Role: "brief contrast or further support, ending on your choice",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Some people prefer [option A in simple words], while others prefer [option B in simple words]. In my opinion, [chosen option] is the better choice. This essay will explain my preference with clear reasons and examples.`,
    bp1: `To begin with, one important reason I prefer [chosen option] is that [reason 1]. For example, [insert a simple everyday example related to it]. Additionally, another key reason is that [reason 2]. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, [the other option] also has some good points, such as [brief contrast point OR a third supporting reason]. For example, [insert a simple everyday example related to it]. However, I still believe [chosen option] is better because [short explanation].`,
    concl: `In conclusion, both options have their own value, but [chosen option rephrased] works better for most people. Therefore, I would choose [chosen option] because [your strongest reason in a few words].`
  },

  example_specific: {
    bp1Role: "your main reasons with concrete everyday examples",
    bp2Role: "how the measure looks in real daily life",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This question is about one specific measure: [restate the rule or measure in simple words]. In my opinion, [state your position on this measure clearly]. This essay will explain my position with real, everyday examples.`,
    bp1: `To begin with, one important reason for my position is that [main point 1]. For example, [insert a very concrete everyday example related to it]. Additionally, another key reason is that [main point 2]. For example, [insert a very concrete everyday example related to it].`,
    bp2: `On the other hand, this measure can also be judged by daily life. One clear point is that [supporting point or example 1]. For example, [insert a very concrete everyday situation related to it]. Furthermore, [supporting point or example 2] shows the same idea in practice. For example, [insert a very concrete everyday situation related to it].`,
    concl: `In conclusion, [restate the measure in fresh words] should be judged by how it works in real life. Therefore, I [restate your position in fresh simple words] because [your strongest reason in a few words].`
  },

  policy_recommendation: {
    bp1Role: "your first recommended actions and why they work",
    bp2Role: "further measures and the support they need",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This situation calls for clear and practical action. This essay will recommend some useful steps and explain why they can work.`,
    bp1: `To begin with, one useful step is to [recommended action 1]. This works because [short reason in simple words]. For example, [insert a simple everyday example of how it helps]. Additionally, another helpful step is to [recommended action 2]. For example, [insert a simple everyday example of how it helps].`,
    bp2: `On the other hand, good plans also need support to work in real life. One more practical measure is to [recommended action or support 1]. For example, [insert a simple everyday example of how it helps]. Furthermore, [recommended action or support 2] will make the results stronger. For example, [insert a simple everyday example of how it helps].`,
    concl: `In conclusion, [topic rephrased] can be improved with practical steps. Therefore, [restate the action that should come first] should be the starting point because [short reason].`
  },

  rights_ethics: {
    bp1Role: "your moral reasons (fairness, harm, freedom, honesty)",
    bp2Role: "the opposing moral view and why it is weaker",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This question asks whether [restate the issue in simple words] is right or fair. In my opinion, [state your moral position clearly in simple words]. This essay will explain my position with clear reasons and examples.`,
    bp1: `To begin with, one important reason for my position is that [moral reason 1, such as fairness, harm, freedom, or honesty]. For example, [insert a simple everyday example related to it]. Additionally, another key reason is that [moral reason 2]. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, some people see this issue differently. They may argue that [opposing point or further reason 1]. For example, [insert a simple everyday example related to it]. However, [answer that point in simple words], and [opposing point or further reason 2] does not change the main question of right and wrong.`,
    concl: `In conclusion, [restate the issue in fresh words] is a question of what is right, not only what is useful. Therefore, I believe [restate your moral position in fresh simple words] because [your strongest reason in a few words].`
  },

  future_prediction: {
    bp1Role: "the changes you predict, with early signs today",
    bp2Role: "the conditions and factors that shape the outcome",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This question asks what will happen in the future. In my opinion, [state your clear prediction in simple words]. This essay will explain the reasons behind my prediction with examples.`,
    bp1: `To begin with, one important change I expect is that [predicted change 1]. For example, [insert a simple everyday example of early signs we can already see today]. Additionally, another likely change is that [predicted change 2]. For example, [insert a simple everyday example of early signs related to it].`,
    bp2: `On the other hand, the future also depends on some conditions. One key factor is that [factor or further change 1]. For example, [insert a simple everyday example related to it]. Furthermore, [factor or further change 2] could also shape the outcome. For example, [insert a simple everyday example related to it].`,
    concl: `In conclusion, [topic rephrased] is likely to change in clear ways. Therefore, I predict that [restate your prediction in fresh simple words] because [your strongest reason in a few words].`
  },

  social_impact: {
    bp1Role: "the first big effects on society",
    bp2Role: "further effects on how people live together",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This trend affects not only individuals but society as a whole. This essay will discuss its main effects on society, such as families, communities, and workplaces.`,
    bp1: `To begin with, one important social effect is that [social effect 1]. For example, [insert a simple everyday example about families, neighbours, or workplaces]. Additionally, another key effect is that [social effect 2]. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, society also feels this trend in other ways. One further effect is that [social effect 3]. For example, [insert a simple everyday example related to it]. Furthermore, [social effect 4] changes how people live together. For example, [insert a simple everyday example related to it].`,
    concl: `In conclusion, [topic rephrased] has real effects on how people live together. Therefore, [sum up the overall effect on society in simple words] because [your strongest reason in a few words].`
  },

  education_effectiveness: {
    bp1Role: "where and why the approach works",
    bp2Role: "its limits and what it depends on",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. This question asks whether [restate the teaching or learning approach in simple words] really works. In my opinion, [state your verdict in simple words]. This essay will judge this approach with clear examples.`,
    bp1: `To begin with, this approach works well in some ways. One important strength is that [strength 1]. For example, [insert a simple classroom or study example related to it]. Additionally, [strength 2] also helps students. For example, [insert a simple classroom or study example related to it].`,
    bp2: `On the other hand, this approach also has limits. One clear weakness is that [weakness or condition 1]. For example, [insert a simple classroom or study example related to it]. Furthermore, [weakness or condition 2] can reduce its results. For example, [insert a simple classroom or study example related to it].`,
    concl: `In conclusion, [restate the approach in fresh words] has both strengths and limits. Therefore, my verdict is that [state your final judgement in simple words] because [your strongest reason in a few words].`
  },

  importance_reasons: {
    bp1Role: "why the goal is important",
    bp2Role: "the obstacles that make it hard to achieve",
    intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Most people agree that [restate the goal in simple words] matters, but it is not easy to achieve. This essay will explain why it is important and why it is difficult to reach.`,
    bp1: `To begin with, [the goal] is important for clear reasons. One key reason is that [reason for importance 1]. For example, [insert a simple everyday example related to it]. Additionally, [reason for importance 2] also shows its value. For example, [insert a simple everyday example related to it].`,
    bp2: `On the other hand, reaching [the goal] is difficult in real life. One major obstacle is that [obstacle 1]. For example, [insert a simple everyday example related to it]. Furthermore, [obstacle 2] makes it even harder. For example, [insert a simple everyday example related to it].`,
    concl: `In conclusion, [the goal rephrased] is important, yet hard to achieve. Therefore, [name the biggest obstacle in a few words] is the main challenge that people must understand first.`
  }
};

/* Relation/legacy variants that share a skeleton. */
const TYPE_TEMPLATE_ALIASES = {
  advantages_disadvantages_opinion: "advantages_disadvantages",
  causes_solutions: "problem_solution",
  problems_solutions: "problem_solution",
  cause_solution: "problem_solution",
  problem_effect: "cause_effect",
  causes_effects: "cause_effect",
  problems_effects: "cause_effect",
  compare_two_sides: "advantages_disadvantages",
  blessing_curse: "positive_negative_impact",
  positive_negative_impacts: "positive_negative_impact",
  single_focus: "two_option_preference"
};

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

/* Band 6 swaps in the per-type frame; every other template passes through. */
function getEffectiveTemplateForEssay(e, template) {
  const bag = getTemplatesBag();
  const effectiveTplKey = (e.templateChoice && e.templateChoice !== 'default') ? e.templateChoice : (bag.default || 'band9');
  if (effectiveTplKey !== 'band6') return template;
  const t = getActiveQuestionType(e);
  const isFocus = (t === 'single_best_option') && (e.secondaryFeatures || []).includes('focus_area');
  const structureKey = isFocus ? 'single_best_option_focus' : t;
  return getTypeTemplateStructure(structureKey, template);
}

function getDefaultTemplates() {
  return {
    band6: BAND6_TEMPLATE,
    band9: BAND9_TEMPLATE,
    custom: BAND9_TEMPLATE,
    default: 'band9'
  };
}

function cleanAndParseJSON(text) {
  if (typeof text !== 'string') return text;
  let cleaned = text.trim();
  
  // Remove markdown code block markers
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  
  // Find first '{' or '[' and last '}' or ']'
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIndex = -1;
  let endIndex = -1;
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    endIndex = cleaned.lastIndexOf('}');
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    endIndex = cleaned.lastIndexOf(']');
  }
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    cleaned = cleaned.substring(startIndex, endIndex + 1);
  }
  
  // Strip lines starting with // (comment lines)
  cleaned = cleaned.replace(/^\s*\/\/.*$/gm, '');

  // Strip block comments: /* ... */
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

  // Strip trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn("Standard JSON parse failed, attempting quote/smart quote healing. Error:", err.message);
    
    // Attempt to replace smart quotes
    cleaned = cleaned
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

    try {
      return JSON.parse(cleaned);
    } catch (err2) {
      throw new Error(`JSON parsing failed: ${err2.message}. Response snippet: ${text.slice(0, 200)}...`);
    }
  }
}

const LocalStore = {
  get(k){ try{ const i=localStorage.getItem(k); return i?JSON.parse(i):null; }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } },
  remove(k){ try{ localStorage.removeItem(k); return true; }catch(e){ return false; } },
  getUserId(){ return localStorage.getItem('pte_user_id') || ''; },
  setUserId(id){ try{ localStorage.setItem('pte_user_id', id); }catch(e){} }
};

// Account names are stored lowercase by the API.  Always use that canonical
// identity for local keys and sync URLs so logging in as "Student" on one
// device and "student" on another reaches the same cloud record.
function canonicalClientUserId(value) {
  if (window.EssayAttemptSync?.canonicalUserId) return window.EssayAttemptSync.canonicalUserId(value);
  return String(value || '').trim().toLowerCase();
}

// All practice uses the same signed-in account. Browser storage is the
// recovery queue; the authenticated sync endpoint is the durable copy.
const accountProgressMemory = new Map();
const accountCloudSnapshot = new Map();
function localAccountProgress(uid = currentUserId) {
  uid = canonicalClientUserId(uid);
  const get = suffix => LocalStore.get(`pte_${uid}_${suffix}`);
  const scratch = get('scratch') || {}, scratchUpdatedAt = get('scratchUpdatedAt') || {};
  const cached = {
    attempted: get('attempted') || [], summaries: get('summaries') || {}, scores: get('scores') || {}, history: get('history') || {},
    essays: get('essays') || [], essayLibraryDeleted: get('essayLibraryDeleted') || {}, vocabProgress: get('vocabProgress') || {},
    scratch: Object.fromEntries(Object.entries(scratch).map(([id, text]) => [id, { text, updatedAt: scratchUpdatedAt[id] || 0 }])),
    essayDraft: LocalStore.get('ipt_essay_draft_v1:' + encodeURIComponent(uid)),
    readingProgress: LocalStore.get('ipt_reading_v1:' + encodeURIComponent(uid)) || {}
  };
  return window.AccountProgress.mergeProgress(accountProgressMemory.get(uid) || {}, cached);
}

function cacheAccountProgress(data, uid = currentUserId) {
  uid = canonicalClientUserId(uid);
  accountProgressMemory.set(uid, data);
  let saved = true;
  const set = (key, value) => { if (!LocalStore.set(key, value)) saved = false; };
  for (const key of ['attempted', 'summaries', 'scores', 'history', 'essays', 'essayLibraryDeleted', 'vocabProgress']) set(`pte_${uid}_${key}`, data[key]);
  set(`pte_${uid}_scratch`, Object.fromEntries(Object.entries(data.scratch || {}).map(([id, value]) => [id, value.text || ''])));
  set(`pte_${uid}_scratchUpdatedAt`, Object.fromEntries(Object.entries(data.scratch || {}).map(([id, value]) => [id, value.updatedAt || 0])));
  set('ipt_reading_v1:' + encodeURIComponent(uid), data.readingProgress);
  if (data.essayDraft) set('ipt_essay_draft_v1:' + encodeURIComponent(uid), data.essayDraft);
  return saved;
}

function captureAccountProgress() {
  if (!currentUserId || !userProfile || !window.AccountProgress) return null;
  const cached = localAccountProgress();
  const library = window.AccountProgress.stampLibrary(essays, cached.essays, cached.essayLibraryDeleted);
  essays = library.essays;
  const progress = { ...cached, ...library,
    attempted: [...new Set([...cached.attempted, ...attempted])],
    vocabProgress: window.AccountProgress.stampVocab(userProfile.vocabProgress, cached.vocabProgress)
  };
  userProfile.vocabProgress = progress.vocabProgress;
  cacheAccountProgress(progress);
  return progress;
}

function receiveAccountProgress(remote, initial = false) {
  if (!currentUserId || !window.AccountProgress) return remote;
  accountCloudSnapshot.set(canonicalClientUserId(currentUserId), remote);
  const local = initial ? localAccountProgress() : captureAccountProgress() || localAccountProgress();
  const merged = window.AccountProgress.mergeProgress(remote, local);
  cacheAccountProgress(merged);
  attempted = new Set(merged.attempted);
  essays = merged.essays;
  if (userProfile) userProfile.vocabProgress = merged.vocabProgress;
  if (!initial) {
    window.ReadingPractice?.receiveProgress?.(merged.readingProgress, currentUserId);
    const editing = document.activeElement?.matches?.('input,textarea,[contenteditable="true"]');
    if (!editing) {
      if (!currentId || !getCurrent()) currentId = essays[0]?.id || null;
      renderList(); loadCurrent(); renderPreview();
      if (currentVocabCategory) renderVocabMain();
      updateVocabProgressSummary();
      const input = document.getElementById('summaryInput');
      if (input) { input.value = merged.summaries[currentPassageId]?.text || ''; onSummaryInput(); }
      const scratch = document.getElementById('scratchInput');
      if (scratch) scratch.value = merged.scratch[currentPassageId]?.text || '';
      if (practiceState.view === 'write' && !practiceSubmissionPending && window.AccountProgress.time(merged.essayDraft?.updatedAt) > portalDraftRevision) {
        restorePortalEssayDraft();
        if (document.getElementById('practiceScreen')?.classList.contains('show')) renderPracticeMain();
      }
    }
    updatePortalResume(); updateDashboard();
  }
  return { ...remote, ...merged };
}

function accountSyncPayload(full) {
  const previous = accountCloudSnapshot.get(canonicalClientUserId(currentUserId)) || {};
  const delta = window.AccountProgress.progressDelta(previous, full);
  const oldAttempts = new Map((previous.practiceHistory || []).map(a => [String(a.id), a]));
  return { ...delta, email: full.email, templates: full.templates, currentId: full.currentId, quotaUsed: full.quotaUsed, quotaDate: full.quotaDate,
    practiceHistory: full.practiceHistory.filter(a => !window.AccountProgress.equal(a, oldAttempts.get(String(a.id)))),
    practiceHistoryDeleted: full.practiceHistoryDeleted.filter(id => !(previous.practiceHistoryDeleted || []).includes(id)) };
}

function practiceHistoryCacheKey(uid = currentUserId) {
  const id = canonicalClientUserId(uid);
  return id ? `pte_${id}_practiceHistory` : 'ipt_practice';
}

function practiceHistoryDeletedCacheKey(uid = currentUserId) {
  const id = canonicalClientUserId(uid);
  return id ? `pte_${id}_practiceHistoryDeleted` : 'ipt_practice_deleted';
}

function getCachedPracticeHistory(uid = currentUserId) {
  const value = LocalStore.get(practiceHistoryCacheKey(uid));
  return Array.isArray(value) ? value : [];
}

function getCachedPracticeHistoryDeleted(uid = currentUserId) {
  const value = LocalStore.get(practiceHistoryDeletedCacheKey(uid));
  return Array.isArray(value) ? value : [];
}

function cachePracticeHistory(history, deleted = practiceHistoryDeleted, uid = currentUserId) {
  LocalStore.set(practiceHistoryCacheKey(uid), Array.isArray(history) ? history : []);
  LocalStore.set(practiceHistoryDeletedCacheKey(uid), Array.isArray(deleted) ? deleted : []);
}

function mergePracticeHistoryClient(serverHistory, localHistory, deleted = []) {
  if (window.EssayAttemptSync?.mergeHistory) {
    return window.EssayAttemptSync.mergeHistory(serverHistory, localHistory, deleted);
  }
  const removed = new Set((deleted || []).map(id => String(id)));
  const byId = new Map();
  [...(serverHistory || []), ...(localHistory || [])].forEach(item => {
    if (!item || typeof item !== 'object' || (item.id && removed.has(String(item.id)))) return;
    const key = item.id ? String(item.id) : `${item.date || item.timestamp || ''}|${item.essayText || ''}`;
    const previous = byId.get(key);
    const time = Number(item.updatedAt || item.date || Date.parse(item.timestamp || '') || 0);
    const previousTime = Number(previous?.updatedAt || previous?.date || Date.parse(previous?.timestamp || '') || 0);
    if (!previous || time >= previousTime) byId.set(key, { ...item });
  });
  return [...byId.values()].sort((a, b) => (Number(b.updatedAt || b.date || 0) - Number(a.updatedAt || a.date || 0))).slice(0, 50);
}

function mergePracticeDeletedClient(serverDeleted, localDeleted) {
  if (window.EssayAttemptSync?.mergeDeleted) return window.EssayAttemptSync.mergeDeleted(serverDeleted, localDeleted);
  return [...new Set([...(serverDeleted || []), ...(localDeleted || [])].map(id => String(id).trim()).filter(Boolean))].slice(-200);
}

// ============================================================
//  AUTH FLOW
// ============================================================
function showLogin() {
  if (portalWorkspace) portalWorkspace.reset();
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
  document.body.style.overflow = 'hidden';
}
function hideLogin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'grid';
  document.body.style.overflow = '';
}

let isSignupMode = false;
function toggleSignupMode(signup) {
  isSignupMode = signup;
  document.getElementById('loginForm').style.display = isSignupMode ? 'none' : 'block';
  document.getElementById('registerForm').style.display = isSignupMode ? 'block' : 'none';
  document.getElementById('forgotPasswordForm').style.display = 'none';
  hideLoginError();
  hideRegisterError();
  hideForgotPasswordError();
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideLoginError() { document.getElementById('loginError').classList.remove('show'); }

function showRegisterError(msg) {
  const el = document.getElementById('registerError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideRegisterError() { document.getElementById('registerError').classList.remove('show'); }

const SECRET_QUESTIONS_MAP = {
  pet: "What was the name of your first pet?",
  school: "What primary school did you attend?",
  city: "What city were you born in?",
  mother: "What is your mother's maiden name?",
  food: "What is your favourite food?",
  friend: "What was your childhood best friend's name?"
};

function toggleForgotPasswordMode(show) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const forgotForm = document.getElementById('forgotPasswordForm');
  
  if (show) {
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    forgotForm.style.display = 'block';
    
    document.getElementById('forgotPassFormStep1').style.display = 'block';
    document.getElementById('forgotPassFormStep2').style.display = 'none';
    document.getElementById('forgotUsername').disabled = false;
    document.getElementById('forgotUsername').value = '';
    document.getElementById('forgotAnswer').value = '';
    document.getElementById('forgotNewPassword').value = '';
    hideForgotPasswordError();
  } else {
    forgotForm.style.display = 'none';
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
    hideLoginError();
  }
}

function showForgotPasswordError(msg) {
  const el = document.getElementById('forgotPasswordError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideForgotPasswordError() {
  const el = document.getElementById('forgotPasswordError');
  if (el) el.classList.remove('show');
}

async function handleRequestSecretQuestion(ev) {
  ev.preventDefault();
  const u = document.getElementById('forgotUsername').value.trim();
  const btn = document.getElementById('forgotStep1Btn');
  btn.disabled = true;
  btn.textContent = 'Searching...';
  hideForgotPasswordError();
  
  try {
    const r = await fetch(API_URL + '/api/auth/secret-question/' + encodeURIComponent(u));
    const d = await r.json();
    if (d.success) {
      const questionKey = d.secretQ;
      const questionText = SECRET_QUESTIONS_MAP[questionKey] || questionKey || "Please answer your security question";
      
      document.getElementById('forgotQuestionDisplay').textContent = questionText;
      document.getElementById('forgotPassFormStep1').style.display = 'none';
      document.getElementById('forgotPassFormStep2').style.display = 'block';
      document.getElementById('forgotUsername').disabled = true;
    } else {
      showForgotPasswordError(d.error || 'Username not found or has no security question.');
    }
  } catch (e) {
    showForgotPasswordError('Connection error. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

async function handleResetPasswordSubmit(ev) {
  ev.preventDefault();
  const u = document.getElementById('forgotUsername').value.trim();
  const sa = document.getElementById('forgotAnswer').value.trim();
  const npw = document.getElementById('forgotNewPassword').value;
  const btn = document.getElementById('forgotStep2Btn');
  
  if (npw.length < 4) {
    showForgotPasswordError('Password must be at least 4 characters.');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Resetting...';
  hideForgotPasswordError();
  
  try {
    const r = await fetch(API_URL + '/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, secretAnswer: sa, newPassword: npw })
    });
    const d = await r.json();
    if (d.success) {
      alert('Password reset successfully! You can now log in.');
      toggleForgotPasswordMode(false);
    } else {
      showForgotPasswordError(d.error || 'Reset failed.');
    }
  } catch (e) {
    showForgotPasswordError('Connection error. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reset password';
  }
}

async function handleLoginSubmit(ev) {
  ev.preventDefault();
  const u = document.getElementById('loginUsername').value.trim();
  const pw = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  hideLoginError();
  try {
    const r = await fetch(API_URL+'/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:u,password:pw})
    });
    const d = await r.json();
    if(d.success){
      if(d.token) {
        sessionToken = d.token;
        localStorage.setItem('pte_session_token', d.token);
      }
      await enterApp(d.user?.username || canonicalClientUserId(u));
    } else {
      showLoginError(d.error || 'Login failed.');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  } catch(e){
    showLoginError('Connection error. Try again.');
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function handleRegisterSubmit(ev) {
  ev.preventDefault();
  const u = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pw = document.getElementById('regPassword').value;
  const sq = document.getElementById('regSecretQ').value;
  const sa = document.getElementById('regSecretA').value.trim();
  const btn = document.getElementById('regSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  hideRegisterError();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showRegisterError('Please enter a valid email address.');
    btn.disabled = false;
    btn.textContent = 'Create account';
    return;
  }
  if (email.toLowerCase().endsWith('@ptewriting.com')) {
    showRegisterError('Cannot use a @ptewriting.com email address.');
    btn.disabled = false;
    btn.textContent = 'Create account';
    return;
  }

  try {
    const r = await fetch(API_URL+'/api/auth/register',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:u,password:pw,secretQ:sq,secretA:sa,email:email})
    });
    const d = await r.json();
    if(d.success){
      if(d.token) {
        sessionToken = d.token;
        localStorage.setItem('pte_session_token', d.token);
      }
      await enterApp(d.user?.username || canonicalClientUserId(u));
    } else {
      showRegisterError(d.error || 'Registration failed.');
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  } catch(e){
    showRegisterError('Connection error. Try again.');
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
}

function signOutUser() {
  if (!confirm('Sign out of this account? Any changes waiting for a connection will be kept on this device.')) return;
  signOut();
}

function exitImpersonation() {
  sessionStorage.removeItem('pte_impersonate_token');
  const url = new URL(window.location);
  url.searchParams.delete('impersonate');
  window.history.replaceState({}, document.title, url.pathname + url.search);
  window.location.reload();
}
window.exitImpersonation = exitImpersonation;

function signOut() {
  savePortalEssayDraft();
  window.ReadingPractice?.leave();
  captureAccountProgress();
  flushPendingSyncOnExit();
  window.ReadingPractice?.reset();
  stopPracticeTimer();
  stopLoadingMessages();
  practiceState = emptyPracticeState();
  currentUserId = '';
  sessionToken = '';
  localStorage.removeItem('pte_session_token');
  sessionStorage.removeItem('pte_impersonate_token');
  LocalStore.setUserId('');
  userProfile = null;
  essays = [];
  currentId = null;
  practiceHistoryDeleted = [];
  syncQueued = false;
  clearTimeout(syncTimer);

  const banner = document.getElementById('impersonateBanner');
  if (banner) banner.style.display = 'none';

  showLogin();
  toggleSignupMode(false);
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginSubmitBtn').disabled = false;
  document.getElementById('loginSubmitBtn').textContent = 'Sign in';
  removeAdminPortalEntry();
}

async function changePassword() {
  const newPw = prompt('Enter your new password (minimum 4 characters):');
  if (!newPw) return;
  if (newPw.length < 4) { toast('Password must be at least 4 characters.', true); return; }
  try {
    const r = await fetch(API_URL+'/api/auth/change-password',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-session-token': sessionToken
      },
      body:JSON.stringify({ password: newPw })
    });
    const d = await r.json();
    if (d.success) {
      toast('Password changed successfully ✓');
    } else {
      toast('Failed: ' + d.error, true);
    }
  } catch (err) {
    toast('Connection error', true);
  }
}

// ============================================================
//  SYNC AND PERSISTENCE ENGINE
// ============================================================

async function enterApp(uid) {
  clearTimeout(portalDraftTimer);
  stopPracticeTimer();
  practiceState = emptyPracticeState();
  uid = canonicalClientUserId(uid);
  currentUserId = uid;
  offlineMode = false;
  currentUser = { uid: uid, email: uid.includes('@') ? uid : (uid + '@ptewriting.com') };
  LocalStore.setUserId(uid);
  document.getElementById('userAvatar').textContent = uid.slice(0, 2).toUpperCase();
  document.getElementById('userName').textContent = uid;
  hideLogin();
  portalWorkspace.activate('dashboard', { history: 'none', focus: false });
  
  // Load local or pull from server
  const ok = await loadUserData(uid);
  if (!ok) return;

  await loadPassages();
  loadStoredData();
  if (typeof loadPassage === 'function') loadPassage(1);
  showSwtScreen('swtPracticeScreen');
  
  if (!currentId || !getCurrent()) {
    currentId = essays[0]?.id || null;
  }
  renderList();
  loadCurrent();
  renderPreview();
  setZoom(0.7);
  updateDashboard();
  restorePortalEssayDraft(true);
  portalWorkspace.start();
  checkAIStatus();
  removeAdminPortalEntry();

  // Prompt existing users if they don't have a real email address configured
  checkUserEmailRequirement();
}

async function loadUserData(uid) {
  uid = canonicalClientUserId(uid);
  const token = sessionToken;
  const sameSession = () => uid === canonicalClientUserId(currentUserId) && token === sessionToken;
  setSync('syncing', 'Loading...');
  try {
    const r = await fetch(API_URL + '/api/sync/' + encodeURIComponent(uid), {
      cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { 'x-session-token': token }
    });
    if (!sameSession()) return false;
    if (r.status === 401 || r.status === 403) {
      handleAuthExpired();
      return false;
    }
    if (!r.ok) throw Error('Account progress could not load');
    const d = await r.json();
    if (!sameSession()) return false;
    if (d.success && d.data) {
      const data = receiveAccountProgress(d.data, true);
      
      // Load SWT state components
      attempted = new Set(data.attempted || []);
      LocalStore.set(`pte_${uid}_attempted`, data.attempted || []);
      LocalStore.set(`pte_${uid}_summaries`, data.summaries || {});
      LocalStore.set(`pte_${uid}_scores`, data.scores || {});
      LocalStore.set(`pte_${uid}_history`, data.history || {});
      
      // Load Essay state components
      essays = data.essays || [];
      currentId = data.currentId || (essays[0]?.id || null);

      // Reconcile attempts from the cloud with this device's scoped cache.
      // The cache covers the short window before a debounced sync completes;
      // the server merge below then makes attempts from multiple devices
      // additive instead of last-write-wins.
      const serverDeleted = Array.isArray(data.practiceHistoryDeleted) ? data.practiceHistoryDeleted : [];
      const localDeleted = getCachedPracticeHistoryDeleted(uid);
      practiceHistoryDeleted = mergePracticeDeletedClient(serverDeleted, localDeleted);
      const serverPracticeHistory = Array.isArray(data.practiceHistory) ? data.practiceHistory : [];
      const localPracticeHistory = getCachedPracticeHistory(uid);
      const mergedPracticeHistory = mergePracticeHistoryClient(serverPracticeHistory, localPracticeHistory, practiceHistoryDeleted);
      const practiceNeedsPush = !window.EssayAttemptSync?.sameHistory
        ? JSON.stringify(mergedPracticeHistory) !== JSON.stringify(serverPracticeHistory)
        : !window.EssayAttemptSync.sameHistory(mergedPracticeHistory, serverPracticeHistory)
          || practiceHistoryDeleted.some(id => !serverDeleted.includes(id));
      cachePracticeHistory(mergedPracticeHistory, practiceHistoryDeleted, uid);
      
      userProfile = {
        email: data.email || '',
        quotaUsed: data.quotaUsed || { essay: 0, idea: 0 },
        quotaDate: data.quotaDate || todayStamp(),
        practiceHistory: mergedPracticeHistory,
        practiceHistoryDeleted,
        vocabProgress: data.vocabProgress || {},
        templates: data.templates || { band6: BAND6_TEMPLATE, band9: BAND9_TEMPLATE, custom: BAND9_TEMPLATE, default: 'band9' }
      };
      if (userProfile.email) {
        currentUser.email = userProfile.email;
      }
      if (userProfile.templates && userProfile.templates.band9TemplateVersion) {
        userProfile.band9TemplateVersion = userProfile.templates.band9TemplateVersion;
      }

      // Keep a recovery copy for this account, without mixing users on a
      // shared browser.  It is only used when a later pull cannot reach the
      // server.
      LocalStore.set(`pte_${uid}_essays`, essays);
      LocalStore.set(`pte_${uid}_currentId`, currentId);
      
      // Seed first time if essays are empty
      if (essays.length === 0) {
        const seeded = SEED_TOPICS.map((t, i) => ({
          id: 'seed_' + i,
          title: t.title,
          question: t.question,
          explanation: t.explanation,
          badge: t.badge || '',
          pros: '', cons: '', approach: '',
          intro: '', bp1: '', bp2: '', concl: '',
          vocab: 3,
          seedIdeas: '',
          questionType: t.type || '',
          secondaryFeatures: t.secondaryFeatures || []
        }));
        essays = seeded;
        currentId = seeded[0].id;
        userProfile.templates = { band6: BAND6_TEMPLATE, band9: BAND9_TEMPLATE, custom: BAND9_TEMPLATE, default: 'band9' };
        
        // Sync the newly seeded profile to cloud
        await flushSyncDirect();
      } else {
        const changed = syncSeedTopics();
        if (changed) {
          await flushSyncDirect();
        }
      }

      // Reset daily quota if it's a new day
      if (userProfile.quotaDate !== todayStamp()) {
        userProfile.quotaUsed = { essay: 0, idea: 0 };
        userProfile.quotaDate = todayStamp();
        await flushSyncDirect();
      }

      if (practiceNeedsPush || !window.AccountProgress.equal(window.AccountProgress.mergeProgress(d.data, {}), window.AccountProgress.mergeProgress(data, {}))) {
        syncQueued = true;
        await flushSyncDirect();
      }

      setSync(syncQueued ? 'error' : 'synced', syncQueued ? 'Saved on this device — waiting to sync' : 'Synced across devices');
      maybeOfferDraftRecovery();
      return true;
    }
    return false;
  } catch (err) {
    if (!sameSession()) return false;
    console.error(err);
    setSync('error', 'Sync failed');
    toast('Failed to load your data from cloud. Working offline.', true);
    offlineMode = true;
    // Preserve any scored attempts made on this device and make them
    // available immediately; the queue will retry when connectivity returns.
    practiceHistoryDeleted = getCachedPracticeHistoryDeleted(uid);
    const cachedPracticeHistory = getCachedPracticeHistory(uid);
    const cachedEssays = LocalStore.get(`pte_${uid}_essays`);
    if (Array.isArray(cachedEssays)) {
      essays = cachedEssays;
      currentId = LocalStore.get(`pte_${uid}_currentId`) || essays[0]?.id || null;
    }
    const cachedProgress = localAccountProgress(uid);
    attempted = new Set(cachedProgress.attempted);
    essays = cachedProgress.essays;
    userProfile = {
      email: '', quotaUsed: {}, quotaDate: todayStamp(),
      practiceHistory: cachedPracticeHistory, practiceHistoryDeleted,
      vocabProgress: cachedProgress.vocabProgress, templates: getDefaultTemplates()
    };
    syncQueued = true;
    return true; // continue in offline mode
  }
}

function handleAuthExpired() {
  toast('Session expired. Please log in again.', true);
  signOut();
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function queueSync() {
  // Keep the queue alive during a temporary network outage.  An authenticated
  // account can still retry later; only a signed-out/local-only session is
  // excluded.
  if (!currentUserId || !sessionToken) return;
  if (typeof captureAccountProgress === 'function') captureAccountProgress();
  syncQueued = true;
  LocalStore.set(`pte_${canonicalClientUserId(currentUserId)}_syncPending`, true);
  setSync('syncing', 'Saving to your account…');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 1200);
}

async function flushSync() {
  if (!syncQueued || !currentUserId || !sessionToken) return false;
  return flushSyncDirect();
}

async function flushSyncDirect(options = {}) {
  const syncUserId = canonicalClientUserId(currentUserId);
  const syncToken = sessionToken;
  if (!syncUserId || !syncToken) return false;
  const sameSession = () => canonicalClientUserId(currentUserId) === syncUserId && sessionToken === syncToken;
  if (syncInFlight) {
    // An immediate save must wait for its own data to be included, not merely
    // for an older request that captured the profile before this attempt.
    syncQueued = true;
    const sameFlight = syncInFlightSession?.uid === syncUserId && syncInFlightSession?.token === syncToken;
    const ok = await syncInFlight;
    if (!sameSession()) return false;
    if (!ok && sameFlight) return false;
    return syncQueued ? flushSyncDirect(options) : true;
  }
  syncQueued = false;
  let completed = false;
  syncInFlightSession = { uid: syncUserId, token: syncToken };
  syncInFlight = (async () => {
   try {
    if (userProfile && userProfile.templates) {
      userProfile.templates.band9TemplateVersion = userProfile.band9TemplateVersion || 0;
    }
    const accountProgress = typeof captureAccountProgress === 'function' ? captureAccountProgress() : null;
    const payload = {
      ...(accountProgress || {}),
      // SWT progress fields
      attempted: Array.from(attempted),
      history: LocalStore.get('pte_' + currentUserId + '_history') || {},
      summaries: LocalStore.get('pte_' + currentUserId + '_summaries') || {},
      scores: LocalStore.get('pte_' + currentUserId + '_scores') || {},
      
      // Email
      email: userProfile?.email || '',

      // Essay progress fields
      essays: essays,
      currentId: currentId,
      quotaUsed: userProfile?.quotaUsed || { essay: 0, idea: 0 },
      quotaDate: userProfile?.quotaDate || todayStamp(),
      practiceHistory: userProfile?.practiceHistory || [],
      practiceHistoryDeleted: practiceHistoryDeleted || userProfile?.practiceHistoryDeleted || [],
      vocabProgress: userProfile?.vocabProgress || {},
      templates: userProfile?.templates || { band6: BAND6_TEMPLATE, band9: BAND9_TEMPLATE, custom: BAND9_TEMPLATE, default: 'band9' }
    };

    const r = await fetch(API_URL + '/api/sync/' + encodeURIComponent(syncUserId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': syncToken
      },
      keepalive: !!options.keepalive,
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify(payload)
    });
    
    if (!sameSession()) return false;
    if (r.status === 401 || r.status === 403) {
      handleAuthExpired();
      return false;
    }
    if (!r.ok) throw new Error(`Sync push failed (${r.status})`);
    const response = await r.json().catch(() => ({}));
    if (!sameSession()) return false;
    if (response && response.success === false) throw new Error(response.error || 'Sync push rejected');
    if (response.progress && typeof receiveAccountProgress === 'function') receiveAccountProgress({ ...response.progress,
      practiceHistory: response.practiceHistory, practiceHistoryDeleted: response.practiceHistoryDeleted });
    if (Array.isArray(response.practiceHistory)) {
      const serverDeleted = Array.isArray(response.practiceHistoryDeleted) ? response.practiceHistoryDeleted : [];
      practiceHistoryDeleted = mergePracticeDeletedClient(serverDeleted, practiceHistoryDeleted);
      const merged = mergePracticeHistoryClient(response.practiceHistory, userProfile?.practiceHistory || [], practiceHistoryDeleted);
      if (userProfile) {
        userProfile.practiceHistory = merged;
        userProfile.practiceHistoryDeleted = practiceHistoryDeleted;
      }
      if (document.getElementById('practiceHistoryList')) renderPracticeHistory();
      updatePracticeStats();
      updateDashboard();
    }
    offlineMode = false;
    cachePracticeHistory(userProfile?.practiceHistory || payload.practiceHistory, practiceHistoryDeleted);
    LocalStore.set(`pte_${currentUserId}_essays`, essays || []);
    LocalStore.set(`pte_${currentUserId}_currentId`, currentId);
    LocalStore.set(`pte_${syncUserId}_syncPending`, syncQueued);
    setSync(syncQueued ? 'syncing' : 'synced', syncQueued ? 'Saving latest changes…' : 'Synced across devices');
    lastSyncOk = true;
    syncRetryCount = 0;
    safeLSRemove('ipt_unsaved_backup');
    completed = true;
    return true;
  } catch (err) {
    if (!sameSession()) return false;
    console.error(err);
    syncQueued = true;
    setSync('error', 'Saved on this device — waiting to sync');
    lastSyncOk = false;
    if (syncRetryCount < SYNC_MAX_RETRIES) {
      syncRetryCount++;
      setTimeout(() => { if (sameSession()) { syncQueued = true; flushSync(); } }, 5000);
    } else {
      setSync('error', 'Offline changes waiting to sync');
    }
    return false;
  }
  })();
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
    syncInFlightSession = null;
    if (completed && sameSession() && syncQueued) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(flushSync, 0);
    }
  }
}

async function refreshPracticeHistory(options = {}) {
  const uid = canonicalClientUserId(currentUserId), token = sessionToken;
  if (!uid || !token || !userProfile || document.visibilityState === 'hidden') return false;
  if (practiceRefreshInFlight) return practiceRefreshInFlight;
  if (!options.force && Date.now() - lastPracticeRefreshAt < 15000) return false;
  const sameSession = () => uid === canonicalClientUserId(currentUserId) && token === sessionToken;
  practiceRefreshInFlight = (async () => {
    try {
      // Reconcile every practice area. Field clocks preserve newer edits,
      // and active editors are never rebuilt by a background refresh.
      const response = await fetch(API_URL + '/api/sync/' + encodeURIComponent(uid), {
        cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'x-session-token': token }
      });
      if (!sameSession()) return false;
      if (response.status === 401 || response.status === 403) { handleAuthExpired(); return false; }
      if (!response.ok) throw new Error('Could not refresh cloud history');
      const body = await response.json();
      if (!sameSession() || !userProfile || !body.success || !body.data) return false;
      if (typeof receiveAccountProgress === 'function') receiveAccountProgress(body.data);
      const deleted = mergePracticeDeletedClient(body.data.practiceHistoryDeleted || [], practiceHistoryDeleted);
      const merged = mergePracticeHistoryClient(body.data.practiceHistory || [], getPracticeHistory(), deleted);
      practiceHistoryDeleted = deleted;
      userProfile.practiceHistoryDeleted = deleted;
      userProfile.practiceHistory = merged;
      cachePracticeHistory(merged, deleted, uid);
      lastPracticeRefreshAt = Date.now();
      renderPracticeHistory(); updatePracticeStats(); updateDashboard();
      if (!syncQueued && !syncInFlight) setSync('synced', 'Synced across devices');
      return true;
    } catch (error) {
      if (sameSession() && !syncQueued && !syncInFlight) setSync('error', 'Cloud sync unavailable — work is saved on this device');
      return false;
    }
  })();
  try { return await practiceRefreshInFlight; }
  finally { practiceRefreshInFlight = null; }
}

async function manualSync() {
  syncQueued = true;
  const ok = await flushSync();
  toast(ok ? 'Synced ✓' : 'Sync is pending — we will retry when connected.', !ok);
}

function setSync(state, text) {
  window.ReadingPractice?.setSyncStatus?.(state, text);
  const draft = document.getElementById('practiceDraftStatus');
  if (draft && practiceState.view === 'write') { draft.textContent = state === 'synced' ? 'Draft synced across devices' : text; draft.dataset.state = state; }
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  if (!dot || !txt) return;
  dot.className = 'sync-dot ' + state;
  txt.textContent = text;
  const practice = document.getElementById('practiceSyncStatus');
  if (practice) {
    practice.dataset.state = state;
    practice.textContent = state === 'synced' ? 'Progress synced across devices' : text;
  }
}

// A tab may be closed before a debounced request fires.  keepalive gives the
// browser a chance to finish the final profile write while pagehide/visibility
// transitions are still in progress.
function flushPendingSyncOnExit() {
  if (syncQueued && currentUserId && sessionToken) {
    flushSyncDirect({ keepalive: true }).catch(() => {});
  }
}
window.addEventListener('pagehide', flushPendingSyncOnExit);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPendingSyncOnExit();
  else resumeAccountSync();
});
window.addEventListener('focus', () => resumeAccountSync());
setInterval(() => {
  if (currentUserId && sessionToken && document.visibilityState !== 'hidden') resumeAccountSync();
}, 30000);
window.addEventListener('storage', event => {
  if (event.key?.startsWith('pte_' + currentUserId + '_') || event.key === 'ipt_reading_v1:' + encodeURIComponent(currentUserId)) resumeAccountSync();
});

async function resumeAccountSync() {
  if (!currentUserId || !sessionToken || !userProfile || document.visibilityState === 'hidden') return;
  if (syncQueued || LocalStore.get(`pte_${canonicalClientUserId(currentUserId)}_syncPending`)) { syncQueued = true; if (!await flushSync()) return; }
  return refreshPracticeHistory();
}

window.addEventListener('online', () => {
  if (!currentUserId || !sessionToken) return;
  offlineMode = false;
  syncQueued = true;
  flushSync().then(() => refreshPracticeHistory({ force: true }));
});

// ============================================================
//  QUOTA
// ============================================================
const DAILY_ESSAY_QUOTA = 20;
const DAILY_IDEA_QUOTA = 50;

function getQuota() {
  const usedE = userProfile?.quotaUsed?.essay || 0;
  const usedI = userProfile?.quotaUsed?.idea || 0;
  return {
    essay: DAILY_ESSAY_QUOTA - usedE,
    idea: DAILY_IDEA_QUOTA - usedI,
    essayMax: DAILY_ESSAY_QUOTA,
    ideaMax: DAILY_IDEA_QUOTA
  };
}

function updateQuotaChip() {
  const el = document.getElementById('quotaChip');
  if (el) el.style.display = 'none'; // Hide quota chip completely since quota is unlimited
}

async function consumeQuota(kind) {
  // Enforce no limits (unlimited practice attempts)
  if (userProfile) {
    if (!userProfile.quotaUsed) userProfile.quotaUsed = {};
    userProfile.quotaUsed[kind] = (userProfile.quotaUsed[kind] || 0) + 1;
    updateQuotaChip();
    queueSync();
  }
  return true;
}

// ============================================================
//  USER MENU
// ============================================================
function openUserMenu() {
  document.getElementById('userMenuEmail').textContent = (currentUser && currentUser.email) || (currentUserId.includes('@') ? currentUserId : (currentUserId + '@ptewriting.com'));
  const written = essays.filter(e => essayStatus(e) === 'written').length;
  document.getElementById('userMenuStats').innerHTML =
    `${essays.length} essays · ${written} written · Unlimited practice attempts`;
  document.getElementById('userMenuModal').classList.add('show');
}
function closeUserMenu() { document.getElementById('userMenuModal').classList.remove('show'); }

function importLocalEssays() {
  const raw = safeLSGet('ipt_essays_v2');
  if (!raw) { toast('No local essays found in this browser', true); return; }
  try {
    const local = JSON.parse(raw);
    if (!Array.isArray(local) || local.length === 0) { toast('No local essays found', true); return; }
    if (!confirm(`Found ${local.length} local essays. Merge them into your cloud account? Local essays with the same title will be skipped to avoid duplicates.`)) return;
    const existingTitles = new Set(essays.map(e => (e.title || '').toLowerCase().trim()));
    let added = 0;
    for (const e of local) {
      const t = (e.title || '').toLowerCase().trim();
      if (t && existingTitles.has(t)) continue;
      essays.push({ ...e, id: uid() });
      added++;
    }
    saveAll();
    renderList(); loadCurrent(); renderPreview();
    closeUserMenu();
    toast(`Imported ${added} essays from local browser`);
  } catch (err) {
    toast('Failed to read local essays', true);
  }
}

// ----- ADMIN PANEL -----
let adminUsersCache = [];

async function openAdmin() {
  removeAdminPortalEntry();
  return false;
}
function closeAdmin() {
  const modal = document.getElementById('adminModal');
  if (modal) modal.remove();
}

function isAdmin() {
  return false;
}

async function loadAdminUsers() {
  const list = document.getElementById('adminUserList');
  list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px; font-style:italic; font-family:var(--serif);">Loading users...</div>';
  try {
    const r = await fetch(API_URL + '/api/admin/users', {
      headers: { 'x-admin-key': adminKey }
    });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    const d = await r.json();
    adminUsersCache = (d.users || []).map(u => ({
      uid: u.username,
      email: u.username.includes('@') ? u.username : (u.username + '@ptewriting.com'),
      disabled: !!u.blocked,
      createdAt: u.created_at,
      essayCount: (u.essays || []).length,
      writtenCount: (u.essays || []).filter(e => (e.intro || '').length > 30 && (e.bp1 || '').length > 30).length,
      vocabRead: Object.keys(u.vocabProgress || {}).length,
      quizzes: (u.vocabProgress || {}).read ? Object.keys(u.vocabProgress.read).length : 0,
      practiceAttempts: (u.history ? Object.keys(u.history).length : 0)
    }));
    renderAdminUsers();
  } catch (err) {
    list.innerHTML = `<div style="color:var(--accent); padding:16px;">Failed to load users: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminUsers() {
  const q = (document.getElementById('adminSearch')?.value || '').toLowerCase().trim();
  const list = document.getElementById('adminUserList');
  const filtered = q
    ? adminUsersCache.filter(u => u.uid.toLowerCase().includes(q))
    : adminUsersCache;
  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px; font-style:italic; font-family:var(--serif);">No users match.</div>';
    return;
  }
  list.innerHTML = filtered.map(u => {
    const adminEmailLc = (window.FB?.adminEmail || 'admin@ptewriting.com').trim().toLowerCase();
    const adminPrefix = adminEmailLc.split('@')[0];
    const isThisAdmin = u.uid.toLowerCase() === 'admin' || (u.uid.includes('@') ? u.uid : (u.uid + '@ptewriting.com')).toLowerCase() === adminEmailLc || u.uid.toLowerCase() === adminPrefix;
    return `
    <div class="admin-user-row">
      <div>
        <div class="admin-user-email">${escapeHtml(u.uid)}</div>
        <div class="admin-user-meta">${u.writtenCount} written / ${u.essayCount} essays · ${u.vocabRead || 0} vocab read · ${u.practiceAttempts || 0} practice attempts</div>
      </div>
      <span class="admin-user-status ${u.disabled ? 'disabled' : 'active'}">${u.disabled ? 'Disabled' : 'Active'}</span>
      <button class="admin-btn" onclick="adminToggleUser('${u.uid}', ${!u.disabled})" ${isThisAdmin ? 'disabled style="opacity:0.4"' : ''}>${u.disabled ? 'Enable' : 'Disable'}</button>
      <button class="admin-btn danger" onclick="adminDeleteUser('${u.uid}', '${escapeHtml(u.uid).replace(/'/g, "\\'")}')" ${isThisAdmin ? 'disabled style="opacity:0.4"' : ''}>Delete</button>
    </div>
  `;}).join('');
}

async function adminToggleUser(uid, disabledNew) {
  try {
    const r = await fetch(API_URL + '/api/admin/block-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ username: uid, blocked: disabledNew })
    });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    const d = await r.json();
    if (d.success) {
      toast(`User ${disabledNew ? 'disabled' : 'enabled'}`);
      await loadAdminUsers();
    } else {
      throw new Error(d.error || 'Operation failed');
    }
  } catch (err) {
    toast('Failed: ' + err.message, true);
  }
}

async function adminDeleteUser(uid, email) {
  if (!confirm(`Delete account for user "${uid}"? This removes their data permanently. This cannot be undone.`)) return;
  try {
    const r = await fetch(API_URL + '/api/admin/delete-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ username: uid })
    });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    const d = await r.json();
    if (d.success) {
      toast('User deleted successfully');
      await loadAdminUsers();
    } else {
      throw new Error(d.error || 'Operation failed');
    }
  } catch (err) {
    toast('Failed: ' + err.message, true);
  }
}

// ============================================================
//  ALL 34 PRE-LOADED TOPICS
// ============================================================
const SEED_TOPICS = [
  { title: "Late Submission and Mark Deduction", question: "Some universities deduct marks from students' work if it is given in late. What is your opinion? Suggest some alternative actions.", explanation: "Examine deducting marks for late submissions and propose your opinion with alternative recommendations.", type: "opinion_alternatives" },
  { title: "Television as a Relaxation Tool and Companion", question: "Television serves many useful functions. It helps people to relax. Besides, it can also be seen as a companion for the lonely. To what extent do you agree with this? Explain why with your own experience.", explanation: "Evaluate whether television effectively helps people relax and acts as a companion for lonely individuals.", type: "agree_disagree" },
  { title: "Studying Old Plays and Theatre Works", question: "What are the problems and the benefits for high school students of studying plays and other works for theatre that were written centuries ago? Do you agree with it? Use your own experience to discuss it.", explanation: "Examine the benefits and problems of studying historical theatre in high schools using personal experience.", type: "advantages_disadvantages_opinion" },
  { title: "Combining Study and Employment", question: "Effective study requires time, comfort and peace. It is impossible to study with employment because one may distract the other. To what extent do you think the statements are realistic? Give your opinion with examples.", explanation: "Explore whether students can effectively combine work and study.", type: "agree_disagree" },
  { title: "Experiential Learning in Education", question: "Some people point that experiential learning (i.e. learning by doing it) can work well in formal education. However, others think a traditional form of teaching is the best. Do you think experiential learning can work well in high schools or colleges?", explanation: "Explore whether experiential learning is effective in high schools and colleges.", type: "education_effectiveness" },
  { title: "Digital Materials and Libraries", question: "With the increase of new digital media available online, the role of the library has become obsolete. Therefore universities should only procure digital materials rather than constantly update textbooks. Discuss both the advantages and disadvantages of this position and give your own point of view.", explanation: "Examine whether universities should replace physical libraries with digital-only resources.", type: "advantages_disadvantages_opinion" },
  { title: "Public Transport and Road Building", question: "As cities expand, governments should look forward to creating better networks of public transport available for everyone rather than building more roads for vehicle owning population. To what extent do you agree or disagree?", explanation: "Evaluate whether governments should prioritise public transport networks over new road construction.", type: "agree_disagree" },
  { title: "Tourism in Less Developed Countries", question: "For a less developed country, the disadvantages of tourism are as great as the advantages. Please discuss this statement, and give and explain your opinion.", explanation: "Evaluate whether tourism brings equal benefits and drawbacks to less developed nations.", type: "advantages_disadvantages_opinion" },
  { title: "Formal Written Examinations", question: "Many education systems assess students' learning using formal written examinations. Those kinds of exams are a valid method. To what extent do you agree or disagree? Give examples with your own experience.", explanation: "Evaluate formal written examinations as an assessment method using personal experience.", type: "agree_disagree" },
  { title: "Compulsory Foreign Language Learning", question: "Some people think learning a foreign language at school should be compulsory. To what extent do you agree with it? Use your experience or examples to support your viewpoint.", explanation: "Evaluate whether foreign language learning should be compulsory in schools.", type: "agree_disagree" },
  { title: "The Most Pressing Global Problem", question: "In today's world, different government and international organisations are confronting many global problems. What is the most pressing problem among them and give solutions?", explanation: "Select one global problem as most pressing and justify your choice with practical solutions.", type: "single_best_option" },
  { title: "Medical Technology and Life Expectancy", question: "The medical technology can increase the average life expectancy. Do you think it is a curse or a blessing?", explanation: "Determine whether increasing life expectancy through medical technology is beneficial or harmful.", type: "blessing_curse" },
  { title: "Parental Legal Responsibility", question: "Should parents be held legally responsible for the actions of their children? Support your opinion from your study, observations or experiences.", explanation: "Evaluate whether parents should bear legal responsibility for their children's behaviour.", type: "policy_recommendation" },
  { title: "Building Design and Daily Life", question: "Do you think the design of buildings affects, positively or negatively, where people live and work?", explanation: "Evaluate how building design influences living and working environments.", type: "positive_negative_impact" },
  { title: "Mass Media Influence on Young People", question: "The mass media, such as TV, radio and newspapers, have an influence on people, particularly on younger generations. It plays a pivotal role in shaping the opinions of people, especially teenagers and young people. To what extent do you agree with this? Please give examples.", explanation: "Evaluate the extent to which mass media shapes the opinions of teenagers and young people.", type: "agree_disagree" },
  { title: "Modern Inventions and Their Impact", question: "In our technological world, the number of new inventions has been evolving on a daily basis. Please describe a new invention and determine whether it brings beneficial or detrimental impact to society.", explanation: "Describe a modern invention and evaluate whether its societal impact is positive or negative.", type: "positive_negative_impact" },
  { title: "Workers in Decision-Making", question: "In some companies, employers involve workers in decision-making process about products and services. What are the advantages and disadvantages of such a policy?", explanation: "Examine the benefits and drawbacks of involving employees in company decision-making.", type: "advantages_disadvantages" },
  { title: "Age Restrictions", question: "Age restrictions are placed on many activities. It is believed that people should not do things until they reach the right ages, such as getting married, driving, voting, buying certain products, and doing particular things. Give an example, state which minimum age you think it should be and share your own experience.", explanation: "Evaluate age restrictions on activities and justify an appropriate minimum age with personal experience.", type: "example_specific" },
  { title: "Responsibility for Tackling Climate Change", question: "Climate change is a concerning global issue. Who should take the responsibilities, governments, big companies or individuals?", explanation: "Evaluate who bears primary responsibility for addressing climate change.", type: "responsibility" },
  { title: "Laws and Human Behaviour", question: "Some people think human behaviours can be limited by laws, and others think laws have little effect. What is your opinion?", explanation: "Evaluate whether laws effectively control human behaviour.", type: "discuss_both_views" },
  { title: "Shopping Malls Replacing Small Shops", question: "Large shopping malls are replacing small shops. What is your opinion on this? Do you think this is a good or bad change?", explanation: "Evaluate whether the replacement of small shops by large shopping malls is positive or negative.", type: "positive_negative_impact" },
  { title: "Youth Unemployment and Shorter Working Week", question: "Unemployment among young people is a serious problem. One solution has been suggested is to shorten the working week. What do you think are the advantages and disadvantages? Do you think this policy should apply to just young workers or the whole workforce?", explanation: "Evaluate shortening the working week to address youth unemployment.", type: "advantages_disadvantages" },
  { title: "Fewer Working Hours in the Future", question: "\"In the future, people will work fewer hours at their jobs than they do now.\" Do you agree with the statement? Please support your opinion with your own experience.", explanation: "Evaluate whether future working hours will decrease compared to present levels.", type: "agree_disagree" },
  { title: "Maximum Wage for High-Paying Jobs", question: "Some people say there should be a maximum wage for high-paying jobs. Do you support that? Can you give your point of view or your own experience?", explanation: "Evaluate whether maximum wage caps should be applied to high-paying jobs.", type: "policy_recommendation" },
  { title: "Famous People and the Right to Privacy", question: "People who are famous entertainers or sportspeople should give up the right to privacy, because this is the price of fame. To what extent do you agree/disagree with this point of view? Give your opinion with your experiences.", explanation: "Evaluate whether celebrities should sacrifice privacy as the price of fame.", type: "agree_disagree" },
  { title: "Studying Climate Change", question: "Imagine you have been assigned on the study of climate change. Which area of climate change will you focus on and why? Use examples.", explanation: "Choose a specific area of climate change to study and justify your choice with examples.", type: "single_best_option", secondaryFeatures: ["focus_area"] },
  { title: "Work-Life Balance", question: "Nowadays, it is increasingly more difficult to maintain the right balance between work and the other aspects of one's life, such as leisure pursuits with family members. How important do you think this balance is? What are the reasons that make some people think that this is hard to achieve?", explanation: "Explore the importance of work-life balance and reasons why it is difficult to maintain.", type: "importance_reasons" },
  { title: "Experience is the Best Teacher", question: "Some people argue that experience is the best teacher. Life experiences can teach more effectively than books or formal school education. How far do you agree with this idea? Support your opinion with reasons and/or your personal experience.", explanation: "Evaluate whether life experience teaches more effectively than formal education.", type: "agree_disagree" },
  { title: "AI and Foreign Language Learning", question: "While artificial intelligence becomes so advanced, people can use computers to translate foreign languages that makes learning a foreign language unnecessary. To what extent do you agree with it?", explanation: "Examine whether AI translation makes foreign language learning unnecessary.", type: "agree_disagree" },
  { title: "Travel and Quality of Education", question: "Some believe the value of travel is overrated. 'One brilliant scholar never leaves the home bases.' People argue whether travel is a necessary component of quality education or not. To what extent do you agree with it?", explanation: "Ask whether travel is essential for quality education.", type: "agree_disagree" },
  { title: "City vs Countryside Living", question: "Some people prefer to live in cities, while some people prefer to live in the countryside. Which is better for you? Give your reasons or experience.", explanation: "Compare city and countryside living and justify personal preference.", type: "two_option_preference" },
  { title: "Growing Up in the 21st Century", question: "It is harder for children to grow up in the 21st century than it was in the past. How far do you agree with this statement? Give your opinions.", explanation: "Evaluate whether growing up today is more difficult than in previous generations.", type: "agree_disagree" },
  { title: "Historic Buildings vs Modern Housing", question: "Many countries spend large amounts of money on the restoration of historic buildings instead of on modern housing. To what extent do you agree or disagree with this analysis? What are advantages and disadvantages of this? Support your writing with your experience or examples.", explanation: "Evaluate whether governments should prioritise historic building restoration over modern housing.", type: "advantages_disadvantages_opinion" },
  { title: "Communication Methods in Modern Society", question: "The means of communicating in society today has changed markedly over the last ten years. In your opinion, what are the positive and negative impacts of this change?", explanation: "Evaluate the positive and negative impacts of modern communication technology changes over the last decade.", type: "positive_negative_impact" },
  { title: "The Value of Humanities", question: "Some say that in today's world the value of humanities has been eclipsed by the necessity of preparing for specific wealth-producing careers, such as medicine. Discuss whether you think there is a role in today's changing world for study of the humanities.", explanation: "Evaluate whether study of the humanities still has a role in today's wealth-focused world.", type: "discuss_both_views", badge: "Pearson Mock Test v2" }
];

const VOCAB_LEVELS = [
  { label: "Band 6-7", desc: "Very simple, everyday words. No academic vocabulary. Short sentences." },
  { label: "Band 7", desc: "Clear and accessible. Common words only. Familiar phrases." },
  { label: "Band 7-8", desc: "Mostly common words with a few stronger ones. Students recognize everything." },
  { label: "Band 8", desc: "Stronger vocabulary, some academic words, varied sentence structures." },
  { label: "Band 8-9", desc: "Sophisticated but still familiar. Some advanced phrases, no obscure terms." }
];

// ============================================================
//  QUESTION TYPE CATALOG
//  Each entry tells the AI how to (a) generate ideas and (b)
//  frame the body paragraphs when writing the full essay.
// ============================================================
const QUESTION_TYPES = {
  opinion: {
    id: "opinion",
    displayName: "Opinion",
    stanceRequired: true,
    stanceType: "agreement",
    stanceOptions: ["strongly agree", "largely agree", "partially agree", "partially disagree", "largely disagree", "strongly disagree"],
    bp1Role: "reasons supporting opinion",
    bp2Role: "further support, limitation, or solution",
    conclusionRole: "clear opinion",
    detect: "Express a clear personal opinion on a topic",
    validationRules: [
      "Must take a clear stance in introduction",
      "Stance must be maintained consistently in BP1 and BP2",
      "Conclusion must reiterate the chosen opinion clearly"
    ]
  },
  agree_disagree: {
    id: "agree_disagree",
    displayName: "Agree / disagree",
    stanceRequired: true,
    stanceType: "agreement",
    stanceOptions: ["strongly agree", "largely agree", "partially agree", "partially disagree", "largely disagree", "strongly disagree"],
    bp1Role: "support selected degree of agreement",
    bp2Role: "support stance further or show limited contrast",
    conclusionRole: "selected degree of agreement",
    detect: "To what extent do you agree or disagree?",
    validationRules: [
      "Stance must match the selected degree of agreement",
      "BP1 must strongly support the chosen agreement side",
      "Disagreement points must not dominate the essay if agreement is chosen"
    ]
  },
  advantages_disadvantages: {
    id: "advantages_disadvantages",
    displayName: "Advantages / disadvantages",
    stanceRequired: false,
    bp1Role: "advantages",
    bp2Role: "disadvantages",
    conclusionRole: "balanced judgement or recommendation",
    detect: "Discuss the advantages and disadvantages of a trend or policy",
    validationRules: [
      "Must cover both advantages and disadvantages",
      "BP1 must focus entirely on advantages",
      "BP2 must focus entirely on disadvantages",
      "Must not be one-sided"
    ]
  },
  advantages_disadvantages_opinion: {
    id: "advantages_disadvantages_opinion",
    displayName: "Advantages / disadvantages + opinion",
    stanceRequired: true,
    stanceType: "advantages_disadvantages_opinion",
    stanceOptions: ["advantages outweigh disadvantages", "disadvantages outweigh advantages", "balanced benefits and drawbacks"],
    leftLabel: "Advantages",
    rightLabel: "Disadvantages",
    bp1Role: "advantages",
    bp2Role: "disadvantages",
    conclusionRole: "final opinion",
    detect: "Do the advantages outweigh the disadvantages?",
    validationRules: [
      "Must discuss both sides (advantages in BP1, disadvantages in BP2)",
      "Conclusion must state a clear opinion on whether advantages outweigh disadvantages"
    ]
  },
  problem_solution: {
    id: "problem_solution",
    displayName: "Problem / solution",
    stanceRequired: false,
    bp1Role: "problems or causes",
    bp2Role: "solutions",
    conclusionRole: "strongest solution",
    detect: "Identify problems/causes and suggest practical solutions",
    validationRules: [
      "BP1 must contain problem/cause logic",
      "BP2 must contain solutions that directly address the problems in BP1",
      "Solutions must be paired 1-to-1 with problems"
    ]
  },
  cause_solution: {
    id: "cause_solution",
    displayName: "Cause / solution",
    stanceRequired: false,
    bp1Role: "causes",
    bp2Role: "solutions",
    conclusionRole: "strongest solution",
    detect: "Identify causes and suggest practical solutions",
    validationRules: [
      "BP1 must contain cause logic",
      "BP2 must contain solutions that directly address the causes in BP1",
      "Solutions must be paired 1-to-1 with causes"
    ]
  },
  cause_effect: {
    id: "cause_effect",
    displayName: "Cause / effect",
    stanceRequired: false,
    bp1Role: "causes",
    bp2Role: "effects or consequences",
    conclusionRole: "main cause/effect summary",
    detect: "Explain the causes and effects of a trend or phenomenon",
    validationRules: [
      "BP1 must contain main causes",
      "BP2 must contain corresponding effects or consequences",
      "Effects must directly result from the causes in BP1"
    ]
  },
  problem_effect: {
    id: "problem_effect",
    displayName: "Problem / effect",
    stanceRequired: false,
    bp1Role: "problems",
    bp2Role: "effects or consequences",
    conclusionRole: "main problem/effect summary",
    detect: "Identify problems and explain their effects/consequences",
    validationRules: [
      "BP1 must contain main problems",
      "BP2 must contain corresponding effects or consequences",
      "Effects must directly result from the problems in BP1"
    ]
  },
  discuss_both_views: {
    id: "discuss_both_views",
    displayName: "Discuss both views",
    stanceRequired: true,
    stanceType: "discuss_both_views",
    stanceOptions: ["strongly support View A", "strongly support View B", "balanced perspective/neutral"],
    leftLabel: "View A Reasons",
    rightLabel: "View B Reasons",
    bp1Role: "first view",
    bp2Role: "second view",
    conclusionRole: "opinion only if required",
    detect: "Discuss both views and give your opinion",
    validationRules: [
      "BP1 must explain the first view",
      "BP2 must explain the second view",
      "Conclusion must express a clear opinion if stance is selected"
    ]
  },
  two_option_preference: {
    id: "two_option_preference",
    displayName: "Two-option personal preference",
    stanceRequired: true,
    stanceType: "option_choice",
    stanceOptions: ["Option A is better", "Option B is better"],
    bp1Role: "Support the selected option with two strong reasons",
    bp2Role: "Support the selected option further and optionally contrast the opposite option briefly",
    conclusionRole: "Repeat the selected option clearly",
    detect: "Choose between two distinct options and justify your choice",
    validationRules: [
      "Essay must not be fully balanced",
      "Selected option must control introduction, BP1, BP2, and conclusion",
      "Opposite option may appear only as brief contrast",
      "PDF model stance must not override selected stance"
    ]
  },
  responsibility: {
    id: "responsibility",
    displayName: "Responsibility",
    stanceRequired: true,
    stanceType: "responsibility",
    stanceOptions: ["governments mainly responsible", "companies mainly responsible", "individuals mainly responsible", "shared responsibility", "governments and companies mainly responsible, individuals supporting"],
    leftLabel: "Primary Group Reasons",
    rightLabel: "Supporting/Shared Reasons",
    bp1Role: "primary responsible group",
    bp2Role: "supporting groups, limits, or shared responsibility",
    conclusionRole: "responsibility judgement",
    detect: "Who should take responsibility (governments, companies, or individuals)?",
    validationRules: [
      "Essay must focus on responsible parties, not just general causes of the issue",
      "BP1 must develop reasons for the primary responsible group",
      "Conclusion must state a clear responsibility judgement"
    ]
  },
  positive_negative_impact: {
    id: "positive_negative_impact",
    displayName: "Positive / negative impact",
    stanceRequired: true,
    stanceType: "positive_negative",
    stanceOptions: ["largely positive", "largely negative", "positive with risks", "negative unless controlled"],
    leftLabel: "Positive Impacts",
    rightLabel: "Negative Impacts",
    bp1Role: "positive effects",
    bp2Role: "negative effects",
    conclusionRole: "final judgement",
    detect: "Is this trend a positive or negative development?",
    validationRules: [
      "Must evaluate both positive and negative impacts",
      "Conclusion must deliver a clear final judgement aligning with chosen stance"
    ]
  },
  blessing_curse: {
    id: "blessing_curse",
    displayName: "Blessing / curse",
    stanceRequired: true,
    stanceType: "blessing_curse",
    stanceOptions: ["mostly a blessing", "mostly a curse", "a blessing if managed responsibly"],
    leftLabel: "Blessing Reasons",
    rightLabel: "Curse Reasons",
    bp1Role: "blessing side",
    bp2Role: "curse side or risks",
    conclusionRole: "final judgement",
    detect: "Is this development a blessing or a curse?",
    validationRules: [
      "Must evaluate both benefits (blessing) and risks/drawbacks (curse)",
      "Conclusion must give a clear final judgement"
    ]
  },
  compare_two_sides: {
    id: "compare_two_sides",
    displayName: "Compare two sides",
    stanceRequired: false,
    bp1Role: "side A",
    bp2Role: "side B",
    conclusionRole: "comparative judgement",
    detect: "Compare and contrast two different systems or options",
    validationRules: [
      "BP1 must cover the first side",
      "BP2 must cover the second side",
      "Must maintain an objective comparison throughout"
    ]
  },
  single_best_option: {
    id: "single_best_option",
    displayName: "Single best option",
    stanceRequired: true,
    stanceType: "best_option",
    stanceOptions: ["climate change", "poverty", "youth unemployment", "wealth inequality"],
    bp1Role: "why selected option is most important",
    bp2Role: "solution, support, or alternative consideration",
    conclusionRole: "repeat selected best option",
    detect: "Identify the single best or most important option among alternatives",
    validationRules: [
      "Must justify why the selected option is superior to other options",
      "Conclusion must repeat the selected best option"
    ]
  },
  example_specific: {
    id: "example_specific",
    displayName: "Example-specific",
    stanceRequired: true,
    stanceType: "example_choice",
    stanceOptions: ["custom selected example"],
    bp1Role: "selected example and main justification",
    bp2Role: "impact, limitation, or recommendation",
    conclusionRole: "final judgement",
    detect: "Provide and analyze a specific example (e.g. an age restriction)",
    validationRules: [
      "Must specify one clear example",
      "Justification in BP1 must match the selected example"
    ]
  },
  policy_recommendation: {
    id: "policy_recommendation",
    displayName: "Policy / recommendation",
    stanceRequired: true,
    stanceType: "policy_stance",
    stanceOptions: ["strongly support policy", "oppose policy", "support with conditions"],
    bp1Role: "reasons for policy",
    bp2Role: "limitations and implementation",
    conclusionRole: "practical recommendation",
    detect: "Evaluate a proposed policy and make recommendations",
    validationRules: [
      "BP1 must justify the stance on the policy",
      "BP2 must cover implementation challenges or conditions"
    ]
  },
  rights_ethics: {
    id: "rights_ethics",
    displayName: "Rights / ethics",
    stanceRequired: true,
    stanceType: "ethical_stance",
    stanceOptions: ["prioritize social/public interest", "prioritize individual rights", "balanced ethical compromise"],
    bp1Role: "social/public interest",
    bp2Role: "individual rights and ethical limits",
    conclusionRole: "balanced ethical judgement",
    detect: "Evaluate the ethics or human rights aspect of a topic",
    validationRules: [
      "Must balance public interest (BP1) vs individual rights (BP2)",
      "Conclusion must offer a balanced ethical judgement"
    ]
  },
  future_prediction: {
    id: "future_prediction",
    displayName: "Future / prediction",
    stanceRequired: true,
    stanceType: "prediction",
    stanceOptions: ["highly likely to occur", "unlikely to occur", "will occur with major changes"],
    bp1Role: "why future change may happen",
    bp2Role: "effects, benefits, or risks",
    conclusionRole: "clear prediction",
    detect: "Predict future developments or trends",
    validationRules: [
      "BP1 must explain the drivers of the predicted change",
      "Conclusion must state a clear, forward-looking prediction"
    ]
  },
  social_impact: {
    id: "social_impact",
    displayName: "Social impact",
    stanceRequired: false,
    bp1Role: "immediate social benefits",
    bp2Role: "long-term social consequences or challenges",
    conclusionRole: "overall social impact assessment",
    detect: "Analyze the social consequences and impact of a trend",
    validationRules: [
      "BP1 must focus on benefits to society",
      "BP2 must focus on social challenges or long-term issues"
    ]
  },
  education_effectiveness: {
    id: "education_effectiveness",
    displayName: "Education effectiveness",
    stanceRequired: true,
    stanceType: "effectiveness",
    stanceOptions: ["highly effective", "ineffective", "effective only under specific conditions"],
    bp1Role: "educational benefits and arguments in favor",
    bp2Role: "drawbacks, limits, or alternative educational methods",
    conclusionRole: "final effectiveness verdict",
    detect: "Evaluate the effectiveness of an educational method or policy",
    validationRules: [
      "BP1 must analyze the positive educational outcomes",
      "BP2 must analyze the limits or alternative methods"
    ]
  },
  opinion_alternatives: {
    id: "opinion_alternatives",
    displayName: "Opinion + Alternatives",
    stanceRequired: true,
    stanceType: "agreement",
    stanceOptions: ["strongly agree", "largely agree", "partially agree", "partially disagree", "largely disagree", "strongly disagree"],
    leftLabel: "Supporting Reasons",
    rightLabel: "Alternative Actions",
    bp1Role: "reasons supporting opinion",
    bp2Role: "suggest alternative actions",
    conclusionRole: "clear opinion and summary of alternatives",
    detect: "Express your opinion and suggest alternative actions",
    validationRules: [
      "Must take a clear stance (agree/disagree) in introduction",
      "BP1 must support the chosen stance",
      "BP2 must suggest practical alternative actions",
      "Conclusion must reiterate the opinion and summarize alternatives"
    ]
  },
  importance_reasons: {
    id: "importance_reasons",
    displayName: "Importance + reasons",
    stanceRequired: false,
    bp1Role: "how important it is / why it matters",
    bp2Role: "the reasons it is hard to achieve",
    conclusionRole: "restate importance and the main obstacle",
    detect: "How important is something, and why is it hard to achieve?",
    validationRules: [
      "BP1 must explain why it matters / how important it is",
      "BP2 must give the reasons it is hard to achieve (obstacles, not solutions)",
      "Conclusion must restate the importance and the main obstacle"
    ]
  }
};

// Backward compatibility aliases
QUESTION_TYPES.single_focus = QUESTION_TYPES.two_option_preference;
QUESTION_TYPES.problems_solutions = QUESTION_TYPES.problem_solution;
QUESTION_TYPES.causes_solutions = QUESTION_TYPES.problem_solution;
QUESTION_TYPES.causes_effects = QUESTION_TYPES.cause_effect;
QUESTION_TYPES.problems_benefits = QUESTION_TYPES.advantages_disadvantages;
QUESTION_TYPES.positive_negative_impacts = QUESTION_TYPES.positive_negative_impact;

// ============================================================
//  v20.2.0 — DETERMINISTIC CLASSIFICATION + STATIC EXPLANATIONS
//  Classification is no longer trusted to the AI when a curated
//  library type or a confident local pattern match exists. The
//  AI only classifies unseen custom questions, and even then it
//  is constrained by explicit disambiguation rules.
// ============================================================

function normalizeQuestionType(t) {
  const key = String(t || '').trim();
  if (!key) return '';
  if (QUESTION_TYPES[key] && QUESTION_TYPES[key].id === key) return key;
  const map = {
    single_focus: 'two_option_preference',
    problems_solutions: 'problem_solution',
    causes_solutions: 'problem_solution',
    causes_effects: 'cause_effect',
    problems_effects: 'problem_effect',
    problems_benefits: 'advantages_disadvantages',
    positive_negative_impacts: 'positive_negative_impact',
    advantage_disadvantage: 'advantages_disadvantages',
    agree_or_disagree: 'agree_disagree',
    discuss_both: 'discuss_both_views',
    best_option: 'single_best_option'
  };
  if (map[key]) return map[key];
  if (QUESTION_TYPES[key]) return QUESTION_TYPES[key].id || key;
  return key;
}

// Ordered, deterministic pattern classifier. First hit wins.
// Returns { type, secondaryFeatures, confident, rule }.
// confident=false means only the last-resort fallback fired and the
// AI is allowed to classify instead.
function classifyQuestionLocally(q) {
  const out = { type: 'opinion', secondaryFeatures: [], confident: false, rule: 'fallback' };
  if (!q) return out;
  const s = String(q).toLowerCase();
  const hit = (type, rule, feats) => {
    out.type = type; out.rule = rule; out.confident = true;
    out.secondaryFeatures = feats || [];
    return out;
  };

  // 0. Legacy curated exception kept from the old staticClassifyQuestion.
  if (/(age restrictions?|minimum age)/.test(s)) return hit('example_specific', 'age_restriction');

  // 1. "…what alternatives / what should be done instead" + agreement context.
  if ((/alternativ/.test(s) || /what (could|should|can)[\s\S]{0,40}\binstead\b/.test(s)) &&
      /(agree|opinion|do you think|do you believe|support)/.test(s)) {
    return hit('opinion_alternatives', 'alternatives');
  }

  // Shared signals for the two-sided rules below.
  const advWords = /(advantages? and disadvantages?|disadvantages? and advantages?|benefits? and drawbacks?|drawbacks? and benefits?|problems? and (the )?benefits?|benefits? and (the )?problems?|pros and cons|merits and demerits)/.test(s);
  const opinionDemand = /(your opinion|your (own )?(view|point of view)|do you believe|do you agree|outweigh)/.test(s) ||
    (/do you think/.test(s) && !/what do you think (are|is)/.test(s));

  // 2a. Explicit two-views discussion.
  if (/discuss both (these |the )?(views|sides|opinions|perspectives)/.test(s) ||
      /discuss these (two )?(views|sides|opinions)/.test(s)) {
    return hit('discuss_both_views', 'discuss_both');
  }

  // 6/7 hoisted: blessing/curse and positive/negative development are more
  // specific than the generic "some…others" two-views pattern below.
  if (/blessing/.test(s) && /curse/.test(s)) return hit('blessing_curse', 'blessing_curse');
  if (/positive (or|and) negative/.test(s) || /negative or positive/.test(s)) {
    return hit('positive_negative_impact', 'pos_neg');
  }

  // 2b. Two views presented ("some think X … others think Y") + a view ask.
  if (/some (people )?(think|believe|say|argue|feel|claim)[\s\S]{0,140}\bothers (think|believe|say|argue|feel|claim|prefer)/.test(s) &&
      /(what is your (view|opinion)|give your (own )?opinion|\bdiscuss\b)/.test(s)) {
    return hit('discuss_both_views', 'some_others_views');
  }

  // 2c. "Discuss both the advantages and disadvantages" is an adv/disadv ask,
  //     not a two-views essay — only bare "discuss both" without adv-words
  //     falls to discuss_both_views.
  if (/discuss both/.test(s) && !advWords) {
    return hit('discuss_both_views', 'discuss_both');
  }

  // 2d. An interrogative ask for BOTH sides ("What are the problems and the
  //     benefits…?") outranks a trailing "do you agree" — the task is to list
  //     both sides first.
  if (advWords && /what (are|do you think are) (the )?(advantages?|benefits?|problems?|drawbacks?|pros)/.test(s)) {
    return hit(opinionDemand ? 'advantages_disadvantages_opinion' : 'advantages_disadvantages',
      opinionDemand ? 'adv_disadv_opinion' : 'adv_disadv');
  }

  // 3. Agree / disagree — NEVER problem_solution, even if the statement
  //    inside the prompt mentions problems, causes or solutions.
  if (/to what extent do you agree/.test(s) || /agree or disagree/.test(s) || /\bdo you agree\b/.test(s)) {
    return hit('agree_disagree', 'agree_disagree');
  }

  // 4/5. Advantages & disadvantages (with or without an opinion demand).
  if (/outweigh/.test(s)) return hit('advantages_disadvantages_opinion', 'outweigh');
  if (advWords && opinionDemand) {
    return hit('advantages_disadvantages_opinion', 'adv_disadv_opinion');
  }
  if (advWords) return hit('advantages_disadvantages', 'adv_disadv');

  // 8. "Most pressing problem" family → single_best_option + solution_required.
  if (/(most (pressing|serious|important|significant|urgent)|biggest|greatest) (global |single )?(problem|issue|challenge)/.test(s) ||
      /(which|what) (one |single )?(problem|issue|challenge)[\s\S]{0,50}most (pressing|serious|important|significant|urgent)/.test(s)) {
    return hit('single_best_option', 'most_pressing', ['solution_required']);
  }

  // 9. "Choose one area / aspect to focus on" → single_best_option + focus_area.
  if (/(which|what) (one )?(area|aspect|field|sector|part)[\s\S]{0,60}(focus|choose|select|research|address)/.test(s) ||
      /choose one (area|aspect|field)/.test(s)) {
    return hit('single_best_option', 'focus_area', ['focus_area']);
  }

  // 10. Responsibility questions.
  if (/who(se)?[\s\S]{0,60}responsib/.test(s) ||
      (/responsib/.test(s) && /(governments?|individuals?|companies|parents?|schools?)[\s\S]{0,50}\bor\b/.test(s))) {
    return hit('responsibility', 'responsibility');
  }

  // 11. Relation matrix — only when the question ITSELF asks for
  //     solutions/effects, not when the topic merely mentions a problem.
  const wantsSolution = /(solutions?|measures?|remed(y|ies)|what can be done|what should be done|steps[\s\S]{0,30}taken|suggest (some )?ways|ways to (solve|tackle|address|reduce|combat|prevent|overcome)|what (can|could|should)[\s\S]{0,30}\bdo\b|to (address|tackle|solve|combat|overcome) (the |this |these )?(problem|issue|situation)|how (can|could|should)[\s\S]{0,60}(solve|solved|tackle|tackled|address|addressed|reduce|reduced|prevent|prevented|overcome|deal))/.test(s);
  const wantsEffect = /(effects?|impacts?|consequences?)\b/.test(s) || /how (do|does)[\s\S]{0,60}affect/.test(s);
  const asksCause = /(what|main|major|possible|the) causes?\b/.test(s) || /\bcauses? of\b/.test(s) || /reasons? (for|behind|why)/.test(s) || /why (do|does|is|are|has|have)/.test(s);
  const asksProblem = /\bproblems?\b/.test(s) || /\bissues?\b/.test(s) || /\bchallenges?\b/.test(s) || /difficult(y|ies)/.test(s);
  if (wantsSolution) {
    // An explicit "what are the causes…" ask outranks a scene-setting "problem" mention.
    return hit(asksCause ? 'cause_solution' : 'problem_solution', 'relation_solution');
  }
  if (wantsEffect && (asksCause || asksProblem)) {
    return hit(asksCause ? 'cause_effect' : 'problem_effect', 'relation_effect');
  }

  // 12. Two-option personal preference.
  if (/which (of these |one |option )?(do|would) you (prefer|choose)/.test(s) ||
      /would you (rather|prefer)/.test(s) || /is it better to/.test(s) ||
      /which is better/.test(s) || /\bdo you prefer\b/.test(s)) {
    return hit('two_option_preference', 'preference');
  }

  // 13. Plain opinion (confident forms only).
  if (/what is your (own )?(view|opinion)/.test(s) || /give your (own )?opinion/.test(s) ||
      /in your opinion/.test(s) || /do you (think|believe|support)/.test(s) ||
      (/\bshould\b/.test(s) && /\?/.test(s))) {
    return hit('opinion', 'opinion');
  }

  return out; // fallback: opinion, confident:false → AI may classify.
}

// ------------------------------------------------------------
// Static, deterministic per-type explanations shown to students
// BEFORE they pick a stance or any ideas. No AI involved.
// ------------------------------------------------------------
const TYPE_EXPLANATIONS = {
  opinion: {
    ask: 'The question gives you one idea and asks what YOU think about it. Your job: pick your side clearly and keep the same side for the whole essay. Your opinion IS the answer.',
    intro: 'Say the topic in your own words, then give your opinion in one clear sentence (e.g. "In my opinion, this is a good idea because…").',
    bp1: 'Give reason 1 and reason 2 for your opinion. After each reason, add one simple example from everyday life.',
    bp2: 'You may show one small weak point of your side, but then answer it. Finish the paragraph still on YOUR side.',
    concl: 'Say your opinion again in different words. Do not add any new ideas here.',
    trap: 'Do NOT write problems and solutions. Do NOT give both sides the same weight. One clear side from start to end.'
  },
  agree_disagree: {
    ask: 'The question gives you a statement. Your job: say HOW MUCH you agree or disagree — completely agree, mostly agree, mostly disagree, or completely disagree. Then prove that exact level for the whole essay.',
    intro: 'Say the statement in your own words, then state your level clearly (e.g. "I mostly disagree with this idea").',
    bp1: 'Give reason 1 and reason 2 for YOUR side. After each reason, add one simple everyday example.',
    bp2: 'Add more support for your side. A short "on the other hand" point is OK only for "mostly/partially" answers — and you must answer it.',
    concl: 'Repeat your exact level of agreement in fresh words.',
    trap: 'Even if the statement talks about problems, this is NOT a problem/solution essay. Answer the agree/disagree question only.'
  },
  advantages_disadvantages: {
    ask: 'The question asks for the good points AND the bad points of the topic. Your job: explain both sides fairly. Your personal opinion is not the main focus here.',
    intro: 'Say the topic in your own words and tell the reader you will look at both the advantages and the disadvantages.',
    bp1: 'Give advantage 1 and advantage 2 (the good points). After each one, add a simple everyday example.',
    bp2: 'Give disadvantage 1 and disadvantage 2 (the bad points). After each one, add a simple everyday example.',
    concl: 'Give a short, balanced final judgement — which side is a little stronger, or a simple recommendation.',
    trap: 'Do NOT argue for one side only, and do NOT turn it into problems + solutions. BOTH sides must appear.'
  },
  advantages_disadvantages_opinion: {
    ask: 'The question asks if the good points are BIGGER than the bad points (or the other way around). Your job: show both sides AND give a clear winner at the end.',
    intro: 'Say the topic in your own words and state your verdict early (e.g. "I believe the advantages are stronger").',
    bp1: 'Give advantage 1 and advantage 2, each with a simple everyday example.',
    bp2: 'Give disadvantage 1 and disadvantage 2, each with a simple everyday example.',
    concl: 'Give your clear verdict: which side wins and WHY, in one or two short sentences.',
    trap: 'You must cover both sides, but you must NOT sit in the middle at the end. The conclusion must pick a winner.'
  },
  problem_solution: {
    ask: 'The question asks two things: what PROBLEMS does the topic create, and what SOLUTIONS can fix them. Your job: name real problems, then give practical fixes that match those exact problems.',
    intro: 'Say the topic in your own words and tell the reader you will discuss the main problems and some practical solutions.',
    bp1: 'Give problem 1 and problem 2. After each problem, add a simple everyday example showing it.',
    bp2: 'Give solution 1 (it must fix problem 1) and solution 2 (it must fix problem 2). Add a short example of how each helps.',
    concl: 'Name the strongest solution and say why it should come first.',
    trap: 'Every solution must match a problem from Body 1. Do NOT start agreeing or disagreeing — nobody asked for your opinion on the topic.'
  },
  cause_solution: {
    ask: 'The question asks WHY this situation happens (the causes) and WHAT can be done about it (the solutions). Causes = the reasons behind it, not the problem itself.',
    intro: 'Say the topic in your own words and tell the reader you will explain the main causes and suggest solutions.',
    bp1: 'Give cause 1 and cause 2 — the reasons WHY it happens. Add a simple everyday example after each.',
    bp2: 'Give solution 1 (it must answer cause 1) and solution 2 (it must answer cause 2). Add a short example of how each helps.',
    concl: 'Name the strongest solution and say why it should come first.',
    trap: 'Do not just describe the problem — explain WHY it happens. And pair each solution with its cause.'
  },
  cause_effect: {
    ask: 'The question asks WHY this happens (causes) and WHAT HAPPENS because of it (effects). Your job: show the chain — this cause leads to that effect. NO solutions are needed.',
    intro: 'Say the topic in your own words and tell the reader you will explain the main causes and their effects.',
    bp1: 'Give cause 1 and cause 2 — why the situation happens. Add a simple everyday example after each.',
    bp2: 'Give effect 1 and effect 2 — what happens as a result. Add a simple everyday example after each.',
    concl: 'Sum up the main chain in one line: because of [cause], we see [effect].',
    trap: 'Do NOT give solutions. The question never asked for them — adding them loses focus.'
  },
  problem_effect: {
    ask: 'The question asks what PROBLEMS exist and what EFFECTS they have on people or society. Your job: name the problems, then show what damage they cause. NO solutions are needed.',
    intro: 'Say the topic in your own words and tell the reader you will discuss the main problems and their effects.',
    bp1: 'Give problem 1 and problem 2, each with a simple everyday example.',
    bp2: 'Give effect 1 and effect 2 — what these problems do to people. Add a simple everyday example after each.',
    concl: 'Sum up the main problem and its biggest effect in one or two lines.',
    trap: 'Do NOT give solutions. The question only asks for problems and their effects.'
  },
  discuss_both_views: {
    ask: 'The question shows two different opinions (View A and View B). Your job: explain BOTH views fairly — why each group thinks that way — and then give YOUR opinion at the end.',
    intro: 'Say both views in your own words and tell the reader you will discuss both before giving your own opinion.',
    bp1: 'Explain View A: why do these people think this? Give their reason(s) with a simple everyday example.',
    bp2: 'Explain View B: why do these people think this? Give their reason(s) with a simple everyday example.',
    concl: 'Now give YOUR opinion clearly: which view do you support, and why, in one or two short sentences.',
    trap: 'Explaining only one view fails the question. Give both views real space — your opinion belongs at the end.'
  },
  two_option_preference: {
    ask: 'The question gives two options and asks WHICH ONE you prefer. Your job: pick ONE option and spend the whole essay showing why your choice is better.',
    intro: 'Say both options in your own words, then state your choice clearly (e.g. "I would choose to study alone").',
    bp1: 'Give reason 1 and reason 2 why YOUR option is better. Add a simple everyday example after each.',
    bp2: 'You may mention one good point of the OTHER option briefly — then explain why your option still wins.',
    concl: 'Repeat your choice clearly and give your strongest reason in a few words.',
    trap: 'A 50/50 balanced essay is wrong here. Your chosen option must lead every paragraph.'
  },
  responsibility: {
    ask: 'The question asks WHO should fix or handle the issue — the government, companies, or individuals. Your job: choose which group carries the MAIN responsibility and defend that choice.',
    intro: 'Say the issue in your own words, then state clearly who you think is mainly responsible.',
    bp1: 'Explain why YOUR chosen group must lead — give one or two reasons with simple everyday examples.',
    bp2: 'Show how the OTHER groups can help, but also why they cannot solve it alone.',
    concl: 'Repeat who is mainly responsible and your strongest reason.',
    trap: 'Saying "everyone is responsible" with no leader is a weak answer. Pick the MAIN group and commit.'
  },
  positive_negative_impact: {
    ask: 'The question asks if this change is a POSITIVE or NEGATIVE development. Your job: look at both sides, then give a clear verdict — mainly positive or mainly negative.',
    intro: 'Say the change in your own words and state your verdict early (e.g. "I see this as a mainly positive development").',
    bp1: 'Give positive effect 1 and positive effect 2, each with a simple everyday example.',
    bp2: 'Give negative effect 1 and negative effect 2, each with a simple everyday example.',
    concl: 'Give your verdict clearly: mainly positive or mainly negative, and your strongest reason.',
    trap: 'This is NOT a problem/solution question. Do not suggest fixes — judge the change.'
  },
  blessing_curse: {
    ask: 'The question asks if the topic is a blessing (mostly good) or a curse (mostly harmful). Your job: show both sides, then give your verdict.',
    intro: 'Say the topic in your own words and state your verdict early (blessing, curse, or blessing with conditions).',
    bp1: 'Show two ways it works as a blessing (the good side), each with a simple everyday example.',
    bp2: 'Show two ways it works as a curse (the harmful side), each with a simple everyday example.',
    concl: 'Give your verdict: blessing, curse, or "blessing if used carefully" — with your strongest reason.',
    trap: 'Do NOT drift into solutions. Your job is to judge, not to fix.'
  },
  compare_two_sides: {
    ask: 'The question asks you to COMPARE two things — how they are different, and which one matters more. Your job: keep linking them to each other, not just describe each one alone.',
    intro: 'Introduce both things in your own words and say what the essay will compare.',
    bp1: 'Describe the first side: its key points, with a simple everyday example.',
    bp2: 'Describe the second side AND compare it with the first: how is it different or stronger/weaker?',
    concl: 'State the most important difference, or which side matters more, and why.',
    trap: 'Describing each side separately is not comparing. Every paragraph should connect the two sides.'
  },
  single_best_option: {
    ask: 'The question asks you to pick ONE option as the most important and prove that single choice. Your job: choose early and build everything around it.',
    intro: 'Name the topic and state your ONE chosen option clearly in the first paragraph.',
    bp1: 'Explain why your chosen option is the most important — two reasons, each with a simple everyday example.',
    bp2: 'Give more support: what can be done about it, or more proof that your choice is right.',
    concl: 'Repeat your chosen option as the clear answer.',
    trap: 'Do NOT discuss several options equally. ONE choice, made early, defended fully.'
  },
  example_specific: {
    ask: 'The question asks for your position on a specific practical rule or measure. Your job: take a side and prove it with real, everyday examples — the examples ARE the essay.',
    intro: 'Say the rule/measure in your own words and state your position clearly.',
    bp1: 'Give your first main point with a very concrete everyday example (a real-life situation people know).',
    bp2: 'Give your second main point with another concrete everyday example.',
    concl: 'Repeat your position on the measure in fresh words.',
    trap: 'Big vague sentences fail here. Keep the examples simple, real, and specific.'
  },
  policy_recommendation: {
    ask: 'The question asks what ACTIONS or policies should be taken. Your job: recommend clear, doable measures and explain why they would work.',
    intro: 'Say the issue in your own words and tell the reader you will recommend practical actions.',
    bp1: 'Give your first recommended action: what exactly should be done, why it works, plus a simple example.',
    bp2: 'Give your second recommended action the same way.',
    concl: 'Name the action you would do FIRST and why.',
    trap: '"People should care more" is not an action. Every recommendation must be something someone can actually DO.'
  },
  rights_ethics: {
    ask: 'The question asks if something is RIGHT or FAIR to do. Your job: take a moral position — is it right or wrong — and defend it.',
    intro: 'Say the issue in your own words and state your moral position clearly.',
    bp1: 'Give your strongest moral reasons (fairness, harm, freedom, honesty…), with a simple everyday example.',
    bp2: 'Add more support, or show why the opposite moral view is weaker.',
    concl: 'Repeat your moral position in fresh words.',
    trap: 'Do NOT turn it into advantages vs disadvantages. The question is about right and wrong, not useful and useless.'
  },
  future_prediction: {
    ask: 'The question asks what WILL HAPPEN in the future. Your job: make a clear prediction and explain the reasons behind it.',
    intro: 'Say the topic in your own words and state your prediction clearly (e.g. "I believe most people will…").',
    bp1: 'Give your first predicted change and WHY you expect it, with a simple example of early signs today.',
    bp2: 'Give your second predicted change, or the main thing that could change the outcome.',
    concl: 'Repeat your overall prediction in fresh words.',
    trap: 'Too much "maybe / perhaps / it depends" looks like no answer. Commit to a prediction.'
  },
  social_impact: {
    ask: 'The question asks how the trend affects SOCIETY — families, communities, how people live together. Your job: keep the focus on society, not on one person\'s private gain.',
    intro: 'Say the trend in your own words and tell the reader you will discuss its effects on society.',
    bp1: 'Give the first big social effect, with a simple everyday example (families, neighbours, workplaces…).',
    bp2: 'Give the second big social effect the same way.',
    concl: 'Sum up the overall effect on society in one or two lines.',
    trap: 'Stay on SOCIETY. Do not drift into technical details or one individual\'s benefits.'
  },
  education_effectiveness: {
    ask: 'The question asks if a way of teaching or learning actually WORKS. Your job: judge it — where it works, where it fails — and give a verdict.',
    intro: 'Say the approach in your own words and hint at your verdict.',
    bp1: 'Show where and why the approach works, with a simple classroom example.',
    bp2: 'Show where it falls short, or what it depends on (teacher, money, student age…).',
    concl: 'Give your verdict: does it work, and under what conditions?',
    trap: 'Do not just DESCRIBE the approach. The question asks you to JUDGE it.'
  },
  opinion_alternatives: {
    ask: 'This question has TWO jobs. Job 1: say if you agree or disagree with the practice. Job 2: suggest what could be done INSTEAD. You must do both.',
    intro: 'Say the practice in your own words, give your stance (agree / partially disagree / disagree), and promise some better alternatives.',
    bp1: 'Give reason 1 and reason 2 for YOUR stance on the practice. Add a simple everyday example after each.',
    bp2: 'Give alternative action 1 and alternative action 2 — real things that could be done INSTEAD — with a short example of how each helps.',
    concl: 'Repeat your stance, then name the alternative you think is best.',
    trap: 'Forgetting the alternatives loses half the marks. Body 2 must give real "instead" actions, not more opinions.'
  },
  importance_reasons: {
    ask: 'The question asks HOW IMPORTANT something is, and WHY it is hard to achieve. Your job: show it matters, then show the obstacles.',
    intro: 'Say the topic in your own words and state clearly that it is important but not easy to achieve.',
    bp1: 'Explain WHY it matters — its importance — with a simple everyday example.',
    bp2: 'Explain the main OBSTACLES that make it hard to achieve (not solutions!).',
    concl: 'Repeat the importance and name the biggest obstacle.',
    trap: 'Body 2 is about obstacles, NOT solutions. Do not start fixing things.'
  }
};

function buildQuestionExplanationHtml(e, activeType, typeCfg) {
  const cfg = typeCfg || QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  const feats = (e && e.secondaryFeatures) || [];
  let ex = TYPE_EXPLANATIONS[activeType];

  // Sub-variant overrides for single_best_option.
  if (activeType === 'single_best_option' && feats.includes('focus_area')) {
    ex = {
      ask: 'The topic is very big, so the question asks you to choose ONE focus area and write only about it. Your job: pick one area and prove it deserves the attention.',
      intro: 'Name the big topic, then say clearly which ONE area you will focus on (e.g. "This essay will focus on food waste").',
      bp1: 'Explain why YOUR area matters — two reasons, each with a simple everyday example.',
      bp2: 'Give concrete examples and practical solutions for YOUR area only.',
      concl: 'Repeat your chosen area as the clear answer, plus your best solution.',
      trap: 'Do NOT write about the whole big topic, and do NOT compare all the areas. ONE area, fully developed.'
    };
  } else if (activeType === 'single_best_option' && feats.includes('solution_required')) {
    ex = {
      ask: 'The question asks you to name the ONE most serious (most pressing) problem and show what can be done about it. Your job: choose one problem, prove it is the biggest, then fix it.',
      intro: 'Name the topic and state your ONE chosen problem clearly (e.g. "The most pressing problem is air pollution").',
      bp1: 'Prove your problem is the most serious — give two causes or challenges behind it, each with a simple example.',
      bp2: 'Give practical solutions that match those causes, with a short example of how each helps.',
      concl: 'Repeat your chosen problem and name the strongest solution.',
      trap: 'Do NOT list several different problems. ONE problem, argued deeply, then solved.'
    };
  }

  if (!ex) {
    ex = {
      ask: `This question asks you to write a "${cfg.displayName}" essay: ${cfg.detect}.`,
      intro: 'Introduce the topic in your own words and give your clear answer or position.',
      bp1: cfg.bp1Role || 'develop your first main point with an example',
      bp2: cfg.bp2Role || 'develop your second main point with an example',
      concl: cfg.conclusionRole || 'summarise your answer clearly',
      trap: ''
    };
  }

  // Slot in detected options where the type is built around named options.
  let optionsLine = '';
  const opts = (e && e.detectedOptions) || [];
  if (opts.length >= 2 && ['two_option_preference', 'discuss_both_views'].includes(activeType)) {
    optionsLine = `<div style="margin-top:6px;">The two options here are <strong>${escapeHtml(opts[0])}</strong> and <strong>${escapeHtml(opts[1])}</strong>.</div>`;
  } else if (opts.length >= 2 && activeType === 'single_best_option') {
    optionsLine = `<div style="margin-top:6px;">Your choices: ${opts.map(o => `<strong>${escapeHtml(o)}</strong>`).join(' · ')}.</div>`;
  }

  const row = (label, text) => `
      <div style="display:flex; gap:8px; align-items:baseline;">
        <span style="flex:0 0 92px; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; color:#6b5d3f;">${label}</span>
        <span>${escapeHtml(text)}</span>
      </div>`;

  return `
    <div class="question-explainer" style="background:#fdf9ef; border:1px solid #e8dcc0; border-radius:8px; padding:12px 14px; margin-bottom:12px; font-size:12px; color:#4a4030; line-height:1.55;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; font-weight:800; color:#8a713d; margin-bottom:6px;">📖 What this question is asking</div>
      <div>${escapeHtml(ex.ask)}</div>
      ${optionsLine}
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:9px; padding-top:9px; border-top:1px dashed #e8dcc0;">
        ${row('Intro', ex.intro || 'Introduce the topic in your own words and give your clear answer.')}
        ${row('Body 1', ex.bp1)}
        ${row('Body 2', ex.bp2)}
        ${row('Conclusion', ex.concl)}
      </div>
      ${ex.trap ? `<div style="margin-top:9px; padding:7px 10px; background:#fbeee2; border-left:3px solid #d98f4e; border-radius:4px; color:#7a4a1e;"><strong>⚠ Watch out:</strong> ${escapeHtml(ex.trap)}</div>` : ''}
    </div>`;
}


// ============================================================
//  UNIVERSAL ESSAY STATE HELPERS & MODULES
// ============================================================

function getActiveQuestionType(e) {
  if (!e) return 'advantages_disadvantages';
  let t = e.manualQuestionTypeOverride || e.questionType || e.detectedQuestionType || 'advantages_disadvantages';
  const qLower = (e.question || '').toLowerCase();
  // The student's manual override is a deliberate choice — never hijack it.
  if (!e.manualQuestionTypeOverride && qLower.includes('opinion') && qLower.includes('alternative')) {
    t = 'opinion_alternatives';
  }
  t = normalizeQuestionType(t) || 'advantages_disadvantages';
  return t;
}

function isStrongStance(activeType, stance) {
  if (!stance) return false;
  if (activeType === 'discuss_both_views') return false;
  if (activeType === 'opinion' || activeType === 'agree_disagree' || activeType === 'opinion_alternatives') return false;
  
  const stanceLower = stance.toLowerCase();
  
  if (stanceLower.includes('strongly') || stanceLower.includes('largely') || stanceLower.includes('mostly') || stanceLower.includes('is better') || stanceLower.includes('most pressing') || stanceLower.includes('mainly responsible')) {
    if (stanceLower.includes('balanced') || stanceLower.includes('shared') || stanceLower.includes('partially') || stanceLower.includes('if managed') || stanceLower.includes('unless controlled') || stanceLower.includes('with risks')) {
      return false;
    }
    return true;
  }
  
  return false;
}

function staticClassifyQuestion(q) {
  // Kept for backward compatibility (old essays loaded without a type).
  // Now backed by the deterministic rule classifier above.
  return classifyQuestionLocally(q).type;
}

function getPairedTextForIdea(e, leftIdea, leftIdx) {
  if (!leftIdea) return '';
  if (leftIdea.pairedText) return leftIdea.pairedText;
  if (leftIdea.pairedSolutionOrEffect) return leftIdea.pairedSolutionOrEffect;
  
  if (leftIdea.pairedId && e.suggestedIdeas) {
    const found = e.suggestedIdeas.find(i => i.id === leftIdea.pairedId);
    if (found && found.text) return found.text;
  }
  
  if (e.suggestedIdeas && typeof leftIdx === 'number') {
    const rightIdeas = e.suggestedIdeas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right')));
    if (rightIdeas[leftIdx] && rightIdeas[leftIdx].text) {
      return rightIdeas[leftIdx].text;
    }
  }
  
  const txt = leftIdea.text || '';
  const activeType = getActiveQuestionType(e);
  if (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution') {
    return 'tackle and resolve the issue of ' + txt.toLowerCase();
  } else {
    return 'adverse effects and consequences resulting from ' + txt.toLowerCase();
  }
}

function ensureSuggestedIdeas(e) {
  if (!e.suggestedIdeas || e.suggestedIdeas.length === 0) {
    const list = [];
    if (suggestedLeftIdeas && suggestedLeftIdeas.length > 0) {
      suggestedLeftIdeas.forEach((item, i) => {
        list.push(normalizeSingleIdea(item, `left_${i}`, 'left', e));
      });
    }
    if (suggestedRightIdeas && suggestedRightIdeas.length > 0) {
      suggestedRightIdeas.forEach((item, i) => {
        list.push(normalizeSingleIdea(item, `right_${i}`, 'right', e));
      });
    }
    if (list.length > 0) {
      e.suggestedIdeas = list;
    }
  }

  // Normalize existing or newly constructed list elements
  if (e.suggestedIdeas && Array.isArray(e.suggestedIdeas)) {
    e.suggestedIdeas = normalizeIdeasArray(e.suggestedIdeas, e);
  }
}

function normalizeSingleIdea(item, fallbackId, side, e) {
  if (typeof item === 'string') {
    const activeType = getActiveQuestionType(e);
    const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution');
    return {
      id: fallbackId,
      text: item,
      category: side === 'left' ? 'main_support' : (isSolution ? 'solution' : 'example'),
      supports: side === 'left' ? ['left'] : ['right'],
      opposes: side === 'left' ? ['right'] : ['left'],
      pairedText: '',
      pairedType: '',
      pairedId: '',
      supportsStance: ''
    };
  } else if (item && typeof item === 'object') {
    const activeType = getActiveQuestionType(e);
    const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution');
    return {
      id: item.id || fallbackId,
      text: item.text || '',
      category: item.category || (side === 'left' ? 'main_support' : (isSolution ? 'solution' : 'example')),
      supports: item.supports || (side === 'left' ? ['left'] : ['right']),
      opposes: item.opposes || (side === 'left' ? ['right'] : ['left']),
      area: item.area || '',
      pairedText: item.pairedText || item.pairedSolutionOrEffect || '',
      pairedType: item.pairedType || '',
      pairedId: item.pairedId || '',
      supportsStance: item.supportsStance || ''
    };
  }
  return { id: fallbackId, text: '', category: 'main_support' };
}

function normalizeIdeasArray(arr, e) {
  if (!arr || !Array.isArray(arr)) return [];

  // Focus-area single_best_option ideas carry their sub-area name in `supports`
  // (e.g. ["agriculture and food security"]), NOT stance sides. The agree/left
  // healing below must NOT touch them, or the area tags get wiped and per-area
  // filtering breaks.
  const isFocusAreaEssay = !!(e && getActiveQuestionType(e) === 'single_best_option'
    && e.secondaryFeatures && e.secondaryFeatures.includes('focus_area'));
  
  // Step 1: convert all string/object items to basic object structures
  const objArr = arr.map((item, idx) => {
    if (typeof item === 'string') {
      const txt = item.trim();
      if (txt === '[object Object]' || !txt) return null;
      return {
        id: `idea_${idx}`,
        text: txt,
        category: 'main_support',
        supports: [],
        opposes: [],
        area: '',
        pairedText: '',
        pairedType: '',
        pairedId: '',
        supportsStance: ''
      };
    }
    if (item && typeof item === 'object') {
      const txt = (item.text || '').trim();
      if (txt === '[object Object]' || !txt) return null;
      return {
        id: item.id || `idea_${idx}`,
        text: txt,
        category: ideaCategoryNormalize(item.category),
        supports: item.supports || [],
        opposes: item.opposes || [],
        area: item.area || '',
        pairedText: item.pairedText || item.pairedSolutionOrEffect || '',
        pairedType: item.pairedType || '',
        pairedId: item.pairedId || '',
        supportsStance: item.supportsStance || ''
      };
    }
    return null;
  }).filter(Boolean);

  // Step 2: heal missing supports/opposes dynamically
  return objArr.map((item, idx) => {
    const origCategory = item.category || '';
    let supports = [...(item.supports || [])];
    let opposes = [...(item.opposes || [])];

    // For focus-area essays, `supports` holds the sub-area name. Never overwrite
    // it with agree/left stance sides — just leave it as-is (and leave opposes
    // empty; focus-area filtering only reads `supports`).
    if (isFocusAreaEssay) {
      item.supports = supports;
      item.opposes = opposes;
      return item;
    }

    if (supports.length === 0 || opposes.length === 0) {
      const catLower = origCategory.toLowerCase();
      if (catLower === 'counter_point' || catLower === 'disadvantage' || catLower === 'con' || catLower === 'oppose') {
        supports = ['disagree', 'right'];
        opposes = ['agree', 'left'];
      } else if (catLower === 'main_support' || catLower === 'advantage' || catLower === 'pro' || catLower === 'support') {
        supports = ['agree', 'left'];
        opposes = ['disagree', 'right'];
      } else if (catLower === 'example') {
        // Find nearest reason in the object array
        let nearestReason = null;
        let minDistance = Infinity;
        for (let j = 0; j < objArr.length; j++) {
          if (j === idx) continue;
          const other = objArr[j];
          const otherCat = (other.category || '').toLowerCase();
          if (otherCat === 'main_support' || otherCat === 'advantage' || otherCat === 'disadvantage' || otherCat === 'counter_point' || otherCat === 'cause' || otherCat === 'problem' || otherCat === 'challenge' || otherCat === 'pro' || otherCat === 'con' || otherCat === 'support' || otherCat === 'oppose') {
            const dist = Math.abs(idx - j);
            if (dist < minDistance) {
              minDistance = dist;
              nearestReason = other;
            }
          }
        }
        
        if (nearestReason) {
          const nrCat = nearestReason.category.toLowerCase();
          if (nrCat === 'counter_point' || nrCat === 'disadvantage' || nrCat === 'con' || nrCat === 'oppose') {
            supports = ['disagree', 'right'];
            opposes = ['agree', 'left'];
          } else if (nrCat === 'main_support' || nrCat === 'advantage' || nrCat === 'pro' || nrCat === 'support') {
            supports = ['agree', 'left'];
            opposes = ['disagree', 'right'];
          } else {
            supports = nearestReason.supports || [];
            opposes = nearestReason.opposes || [];
          }
        }

        // Fallback to ID-prefix if no nearest reason found or it didn't have supports/opposes
        if (supports.length === 0 && opposes.length === 0) {
          if (item.id && String(item.id).startsWith('right')) {
            supports = ['disagree', 'right'];
            opposes = ['agree', 'left'];
          } else if (item.id && String(item.id).startsWith('left')) {
            supports = ['agree', 'left'];
            opposes = ['disagree', 'right'];
          }
        }
      }
    }

    item.supports = supports;
    item.opposes = opposes;
    return item;
  });
}

function ideaCategoryNormalize(cat) {
  if (!cat) return 'main_support';
  const c = cat.toLowerCase();
  if (['problem', 'cause', 'challenge', 'main_support', 'advantage'].includes(c)) return c;
  if (['solution', 'effect', 'consequence', 'example', 'disadvantage'].includes(c)) return c;
  return 'main_support';
}

function getAgreementSide(stance) {
  const s = (stance || '').toLowerCase().trim();

  const agreeStances = [
    'strongly agree',
    'largely agree',
    'partially agree',
    'agree'
  ];

  const disagreeStances = [
    'strongly disagree',
    'largely disagree',
    'partially disagree',
    'disagree'
  ];

  if (disagreeStances.includes(s)) return 'disagree';
  if (agreeStances.includes(s)) return 'agree';
  return '';
}

function stanceMatches(stance, target) {
  if (!stance || !target) return false;
  const s = stance.toLowerCase();
  const t = target.toLowerCase();
  const e = getCurrent();
  
  let leftOpt = '';
  let rightOpt = '';
  if (e && e.detectedOptions && e.detectedOptions.length >= 2) {
    leftOpt = e.detectedOptions[0].toLowerCase();
    rightOpt = e.detectedOptions[1].toLowerCase();
  }

  if (t === 'left' || t === 'agree') {
    const matchesAgree = s.includes('agree') && !s.includes('disagree');
    const matchesLeftOpt = leftOpt && s.includes(leftOpt);
    return matchesAgree || matchesLeftOpt;
  }
  
  if (t === 'right' || t === 'disagree') {
    const matchesDisagree = s.includes('disagree');
    const matchesRightOpt = rightOpt && s.includes(rightOpt);
    return matchesDisagree || matchesRightOpt;
  }

  return s.includes(t);
}

function filterIdeasForStance(activeType, chosenStance, allIdeas) {
  const alignedIdeas = [];
  const optionalContrastIdeas = [];
  const blockedIdeas = [];
  const warnings = [];
  if (!allIdeas || !Array.isArray(allIdeas)) {
    return { alignedIdeas, optionalContrastIdeas, blockedIdeas, warnings };
  }
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  if (typeCfg.stanceRequired && !chosenStance) {
    return { alignedIdeas, optionalContrastIdeas, blockedIdeas, warnings };
  }
  allIdeas.forEach(idea => {
    let isOpposed = false;
    if (chosenStance) {
      if (idea.opposes && idea.opposes.some(o => stanceMatches(chosenStance, o))) {
        isOpposed = true;
      }
      if (activeType === 'two_option_preference') {
        const opposesStance = idea.opposes && idea.opposes.some(o => stanceMatches(chosenStance, o));
        const supportsOpposite = idea.supports && idea.supports.some(s => !stanceMatches(chosenStance, s));
        if (opposesStance || supportsOpposite) {
          isOpposed = true;
        }
      }
    }
    if (isOpposed) {
      optionalContrastIdeas.push(idea);
      blockedIdeas.push(idea);
    } else {
      alignedIdeas.push(idea);
    }
  });
  return { alignedIdeas, optionalContrastIdeas, blockedIdeas, warnings };
}

function revalidateSelectedIdeas(e) {
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  
  if (!e.selectedReasonIds) e.selectedReasonIds = [];
  if (!e.selectedExampleIds) e.selectedExampleIds = [];
  if (!e.selectedSolutionIds) e.selectedSolutionIds = [];
  if (!e.optionalContrastIds) e.optionalContrastIds = [];
  
  let didAutopopulate = false;
  if (e.suggestedIdeas && e.suggestedIdeas.length > 0) {
    const relationTypes = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'];
    const isFocusArea = (activeType === 'single_best_option') && e.secondaryFeatures && e.secondaryFeatures.includes('focus_area');
    const isRel = relationTypes.includes(activeType) || (activeType === 'single_best_option' && e.secondaryFeatures && e.secondaryFeatures.includes('solution_required') && !isFocusArea);

    if (isFocusArea) {
      // Don't force-pick: the student chooses a sub-area, then deliberately picks
      // 2 reasons + 2 examples within it. But if they switch areas, prune any
      // selections that no longer belong to the newly chosen area.
      const areaText = (e.chosenStance || '').replace(/^focus:\s*/i, '').toLowerCase();
      if (areaText) {
        const matchArea = (val) => {
          const v = (val || '').toLowerCase();
          return v && (v.includes(areaText) || areaText.includes(v));
        };
        const inArea = (idea) => {
          if (!idea) return false;
          if (idea.area) return matchArea(idea.area);
          if (idea.supports && idea.supports.length) {
            return idea.supports.some(matchArea);
          }
          return true;
        };
        // Mirror the picker's graceful fallback: if fewer than 2 ideas of a
        // category are tagged to this area, the picker shows ALL of them, so we
        // must NOT prune that category (otherwise valid picks would vanish).
        const reasonIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'cause' || i.category === 'problem' || i.category === 'challenge' || i.category === 'advantage');
        const solutionIdeas = e.suggestedIdeas.filter(i => i.category === 'solution' || i.category === 'example');
        const reasonsInArea = reasonIdeas.filter(inArea);
        const solutionsInArea = solutionIdeas.filter(inArea);
        const reasonsFellBack = reasonsInArea.length < 2 && reasonIdeas.length > reasonsInArea.length;
        const solutionsFellBack = solutionsInArea.length < 2 && solutionIdeas.length > solutionsInArea.length;

        if (!reasonsFellBack) {
          const prunedReasons = e.selectedReasonIds.filter(txt => inArea(e.suggestedIdeas.find(i => i.text === txt)));
          if (prunedReasons.length !== e.selectedReasonIds.length) { e.selectedReasonIds = prunedReasons; didAutopopulate = true; }
        }
        if (!solutionsFellBack) {
          const prunedSolutions = e.selectedSolutionIds.filter(txt => inArea(e.suggestedIdeas.find(i => i.text === txt)));
          if (prunedSolutions.length !== e.selectedSolutionIds.length) { e.selectedSolutionIds = prunedSolutions; didAutopopulate = true; }
        }
      }
      if (e.selectedExampleIds && e.selectedExampleIds.length > 0) {
        e.selectedExampleIds = [];
        didAutopopulate = true;
      }
    } else if (isRel) {
      if (e.selectedReasonIds.length === 0) {
        const leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left')));
        e.selectedReasonIds = leftIdeas.slice(0, 2).map(i => i.text);
        didAutopopulate = true;
      }
    } else if (activeType === 'opinion_alternatives') {
      const stanceSide = getAgreementSide(e.chosenStance);
      if (stanceSide) {
        const allowedCategory = stanceSide === 'agree' ? 'advantage' : 'disadvantage';
        const allowedReasonTexts = new Set(
          e.suggestedIdeas
            .filter(i => i.category === allowedCategory)
            .map(i => i.text)
        );
        const originalLength = e.selectedReasonIds.length;
        e.selectedReasonIds = e.selectedReasonIds
          .filter(txt => allowedReasonTexts.has(txt))
          .slice(0, 2);
        if (e.selectedReasonIds.length !== originalLength) {
          didAutopopulate = true;
        }
      }
      if (e.selectedExampleIds && e.selectedExampleIds.length > 0) {
        e.selectedExampleIds = [];
        didAutopopulate = true;
      }
      if (e.selectedSolutionIds.length > 2) {
        e.selectedSolutionIds = e.selectedSolutionIds.slice(0, 2);
        didAutopopulate = true;
      }
    } else if (['opinion', 'agree_disagree', 'two_option_preference'].includes(activeType)) {
      if (e.chosenStance) {
        const { alignedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
        const mainSupport = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'cause' || i.category === 'problem');
        
        if (e.selectedReasonIds.length === 0) {
          e.selectedReasonIds = mainSupport.slice(0, 2).map(i => i.text);
          didAutopopulate = true;
        }
        if (e.selectedExampleIds && e.selectedExampleIds.length > 0) {
          e.selectedExampleIds = [];
          didAutopopulate = true;
        }
      }
    } else {
      const leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || (i.supports && i.supports.includes('left')));
      const rightIdeas = e.suggestedIdeas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right')));
      
      if (e.selectedReasonIds.length === 0) {
        e.selectedReasonIds = leftIdeas.slice(0, 2).map(i => i.text);
        didAutopopulate = true;
      }
      
      const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution');
      if (isSolution) {
        if (e.selectedSolutionIds.length === 0) {
          e.selectedSolutionIds = rightIdeas.slice(0, 2).map(i => i.text);
          didAutopopulate = true;
        }
      } else {
        if (e.selectedExampleIds.length === 0) {
          e.selectedExampleIds = rightIdeas.slice(0, 2).map(i => i.text);
          didAutopopulate = true;
        }
      }
    }
  }
  
  if (didAutopopulate) {
    setTimeout(() => saveAll(), 0);
  }
  
  let warnings = [];
  let errors = [];
  
  if (typeCfg.stanceRequired) {
    if (!e.chosenStance) {
      errors.push("Please select a stance first.");
    } else {
      const { blockedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
      const blockedTexts = blockedIdeas.map(i => i.text);
      e.selectedReasonIds.forEach(txt => {
        if (blockedTexts.includes(txt)) {
          warnings.push(`"${txt}" supports the opposite side, so it can only be used as optional contrast.`);
        }
      });
    }
  }
  
  const pickedReasonsCount = e.selectedReasonIds.length;
  const pickedExamplesCount = e.selectedExampleIds.length;
  const pickedSolutionsCount = e.selectedSolutionIds.length;
  
  const isFocusAreaWarn = (activeType === 'single_best_option') && e.secondaryFeatures && e.secondaryFeatures.includes('focus_area');
  const isRel = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'].includes(activeType) || (activeType === 'single_best_option' && e.secondaryFeatures && e.secondaryFeatures.includes('solution_required') && !isFocusAreaWarn);
  
  if (isFocusAreaWarn) {
    if (!e.chosenStance) {
      warnings.push("Please choose a focus area first.");
    } else if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
      warnings.push("Please select exactly 2 reasons and 2 examples/solutions.");
    }
  } else if (isRel) {
    if (pickedReasonsCount !== 2) {
      warnings.push(`Please select exactly 2 causes/problems/challenges.`);
    }
  } else if (['opinion', 'agree_disagree', 'two_option_preference'].includes(activeType)) {
    if (pickedReasonsCount !== 2) {
      warnings.push("Please select exactly 2 supporting reasons.");
    }
  } else if (activeType === 'problem_solution') {
    if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
      warnings.push("Please select 2 problems and 2 solutions.");
    }
  } else {
    if (pickedReasonsCount !== 2 || pickedExamplesCount !== 2) {
      warnings.push("Please select 2 left-side and 2 right-side ideas.");
    }
  }
  
  e.ideaValidationErrors = errors;
  e.ideaValidationWarnings = warnings;
}

function syncSelectedIdeasToSeed(e) {
  const qType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[qType] || QUESTION_TYPES.advantages_disadvantages;
  let lines = [
    `QUESTION TYPE: ${qType}`,
    `STANCE: ${e.chosenStance || 'None'}`
  ];
  if (e.selectedReasonIds && e.selectedReasonIds.length > 0) {
    lines.push(`MAIN REASONS: ${e.selectedReasonIds.join('; ')}`);
  }
  if (e.selectedExampleIds && e.selectedExampleIds.length > 0) {
    lines.push(`EXAMPLES: ${e.selectedExampleIds.join('; ')}`);
  }
  if (e.selectedSolutionIds && e.selectedSolutionIds.length > 0) {
    lines.push(`SOLUTIONS: ${e.selectedSolutionIds.join('; ')}`);
  }
  if (e.optionalContrastIds && e.optionalContrastIds.length > 0) {
    lines.push(`OPTIONAL CONTRAST: ${e.optionalContrastIds.join('; ')}`);
  }
  const joined = lines.join('\n');
  e.seedIdeas = joined;
  const el = document.getElementById('f_seedIdeas');
  if (el) el.value = joined;
}

function buildStructuredEssayPlan(e) {
  const qType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[qType] || QUESTION_TYPES.advantages_disadvantages;
  const bag = getTemplatesBag();
  const templateChoice = e.templateChoice || bag.default || 'band9';
  const manualIdeas = parseManualIdeas(e.seedIdeas || '');

  // Compile paired ideas if they are paired in the question type
  const paired_ideas = [];
  if (typeCfg.ideasPaired) {
    const leftIdeas = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left'))) : [];
    
    (e.selectedReasonIds || []).forEach(leftText => {
      const leftIdea = leftIdeas.find(i => i.text === leftText) || { text: leftText };
      const leftIdx = leftIdeas.findIndex(i => i.text === leftText);
      const pairedText = getPairedTextForIdea(e, leftIdea, leftIdx > -1 ? leftIdx : 0);
      
      if (qType === 'problem_solution') {
        paired_ideas.push({ problem: leftText, solution: pairedText });
      } else if (qType === 'cause_solution') {
        paired_ideas.push({ cause: leftText, solution: pairedText });
      } else if (qType === 'cause_effect') {
        paired_ideas.push({ cause: leftText, effect: pairedText });
      } else if (qType === 'problem_effect') {
        paired_ideas.push({ problem: leftText, effect: pairedText });
      } else if (qType === 'single_best_option') {
        paired_ideas.push({ cause: leftText, solution: pairedText });
      }
    });
  }

  const isFocusAreaPlan = (qType === 'single_best_option') && (e.secondaryFeatures || []).includes('focus_area');
  const focusAreaName = (e.chosenStance || '').replace(/^focus:\s*/i, '').trim();
  const planParagraphRoles = isFocusAreaPlan
    ? {
        intro: `Introduce the broad topic briefly, then state that the essay will focus on "${focusAreaName || 'the chosen area'}" and why it matters`,
        bp1: `Explain why "${focusAreaName || 'the chosen area'}" is important and how the broader topic affects it`,
        bp2: `Give concrete examples and practical solutions specifically for "${focusAreaName || 'the chosen area'}"`,
        conclusion: `Restate that "${focusAreaName || 'the chosen area'}" is a priority area, summarise the reasons and solutions, and finish with a strong forward-looking sentence`
      }
    : {
        intro: "Introduce the topic and state a clear opinion or paraphrase the essay question",
        bp1: typeCfg.bp1Role || "Discuss body paragraph 1 arguments",
        bp2: typeCfg.bp2Role || "Discuss body paragraph 2 arguments",
        conclusion: typeCfg.conclusionRole || "Summarise the main arguments and provide a final recommendation"
      };

  return {
    id: e.id || '',
    topic: e.title || '',
    band6Mode: e.band6Mode || '',
    question: e.question || '',
    question_type: qType,
    stance: e.chosenStance || '',
    selected_ideas: {
      reasons: e.selectedReasonIds || [],
      examples: e.selectedExampleIds || [],
      advantages: qType === 'advantages_disadvantages' || qType === 'advantages_disadvantages_opinion' ? (e.selectedReasonIds || []) : [],
      disadvantages: qType === 'advantages_disadvantages' || qType === 'advantages_disadvantages_opinion' ? (e.selectedExampleIds || []) : [],
      problems: qType === 'problem_solution' || qType === 'problem_effect' ? (e.selectedReasonIds || []) : [],
      solutions: ['problem_solution', 'cause_solution', 'single_best_option', 'opinion_alternatives'].includes(qType) ? (e.selectedSolutionIds || []) : [],
      causes: qType === 'cause_solution' || qType === 'cause_effect' ? (e.selectedReasonIds || []) : [],
      effects: qType === 'cause_effect' || qType === 'problem_effect' ? (e.selectedExampleIds || []) : [],
      contrast: e.optionalContrastIds || []
    },
    manual_ideas: manualIdeas,
    paired_ideas: paired_ideas,
    secondary_features: e.secondaryFeatures || [],
    detected_options: e.detectedOptions || [],
    paragraph_roles: planParagraphRoles,
    target_band_level: templateChoice,
    generation_mode: e.generationMode || 'template',
    vocabulary_level: e.vocab || 3
  };
}

function generatePreviewSignature(e) {
  if (!e) return '';
  const activeType = getActiveQuestionType(e);
  const templateKey = getTemplateKeyForEssay(e);
  const bag = getTemplatesBag();
  const customStr = (templateKey === 'custom' && bag && bag.custom) ? JSON.stringify(bag.custom) : '';
  const parts = [
    e.id || '',
    (e.question || '').trim(),
    activeType,
    e.chosenStance || '',
    (e.selectedReasonIds || []).join(','),
    (e.selectedExampleIds || []).join(','),
    (e.selectedSolutionIds || []).join(','),
    (e.optionalContrastIds || []).join(','),
    e.templateChoice || '',
    e.vocab || '',
    templateKey,
    customStr
  ];
  return parts.join('|');
}

function validateEssayConsistency(e) {
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  const results = {
    valid: true,
    errors: [],
    warnings: [],
    shouldRegenerate: false
  };
  const currentSig = generatePreviewSignature(e);
  if (!e.previewSignature || e.previewSignature !== currentSig) {
    results.valid = false;
    results.shouldRegenerate = true;
    results.errors.push("Preview signature is out of date.");
    return results;
  }
  const essayText = `${e.intro || ''} ${e.bp1 || ''} ${e.bp2 || ''} ${e.concl || ''}`.trim();
  if (!essayText) {
    results.valid = false;
    results.shouldRegenerate = true;
    results.errors.push("Essay is empty.");
    return results;
  }
  if (e.band6Mode === 'just_phrases') {
    return results;
  }
  const introLower = (e.intro || '').toLowerCase();
  const bp1Lower = (e.bp1 || '').toLowerCase();
  const bp2Lower = (e.bp2 || '').toLowerCase();
  const conclLower = (e.concl || '').toLowerCase();
  const textLower = essayText.toLowerCase();
  
  // 1. Question Type correctness check
  if (e.manualQuestionTypeOverride && e.manualQuestionTypeOverride !== activeType) {
    results.warnings.push("Active question type differs from manual override.");
  }
  
  // 2. Selected stance check
  if (typeCfg.stanceRequired && !e.chosenStance) {
    results.errors.push("Stance is required but none was selected.");
  }
  
  // 3. Stance matching check (intro and concl have stance keywords)
  if (typeCfg.stanceRequired && e.chosenStance) {
    const stanceLower = e.chosenStance.toLowerCase();
    const stanceWords = stanceLower.split(/\s+/).filter(w => w.length > 3 && !['better', 'mostly', 'largely', 'strongly', 'should', 'pressing', 'problem', 'most', 'issue'].includes(w));
    const introHasStance = stanceWords.length === 0 || stanceWords.some(w => introLower.includes(w));
    const conclHasStance = stanceWords.length === 0 || stanceWords.some(w => conclLower.includes(w));
    if (!introHasStance) {
      results.warnings.push("Introduction might not clearly state the chosen stance.");
    }
    if (!conclHasStance) {
      results.warnings.push("Conclusion might not clearly reaffirm the chosen stance.");
    }
  }

  // 4. Relation pairs completeness check
  const relationTypes = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'];
  const isSingleBestSolution = (activeType === 'single_best_option' && e.secondaryFeatures && e.secondaryFeatures.includes('solution_required'));
  const isRel = relationTypes.includes(activeType) || isSingleBestSolution;
  if (isRel) {
    const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution' || isSingleBestSolution);
    const leftCount = (e.selectedReasonIds || []).length;
    const rightCount = isSolution ? (e.selectedSolutionIds || []).length : (e.selectedExampleIds || []).length;
    if (leftCount !== rightCount) {
      results.errors.push(`Relation pairs are incomplete: selected ${leftCount} causes/problems but only ${rightCount} solutions/effects.`);
    }
  }
  
  // 5. Single-best-option check
  if (activeType === 'single_best_option') {
    if (!e.chosenStance) {
      results.errors.push("Single-best-option questions must have exactly one main option/problem selected.");
    }
  }

  // 6. Problem-solution essays solutions check
  if (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution') {
    const solutionKeywords = ['solution', 'solve', 'address', 'measure', 'tackle', 'remedy', 'mitigate', 'implement'];
    const bp2HasSolution = solutionKeywords.some(w => bp2Lower.includes(w)) || (e.selectedSolutionIds && e.selectedSolutionIds.length > 0 && e.selectedSolutionIds.some(s => bp2Lower.includes(s.toLowerCase().split(/\s+/)[0])));
    if (!bp2HasSolution) {
      results.warnings.push("Problem-solution essay's Body Paragraph 2 does not seem to include solutions.");
    }
  }

  // 7. Cause-effect essays effects check
  if (activeType === 'cause_effect' || activeType === 'causes_effects' || activeType === 'problem_effect') {
    const effectKeywords = ['effect', 'consequence', 'result', 'impact', 'lead to', 'outcome'];
    const bp2HasEffect = effectKeywords.some(w => bp2Lower.includes(w)) || (e.selectedExampleIds && e.selectedExampleIds.length > 0 && e.selectedExampleIds.some(x => bp2Lower.includes(x.toLowerCase().split(/\s+/)[0])));
    if (!bp2HasEffect) {
      results.warnings.push("Cause-effect essay's Body Paragraph 2 does not seem to include effects or consequences.");
    }
  }

  // 8. Two-option preference balance check
  if (activeType === 'two_option_preference') {
    if (bp2Lower.includes('however') && (bp2Lower.includes('on the other hand') || bp2Lower.includes('balanced')) && bp2Lower.includes('equally')) {
      results.warnings.push("Two-option preference essays must not be fully balanced; they must strongly support the chosen option.");
    }
  }

  // 9 & 10. Strong opinion and BP2 transition checks
  if (typeCfg.stanceRequired && e.chosenStance && activeType !== 'discuss_both_views') {
    const stanceLower = e.chosenStance.toLowerCase();
    const isStrong = stanceLower.includes('strongly') || stanceLower.includes('largely') || stanceLower.includes('is better') || stanceLower.includes('most pressing');
    if (isStrong) {
      const contrastTransitions = ['on the other hand', 'however, another view', 'nevertheless', 'yet'];
      const usesContrast = contrastTransitions.some(t => bp2Lower.includes(t));
      if (usesContrast) {
        results.warnings.push("Strong opinion essay uses contrasting BP2 transition, which might make it sound too balanced.");
      }
    }
  }

  const allSelected = (e.selectedReasonIds || [])
    .concat(e.selectedExampleIds || [])
    .concat(e.selectedSolutionIds || [])
    .concat(e.optionalContrastIds || []);
  allSelected.forEach(idea => {
    const words = idea.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['good', 'help', 'make', 'people', 'many', 'some', 'more', 'less'].includes(w));
    if (words.length > 0) {
      const matchCount = words.filter(w => textLower.includes(w)).length;
      const pct = matchCount / words.length;
      if (pct < 0.35) {
        results.warnings.push(`Selected idea "${idea}" might not be clearly developed in the essay.`);
      }
    }
  });
  
  const isPersonalRequired = e.secondaryFeatures && e.secondaryFeatures.includes('personal_experience_required');
  if (isPersonalRequired) {
    const personalKeywords = ['i ', 'my ', 'me ', 'myself', 'personal'];
    const hasPersonal = personalKeywords.some(w => textLower.includes(w));
    if (!hasPersonal) {
      results.warnings.push("Question requires personal experience/example, but none was detected.");
    }
  }
  if (results.errors.length > 0) {
    results.valid = false;
  }
  return results;
}

function parseManualIdeas(text) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\n/);
  const ideas = [];
  lines.forEach(line => {
    let clean = line.trim();
    if (!clean) return;
    
    if (clean.toUpperCase().startsWith("QUESTION TYPE:") || clean.toUpperCase().startsWith("STANCE:")) {
      return;
    }
    
    const prefixes = ["MAIN REASONS:", "EXAMPLES:", "SOLUTIONS:", "OPTIONAL CONTRAST:"];
    for (const prefix of prefixes) {
      if (clean.toUpperCase().startsWith(prefix)) {
        clean = clean.slice(prefix.length).trim();
        break;
      }
    }
    
    const parts = clean.split(/;/);
    parts.forEach(part => {
      const item = part.trim().replace(/^[-*•\d.)\s]+/, "").trim();
      if (item.length >= 6) {
        ideas.push(item);
      }
    });
  });
  return ideas;
}

function detectUnsupportedClaims(text, question, sourceText, plan) {
  const essayLower = text.toLowerCase();
  const qLower = (question || '').toLowerCase();
  const sLower = (sourceText || '').toLowerCase();
  
  const allowedTokens = new Set();
  
  const addAllowedText = (txt) => {
    if (!txt) return;
    const words = txt.toLowerCase().split(/[\s,.:;?!"'()]+/);
    words.forEach(w => {
      if (w.length > 2 || /^\d+$/.test(w)) allowedTokens.add(w);
    });
  };

  addAllowedText(question);
  addAllowedText(sourceText);
  if (plan) {
    if (plan.manual_ideas) {
      plan.manual_ideas.forEach(i => addAllowedText(i));
    }
    if (plan.selected_ideas) {
      Object.values(plan.selected_ideas).forEach(arr => {
        if (Array.isArray(arr)) {
          arr.forEach(i => addAllowedText(i));
        }
      });
    }
  }

  const detected = [];

  // 1. Check for invented percentages (e.g. "85%")
  const pctRegex = /\b(\d+)\s*(?:%|percent\b|percentage\b)/gi;
  let match;
  while ((match = pctRegex.exec(essayLower)) !== null) {
    const num = match[1];
    if (!allowedTokens.has(num) && !allowedTexts.some(t => t.includes(match[0]))) {
      detected.push(`Invented percentage: "${match[0]}"`);
    }
  }

  // 2. Check for fake citation phrases
  const fakePhrases = [
    "studies show", "research shows", "research proves", "experts say", "survey found",
    "according to researchers", "a recent study", "harvard study", "university of",
    "university researchers", "experts suggest", "scientists prove", "scientists say",
    "researchers say", "according to a survey", "according to a study", "according to research",
    "according to experts", "according to scientists", "according to statistics", "statistical analysis",
    "survey of", "researchers at", "study by"
  ];
  for (const phrase of fakePhrases) {
    if (essayLower.includes(phrase) && !qLower.includes(phrase) && !sLower.includes(phrase)) {
      detected.push(`Unsupported citation claim: "${phrase}"`);
    }
  }

  // 3. Named organizations
  const orgs = [
    "oecd", "pew research", "who", "world health organization", "un", "united nations", "unesco",
    "world bank", "imf", "harvard", "stanford", "oxford", "cambridge", "mit", "apa", "american psychological association",
    "nasa", "fda", "yale", "princeton"
  ];
  for (const org of orgs) {
    const orgRegex = new RegExp(`\\b${org}\\b`, 'i');
    if (orgRegex.test(essayLower) && !orgRegex.test(qLower) && !orgRegex.test(sLower) && !allowedTokens.has(org)) {
      detected.push(`Unsupported organization citation: "${org.toUpperCase()}"`);
    }
  }

  // 4. University or research center regex patterns (e.g. "University of [name]")
  const patterns = [
    /\buniversity of [a-z]+/gi,
    /\b[a-z]+ university\b/gi,
    /\b[a-z]+ research (?:center|centre|institute)\b/gi,
    /\b[a-z]+ association\b/gi
  ];
  for (const regex of patterns) {
    let patMatch;
    while ((patMatch = regex.exec(essayLower)) !== null) {
      const matchedText = patMatch[0].toLowerCase();
      const words = matchedText.split(/\s+/).filter(w => !['university', 'of', 'research', 'center', 'centre', 'institute', 'association'].includes(w));
      const isAllowed = words.every(w => allowedTokens.has(w)) || qLower.includes(matchedText) || sLower.includes(matchedText);
      if (!isAllowed) {
        detected.push(`Unsupported institution citation: "${patMatch[0]}"`);
      }
    }
  }

  return detected;
}

function validateEssayStateBeforeGeneration(e) {
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  const errors = [];
  const warnings = [];

  // Stance check
  if (typeCfg.stanceRequired && !e.chosenStance) {
    errors.push("A stance/opinion selection is required for this question type.");
  }

  // Ideas check (check manual path first)
  if (e.seedIdeas && e.seedIdeas.trim().length > 0) {
    const manualIdeas = parseManualIdeas(e.seedIdeas);
    if (manualIdeas.length === 0) {
      errors.push("Your manual idea is too short. Please write at least one clear idea, such as 'traffic congestion slows down public transport.'");
    }
  } else {
    // Validate selected AI ideas
    const pickedReasonsCount = (e.selectedReasonIds || []).length;
    const pickedExamplesCount = (e.selectedExampleIds || []).length;
    const pickedSolutionsCount = (e.selectedSolutionIds || []).length;

    const isSolution = ['problem_solution', 'cause_solution', 'causes_solutions'].includes(activeType);
    const isEffect = ['cause_effect', 'problem_effect', 'causes_effects', 'problems_effects'].includes(activeType);
    const isStanceAgreement = ['opinion', 'agree_disagree', 'two_option_preference', 'opinion_alternatives'].includes(activeType);

    if (isSolution) {
      if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
        errors.push("Please select exactly 2 problems/causes and 2 matching solutions.");
      }
    } else if (isEffect) {
      if (pickedReasonsCount !== 2 || pickedExamplesCount !== 2) {
        errors.push("Please select exactly 2 causes/problems and 2 matching effects.");
      }
    } else if (activeType === 'single_best_option') {
      const isFocusArea = e.secondaryFeatures && e.secondaryFeatures.includes('focus_area');
      if (isFocusArea) {
        if (!e.chosenStance) {
          errors.push("Please choose a focus area first.");
        } else if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
          errors.push("Please select exactly 2 reasons and 2 examples/solutions.");
        }
      } else if (pickedReasonsCount !== 2) {
        errors.push("Please select exactly 2 causes/challenges.");
      }
    } else if (activeType === 'opinion_alternatives') {
      if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
        errors.push("Please select exactly 2 supporting reasons and 2 alternative actions.");
      }
    } else if (isStanceAgreement) {
      if (pickedReasonsCount !== 2) {
        errors.push("Please select exactly 2 supporting reasons.");
      }
    } else {
      // Balanced stance types and non-stance types (require 2 left-side and 2 right-side ideas)
      if (pickedReasonsCount !== 2 || pickedExamplesCount !== 2) {
        const leftLabel = typeCfg.leftLabel || 'left-side';
        const rightLabel = typeCfg.rightLabel || 'right-side';
        errors.push(`Please select exactly 2 ${leftLabel.toLowerCase()} and 2 ${rightLabel.toLowerCase()} ideas.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function generateEssayPrompt(plan, template) {
  const isBand6 = (plan.target_band_level === 'band6');
  const isNatural = (plan.generation_mode === 'natural');

  const vocabSpec = VOCAB_LEVELS[(plan.vocabulary_level || 3) - 1] || VOCAB_LEVELS[2];

  let ideasBlock = '';
  if (plan.manual_ideas && plan.manual_ideas.length > 0) {
    ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
You MUST write the essay using these manual ideas. Address them clearly.
- Manual ideas: ${plan.manual_ideas.map(x => `"${x}"`).join(' and ')}
`;
  } else {
    const reasons = plan.selected_ideas.reasons || [];
    const solutions = plan.selected_ideas.solutions || [];
    const examples = plan.selected_ideas.examples || [];
    const contrast = plan.selected_ideas.contrast || [];
    
    const isOpinionAlts = (plan.question_type === 'opinion_alternatives');
    const isFocusArea = (plan.question_type === 'single_best_option') && (plan.secondary_features || []).includes('focus_area');
    const isOpinionOrAgreeDisagree = ['opinion', 'agree_disagree'].includes(plan.question_type);
    const isOpinionOrPreference = ['opinion', 'agree_disagree', 'two_option_preference'].includes(plan.question_type);
    
    if (isFocusArea) {
      const focusArea = (plan.stance || '').replace(/^focus:\s*/i, '').trim() || 'the chosen area';
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
This question asks the writer to choose ONE specific area of the broader topic and justify that choice. The writer has chosen to focus on: "${focusArea}". The essay must commit to this ONE area only — do NOT drift into a general overview of the whole topic and do NOT discuss other areas except for a brief mention in the introduction.

- Introduction: Briefly introduce the broad topic in one sentence, then clearly state that this essay will focus on "${focusArea}" and give the reason this area matters most.

- Body Paragraph 1 (Why this area matters): Explain WHY "${focusArea}" is important and how the broader topic affects it. Build the paragraph around these chosen reasons:
  * Reason 1: "${reasons[0] || ''}" (develop it with a short, concrete, everyday explanation)
  * Reason 2: "${reasons[1] || ''}" (develop it with a short, concrete, everyday explanation)

- Body Paragraph 2 (Examples and solutions): Give concrete examples for "${focusArea}" and practical ways the issue can be approached or managed. Build the paragraph around these chosen items:
  * Example/Solution 1: "${solutions[0] || examples[0] || 'a relevant example or solution'}" (explain how it helps, with a short relatable example)
  * Example/Solution 2: "${solutions[1] || examples[1] || 'another relevant example or solution'}" (explain how it helps, with a short relatable example)

- Conclusion: Restate that "${focusArea}" is an important area to focus on, briefly summarise the reasons and solutions, and end with a strong forward-looking sentence about why protecting/addressing this area matters.
`;
    } else if (isOpinionAlts) {
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
You MUST write the essay using exactly these chosen supporting reasons and alternative actions:
- Body Paragraph 1 (Supporting Stance): Focus on supporting the stance: "${plan.stance || ''}".
  * Supporting Reason 1: "${reasons[0] || ''}" (You MUST autogenerate a short, concrete, everyday example to support this reason, e.g. "employees using translation apps")
  * Supporting Reason 2: "${reasons[1] || ''}" (You MUST autogenerate a short, concrete, everyday example to support this reason, e.g. "students submitting homework online")

- Body Paragraph 2 (Alternative Actions): Suggest and discuss alternative actions to take instead:
  * Alternative Action 1: "${solutions[0] || 'a relevant alternative action'}" (provide a supporting explanation and a short relatable example for it).
  * Alternative Action 2: "${solutions[1] || 'another alternative action'}" (provide a supporting explanation and a short relatable example for it).
  * Keep the discussion very simple, presenting the opinion/stance in Body Paragraph 1 and the alternative actions in Body Paragraph 2.
`;
    } else if (isOpinionOrAgreeDisagree) {
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
For all opinion-based essays, keep it very simple and present both the positives and negatives of the topic:
- Body Paragraph 1 (Positives / Supporting Side): Focus on the positive aspects or supporting reasons for the stance.
  * Supporting Reason 1: "${reasons[0] || ''}" (You MUST autogenerate a short, concrete, everyday, and relatable example for this reason, e.g. "employees using translation apps")
  * Supporting Reason 2: "${reasons[1] || ''}" (You MUST autogenerate a short, concrete, everyday, and relatable example for this reason, e.g. "students submitting homework online")

- Body Paragraph 2 (Negatives / Drawbacks / Limitations): Focus on the negative aspects, drawbacks, or limitations of the topic to present a balanced view.
  * Develop the Contrast point: "${contrast[0] || 'a relevant drawback or limitation of the topic'}" (provide a supporting explanation and a short relatable example for it, e.g. "some people feeling isolated"). If no contrast point is selected, you MUST automatically generate a simple, common negative aspect or drawback of the topic yourself.
  * Keep the discussion very simple, presenting the positives in Body Paragraph 1 and the negatives/limitations in Body Paragraph 2, regardless of how strong the chosen stance is.
`;
    } else if (isOpinionOrPreference) {
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
You MUST write the essay using exactly these chosen supporting reasons. You MUST automatically generate a very simple, concrete, everyday, and relatable supporting example for each reason yourself (do NOT use academic/unsupported statistics or citations):
- Body Paragraph 1:
  * Supporting Reason 1: "${reasons[0] || ''}" (You MUST autogenerate a short, concrete, everyday example to support this reason, e.g. "employees using translation apps")
  * Supporting Reason 2: "${reasons[1] || ''}" (You MUST autogenerate a short, concrete, everyday example to support this reason, e.g. "students submitting homework online")
`;
      if (contrast && contrast.length > 0) {
        ideasBlock += `
- Body Paragraph 2:
  * Develop the Optional Contrast point: "${contrast[0]}" (provide a supporting explanation and a short relatable example for it).
  * If the stance is strong and one-sided, write another supporting reason and autogenerated example instead of contrasting, or present the contrast point briefly without weakening the stance.
`;
      } else {
        ideasBlock += `
- Body Paragraph 2:
  * Since no contrast point is selected, write two further supporting reasons/points and short relatable examples that reinforce the stance: "${plan.stance || ''}". Do NOT repeat or reuse the reasons from Body Paragraph 1.
`;
      }
    } else {
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
You MUST write the essay using exactly these chosen ideas. Do NOT substitute synonyms. Do NOT skip them.
- Body Paragraph 1 ideas: ${reasons.map(x => `"${x}"`).join(' and ')}
- Body Paragraph 2 ideas: ${solutions.length > 0 ? solutions.map(x => `"${x}"`).join(' and ') : examples.map(x => `"${x}"`).join(' and ')}
${contrast.length > 0 ? `- Optional Contrast: "${contrast[0]}"` : ''}
`;
    }
  }

  const naturalStyleInstruction = `
=== WRITING STYLE: NATURAL MODE (CRITICAL) ===
Write naturally and avoid standard templates or rigid, formulaic transitions. Focus on fluid, sophisticated, and varied sentence structures that feel authentic and custom-written.
- Do NOT use formulaic transitional boilerplate.
- Do NOT start the introduction with "The topic of [X] has become increasingly important in recent years, prompting varied opinions. Its significance lies in..." or any variation of it.
- Do NOT start body paragraphs with "To begin with, one major reason/merit/cause/problem is..." or "On the other hand, one notable solution/demerit/negative effect is...".
- Do NOT start the conclusion with "To conclude, [X] presents key problems and remedies..." or "Hence, prioritising... is essential for...".
These formulaic templates make the essay look robotic and rehearsed. Write a completely fresh, organically structured essay where ideas are connected logically with diverse, natural transitions (e.g. 'First and foremost', 'A primary consideration', 'Conversely', 'Another approach worth exploring', 'In sum', 'Ultimately', etc., used naturally).
`;

  const templateStyleInstruction = `
=== WRITING STYLE: EXAM TEMPLATE MODE (FOLLOW TEMPLATE CLOSELY) ===
Fill in the [square bracket] placeholders with content specific to the essay topic. Keep the template's structure and transitions. You may shorten wordy/boilerplate phrasing when needed to stay under the 300-word limit.
  
INTRODUCTION TEMPLATE:
${template.intro}

BODY PARAGRAPH 1 TEMPLATE:
${template.bp1}

BODY PARAGRAPH 2 TEMPLATE:
${template.bp2}

CONCLUSION TEMPLATE:
${template.concl}
`;

  const band6VocabRule = `
=== STRICT RULES FOR VOCABULARY (BAND 6 LEVEL) ===
- Use SIMPLE, PLAIN ENGLISH only — CEFR A2-B1 level.
- Keep sentences short, direct, and easy to understand.
- AVOID all academic, sophisticated, or formal words (e.g. avoid foster, cultivate, facilitate, enhance, mitigate, exacerbate, prioritise, optimise, leverage, harness, undermine, sustainable, comprehensive, substantial, pivotal, paramount, deleterious, multifaceted).
- Use everyday words like "helps", "makes", "gives", "saves", "easy", "good", "important".
`;

  const band9VocabRule = `
=== VOCABULARY LEVEL: ${vocabSpec.label} ===
- Desc: ${vocabSpec.desc}
- Avoid obscure/overly flowery words unless they fit naturally (e.g. avoid paramount, deleterious, ubiquitous, salient, exacerbate, mitigate unless truly Band 9+).
`;

  return `You are a professional PTE / IELTS essay writer writing a high-scoring ${plan.target_band_level === 'band6' ? 'Band 6' : 'Band 9'} essay for IPT Brisbane tutoring.
  
ESSAY TOPIC: ${plan.topic || ''}
QUESTION: ${plan.question}

=== STANCE INFORMATION ===
Stance/Opinion: "${plan.stance || 'None'}"
- The essay must align with this stance consistently from intro to conclusion.

${ideasBlock}

${isNatural ? naturalStyleInstruction : templateStyleInstruction}

${isBand6 ? band6VocabRule : band9VocabRule}

=== LENGTH LIMIT (CRITICAL — STRICTLY UNDER 300 WORDS) ===
The COMPLETE essay (introduction + Body Paragraph 1 + Body Paragraph 2 + conclusion) must be UNDER 300 words in total.
Target roughly: introduction ~45 words, each body paragraph ~100 words, conclusion ~45 words.
Target length range is 240-285 words. This is the ideal target.
This 300-word limit is a HARD CAP. If the essay is 300 words or more, it is a FAILURE.
To stay under 300:
- Write concisely. Avoid filler and repetitive transition phrases.
- Keep the actual content rich: keep BOTH key ideas, keep BOTH examples in each body paragraph, and keep the opinion.
- Do NOT write long explanations. Make the point and move directly to the example.

=== STRUCTURAL REQUIREMENTS ===
A. INTRODUCTION:
- Introduce the topic and paraphrase the question naturally.
- State a clear opinion/thesis statement if the question asks for your view or opinion.
- Wrap the topic paraphrase and the essay-type phrase (e.g., "examine the benefits and drawbacks of this practice") in ==double equals==.

B. BODY PARAGRAPHS (BP1 and BP2):
- BP1 Role: ${plan.paragraph_roles.bp1}
- BP2 Role: ${plan.paragraph_roles.bp2}
- For opinion, agree_disagree, and two_option_preference question types, develop the reasons and examples in Body Paragraph 1 and Body Paragraph 2 as specified in the KEY IDEAS AND EXAMPLES section. For other question types, each paragraph must develop exactly the two ideas specified in the plan (either selected or manual).
- Each supporting idea must be followed by a short, concrete, everyday, relatable example (e.g., a student submitting late due to a sudden laptop crash, a traveler using a translation app, or people checking their phones during a meal).
- CRITICAL WARNING: You MUST NOT use any percentages (e.g. 10%, 80%), numbers representing statistics, or words like "percent" / "percentage". Doing so will cause a validation failure.
- CRITICAL WARNING: You MUST NOT use phrases like "studies show", "research shows", "research proves", "according to researchers", "a recent study", "harvard study", "university of ...", "survey found", or "according to a survey".
- Any mention of studies, research, surveys, statistics, or organizations (like WHO, OECD, UN, etc.) is STRICTLY FORBIDDEN.
- Wrap the main clauses of the two supporting ideas/points in ==double equals== (do not wrap the examples or transitions).

C. CONCLUSION:
- Conclusion Role: ${plan.paragraph_roles.conclusion}
- Summarize the main arguments using topic-specific nouns. Avoid boilerplate sentences like "maximising the positive aspects while minimising the negative ones".
- If the introduction stated an opinion, conclude the paragraph and add a final sentence starting with "Therefore, [echo the opinion in fresh, forward-looking wording]" on a new line.

=== HIGHLIGHTING MARKERS (CRITICAL) ===
Wrap clauses in ==double equals== so the PDF can highlight them in yellow:
INTRO: wrap the topic paraphrase (after "topic of"), and the essay-type phrase (after "examine the").
BP1: wrap KEY IDEA 1 clause (after "is" before period), wrap KEY IDEA 2 clause.
BP2: wrap KEY IDEA 1 clause, wrap KEY IDEA 2 clause.
DO NOT wrap: "This is because...", "For example...", "Another problem is...", or the Therefore line.

=== OUTPUT FORMAT ===
Respond with EXACTLY these sections, nothing else, no preamble:

===TITLE===
[a short 3-6 word title for this essay]
===INTRO===
[filled introduction paragraph with ==markers==]
===BP1===
[filled BP1 paragraph with ==markers== — MUST contain TWO concrete everyday examples]
===BP2===
[filled BP2 paragraph with ==markers== — MUST contain TWO concrete everyday examples — NO Therefore line here]
===CONCL===
[filled conclusion paragraph — topic-specific nouns; add the Therefore line on a new line if the intro had an opinion sentence]`;
}

function validateGeneratedEssayText(plan, text) {
  if (plan && plan.id && typeof plan.id === 'string' && !plan.question_type) {
    plan = buildStructuredEssayPlan(plan);
  }

  const errors = [];
  const warnings = [];

  if (!text) {
    errors.push("Generated essay text is empty.");
    return { ok: false, errors, warnings };
  }

  const introIdx = text.indexOf('===INTRO===');
  const bp1Idx = text.indexOf('===BP1===');
  const bp2Idx = text.indexOf('===BP2===');
  const conclIdx = text.indexOf('===CONCL===');

  if (introIdx === -1 || bp1Idx === -1 || bp2Idx === -1 || conclIdx === -1) {
    errors.push("The generated essay is missing some of the required section headers (===INTRO===, ===BP1===, ===BP2===, ===CONCL===).");
    return { ok: false, errors, warnings };
  }

  const getSectionText = (startHeader, nextHeader) => {
    const start = text.indexOf(startHeader);
    if (start === -1) return '';
    const contentStart = start + startHeader.length;
    if (!nextHeader) return text.slice(contentStart).trim();
    const end = text.indexOf(nextHeader);
    if (end === -1) return text.slice(contentStart).trim();
    return text.slice(contentStart, end).trim();
  };

  const intro = getSectionText('===INTRO===', '===BP1===');
  const bp1 = getSectionText('===BP1===', '===BP2===');
  const bp2 = getSectionText('===BP2===', '===CONCL===');
  const concl = getSectionText('===CONCL===', null);

  if (intro.length < 15 || bp1.length < 15 || bp2.length < 15 || concl.length < 15) {
    errors.push("One or more of the required paragraph sections are empty or too short.");
  }

  if (plan && plan.band6Mode === 'just_phrases') {
    return {
      ok: errors.length === 0,
      errors,
      warnings
    };
  }

  const fullEssayClean = `${intro} ${bp1} ${bp2} ${concl}`.replace(/==/g, '').trim();
  const words = fullEssayClean.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount >= 300 && wordCount <= 319) {
    errors.push("The generated essay is too long (300-319 words). Please regenerate a shorter version.");
  } else if (wordCount >= 320) {
    errors.push("The generated essay is too long. Please regenerate a shorter version.");
  }

  const countMarkers = (str) => (str.match(/==/g) || []).length;
  const introMarkers = countMarkers(intro);
  const bp1Markers = countMarkers(bp1);
  const bp2Markers = countMarkers(bp2);

  if (introMarkers % 2 !== 0) {
    errors.push("Introduction has mismatched yellow highlighting markers (==).");
  }
  if (bp1Markers % 2 !== 0) {
    errors.push("Body Paragraph 1 has mismatched yellow highlighting markers (==).");
  }
  if (bp2Markers % 2 !== 0) {
    errors.push("Body Paragraph 2 has mismatched yellow highlighting markers (==).");
  }

  const unsupportedClaims = detectUnsupportedClaims(fullEssayClean, plan.question, '', plan);
  if (unsupportedClaims.length > 0) {
    errors.push("The essay contains unsupported statistics or research claims. Please regenerate without invented data.");
  }

  const isOneSidedType = ['opinion', 'agree_disagree', 'two_option_preference'].includes(plan.question_type);
  if (plan.stance && isOneSidedType) {
    const isBand6Template = (plan.target_band_level === 'band6' && plan.generation_mode === 'template');
    if (!isBand6Template) {
      const stanceLower = plan.stance.toLowerCase();
      const conclLower = concl.toLowerCase();
      const introLower = intro.toLowerCase();

      const stopwords = ['the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor', 'so', 'yet', 'at', 'by', 'in', 'of', 'on', 'to', 'with', 'is', 'are', 'was', 'were', 'been', 'being', 'better', 'mostly', 'largely', 'strongly', 'should', 'pressing', 'problem', 'most', 'issue', 'agree', 'disagree', 'opinion'];
      const stanceWords = stanceLower.split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !stopwords.includes(w));
      
      const introHasStance = stanceWords.length === 0 || stanceWords.some(w => introLower.includes(w));
      const conclHasStance = stanceWords.length === 0 || stanceWords.some(w => conclLower.includes(w));

      if (!introHasStance || !conclHasStance) {
        errors.push("The essay’s conclusion does not clearly match your selected stance.");
      }
    }

    const isStrong = plan.stance.toLowerCase().includes('strongly') || plan.stance.toLowerCase().includes('largely') || plan.stance.toLowerCase().includes('is better') || plan.stance.toLowerCase().includes('most pressing') || plan.stance.toLowerCase().includes('mainly responsible');
    if (isStrong) {
      const bp2Lower = bp2.toLowerCase();
      const contrastTransitions = ['on the other hand', 'however', 'nevertheless', 'conversely', 'yet'];
      const usesContrast = contrastTransitions.some(t => bp2Lower.includes(t));
      if (usesContrast) {
        errors.push("Stance consistency error: A strong one-sided stance was selected, but Body Paragraph 2 contains contrasting transitions (like 'On the other hand' or 'However').");
      }
    }
  }

  const stopwords = ['the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor', 'so', 'yet', 'at', 'by', 'in', 'of', 'on', 'to', 'with', 'is', 'are', 'was', 'were', 'been', 'being'];
  const textLower = fullEssayClean.toLowerCase();

  if (plan.manual_ideas && plan.manual_ideas.length > 0) {
    plan.manual_ideas.forEach(idea => {
      const keywords = idea.toLowerCase().split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !stopwords.includes(w));
      if (keywords.length > 0) {
        const hasMatch = keywords.some(w => textLower.includes(w));
        if (!hasMatch) {
          errors.push(`Your manual idea "${idea}" was not used in the generated essay.`);
        }
      }
    });
  } else {
    const reasons = plan.selected_ideas.reasons || [];
    const solutions = plan.selected_ideas.solutions || [];
    const examples = plan.selected_ideas.examples || [];

    reasons.forEach(idea => {
      const keywords = idea.toLowerCase().split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !stopwords.includes(w));
      if (keywords.length > 0) {
        const hasMatch = keywords.some(w => textLower.includes(w));
        if (!hasMatch) {
          errors.push(`Selected idea "${idea}" was not used in the generated essay.`);
        }
      }
    });
    
    const secondParaIdeas = solutions.length > 0 ? solutions : examples;
    secondParaIdeas.forEach(idea => {
      const keywords = idea.toLowerCase().split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !stopwords.includes(w));
      if (keywords.length > 0) {
        const hasMatch = keywords.some(w => textLower.includes(w));
        if (!hasMatch) {
          errors.push(`Selected idea "${idea}" was not used in the generated essay.`);
        }
      }
    });
  }

  const bp1Sentences = splitSentences(bp1);
  const bp2Sentences = splitSentences(bp2);
  const allSentences = bp1Sentences.concat(bp2Sentences);

  const exampleSentences = allSentences.filter(s => {
    const l = s.toLowerCase();
    return l.includes('for example') || l.includes('for instance') || l.includes('to illustrate') || l.includes('illustrates this') || l.includes('such as');
  });

  const qWords = plan.question.toLowerCase().split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !['good', 'help', 'make', 'people', 'many', 'some', 'more', 'less', 'should', 'would', 'could', 'about', 'question', 'opinion', 'example'].includes(w));
  const weakPhrases = ["in many places", "in modern society", "in some countries", "people can benefit", "this can be seen everywhere"];

  for (const ex of exampleSentences) {
    const exLower = ex.toLowerCase();
    const hasTopicWord = qWords.some(w => exLower.includes(w));
    const isWeak = weakPhrases.some(p => exLower.includes(p));
    
    if (!hasTopicWord || isWeak || ex.split(/\s+/).length < 5) {
      warnings.push(`The essay example is too generic. Try regenerating for a more topic-specific example.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function showTypeOverrideSelect(show) {
  const e = getCurrent();
  if (!e) return;
  const containerId = 'typeOverrideContainer';
  let el = document.getElementById(containerId);
  if (!el) return;
  if (show) {
    const activeType = getActiveQuestionType(e);
    const optionsHtml = Object.keys(QUESTION_TYPES)
      .filter(k => QUESTION_TYPES[k].id === k)
      .map(k => `<option value="${k}" ${k === activeType ? 'selected' : ''}>${escapeHtml(QUESTION_TYPES[k].displayName)}</option>`)
      .join('');
    el.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; width:100%;">
        <select id="typeOverrideSelect" onchange="changeQuestionTypeOverride(this.value)" style="flex:1; padding:6px; font-size:12px; border-radius:4px; border:1px solid var(--line); background:var(--bg); color:var(--ink);">
          ${optionsHtml}
        </select>
        <button class="btn-cancel-type" onclick="event.preventDefault(); showTypeOverrideSelect(false)" style="background:none; border:none; color:var(--accent); font-size:11px; font-weight:600; cursor:pointer; padding:4px 8px;">Cancel</button>
      </div>
    `;
  } else {
    renderIdeasPicker();
  }
}

function changeQuestionTypeOverride(val) {
  const e = getCurrent();
  if (!e) return;
  e.manualQuestionTypeOverride = val;
  e.chosenStance = '';
  e.selectedReasonIds = [];
  e.selectedExampleIds = [];
  e.selectedSolutionIds = [];
  e.optionalContrastIds = [];
  saveAll();
  renderIdeasPicker();
  e.previewSignature = '';
  saveAll();
  renderPreview();
}

function changeChosenStance(opt) {
  const e = getCurrent();
  if (!e) return;
  e.chosenStance = opt;
  saveAll();
  revalidateSelectedIdeas(e);
  renderIdeasPicker();
  e.previewSignature = '';
  saveAll();
  renderPreview();
}

function updatePairedText(idx, newValue) {
  const e = getCurrent();
  if (!e) return;
  
  const activeType = getActiveQuestionType(e);
  let leftIdeas = [];
  if (activeType === 'single_best_option') {
    const { alignedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
    leftIdeas = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'cause' || i.category === 'problem' || i.category === 'challenge');
  } else {
    leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left')));
  }
  
  const leftIdea = leftIdeas[idx];
  if (leftIdea) {
    const oldValue = leftIdea.pairedText || leftIdea.pairedSolutionOrEffect || '';
    leftIdea.pairedText = newValue;
    leftIdea.pairedSolutionOrEffect = newValue;
    
    const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution' || activeType === 'single_best_option');
    const rightList = isSolution ? e.selectedSolutionIds : e.selectedExampleIds;
    if (rightList) {
      const rIdx = rightList.indexOf(oldValue);
      if (rIdx > -1) {
        rightList[rIdx] = newValue;
      }
    }
    saveAll();
    syncSelectedIdeasToSeed(e);
    renderIdeasPicker();
  }
}

function toggleIdeaText(category, text) {
  const e = getCurrent();
  if (!e) return;
  if (!e.selectedReasonIds) e.selectedReasonIds = [];
  if (!e.selectedExampleIds) e.selectedExampleIds = [];
  if (!e.selectedSolutionIds) e.selectedSolutionIds = [];
  if (!e.optionalContrastIds) e.optionalContrastIds = [];
  
  const activeType = getActiveQuestionType(e);
  
  const relationTypes = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'];
  const isFocusArea = (activeType === 'single_best_option') && e.secondaryFeatures && e.secondaryFeatures.includes('focus_area');
  // Focus-area single_best_option is NOT a paired/relation type — reasons and
  // examples are picked independently, so it must skip the auto-pairing branch.
  const isSingleBestSolution = (activeType === 'single_best_option') && !isFocusArea;
  const isRel = relationTypes.includes(activeType) || isSingleBestSolution;
  
  if (isRel) {
    if (category === 'problem' || category === 'cause' || category === 'main_support' || category === 'challenge') {
      let leftIdeas = [];
      let rightIdeas = [];
      
      if (activeType === 'single_best_option') {
        const { alignedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
        leftIdeas = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'cause' || i.category === 'problem' || i.category === 'challenge');
        rightIdeas = alignedIdeas.filter(i => i.category === 'example' || i.category === 'solution' || i.category === 'effect');
      } else {
        leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left')));
        rightIdeas = e.suggestedIdeas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right')));
      }
      
      const leftIdx = leftIdeas.findIndex(i => i.text === text);
      if (leftIdx > -1) {
        const leftIdea = leftIdeas[leftIdx];
        const pairedVal = getPairedTextForIdea(e, leftIdea, leftIdx);
        
        const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution' || activeType === 'single_best_option');
        const rightList = isSolution ? e.selectedSolutionIds : e.selectedExampleIds;
        
        const existIdx = e.selectedReasonIds.indexOf(text);
        if (existIdx > -1) {
          e.selectedReasonIds.splice(existIdx, 1);
          if (pairedVal) {
            const prIdx = rightList.indexOf(pairedVal);
            if (prIdx > -1) rightList.splice(prIdx, 1);
          }
        } else {
          if (e.selectedReasonIds.length >= 2) {
            toast("You can select at most 2 items.", true);
            return;
          }
          e.selectedReasonIds.push(text);
          if (pairedVal && !rightList.includes(pairedVal)) {
            rightList.push(pairedVal);
          }
        }
        saveAll();
        revalidateSelectedIdeas(e);
        renderIdeasPicker();
        syncSelectedIdeasToSeed(e);
        return;
      }
    }
  }
  
  let targetList;
  if (activeType === 'opinion_alternatives') {
    if (category === 'solution') {
      targetList = e.selectedSolutionIds;
    } else {
      targetList = e.selectedReasonIds;
    }
  } else if (category === 'main_support' || category === 'advantage' || category === 'problem' || category === 'cause') {
    const typeCfg = QUESTION_TYPES[activeType];
    if (typeCfg && typeCfg.stanceRequired && e.chosenStance) {
      const { blockedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
      if (blockedIdeas.some(i => i.text === text)) {
        targetList = e.optionalContrastIds;
      } else {
        targetList = e.selectedReasonIds;
      }
    } else {
      targetList = e.selectedReasonIds;
    }
  } else if (category === 'example') {
    targetList = e.selectedExampleIds;
  } else if (category === 'solution') {
    targetList = e.selectedSolutionIds;
  } else if (category === 'optional_contrast' || category === 'counter_point' || category === 'disadvantage' || category === 'effect') {
    targetList = e.optionalContrastIds;
  } else {
    targetList = e.selectedReasonIds;
  }
  const idx = targetList.indexOf(text);
  if (idx > -1) {
    targetList.splice(idx, 1);
  } else {
    const limit = 2;
    if (targetList.length >= limit) {
      toast(`You can select at most ${limit} items for this category.`, true);
      return;
    }
    targetList.push(text);
  }
  saveAll();
  revalidateSelectedIdeas(e);
  renderIdeasPicker();
  syncSelectedIdeasToSeed(e);
}

function usePickerSelectedIdeas() {
  const e = getCurrent();
  if (!e) return;
  syncSelectedIdeasToSeed(e);
  saveAll();
  document.getElementById('ideasPicker').classList.remove('show');
  aiWriteFullEssay();
}

let debouncedRegenTimer = null;
function triggerDebouncedRegeneration(e) {
  if (debouncedRegenTimer) clearTimeout(debouncedRegenTimer);
  debouncedRegenTimer = setTimeout(async () => {
    const attempts = window.regenerationAttempts || (window.regenerationAttempts = {});
    const count = attempts[e.id] || 0;
    if (count >= 2) {
      console.warn("Max regeneration attempts reached for essay", e.id);
      return;
    }
    attempts[e.id] = count + 1;
    console.log(`Silent regeneration attempt ${count + 1} for essay`, e.id);
    const success = await aiWriteFullEssay({ essay: e, silent: true, skipConfirm: true });
    if (success) {
      renderPreview();
    }
  }, 1000);
}

// State for the type-aware picker (replaces the old pickedPros / pickedCons)
let pickedLeftIdeas = new Set();
let pickedRightIdeas = new Set();
let suggestedLeftIdeas = [];
let suggestedRightIdeas = [];
let detectedQuestionType = 'advantages_disadvantages';

// Multi-column picker state (for 3-column "sided" types like opinion_alternatives)
// suggestedCols = { colKey: [idea strings] }, pickedCols = { colKey: Set(indices) }
let suggestedCols = {};
let pickedCols = {};
let chosenSide = null;   // which side column the student picked (e.g. 'agree')
let dynamicLabels = {};
let fsDynamicLabels = {};

function getColLabel(col, e) {
  if (e && e.dynamicLabels && e.dynamicLabels[col.key]) {
    return e.dynamicLabels[col.key];
  }
  if (dynamicLabels && dynamicLabels[col.key]) {
    return dynamicLabels[col.key];
  }
  return col.label;
}

function getFsColLabel(col) {
  if (fsDynamicLabels && fsDynamicLabels[col.key]) {
    return fsDynamicLabels[col.key];
  }
  return col.label;
}


// ============================================================
//  TEMPLATES — Band 6 preset, Band 9 preset, and editable Custom
// ============================================================
// ============================================================
//  VOCABULARY DATA — C1/C2 level
//  30 categories, ~5 words each (~150 starter words)
//  Add more words by editing this constant.
// ============================================================
const VOCAB_DATA = {
  law: {
    label: "Law & Crime", icon: "⚖", order: 1,
    words: [
      {
        word: "litigation", pos: "noun", level: "C1",
        meaning: "The process of taking legal action; a dispute resolved through the court system.",
        examples: [
          "After three years of costly litigation, the two companies finally reached a settlement.",
          "Many businesses avoid litigation by including arbitration clauses in their contracts.",
          "The threat of litigation alone was enough to make him return the disputed property."
        ],
        compare: "vs. lawsuit: 'litigation' refers to the whole legal process; 'lawsuit' is one specific legal action."
      },
      {
        word: "suspect", pos: "noun / verb", level: "C1",
        meaning: "(noun) A person believed to have committed a crime; (verb) to believe someone is guilty.",
        examples: [
          "Police have detained a suspect in connection with the burglary.",
          "She suspected that her colleague had been leaking confidential information.",
          "The main suspect was released after his alibi was confirmed."
        ],
        compare: "vs. accused: 'suspect' is suspected but not yet formally charged; 'accused' has been formally charged."
      },
      {
        word: "attorney", pos: "noun", level: "C1",
        meaning: "A lawyer, especially one qualified to represent clients in court (more common in American English).",
        examples: [
          "You have the right to consult an attorney before answering any questions.",
          "The attorney argued that the evidence had been obtained illegally.",
          "She hired a top defense attorney for her trial."
        ],
        compare: "vs. solicitor / barrister: 'attorney' (US) covers both; UK splits into solicitor (advisor) and barrister (court advocate)."
      },
      {
        word: "juvenile", pos: "adjective / noun", level: "C1",
        meaning: "Relating to young people, especially in the context of crime and law; or, a young person under the age of legal adulthood.",
        examples: [
          "The teenager was tried in a juvenile court rather than as an adult.",
          "Juvenile offenders often respond better to rehabilitation than to imprisonment.",
          "The book explores why juvenile delinquency rates rise in certain neighbourhoods."
        ],
        compare: "vs. child vs. minor: 'child' is anyone young (informal); 'minor' is anyone under legal adult age (general legal term); 'juvenile' is specifically used in criminal/justice contexts (e.g. juvenile detention)."
      },
      {
        word: "incarceration", pos: "noun", level: "C2",
        meaning: "The state of being confined in prison; imprisonment.",
        examples: [
          "Mass incarceration disproportionately affects minority communities.",
          "His ten-year incarceration ended when new evidence proved his innocence.",
          "Critics argue that incarceration alone does not reduce recidivism."
        ],
        compare: "vs. imprisonment / detention: 'incarceration' is formal and emphasises long-term confinement; 'detention' usually means short-term holding before trial."
      }
    ]
  },
  education: {
    label: "Education", icon: "🎓", order: 2,
    words: [
      {
        word: "curriculum", pos: "noun", level: "C1",
        meaning: "The subjects and topics studied in a school, college, or other educational institution.",
        examples: [
          "The new curriculum places a stronger emphasis on critical thinking.",
          "Schools across the country are revising their curricula to include digital literacy.",
          "A balanced curriculum should expose students to both sciences and the humanities."
        ]
      },
      {
        word: "pedagogy", pos: "noun", level: "C2",
        meaning: "The method and practice of teaching; the theory behind how subjects are taught.",
        examples: [
          "Modern pedagogy emphasises active learning over passive memorisation.",
          "Her doctoral thesis focused on pedagogy in early-childhood education.",
          "Effective pedagogy adapts to the diverse needs of individual learners."
        ],
        compare: "vs. teaching: 'teaching' is the act itself; 'pedagogy' is the theory and approach behind it."
      },
      {
        word: "rote learning", pos: "noun phrase", level: "C1",
        meaning: "Memorising information through repetition, without necessarily understanding it.",
        examples: [
          "Rote learning may help students pass exams but rarely produces deep understanding.",
          "Critics argue that an over-reliance on rote learning stifles creativity.",
          "While rote learning has its place, it should be balanced with critical thinking exercises."
        ]
      },
      {
        word: "tertiary", pos: "adjective", level: "C1",
        meaning: "Relating to the third level of education — universities and colleges, after primary and secondary school.",
        examples: [
          "Tertiary education has become essential for most professional careers.",
          "Government funding for tertiary institutions has declined over the past decade.",
          "He decided to pursue tertiary studies in environmental engineering."
        ]
      },
      {
        word: "extracurricular", pos: "adjective", level: "C1",
        meaning: "Relating to activities done at school but not part of the official curriculum.",
        examples: [
          "Extracurricular activities like debate club develop skills exams cannot measure.",
          "Universities increasingly value extracurricular involvement in admissions decisions.",
          "Students who participate in extracurricular sports tend to manage time better."
        ]
      }
    ]
  },
  technology: {
    label: "Technology", icon: "💻", order: 3,
    words: [
      {
        word: "algorithm", pos: "noun", level: "C1",
        meaning: "A set of step-by-step instructions used by a computer to solve a problem or perform a task.",
        examples: [
          "Social media algorithms determine which posts appear in your feed.",
          "The new algorithm reduced processing time by nearly forty percent.",
          "Critics worry that biased algorithms can amplify social inequalities."
        ]
      },
      {
        word: "encryption", pos: "noun", level: "C1",
        meaning: "The process of converting information into a code to prevent unauthorised access.",
        examples: [
          "End-to-end encryption ensures only the sender and recipient can read the message.",
          "Strong encryption is essential for protecting financial transactions online.",
          "The hacker was unable to decode the file due to its advanced encryption."
        ]
      },
      {
        word: "obsolete", pos: "adjective", level: "C1",
        meaning: "No longer in use or useful, because something newer has replaced it.",
        examples: [
          "Fax machines have become almost entirely obsolete in modern offices.",
          "Technology evolves so rapidly that smartphones become obsolete within a few years.",
          "Many traditional jobs risk becoming obsolete due to automation."
        ],
        compare: "vs. outdated: 'outdated' just means old; 'obsolete' means no longer used at all."
      },
      {
        word: "automate", pos: "verb", level: "C1",
        meaning: "To make a process or system operate by itself, using machines or computers instead of people.",
        examples: [
          "The factory has automated most of its assembly line to cut labour costs.",
          "We use software to automate repetitive administrative tasks.",
          "Automating customer service has both reduced costs and frustrated some users."
        ]
      },
      {
        word: "ubiquitous", pos: "adjective", level: "C2",
        meaning: "Present, found, or seemingly everywhere at once.",
        examples: [
          "Smartphones have become ubiquitous in modern life.",
          "Surveillance cameras are now ubiquitous in major city centres.",
          "The ubiquitous use of plastic packaging has created an environmental crisis."
        ]
      }
    ]
  },
  health: {
    label: "Health & Medicine", icon: "🩺", order: 4,
    words: [
      {
        word: "chronic", pos: "adjective", level: "C1",
        meaning: "(Of an illness) lasting a long time or constantly recurring; persistent.",
        examples: [
          "Diabetes is a chronic condition that requires lifelong management.",
          "Chronic stress can contribute to heart disease and depression.",
          "She has been living with chronic back pain for over a decade."
        ],
        compare: "vs. acute: 'chronic' = long-lasting; 'acute' = severe and sudden but short."
      },
      {
        word: "diagnose", pos: "verb", level: "C1",
        meaning: "To identify the nature of an illness or problem by examining the symptoms.",
        examples: [
          "It took several specialists to correctly diagnose her rare condition.",
          "Modern imaging technology helps doctors diagnose tumours earlier.",
          "He was diagnosed with hypertension during a routine check-up."
        ]
      },
      {
        word: "sedentary", pos: "adjective", level: "C1",
        meaning: "Involving little physical activity; sitting for long periods.",
        examples: [
          "A sedentary lifestyle is linked to obesity and cardiovascular disease.",
          "Office workers should counteract their sedentary jobs with regular exercise.",
          "Doctors warn that sedentary behaviour increases the risk of early mortality."
        ]
      },
      {
        word: "epidemic", pos: "noun", level: "C1",
        meaning: "A widespread occurrence of an infectious disease in a community at a particular time.",
        examples: [
          "The flu epidemic overwhelmed hospital emergency departments.",
          "Obesity has been described as a public health epidemic in many countries.",
          "Vaccination programmes have prevented several major epidemics."
        ],
        compare: "vs. pandemic: 'epidemic' affects a region; 'pandemic' affects multiple countries or worldwide."
      },
      {
        word: "convalescence", pos: "noun", level: "C2",
        meaning: "The gradual recovery of health and strength after illness or injury.",
        examples: [
          "After her surgery, she spent six weeks in convalescence at a coastal retreat.",
          "Adequate rest during convalescence is essential to prevent relapse.",
          "His convalescence was prolonged by complications from the infection."
        ]
      }
    ]
  },
  environment: {
    label: "Environment", icon: "🌳", order: 5,
    words: [
      {
        word: "sustainable", pos: "adjective", level: "C1",
        meaning: "Able to be maintained at a certain level without depleting natural resources or causing harm.",
        examples: [
          "Sustainable farming practices protect soil for future generations.",
          "Many companies now publish sustainable development reports.",
          "Affordable, sustainable energy remains a major challenge for developing nations."
        ]
      },
      {
        word: "biodiversity", pos: "noun", level: "C1",
        meaning: "The variety of plant and animal life in a particular habitat or on Earth as a whole.",
        examples: [
          "The Amazon rainforest is home to extraordinary biodiversity.",
          "Loss of biodiversity threatens entire ecosystems and food chains.",
          "Conservation efforts aim to preserve biodiversity in marine environments."
        ]
      },
      {
        word: "deforestation", pos: "noun", level: "C1",
        meaning: "The clearing or removal of forests, usually for farming, mining, or urban development.",
        examples: [
          "Deforestation in the tropics accelerates climate change.",
          "Satellite imagery has revealed alarming rates of deforestation in the Congo Basin.",
          "Local communities are working to reverse decades of deforestation."
        ]
      },
      {
        word: "ecosystem", pos: "noun", level: "C1",
        meaning: "A community of living organisms together with the non-living parts of their environment.",
        examples: [
          "Coral reefs are among the most diverse ecosystems on the planet.",
          "Even small changes in temperature can disrupt an entire ecosystem.",
          "The wetland's ecosystem provides crucial flood protection for nearby cities."
        ]
      },
      {
        word: "pristine", pos: "adjective", level: "C2",
        meaning: "In its original condition; unspoiled, completely clean.",
        examples: [
          "The expedition reached a pristine valley untouched by human activity.",
          "Antarctica's pristine wilderness is increasingly threatened by tourism.",
          "She remembers the pristine beaches of her childhood, now lined with hotels."
        ]
      }
    ]
  },
  business: {
    label: "Business & Economics", icon: "📈", order: 6,
    words: [
      {
        word: "recession", pos: "noun", level: "C1",
        meaning: "A period of temporary economic decline during which trade and industrial activity are reduced.",
        examples: [
          "The 2008 recession affected economies across the globe.",
          "Many small businesses failed during the recession.",
          "Government stimulus packages aim to soften the impact of recession."
        ]
      },
      {
        word: "monopoly", pos: "noun", level: "C1",
        meaning: "Exclusive control of a market by a single company, eliminating competition.",
        examples: [
          "Antitrust laws are designed to prevent a single company from forming a monopoly.",
          "The state holds a monopoly on the sale of alcohol in some countries.",
          "Tech giants have been accused of abusing their near-monopoly status."
        ]
      },
      {
        word: "entrepreneur", pos: "noun", level: "C1",
        meaning: "A person who starts and runs a business, typically taking on financial risks in hopes of profit.",
        examples: [
          "She left her corporate job to become a tech entrepreneur.",
          "Successful entrepreneurs are usually willing to take calculated risks.",
          "Government grants now support young entrepreneurs in rural areas."
        ]
      },
      {
        word: "inflation", pos: "noun", level: "C1",
        meaning: "A general increase in prices, leading to a fall in the purchasing power of money.",
        examples: [
          "Rising fuel costs are a major driver of inflation.",
          "Central banks raise interest rates to combat inflation.",
          "Pensioners on fixed incomes suffer the most from sustained inflation."
        ],
        compare: "vs. deflation: 'inflation' = prices rising; 'deflation' = prices falling."
      },
      {
        word: "liquidity", pos: "noun", level: "C2",
        meaning: "The availability of cash or assets that can quickly be converted into cash without losing value.",
        examples: [
          "The bank faced a liquidity crisis when too many customers withdrew funds at once.",
          "Property is a poor investment when liquidity is a concern.",
          "Companies must maintain adequate liquidity to meet short-term obligations."
        ]
      }
    ]
  },
  travel: {
    label: "Travel & Tourism", icon: "✈", order: 7,
    words: [
      {
        word: "itinerary", pos: "noun", level: "C1",
        meaning: "A planned route or schedule for a journey.",
        examples: [
          "Our two-week itinerary covered five European capitals.",
          "She prefers loose itineraries that allow for spontaneous discoveries.",
          "The travel agent emailed me a detailed itinerary the night before departure."
        ]
      },
      {
        word: "excursion", pos: "noun", level: "C1",
        meaning: "A short journey or trip, especially one taken for pleasure or learning.",
        examples: [
          "The cruise offered a guided excursion to the ancient ruins.",
          "We took a day excursion from Rome to Pompeii.",
          "School excursions to museums help bring history lessons to life."
        ],
        compare: "vs. trip: 'excursion' is usually short and organised; 'trip' is general."
      },
      {
        word: "destination", pos: "noun", level: "C1",
        meaning: "The place to which someone or something is going or being sent.",
        examples: [
          "Bali has become a popular destination for digital nomads.",
          "Our final destination was a small village in the Italian Alps.",
          "Off-the-beaten-path destinations are increasingly attractive to seasoned travellers."
        ]
      },
      {
        word: "cosmopolitan", pos: "adjective", level: "C2",
        meaning: "Containing or having experience of people and things from many different parts of the world.",
        examples: [
          "Singapore is one of the most cosmopolitan cities in Asia.",
          "Her cosmopolitan upbringing made her fluent in four languages.",
          "The neighbourhood has a wonderfully cosmopolitan atmosphere, with cuisines from every continent."
        ]
      },
      {
        word: "wanderlust", pos: "noun", level: "C2",
        meaning: "A strong desire to travel and explore the world.",
        examples: [
          "Her wanderlust took her to over forty countries before she turned thirty.",
          "The documentary stirred a wanderlust in viewers who had never travelled abroad.",
          "Some careers are perfect for those bitten by wanderlust."
        ]
      }
    ]
  },
  science: {
    label: "Science", icon: "🔬", order: 8,
    words: [
      {
        word: "hypothesis", pos: "noun", level: "C1",
        meaning: "A proposed explanation for a phenomenon, used as a starting point for further investigation.",
        examples: [
          "The team tested their hypothesis through a series of controlled experiments.",
          "A good hypothesis must be testable and falsifiable.",
          "Initial data contradicted the original hypothesis."
        ],
        compare: "vs. theory: 'hypothesis' is an untested idea; 'theory' is a well-supported explanation backed by evidence."
      },
      {
        word: "empirical", pos: "adjective", level: "C2",
        meaning: "Based on observation, experience, or experimentation rather than theory.",
        examples: [
          "There is now considerable empirical evidence supporting the treatment's effectiveness.",
          "Empirical research distinguishes science from speculation.",
          "Her conclusions are drawn from empirical data collected over twenty years."
        ]
      },
      {
        word: "scrutiny", pos: "noun", level: "C1",
        meaning: "Careful and thorough examination or inspection.",
        examples: [
          "The findings have come under intense scrutiny from rival researchers.",
          "Any new drug must withstand rigorous scientific scrutiny.",
          "Under closer scrutiny, the data revealed several errors."
        ]
      },
      {
        word: "phenomenon", pos: "noun", level: "C1",
        meaning: "A fact, situation, or event that can be observed; often something unusual or remarkable.",
        examples: [
          "El Niño is a complex meteorological phenomenon.",
          "The aurora borealis is a stunning natural phenomenon.",
          "Social media addiction is a relatively new psychological phenomenon."
        ],
        compare: "Plural is 'phenomena' (not 'phenomenons')."
      },
      {
        word: "paradigm", pos: "noun", level: "C2",
        meaning: "A typical example, pattern, or model of something; a fundamental framework of thought.",
        examples: [
          "Einstein's theory of relativity caused a paradigm shift in physics.",
          "The new model has become the dominant paradigm in cognitive science.",
          "She challenged the prevailing paradigm with revolutionary findings."
        ]
      }
    ]
  },
  sports: {
    label: "Sports", icon: "⚽", order: 9,
    words: [
      {
        word: "endurance", pos: "noun", level: "C1",
        meaning: "The ability to keep doing something difficult, especially physical activity, for a long time.",
        examples: [
          "Marathon runners need extraordinary endurance.",
          "Cycling builds both leg strength and cardiovascular endurance.",
          "Mental endurance is just as important as physical fitness in chess."
        ]
      },
      {
        word: "underdog", pos: "noun", level: "C1",
        meaning: "A competitor thought to have little chance of winning.",
        examples: [
          "The underdog team defeated the reigning champions in extra time.",
          "Audiences love stories about an underdog rising to victory.",
          "She thrived on being the underdog throughout her tennis career."
        ]
      },
      {
        word: "stamina", pos: "noun", level: "C1",
        meaning: "The ability to sustain prolonged physical or mental effort.",
        examples: [
          "Long hikes through the mountains require exceptional stamina.",
          "Her stamina on the football field is unmatched.",
          "Building stamina takes months of consistent training."
        ],
        compare: "vs. endurance: very similar; 'endurance' often emphasises mental persistence too."
      },
      {
        word: "tournament", pos: "noun", level: "C1",
        meaning: "A series of contests between a number of competitors, leading to one overall winner.",
        examples: [
          "Wimbledon is one of the oldest…77905 tokens truncated… 60);
}

function submitQuiz() {
  let correct = 0;
  for (let i = 0; i < quizWords.length; i++) {
    const w = quizWords[i];
    const input = document.getElementById(`quiz-q-${i}`);
    const r = document.getElementById(`quiz-r-${i}`);
    const ans = (input?.value || '').trim().toLowerCase();
    const target = w.word.toLowerCase();
    const targetStem = target.replace(/(ation|isation|ing|ed|ies|es|s)$/, '');
    const isOk = ans === target || (ans.length >= 4 && ans.startsWith(targetStem.slice(0, Math.min(5, targetStem.length))) && Math.abs(ans.length - target.length) <= 4);
    if (isOk) {
      correct++;
      r.className = 'quiz-result show ok';
      r.textContent = `✓ Correct: ${w.word}`;
    } else {
      r.className = 'quiz-result show fail';
      r.textContent = `✗ Answer: ${w.word}`;
    }
    if (input) input.disabled = true;
  }
  // Save practice result
  const progress = getVocabProgress();
  if (!progress.practiceHistory) progress.practiceHistory = [];
  progress.practiceHistory.push({
    date: Date.now(),
    total: quizWords.length,
    correct: correct,
    pct: Math.round(correct / quizWords.length * 100)
  });
  if (progress.practiceHistory.length > 50) progress.practiceHistory = progress.practiceHistory.slice(-50);
  saveVocabProgress();

  // Show summary
  const c = document.getElementById('vocabPracticeContent');
  const summary = document.createElement('div');
  summary.style.cssText = 'background: var(--bg-card); border: 2px solid var(--accent); border-radius: 8px; padding: 14px 18px; margin: 14px 0; font-size: 14px;';
  summary.innerHTML = `
    <strong>Score: ${correct} / ${quizWords.length}</strong> (${Math.round(correct/quizWords.length*100)}%)
    <div style="margin-top:6px; font-size:12px; color:var(--ink-soft);">
      ${correct === quizWords.length ? 'Perfect! 🎉' :
        correct >= quizWords.length * 0.7 ? 'Great work — keep practising the ones you missed.' :
        correct >= quizWords.length * 0.4 ? 'Good effort. Review those words and try again.' :
        'Read through the words again — you\'ll improve fast.'}
    </div>
  `;
  c.insertBefore(summary, c.firstChild);
  // Replace footer buttons
  const footer = c.querySelector('.modal-actions');
  if (footer) {
    footer.innerHTML = `
      <button class="tb-text-btn" onclick="closeVocabPractice()">Close</button>
      <button class="tb-text-btn dark" onclick="openVocabPractice()">New quiz</button>
    `;
  }
}


// ============================================================
//  ADMIN — VOCAB MANAGEMENT (add new words globally)
// ============================================================
// Admin-added words are stored in Firestore at /admin/vocab and merged
// into the in-memory VOCAB_DATA at app load.
async function loadGlobalVocabExtras() {
  if (offlineMode) return;
  try {
    const res = await fetch(API_URL + '/api/vocab/extras');
    if (!res.ok) throw new Error('Status ' + res.status);
    const d = await res.json();
    const extras = d.extras || {};
    // Merge into VOCAB_DATA
    for (const catId of Object.keys(extras)) {
      if (!VOCAB_DATA[catId]) continue;
      const existingWords = new Set(VOCAB_DATA[catId].words.map(w => w.word.toLowerCase()));
      for (const w of (extras[catId] || [])) {
        if (!existingWords.has(w.word.toLowerCase())) {
          VOCAB_DATA[catId].words.push({ ...w, _admin: true });
          existingWords.add(w.word.toLowerCase());
        }
      }
    }
    console.log('Vocab extras loaded:', Object.keys(extras).length, 'categories with admin words');
  } catch (err) {
    console.warn('Could not load admin vocab extras:', err);
  }
}

function adminSwitchTab(tab) {
  document.getElementById('adminTabUsers').style.display = (tab === 'users') ? '' : 'none';
  document.getElementById('adminTabPassages').style.display = (tab === 'passages') ? '' : 'none';
  document.getElementById('adminTabVocab').style.display = (tab === 'vocab') ? '' : 'none';

  const usersBtn = document.getElementById('adminTabUsersBtn');
  const passagesBtn = document.getElementById('adminTabPassagesBtn');
  const vocabBtn = document.getElementById('adminTabVocabBtn');

  usersBtn.style.background = (tab === 'users') ? 'var(--ink)' : '';
  usersBtn.style.color = (tab === 'users') ? '#fff' : '';
  if (passagesBtn) {
    passagesBtn.style.background = (tab === 'passages') ? 'var(--ink)' : '';
    passagesBtn.style.color = (tab === 'passages') ? '#fff' : '';
  }
  vocabBtn.style.background = (tab === 'vocab') ? 'var(--ink)' : '';
  vocabBtn.style.color = (tab === 'vocab') ? '#fff' : '';

  if (tab === 'vocab') populateAdminVocabCategorySelect();
  if (tab === 'passages') {
    if (typeof loadAdminPassages === 'function') loadAdminPassages();
  }
}

function populateAdminVocabCategorySelect() {
  const select = document.getElementById('adminVocabCat');
  const current = select.value;
  const sorted = Object.entries(VOCAB_DATA).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
  select.innerHTML = '<option value="">— Pick a category —</option>' +
    sorted.map(([id, cat]) => `<option value="${id}">${cat.icon} ${escapeHtml(cat.label)} (${cat.words.length} words)</option>`).join('');
  if (current && VOCAB_DATA[current]) select.value = current;
}

function renderAdminVocabList() {
  const catId = document.getElementById('adminVocabCat').value;
  const list = document.getElementById('adminVocabList');
  if (!catId || !VOCAB_DATA[catId]) {
    list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px; font-style:italic; font-family:var(--serif);">Pick a category above to see its words.</div>';
    return;
  }
  const cat = VOCAB_DATA[catId];
  list.innerHTML = cat.words.map((w, i) => `
    <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid var(--line);">
      <div style="flex:1;">
        <div style="font-weight:600; font-family:var(--serif); font-size:14px;">
          ${escapeHtml(w.word)}
          <span style="font-size:10px; color:var(--ink-mute); font-weight:400; font-style:italic; margin-left:6px;">${escapeHtml(w.pos || '')} · ${escapeHtml(w.level || 'C1')}</span>
          ${w._admin ? '<span style="background:#8fd18f; color:#fff; font-size:9px; padding:1px 6px; border-radius:3px; margin-left:6px;">ADMIN</span>' : ''}
        </div>
        <div style="font-size:11.5px; color:var(--ink-soft); margin-top:2px;">${escapeHtml((w.meaning || '').slice(0, 90))}${(w.meaning || '').length > 90 ? '…' : ''}</div>
      </div>
      ${w._admin ? `<button class="tb-text-btn" onclick="deleteAdminWord('${catId}', '${escapeHtml(w.word).replace(/'/g, "\\'")}')" style="font-size:11px; padding:4px 10px;">Delete</button>` : '<span style="font-size:10px; color:var(--ink-mute); font-style:italic; padding:0 6px;">seed</span>'}
    </div>
  `).join('');
}

function openAddWord() {
  const catId = document.getElementById('adminVocabCat').value;
  if (!catId) { toast('Pick a category first', true); return; }
  document.getElementById('addWordCatId').value = catId;
  document.getElementById('addWordEditId').value = '';
  document.getElementById('addWordTitle').textContent = `+ Add Word to ${VOCAB_DATA[catId].label}`;
  ['addWordWord', 'addWordPos', 'addWordMeaning', 'addWordEx1', 'addWordEx2', 'addWordEx3', 'addWordCompare'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('addWordLevel').value = 'C1';
  document.getElementById('addWordModal').classList.add('show');
  setTimeout(() => document.getElementById('addWordWord').focus(), 60);
}
function closeAddWord() { document.getElementById('addWordModal').classList.remove('show'); }

async function saveNewWord() {
  const catId = document.getElementById('addWordCatId').value;
  if (!catId || !VOCAB_DATA[catId]) { toast('Category missing', true); return; }
  const word = document.getElementById('addWordWord').value.trim();
  const meaning = document.getElementById('addWordMeaning').value.trim();
  const ex1 = document.getElementById('addWordEx1').value.trim();
  const ex2 = document.getElementById('addWordEx2').value.trim();
  const ex3 = document.getElementById('addWordEx3').value.trim();

  if (!word) { toast('Word is required', true); return; }
  if (!meaning) { toast('Meaning is required', true); return; }
  if (!ex1 || !ex2) { toast('Please provide at least 2 example sentences', true); return; }

  // Check duplicate
  const exists = VOCAB_DATA[catId].words.some(w => w.word.toLowerCase() === word.toLowerCase());
  if (exists) { toast(`"${word}" already exists in this category`, true); return; }

  const newWord = {
    word,
    pos: document.getElementById('addWordPos').value.trim() || 'noun',
    level: document.getElementById('addWordLevel').value || 'C1',
    meaning,
    examples: [ex1, ex2, ex3].filter(Boolean),
    _admin: true
  };
  const compare = document.getElementById('addWordCompare').value.trim();
  if (compare) newWord.compare = compare;

  // Push into in-memory VOCAB_DATA so the UI reflects immediately
  VOCAB_DATA[catId].words.push(newWord);

  try {
    const getRes = await fetch(API_URL + '/api/vocab/extras');
    if (!getRes.ok) throw new Error('Failed to fetch vocab extras');
    const getD = await getRes.json();
    let extras = getD.extras || {};

    if (!extras[catId]) extras[catId] = [];
    const persistable = { ...newWord };
    delete persistable._admin;
    extras[catId].push(persistable);

    const postRes = await fetch(API_URL + '/api/admin/vocab/extras', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ extras })
    });
    if (!postRes.ok) throw new Error('Failed to save vocab extras: ' + postRes.status);
    toast(`"${word}" added — visible to all students ✓`);
  } catch (err) {
    // Roll back in-memory addition
    VOCAB_DATA[catId].words = VOCAB_DATA[catId].words.filter(w => w !== newWord);
    toast('Save failed: ' + err.message, true);
    return;
  }

  closeAddWord();
  renderAdminVocabList();
  populateAdminVocabCategorySelect();  // update word counts
}

async function deleteAdminWord(catId, word) {
  if (!VOCAB_DATA[catId]) return;
  if (!confirm(`Remove "${word}" from ${VOCAB_DATA[catId].label}?\n\nThis removes it for all students.`)) return;

  const before = VOCAB_DATA[catId].words.length;
  VOCAB_DATA[catId].words = VOCAB_DATA[catId].words.filter(w => !(w.word === word && w._admin));
  if (VOCAB_DATA[catId].words.length === before) {
    toast(`Could not find admin-added word "${word}"`, true);
    return;
  }

  try {
    const getRes = await fetch(API_URL + '/api/vocab/extras');
    if (!getRes.ok) throw new Error('Failed to fetch vocab extras');
    const getD = await getRes.json();
    let extras = getD.extras || {};

    if (extras[catId]) {
      extras[catId] = extras[catId].filter(w => w.word !== word);
      if (extras[catId].length === 0) delete extras[catId];
    }

    const postRes = await fetch(API_URL + '/api/admin/vocab/extras', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ extras })
    });
    if (!postRes.ok) throw new Error('Failed to save delete');
    toast(`"${word}" deleted ✓`);
  } catch (err) {
    toast('Delete sync failed: ' + err.message, true);
  }
  renderAdminVocabList();
  populateAdminVocabCategorySelect();
}


// ============================================================
//  AI-SUGGEST VOCABULARY WORDS (admin)
//  Two-pass flow:
//    1. Fetch 20 candidate words (cheap — names + one-line meanings)
//    2. Admin ticks which to keep
//    3. Generate full details (definition + 3 examples + compare) for kept ones
//    4. Admin reviews, clicks Save All
// ============================================================
let suggestState = { catId: null, suggestions: [], details: [] };

async function openSuggestWords() {
  if (!isAdmin()) {
    toast('Admin only', true);
    return;
  }
  const catSelect = document.getElementById('adminVocabCat');
  if (!catSelect) {
    console.error('Suggest: adminVocabCat dropdown not found in DOM');
    toast('Category dropdown missing — refresh and try again', true);
    return;
  }
  const catId = catSelect.value;
  if (!catId) {
    toast('Pick a category from the dropdown first', true);
    return;
  }
  const cat = VOCAB_DATA[catId];
  if (!cat) {
    console.error('Suggest: category not in VOCAB_DATA:', catId);
    toast('Category not found', true);
    return;
  }
  const modal = document.getElementById('suggestWordsModal');
  if (!modal) {
    console.error('Suggest: suggestWordsModal element not found');
    toast('Suggest modal missing — refresh page', true);
    return;
  }
  suggestState = { catId, suggestions: [], details: [] };
  document.getElementById('suggestCatId').value = catId;
  document.getElementById('suggestTitle').textContent = `🤖 Suggest words for "${cat.label}"`;
  // Stage 1: loading
  suggestShowStage(1);
  document.getElementById('suggestStage1Msg').textContent = `Asking AI for 20 fresh ${cat.label} words…`;
  modal.classList.add('show');

  // Build the prompt
  const existing = cat.words.map(w => w.word).join(', ');
  const prompt = `You are a vocabulary expert for IELTS / PTE preparation at the C1-C2 (advanced) level.

CATEGORY: ${cat.label}

Already-included words to AVOID duplicating:
${existing}

Suggest 20 NEW C1 or C2 level words or short phrases that are commonly used when discussing "${cat.label}" topics, especially in formal essays. Bias toward useful, high-frequency academic vocabulary that students would benefit from. Avoid obscure words.

For each, give one short line (≤90 chars) describing what it means.

Return ONLY a JSON array — no preamble, no markdown fences. Format:
[
  {"word": "litigation", "pos": "noun", "level": "C1", "preview": "The process of taking legal action through courts."},
  {"word": "incarceration", "pos": "noun", "level": "C2", "preview": "..."}
]`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('Suggest: /api/claude error body:', errText);
      throw new Error(`Server returned ${res.status} — see console for details`);
    }
    const data = await res.json();
    const text = (data.content || []).map(c => c.text || '').join('').trim();
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let words = cleanAndParseJSON(text);
    if (!Array.isArray(words) || words.length === 0) throw new Error('AI returned no suggestions');

    // Mark which words already exist in this category
    const existingLc = new Set(cat.words.map(w => w.word.toLowerCase()));
    suggestState.suggestions = words.map(w => ({
      word: String(w.word || '').trim(),
      pos: String(w.pos || 'noun').trim(),
      level: String(w.level || 'C1').trim(),
      preview: String(w.preview || '').trim(),
      duplicate: existingLc.has(String(w.word || '').toLowerCase().trim()),
      checked: !existingLc.has(String(w.word || '').toLowerCase().trim())  // default: tick all non-duplicates
    })).filter(w => w.word);

    renderSuggestionList();
    suggestShowStage(2);
    document.getElementById('suggestNextBtn').style.display = '';
    document.getElementById('suggestNextBtn').textContent = 'Generate details →';
  } catch (err) {
    console.error(err);
    document.getElementById('suggestStage1Msg').innerHTML = `<span style="color:var(--accent-deep);">Could not get suggestions: ${escapeHtml(err.message)}</span>`;
  }
}

function suggestShowStage(stage) {
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`suggestStage${i}`).style.display = (i === stage) ? '' : 'none';
  }
}

function renderSuggestionList() {
  const list = document.getElementById('suggestList');
  list.innerHTML = suggestState.suggestions.map((w, i) => `
    <label style="display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:4px; cursor:${w.duplicate ? 'not-allowed' : 'pointer'}; ${w.duplicate ? 'opacity:0.4;' : ''}" onmouseover="this.style.background='var(--bg-card)';" onmouseout="this.style.background='';">
      <input type="checkbox" ${w.checked ? 'checked' : ''} ${w.duplicate ? 'disabled' : ''} onchange="toggleSuggestion(${i}, this.checked)">
      <div style="flex:1; line-height:1.4;">
        <strong style="font-family:var(--serif); font-size:14px;">${escapeHtml(w.word)}</strong>
        <span style="color:var(--ink-mute); font-size:11px; margin-left:6px;">${escapeHtml(w.pos)} · ${escapeHtml(w.level)}</span>
        ${w.duplicate ? '<span style="background:#bbb; color:#fff; font-size:9px; padding:1px 5px; border-radius:3px; margin-left:6px;">EXISTS</span>' : ''}
        <div style="font-size:11.5px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(w.preview)}</div>
      </div>
    </label>
  `).join('');
  updateSuggestCount();
}

function toggleSuggestion(idx, checked) {
  if (suggestState.suggestions[idx]) {
    suggestState.suggestions[idx].checked = checked;
    updateSuggestCount();
  }
}

function toggleAllSuggestions(on) {
  for (const w of suggestState.suggestions) {
    if (!w.duplicate) w.checked = on;
  }
  renderSuggestionList();
}

function updateSuggestCount() {
  const n = suggestState.suggestions.filter(w => w.checked && !w.duplicate).length;
  document.getElementById('suggestPickedCount').textContent = `${n} selected`;
  document.getElementById('suggestNextBtn').disabled = (n === 0);
}

async function suggestNextStep() {
  // Called from stage 2 (Generate details) or stage 4 (Save all)
  const stage4Visible = document.getElementById('suggestStage4').style.display !== 'none';
  if (stage4Visible) {
    await saveAllSuggestions();
  } else {
    await generateAllDetails();
  }
}

async function generateAllDetails() {
  const picked = suggestState.suggestions.filter(w => w.checked && !w.duplicate);
  if (picked.length === 0) { toast('Pick at least one word', true); return; }

  suggestShowStage(3);
  document.getElementById('suggestNextBtn').style.display = 'none';
  document.getElementById('suggestStage3Msg').textContent = `Generating full cards for ${picked.length} word${picked.length === 1 ? '' : 's'}…`;

  const cat = VOCAB_DATA[suggestState.catId];
  const wordsJson = JSON.stringify(picked.map(w => ({ word: w.word, pos: w.pos, level: w.level })));

  const prompt = `You are a vocabulary expert for IELTS / PTE preparation at the C1-C2 level.

For the following words in the "${cat.label}" category, generate a full card for each.

Words: ${wordsJson}

For each word produce:
- "word": the word itself (exact)
- "pos": part of speech (use the one provided, or refine if needed)
- "level": "C1" or "C2"
- "meaning": one clear plain-English definition (one sentence, ≤180 chars)
- "examples": exactly 3 natural example sentences showing the word in real use. Each ≤120 chars. Should sound like sentences a student would meet in essays or articles.
- "compare": (OPTIONAL — include only if useful) a one-line note comparing this word with a similar word students might confuse it with. Format: "vs. X: ..." (≤140 chars). Omit entirely if no useful comparison.

Return ONLY a JSON array — no preamble, no markdown fences. Format:
[
  {"word":"litigation","pos":"noun","level":"C1","meaning":"...","examples":["...","...","..."],"compare":"vs. lawsuit: ..."},
  ...
]`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).map(c => c.text || '').join('').trim();
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let details = cleanAndParseJSON(text);
    if (!Array.isArray(details)) throw new Error('AI response was not a list');

    // Normalise / validate each entry
    suggestState.details = details
      .filter(d => d && d.word && d.meaning && Array.isArray(d.examples) && d.examples.length > 0)
      .map(d => ({
        word: String(d.word).trim(),
        pos: String(d.pos || 'noun').trim(),
        level: (String(d.level || 'C1').trim().toUpperCase() === 'C2') ? 'C2' : 'C1',
        meaning: String(d.meaning).trim(),
        examples: d.examples.map(e => String(e).trim()).filter(Boolean).slice(0, 3),
        compare: d.compare ? String(d.compare).trim() : '',
        keep: true  // default: keep all generated
      }))
      .filter(d => d.examples.length >= 2);

    if (suggestState.details.length === 0) throw new Error('AI returned no valid word details');

    renderDetailsPreview();
    suggestShowStage(4);
    document.getElementById('suggestNextBtn').style.display = '';
    document.getElementById('suggestNextBtn').textContent = `Save ${suggestState.details.length} words →`;
  } catch (err) {
    console.error(err);
    document.getElementById('suggestStage3Msg').innerHTML = `<span style="color:var(--accent-deep);">${escapeHtml(err.message)}</span>`;
    setTimeout(() => {
      suggestShowStage(2);
      document.getElementById('suggestNextBtn').style.display = '';
    }, 2500);
  }
}

function renderDetailsPreview() {
  const c = document.getElementById('suggestPreview');
  c.innerHTML = suggestState.details.map((d, i) => `
    <div style="background:var(--bg-card); border:1px solid var(--line); border-radius:8px; padding:12px 14px; margin-bottom:10px;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
        <input type="checkbox" ${d.keep ? 'checked' : ''} onchange="suggestState.details[${i}].keep = this.checked; updateSaveBtnCount();">
        <strong style="font-family:var(--serif); font-size:15px;">${escapeHtml(d.word)}</strong>
        <span style="color:var(--ink-mute); font-size:11px; font-style:italic;">${escapeHtml(d.pos)}</span>
        <span style="background:var(--accent); color:#fff; font-size:9px; padding:2px 6px; border-radius:3px; font-weight:700; letter-spacing:0.07em;">${escapeHtml(d.level)}</span>
      </div>
      <div style="font-size:12.5px; line-height:1.55; color:var(--ink); margin:6px 0;">${escapeHtml(d.meaning)}</div>
      ${d.compare ? `<div style="background:#fff8e6; border-left:3px solid #b07a2a; padding:6px 10px; border-radius:0 4px 4px 0; font-size:11.5px; color:#5a4400; margin:6px 0;">${escapeHtml(d.compare)}</div>` : ''}
      <ul style="margin:6px 0 0; padding:0 0 0 18px; list-style:none;">
        ${d.examples.map(ex => `<li style="font-size:11.5px; color:var(--ink-soft); font-style:italic; line-height:1.5; padding:2px 0;">› ${escapeHtml(ex)}</li>`).join('')}
      </ul>
    </div>
  `).join('');
  updateSaveBtnCount();
}

function updateSaveBtnCount() {
  const n = suggestState.details.filter(d => d.keep).length;
  document.getElementById('suggestNextBtn').textContent = `Save ${n} word${n === 1 ? '' : 's'} →`;
  document.getElementById('suggestNextBtn').disabled = (n === 0);
}

async function saveAllSuggestions() {
  const toSave = suggestState.details.filter(d => d.keep);
  if (toSave.length === 0) { toast('Nothing to save', true); return; }
  const catId = suggestState.catId;
  if (!VOCAB_DATA[catId]) { toast('Category missing', true); return; }

  // Add to in-memory VOCAB_DATA
  const existing = new Set(VOCAB_DATA[catId].words.map(w => w.word.toLowerCase()));
  const newlyAdded = [];
  for (const d of toSave) {
    if (existing.has(d.word.toLowerCase())) continue;
    const w = {
      word: d.word,
      pos: d.pos,
      level: d.level,
      meaning: d.meaning,
      examples: d.examples,
      _admin: true
    };
    if (d.compare) w.compare = d.compare;
    VOCAB_DATA[catId].words.push(w);
    newlyAdded.push(w);
    existing.add(d.word.toLowerCase());
  }

  if (newlyAdded.length === 0) {
    toast('All those words already exist', true);
    return;
  }

  try {
    const getRes = await fetch(API_URL + '/api/vocab/extras');
    if (!getRes.ok) throw new Error('Failed to fetch vocab extras');
    const getD = await getRes.json();
    let extras = getD.extras || {};

    if (!extras[catId]) extras[catId] = [];
    for (const w of newlyAdded) {
      const persistable = { ...w };
      delete persistable._admin;
      extras[catId].push(persistable);
    }

    const postRes = await fetch(API_URL + '/api/admin/vocab/extras', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ extras })
    });
    if (!postRes.ok) throw new Error('Failed to save suggestions');
    toast(`Added ${newlyAdded.length} word${newlyAdded.length === 1 ? '' : 's'} to ${VOCAB_DATA[catId].label} ✓`);
  } catch (err) {
    // Rollback
    for (const w of newlyAdded) {
      VOCAB_DATA[catId].words = VOCAB_DATA[catId].words.filter(x => x !== w);
    }
    toast('Save failed: ' + err.message, true);
    return;
  }

  closeSuggestWords();
  renderAdminVocabList();
  populateAdminVocabCategorySelect();
}

function closeSuggestWords() {
  document.getElementById('suggestWordsModal').classList.remove('show');
  suggestState = { catId: null, suggestions: [], details: [] };
}


function syncSeedTopics() {
  let changed = false;
  SEED_TOPICS.forEach((t, i) => {
    const seedId = 'seed_' + i;
    const item = essays.find(e => e.id === seedId);
    if (!item) {
      essays.push({
        id: seedId,
        title: t.title,
        question: t.question,
        explanation: t.explanation,
        badge: t.badge || '',
        pros: '', cons: '', approach: '',
        intro: '', bp1: '', bp2: '', concl: '',
        vocab: 3,
        seedIdeas: '',
        questionType: t.type || '',
        secondaryFeatures: t.secondaryFeatures || []
      });
      changed = true;
    } else {
      if (item.title !== t.title) { item.title = t.title; changed = true; }
      if (item.question !== t.question) { item.question = t.question; changed = true; }
      if (item.explanation !== t.explanation) { item.explanation = t.explanation; changed = true; }
      if ((item.badge || '') !== (t.badge || '')) { item.badge = t.badge || ''; changed = true; }
      if (item.questionType !== t.type && t.type) { item.questionType = t.type; changed = true; }
      if (t.secondaryFeatures && JSON.stringify(item.secondaryFeatures || []) !== JSON.stringify(t.secondaryFeatures)) { item.secondaryFeatures = t.secondaryFeatures.slice(); changed = true; }
    }
  });
  return changed;
}

// ============================================================
function initOfflineMode() {
  // Pure browser-local mode (Firebase not configured OR user chose offline)
  offlineMode = true;
  const raw = safeLSGet('ipt_essays_v2');
  if (raw) {
    try { essays = JSON.parse(raw) || []; } catch (e) { essays = []; }
    currentId = safeLSGet('ipt_current_v2') || essays[0]?.id || null;
    const changed = syncSeedTopics();
    if (changed) {
      safeLSSet('ipt_essays_v2', JSON.stringify(essays));
    }
  } else {
    essays = SEED_TOPICS.map((t, i) => ({
      id: 'seed_' + i,
      title: t.title,
      question: t.question,
      explanation: t.explanation,
      badge: t.badge || '',
      pros: '', cons: '', approach: '',
      intro: '', bp1: '', bp2: '', concl: '',
      vocab: 3,
      seedIdeas: '',
      questionType: t.type || '',
      secondaryFeatures: t.secondaryFeatures || []
    }));
    currentId = essays[0].id;
    safeLSSet('ipt_essays_v2', JSON.stringify(essays));
    safeLSSet('ipt_current_v2', currentId);
  }
  // Override saveAll to write to localStorage in offline mode
  window.saveAll = function() {
    safeLSSet('ipt_essays_v2', JSON.stringify(essays));
    if (currentId) safeLSSet('ipt_current_v2', currentId);
  };
  // Hide cloud-only UI
  document.getElementById('userBadge').style.display = 'none';
  document.getElementById('syncIndicator').style.display = 'none';
  document.getElementById('quotaChip').style.display = 'none';
  removeAdminPortalEntry();
  // Boot the app
  renderList();
  loadCurrent();
  renderPreview();
  setZoom(0.7);
  switchSection('dashboard');
}

async function bootForUser(user) {
  currentUser = user;
  // Update badges
  document.getElementById('userBadge').style.display = '';
  document.getElementById('userName').textContent = user.email.split('@')[0];
  document.getElementById('userAvatar').textContent = (user.email[0] || '?').toUpperCase();
  removeAdminPortalEntry();
  // Load their data
  const ok = await loadUserData(user.uid);
  if (!ok) return;
  // Load admin-added vocab (merged into VOCAB_DATA — fire-and-forget)
  loadGlobalVocabExtras().catch(err => console.warn('vocab extras load failed:', err));
  hideLogin();
  updateQuotaChip();
  if (!currentId || !getCurrent()) currentId = essays[0]?.id || null;
  renderList();
  loadCurrent();
  renderPreview();
  setZoom(0.7);
  switchSection('dashboard');
}

function bootForLoggedOut() {
  currentUser = null;
  userProfile = null;
  essays = [];
  currentId = null;
  showLogin();
  // Reset the login form state
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  const btn = document.getElementById('loginSubmit');
  btn.disabled = false;
  btn.textContent = isSignupMode ? 'Create account' : 'Sign in';
  hideLoginError();
}

async function initApp() {
  initialisePortalWorkspace();
  console.log('[IPT] Integrated app initializing...');
  window.FB = window.FB || { adminEmail: 'admin@ptewriting.com' };

  // Fetch server config (admin email override from Railway env var, if set)
  try {
    const res = await fetch(API_URL + '/api/config');
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.adminEmail) {
        window.FB.adminEmail = cfg.adminEmail;
        console.log('Admin email source: Railway env var');
      }
    }
  } catch (e) {
    console.log('Could not fetch /api/config — using hardcoded admin email');
  }

  // Check for admin impersonation token
  const urlParams = new URLSearchParams(window.location.search);
  let impToken = urlParams.get('impersonate') || sessionStorage.getItem('pte_impersonate_token');
  if (impToken) {
    showLoading(true);
    try {
      const r = await fetch(API_URL + '/api/impersonate/redeem?token=' + encodeURIComponent(impToken));
      if (r.ok) {
        const d = await r.json();
        if (d.success && d.username) {
          sessionStorage.setItem('pte_impersonate_token', impToken);
          sessionToken = impToken;
          
          const banner = document.getElementById('impersonateBanner');
          if (banner) banner.style.display = 'flex';
          const nameEl = document.getElementById('impersonateName');
          if (nameEl) nameEl.textContent = d.username;
          
          await enterApp(d.username);
          showLoading(false);
          return;
        }
      }
    } catch (e) {
      console.error('Impersonation token verification failed:', e);
    }
    // Clear stale or invalid impersonation session
    sessionStorage.removeItem('pte_impersonate_token');
    const url = new URL(window.location);
    url.searchParams.delete('impersonate');
    window.history.replaceState({}, document.title, url.pathname + url.search);
    showLoading(false);
  }

  const last = LocalStore.getUserId();
  if (!last) {
    showLogin();
    return;
  }

  sessionToken = localStorage.getItem('pte_session_token') || '';
  if (!sessionToken) {
    showLogin();
    return;
  }

  showLoading(true);
  let verdict = 'enter'; // enter | login
  try {
    const r = await fetch(API_URL + '/api/auth/check/' + encodeURIComponent(last), {
      headers: { 'x-session-token': sessionToken },
      cache: 'no-store'
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.exists === false) {
        verdict = 'login';
      } else if (d && d.blocked === true) {
        verdict = 'login';
        setTimeout(() => toast('This account has been blocked. Contact your administrator.', true), 50);
      }
    } else if (r.status === 401 || r.status === 403) {
      verdict = 'login';
    }
  } catch (e) {
    // Network error — trust the saved session, enter offline
    verdict = 'enter';
  }

  if (verdict === 'login') {
    showLoading(false);
    LocalStore.setUserId('');
    showLogin();
  } else {
    await enterApp(last);
    showLoading(false);
  }
}

let portalWorkspace = null;
let portalDraftStore = null;
let portalDraftTimer = null;
let portalDraftRevision = 0;

function initialisePortalWorkspace() {
  if (portalWorkspace) return;
  portalWorkspace = PortalWorkspace.createController({ document, window, onNavigate: switchSection });
  // Access to storage can be denied by browser privacy settings.
  try { portalDraftStore = PortalWorkspace.createDraftStore(window.localStorage); } catch (_) { /* In-memory editing still works. */ }
  window.addEventListener('pagehide', savePortalEssayDraft);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePortalEssayDraft();
  });
}

function switchSection(section, options = {}) {
  savePortalEssayDraft();
  if (section === 'practice') { openPractice(false, options); return; }
  if (section === 'vocab') { openVocab(options); return; }
  const active = portalWorkspace.activate(section, options);
  if (active === 'dashboard') {
    updateDashboard();
    updatePortalResume();
  }
  // SWT's current passage, results tab and editor node stay intact.
}

function togglePortalSecondary(section, button) {
  const pane = document.getElementById(section === 'vocab' ? 'vocabScreen' : 'practiceScreen');
  const open = pane.classList.toggle('portal-secondary-open');
  button.setAttribute('aria-expanded', String(open));
}

function closePortalSecondary(section) {
  const pane = document.getElementById(section === 'vocab' ? 'vocabScreen' : 'practiceScreen');
  pane.classList.remove('portal-secondary-open');
  pane.querySelector('.portal-secondary-toggle')?.setAttribute('aria-expanded', 'false');
}

function setPortalLibraryView(view) {
  if (!['topics', 'edit', 'preview'].includes(view)) view = 'edit';
  const pane = document.getElementById('libraryPane');
  pane.dataset.libraryView = view;
  pane.querySelectorAll('[data-library-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.libraryView === view));
  });
}

function savePortalEssayDraft() {
  clearTimeout(portalDraftTimer);
  if (!currentUserId || practiceState.view !== 'write') return;
  const signature = JSON.stringify(['essayText', 'questionText', 'questionTitle', 'selectedQuestionId', 'questionSource', 'writeStep', 'timerEnabled', 'timerStartedAt'].map(k => practiceState[k]));
  if (savePortalEssayDraft.owner === currentUserId && savePortalEssayDraft.signature === signature) return;
  const saved = !!portalDraftStore?.write(currentUserId, practiceState);
  if (saved) {
    savePortalEssayDraft.owner = currentUserId;
    savePortalEssayDraft.signature = signature;
    portalDraftRevision = portalDraftStore?.read?.(currentUserId)?.updatedAt || 0;
  }
  const status = document.getElementById('practiceDraftStatus');
  if (status) {
    status.textContent = saved ? 'Draft saved on this device' : 'Draft is open here. Device saving is unavailable.';
    status.dataset.state = saved ? 'saved' : 'error';
  }
  if (typeof queueSync === 'function') queueSync();
}

function queuePortalEssayDraft() {
  clearTimeout(portalDraftTimer);
  const status = document.getElementById('practiceDraftStatus');
  if (status) { status.textContent = 'Saving your draft…'; status.dataset.state = 'saving'; }
  portalDraftTimer = setTimeout(savePortalEssayDraft, 350);
}

function restorePortalEssayDraft(resetSession = false) {
  stopPracticeTimer();
  practiceState = emptyPracticeState();
  const draft = portalDraftStore?.read(currentUserId);
  portalDraftRevision = draft?.updatedAt || 0;
  if (draft && (draft.essayText.trim() || draft.questionText.trim())) {
    // Copy only fields produced by our draft schema, never arbitrary storage keys.
    for (const key of ['essayText', 'questionText', 'questionTitle', 'selectedQuestionId', 'questionSource', 'writeStep', 'timerEnabled', 'timerStartedAt']) {
      practiceState[key] = draft[key];
    }
    practiceState.view = 'write';
  }
  savePortalEssayDraft.owner = currentUserId;
  savePortalEssayDraft.signature = JSON.stringify(['essayText', 'questionText', 'questionTitle', 'selectedQuestionId', 'questionSource', 'writeStep', 'timerEnabled', 'timerStartedAt'].map(k => practiceState[k]));
  practiceRevision = null;
  document.getElementById('practiceContent').replaceChildren();
  if (resetSession) {
    currentVocabCategory = null;
    document.getElementById('vocabMainContent').replaceChildren();
    document.getElementById('vocabSearch').value = '';
  }
  updatePortalResume();
}

function updatePortalResume() {
  const banner = document.getElementById('portalResume');
  if (!banner) return;
  const draft = portalDraftStore?.read(currentUserId);
  const writing = practiceState.view === 'write' && !!(practiceState.essayText.trim() || practiceState.questionText.trim());
  const reviewing = practiceState.view === 'loading';
  const resume = document.getElementById('portalPracticeResume');
  if (resume) resume.hidden = writing || reviewing || !draft?.essayText.trim();
  banner.hidden = !writing && !reviewing && !draft?.essayText.trim();
  document.getElementById('portalResumeTitle').textContent = reviewing ? 'Your essay review is in progress' : 'Continue your essay';
  document.getElementById('portalResumeDetail').textContent = reviewing ? 'You can move around while your feedback is prepared.' :
    ((writing ? practiceState.questionTitle : draft?.questionTitle) || 'Your unfinished response') + ' · ' + countWords(writing ? practiceState.essayText : draft?.essayText || '') + ' words';
  document.getElementById('portalEssayAction').textContent = writing ? 'Continue writing →' : reviewing ? 'View progress →' : 'Practise essays →';
}

function resumePortalEssay() {
  if (practiceState.view !== 'write' && practiceState.view !== 'loading' && portalDraftStore?.read(currentUserId)) {
    restorePortalEssayDraft();
  }
  openPractice();
  document.getElementById('practiceEssayInput')?.focus();
}

// Dashboard statistics renderer
function updateDashboard() {
  if (!document.getElementById('dashboardPane')) return;

  const total = essays.length;
  const written = essays.filter(e => essayStatus(e) === 'written').length;
  const draft = essays.filter(e => essayStatus(e) === 'draft').length;
  const empty = essays.filter(e => essayStatus(e) === 'empty').length;

  // Calculate percentage
  const percent = total > 0 ? Math.round((written / total) * 100) : 0;
  
  // Set counts
  document.getElementById('dashWrittenCount').textContent = written;
  document.getElementById('dashDraftCount').textContent = draft;
  document.getElementById('dashEmptyCount').textContent = empty;
  document.getElementById('dashPercent').textContent = percent;

  // Update SVG circular ring
  const circle = document.getElementById('dashProgressFill');
  if (circle) {
    const radius = circle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius; // 213.628
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  }

  // Vocab read count
  const vocabProgress = getVocabProgress();
  const readCount = Object.keys(vocabProgress.read || {}).length;
  document.getElementById('dashVocabRead').textContent = readCount;

  // Average Practice Score
  const history = getPracticeHistory();
  const avgScoreEl = document.getElementById('dashAvgScore');
  const scoreDescEl = document.getElementById('dashScoreDesc');
  
  if (history.length > 0) {
    const sum = history.reduce((acc, h) => acc + (h.scores?.total || 0), 0);
    const avg = (sum / history.length).toFixed(1);
    avgScoreEl.textContent = avg;
    
    // Suggest feedback based on score
    if (avg >= 24) {
      scoreDescEl.innerHTML = '✨ <strong>Excellent profile!</strong> Consistent Band 9 potential. Focus on timing.';
    } else if (avg >= 20) {
      scoreDescEl.innerHTML = '👍 <strong>Strong performance.</strong> Refine structural cohesion.';
    } else {
      scoreDescEl.innerHTML = '💪 <strong>Keep writing!</strong> Target vocabulary variety and syntax variations.';
    }
  } else {
    avgScoreEl.textContent = '—';
    scoreDescEl.textContent = 'Submit a practice attempt to calculate your scoring profile.';
  }

  // SWT stats
  const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
  let totalSwtAttempts = 0;
  let swtScoresSum = 0;
  let swtScoresCount = 0;
  
  Object.keys(swtHistory).forEach(pid => {
    const list = swtHistory[pid];
    if (Array.isArray(list)) {
      totalSwtAttempts += list.length;
      list.forEach(att => {
        if (typeof att.overall_score === 'number') {
          swtScoresSum += att.overall_score;
          swtScoresCount++;
        }
      });
    }
  });

  const swtAvg = swtScoresCount > 0 ? Math.round(swtScoresSum / swtScoresCount) : 0;
  const swtPassagesCount = Object.keys(swtHistory).length;
  
  const avgSwtScoreEl = document.getElementById('dashSwtAvgScore');
  if (avgSwtScoreEl) avgSwtScoreEl.textContent = swtScoresCount > 0 ? swtAvg : '—';
  
  const swtAttemptsEl = document.getElementById('dashSwtAttempts');
  if (swtAttemptsEl) swtAttemptsEl.textContent = totalSwtAttempts;

  const swtPassagesEl = document.getElementById('dashSwtPassages');
  if (swtPassagesEl) swtPassagesEl.textContent = swtPassagesCount;

  // Quota Status
  updateDashboardQuota();

  // Render lists
  renderDashboardRecentPractice();
  renderDashboardRecentSwt();
  renderDashboardRecentEssays();

  // Glassmorphism dashboard interactive widgets
  try {
    updateDashboardStreak();
    renderDashboardCharts(currentDashboardChartMetric || 'swt');
    updateDailyVocabChallenge();
    renderDashboardActionItems();
  } catch (err) {
    console.error('Error rendering interactive widgets:', err);
  }
}

function updateDashboardQuota() {
  const essayEl = document.getElementById('dashQuotaEssay');
  const ideaEl = document.getElementById('dashQuotaIdea');
  if (!essayEl || !ideaEl) return;

  const used = userProfile?.quotaUsed || { essay: {}, idea: {} };
  const today = todayStamp();
  const usedEssay = used.essay[today] || 0;
  const usedIdea = used.idea[today] || 0;

  essayEl.textContent = `${DAILY_ESSAY_QUOTA - usedEssay} / ${DAILY_ESSAY_QUOTA}`;
  ideaEl.textContent = `${DAILY_IDEA_QUOTA - usedIdea} / ${DAILY_IDEA_QUOTA}`;
}

function renderDashboardRecentPractice() {
  const container = document.getElementById('dashRecentPractice');
  if (!container) return;
  
  const history = [...getPracticeHistory()].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 3);
  if (history.length === 0) {
    container.innerHTML = '<div class="list-empty-state">No recent scored essays. Go to the Essay Practice tab to begin.</div>';
    return;
  }

  container.innerHTML = history.map(h => {
    const dVal = h.date ? new Date(h.date) : null;
    const date = dVal ? dVal.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
    const totalScore = h.scores?.total || 0;
    const scoreColor = totalScore >= 22 ? 'var(--accent)' : totalScore >= 18 ? '#b45309' : 'var(--ink-soft)';
    
    return `
      <button type="button" class="dash-list-item" data-attempt-id="${escapeHtml(h.id || '')}" onclick="openPractice(); viewPracticeAttempt(this.dataset.attemptId)">
        <div class="item-main">
          <div class="item-title">${escapeHtml(h.questionTitle || 'Untitled Practice')}</div>
          <div class="item-date">Completed on ${date}</div>
        </div>
        <div class="item-badge" style="background: ${scoreColor}20; color: ${scoreColor}">
          ${totalScore}/26
        </div>
      </button>
    `;
  }).join('');
}

function renderDashboardRecentEssays() {
  const container = document.getElementById('dashRecentEssays');
  if (!container) return;

  // Get active essays (draft or empty) first, then written
  const activeEssays = [...essays]
    .sort((a, b) => {
      const statusA = essayStatus(a);
      const statusB = essayStatus(b);
      const scoreA = statusA === 'written' ? 1 : 0;
      const scoreB = statusB === 'written' ? 1 : 0;
      return scoreA - scoreB;
    })
    .slice(0, 3);

  if (activeEssays.length === 0) {
    container.innerHTML = '<div class="list-empty-state">No active essays in progress.</div>';
    return;
  }

  container.innerHTML = activeEssays.map(e => {
    const estatus = essayStatus(e);
    let badgeClass = 'status-empty';
    if (estatus === 'written') badgeClass = 'status-written';
    else if (estatus === 'draft') badgeClass = 'status-draft';
    
    return `
      <button type="button" class="dash-list-item" data-essay-id="${escapeHtml(e.id)}" onclick="switchSection('library'); selectEssay(this.dataset.essayId)">
        <div class="item-main">
          <div class="item-title">${escapeHtml(e.title || 'Untitled Essay')}</div>
          <div class="item-date">${escapeHtml(e.question || '').slice(0, 75)}${e.question && e.question.length > 75 ? '...' : ''}</div>
        </div>
        <div class="item-status ${badgeClass}">
          ${estatus.toUpperCase()}
        </div>
      </button>
    `;
  }).join('');
}

function renderDashboardRecentSwt() {
  const container = document.getElementById('dashRecentSwt');
  if (!container) return;

  const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
  const allAttempts = [];

  Object.keys(swtHistory).forEach(pid => {
    const list = swtHistory[pid];
    if (Array.isArray(list)) {
      list.forEach(att => {
        allAttempts.push({
          ...att,
          passageId: pid
        });
      });
    }
  });

  // Sort by timestamp descending
  allAttempts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const recent = allAttempts.slice(0, 3);
  if (recent.length === 0) {
    container.innerHTML = '<div class="list-empty-state">No recent SWT attempts. Go to the SWT tab to begin.</div>';
    return;
  }

  container.innerHTML = recent.map(h => {
    const passage = passages.find(p => String(p.id) === String(h.passageId));
    const title = passage ? passage.title : `Passage ${h.passageId}`;
    const date = h.timestamp ? new Date(h.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
    const scoreColor = h.overall_score >= 79 ? 'var(--accent)' : h.overall_score >= 58 ? '#b45309' : 'var(--ink-soft)';
    
    return `
      <button type="button" class="dash-list-item" data-passage-id="${escapeHtml(h.passageId)}" onclick="jumpToResultsPassage(Number(this.dataset.passageId))">
        <div class="item-main">
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="item-date">Completed on ${date}</div>
        </div>
        <div class="item-badge" style="background: ${scoreColor}20; color: ${scoreColor}">
          ${h.overall_score}/90
        </div>
      </button>
    `;
  }).join('');
}

// Theme Toggle
function toggleTheme() {
  const isDark = document.body.classList.contains('dark');
  if (isDark) {
    document.body.classList.remove('dark');
    document.body.classList.add('light-mode');
    localStorage.setItem('ipt-theme', 'light');
  } else {
    document.body.classList.add('dark');
    document.body.classList.remove('light-mode');
    localStorage.setItem('ipt-theme', 'dark');
  }
  updateThemeToggleButton();
}
function updateThemeToggleButton() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const isDark = document.body.classList.contains('dark');
  btn.innerHTML = isDark ? '☀️ Light' : '🌙 Dark';
}
// Initialize theme
(function initTheme() {
  const savedTheme = localStorage.getItem('ipt-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    document.body.classList.remove('dark');
  } else if (savedTheme === 'dark') {
    document.body.classList.add('dark');
    document.body.classList.remove('light-mode');
  } else {
    if (prefersDark) {
      document.body.classList.add('dark');
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark');
    }
  }
  updateThemeToggleButton();
})();

// Boot immediately
initApp();

// Boot a minimal state IMMEDIATELY so the login screen can render only if no saved session
const urlParams = new URLSearchParams(window.location.search);
const hasImpersonate = urlParams.get('impersonate') || sessionStorage.getItem('pte_impersonate_token');
if (!hasImpersonate && (!LocalStore.getUserId() || !localStorage.getItem('pte_session_token'))) {
  showLogin();
}


// ============================================================
//  PRACTICE ESSAY MODULE
//  - Students write essays, get PTE-style scoring (out of 26)
//  - Plain-English feedback (no jargon)
//  - History saved to Firestore (or localStorage in offline mode)
//  - Uses essay quota (1 credit per scored attempt)
// ============================================================

// State
function emptyPracticeState() { return {
  view: 'welcome',          // 'welcome' | 'write' | 'loading' | 'results'
  writeStep: 1,             // 1 = setup (select question), 2 = focus mode (writing simulator)
  promptExpanded: true,     // controls collapse/expand state of the prompt in simulator
  questionSource: 'library', // 'library' | 'custom'
  selectedQuestionId: null,
  questionTitle: '',
  questionText: '',
  essayText: '',
  currentAttempt: null,      // the in-memory attempt object (post-scoring)
  viewingAttemptId: null,    // ID of the history attempt being viewed
  expandedQuestions: {},     // accordion expand state mapping questionKey -> boolean
  // Timer (exam-mode simulation)
  timerEnabled: false,       // user-toggled
  timerStartedAt: null,      // ms timestamp when writing started
  timerIntervalId: null      // setInterval handle for the live counter
}; }
let practiceState = emptyPracticeState();

// 20-minute IELTS Task 2 / PTE Write Essay target
const PRACTICE_TIMER_LIMIT_MIN = 20;

// PTE rubric — max points for each category (matches user's screenshot)
const PRACTICE_RUBRIC = [
  { key: 'content',         label: 'Content',    max: 6 },
  { key: 'form',            label: 'Form',       max: 2 },
  { key: 'spelling',        label: 'Spelling',   max: 2 },
  { key: 'grammar',         label: 'Grammar',    max: 2 },
  { key: 'vocabulary',      label: 'Vocabulary', max: 2 },
  { key: 'linguistic',      label: 'Sentence variety', max: 6 },
  { key: 'coherence',       label: 'Organisation', max: 6 }
  // Total = 26
];
const PRACTICE_MAX_TOTAL = 26;

function openPractice(defaultToWelcome = false, options = {}) {
  savePortalEssayDraft();
  refreshPracticeHistory();
  portalWorkspace.activate('practice', options);
  renderPracticeHistory();
  if (defaultToWelcome && !practiceState.essayText && !practiceSubmissionPending) {
    practiceState.view = 'welcome';
  }
  if (defaultToWelcome || !document.getElementById('practiceContent').children.length) renderPracticeMain();
  updatePracticeStats();
}

function practiceCurrentEssay() {
  const e = getCurrent();
  if (!e) return;
  if (!e.question || !e.question.trim()) {
    toast('Please enter a question prompt for this essay before practicing.', true);
    return;
  }
  if (practiceSubmissionPending) { toast('Your current essay review is still running.'); return; }
  savePortalEssayDraft();
  if (portalDraftStore?.read(currentUserId)?.essayText.trim() && !confirm('Practise this question? This replaces your unsubmitted essay draft. Cancel to keep it.')) return;
  
  practiceState.view = 'write';
  practiceState.writeStep = 2;
  practiceState.promptExpanded = true;
  practiceState.questionSource = 'library';
  practiceState.selectedQuestionId = e.id;
  practiceState.questionTitle = e.title || '';
  practiceState.questionText = e.question || '';
  practiceState.essayText = ''; // start fresh
  practiceState.viewingAttemptId = null;
  practiceState.currentAttempt = null;
  
  resetPracticeTimer();
  renderPracticeMain();
  openPractice(false);
}

function closePractice() {
  switchSection('dashboard');
}

function getCleanSampleResponse(html, kind) {
  if (!html) return '';
  if (kind === 'full-essay') return html.trim();
  // Replace deletions with empty string
  let clean = html.replace(/<span class=["']diff-del["']>[\s\S]*?<\/span>/g, '');
  // Strip the insertion tags but keep the content inside them
  clean = clean.replace(/<span class=["']diff-ins["']>([\s\S]*?)<\/span>/g, '$1');
  // Strip any other HTML tags
  clean = clean.replace(/<[^>]*>/g, '');
  // Unescape any HTML entities if needed (e.g. &amp;, &lt;, &gt;, &quot;)
  const temp = document.createElement('textarea');
  temp.innerHTML = clean;
  return temp.value.trim();
}

function prunePracticeAttempts(history, newAttempt) {
  const qKey = newAttempt.questionId || newAttempt.questionTitle || newAttempt.questionText;
  if (!qKey) return history;
  
  const questionAttempts = [];
  for (let i = 0; i < history.length; i++) {
    const a = history[i];
    const key = a.questionId || a.questionTitle || a.questionText;
    if (key === qKey) {
      questionAttempts.push(i);
    }
  }
  
  if (questionAttempts.length > 10) {
    const indexesToRemove = questionAttempts.slice(10);
    return history.filter((_, idx) => !indexesToRemove.includes(idx));
  }
  return history;
}

function copyToClipboardFallback(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      toast('Essay copied to clipboard! ✓');
    } else {
      toast('Failed to copy essay', true);
    }
  } catch (err) {
    console.error('Fallback copy failed: ', err);
    toast('Failed to copy essay', true);
  }
  document.body.removeChild(textArea);
}

function copyPracticeText(type) {
  const a = practiceState.currentAttempt;
  if (!a) {
    toast('No attempt active', true);
    return;
  }
  let text = '';
  if (type === 'attempted') {
    text = a.essayText;
  } else if (type === 'rewritten') {
    text = getCleanSampleResponse(a.sampleResponse, a.sampleKind);
  }
  if (!text) {
    toast('No essay text to copy', true);
    return;
  }
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      toast('Essay copied to clipboard! ✓');
    }).catch(err => {
      console.warn('Clipboard API failed, trying fallback...', err);
      copyToClipboardFallback(text);
    });
  } else {
    copyToClipboardFallback(text);
  }
}

// ---------- History (Firestore-synced via user profile, or localStorage offline) ----------

function getPracticeHistory() {
  if (offlineMode) {
    const accountHistory = currentUserId ? getCachedPracticeHistory(currentUserId) : [];
    if (accountHistory.length > 0 || currentUserId) return accountHistory;
    try { return JSON.parse(safeLSGet('ipt_practice') || '[]'); }
    catch (e) { return []; }
  }
  if (!userProfile) return [];
  if (!userProfile.practiceHistory) userProfile.practiceHistory = [];
  return userProfile.practiceHistory;
}

async function savePracticeHistory(history, options = {}) {
  const nextHistory = Array.isArray(history) ? history : [];
  if (currentUserId) cachePracticeHistory(nextHistory, practiceHistoryDeleted, currentUserId);
  if (offlineMode) {
    if (currentUserId) {
      // Keep the account-scoped copy and attempt a cloud retry when a token is
      // still available; offline mode is a network state, not a data state.
      if (userProfile) userProfile.practiceHistory = nextHistory;
      queueSync();
      if (options.immediate) await flushSync();
    } else {
      safeLSSet('ipt_practice', JSON.stringify(nextHistory));
    }
    return;
  }
  if (!currentUser) return;
  userProfile.practiceHistory = nextHistory;
  userProfile.practiceHistoryDeleted = practiceHistoryDeleted;
  cachePracticeHistory(nextHistory, practiceHistoryDeleted, currentUserId);
  queueSync();
  if (options.immediate) await flushSync();
}

function updatePracticeStats() {
  const h = getPracticeHistory();
  const el = document.getElementById('practiceStats');
  if (!el) return;
  if (h.length === 0) {
    el.textContent = 'No attempts yet';
    return;
  }
  const avg = (h.reduce((s, a) => s + (a.scores?.total || 0), 0) / h.length);
  el.textContent = `${h.length} attempt${h.length === 1 ? '' : 's'} · avg ${avg.toFixed(1)}/${PRACTICE_MAX_TOTAL}`;
  const countEl = document.getElementById('practiceHistoryCount');
  if (countEl) countEl.textContent = h.length;
}

function renderPracticeHistory() {
  const list = document.getElementById('practiceHistoryList');
  const h = getPracticeHistory();
  if (h.length === 0) {
    list.innerHTML = `<div class="practice-history-empty">
      No practice attempts yet.<br>
      Click <strong>+ New attempt</strong> to write your first practice essay.
    </div>`;
    return;
  }
  
  // Group attempts by question
  const groups = {};
  h.forEach(a => {
    const qKey = a.questionId || a.questionTitle || a.questionText;
    if (!groups[qKey]) {
      groups[qKey] = {
        title: a.questionTitle || (a.questionText.slice(0, 50) + '...'),
        id: a.questionId || '',
        attempts: []
      };
    }
    groups[qKey].attempts.push(a);
  });
  
  // Sort attempts within each group by date (newest first)
  Object.values(groups).forEach(g => {
    g.attempts.sort((a, b) => (b.date || 0) - (a.date || 0));
  });
  
  // Sort groups by their most recent attempt date
  const sortedGroups = Object.values(groups).sort((g1, g2) => {
    const d1 = g1.attempts[0]?.date || 0;
    const d2 = g2.attempts[0]?.date || 0;
    return d2 - d1;
  });
  
  list.innerHTML = sortedGroups.map(g => {
    const qKey = g.id || g.title;
    const hasActiveAttempt = g.attempts.some(a => a.id === practiceState.viewingAttemptId);
    const isExpanded = practiceState.expandedQuestions[qKey] !== undefined 
      ? practiceState.expandedQuestions[qKey] 
      : hasActiveAttempt;
      
    const attemptsHtml = g.attempts.map(a => {
      const isActive = (a.id === practiceState.viewingAttemptId);
      const total = a.scores?.total || 0;
      const scoreBand = total >= 22 ? 'high' : (total >= 15 ? 'mid' : 'low');
      const dateStr = a.date ? formatPracticeDate(a.date) : '';
      return `
        <div class="practice-history-item ${isActive ? 'active' : ''}" style="margin-left: 8px; padding: 10px 14px; position: relative;" onclick="event.stopPropagation(); viewPracticeAttempt('${a.id}')">
          <div class="practice-history-meta" style="margin-bottom: 2px;">
            <span>${dateStr}</span>
            <span class="practice-history-score ${scoreBand}">${total}/${PRACTICE_MAX_TOTAL}</span>
          </div>
          <div style="font-size: 11.5px; color: var(--ink-soft); line-height: 1.4;">
            Attempt with ${a.wordCount} words
          </div>
          <button class="practice-history-del" style="right: 6px; top: 8px;" onclick="event.stopPropagation(); deletePracticeAttempt('${a.id}')" title="Delete">✕</button>
        </div>
      `;
    }).join('');
    
    return `
      <div class="practice-history-group" style="margin-bottom: 12px; border: 1px solid var(--line-soft); border-radius: 12px; overflow: hidden; background: var(--bg-card); box-shadow: var(--shadow);">
        <div class="practice-history-group-header" style="padding: 12px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: var(--card-raised); border-bottom: ${isExpanded ? '1px solid var(--line-soft)' : 'none'};" data-qkey="${escapeHtml(qKey)}" onclick="toggleGroupHeader(this)">
          <div style="flex: 1; min-width: 0; padding-right: 8px;">
            <div style="font-family: var(--serif); font-size: 13.5px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(g.title)}">
              ${escapeHtml(g.title)}
            </div>
            <div style="font-size: 11px; color: var(--ink-soft); margin-top: 2px;">
              ${g.attempts.length} attempt${g.attempts.length === 1 ? '' : 's'}
            </div>
          </div>
          <span style="font-size: 12px; color: var(--ink-soft); transition: transform 0.2s; transform: ${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};">▶</span>
        </div>
        <div class="practice-history-group-attempts" style="display: ${isExpanded ? 'block' : 'none'}; padding: 8px; background: var(--bg-list);">
          ${attemptsHtml}
        </div>
      </div>
    `;
  }).join('');
}

function toggleGroupHeader(el) {
  const qKey = el.getAttribute('data-qkey');
  practiceState.expandedQuestions[qKey] = !practiceState.expandedQuestions[qKey];
  renderPracticeHistory();
}

function formatPracticeDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Today ' + d.toTimeString().slice(0, 5);
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

async function deletePracticeAttempt(id) {
  if (!confirm('Delete this practice attempt? Cannot be undone.')) return;
  let h = getPracticeHistory();
  h = h.filter(a => a.id !== id);
  if (id && !practiceHistoryDeleted.includes(id)) practiceHistoryDeleted.push(id);
  await savePracticeHistory(h, { immediate: true });
  if (practiceState.viewingAttemptId === id) {
    practiceState.viewingAttemptId = null;
    practiceState.view = 'welcome';
    renderPracticeMain();
  }
  renderPracticeHistory();
  updatePracticeStats();
}

function viewPracticeAttempt(id) {
  savePortalEssayDraft();
  const h = getPracticeHistory();
  const attempt = h.find(a => a.id === id);
  if (!attempt) return;
  practiceState.currentAttempt = attempt;
  practiceState.viewingAttemptId = id;
  practiceState.view = 'results';
  closePortalSecondary('practice');
  renderPracticeMain();
  renderPracticeHistory();
}

// ---------- Main view rendering (welcome / write / loading / results) ----------

function renderPracticeMain() {
  const c = document.getElementById('practiceContent');
  if (practiceState.view === 'welcome') c.innerHTML = welcomeView();
  else if (practiceState.view === 'write') c.innerHTML = writeView();
  else if (practiceState.view === 'loading') c.innerHTML = loadingView();
  else if (practiceState.view === 'results') c.innerHTML = resultsView();
  c.dataset.view = practiceState.view;
  c.setAttribute('aria-busy', String(practiceState.view === 'loading'));

  // Wire up live word counter
  const ta = document.getElementById('practiceEssayInput');
  if (ta) {
    ta.addEventListener('input', updateLiveWordCount);
    updateLiveWordCount();
  }
  // Wire up question search input AND populate the picker initially
  const qs = document.getElementById('practiceQuestionSearch');
  if (qs) qs.addEventListener('input', renderQuestionPicker);
  // Populate library picker on first render (when on library tab in write view)
  if (practiceState.view === 'write' && practiceState.questionSource === 'library') {
    renderQuestionPicker();
  }
  // If we're back on the write view AND a timer was already running, resume the live counter
  if (practiceState.view === 'write' && practiceState.timerEnabled && practiceState.timerStartedAt) {
    startPracticeTimerInterval();
  } else if (practiceState.view !== 'write') {
    stopPracticeTimer();
  }
  if (practiceState.view === 'write') savePortalEssayDraft();
  updatePortalResume();
}

function welcomeView() {
  return `
    <div class="practice-welcome">
      <p class="portal-eyebrow">Essay practice · 200–300 words</p>
      <h2>Turn your ideas into a clear essay.</h2>
      <p>Choose a question, write at your own pace or use the 20-minute timer, then get feedback on what to improve.</p>
      <ol class="portal-practice-steps">
        <li><strong>Choose a topic</strong>Use your library or your own question.</li>
        <li><strong>Write your response</strong>Your draft saves on this device.</li>
        <li><strong>Review and revise</strong>Your assessed attempts sync to your account.</li>
      </ol>
      <p style="font-size:14px; color:var(--ink-soft);">Scoring uses 1 essay credit.</p>
      <button class="practice-welcome-cta" onclick="startNewPractice()">
        Choose an essay question →
      </button>
    </div>
  `;
}

function startNewPractice() {
  if (practiceSubmissionPending) { toast('Your essay review is still running. You can keep using the other practice sections.'); return; }
  const previous = portalDraftStore?.read(currentUserId);
  if ((practiceState.view === 'write' && practiceState.essayText.trim()) || previous?.essayText.trim()) {
    if (!confirm('Start a new essay? This replaces your unsubmitted draft. Cancel to keep it.')) return;
  }
  practiceState.view = 'write';
  practiceState.writeStep = 1;
  practiceState.promptExpanded = true;
  practiceState.questionSource = 'library';
  practiceState.selectedQuestionId = null;
  practiceState.questionTitle = '';
  practiceState.questionText = '';
  practiceState.essayText = '';
  practiceState.viewingAttemptId = null;
  practiceState.currentAttempt = null;
  // Reset timer (but keep user's toggle preference)
  resetPracticeTimer();
  renderPracticeMain();
  renderPracticeHistory();
}

function startExamSimulator() {
  if (!practiceState.questionText || practiceState.questionText.trim().length < 10) {
    toast('Please pick a question or enter your own custom prompt first.', true);
    return;
  }
  practiceState.writeStep = 2;
  practiceState.promptExpanded = true;
  practiceState.essayText = ''; // start fresh
  resetPracticeTimer();
  renderPracticeMain();
}

function resetPracticeSetup() {
  if (practiceState.essayText && practiceState.essayText.trim().length > 10) {
    if (!confirm('Are you sure you want to change the topic? Your current writing progress will be lost.')) {
      return;
    }
  }
  practiceState.writeStep = 1;
  practiceState.essayText = '';
  stopPracticeTimer();
  resetPracticeTimer();
  renderPracticeMain();
}

function togglePracticePrompt() {
  practiceState.promptExpanded = !practiceState.promptExpanded;
  const box = document.getElementById('practicePromptBox');
  const btn = document.querySelector('.simulator-toggle-prompt-btn');
  if (box) {
    if (practiceState.promptExpanded) {
      box.style.maxHeight = '200px';
      box.style.opacity = '1';
      box.style.paddingTop = '14px';
      box.style.paddingBottom = '14px';
      box.style.marginTop = '14px';
      box.style.border = '1px solid var(--line-soft)';
    } else {
      box.style.maxHeight = '0';
      box.style.opacity = '0';
      box.style.paddingTop = '0';
      box.style.paddingBottom = '0';
      box.style.marginTop = '0';
      box.style.border = 'none';
    }
  }
  if (btn) {
    btn.textContent = practiceState.promptExpanded ? '👁️ Hide Question' : '👁️ Show Question';
  }
}

function writeView() {
  if (practiceState.writeStep === 1) {
    // Step 1: Select Topic Setup
    return `
      <div class="practice-step setup-mode" style="border: 1px solid var(--line-soft); border-radius: 14px; padding: 28px 32px; background: var(--bg-card); box-shadow: var(--shadow);">
        <div class="practice-step-header" style="margin-bottom: 22px;">
          <div class="practice-step-title" style="font-family: var(--serif); font-size: 20px; font-weight: 700; display: flex; align-items: baseline; gap: 12px;">
            <span class="practice-step-num" style="background: var(--accent); color: #fff; border-radius: 50%; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700;">1</span>
            Pick a question
          </div>
          <div class="practice-step-aux" style="font-size: 12px; color: var(--ink-mute); font-style: italic; font-family: var(--serif);">Choose a saved topic, or write your own custom prompt</div>
        </div>
        <div class="practice-source-tabs" style="display: flex; gap: 4px; margin-bottom: 12px; background: var(--bg); padding: 4px; border-radius: 8px; border: 1px solid var(--line-soft);">
          <button class="practice-source-tab ${practiceState.questionSource === 'library' ? 'active' : ''}" onclick="setQuestionSource('library')">📖 From your library</button>
          <button class="practice-source-tab ${practiceState.questionSource === 'custom' ? 'active' : ''}" onclick="setQuestionSource('custom')">✎ Write your own</button>
        </div>
        <div id="practiceQuestionArea">
          ${practiceState.questionSource === 'library' ? libraryPickerHTML() : customPromptHTML()}
        </div>
        <div class="practice-selected-question ${practiceState.questionText ? 'show' : ''}" id="practiceSelectedQuestion">
          <strong>Selected question</strong>
          ${escapeHtml(practiceState.questionText || '')}
        </div>
        
        <div class="practice-setup-actions" style="margin-top: 28px; border-top: 1px solid var(--line-soft); padding-top: 20px; display: flex; justify-content: flex-end; gap: 16px; align-items: center; flex-wrap: wrap;">
          <label class="practice-timer-toggle" style="margin-right: auto; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12.5px; color: var(--ink-soft); font-weight: 600;" title="Track how long you take (20 min exam target)">
            <input type="checkbox" id="practiceTimerToggle" ${practiceState.timerEnabled ? 'checked' : ''} onchange="toggleTimerMode(this.checked)">
            <span class="practice-timer-toggle-slider"></span>
            <span class="practice-timer-toggle-label">⏱ Time mode</span>
          </label>
          <button class="practice-action-btn primary" id="practiceStartBtn" onclick="startExamSimulator()" ${practiceState.questionText ? '' : 'disabled'} style="padding: 12px 28px; font-size: 14px; font-weight: 700; background: var(--accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px -3px var(--accent);">
            Start writing →
          </button>
        </div>
      </div>
    `;
  } else {
    // Step 2: Exam Simulator Focus Mode
    return `
      <div class="practice-step simulator-mode" style="border: 1px solid var(--line-soft); border-radius: 14px; padding: 28px 32px; background: var(--bg-card); box-shadow: var(--shadow);">
        <div class="simulator-header" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 200px;">
            <div style="font-size: 12px; color: var(--accent); font-weight: 700;">Your essay · 200–300 words</div>
            <div class="simulator-topic-title" style="font-family: var(--serif); font-size: 18px; font-weight: 700; color: var(--ink); margin-top: 2px;">
              ${escapeHtml(practiceState.questionTitle || 'Custom Writing Prompt')}
            </div>
          </div>
          <button class="simulator-toggle-prompt-btn" onclick="togglePracticePrompt()" style="background: transparent; border: 1px solid var(--line-soft); border-radius: 8px; padding: 8px 14px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer; transition: var(--transition);">
            ${practiceState.promptExpanded ? '👁️ Hide Question' : '👁️ Show Question'}
          </button>
        </div>

        <!-- Collapsible Prompt Box -->
        <div class="practice-prompt-collapsible ${practiceState.promptExpanded ? 'show' : ''}" id="practicePromptBox" style="margin-top: 14px; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; padding: 14px 18px; line-height: 1.6; font-size: 13.5px; color: var(--ink); transition: all 0.22s ease-in-out; overflow: hidden; ${practiceState.promptExpanded ? 'max-height: 200px; opacity: 1;' : 'max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; border: none; margin-top: 0;'}">
          ${escapeHtml(practiceState.questionText)}
        </div>

        <div style="border-top: 1px solid var(--line-soft); margin: 20px 0 16px;"></div>

        <div class="simulator-timer-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 10px; flex-wrap: wrap;">
          <div class="practice-timer-bar ${practiceState.timerEnabled ? 'show' : ''}" id="practiceTimerBar" style="margin: 0; display: ${practiceState.timerEnabled ? 'inline-flex' : 'none'}; align-items: center; gap: 8px; padding: 6px 14px; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 13.5px; font-weight: 700; color: var(--ink);">
            <span id="practiceTimerElapsed">00:00</span>
            <span class="practice-timer-target" style="color: var(--ink-mute); font-family: var(--sans); font-weight: 400; font-size: 11px;">/ ${PRACTICE_TIMER_LIMIT_MIN}:00 exam target</span>
          </div>
          <div style="font-size: 12px; color: var(--ink-soft); font-family: var(--serif); font-style: italic; display: flex; align-items: center; gap: 6px;">
            <span>⏱️ Time Mode:</span>
            <strong>${practiceState.timerEnabled ? 'Active' : 'Off'}</strong>
          </div>
        </div>

        <div class="practice-textarea-container" style="position: relative; border-radius: 12px; border: 1px solid var(--line-soft); background: var(--bg); box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); overflow: hidden; margin-bottom: 16px; transition: border-color 0.2s;">
          <textarea class="practice-essay-area" id="practiceEssayInput" aria-label="Your essay response" aria-describedby="practiceDraftStatus practiceWordCount" placeholder="Write your response here..." style="width: 100%; border: none; background: transparent; padding: 20px 24px; font-family: var(--sans); font-size: 16px; color: var(--ink); line-height: 1.8; min-height: 340px; resize: vertical; box-sizing: border-box;">${escapeHtml(practiceState.essayText)}</textarea>
        </div>
        <span id="practiceDraftStatus" class="portal-draft-status" role="status" aria-live="polite">Saving draft on this device…</span>

        <!-- Dynamic Word Count Progress Visualizer -->
        <div class="practice-progress-container" style="margin-top: 20px; background: var(--bg); padding: 16px 20px; border-radius: 12px; border: 1px solid var(--line-soft);">
          <div style="display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 8px; font-family: var(--serif); font-style: italic; color: var(--ink-soft);">
            <span id="practiceWordCountLabel">✍️ Keep writing...</span>
            <span style="font-weight: 700; font-family: var(--sans); font-style: normal;" id="practiceWordCount">0 words</span>
          </div>
          <div class="practice-progress-track" style="height: 10px; background: var(--line-soft); border-radius: 10px; position: relative; overflow: hidden;">
            <!-- Indicator markers for target zone (200-300 words) -->
            <div style="position: absolute; left: 57.14%; top: 0; bottom: 0; width: 28.57%; background: rgba(16, 185, 129, 0.12); border-left: 1px dashed rgba(16, 185, 129, 0.3); border-right: 1px dashed rgba(16, 185, 129, 0.3);" title="Ideal range (200-300 words)"></div>
            <div class="practice-progress-bar" id="practiceProgressBar" style="height: 100%; width: 0%; background: var(--accent); border-radius: 10px; transition: width 0.2s ease, background-color 0.2s ease;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9.5px; color: var(--ink-mute); margin-top: 6px; padding: 0 2px; font-family: var(--sans);">
            <span>0 words</span>
            <span style="margin-left: 32%;">200 words (min)</span>
            <span>300 words (max)</span>
            <span>350+</span>
          </div>
        </div>

        <div class="simulator-actions" style="margin-top: 28px; border-top: 1px solid var(--line-soft); padding-top: 20px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <button class="practice-back-btn" onclick="resetPracticeSetup()" style="border: 1px solid var(--line-soft); color: var(--ink-soft); background: transparent; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: var(--transition);">
            ← Change Topic / Reset
          </button>
          <button class="practice-submit-btn primary" id="practiceSubmitBtn" onclick="submitPracticeEssay()" disabled style="width: auto; padding: 12px 32px; font-size: 14px; font-weight: 700; background: var(--accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px -3px var(--accent); transition: var(--transition);">
            🤖 Score my essay
          </button>
        </div>
      </div>
    `;
  }
}

function setQuestionSource(src) {
  practiceState.questionSource = src;
  if (src === 'custom') {
    // Don't auto-clear; let user keep what they had
  }
  document.getElementById('practiceQuestionArea').innerHTML =
    (src === 'library') ? libraryPickerHTML() : customPromptHTML();
  document.querySelectorAll('.practice-source-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.practice-source-tab[onclick*="${src}"]`)?.classList.add('active');
  // Re-wire search input AND populate picker when switching to library
  const qs = document.getElementById('practiceQuestionSearch');
  if (qs) qs.addEventListener('input', renderQuestionPicker);
  if (src === 'library') renderQuestionPicker();
  updateSubmitBtnState();
}

function libraryPickerHTML() {
  return `
    <input type="text" class="practice-question-search" id="practiceQuestionSearch" placeholder="Search your essay library...">
    <div class="practice-question-picker" id="practiceQuestionPicker"></div>
  `;
}

function renderQuestionPicker() {
  const picker = document.getElementById('practiceQuestionPicker');
  if (!picker) return;
  const q = (document.getElementById('practiceQuestionSearch')?.value || '').toLowerCase().trim();
  // Only show essays that have a question prompt
  let filtered = essays.filter(e => e.question && e.question.trim());
  if (q) {
    filtered = filtered.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.question || '').toLowerCase().includes(q)
    );
  }
  if (filtered.length === 0) {
    picker.innerHTML = `<div style="padding:20px; text-align:center; color:var(--ink-mute); font-size:12px; font-style:italic; font-family:var(--serif);">
      ${q ? 'No essays match.' : 'No essays in your library have a question prompt yet.'}
    </div>`;
    return;
  }
  picker.innerHTML = filtered.map(e => `
    <div class="practice-question-item ${practiceState.selectedQuestionId === e.id ? 'selected' : ''}" onclick="pickLibraryQuestion('${e.id}')">
      <div class="practice-question-item-title">${escapeHtml(e.title || 'Untitled')}</div>
      <div class="practice-question-item-text">${escapeHtml(e.question)}</div>
    </div>
  `).join('');
}

function pickLibraryQuestion(id) {
  const e = essays.find(x => x.id === id);
  if (!e) return;
  practiceState.selectedQuestionId = id;
  practiceState.questionTitle = e.title || '';
  practiceState.questionText = e.question || '';
  renderQuestionPicker();
  // Update the "Selected" preview
  const sel = document.getElementById('practiceSelectedQuestion');
  if (sel) {
    sel.classList.add('show');
    sel.innerHTML = `<strong>Selected question</strong>${escapeHtml(practiceState.questionText)}`;
  }
  // Live-update the topic banner inside the write step
  refreshPracticeTopicBanner();
  updateSubmitBtnState();
}

// Inject (or update) the topic banner inside the practice Step 2 card without re-rendering everything.
function refreshPracticeTopicBanner() {
  // Find the write-step card — second .practice-step in the practice content
  const steps = document.querySelectorAll('.practice-content .practice-step');
  if (steps.length < 2) return;
  const writeStep = steps[1];
  // Remove any existing banner
  const existing = writeStep.querySelector('.practice-topic-banner');
  if (existing) existing.remove();
  if (!practiceState.questionText) return;
  // Build a fresh banner
  const banner = document.createElement('div');
  banner.className = 'topic-banner practice-topic-banner';
  banner.innerHTML = `
    <div class="topic-banner-label">${practiceState.questionTitle ? escapeHtml(practiceState.questionTitle) : 'The question'}</div>
    <div class="topic-banner-question">${escapeHtml(practiceState.questionText)}</div>
  `;
  // Insert AFTER the step-header (which is the first child)
  const header = writeStep.querySelector('.practice-step-header');
  if (header && header.nextSibling) {
    writeStep.insertBefore(banner, header.nextSibling);
  } else {
    writeStep.appendChild(banner);
  }
}

function customPromptHTML() {
  return `
    <textarea class="practice-custom-input" id="practiceCustomPrompt" placeholder="Paste or type any essay question — IELTS, PTE, or your own..." oninput="onCustomPromptInput(this.value)">${escapeHtml(practiceState.questionSource === 'custom' ? practiceState.questionText : '')}</textarea>
  `;
}

function onCustomPromptInput(val) {
  practiceState.selectedQuestionId = null;
  practiceState.questionTitle = '';
  practiceState.questionText = val.trim();
  queuePortalEssayDraft();
  // Update preview banner
  const sel = document.getElementById('practiceSelectedQuestion');
  if (sel) {
    if (practiceState.questionText) {
      sel.classList.add('show');
      sel.innerHTML = `<strong>Your prompt</strong>${escapeHtml(practiceState.questionText)}`;
    } else {
      sel.classList.remove('show');
    }
  }
  // Live-update the topic banner inside the write step
  refreshPracticeTopicBanner();
  updateSubmitBtnState();
}

function updateLiveWordCount() {
  const ta = document.getElementById('practiceEssayInput');
  if (!ta) return;
  practiceState.essayText = ta.value;
  queuePortalEssayDraft();
  const count = countWords(ta.value);
  
  // Update plain count display
  const el = document.getElementById('practiceWordCount');
  if (el) {
    el.textContent = count + ' word' + (count === 1 ? '' : 's');
  }

  // Update Progress Bar & Labels
  const progressBar = document.getElementById('practiceProgressBar');
  const countLabel = document.getElementById('practiceWordCountLabel');
  if (progressBar) {
    let pct = 0;
    let barColor = 'var(--accent)';
    let statusText = '✍️ Keep writing...';

    if (count < 200) {
      pct = (count / 200) * 57.14;
      barColor = 'var(--accent)';
      statusText = `✍️ Keep writing... Need at least 200 words (current: ${count})`;
    } else if (count >= 200 && count <= 300) {
      pct = 57.14 + ((count - 200) / 100) * 28.57;
      barColor = '#10b981'; // green for target zone
      statusText = `✓ Perfect length! Ready to score (current: ${count})`;
    } else {
      pct = 85.71 + (Math.min(count - 300, 50) / 50) * 14.29;
      barColor = '#f59e0b'; // amber for warning
      statusText = `⚠ Length warning: Try to keep it under 300 words (current: ${count})`;
      if (count > 350) {
        barColor = '#ef4444'; // red for way over limit
        statusText = `✗ Length problem: Way over target limit (current: ${count})`;
      }
    }
    
    progressBar.style.width = pct + '%';
    progressBar.style.backgroundColor = barColor;
    if (countLabel) {
      countLabel.textContent = statusText;
      countLabel.style.color = count >= 200 && count <= 300 ? '#10b981' : (count > 300 ? (count > 350 ? '#ef4444' : '#f59e0b') : 'var(--ink-soft)');
    }
  }

  // Start the timer on first typing keystroke when timer mode is on
  if (practiceState.timerEnabled && !practiceState.timerStartedAt && count > 0) {
    startPracticeTimer();
  }
  updateSubmitBtnState();
}

// ---------- Timer (exam-mode simulation) ----------
// Format ms-since-start as "MM:SS"
function formatTimerElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function toggleTimerMode(on) {
  practiceState.timerEnabled = on;
  const bar = document.getElementById('practiceTimerBar');
  if (bar) bar.classList.toggle('show', on);
  if (!on) {
    // Turn off — clear running interval, but KEEP started time
    // (so if they re-enable, the bar shows what's elapsed since they started writing)
    if (practiceState.timerIntervalId) {
      clearInterval(practiceState.timerIntervalId);
      practiceState.timerIntervalId = null;
    }
  } else {
    // Turn on — if user already started writing, start the live counter immediately
    if (practiceState.essayText && countWords(practiceState.essayText) > 0) {
      if (!practiceState.timerStartedAt) practiceState.timerStartedAt = Date.now();
      startPracticeTimerInterval();
    }
    // Otherwise the counter starts on first keystroke (handled in updateLiveWordCount)
  }
}

function startPracticeTimer() {
  // Begin the timer right now (called on first keystroke when timer mode is on)
  practiceState.timerStartedAt = Date.now();
  startPracticeTimerInterval();
}

function startPracticeTimerInterval() {
  // Start the 1s update interval that paints the elapsed time on screen
  if (practiceState.timerIntervalId) clearInterval(practiceState.timerIntervalId);
  practiceState.timerIntervalId = setInterval(() => {
    const el = document.getElementById('practiceTimerElapsed');
    if (!el || !practiceState.timerStartedAt) return;
    const elapsed = Date.now() - practiceState.timerStartedAt;
    el.textContent = formatTimerElapsed(elapsed);
    // Visual cue when exceeded
    const limitMs = PRACTICE_TIMER_LIMIT_MIN * 60 * 1000;
    el.classList.toggle('exceeded', elapsed > limitMs);
  }, 1000);
}

function stopPracticeTimer() {
  if (practiceState.timerIntervalId) {
    clearInterval(practiceState.timerIntervalId);
    practiceState.timerIntervalId = null;
  }
}

function getPracticeElapsedMs() {
  if (!practiceState.timerEnabled || !practiceState.timerStartedAt) return null;
  return Date.now() - practiceState.timerStartedAt;
}

function resetPracticeTimer() {
  stopPracticeTimer();
  practiceState.timerStartedAt = null;
  const el = document.getElementById('practiceTimerElapsed');
  if (el) { el.textContent = '00:00'; el.classList.remove('exceeded'); }
}

function countWords(text) {
  text = (text || '').trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function updateSubmitBtnState() {
  const btn = document.getElementById('practiceSubmitBtn');
  if (btn) {
    const ready = practiceState.questionText.trim().length >= 10 &&
                  countWords(practiceState.essayText) >= 50;
    btn.disabled = !ready;
    if (countWords(practiceState.essayText) < 50) {
      btn.innerHTML = '🤖 Write at least 50 words to score';
    } else if (practiceState.questionText.trim().length < 10) {
      btn.innerHTML = '🤖 Pick or write a question first';
    } else {
      btn.innerHTML = '🤖 Score my essay';
    }
  }

  const startBtn = document.getElementById('practiceStartBtn');
  if (startBtn) {
    const ready = practiceState.questionText.trim().length >= 10;
    startBtn.disabled = !ready;
  }
}

function loadingView() {
  return `
    <div class="practice-loading ipt-assessment">
      <img class="ipt-assessment-logo" src="assets/ipt-brisbane-logo.png" alt="IPT Brisbane — IELTS and PTE Tutorial" width="180" height="109">
      <div class="practice-loading-icon" aria-hidden="true"></div>
      <div class="practice-loading-text" role="status" aria-live="polite">IPT Brisbane’s AI scoring engine is analysing your response…</div>
      <div class="practice-loading-sub" id="practiceLoadingText" aria-live="off">Your feedback and a Band 9 sample using your own ideas will appear here.</div>
    </div>
  `;
}

// Keep the branded assessment status visible while cycling supporting copy.
let practiceLoadingTimer = null;
function startLoadingMessages() {
  const messages = [
    'Your original essay is being assessed.',
    'Your feedback will cover content, structure and language.',
    'Your Band 9 sample will build on your own ideas.',
    'Your results will appear as soon as they are ready.'
  ];
  let i = 0;
  if (practiceLoadingTimer) clearInterval(practiceLoadingTimer);
  practiceLoadingTimer = setInterval(() => {
    i = (i + 1) % messages.length;
    const el = document.getElementById('practiceLoadingText');
    if (el) el.textContent = messages[i];
  }, 4000);
}
function stopLoadingMessages() {
  if (practiceLoadingTimer) { clearInterval(practiceLoadingTimer); practiceLoadingTimer = null; }
}

// ---------- Submit & score with Claude ----------

async function submitPracticeEssay() {
  if (practiceSubmissionPending) return;
  const ta = document.getElementById('practiceEssayInput');
  if (ta) practiceState.essayText = ta.value;
  const customInput = document.getElementById('practiceCustomPrompt');
  if (customInput && practiceState.questionSource === 'custom') practiceState.questionText = customInput.value.trim();
  const question = practiceState.questionText.trim();
  const essay = practiceState.essayText.trim();
  if (!question) { toast('Please pick or write a question first', true); return; }
  if (countWords(essay) < 50) { toast('Please write at least 50 words before scoring', true); return; }
  savePortalEssayDraft();

  const owner = { uid: canonicalClientUserId(currentUserId), token: sessionToken };
  const questionId = practiceState.selectedQuestionId || '';
  const questionTitle = practiceState.questionTitle || '';
  const elapsedMsAtSubmit = getPracticeElapsedMs();
  const sameOwner = () => owner.uid === canonicalClientUserId(currentUserId) && owner.token === sessionToken;
  stopPracticeTimer();
  practiceSubmissionPending = true;
  practiceState.view = 'loading';
  renderPracticeMain();
  startLoadingMessages();
  try {
    const res = await fetch(API_URL + '/api/essay/grade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, essay })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'The assessment could not be completed. Please try again.');
    const result = EssayScoring.normalizeResult(data, essay);
    const attempt = {
      ...result,
      id: 'pr_' + Date.now() + Math.random().toString(36).slice(2, 8),
      date: Date.now(), questionId, questionTitle, questionText: question, essayText: essay,
      ...(elapsedMsAtSubmit !== null ? { elapsedMs: elapsedMsAtSubmit } : {})
    };

    // A response may finish after sign-out or an account switch. Keep it only
    // in the originating account's recovery cache; never upload as another user.
    if (!sameOwner()) {
      if (owner.uid) {
        const deleted = getCachedPracticeHistoryDeleted(owner.uid);
        cachePracticeHistory(mergePracticeHistoryClient(getCachedPracticeHistory(owner.uid), [attempt], deleted), deleted, owner.uid);
      }
      return;
    }
    await consumeQuota('essay');
    const history = mergePracticeHistoryClient(getPracticeHistory(), [attempt], practiceHistoryDeleted);
    const saving = savePracticeHistory(history, { immediate: true });
    if (!sameOwner()) return;
    stopLoadingMessages();
    if (practiceState.view === 'loading' && practiceState.questionText.trim() === question) {
      practiceState.currentAttempt = attempt;
      practiceState.viewingAttemptId = attempt.id;
      practiceRevision = null;
      practiceState.view = 'results';
      const savedDraft = portalDraftStore?.read(owner.uid);
      if (savedDraft?.essayText.trim() === essay && savedDraft?.questionText.trim() === question) { portalDraftStore.remove(owner.uid); queueSync(); }
      renderPracticeMain();
    }
    renderPracticeHistory();
    updatePracticeStats();
    await saving;
    if (!sameOwner()) return;
    toast('Essay review saved to your history.');
    if (elapsedMsAtSubmit !== null && elapsedMsAtSubmit > PRACTICE_TIMER_LIMIT_MIN * 60000) {
      setTimeout(() => { if (sameOwner()) toast('You took ' + Math.round(elapsedMsAtSubmit / 60000) +
        ' min. Aim for ' + PRACTICE_TIMER_LIMIT_MIN + ' minutes next time.', true); }, 2200);
    }
  } catch (err) {
    if (sameOwner()) {
      stopLoadingMessages();
      if (practiceState.view === 'loading') { practiceState.view = 'write'; renderPracticeMain(); }
      toast(err.message || 'Scoring could not be completed. Your essay is still here.', true);
    }
  } finally {
    practiceSubmissionPending = false;
  }
}

// ---------- Results view ----------

let practiceSamplePendingId = null;
async function retryPracticeSample() {
  const attempt = practiceState.currentAttempt;
  if (!attempt || attempt.sampleKind !== 'unavailable' || practiceSamplePendingId) return;
  const owner = { uid: canonicalClientUserId(currentUserId), token: sessionToken };
  const sameOwner = () => owner.uid === canonicalClientUserId(currentUserId) && owner.token === sessionToken;
  practiceSamplePendingId = attempt.id;
  renderPracticeMain();
  try {
    const res = await fetch(API_URL + '/api/essay/grade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: attempt.questionText, essay: attempt.essayText })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'The sample could not be prepared. Please try again.');
    const sample = EssayScoring.normalizeSample(data, attempt.essayText, attempt);
    if (!sameOwner()) return;
    const current = getPracticeHistory().find(item => item.id === attempt.id);
    if (!current) return;
    const updated = { ...current, ...sample, updatedAt: Date.now() };
    const save = savePracticeHistory(mergePracticeHistoryClient(getPracticeHistory(), [updated], practiceHistoryDeleted), { immediate: true });
    if (practiceState.currentAttempt?.id === attempt.id) {
      practiceState.currentAttempt = updated;
      renderPracticeMain();
    }
    await save;
    if (!sameOwner()) return;
    renderPracticeHistory();
    toast(sample.sampleStatus === 'ready' ? 'Your Band 9 sample is ready.' : sample.sampleNote, sample.sampleStatus === 'unavailable');
  } catch (error) {
    if (sameOwner()) toast(error.message || 'The sample could not be prepared. Your score is still saved.', true);
  } finally {
    practiceSamplePendingId = null;
    if (sameOwner() && practiceState.currentAttempt?.id === attempt.id) renderPracticeMain();
  }
}

function renderPracticeSample(a) {
  if (a.sampleKind === 'unavailable') {
    const pending = practiceSamplePendingId === a.id;
    return `<div class="practice-grammar-section" style="margin-top:20px;">
      <div class="practice-grammar-title">Band 9 sample · Your ideas</div>
      <p style="font-size:13px; line-height:1.6; color:var(--ink-soft);">${escapeHtml(a.sampleNote || '')}</p>
      <button class="admin-btn" onclick="retryPracticeSample()" ${pending ? 'disabled' : ''}>${pending ? 'Preparing your sample…' : 'Retry sample'}</button>
    </div>`;
  }
  if (a.sampleKind === 'needs-ideas') {
    return `<div class="practice-grammar-section" style="margin-top:20px;">
      <div class="practice-grammar-title">Add ideas for your Band 9 sample</div>
      <p style="font-size:13px; line-height:1.6; color:var(--ink-soft);">${escapeHtml(a.sampleNote || '')}</p>
    </div>`;
  }
  if (!a.sampleResponse) return '';
  const fullEssay = a.sampleKind === 'full-essay';
  return `
    <div class="practice-grammar-section" style="margin-top:20px;">
      <div class="practice-grammar-header" style="display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:center;">
        <div style="flex:1; min-width:200px;">
          <div class="practice-grammar-title">${fullEssay ? 'Band 9 sample · Your ideas' : 'Example revision'}</div>
          <div style="font-size:12px; color:var(--ink-soft); line-height:1.5; font-weight:normal;">
            ${fullEssay
              ? 'A complete essay using your ideas and viewpoint, with stronger language and structure. ' + EssayScoring.words(a.sampleResponse) + ' words. Your practice score is based on your original essay.'
              : 'A saved excerpt showing suggested changes. Keep the rest of your essay and your own viewpoint.'}
          </div>
        </div>
        <button class="admin-btn" style="padding:6px 12px; font-size:12px; cursor:pointer;" onclick="copyPracticeText('rewritten')">${fullEssay ? 'Copy sample essay' : 'Copy revised excerpt'}</button>
      </div>
      <div style="padding:18px 24px; background:var(--bg-card); border:1px solid var(--line-soft); border-radius:12px; margin-bottom:18px; box-shadow:var(--shadow);">
        ${fullEssay ? '' : `<div style="display:flex; flex-wrap:wrap; gap:16px; font-size:11px; margin-bottom:14px; border-bottom:1px solid var(--line-soft); padding-bottom:8px; color:var(--ink-soft);">
          <div><span class="diff-ins">ins</span> Added / Improved</div>
          <div><span class="diff-del">del</span> Replaced / Removed</div>
        </div>`}
        <div style="white-space:pre-wrap; font-family:var(--serif); font-size:14px; line-height:1.8; color:var(--ink);">${fullEssay ? escapeHtml(a.sampleResponse) : EssayScoring.renderExcerpt(a.sampleResponse)}</div>
      </div>
    </div>
  `;
}

function resultsView() {
  const a = practiceState.currentAttempt;
  if (!a) return welcomeView();
  const total = a.scores?.total || 0;
  const pct = total / PRACTICE_MAX_TOTAL;
  const band = pct >= 0.85 ? 'high' : (pct >= 0.6 ? 'mid' : 'low');

  // Form check banner
  let formBanner = '';
  const wc = a.wordCount;
  if (wc >= 200 && wc <= 300) {
    formBanner = `<div class="practice-form-banner ok">
      <span class="practice-form-banner-icon">✓</span>
      <span class="practice-form-banner-text"><strong>Length OK:</strong> ${wc} words (target is 200–300).</span>
    </div>`;
  } else if ((wc >= 120 && wc < 200) || (wc > 300 && wc <= 380)) {
    formBanner = `<div class="practice-form-banner warn">
      <span class="practice-form-banner-icon">⚠</span>
      <span class="practice-form-banner-text"><strong>Length off-target:</strong> ${wc} words. Try to land between 200–300 next time.</span>
    </div>`;
  } else {
    formBanner = `<div class="practice-form-banner bad">
      <span class="practice-form-banner-icon">✗</span>
      <span class="practice-form-banner-text"><strong>Length problem:</strong> ${wc} words is well outside the 200–300 target. This costs you Form marks.</span>
    </div>`;
  }

  // Template banner — three states: good (praise IPT structure), ok (neutral), flag (warning)
  const tplState = a.templateDetector || 'ok';
  let tplClass = '';        // CSS class (good → green, flag → amber, ok → default)
  let tplStatus = 'OK';
  let tplIcon = '✓';
  let tplDefaultNote = 'Template check passed. Your writing looks natural.';
  if (tplState === 'good') {
    tplClass = '';            // uses the default green ".practice-template-banner" style
    tplStatus = 'Structure ✓';
    tplIcon = '✓';
    tplDefaultNote = 'Nice — you applied the IPT Band 9 structure correctly. Keep using these transitions.';
  } else if (tplState === 'flag') {
    tplClass = 'flag';        // amber warning style (already defined in CSS)
    tplStatus = 'Flagged';
    tplIcon = '⚠';
    tplDefaultNote = 'Some phrases sound over-rehearsed — try writing more naturally about THIS topic.';
  }
  const templateBanner = `<div class="practice-template-banner ${tplClass}">
    <span style="font-weight:700;">${tplIcon} Structure and relevance:</span>
    <span class="practice-template-status">${tplStatus}</span>
    <span style="flex:1;">${escapeHtml(a.templateNote || tplDefaultNote)}</span>
  </div>`;

  // Score cells (using modern pte-grid metric cards)
  const cells = PRACTICE_RUBRIC.map(r => {
    const score = a.scores?.[r.key] || 0;
    return `
      <div class="pte-metric-card">
        <span class="pte-metric-label">${r.label}</span>
        <span class="pte-metric-score">${score}/${r.max}</span>
      </div>
    `;
  }).join('');

  const pteDashboardHtml = `
    <div class="pte-dashboard" style="margin-bottom: 24px;">
      <div class="pte-score-circle-wrap">
        <div class="practice-score-circle total">
          <span class="practice-score-num">${total}<sub>/26</sub></span>
        </div>
        <span class="pte-metric-label">Practice score</span>
      </div>
      <div class="pte-grid">
        ${cells}
      </div>
    </div>
  `;

  // Per-category feedback cards
  const feedbackCards = PRACTICE_RUBRIC.map(r => {
    const score = a.scores?.[r.key] || 0;
    const ratio = score / r.max;
    let cls = 'bad';
    if (ratio >= 0.75) cls = 'good';
    else if (ratio >= 0.4) cls = 'mid';
    const fb = a.feedback?.[r.key] || 'No feedback for this category.';
    let extra = '';
    if (r.key === 'spelling' && a.spellingErrors && a.spellingErrors.length > 0) {
      extra = `<div class="practice-fb-issues">
        <div class="practice-fb-issues-label">Words to check</div>
        ${a.spellingErrors.map(w => `<span class="practice-fb-issues-chip">${escapeHtml(w)}</span>`).join('')}
      </div>`;
    }
    if (r.key === 'grammar' && a.grammarIssues && a.grammarIssues.length > 0) {
      extra = `<div class="practice-fb-issues">
        <div class="practice-fb-issues-label">Grammar issues spotted</div>
        ${a.grammarIssues.map(g => `<div style="font-size:12px; color:var(--ink); padding:3px 0;">• ${escapeHtml(g)}</div>`).join('')}
      </div>`;
    }
    return `
      <div class="practice-fb-card ${cls}">
        <div class="practice-fb-card-header">
          <div class="practice-fb-card-title">${r.label}</div>
          <span class="practice-fb-card-score">${score} / ${r.max}</span>
        </div>
        <div class="practice-fb-card-body">${escapeHtml(fb).replace(/\n/g, '<br>')}</div>
        ${extra}
      </div>
    `;
  }).join('');

  // Strengths / improvements summary
  const strengths = (a.strengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const improvements = (a.improvements || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const summaryRow = (strengths || improvements) ? `
    <div class="practice-summary-row">
      ${strengths ? `<div class="practice-summary-col good">
        <div class="practice-summary-col-title">✓ What you did well</div>
        <ul class="practice-summary-list">${strengths}</ul>
      </div>` : ''}
      ${improvements ? `<div class="practice-summary-col improve">
        <div class="practice-summary-col-title">→ What to work on next</div>
        <ul class="practice-summary-list">${improvements}</ul>
      </div>` : ''}
    </div>
  ` : '';

  // Verdict line
  const verdictDefault = total >= 22 ? 'Excellent work — top-band level.'
    : total >= 17 ? 'Good effort. With a few tweaks you can push higher.'
    : total >= 10 ? 'Decent start. Focus on the "What to work on next" tips.'
    : 'Plenty of room to grow. Read through the per-category notes below.';
  const contentScore = Number(a.scores?.content) || 0;
  const verdict = contentScore <= 1 ? 'Focus on answering the question with relevant ideas.'
    : contentScore <= 3 ? 'Develop your answer to the question more fully.'
    : contentScore < 6 ? 'A useful answer — strengthen the points below.'
    : total === 26 ? 'A clear, developed essay that meets this practice rubric.'
    : 'Your answer covers the question. Review the language and structure below.';
  const optionalItems = (a.optionalRefinements || []).map(item => '<li><p>“' + escapeHtml(item.phrase) +
    '” → “' + escapeHtml(item.correction) + '”</p><p>' + escapeHtml(item.explanation || '') + '</p></li>').join('');
  const optionalSection = optionalItems ? '<details class="essay-feedback-details essay-optional"><summary>Optional wording refinements · no marks deducted</summary><ul>' + optionalItems + '</ul></details>' : '';
  const previousVersion = a.scoring_version !== EssayScoring.VERSION
    ? '<p class="essay-saved-note">This is saved feedback from an earlier scoring version. Use “Revise this essay” to submit it under the updated rules.</p>' : '';

  // Grammar & Spelling inline-error section
  const grammarSection = renderGrammarSpellingSection(a);

  const sampleResponseSection = renderPracticeSample(a);

  // Show the original question + essay for context
  const questionPanel = `
    <details style="margin-bottom:18px; background:var(--bg-card); border:1px solid var(--line); border-radius:8px; padding:10px 14px;">
      <summary style="cursor:pointer; font-weight:600; font-size:13px;">▸ View your question &amp; essay (${a.wordCount} words)</summary>
      <div style="margin-top:10px; font-size:12.5px; color:var(--ink-soft); line-height:1.6;">
        <div style="font-weight:700; color:var(--accent); font-size:10.5px; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:4px;">Question</div>
        <div style="margin-bottom:10px; color:var(--ink);">${escapeHtml(a.questionText)}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-weight:700; color:var(--accent); font-size:10.5px; letter-spacing:0.12em; text-transform:uppercase;">Your essay</span>
          <button class="admin-btn" style="padding:2px 8px; font-size:11px; cursor:pointer;" onclick="copyPracticeText('attempted')">📋 Copy Original</button>
        </div>
        <div style="white-space:pre-wrap; color:var(--ink); font-family:var(--serif); font-size:13px; line-height:1.7;">${escapeHtml(a.essayText)}</div>
      </div>
    </details>
  `;

  return `
    <div class="practice-results">
      <div class="practice-verdict-banner" style="background:var(--bg-card); border:1px solid var(--line-soft); border-radius:12px; padding:18px 24px; margin-bottom:20px; box-shadow:var(--shadow);">
        <div style="font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--ink-soft); margin-bottom:4px;">Evaluation Verdict</div>
        <div style="font-family:var(--serif); font-size:18px; font-weight:700; color:var(--ink);">${escapeHtml(verdict)}</div>
      </div>

      ${pteDashboardHtml}
      ${previousVersion}
      ${formBanner}
      ${templateBanner}

      ${summaryRow}

      ${grammarSection}
      ${optionalSection}

      ${sampleResponseSection}

      <details class="essay-feedback-details"><summary>Score breakdown and feedback</summary>
      ${feedbackCards}
      </details>

      ${questionPanel}

      <div class="practice-actions">
        <button class="practice-action-btn primary" onclick="revisePracticeEssay()">Revise this essay</button>
        <button class="practice-action-btn primary" onclick="reattemptPractice()">↻ Re-attempt this question</button>
        <button class="practice-action-btn" onclick="startNewPractice()">+ Try a different question</button>
        <button class="practice-action-btn" onclick="window.print()"><span style="margin-right: 4px;">🖨</span> Print / Save PDF</button>
        <button class="practice-action-btn" onclick="closePractice()">← Back to essays</button>
      </div>
    </div>
  `;
}

function reattemptPractice() {
  if (practiceSubmissionPending) { toast('Your current essay review is still running.'); return; }
  if (portalDraftStore?.read(currentUserId)?.essayText.trim() && !confirm('Start another attempt? This replaces your unsubmitted essay draft. Cancel to keep it.')) return;
  // Keep the same question, blank the essay, switch back to write view
  const a = practiceState.currentAttempt;
  if (!a) return startNewPractice();
  practiceState.view = 'write';
  practiceState.writeStep = 2;
  practiceState.promptExpanded = true;
  practiceState.questionSource = a.questionTitle ? 'library' : 'custom';
  practiceState.questionTitle = a.questionTitle || '';
  practiceState.questionText = a.questionText || '';
  practiceState.selectedQuestionId = null;
  // Try to re-match to library by title
  if (a.questionTitle) {
    const match = essays.find(e => e.title === a.questionTitle);
    if (match) practiceState.selectedQuestionId = match.id;
  }
  practiceState.essayText = '';
  practiceRevision = null;
  practiceState.viewingAttemptId = null;
  practiceState.currentAttempt = null;
  resetPracticeTimer();
  renderPracticeMain();
  renderPracticeHistory();
}

function revisePracticeEssay() {
  const a = practiceState.currentAttempt;
  if (!a) return;
  if (practiceSubmissionPending) { toast('Your current essay review is still running.'); return; }
  if (portalDraftStore?.read(currentUserId)?.essayText.trim() && !confirm('Revise this essay? This replaces your unsubmitted draft. Cancel to keep it.')) return;
  const text = practiceRevision?.attemptId === a.id ? practiceRevision.text : a.essayText;
  practiceState.questionTitle = a.questionTitle || '';
  practiceState.questionText = a.questionText || '';
  practiceState.questionSource = a.questionId ? 'library' : 'custom';
  practiceState.selectedQuestionId = a.questionId || null;
  practiceState.essayText = text;
  practiceState.view = 'write';
  practiceState.writeStep = 2;
  practiceState.promptExpanded = true;
  practiceState.viewingAttemptId = null;
  resetPracticeTimer();
  renderPracticeMain();
  document.getElementById('practiceEssayInput')?.focus();
}

// ---------- Grammar & Spelling section (Grammarly-style hybrid) ----------
// Layout: two columns —
//   left = essay with subtle underlines (click to focus sidebar entry)
//   right = sidebar listing all errors with [Apply] buttons (click to scroll & flash in essay)

function renderGrammarSpellingSection(a) {
  const grammarScore = a.scores?.grammar || 0;
  const spellingScore = a.scores?.spelling || 0;
  const errors = Array.isArray(a.errors) ? a.errors.filter(e => e && e.phrase) : [];
  const grammarPillClass = grammarScore === 2 ? '' : (grammarScore === 1 ? 'warn' : 'bad');
  const spellingPillClass = spellingScore === 2 ? '' : (spellingScore === 1 ? 'warn' : 'bad');

  // Render essay with errors marked (each error gets a data-error-id="i" for cross-linking)
  const highlightedEssay = highlightEssayErrors(a.essayText, errors);

  if (errors.length === 0) {
    return `
    <div class="practice-grammar-section">
      <div class="practice-grammar-header">
        <div class="practice-grammar-title">📝 Grammar &amp; Spelling</div>
        <div class="practice-grammar-pills">
          <span class="practice-grammar-pill ${grammarPillClass}">Grammar: ${grammarScore}/2</span>
          <span class="practice-grammar-pill ${spellingPillClass}">Spelling: ${spellingScore}/2</span>
        </div>
      </div>
      <div class="practice-essay-display">${highlightedEssay}</div>
      <div class="practice-grammar-no-errors">
        <span>✓</span>
        <span><strong>No grammar or spelling issues found.</strong> Clean writing!</span>
      </div>
    </div>
    `;
  }

  const spellingCount = errors.filter(e => e.type === 'spelling').length;
  const grammarCount = errors.filter(e => e.type !== 'spelling').length;

  // Build sidebar entries
  const entries = errors.map((err, i) => {
    const typeClass = err.type === 'spelling' ? 'spelling' : 'grammar';
    const typeLabel = err.type === 'spelling' ? 'Spelling' : 'Grammar';
    return `
      <div class="gh-card" data-error-id="${i}" onclick="focusErrorInEssay(${i})">
        <div class="gh-card-head">
          <span class="gh-card-type ${typeClass}">${typeLabel}</span>
          <button class="gh-card-apply" onclick="applyErrorFix(event, ${i})" title="Replace this error in the text">Apply</button>
        </div>
        <div class="gh-card-suggestion">
          <span class="gh-card-old">${escapeHtml(err.phrase)}</span>
          <span class="gh-card-arrow">→</span>
          <span class="gh-card-new">${escapeHtml(err.correction || '—')}</span>
        </div>
        ${err.explanation ? `<div class="gh-card-why">${escapeHtml(err.explanation)}</div>` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="practice-grammar-section">
      <div class="practice-grammar-header">
        <div class="practice-grammar-title">📝 Grammar &amp; Spelling</div>
        <div class="practice-grammar-pills">
          <span class="practice-grammar-pill ${grammarPillClass}">Grammar: ${grammarScore}/2</span>
          <span class="practice-grammar-pill ${spellingPillClass}">Spelling: ${spellingScore}/2</span>
        </div>
      </div>

      <div class="gh-layout">
        <!-- LEFT: essay with subtle inline underlines -->
        <div class="gh-essay">
          <div class="practice-essay-display" id="practiceEssayDisplay">${highlightedEssay}</div>
        </div>

        <!-- RIGHT: sidebar with one card per error -->
        <aside class="gh-sidebar">
          <div class="gh-sidebar-header">
            <div class="gh-sidebar-count">
              <strong>${errors.length}</strong> issue${errors.length === 1 ? '' : 's'} to review
            </div>
            <div class="gh-sidebar-breakdown">
              ${spellingCount ? `<span class="gh-sidebar-breakdown-item spelling">●&nbsp;${spellingCount} spelling</span>` : ''}
              ${grammarCount ? `<span class="gh-sidebar-breakdown-item grammar">●&nbsp;${grammarCount} grammar</span>` : ''}
            </div>
          </div>
          <div class="gh-cards">
            ${entries}
          </div>
          <div class="gh-sidebar-hint">
            <span>💡 <strong>Tip:</strong> Click an issue to find it in your essay, or hit <em>Apply</em> to replace it inline.</span>
          </div>
        </aside>
      </div>
    </div>
  `;
}

// Click on a sidebar card → scroll to underline + flash it
function focusErrorInEssay(idx) {
  const span = document.querySelector(`.practice-error[data-error-id="${idx}"]`);
  if (!span) return;
  span.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Pulse it
  span.classList.add('flash');
  setTimeout(() => span.classList.remove('flash'), 1200);
  // Also visually mark the card as active
  document.querySelectorAll('.gh-card.active').forEach(c => c.classList.remove('active'));
  document.querySelector(`.gh-card[data-error-id="${idx}"]`)?.classList.add('active');
}

// Click on an underlined error → scroll the sidebar entry into view + flash it
function focusErrorCard(idx) {
  // Flash the clicked word in the essay so the user gets immediate local feedback
  const span = document.querySelector(`.practice-error[data-error-id="${idx}"]`);
  if (span) {
    span.classList.remove('flash');
    // force reflow so the animation can restart if clicked repeatedly
    void span.offsetWidth;
    span.classList.add('flash');
    setTimeout(() => span.classList.remove('flash'), 1200);
  }
  // Highlight + scroll the matching sidebar card
  const card = document.querySelector(`.gh-card[data-error-id="${idx}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.querySelectorAll('.gh-card.active').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    // brief pulse so it's obvious which card lit up
    card.classList.remove('pulse');
    void card.offsetWidth;
    card.classList.add('pulse');
    setTimeout(() => card.classList.remove('pulse'), 800);
  }
}

// Apply a fix: replace the phrase in the rendered essay text + cross out the card
function applyErrorFix(ev, idx) {
  if (ev) ev.stopPropagation();
  const card = document.querySelector(`.gh-card[data-error-id="${idx}"]`);
  if (!card || card.classList.contains('applied')) return;
  const span = document.querySelector(`.practice-error[data-error-id="${idx}"]`);
  if (!span) return;

  // Get the correction text from the card's data
  const newText = card.querySelector('.gh-card-new')?.textContent || '';
  if (!newText || newText === '—') return;
  const attempt = practiceState.currentAttempt;
  const error = attempt?.errors?.[idx];
  if (!error) return;
  if (practiceRevision?.attemptId !== attempt.id) practiceRevision = { attemptId: attempt.id, text: attempt.essayText };
  if (!practiceRevision.text.includes(error.phrase)) { toast('That wording has already changed in your draft.'); return; }
  practiceRevision.text = practiceRevision.text.replace(error.phrase, () => newText);

  // Replace the underlined span with plain text (correction), inline
  const correctionNode = document.createElement('span');
  correctionNode.className = 'practice-error-fixed';
  correctionNode.textContent = newText;
  span.replaceWith(correctionNode);

  // Update the card visual: strike through, mark applied
  card.classList.add('applied');
  const btn = card.querySelector('.gh-card-apply');
  if (btn) {
    btn.textContent = '✓ In draft';
    btn.disabled = true;
  }
  toast('Correction added to your draft. Choose “Revise this essay” to review and rescore it.');
}

// Apply ALL remaining fixes at once (helper for the "Apply all" button if we add it later)
function applyAllErrorFixes() {
  document.querySelectorAll('.gh-card:not(.applied)').forEach(card => {
    const idx = parseInt(card.dataset.errorId, 10);
    if (!isNaN(idx)) applyErrorFix(null, idx);
  });
}

// Given the essay text and an array of {type, phrase, correction, explanation},
// return HTML with each phrase wrapped in a clickable .practice-error span carrying
// data-error-id so it can be cross-linked with sidebar cards.
// Paragraphs are preserved (double-newline => <p>).
function highlightEssayErrors(essayText, errors) {
  if (!essayText) return '';
  // Step 1: split into paragraphs
  const paragraphs = essayText.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  // If only single-newlines, treat each line as a paragraph too
  const finalParas = paragraphs.length > 1 ? paragraphs : essayText.split(/\n+/).map(p => p.trim()).filter(Boolean);

  // Build a list of unique errors (avoid double-wrapping the same phrase) — preserve original index
  const seen = new Set();
  const uniqueErrors = [];
  errors.forEach((err, originalIdx) => {
    if (!err || !err.phrase) return;
    const key = (err.phrase || '').toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueErrors.push({ ...err, originalIdx });
  });
  // Sort errors by length DESC so longer phrases match before shorter substrings
  uniqueErrors.sort((a, b) => (b.phrase || '').length - (a.phrase || '').length);

  return finalParas.map(para => {
    let html = escapeHtml(para);
    // Apply each error by finding its escaped form
    for (let i = 0; i < uniqueErrors.length; i++) {
      const err = uniqueErrors[i];
      const escapedPhrase = escapeHtml(err.phrase);
      const placeholder = `\x00ERR_${i}\x00`;
      const idx = html.indexOf(escapedPhrase);
      if (idx === -1) continue;
      html = html.slice(0, idx) + placeholder + html.slice(idx + escapedPhrase.length);
    }
    // Swap placeholders back with .practice-error spans (no tooltip — just underline + click handler)
    for (let i = 0; i < uniqueErrors.length; i++) {
      const err = uniqueErrors[i];
      const placeholder = `\x00ERR_${i}\x00`;
      const typeClass = (err.type === 'grammar') ? ' grammar' : '';
      // data-error-id refers to the ORIGINAL index in the errors[] array so the sidebar finds the right card
      const span = `<span class="practice-error${typeClass}" data-error-id="${err.originalIdx}" onclick="focusErrorCard(${err.originalIdx})">${escapeHtml(err.phrase)}</span>`;
      html = html.split(placeholder).join(span);
    }
    return `<p>${html}</p>`;
  }).join('');
}

// Legacy: keep togglePracticeErrorTip as a no-op so old saved attempts don't break.
function togglePracticeErrorTip(ev, el) {
  if (ev) ev.stopPropagation();
  // Tooltip removed in v29 — focus the sidebar card instead
  const id = el?.dataset?.errorId;
  if (id != null) focusErrorCard(parseInt(id, 10));
}

// ============================================================
//  PTE SWT PRACTICE PORTAL LOGIC & SWT ADMIN
// ============================================================

function getPteStorageKey(suffix) {
  return `pte_${currentUserId}_${suffix}`;
}

async function loadPassages(){
  try {
    const r = await fetch(API_URL+'/api/passages',{cache:'no-store'});
    const d = await r.json();
    if(Array.isArray(d) && d.length){ passages = d; }
    else if(d.passages && Array.isArray(d.passages)){ passages = d.passages; }
  } catch(e){ /* fall through */ }
  if(!passages.length){
    passages = [{ id:1, title:'Sample', category:'General', text:'Passage unavailable — check your connection.', keyElements:{what:'',why:'',how:'',result:''} }];
  }
  const navTotalEl = document.getElementById('navTotal');
  if (navTotalEl) navTotalEl.textContent = passages.length;
  const practiceFootLabelEl = document.getElementById('practiceFootLabel');
  if (practiceFootLabelEl) {
    practiceFootLabelEl.textContent = String(passages.length).padStart(2,'0') + ' · Practice Session';
  }
  populatePassageDropdowns();
}

function showSwtScreen(id) {
  document.querySelectorAll('.swt-sub-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    const heading = target.querySelector('h1');
    if (heading) heading.focus({ preventScroll: true });
  }
  const pane = document.getElementById('swtPane');
  if (pane) pane.scrollTop = 0;
}

let activeFilter = 'all';
let activeResFilter = 'all';

function populatePassageDropdowns() {
  const select1 = document.getElementById('passageSelect');
  if (select1) {
    select1.innerHTML = '';
    passages.forEach((p, idx) => {
      const isAttempted = attempted.has(p.id);
      if (activeFilter === 'attempted' && !isAttempted) return;
      if (activeFilter === 'unattempted' && isAttempted) return;
      
      const opt = document.createElement('option');
      opt.value = idx + 1;
      const statusSuffix = isAttempted ? ' (Attempted)' : ' (Unattempted)';
      opt.textContent = `Passage ${String(idx + 1).padStart(2, '0')}: ${p.title || 'Untitled'}${statusSuffix}`;
      select1.appendChild(opt);
    });
  }

  const select2 = document.getElementById('resPassageSelect');
  if (select2) {
    select2.innerHTML = '';
    passages.forEach((p, idx) => {
      const isAttempted = attempted.has(p.id);
      if (activeResFilter === 'attempted' && !isAttempted) return;
      if (activeResFilter === 'unattempted' && isAttempted) return;
      
      const opt = document.createElement('option');
      opt.value = idx + 1;
      const statusSuffix = isAttempted ? ' (Attempted)' : ' (Unattempted)';
      opt.textContent = `Passage ${String(idx + 1).padStart(2, '0')}: ${p.title || 'Untitled'}${statusSuffix}`;
      select2.appendChild(opt);
    });
  }
}

function changePassageFilter(val) {
  activeFilter = val;
  populatePassageDropdowns();
  const select = document.getElementById('passageSelect');
  if (select) {
    const hasCurrent = Array.from(select.options).some(opt => parseInt(opt.value) === currentPassageId);
    if (hasCurrent) {
      select.value = currentPassageId;
    } else if (select.options.length > 0) {
      jumpToPassage(parseInt(select.options[0].value));
    }
  }
}

function changeResultsPassageFilter(val) {
  activeResFilter = val;
  populatePassageDropdowns();
  const select = document.getElementById('resPassageSelect');
  if (select) {
    const hasCurrent = Array.from(select.options).some(opt => parseInt(opt.value) === currentPassageId);
    if (hasCurrent) {
      select.value = currentPassageId;
    } else if (select.options.length > 0) {
      jumpToResultsPassage(parseInt(select.options[0].value));
    }
  }
}

function jumpToPassage(target) {
  if (target < 1 || target > passages.length) return;
  loadPassage(target);
  const select1 = document.getElementById('passageSelect');
  if (select1) select1.value = target;
}

function jumpToResultsPassage(target) {
  if (target < 1 || target > passages.length) return;
  const select2 = document.getElementById('resPassageSelect');
  if (select2) select2.value = target;
  
  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  const p = passages.find(x => x.id === target) || passages[target-1];
  if (!p) return;
  
  switchSection('swt');
  if (scores[target] && typeof scores[target].overall_score === 'number') {
    currentPassageId = target;
    updateResultsNav();
    showResults(scores[target], p, scores[target].__spellData || null, scores[target].__text || '');
    showSwtScreen('swtResultsScreen');
  } else {
    loadPassage(target);
    showSwtScreen('swtPracticeScreen');
  }
}

function loadStoredData(){
  const att = LocalStore.get(getPteStorageKey('attempted')) || [];
  att.forEach(id => attempted.add(id));
  const h = LocalStore.get(getPteStorageKey('history')) || {};
  Object.keys(h).forEach(id => { if(h[id] && h[id].length) attempted.add(parseInt(id)); });
}

function loadPassage(id){
  if(id < 1 || id > passages.length) return;
  currentPassageId = id;
  const p = passages.find(x => x.id === id) || passages[id-1];
  if(!p) return;

  const num = String(id).padStart(2,'0');
  const navCurrentEl = document.getElementById('navCurrent');
  if (navCurrentEl) navCurrentEl.textContent = num;
  const pasNumEl = document.getElementById('pasNum');
  if (pasNumEl) pasNumEl.textContent = num;

  const wordCount = (p.text || '').trim().split(/\s+/).filter(Boolean).length;
  const pasWordCountEl = document.getElementById('pasWordCount');
  if (pasWordCountEl) pasWordCountEl.textContent = wordCount + ' words';
  const mins = Math.max(1, Math.round(wordCount / 26));
  const pasCategoryEl = document.getElementById('pasCategory');
  if (pasCategoryEl) pasCategoryEl.textContent = '~' + mins + ' min';

  const paras = (p.text || '').split(/\n\n+/).filter(Boolean);
  const passageBodyEl = document.getElementById('passageBody');
  if (passageBodyEl) {
    passageBodyEl.innerHTML = (paras.length ? paras : [p.text]).map(t => '<p>' + escapeHtml(t) + '</p>').join('');
  }

  const navPrevEl = document.getElementById('navPrev');
  if (navPrevEl) navPrevEl.toggleAttribute('disabled', id === 1);
  const navNextEl = document.getElementById('navNext');
  if (navNextEl) navNextEl.toggleAttribute('disabled', id === passages.length);

  const summaries = LocalStore.get(getPteStorageKey('summaries')) || {};
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.value = (summaries[id] && summaries[id].text) || '';
  const scratch = LocalStore.get(getPteStorageKey('scratch')) || {};
  const scratchInputEl = document.getElementById('scratchInput');
  if (scratchInputEl) scratchInputEl.value = scratch[id] || '';

  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  const prevAnswerBtn = document.getElementById('prevAnswerBtn');
  if (prevAnswerBtn) {
    prevAnswerBtn.style.display = (scores[id] && typeof scores[id].overall_score === 'number') ? 'inline-flex' : 'none';
  }

  switchWriteTab('write');
  onSummaryInput();
  resetTimer();
  const select1 = document.getElementById('passageSelect');
  if (select1) select1.value = id;
}

function prevPassage(){ if(currentPassageId > 1) loadPassage(currentPassageId - 1); }
function nextPassage(){ if(currentPassageId < passages.length) loadPassage(currentPassageId + 1); }

function switchWriteTab(tab){
  writeTab = tab;
  const tabWriteEl = document.getElementById('tabWrite');
  const tabPlanEl = document.getElementById('tabPlan');
  const writeTabPaneEl = document.getElementById('writeTabPane');
  const planTabPaneEl = document.getElementById('planTabPane');
  if (tabWriteEl) tabWriteEl.classList.toggle('active', tab === 'write');
  if (tabPlanEl) tabPlanEl.classList.toggle('active', tab === 'plan');
  if (writeTabPaneEl) writeTabPaneEl.classList.toggle('hidden', tab !== 'write');
  if (planTabPaneEl) planTabPaneEl.classList.toggle('hidden', tab !== 'plan');
  for (const [button, selected] of [[tabWriteEl, tab === 'write'], [tabPlanEl, tab === 'plan']]) {
    if (button) { button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; }
  }
}



function countSentences(t){
  const trimmed = (t || '').trim();
  if(!trimmed) return 0;
  const matches = trimmed.match(/[.!?]+(?=\s|$)/g);
  return matches ? matches.length : 1;
}

const CONNECTORS = ['however','moreover','therefore','consequently','furthermore','whereas','thus'];

function detectConnectors(t){
  const lower = (t || '').toLowerCase();
  return CONNECTORS.filter(c => new RegExp('\\b' + c + '\\b').test(lower));
}

function onSummaryInput(){
  const summaryInputEl = document.getElementById('summaryInput');
  if (!summaryInputEl) return;
  const text = summaryInputEl.value;
  const words = countWords(text);

  const wordCountEl = document.getElementById('wordCount');
  if (wordCountEl) wordCountEl.textContent = words;
  const fill = document.getElementById('wordMeterFill');
  if (fill) {
    const pct = Math.min(100, (words / 75) * 100);
    fill.style.width = pct + '%';
    fill.classList.toggle('over', words > 75);
  }

  setHealthRow('hrWordBand', words >= 5 && words <= 75, words, (words >= 5 && words <= 75) ? 'ok' : 'warn');
  const status = document.getElementById('swtWordStatus');
  if (status) {
    const message = words > 75 ? 'Remove ' + (words - 75) + ' words to meet the limit.'
      : words >= 5 ? 'Within the word limit. Check that this is one complete sentence.'
      : words ? 'Add at least ' + (5 - words) + ' more words.' : 'Write 5–75 words.';
    if (status.textContent !== message) status.textContent = message;
    status.className = words >= 5 && words <= 75 ? 'is-ready' : words ? 'is-warning' : '';
  }
  summaryInputEl.setAttribute('aria-invalid', String(words > 75));
  const undo = document.getElementById('swtUndoClear');
  if (undo) undo.hidden = true;

  const summaries = LocalStore.get(getPteStorageKey('summaries')) || {};
  if (String(summaries[currentPassageId]?.text || '') !== text) {
    summaries[currentPassageId] = { text, timestamp: new Date().toISOString(), score: summaries[currentPassageId]?.score || 0 };
    LocalStore.set(getPteStorageKey('summaries'), summaries);
    queueSync();
  }
}

function setHealthRow(rowId, ok, value, cls){
  const row = document.getElementById(rowId);
  if(!row) return;
  row.classList.remove('ok','warn');
  row.classList.add(cls);
  const icon = row.querySelector('.h-icon');
  if (icon) icon.textContent = ok ? '✓' : '!';
  const valSpan = document.getElementById(rowId + 'Val');
  if (valSpan) valSpan.textContent = value;
}

let swtClearedDraft = null;
function resetSummary(){
  const input = document.getElementById('summaryInput');
  if (!input || !input.value) return;
  swtClearedDraft = { text: input.value, passageId: currentPassageId, storageKey: getPteStorageKey('summaries') };
  input.value = '';
  onSummaryInput();
  const undo = document.getElementById('swtUndoClear');
  if (undo) undo.hidden = false;
  input.focus();
}
function undoSwtClear(){
  const draft = swtClearedDraft;
  if (!draft || draft.passageId !== currentPassageId || draft.storageKey !== getPteStorageKey('summaries')) return;
  const input = document.getElementById('summaryInput');
  if (!input || input.value) return;
  input.value = draft.text;
  swtClearedDraft = null;
  onSummaryInput();
  input.focus();
}

// Scratch Pad events
document.addEventListener('input', function(e){
  if(e.target && e.target.id === 'scratchInput'){
    const scratch = LocalStore.get(getPteStorageKey('scratch')) || {};
    scratch[currentPassageId] = e.target.value;
    LocalStore.set(getPteStorageKey('scratch'), scratch);
    const updated = LocalStore.get(getPteStorageKey('scratchUpdatedAt')) || {};
    updated[currentPassageId] = Date.now();
    LocalStore.set(getPteStorageKey('scratchUpdatedAt'), updated);
    queueSync();
  }
});

const TIMER_START_SECONDS = 10 * 60;
function toggleTimer(){
  timerOn = !timerOn;
  const timerStateEl = document.getElementById('timerState');
  if (timerStateEl) timerStateEl.textContent = timerOn ? 'Timer on' : 'Timer off';
  const toggle = document.getElementById('timerToggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(timerOn));
    toggle.setAttribute('aria-label', timerOn ? 'Turn off the timer' : 'Turn on the 10-minute timer');
  }
  if(timerOn){
    timerSeconds = TIMER_START_SECONDS;
    startTimer();
  } else {
    stopTimer();
    const disp = document.getElementById('timerDisplay');
    if (disp) {
      disp.textContent = '—';
      disp.classList.remove('expired');
    }
  }
}
function startTimer(){
  stopTimer();
  renderTimer();
  timerInterval = setInterval(() => {
    timerSeconds--;
    if(timerSeconds <= 0){
      timerSeconds = 0;
      renderTimer();
      stopTimer();
      const disp = document.getElementById('timerDisplay');
      if (disp) disp.classList.add('expired');
      toast('Time up — submit when you\'re ready.');
      return;
    }
    renderTimer();
  }, 1000);
}
function renderTimer(){
  const m = String(Math.floor(timerSeconds/60)).padStart(2,'0');
  const s = String(timerSeconds%60).padStart(2,'0');
  const disp = document.getElementById('timerDisplay');
  if (disp) {
    disp.textContent = m + ':' + s;
    disp.classList.toggle('warning', timerSeconds > 0 && timerSeconds <= 60);
  }
}
function stopTimer(){ if(timerInterval){ clearInterval(timerInterval); timerInterval = null; } }
function resetTimer(){
  if(timerOn){
    timerSeconds = TIMER_START_SECONDS;
    const disp = document.getElementById('timerDisplay');
    if (disp) disp.classList.remove('expired');
    startTimer();
  }
}

async function requestSwtGrade(payload, timeoutMs = 75000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const res = await fetch(API_URL + '/api/grade', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
        let data;
        try { data = await res.json(); }
        catch { throw new Error('The assessment response was incomplete. Your summary is safe; please try again.'); }
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'The assessment is unavailable. Your summary is safe; please try again.');
        if (!data?.trait_scores || !['content', 'form', 'grammar', 'vocabulary'].every(key => Number.isFinite(data.trait_scores[key]))) {
          throw new Error('The assessment response was incomplete. Your summary is safe; please try again.');
        }
        return data;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => {
        reject(new Error('The assessment took too long. Your summary is safe; please try again.'));
        controller.abort();
      }, timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

async function scoreSummary(submission = null){
  if (swtGradingPending) return;
  const summaryInputEl = document.getElementById('summaryInput');
  if (!summaryInputEl && !submission) return;
  const text = (submission ? submission.text : summaryInputEl.value).trim();
  const passageId = submission ? submission.passageId : currentPassageId;
  if(!text){ toast('Write a summary first.'); return; }
  const words = countWords(text);
  if(words < 5){ toast('Too short — minimum 5 words.'); return; }
  if(words > 75){ toast('Too long — maximum 75 words.'); return; }

  const p = passages.find(x => x.id === passageId);
  if(!p){ toast('Passage not loaded.'); return; }

  const owner = { uid: canonicalClientUserId(currentUserId), token: sessionToken };
  const sameOwner = () => owner.uid === canonicalClientUserId(currentUserId) && owner.token === sessionToken;
  swtGradingPending = true;
  showLoading(true, 'scoring');
  const scoreBtn = document.getElementById('scoreBtn');
  if (scoreBtn) { scoreBtn.disabled = true; scoreBtn.textContent = 'IPT Brisbane AI is analysing…'; }
  const workspace = document.getElementById('writeTabPane');
  if (workspace) workspace.setAttribute('aria-busy', 'true');

  try {
    const payload = { type: 'swt', passageId, prompt: p.text, keyPoints: p.keyElements, text };
    if (owner.uid) payload.userId = owner.uid;
    const data = await requestSwtGrade(payload);
    if (!sameOwner()) return;
    // The grade already includes spelling feedback. A separate dictionary
    // request must not delay the student's completed assessment.
    const spellData = data.spelling_details || null;
    let saved = true;
    try { await saveAttempt(passageId, text, data, spellData); }
    catch { saved = false; }
    if (!sameOwner()) return;
    attempted.add(passageId);
    populatePassageDropdowns();
    if (currentPassageId !== passageId) {
      toast(saved ? 'Feedback saved for ' + (p.title || 'your summary') + '.' : 'Feedback could not be saved. Please retry this summary.');
      return;
    }
    lastSpellData = spellData;
    stopTimer();
    
    let resultPassage = p;
    if(data.passage_current){
      resultPassage = Object.assign({}, p, data.passage_current);
      const idx = passages.findIndex(x => x.id === passageId);
      if(idx >= 0) passages[idx] = Object.assign({}, passages[idx], data.passage_current);
    }
    showResults(data, resultPassage, spellData, text);
    showSwtScreen('swtResultsScreen');
    if (!saved) toast('Your score is ready, but this device could not save it. Keep this result open.', true);
  } catch(e){
    if (sameOwner()) toast(e.message || 'Scoring could not be completed. Your summary is still here.', true);
  } finally {
    swtGradingPending = false;
    showLoading(false);
    if (scoreBtn) { scoreBtn.disabled = false; scoreBtn.textContent = 'Get feedback →'; }
    if (workspace) workspace.removeAttribute('aria-busy');
  }
}

function retrySwtAssessment(){
  if (swtResultSubmission && swtResultSubmission.ownerId === canonicalClientUserId(currentUserId)
    && swtResultSubmission.token === sessionToken) return scoreSummary(swtResultSubmission);
}

async function saveAttempt(pid, text, data, spellData){
  const ts = new Date().toISOString();
  
  attempted.add(pid);
  LocalStore.set(getPteStorageKey('attempted'), Array.from(attempted));

  const summaries = LocalStore.get(getPteStorageKey('summaries')) || {};
  if (!summaries[pid] || String(summaries[pid].text || '').trim() === text.trim()) {
    summaries[pid] = { text, timestamp: ts, score: data.overall_score || 0 };
  }
  LocalStore.set(getPteStorageKey('summaries'), summaries);

  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  scores[pid] = Object.assign({}, data, { __text: text, __timestamp: ts, __spellData: spellData || null });
  LocalStore.set(getPteStorageKey('scores'), scores);

  const h = LocalStore.get(getPteStorageKey('history')) || {};
  if(!h[pid]) h[pid] = [];
  h[pid].unshift({
    text, timestamp: ts,
    overall_score: data.overall_score || 0, band: data.band || 'Band 5',
    trait_scores: data.trait_scores || {}, word_count: data.word_count || 0,
    content_details: data.content_details || {},
    scoring_version: data.scoring_version || 'unknown'
  });
  if(h[pid].length > 10) h[pid] = h[pid].slice(0,10);
  LocalStore.set(getPteStorageKey('history'), h);

  queueSync();
}

function loadPreviousAnswer(){
  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  const stored = scores[currentPassageId];
  if(!stored){ toast('No previous answer for this passage.'); return; }
  const p = passages.find(x => x.id === currentPassageId);
  if(!p){ return; }
  const summaryInputEl = document.getElementById('summaryInput');
  if(stored.__text && summaryInputEl){ summaryInputEl.value = stored.__text; onSummaryInput(); }
  showResults(stored, p, stored.__spellData || null, stored.__text || '');
  showSwtScreen('swtResultsScreen');
}

function formatAttemptTime(iso){
  if(!iso) return '';
  const then = new Date(iso);
  if(isNaN(then.getTime())) return '';
  const now = new Date();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60000);
  if(diffMin < 1) return 'just now';
  if(diffMin < 60) return diffMin + (diffMin === 1 ? ' minute ago' : ' minutes ago');
  const diffHr = Math.round(diffMin / 60);
  if(diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
  try {
    return then.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch(e){
    return then.toISOString().slice(0,16).replace('T',' ');
  }
}

function showResults(data, passage, spellData, submittedText){
  swtResultPassage = passage;
  swtResultSubmission = { passageId: passage.id, text: submittedText || '',
    ownerId: canonicalClientUserId(currentUserId), token: sessionToken };
  const display = SwtStudentFeedback.presentation(data);
  const traits = data.trait_scores || {};
  const rawMax = display.max;
  const rawScore = display.score;

  let crumb = 'Results · ' + (passage.title || 'Passage ' + currentPassageId);
  if(data.__timestamp){
    const when = formatAttemptTime(data.__timestamp);
    if(when) crumb += '  ·  your attempt from ' + when;
  }
  const breadcrumbEl = document.getElementById('resultsBreadcrumb');
  if (breadcrumbEl) breadcrumbEl.textContent = crumb;

  const ringCirc = 339.29;
  const heroRing = document.getElementById('heroRing');
  if (heroRing) {
    heroRing.style.strokeDasharray = ringCirc;
    heroRing.style.strokeDashoffset = ringCirc * (1 - Math.max(0, Math.min(1, rawScore/rawMax)));
  }
  const heroScoreEl = document.getElementById('heroScore');
  if (heroScoreEl) heroScoreEl.textContent = rawScore == null ? '—' : fmtNum(rawScore);
  const maxEl = document.getElementById('swtRawMax');
  if (maxEl) maxEl.textContent = '/ ' + rawMax;
  const estimateEl = document.getElementById('swtEstimate');
  if (estimateEl) estimateEl.textContent = display.secondary;
  const scoreLabel = document.getElementById('swtScoreLabel');
  if (scoreLabel) scoreLabel.textContent = display.label;

  const heroVerdictEl = document.getElementById('heroVerdict');
  if (heroVerdictEl) {
    heroVerdictEl.textContent = display.headline;
  }
  const heroSummaryEl = document.getElementById('heroSummary');
  if (heroSummaryEl) heroSummaryEl.textContent = buildResultSummary(data, traits);
  renderSwtGuidance(data);
  const previousRubric = data.scoring_version && data.scoring_version !== '20.3.6';
  const rubricNotice = document.getElementById('swtRubricNotice');
  if (rubricNotice) {
    rubricNotice.hidden = !previousRubric;
    rubricNotice.textContent = previousRubric ? 'Saved result from an earlier scoring version. Submit this summary again to use the updated rules.' : '';
  }
  document.querySelectorAll('#swtResultsScreen details').forEach(detail => { detail.open = false; });

  const degradedEl = document.getElementById('aiDegradedNotice');
  if(degradedEl){
    if(data.ai_feedback_degraded || data.score_provisional){
      degradedEl.style.display = '';
      degradedEl.textContent = 'The full assessment could not be completed. Your summary is still available. Retry the assessment to receive a confirmed score.';
    } else {
      degradedEl.style.display = 'none';
    }
  }
  const retryBtn = document.getElementById('swtRetryAssessmentBtn');
  if (retryBtn) {
    retryBtn.hidden = !(data.ai_feedback_degraded || data.score_provisional);
    retryBtn.style.display = retryBtn.hidden ? 'none' : '';
  }

  const heroTraitChipsEl = document.getElementById('heroTraitChips');
  if (heroTraitChipsEl) {
    heroTraitChipsEl.innerHTML = [
      `${data.word_count || countWords(submittedText)} words`,
      Number(traits.form) >= 1 ? 'One sentence · within word limit' : 'Check sentence and word limits'
    ].map(t => `<span class="trait-chip">${t}</span>`).join('');
  }

  renderOriginality(data, passage, submittedText);
  renderAnnotatedSubmission(data, passage, spellData, submittedText);
  renderAnnotatedPassage(passage);
  renderSwtKeyPhrases(passage);
  renderTraitBreakdown(data, traits);

  const sampleEl = document.getElementById('sampleAnswerText');
  const sampleNotes = document.getElementById('sampleAnswerNotes');
  if(sampleEl){
    const sample = (passage && passage.sampleResponse) || '';
    sampleEl.textContent = sample || '(No sample answer authored for this passage yet.)';
  }
  if(sampleNotes){
    sampleNotes.textContent = 'Open this tab to check the sample with the same rubric used for your summary.';
    sampleNotes.dataset.status = 'unchecked';
    sampleNotes.style.display = '';
  }
  switchSbsView('summary');

  renderAboutPassage(passage);
  renderVocabCoach(data);
  updateResultsNav();
}

function fmtNum(n){
  if(n == null) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function verdictLine(pte, band){
  let word;
  if(pte >= 86) word = 'Excellent';
  else if(pte >= 79) word = 'Strong attempt';
  else if(pte >= 65) word = 'Solid attempt';
  else if(pte >= 50) word = 'Developing';
  else word = 'Needs work';
  return escapeHtml(word) + ' — <em>' + escapeHtml(band) + '</em>';
}

function buildResultSummary(data, traits){
  return SwtStudentFeedback.build(data).summary;
}
function renderSwtGuidance(data){
  const target = document.getElementById('swtGuidanceBody');
  if (!target) return;
  const feedback = SwtStudentFeedback.build(data);
  target.innerHTML = '<ul class="swt-guidance-list">' + feedback.priorities.map(item =>
    '<li><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.detail) + '</p>' +
    (item.repair ? '<p class="swt-repair"><strong>Try:</strong> ' + escapeHtml(item.repair) + '</p>' : '') + '</li>'
  ).join('') + '</ul>' + (feedback.optional.length
    ? '<details class="swt-refinements"><summary>Optional refinements · no marks deducted (' + feedback.optional.length + ')</summary><ul>' +
      feedback.optional.map(item => '<li><span>“' + escapeHtml(item.phrase) + '” → “' + escapeHtml(item.fix) + '”</span>' +
      (item.reason ? '<p>' + escapeHtml(item.reason) + '</p>' : '') + '</li>').join('') + '</ul></details>' : '');
}
function compareSwtSample(){
  switchSbsView('sample');
  const tab = document.getElementById('sbsTabSample');
  if (tab) { tab.scrollIntoView({ block: 'center' }); tab.focus({ preventScroll: true }); }
}
document.addEventListener('keydown', function(event){
  if (!event.target || !event.target.closest || !event.target.closest('#swtPane [role="tablist"]')) return;
  const list = event.target.closest('[role="tablist"]');
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  const index = tabs.indexOf(event.target);
  if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click();
  tabs[next].focus();
});

function renderOriginality(data, passage, submittedText){
  const el = document.getElementById('originalityChecks');
  if (!el) return;
  const overlap = computeCopyMetrics(submittedText, passage.text || '');
  el.innerHTML = '<div class="orig-cell"><p>Accurate source wording is acceptable when your summary is concise and connected.</p>' +
    '<p class="orig-detail">Longest matching phrase: ' + overlap.longestRun + ' words. ' + overlap.pct +
    '% of your four-word sequences also appear in the passage. This is a wording comparison, not an authorship or plagiarism assessment.</p></div>';
}

function computeCopyMetrics(student, passage){
  function words(s){ return (s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean); }
  const sw = words(student), pw = words(passage);
  if(sw.length === 0) return { pct: 0, longestRun: 0 };

  const pGrams = new Set();
  for(let i = 0; i <= pw.length - 4; i++) pGrams.add(pw.slice(i,i+4).join(' '));
  let hits = 0;
  const total = Math.max(1, sw.length - 3);
  for(let i = 0; i <= sw.length - 4; i++){
    if(pGrams.has(sw.slice(i,i+4).join(' '))) hits++;
  }
  const pct = Math.round((hits / total) * 100);

  let longest = 0;
  const pJoined = ' ' + pw.join(' ') + ' ';
  for(let i = 0; i < sw.length; i++){
    for(let len = Math.min(25, sw.length - i); len >= 4; len--){
      if(pJoined.includes(' ' + sw.slice(i,i+len).join(' ') + ' ')){
        if(len > longest) longest = len;
        break;
      }
    }
  }
  return { pct, longestRun: longest };
}

function renderAnnotatedSubmission(data, passage, spellData, submittedText){
  const el = document.getElementById('annotatedSubmission');
  if (!el) return;
  el.textContent = submittedText || '—';
  const cd = data.content_details || {};
  const fb = document.getElementById('annotatedFeedback');
  if (fb) {
    const traits = data.trait_scores || {};
    const assessment = cd.summary_assessment || {};
    const validForm = Number(traits.form) >= 1;
    const items = [{ cls: validForm ? 'good' : 'warn', icon: validForm ? '✓' : '!',
      text: validForm ? 'One sentence within 5–75 words.' : 'Check the form: one complete sentence within 5–75 words.' }];
    if (!data.score_provisional && !data.ai_feedback_degraded && validForm) {
      if (assessment.relationships_clear === true && !(assessment.missing_dependencies || []).length) {
        items.push({ cls: 'good', icon: '✓', text: 'The selected ideas connect clearly.' });
      } else if (assessment.relationships_clear === false || (assessment.missing_dependencies || []).length) {
        items.push({ cls: 'warn', icon: '!', text: 'A connection needs attention. See your next step above.' });
      }
    }
    fb.innerHTML = items.map(it => '<div class="ann-fb-item ' + it.cls + '"><span class="fb-icon">' +
      it.icon + '</span><span class="fb-text">' + escapeHtml(it.text) + '</span></div>').join('');
  }
}

function renderAnnotatedPassage(passage){
  const el = document.getElementById('annotatedPassage');
  if (el) el.textContent = (passage && passage.text) || '—';
}

function renderSwtKeyPhrases(passage){
  const el = document.getElementById('swtKeyPhrases');
  if (!el) return;
  const guide = passage.studyGuide || {};
  const items = Array.isArray(guide.items) ? guide.items : Object.entries(passage.keyElements || {})
    .filter(([, idea]) => typeof idea === 'string' && idea.trim())
    .map(([, idea]) => ({ label: 'Key idea', phrases: [], idea }));
  el.innerHTML = (guide.overview ? '<p class="swt-help">' + escapeHtml(guide.overview) + '</p>' : '') +
    (items.length ? '<ul class="swt-key-grid">' + items.map(item =>
      '<li><h3>' + escapeHtml(item.label || 'Key idea') + '</h3>' +
      '<div class="swt-key-phrases">' + (Array.isArray(item.phrases) ? item.phrases : [])
        .map(phrase => '<q>' + escapeHtml(phrase) + '</q>').join('') + '</div>' +
      '<p>' + escapeHtml(item.idea || '') + '</p></li>').join('') + '</ul>'
      : '<p>Identify what the passage mainly says, then choose one or two supporting ideas that explain it.</p>') +
    (guide.connection ? '<p class="swt-connections"><strong>How the ideas connect:</strong> ' +
      escapeHtml(guide.connection) + '</p>' : '');
}

async function checkSwtSample(passage){
  const key = JSON.stringify([passage.id, passage.text, passage.sampleResponse]);
  const cached = swtSampleChecks.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70000);
    try {
      const response = await fetch(API_URL + '/api/swt/sample/' + encodeURIComponent(passage.id),
        { method: 'POST', signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !['verified', 'needs_revision'].includes(result.status)) {
        swtSampleChecks.delete(key);
        return { status: 'unavailable', note: result.note || 'Sample checking is temporarily unavailable. This example is not verified as full-mark.' };
      }
      return result;
    } catch (error) {
      swtSampleChecks.delete(key);
      return { status: 'unavailable', note: 'Sample checking is temporarily unavailable. This example is not verified as full-mark.' };
    } finally {
      clearTimeout(timer);
    }
  })();
  swtSampleChecks.set(key, { promise, expires: Date.now() + 10 * 60 * 1000 });
  return promise;
}

async function refreshSwtSample(passage){
  const note = document.getElementById('sampleAnswerNotes');
  if (!note) return;
  note.textContent = 'Checking this sample against the current scoring rubric…';
  note.dataset.status = 'checking';
  note.setAttribute('aria-busy', 'true');
  const result = await checkSwtSample(passage);
  if (swtResultPassage !== passage) return;
  const sample = document.getElementById('sampleAnswerText');
  if (sample && result.sample) sample.textContent = result.sample;
  note.textContent = result.note;
  note.dataset.status = result.status;
  note.setAttribute('aria-busy', 'false');
}

function annotateGrammar(clause, issues){
  if(!issues || issues.length === 0) return escapeHtml(clause);
  const sorted = [...issues].sort((a,b) => (b.phrase||'').length - (a.phrase||'').length);
  let result = escapeHtml(clause);
  const lowerClause = clause.toLowerCase();
  const insertions = [];
  const claimed = new Array(clause.length).fill(false);
  for(const issue of sorted){
    if(!issue.phrase) continue;
    const needle = issue.phrase.toLowerCase();
    let pos = 0;
    while(pos < lowerClause.length){
      const idx = lowerClause.indexOf(needle, pos);
      if(idx < 0) break;
      let conflict = false;
      for(let i = idx; i < idx + needle.length; i++){ if(claimed[i]){ conflict = true; break; } }
      if(!conflict){
        for(let i = idx; i < idx + needle.length; i++) claimed[i] = true;
        const sev = issue.affects_score === false ? 'grammar-minor swt-optional' : (issue.severity === 'major' ? 'grammar-major' : 'grammar-minor');
        const tipParts = [];
        if(issue.fix) tipParts.push('→ ' + issue.fix);
        if(issue.meaning_effect) tipParts.push(issue.meaning_effect);
        if(issue.rationale) tipParts.push(issue.rationale);
        insertions.push({
          start: idx, end: idx + needle.length, sev,
          tip: tipParts.join('  '),
          fix: issue.fix || '',
          rationale: issue.rationale || ''
        });
      }
      pos = idx + needle.length;
    }
  }
  insertions.sort((a,b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  const attrEscape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  for(const ins of insertions){
    out += escapeHtml(clause.slice(cursor, ins.start));
    out += `<span class="ann-seg ${ins.sev}" title="${attrEscape(ins.tip)}" data-fix="${attrEscape(ins.fix)}" data-rationale="${attrEscape(ins.rationale)}">${escapeHtml(clause.slice(ins.start, ins.end))}</span>`;
    cursor = ins.end;
  }
  out += escapeHtml(clause.slice(cursor));
  return out;
}

(function setupGrammarPopovers(){
  const open = new Set();

  function closePopover(pop){
    if(!pop) return;
    pop.classList.add('gp-closing');
    setTimeout(() => { if(pop.parentNode) pop.parentNode.removeChild(pop); }, 120);
    open.delete(pop);
  }

  function closeAll(){
    [...open].forEach(closePopover);
  }

  function buildPopover(target){
    const fix = target.getAttribute('data-fix') || '';
    const rationale = target.getAttribute('data-rationale') || '';
    if(!fix && !rationale) return null;

    const pop = document.createElement('div');
    pop.className = 'gp-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Grammar feedback');

    const close = document.createElement('button');
    close.className = 'gp-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); closePopover(pop); });
    pop.appendChild(close);

    if(fix){
      const fixEl = document.createElement('div');
      fixEl.className = 'gp-fix';
      const arrow = document.createElement('span');
      arrow.className = 'gp-arrow';
      arrow.textContent = '→';
      fixEl.appendChild(arrow);
      fixEl.appendChild(document.createTextNode(' ' + fix));
      pop.appendChild(fixEl);
    }

    if(rationale){
      const ratEl = document.createElement('div');
      ratEl.className = 'gp-rationale';
      ratEl.textContent = rationale;
      pop.appendChild(ratEl);
    }

    return pop;
  }

  function positionPopover(pop, target){
    document.body.appendChild(pop);
    const rect = target.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const margin = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;

    let top = rect.bottom + scrollY + margin;
    let left = rect.left + scrollX;

    if(rect.bottom + popRect.height + margin > vh){
      top = rect.top + scrollY - popRect.height - margin;
    }
    if(left + popRect.width > scrollX + vw - 12){
      left = scrollX + vw - popRect.width - 12;
    }
    if(left < scrollX + 8) left = scrollX + 8;

    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  document.addEventListener('click', (e) => {
    const target = e.target.closest('.ann-seg.grammar-major, .ann-seg.grammar-minor');
    if(target){
      e.stopPropagation();
      for(const pop of open){
        if(pop._target === target){ closePopover(pop); return; }
      }
      closeAll();
      const pop = buildPopover(target);
      if(!pop) return;
      pop._target = target;
      positionPopover(pop, target);
      open.add(pop);
      requestAnimationFrame(() => { pop.classList.add('gp-shown'); });
      return;
    }
    if(open.size > 0){
      const inside = e.target.closest('.gp-popover');
      if(!inside) closeAll();
    }
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && open.size > 0){ closeAll(); }
  });

  window.addEventListener('scroll', () => {
    for(const pop of open){ if(pop._target) positionPopover(pop, pop._target); }
  }, { passive: true });
  window.addEventListener('resize', () => {
    for(const pop of open){ if(pop._target) positionPopover(pop, pop._target); }
  });
})();

function annotateSpelling(clauseOrHtml, spellWords, alreadyHtml){
  if(Object.keys(spellWords).length === 0) return alreadyHtml ? clauseOrHtml : escapeHtml(clauseOrHtml);
  if(!alreadyHtml){
    const parts = clauseOrHtml.split(/(\s+|[.,;:!?"'()])/);
    return parts.map(tok => {
      const stripped = tok.toLowerCase().replace(/[^a-z']/g,'');
      if(stripped && spellWords[stripped] !== undefined){
        const fix = spellWords[stripped];
        return `<span class="ann-seg spell" title="${escapeHtml(fix ? 'Suggested: ' + fix : 'Possible misspelling')}">${escapeHtml(tok)}</span>`;
      }
      return escapeHtml(tok);
    }).join('');
  }
  const parts = clauseOrHtml.split(/(<span[^>]*>[\s\S]*?<\/span>)/);
  return parts.map(p => {
    if(p.startsWith('<span')) return p;
    if(!p) return p;
    const tokParts = p.split(/(\s+|[.,;:!?"'()]|&[a-z]+;)/);
    return tokParts.map(tok => {
      if(tok.startsWith('&') && tok.endsWith(';')) return tok;
      const stripped = tok.toLowerCase().replace(/[^a-z']/g,'');
      if(stripped && spellWords[stripped] !== undefined){
        const fix = spellWords[stripped];
        return `<span class="ann-seg spell" title="${escapeHtml(fix ? 'Suggested: ' + fix : 'Possible misspelling')}">${tok}</span>`;
      }
      return tok;
    }).join('');
  }).join('');
}

function switchSbsView(view){
  const isSample = (view === 'sample');
  const vSum = document.getElementById('sbsViewSummary');
  const vSam = document.getElementById('sbsViewSample');
  const tSum = document.getElementById('sbsTabSummary');
  const tSam = document.getElementById('sbsTabSample');
  if(!vSum || !vSam || !tSum || !tSam) return;
  vSum.style.display = isSample ? 'none' : '';
  vSam.style.display = isSample ? '' : 'none';
  tSum.classList.toggle('active', !isSample);
  tSam.classList.toggle('active', isSample);
  tSum.setAttribute('aria-selected', String(!isSample));
  tSam.setAttribute('aria-selected', String(isSample));
  tSum.tabIndex = isSample ? -1 : 0;
  tSam.tabIndex = isSample ? 0 : -1;
  if (isSample && swtResultPassage) refreshSwtSample(swtResultPassage);
}

function renderTraitBreakdown(data, traits){
  const el = document.getElementById('traitBreakdown');
  if (!el) return;
  const cMax = traits.content_max || 4;
  const cd = data.content_details || {};
  const concise = value => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= 260) return text;
    const cut = text.slice(0, 245).replace(/\s+\S*$/, '').trim();
    return (cut || text.slice(0, 245).trim()) + '… Read the next step for details.';
  };
  const contentNote = concise(cd.feedback_note || cd.notes || 'Strengthen the main idea and its supporting connections.');

  const rows = [
    { name:'Content', score:traits.content||0, max:cMax,
      note: data.score_provisional || data.ai_feedback_degraded ? 'Provisional: meaning and connections need a complete assessment.'
        : (traits.content >= cMax) ? 'Main message, relevant support and conclusion connect clearly.' : contentNote },
    { name:'Form', score:traits.form||0, max:1,
      note: (traits.form >= 1) ? 'Valid one-sentence summary within word limits.' : 'Form requirement not met — one sentence, 5–75 words.' },
    { name:'Grammar', score:traits.grammar||0, max:2,
      note: data.score_provisional || data.ai_feedback_degraded ? 'Provisional: detailed grammar assessment unavailable.'
        : (traits.grammar >= 2) ? 'Meaning remains clear. Minor slips are optional refinements.' : 'Review the grammar affecting meaning in your next steps above.' },
    { name:'Vocabulary', score:traits.vocabulary||0, max:2,
      note: data.score_provisional || data.ai_feedback_degraded ? 'Provisional: detailed vocabulary assessment unavailable.'
        : (traits.vocabulary >= 2) ? 'Wording preserves the message. Accurate source words are welcome.' : 'Review the wording affecting meaning in your next steps above.' }
  ];

  el.innerHTML = rows.map(r => {
    const pct = r.max > 0 ? Math.min(100, (r.score / r.max) * 100) : 0;
    let barColor = 'var(--swt-good)';
    if(pct < 100) barColor = 'var(--swt-warn)';
    return `
      <div class="trait-row">
        <div class="trait-head">
          <span class="trait-name">${r.name}</span>
          <span class="trait-score"><b>${fmtNum(r.score)}</b> / ${r.max}</span>
        </div>
        <div class="trait-bar"><div class="trait-bar-fill" style="width:${pct}%;background:${barColor};"></div></div>
        <div class="trait-note">${escapeHtml(r.note)}</div>
      </div>`;
  }).join('');
}

function renderCoverage(data, passage){
  const el = document.getElementById('coverageTable');
  if (!el) return;
  const keyEls = passage.keyElements || {};
  const cd = data.content_details || {};
  const assessment = cd.summary_assessment || {};
  const captured = new Set(cd.key_ideas_present || []);
  const missing = new Set(cd.key_ideas_missing || []);

  const labels = keyEls.topic || keyEls.pivot || keyEls.conclusion
    ? [['topic','Main idea'],['pivot','Support'],['conclusion','Conclusion']]
    : [['what','Main idea'],['why','Reason'],['how','Support'],['result','Result']];
  const semantic = new Set();
  const mainKey = labels.some(([k]) => k === 'what') ? 'what' : 'topic';
  const conclusionKey = labels.some(([k]) => k === 'result') ? 'result' : 'conclusion';
  if (assessment.main_idea_accurate === true && keyEls[mainKey]) semantic.add(mainKey);
  if (['captured', 'clearly_implied', 'not_applicable'].includes(assessment.conclusion_status)
      && keyEls[conclusionKey]) semantic.add(conclusionKey);

  // The semantic judge may describe a support proposition without using the
  // passage's checklist label. Map it to the closest support row for display;
  // this keeps the table consistent with the explanation and avoids showing
  // every row as “Not selected” when the summary clearly contains support.
  const evidence = Array.isArray(assessment.supporting_evidence)
    ? assessment.supporting_evidence.filter(v => typeof v === 'string' && v.trim()) : [];
  const supportKeys = labels.map(([k]) => k)
    .filter(k => ![mainKey, conclusionKey].includes(k) && keyEls[k]);
  const tokens = value => String(value || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const stop = new Set(['that','this','with','from','into','than','their','they','have','been','will','which','also','more','such','what','where','when']);
  const overlap = (a, b) => {
    const left = new Set(tokens(a).filter(t => !stop.has(t)));
    const right = new Set(tokens(b).filter(t => !stop.has(t)));
    let hits = 0;
    left.forEach(t => { if (right.has(t)) hits += 1; });
    return hits;
  };
  evidence.forEach((item, index) => {
    let best = '', bestHits = 0;
    supportKeys.forEach(k => {
      if (semantic.has(k)) return;
      const hits = overlap(item, keyEls[k]);
      if (hits > bestHits) { best = k; bestHits = hits; }
    });
    if (best && bestHits >= 1) semantic.add(best);
    else if (supportKeys[index] && !semantic.has(supportKeys[index])) semantic.add(supportKeys[index]);
  });

  el.innerHTML = labels.filter(([k]) => keyEls[k]).map(([k, label]) => {
    let status, statusCls;
    if(captured.has(k) || semantic.has(k)){ status = 'Included'; statusCls = 'covered'; }
    else if(missing.has(k)){ status = 'Not selected'; statusCls = 'partial'; }
    else { status = 'Review'; statusCls = 'partial'; }
    const txt = String(keyEls[k] || '').replace(/<[^>]+>/g,'');
    return `
      <div class="coverage-row">
        <div class="cov-key"><span class="cov-dot ${k}"></span>${label.toUpperCase()}</div>
        <div class="cov-text">${escapeHtml(txt)}</div>
        <div class="cov-status ${statusCls}" title="${status === 'Included' ? 'This proposition is represented in the summary.' : status === 'Not selected' ? 'This idea was not identified in the summary.' : 'The assessment did not map this checklist row with certainty.'}">${status}</div>
      </div>`;
  }).join('');
}

function renderAboutPassage(passage){
  const card = document.getElementById('aboutPassageCard');
  const body = document.getElementById('aboutPassageBody');
  if(!card || !body || !passage){ return; }

  const r = passage.keyElementsRationale || {};
  const topic = r.topic || generateTopicFallback(passage);
  const importance = r.importance || generateImportanceFallback(passage);
  const elementsExplained = r.elements || generateElementsFallback(passage);

  const sections = [];
  sections.push(`
    <div class="about-section">
      <div class="about-eyebrow">📖 What this passage is about</div>
      <p>${escapeHtml(topic)}</p>
    </div>`);
  sections.push(`
    <div class="about-section">
      <div class="about-eyebrow">🎯 How the diagnostic ideas support the passage</div>
      <p>${escapeHtml(importance)}</p>
    </div>`);
  if(elementsExplained && Object.keys(elementsExplained).length){
    const order = [['what','What','what'],['why','Why','why'],['how','How','how'],['result','Result','result']];
    sections.push(`
      <div class="about-section">
        <div class="about-eyebrow">🧩 What each diagnostic element represents</div>
        ${order.filter(([k]) => elementsExplained[k]).map(([k,label,cls]) => `
          <p><strong style="display:inline-flex;align-items:center;gap:6px;">
            <span class="e-dot" style="background:var(--${cls});display:inline-block;width:9px;height:9px;border-radius:2px;"></span>${label}:
          </strong> ${escapeHtml(elementsExplained[k])}</p>
        `).join('')}
      </div>`);
  }
  body.innerHTML = sections.join('');
  card.style.display = 'block';
}

function generateTopicFallback(passage){
  const title = passage.title || 'this passage';
  const cat = passage.category ? ' (' + passage.category + ')' : '';
  return `This passage covers ${title}${cat}. It presents a topic, supporting evidence or reasoning, and a result or implication.`;
}
function generateImportanceFallback(passage){
  const keys = passage.keyElements || {};
  const count = ['what','why','how','result'].filter(k => keys[k]).length;
  return `These ${count} diagnostic headlines help identify the passage structure, but a strong summary does not always need to state every one of them.`;
}
function generateElementsFallback(passage){
  const keys = passage.keyElements || {};
  const out = {};
  if(keys.what)   out.what   = 'States the central claim or topic.';
  if(keys.why)    out.why    = 'Supplies the reason or evidence that makes the claim credible.';
  if(keys.how)    out.how    = 'Describes the mechanism or process.';
  if(keys.result) out.result = 'Captures the consequence or implication.';
  return out;
}

function renderVocabCoach(data){
  const card = document.getElementById('vocabCoachCard');
  const body = document.getElementById('vocabCoachBody');
  if(!card || !body) return;

  // Gather raw suggestions, prioritizing Claude's context-aware suggestions if present
  let rawSuggestions = [];
  if (data) {
    if (Array.isArray(data.vocabulary_swap_suggestions) && data.vocabulary_swap_suggestions.length > 0) {
      rawSuggestions = data.vocabulary_swap_suggestions;
    } else if (Array.isArray(data.vocabulary_suggestions) && data.vocabulary_suggestions.length > 0) {
      rawSuggestions = data.vocabulary_suggestions;
    }
  }

  // Normalize suggestions to { word, context, synonyms, rationale }
  const suggestions = rawSuggestions.map(s => {
    if (s.original && s.upgrades) {
      return {
        word: s.original,
        context: '',
        synonyms: s.upgrades,
        rationale: 'Local thesaurus upgrade recommendation.'
      };
    }
    return s;
  }).filter(s => s && s.word && Array.isArray(s.synonyms) && s.synonyms.filter(Boolean).length > 0);

  if(!suggestions.length){
    card.style.display = 'none';
    body.innerHTML = '';
    return;
  }

  body.innerHTML = suggestions.map(s => {
    const word = s.word || '';
    const context = s.context || '';
    const syns = s.synonyms.filter(Boolean);
    const rationale = s.rationale || '';
    let highlightedContext = context;
    if(context && word){
      const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      highlightedContext = escapeHtml(context).replace(re, m => '<b>' + m + '</b>');
    }
    return `
      <div class="vocab-row">
        <div class="vocab-original">
          <div class="vocab-word">${escapeHtml(word)}</div>
          ${context ? '<div class="vocab-context">in: "' + highlightedContext + '"</div>' : ''}
        </div>
        <div class="vocab-arrow">→</div>
        <div class="vocab-syns">
          ${syns.map(syn => '<button type="button" class="vocab-chip" data-swt-word="' + escapeHtml(word) + '" data-swt-replacement="' + escapeHtml(syn) + '">' + escapeHtml(syn) + '</button>').join('')}
        </div>
        ${rationale ? '<div class="vocab-rationale"><b>Why:</b> ' + escapeHtml(rationale) + '</div>' : ''}
      </div>`;
  }).join('');
  card.style.display = 'block';
}

function applyVocabSwap(original, replacement){
  const ta = document.getElementById('summaryInput');
  if(!ta){ toast('Summary not available.'); return; }
  const re = new RegExp('\\b' + original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  const match = ta.value.match(re);
  if(!match){ toast('"' + original + '" is no longer in your summary.'); return; }
  let repl = replacement;
  if(match[0][0] === match[0][0].toUpperCase()){
    repl = replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  ta.value = ta.value.replace(re, () => repl);
  onSummaryInput();
  const summaries = LocalStore.get(getPteStorageKey('summaries')) || {};
  summaries[currentPassageId] = { text: ta.value, timestamp: new Date().toISOString(), score: (summaries[currentPassageId]||{}).score || 0 };
  LocalStore.set(getPteStorageKey('summaries'), summaries);
  toast('"' + original + '" → "' + repl + '" — re-score to see the new score.');
}

async function showSample(){
  const p = passages.find(x => x.id === currentPassageId);
  if(!p || !p.sampleResponse){ toast('No sample available for this passage.'); return; }
  const passageId = currentPassageId;
  toast('Checking the sample…');
  const result = await checkSwtSample(p);
  if (currentPassageId !== passageId) return;
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.value = result.sample || p.sampleResponse;
  showSwtScreen('swtPracticeScreen');
  switchWriteTab('write');
  onSummaryInput();
  toast(result.status === 'verified' ? 'Checked sample loaded — assessed with the same rubric.' : 'Example loaded — it is not verified as full-mark.');
}

function backToPractice(){
  loadPassage(currentPassageId);
  showSwtScreen('swtPracticeScreen');
  switchWriteTab('write');
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.focus();
}

function navResultsPassage(delta){
  const target = currentPassageId + delta;
  if(target < 1 || target > passages.length) return;
  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  const p = passages.find(x => x.id === target) || passages[target-1];
  if(!p) return;
  if(scores[target] && typeof scores[target].overall_score === 'number'){
    currentPassageId = target;
    updateResultsNav();
    showResults(scores[target], p, scores[target].__spellData || null, scores[target].__text || '');
  } else {
    loadPassage(target);
    showSwtScreen('swtPracticeScreen');
  }
}

function goToNextPassage(){
  if(currentPassageId >= passages.length){ toast('You\'re on the last passage.'); return; }
  loadPassage(currentPassageId + 1);
  showSwtScreen('swtPracticeScreen');
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.focus();
}

function updateResultsNav(){
  const cur = document.getElementById('resNavCurrent');
  const tot = document.getElementById('resNavTotal');
  const prev = document.getElementById('resNavPrev');
  const next = document.getElementById('resNavNext');
  const nextBtn = document.getElementById('nextPassageBtn');
  if(cur) cur.textContent = String(currentPassageId).padStart(2,'0');
  if(tot) tot.textContent = passages.length;
  if(prev) prev.toggleAttribute('disabled', currentPassageId === 1);
  if(next) next.toggleAttribute('disabled', currentPassageId === passages.length);
  if(nextBtn) nextBtn.style.display = (currentPassageId === passages.length) ? 'none' : 'inline-flex';
  const select = document.getElementById('resPassageSelect');
  if(select) select.value = currentPassageId;
}

// Keyboard listeners for SWT
document.addEventListener('keydown', function(e){
  if((e.metaKey || e.ctrlKey) && e.key === 'Enter'){
    const swtPane = document.getElementById('swtPane');
    const swtPractice = document.getElementById('swtPracticeScreen');
    if (swtPane && swtPane.classList.contains('active') && swtPractice && swtPractice.classList.contains('active') && writeTab === 'write') {
      e.preventDefault();
      scoreSummary();
    }
  }
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  const typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
  const resultsActive = document.getElementById('swtResultsScreen') && document.getElementById('swtResultsScreen').classList.contains('active');
  if(resultsActive && !typing){
    if(e.key === 'Escape'){ e.preventDefault(); if(typeof backToPractice === 'function') backToPractice(); }
    else if(e.key === 'ArrowLeft'){ if(typeof navResultsPassage === 'function' && currentPassageId > 1){ e.preventDefault(); navResultsPassage(-1); } }
    else if(e.key === 'ArrowRight'){ if(typeof navResultsPassage === 'function' && currentPassageId < passages.length){ e.preventDefault(); navResultsPassage(1); } }
  }
});

// Vocab extra admin aliases
function adminAddVocabWord() {
  openAddWord();
}
function loadAdminVocab() {
  populateAdminVocabCategorySelect();
  renderAdminVocabList();
}

// SWT Passage Admin CRUD
async function loadAdminPassages() {
  const list = document.getElementById('adminPassageList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px; font-style:italic; font-family:var(--serif);">Loading passages...</div>';
  try {
    const r = await fetch(API_URL + '/api/admin/passages', {
      headers: { 'x-admin-key': adminKey }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to load');
    renderAdminPassages(d.passages || []);
  } catch (err) {
    list.innerHTML = `<div style="text-align:center; color:red; padding:24px;">Failed to load passages: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminPassages(passagesList) {
  const list = document.getElementById('adminPassageList');
  if (!list) return;
  if (!passagesList.length) {
    list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px;">No passages in database.</div>';
    return;
  }
  list.innerHTML = passagesList.map(p => `
    <div class="passage-row" style="display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--line);">
      <div class="pid" style="font-weight:700; width:30px;">#${p.id}</div>
      <div class="pinfo" style="flex:1;">
        <div class="ptitle" style="font-weight:600; font-size:14px;">${escapeHtml(p.title || 'Untitled')}</div>
        <div class="pcat" style="font-size:11.5px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(p.category || 'General')} · ${(p.text || '').split(/\s+/).filter(Boolean).length} words</div>
      </div>
      <div class="pactions" style="display:flex; gap:6px;">
        <button class="tb-text-btn" onclick="adminEditPassage(${p.id})" style="font-size:12px; padding:4px 10px;">Edit</button>
        <button class="tb-text-btn" onclick="adminDeletePassage(${p.id})" style="font-size:12px; padding:4px 10px; color:var(--accent);">Delete</button>
      </div>
    </div>
  `).join('');
}

function adminAddPassage() {
  discardDraft();

  document.getElementById('peId').value = '';
  document.getElementById('peTitle').value = '';
  document.getElementById('peCategory').value = '';
  document.getElementById('peText').value = '';

  document.getElementById('peWhat').value = '';
  document.getElementById('peWhy').value = '';
  document.getElementById('peHow').value = '';
  document.getElementById('peResult').value = '';
  setEditorFramework('wwhr');

  document.getElementById('peRatTopic').value = '';
  document.getElementById('peRatImportance').value = '';

  document.getElementById('peSampleResponse').value = '';
  document.getElementById('peSampleNotes').value = '';

  document.getElementById('passageEditModal').dataset.extractionMeta = '';

  document.getElementById('passageEditTitle').textContent = 'Add New Passage';
  document.getElementById('passageEditModal').classList.add('show');
}

function adminEditPassage(id) {
  const p = passages.find(x => x.id === id);
  if (!p) { toast('Passage not found', true); return; }

  discardDraft();

  document.getElementById('peId').value = p.id;
  document.getElementById('peTitle').value = p.title || '';
  document.getElementById('peCategory').value = p.category || '';
  document.getElementById('peText').value = p.text || '';

  const ke = p.keyElements || {};
  const isTpc = (p.extractionMeta && p.extractionMeta.framework === 'tpc');
  if (isTpc) {
    document.getElementById('peWhat').value   = ke.topic || '';
    document.getElementById('peWhy').value    = ke.pivot || '';
    document.getElementById('peResult').value = ke.conclusion || '';
    document.getElementById('peHow').value    = '';
    setEditorFramework('tpc');
  } else {
    document.getElementById('peWhat').value   = ke.what || '';
    document.getElementById('peWhy').value    = ke.why || '';
    document.getElementById('peHow').value    = ke.how || '';
    document.getElementById('peResult').value = ke.result || '';
    setEditorFramework('wwhr');
  }

  const rat = p.keyElementsRationale || {};
  document.getElementById('peRatTopic').value = rat.topic || '';
  document.getElementById('peRatImportance').value = rat.importance || '';

  document.getElementById('peSampleResponse').value = p.sampleResponse || '';
  document.getElementById('peSampleNotes').value = p.sampleNotes || '';

  document.getElementById('passageEditModal').dataset.extractionMeta =
    JSON.stringify(p.extractionMeta || {});

  document.getElementById('passageEditTitle').textContent = `Edit Passage #${p.id}`;
  document.getElementById('passageEditModal').classList.add('show');
}

function closePassageEdit() {
  document.getElementById('passageEditModal').classList.remove('show');
}

async function savePassageEdit() {
  const id = document.getElementById('peId').value;
  const title = document.getElementById('peTitle').value.trim();
  const category = document.getElementById('peCategory').value.trim();
  const text = document.getElementById('peText').value.trim();

  if (!title || !text) { toast('Title and text are required', true); return; }

  const fw = document.getElementById('passageEditModal').dataset.editorFramework || 'wwhr';
  const ke = {};
  if (fw === 'tpc') {
    ke.topic = document.getElementById('peWhat').value.trim();
    ke.pivot = document.getElementById('peWhy').value.trim();
    ke.conclusion = document.getElementById('peResult').value.trim();
  } else {
    ke.what = document.getElementById('peWhat').value.trim();
    ke.why = document.getElementById('peWhy').value.trim();
    ke.how = document.getElementById('peHow').value.trim();
    ke.result = document.getElementById('peResult').value.trim();
  }

  const pObj = {
    title,
    category,
    text,
    keyElements: ke,
    keyElementsRationale: {
      topic: document.getElementById('peRatTopic').value.trim(),
      importance: document.getElementById('peRatImportance').value.trim()
    },
    sampleResponse: document.getElementById('peSampleResponse').value.trim(),
    sampleNotes: document.getElementById('peSampleNotes').value.trim()
  };

  if (id) pObj.id = Number(id);

  const metaStr = document.getElementById('passageEditModal').dataset.extractionMeta;
  if (metaStr) {
    try { pObj.extractionMeta = JSON.parse(metaStr); } catch(e){}
  } else if (fw) {
    pObj.extractionMeta = { framework: fw };
  }

  try {
    const r = await fetch(API_URL + '/api/admin/passages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify(pObj)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Save failed');
    toast('Passage saved successfully ✓');
    closePassageEdit();
    await loadPassages();
    await loadAdminPassages();
  } catch (err) {
    toast('Failed to save passage: ' + err.message, true);
  }
}

async function adminDeletePassage(id) {
  if (!confirm(`Delete passage #${id}? This action cannot be undone.`)) return;
  try {
    const r = await fetch(API_URL + `/api/admin/passages/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Delete failed');
    toast('Passage deleted ✓');
    await loadPassages();
    await loadAdminPassages();
  } catch (err) {
    toast('Delete failed: ' + err.message, true);
  }
}

// AI auto-extraction logic
let currentDraft = null;
async function runExtraction() {
  const btn = document.getElementById('extractBtn');
  const draftBox = document.getElementById('extractDraft');
  const text = document.getElementById('peText').value.trim();
  const title = document.getElementById('peTitle').value.trim();

  if (!text || text.length < 40) {
    draftBox.style.display = 'block';
    draftBox.innerHTML = '<div class="draft-low-warn">Add the passage text first (at least 40 characters), then auto-extract.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = '✨ Extracting…';
  draftBox.style.display = 'block';
  draftBox.innerHTML = '<div class="draft-reason">Claude is reading the passage and drafting key elements…</div>';

  try {
    const r = await fetch(API_URL + '/api/admin/passages/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ text, title })
    });
    const d = await r.json();
    if (!r.ok || !d.success) {
      draftBox.innerHTML = '<div class="draft-low-warn">Extraction failed: ' +
        escapeHtml(d.error || ('HTTP ' + r.status)) + '</div>';
      return;
    }
    currentDraft = d.draft;
    renderDraft(d.draft);
  } catch (e) {
    draftBox.innerHTML = '<div class="draft-low-warn">Network error: ' + escapeHtml(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Auto-extract with AI';
  }
}

function renderDraft(draft) {
  const box = document.getElementById('extractDraft');
  const fw = draft.framework === 'tpc' ? 'Topic / Pivot / Conclusion' : 'What / Why / How / Result';
  const conf = draft.confidence || 'medium';
  const ke = draft.keyElements || {};
  const rat = draft.keyElementsRationale || {};
  const ratEls = rat.elements || {};

  const order = draft.framework === 'tpc'
    ? [['topic','Topic'],['pivot','Pivot'],['conclusion','Conclusion']]
    : [['what','What'],['why','Why'],['how','How'],['result','Result']];

  const warnings = Array.isArray(draft.warnings) ? draft.warnings : [];
  const warnedSlots = {};
  warnings.forEach(w => { warnedSlots[w.element] = w.issue; });

  const elsHtml = order.filter(([k]) => ke[k]).map(([k, label]) => `
    <div class="draft-el${warnedSlots[k] ? ' draft-el-warn' : ''}">
      <span class="del-key">${label}</span>${escapeHtml(ke[k])}
      ${ratEls[k] ? '<span class="del-rationale">↳ ' + escapeHtml(ratEls[k]) + '</span>' : ''}
      ${warnedSlots[k] ? '<span class="del-warn">⚠ ' + escapeHtml(warnedSlots[k]) + '</span>' : ''}
    </div>`).join('');

  const lowWarn = conf === 'low'
    ? '<div class="draft-low-warn">⚠ Low confidence — this passage\'s structure is genuinely ambiguous. Review the key elements carefully before applying.</div>'
    : '';

  const exampleWarn = warnings.length
    ? '<div class="draft-low-warn">⚠ ' + warnings.length + ' key element' +
      (warnings.length > 1 ? 's' : '') + ' may have captured an EXAMPLE rather than the ' +
      'general idea (highlighted below). A key idea should state the principle, not the ' +
      'specific case — edit these before applying so students aren\'t marked wrong for ' +
      'summarising the principle without naming the example.</div>'
    : '';

  box.style.display = 'block';
  box.innerHTML = `
    <div class="extract-draft-head" style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
      <span class="extract-draft-title" style="font-weight:700;">AI Draft — review before applying</span>
      <span class="draft-badge fw" style="font-size:10px; padding:2px 6px; background:var(--accent-soft); color:var(--accent);">${fw}</span>
      <span class="draft-badge conf-${conf}">${conf} confidence</span>
    </div>
    ${draft.framework_reason ? '<div class="draft-reason">' + escapeHtml(draft.framework_reason) + '</div>' : ''}
    ${lowWarn}
    ${exampleWarn}
    <div class="draft-elements">${elsHtml}</div>
    <div class="draft-actions" style="display:flex; gap:6px; margin-top:8px;">
      <button type="button" class="tb-text-btn dark" onclick="applyDraft()">Apply to fields</button>
      <button type="button" class="tb-text-btn" onclick="discardDraft()">Discard</button>
    </div>`;
}

function applyDraft() {
  if (!currentDraft) return;
  const ke = currentDraft.keyElements || {};
  const rat = currentDraft.keyElementsRationale || {};

  if (currentDraft.framework === 'tpc') {
    document.getElementById('peWhat').value   = ke.topic || '';
    document.getElementById('peWhy').value    = ke.pivot || '';
    document.getElementById('peResult').value = ke.conclusion || '';
    document.getElementById('peHow').value    = '';
    setEditorFramework('tpc');
  } else {
    document.getElementById('peWhat').value   = ke.what || '';
    document.getElementById('peWhy').value    = ke.why || '';
    document.getElementById('peHow').value    = ke.how || '';
    document.getElementById('peResult').value = ke.result || '';
    setEditorFramework('wwhr');
  }

  document.getElementById('peRatTopic').value = rat.topic || '';
  document.getElementById('peRatImportance').value = rat.importance || '';

  document.getElementById('passageEditModal').dataset.extractionMeta =
    JSON.stringify(currentDraft.extractionMeta || {});

  const box = document.getElementById('extractDraft');
  box.style.display = 'none';
}

function discardDraft() {
  currentDraft = null;
  const box = document.getElementById('extractDraft');
  box.style.display = 'none';
  box.innerHTML = '';
}

function setEditorFramework(fw) {
  const labels = fw === 'tpc'
    ? { what: 'Topic — what the passage is about',
        why: 'Pivot — the turn / counterpoint / shift',
        result: 'Conclusion — the resolution / takeaway' }
    : { what: 'What (Primary Subject)',
        why: 'Why (Motivation)',
        how: 'How (Action/Method)',
        result: 'Result (Outcome)' };
        
  ['what','why','how','result'].forEach(k => {
    const lbl = document.getElementById('lbl_' + k);
    if (labels[k]) {
      if (lbl) lbl.textContent = labels[k];
    }
  });
  const howField = document.getElementById('field_how');
  if (howField) howField.style.display = (fw === 'tpc') ? 'none' : '';
  document.getElementById('passageEditModal').dataset.editorFramework = fw;
}

// ============================================================
//  CUSTOM GLASSMORPHISM DASHBOARD & VOCABULARY ENGINE FUNCTIONS
// ============================================================

function localDateStamp(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function updateDashboardStreak() {
  const activeDates = new Set();
  
  // 1. Collect SWT history dates
  const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
  Object.keys(swtHistory).forEach(pid => {
    const list = swtHistory[pid];
    if (Array.isArray(list)) {
      list.forEach(att => {
        if (att.timestamp) {
          const stamp = localDateStamp(att.timestamp);
          if (stamp) activeDates.add(stamp);
        }
      });
    }
  });
  
  // 2. Collect Essay history dates
  const essayHistory = getPracticeHistory() || [];
  essayHistory.forEach(h => {
    if (h.date) {
      const stamp = localDateStamp(h.date);
      if (stamp) activeDates.add(stamp);
    }
  });
  
  const sortedDates = Array.from(activeDates).sort();
  
  // 3. Compute current streak
  let currentStreak = 0;
  const todayVal = new Date();
  const todayStr = formatDate(todayVal);
  const hasToday = activeDates.has(todayStr);
  
  let yesterdayVal = new Date();
  yesterdayVal.setDate(yesterdayVal.getDate() - 1);
  const yesterdayStr = formatDate(yesterdayVal);
  const hasYesterday = activeDates.has(yesterdayStr);
  
  if (hasToday || hasYesterday) {
    let curr = hasToday ? todayVal : yesterdayVal;
    while (true) {
      const currStr = formatDate(curr);
      if (activeDates.has(currStr)) {
        currentStreak++;
        curr.setDate(curr.getDate() - 1);
      } else {
        break;
      }
    }
  }
  
  // 4. Compute best streak
  let bestStreak = 0;
  if (sortedDates.length > 0) {
    let tempStreak = 1;
    bestStreak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = new Date(sortedDates[i - 1] + 'T12:00:00');
      const currDate = new Date(sortedDates[i] + 'T12:00:00');
      const diffTime = Math.abs(currDate - prevDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        tempStreak++;
      } else if (diffDays > 1) {
        tempStreak = 1;
      }
      if (tempStreak > bestStreak) {
        bestStreak = tempStreak;
      }
    }
  }
  if (currentStreak > bestStreak) {
    bestStreak = currentStreak;
  }
  
  // 5. Update DOM values
  const currEl = document.getElementById('dashStreakCurrent');
  const bestEl = document.getElementById('dashStreakBest');
  if (currEl) currEl.textContent = `${currentStreak} day${currentStreak === 1 ? '' : 's'}`;
  if (bestEl) bestEl.textContent = `${bestStreak} day${bestStreak === 1 ? '' : 's'}`;
  
  // 6. Draw 7-day grid ending with today
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const gridContainer = document.getElementById('dashStreakGrid');
  if (gridContainer) {
    let gridHtml = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = formatDate(d);
      const isToday = (i === 0);
      const isActive = activeDates.has(dStr);
      const label = isToday ? 'Today' : dayLabels[d.getDay()];
      
      gridHtml += `
        <div class="streak-day-cell ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}">
          <span class="day-name">${label}</span>
          <div class="day-dot"></div>
        </div>
      `;
    }
    gridContainer.innerHTML = gridHtml;
  }
}

// --- Analytics Chart Toggle & Generator ---
let currentDashboardChartMetric = 'swt';
function setDashboardChartMetric(metric) {
  currentDashboardChartMetric = metric;
  
  const swtBtn = document.getElementById('chartToggleSwt');
  const essayBtn = document.getElementById('chartToggleEssay');
  if (swtBtn) swtBtn.classList.toggle('active', metric === 'swt');
  if (essayBtn) essayBtn.classList.toggle('active', metric === 'essay');
  
  renderDashboardCharts(metric);
}

function renderDashboardCharts(metricType) {
  const svg = document.getElementById('analyticsSvg');
  if (!svg) return;
  
  let points = [];
  const maxScore = (metricType === 'swt') ? 90 : 26;
  
  if (metricType === 'swt') {
    const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
    const swtAttempts = [];
    Object.keys(swtHistory).forEach(pid => {
      const list = swtHistory[pid];
      if (Array.isArray(list)) {
        list.forEach(att => {
          if (att.timestamp && typeof att.overall_score === 'number') {
            const passage = passages.find(p => String(p.id) === String(pid));
            swtAttempts.push({
              title: passage ? passage.title : `Passage ${pid}`,
              score: att.overall_score,
              date: new Date(att.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
              timestamp: att.timestamp
            });
          }
        });
      }
    });
    swtAttempts.sort((a, b) => a.timestamp - b.timestamp);
    points = swtAttempts.slice(-10);
  } else {
    const essayHistory = getPracticeHistory() || [];
    const essayAttempts = [];
    essayHistory.forEach(h => {
      if (h.date && h.scores && typeof h.scores.total === 'number') {
        essayAttempts.push({
          title: h.questionTitle || 'Practice Essay',
          score: h.scores.total,
          date: new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          timestamp: new Date(h.date).getTime()
        });
      }
    });
    essayAttempts.sort((a, b) => a.timestamp - b.timestamp);
    points = essayAttempts.slice(-10);
  }
  
  // Clean dynamic content from previous renderings
  const previousPlotElements = svg.querySelectorAll('.chart-dynamic-el');
  previousPlotElements.forEach(el => el.remove());
  
  // Define coordinate bounds mapping for SVG (responsive layout based on SVG client dimensions)
  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 240;
  
  const padLeft = 45;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 35;
  
  function getY(val) {
    return padTop + (1 - val / maxScore) * (height - padTop - padBottom);
  }
  
  function getX(idx) {
    if (points.length <= 1) return width / 2;
    const maxSpacing = 100; // max px between points to prevent stretching
    const defaultSpacing = (width - padLeft - padRight) / (points.length - 1);
    const spacing = Math.min(defaultSpacing, maxSpacing);
    return padLeft + idx * spacing;
  }
  
  let gridHtml = '';
  
  // Draw standard horizontal grids
  const gridVals = (metricType === 'swt') ? [0, 30, 60, 90] : [0, 10, 20, 26];
  gridVals.forEach(g => {
    const yVal = getY(g);
    gridHtml += `
      <line class="chart-grid-line chart-dynamic-el" x1="${padLeft}" y1="${yVal}" x2="${width - padRight}" y2="${yVal}"></line>
      <text class="chart-grid-text chart-dynamic-el" x="${padLeft - 25}" y="${yVal + 4}">${g}</text>
    `;
  });
  
  if (points.length === 0) {
    gridHtml += `
      <text class="chart-dynamic-el" x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="var(--ink-mute)" font-weight="600" font-size="13px">
        No scored attempts found. Submit a practice task to compile trend analytics.
      </text>
    `;
    svg.insertAdjacentHTML('beforeend', gridHtml);
    return;
  }
  
  // Construct line and area paths
  const pathCoordinates = points.map((p, idx) => `${getX(idx)},${getY(p.score)}`).join(' ');
  const dLine = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.score)}`).join(' ');
  const dArea = `${dLine} L ${getX(points.length - 1)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`;
  
  gridHtml += `
    <path class="chart-path-area chart-dynamic-el" d="${dArea}"></path>
    <path class="chart-path-line chart-dynamic-el" d="${dLine}"></path>
  `;
  
  // Render points and labels
  points.forEach((p, idx) => {
    const cx = getX(idx);
    const cy = getY(p.score);
    const safeTitle = p.title.replace(/'/g, "\\'");
    const safeDate = p.date.replace(/'/g, "\\'");
    
    gridHtml += `
      <circle class="chart-point chart-dynamic-el" cx="${cx}" cy="${cy}" 
        onmouseover="showChartTooltip(${cx}, ${cy}, '${safeTitle}', ${p.score}, '${safeDate}', ${maxScore})" 
        onmouseout="hideChartTooltip()"></circle>
      <text class="chart-grid-text chart-dynamic-el" x="${cx}" y="${height - padBottom + 20}" text-anchor="middle">${p.date}</text>
    `;
  });
  
  svg.insertAdjacentHTML('beforeend', gridHtml);
}

// Debounced resize listener to redraw active chart responsively without stretching
let chartResizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(chartResizeTimeout);
  chartResizeTimeout = setTimeout(() => {
    const pane = document.getElementById('dashboardPane');
    if (pane && pane.classList.contains('active')) {
      const activeBtn = document.querySelector('.chart-toggle-btn.active');
      const metric = (activeBtn && activeBtn.id === 'chartToggleEssay') ? 'essay' : 'swt';
      renderDashboardCharts(metric);
    }
  }, 150);
});

function showChartTooltip(x, y, title, score, date, maxScore) {
  const tooltip = document.getElementById('chartTooltip');
  if (!tooltip) return;
  const svg = document.getElementById('analyticsSvg');
  const width = svg ? (svg.clientWidth || 800) : 800;
  const height = svg ? (svg.clientHeight || 240) : 240;
  
  const xPct = (x / width) * 100;
  const yPct = (y / height) * 100;
  
  tooltip.innerHTML = `
    <div style="font-weight:800; color:var(--accent); font-size:13px; margin-bottom:2px;">${score} / ${maxScore}</div>
    <div style="font-weight:700; max-width:180px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; color:var(--ink); font-size:11px;">${escapeHtml(title)}</div>
    <div style="font-size:9.5px; color:var(--ink-mute); margin-top:2px;">${date}</div>
  `;
  tooltip.style.left = `${xPct}%`;
  tooltip.style.top = `${yPct}%`;
  tooltip.classList.add('show');
}

function hideChartTooltip() {
  const tooltip = document.getElementById('chartTooltip');
  if (tooltip) tooltip.classList.remove('show');
}

// --- Daily Vocabulary Challenge Widget ---
let currentChallengeWordObj = null;
let challengeOffset = 0;

function updateDailyVocabChallenge() {
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push({ ...w, catId });
    }
  }
  
  if (allWords.length === 0) return;
  
  // Deterministic daily lookup index + custom offset
  const d = new Date();
  const baseIndex = d.getFullYear() * 365 + d.getMonth() * 31 + d.getDate();
  const dayIndex = (baseIndex + challengeOffset) % allWords.length;
  currentChallengeWordObj = allWords[dayIndex];
  
  const wordEl = document.getElementById('challengeWord');
  if (wordEl) wordEl.textContent = currentChallengeWordObj.word;
  
  const revealBtn = document.getElementById('challengeRevealBtn');
  if (revealBtn) revealBtn.style.display = 'inline-block';
  
  const defEl = document.getElementById('challengeDefinition');
  if (defEl) {
    defEl.style.display = 'none';
    const exHtml = currentChallengeWordObj.examples && currentChallengeWordObj.examples.length > 0 
      ? `<div class="challenge-example" style="margin-top: 8px; font-style: italic; border-left: 2px solid var(--accent); padding-left: 8px; color: var(--ink-soft);">"${escapeHtml(currentChallengeWordObj.examples[0])}"</div>`
      : '';
    const hubLinkHtml = `<div style="margin-top: 10px; font-size: 12px;">
      <a href="#" onclick="jumpToVocabWord('${currentChallengeWordObj.catId}', '${currentChallengeWordObj.word}'); return false;" style="color:var(--accent); font-weight:700; text-decoration:underline;">
        🔗 View & practice in Vocabulary Hub →
      </a>
    </div>`;
    defEl.innerHTML = `
      <div style="font-weight: 600; color: var(--ink);">(${escapeHtml(currentChallengeWordObj.pos)})</div>
      <div>${escapeHtml(currentChallengeWordObj.meaning)}</div>
      ${exHtml}
      ${hubLinkHtml}
    `;
  }
  
  const inputEl = document.getElementById('challengeInput');
  if (inputEl) inputEl.value = '';
  
  const fbEl = document.getElementById('challengeFeedback');
  if (fbEl) {
    fbEl.className = 'vocab-try-feedback';
    fbEl.innerHTML = '';
  }
}

function loadNextChallengeWord() {
  challengeOffset++;
  updateDailyVocabChallenge();
}

function revealChallengeWord() {
  const revealBtn = document.getElementById('challengeRevealBtn');
  if (revealBtn) revealBtn.style.display = 'none';
  const defEl = document.getElementById('challengeDefinition');
  if (defEl) defEl.style.display = 'block';
}

function checkChallengeSentence() {
  if (!currentChallengeWordObj) return;
  const input = document.getElementById('challengeInput');
  const fb = document.getElementById('challengeFeedback');
  if (!input || !fb) return;
  
  const text = (input.value || '').trim();
  if (!text) {
    fb.className = 'vocab-try-feedback show warn';
    fb.textContent = 'Write a sentence first.';
    return;
  }
  
  const word = currentChallengeWordObj.word;
  const stem = word.toLowerCase().replace(/(ation|isation|ing|ed|ies|es|s)$/, '').slice(0, Math.max(4, word.length - 3));
  const re = new RegExp(`\\b${stem}[a-z]*\\b`, 'i');
  
  if (!re.test(text)) {
    fb.className = 'vocab-try-feedback show warn';
    fb.innerHTML = `Hmm — I couldn't find <strong>"${escapeHtml(word)}"</strong> (or a form of it) in your sentence. Try again.`;
    return;
  }
  if (text.length < 15) {
    fb.className = 'vocab-try-feedback show warn';
    fb.textContent = 'Your sentence is very short. Try a sentence with more context.';
    return;
  }
  
  fb.className = 'vocab-try-feedback show ok';
  fb.innerHTML = `✓ Nice! You used <strong>"${escapeHtml(word)}"</strong>. Go to <a href="#" onclick="jumpToVocabWord('${currentChallengeWordObj.catId}', '${currentChallengeWordObj.word}'); return false;" style="color:var(--accent); font-weight:700; text-decoration:underline;">Vocabulary Hub</a> for deeper AI review.`;
}

// --- Smart Action Items Planner ---
function renderDashboardActionItems() {
  const container = document.getElementById('dashActionItems');
  if (!container) return;
  
  const actions = [];
  
  // 1. Next unattempted SWT passage
  const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
  const unattemptedSwt = passages.find(p => !swtHistory[p.id] || swtHistory[p.id].length === 0);
  if (unattemptedSwt) {
    actions.push({
      icon: '📝',
      title: `Practice SWT: ${unattemptedSwt.title}`,
      desc: 'Master summarizing complex academic texts in a single sentence.',
      action: `switchSection('swt'); jumpToPassage(${unattemptedSwt.id});`
    });
  }
  
  // 2. Next unwritten Essay Topic
  const unwrittenEssay = essays.find(e => essayStatus(e) === 'empty' || essayStatus(e) === 'draft');
  if (unwrittenEssay) {
    actions.push({
      icon: '✍️',
      title: `Write Essay: ${unwrittenEssay.title}`,
      desc: essayStatus(unwrittenEssay) === 'draft' ? 'Finish your saved draft essay.' : 'Develop a Band 9 essay using advanced academic structure.',
      action: `switchSection('library'); selectEssay('${unwrittenEssay.id}');`
    });
  }
  
  // 3. Vocab category with lowest progress
  const progress = getVocabProgress();
  let lowestCat = null;
  let lowestRatio = 1.0;
  
  Object.entries(VOCAB_DATA).forEach(([catId, cat]) => {
    const readCount = cat.words.filter(w => (progress.read || {})[vocabKey(catId, w.word)]).length;
    const ratio = readCount / cat.words.length;
    if (ratio < 1.0 && ratio < lowestRatio) {
      lowestRatio = ratio;
      lowestCat = { id: catId, ...cat };
    }
  });
  
  if (lowestCat) {
    actions.push({
      icon: '📖',
      title: `Learn Vocab: ${lowestCat.label}`,
      desc: `Practise academic vocabulary. Current category progress: ${Math.round(lowestRatio * 100)}%.`,
      action: `openVocab(); selectVocabCategory('${lowestCat.id}');`
    });
  }
  
  if (actions.length === 0) {
    actions.push({
      icon: '🎉',
      title: 'All tasks completed!',
      desc: 'Excellent job. You have explored all current passages and vocabulary files.',
      action: ''
    });
  }
  
  container.innerHTML = actions.map(act => `
    <div class="action-item-card" onclick="${act.action ? act.action : ''}">
      <div class="action-icon">${act.icon}</div>
      <div class="action-details">
        <div class="action-title">${escapeHtml(act.title)}</div>
        <div class="action-desc">${escapeHtml(act.desc)}</div>
      </div>
      <div class="action-arrow">→</div>
    </div>
  `).join('');
}

// --- Flashcards Mode Functions ---
let flashcardIndex = 0;
let flashcardFlipped = false;

function renderVocabFlashcardContainer() {
  return `
    <div class="flashcard-wrapper" id="flashcardWrapper" onclick="toggleFlashcardFlip()">
      <div class="flashcard-inner">
        <div class="flashcard-front" id="fcFront">
          <!-- Populated via JS -->
        </div>
        <div class="flashcard-back" id="fcBack">
          <!-- Populated via JS -->
        </div>
      </div>
    </div>
    <div class="fc-progress" id="fcProgress">Card 1 of 1</div>
    <div class="flashcard-controls" id="fcControls" style="visibility: hidden;">
      <button class="fc-btn again" onclick="handleFlashcardAction(false); event.stopPropagation();">Again (Study)</button>
      <button class="fc-btn good" onclick="handleFlashcardAction(true); event.stopPropagation();">Good (Got it)</button>
    </div>
  `;
}

function showVocabFlashcard() {
  const cat = VOCAB_DATA[currentVocabCategory];
  if (!cat || cat.words.length === 0) return;
  
  if (flashcardIndex >= cat.words.length) {
    flashcardIndex = 0;
  }
  
  const w = cat.words[flashcardIndex];
  flashcardFlipped = false;
  
  const wrapper = document.getElementById('flashcardWrapper');
  if (wrapper) wrapper.classList.remove('flipped');
  
  const front = document.getElementById('fcFront');
  const back = document.getElementById('fcBack');
  const progress = document.getElementById('fcProgress');
  const controls = document.getElementById('fcControls');
  
  if (front) {
    front.innerHTML = `
      <div class="fc-word">${escapeHtml(w.word)}</div>
      <div class="pos-badge" style="background:var(--accent-soft); color:var(--accent); font-weight:700; font-size:12px; margin-top:10px;">${escapeHtml(w.pos || '')}</div>
      <div class="fc-hint">Tap card to reveal definition</div>
    `;
  }
  
  if (back) {
    back.innerHTML = `
      <div style="font-weight: 800; font-size: 18px; color: var(--accent); margin-bottom: 8px;">${escapeHtml(w.word)}</div>
      <div style="font-size: 13px; line-height: 1.5; color: var(--ink); margin-bottom: 12px;">
        <strong>Meaning:</strong> ${escapeHtml(w.meaning)}
      </div>
      ${w.compare ? `<div style="font-size: 12px; margin-bottom: 12px; padding: 6px 10px; background: rgba(99, 102, 241, 0.05); border-radius: 6px;"><strong>Compare:</strong> ${escapeHtml(w.compare)}</div>` : ''}
      <div style="font-size: 12px; color: var(--ink-soft);">
        <strong>Examples:</strong>
        <ul style="margin: 6px 0 0 16px; padding: 0;">
          ${(w.examples || []).map(ex => `<li style="margin-bottom: 4px;">${escapeHtml(ex)}</li>`).join('')}
        </ul>
      </div>
    `;
  }
  
  if (progress) {
    progress.textContent = `Card ${flashcardIndex + 1} of ${cat.words.length}`;
  }
  
  if (controls) {
    controls.style.visibility = 'hidden';
  }
}

function toggleFlashcardFlip() {
  const wrapper = document.getElementById('flashcardWrapper');
  if (!wrapper) return;
  
  flashcardFlipped = !flashcardFlipped;
  wrapper.classList.toggle('flipped', flashcardFlipped);
  
  const controls = document.getElementById('fcControls');
  if (controls) {
    controls.style.visibility = flashcardFlipped ? 'visible' : 'hidden';
  }
}

async function handleFlashcardAction(gotIt) {
  const cat = VOCAB_DATA[currentVocabCategory];
  if (!cat) return;
  const w = cat.words[flashcardIndex];
  
  const progress = getVocabProgress();
  const key = vocabKey(currentVocabCategory, w.word);
  
  if (gotIt) {
    if (!progress.read[key]) {
      progress.read[key] = Date.now();
      await saveVocabProgress();
    }
  } else {
    if (progress.read[key]) {
      delete progress.read[key];
      await saveVocabProgress();
    }
  }
  
  flashcardIndex++;
  if (flashcardIndex >= cat.words.length) {
    flashcardIndex = 0;
    toast('Finished this category review! Starting again.');
  }
  
  renderVocabCategoryList();
  updateVocabProgressSummary();
  showVocabFlashcard();
}

// --- Practice Hub Game Logic Router ---
let quizType = 'spelling';

function startQuizMode(type) {
  quizType = type;
  
  const progress = getVocabProgress();
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push({ ...w, catId, catLabel: cat.label, read: !!progress.read[vocabKey(catId, w.word)] });
    }
  }
  const readPool = allWords.filter(w => w.read);
  
  document.getElementById('vocabPracticeContent').innerHTML = `
    <h2>🎯 Select Quiz Length & Pool</h2>
    <p style="margin-bottom: 16px;">Configure your ${type === 'spelling' ? 'Spelling' : 'Multiple Choice'} quiz.</p>
    
    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom: 20px;">
      <button class="tb-text-btn dark" onclick="setupAndStartQuiz(10, 'read')" ${readPool.length < 1 ? 'disabled' : ''}>10 words I've read</button>
      <button class="tb-text-btn dark" onclick="setupAndStartQuiz(20, 'read')" ${readPool.length < 1 ? 'disabled' : ''}>20 words I've read</button>
      <button class="tb-text-btn dark" onclick="setupAndStartQuiz(10, 'all')">10 mixed words (all)</button>
    </div>
    
    <div class="modal-actions">
      <button class="tb-text-btn" onclick="openVocabPractice()">← Back</button>
    </div>
  `;
}

function setupAndStartQuiz(n, pool) {
  const progress = getVocabProgress();
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push({ ...w, catId, catLabel: cat.label, read: !!progress.read[vocabKey(catId, w.word)] });
    }
  }
  const source = (pool === 'read') ? allWords.filter(w => w.read) : allWords;
  if (source.length === 0) { toast('No words available — read some first', true); return; }
  
  const shuffled = [...source].sort(() => Math.random() - 0.5).slice(0, Math.min(n, source.length));
  quizWords = shuffled;
  quizUserAnswers = {};
  
  if (quizType === 'spelling') {
    renderQuiz();
  } else {
    startMCQQuiz();
  }
}

// --- Multiple-Choice Quiz Engine ---
let mcqCurrentIndex = 0;
let mcqScore = 0;
let mcqChoices = [];
let mcqAnswerChecked = false;

function startMCQQuiz() {
  mcqCurrentIndex = 0;
  mcqScore = 0;
  renderMCQQuestion();
}

function renderMCQQuestion() {
  if (mcqCurrentIndex >= quizWords.length) {
    renderMCQFinished();
    return;
  }
  
  mcqAnswerChecked = false;
  const w = quizWords[mcqCurrentIndex];
  
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const item of cat.words) {
      if (item.word !== w.word) {
        allWords.push(item.word);
      }
    }
  }
  
  const distractors = [...new Set(allWords)].sort(() => Math.random() - 0.5).slice(0, 3);
  mcqChoices = [w.word, ...distractors].sort(() => Math.random() - 0.5);
  
  const c = document.getElementById('vocabPracticeContent');
  c.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line-soft); padding-bottom:8px; margin-bottom:14px;">
      <h3 style="margin:0; font-size:15px; color:var(--accent);">🎯 Multiple Choice Quiz</h3>
      <span style="font-size:12px; color:var(--ink-soft); font-weight:700;">Question ${mcqCurrentIndex + 1} of ${quizWords.length}</span>
    </div>
    
    <div style="margin: 16px 0; background:rgba(99, 102, 241, 0.03); border:1px solid var(--line-soft); padding:16px; border-radius:8px;">
      <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--ink-mute); margin-bottom:6px;">Meaning:</div>
      <div style="font-size:14px; font-weight:600; line-height:1.5; color:var(--ink);">${escapeHtml(w.meaning)}</div>
    </div>
    
    <div class="quiz-choices-grid" id="mcqChoicesGrid">
      ${mcqChoices.map((choice, i) => `
        <button class="quiz-choice-btn" onclick="submitMCQAnswer('${choice.replace(/'/g, "\\'")}', ${i})">${escapeHtml(choice)}</button>
      `).join('')}
    </div>
    
    <div id="mcqFeedback" style="margin-top:16px; min-height:48px;"></div>
    
    <div class="modal-actions" style="margin-top:16px; border-top:1px solid var(--line-soft); padding-top:12px;">
      <span style="font-size:12.5px; color:var(--ink-soft);">Score: <strong>${mcqScore}</strong></span>
      <button class="tb-text-btn" onclick="closeVocabPractice()" style="margin-left:auto;">Quit</button>
      <button class="tb-text-btn dark" id="mcqNextBtn" disabled onclick="nextMCQQuestion()">Next →</button>
    </div>
  `;
}

function submitMCQAnswer(choice, choiceIndex) {
  if (mcqAnswerChecked) return;
  mcqAnswerChecked = true;
  
  const w = quizWords[mcqCurrentIndex];
  const buttons = document.querySelectorAll('#mcqChoicesGrid .quiz-choice-btn');
  const fb = document.getElementById('mcqFeedback');
  const isCorrect = (choice === w.word);
  
  if (isCorrect) {
    mcqScore++;
    buttons[choiceIndex].classList.add('correct');
    fb.innerHTML = `
      <div style="color:#10b981; font-weight:700; font-size:13px; display:flex; align-items:center; gap:6px;">
        <span>✓ Correct!</span>
      </div>
    `;
  } else {
    buttons[choiceIndex].classList.add('incorrect');
    buttons.forEach((btn, idx) => {
      if (mcqChoices[idx] === w.word) {
        btn.classList.add('correct');
      }
    });
    fb.innerHTML = `
      <div style="color:#ef4444; font-weight:700; font-size:13px; display:flex; align-items:center; gap:6px;">
        <span>✗ Incorrect. The correct word is "${escapeHtml(w.word)}".</span>
      </div>
    `;
  }
  
  const nextBtn = document.getElementById('mcqNextBtn');
  if (nextBtn) nextBtn.disabled = false;
}

function nextMCQQuestion() {
  mcqCurrentIndex++;
  renderMCQQuestion();
}

function renderMCQFinished() {
  const c = document.getElementById('vocabPracticeContent');
  
  const progress = getVocabProgress();
  if (!progress.practiceHistory) progress.practiceHistory = [];
  progress.practiceHistory.push({
    date: Date.now(),
    total: quizWords.length,
    correct: mcqScore,
    pct: Math.round(mcqScore / quizWords.length * 100),
    mode: 'mcq'
  });
  if (progress.practiceHistory.length > 50) progress.practiceHistory = progress.practiceHistory.slice(-50);
  saveVocabProgress();
  
  c.innerHTML = `
    <div style="text-align:center; padding:16px 0;">
      <div style="font-size:48px; margin-bottom:12px;">🎉</div>
      <h2>Multiple Choice Quiz Completed!</h2>
      <p style="color:var(--ink-soft); margin-bottom:20px;">You scored <strong>${mcqScore} out of ${quizWords.length}</strong> correct definitions.</p>
      
      <div style="background:var(--bg-list); border:1px solid var(--line-soft); border-radius:8px; padding:14px; display:inline-block; min-width:240px; margin-bottom:24px;">
        <div style="font-size:24px; font-weight:800; color:var(--accent);">${Math.round(mcqScore/quizWords.length*100)}%</div>
        <div style="font-size:12px; color:var(--ink-mute); margin-top:4px;">Accuracy Score</div>
      </div>
      
      <div class="modal-actions" style="justify-content:center; gap:12px;">
        <button class="tb-text-btn" onclick="openVocabPractice()">Practice Hub</button>
        <button class="tb-text-btn dark" onclick="startMCQQuiz()">Try Again</button>
      </div>
    </div>
  `;
}

// --- Synonyms Matching Game Engine ---
let matcherCards = [];
let matcherSelected = null;
let matcherTimer = null;
let matcherTimeLeft = 45;
let matcherScore = 0;
let matcherMatchesCount = 0;

function startSynonymsMatcher() {
  matcherScore = 0;
  matcherMatchesCount = 0;
  matcherTimeLeft = 45;
  matcherSelected = null;
  
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push(w);
    }
  }
  
  if (allWords.length < 6) {
    toast('Not enough vocabulary words to start matching game.', true);
    return;
  }
  
  const selectedWords = [...allWords].sort(() => Math.random() - 0.5).slice(0, 6);
  
  matcherCards = [];
  selectedWords.forEach((w, idx) => {
    matcherCards.push({
      id: `word-${idx}`,
      pairId: idx,
      type: 'word',
      text: w.word,
      matched: false
    });
    
    let shortMeaning = w.meaning;
    if (shortMeaning.length > 40) {
      shortMeaning = shortMeaning.slice(0, 38) + '...';
    }
    
    matcherCards.push({
      id: `mean-${idx}`,
      pairId: idx,
      type: 'meaning',
      text: shortMeaning,
      matched: false
    });
  });
  
  matcherCards.sort(() => Math.random() - 0.5);
  
  if (matcherTimer) clearInterval(matcherTimer);
  
  matcherTimer = setInterval(() => {
    matcherTimeLeft--;
    const timeEl = document.getElementById('matcherTime');
    if (timeEl) timeEl.textContent = `${matcherTimeLeft}s`;
    
    if (matcherTimeLeft <= 0) {
      clearInterval(matcherTimer);
      renderMatcherGameOver();
    }
  }, 1000);
  
  renderMatcherGrid();
}

function renderMatcherGrid() {
  const c = document.getElementById('vocabPracticeContent');
  c.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line-soft); padding-bottom:8px; margin-bottom:14px;">
      <h3 style="margin:0; font-size:15px; color:#10b981;">⚡ Synonyms Matcher Game</h3>
      <div style="display:flex; gap:12px; font-size:12px; font-weight:700;">
        <span>Matches: <strong id="matcherCount" style="color:#10b981;">0/6</strong></span>
        <span>Time Left: <strong id="matcherTime" class="game-time-val">45s</strong></span>
      </div>
    </div>
    
    <p style="font-size:12px; color:var(--ink-soft); margin-top:0;">Match the academic word to its corresponding definition snippet.</p>
    
    <div class="matcher-grid" id="matcherGrid">
      ${matcherCards.map((card, idx) => `
        <div class="matcher-card" id="card-${card.id}" onclick="handleMatcherCardClick('${card.id}', ${idx})">
          ${escapeHtml(card.text)}
        </div>
      `).join('')}
    </div>
    
    <div class="modal-actions" style="margin-top:20px; border-top:1px solid var(--line-soft); padding-top:12px;">
      <button class="tb-text-btn" onclick="quitMatcherGame()">Quit Game</button>
    </div>
  `;
}

function handleMatcherCardClick(cardId, index) {
  const card = matcherCards[index];
  if (card.matched) return;
  
  const el = document.getElementById(`card-${cardId}`);
  if (!el || el.classList.contains('selected') || el.classList.contains('incorrect')) return;
  
  el.classList.add('selected');
  
  if (matcherSelected === null) {
    matcherSelected = { card, index, el };
  } else {
    const first = matcherSelected;
    const second = { card, index, el };
    matcherSelected = null;
    
    if (first.card.pairId === second.card.pairId && first.card.type !== second.card.type) {
      first.card.matched = true;
      second.card.matched = true;
      
      setTimeout(() => {
        first.el.className = 'matcher-card matched';
        second.el.className = 'matcher-card matched';
        
        matcherMatchesCount++;
        const countEl = document.getElementById('matcherCount');
        if (countEl) countEl.textContent = `${matcherMatchesCount}/6`;
        
        if (matcherMatchesCount === 6) {
          clearInterval(matcherTimer);
          renderMatcherSuccess();
        }
      }, 300);
    } else {
      first.el.classList.remove('selected');
      first.el.classList.add('incorrect');
      second.el.classList.remove('selected');
      second.el.classList.add('incorrect');
      
      setTimeout(() => {
        first.el.classList.remove('incorrect');
        second.el.classList.remove('incorrect');
      }, 800);
    }
  }
}

function quitMatcherGame() {
  if (matcherTimer) clearInterval(matcherTimer);
  openVocabPractice();
}

function renderMatcherSuccess() {
  const c = document.getElementById('vocabPracticeContent');
  const scoreGained = 100 + matcherTimeLeft * 10;
  
  const progress = getVocabProgress();
  if (!progress.practiceHistory) progress.practiceHistory = [];
  progress.practiceHistory.push({
    date: Date.now(),
    total: 6,
    correct: 6,
    pct: 100,
    score: scoreGained,
    mode: 'matcher'
  });
  saveVocabProgress();
  
  c.innerHTML = `
    <div style="text-align:center; padding:16px 0;">
      <div style="font-size:48px; margin-bottom:12px;">🏆</div>
      <h2>Superb Matching!</h2>
      <p style="color:var(--ink-soft); margin-bottom:20px;">You cleared the board with <strong>${matcherTimeLeft} seconds</strong> remaining.</p>
      
      <div style="background:var(--bg-list); border:1px solid var(--line-soft); border-radius:8px; padding:14px; display:inline-block; min-width:240px; margin-bottom:24px;">
        <div style="font-size:24px; font-weight:800; color:#10b981;">+${scoreGained} points</div>
        <div style="font-size:12px; color:var(--ink-mute); margin-top:4px;">High Score logged to database</div>
      </div>
      
      <div class="modal-actions" style="justify-content:center; gap:12px;">
        <button class="tb-text-btn" onclick="openVocabPractice()">Practice Hub</button>
        <button class="tb-text-btn dark" onclick="startSynonymsMatcher()" style="background:#10b981; border-color:#10b981;">Play Again</button>
      </div>
    </div>
  `;
}

function renderMatcherGameOver() {
  const c = document.getElementById('vocabPracticeContent');
  c.innerHTML = `
    <div style="text-align:center; padding:16px 0;">
      <div style="font-size:48px; margin-bottom:12px;">⏰</div>
      <h2>Time's Up!</h2>
      <p style="color:var(--ink-soft); margin-bottom:20px;">The timer ran out before you could match all pairs.</p>
      
      <div style="background:var(--bg-list); border:1px solid var(--line-soft); border-radius:8px; padding:14px; display:inline-block; min-width:240px; margin-bottom:24px;">
        <div style="font-size:20px; font-weight:800; color:#ef4444;">Game Over</div>
        <div style="font-size:12px; color:var(--ink-mute); margin-top:4px;">Keep practising to improve speed!</div>
      </div>
      
      <div class="modal-actions" style="justify-content:center; gap:12px;">
        <button class="tb-text-btn" onclick="openVocabPractice()">Practice Hub</button>
        <button class="tb-text-btn dark" onclick="startSynonymsMatcher()">Try Again</button>
      </div>
    </div>
  `;
}

let lastExternalWordData = null;

async function queryExternalWord(word) {
  const resultContainer = document.getElementById('externalWordResult');
  if (!resultContainer) return;
  
  resultContainer.innerHTML = `
    <div style="margin-top: 14px; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg); border: 1px dashed var(--line-soft); border-radius: 12px;">
      <span class="spinner-dark" style="border-color: var(--accent); border-top-color: transparent; width: 18px; height: 18px; margin-right: 8px;"></span>
      <span style="font-size: 13.5px; color: var(--ink-soft);">Claude AI is analyzing "${escapeHtml(word)}"...</span>
    </div>
  `;
  
  if (offlineMode) {
    resultContainer.innerHTML = `
      <div style="margin-top: 14px; padding: 14px; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; color: var(--ink-soft); font-size: 13px;">
        Offline mode enabled. Connect to the internet to query Claude AI.
      </div>
    `;
    return;
  }
  
  const prompt = `The student searched for the word "${word}" in an English vocabulary prep app (IELTS/PTE), but it was not found in the database.
Identify if the word is spelled correctly or if it is a typo/misspelling.

Case 1: If the word is spelled correctly (or is a valid English word):
Provide:
1. One general formal meaning (defined in simple, layman-friendly plain English).
2. Part of speech.
3. 2-3 different context-specific meanings.
4. Exactly 5 natural example sentences demonstrating the word in these contexts.

Case 2: If the word seems to be a typo or misspelled:
Provide:
1. A note explaining that the word might be misspelled.
2. A list of 2-4 possible correct spellings/suggestions.
3. For each suggestion, provide its part of speech and a very brief definition.

Return ONLY a valid JSON object matching one of these structures (do not include markdown outside JSON, just output the JSON plain text):

For Case 1 (Valid Word):
{
  "status": "valid",
  "word": "${word}",
  "pos": "noun/verb/etc",
  "meaning": "general meaning here",
  "contexts": [
    { "name": "Academic", "meaning": "meaning here", "examples": ["example 1", "example 2"] },
    { "name": "General", "meaning": "meaning here", "examples": ["example 3", "example 4", "example 5"] }
  ]
}

For Case 2 (Typo/Suggestions):
{
  "status": "typo",
  "suggestions": [
    { "word": "correctWord1", "pos": "noun", "meaning": "brief meaning here" },
    { "word": "correctWord2", "pos": "verb", "meaning": "brief meaning here" }
  ]
}
`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const resData = await res.json();
    const text = (resData.content || []).map(c => c.text || '').join('\n').trim();
    
    const data = cleanAndParseJSON(text);
    
    if (data.status === 'valid') {
      lastExternalWordData = data;
      const safeWord = data.word.replace(/'/g, "\\'");
      
      const posVal = (data.pos || '').toLowerCase().trim();
      let posClass = 'pos-noun';
      if (posVal.includes('verb')) posClass = 'pos-verb';
      else if (posVal.includes('adj') || posVal.includes('adjective')) posClass = 'pos-adjective';
      else if (posVal.includes('adv') || posVal.includes('adverb')) posClass = 'pos-adverb';
      
      const posHtml = `<span class="pos-badge ${posClass}">${escapeHtml(data.pos || '')}</span>`;
      
      const contextsHtml = (data.contexts || []).map(ctx => {
        const examplesList = (ctx.examples || []).map(ex => {
          const regex = new RegExp(`\\b(${data.word})\\b`, 'i');
          const bolded = escapeHtml(ex).replace(regex, '<strong>$1</strong>');
          return `<li style="font-size: 13px; color: var(--ink-soft); margin-bottom: 8px; line-height: 1.45; list-style-type: none; position: relative; padding-left: 14px;">
            <span style="position: absolute; left: 0; color: var(--accent);">•</span>
            "${bolded}"
          </li>`;
        }).join('');
        return `
          <div style="background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; padding: 14px; margin-bottom: 12px; text-align: left;">
            <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 700; margin-bottom: 4px;">${escapeHtml(ctx.name)} Context</div>
            <div style="font-size: 13px; color: var(--ink); margin-bottom: 8px;">${escapeHtml(ctx.meaning)}</div>
            <ul style="margin: 0; padding: 0;">${examplesList}</ul>
          </div>
        `;
      }).join('');
      
      resultContainer.innerHTML = `
        <div class="vocab-word-card" id="word-card-external" style="margin-top: 14px; border: 1px solid var(--accent); text-align: left;">
          <div class="vocab-card-top">
            <div class="vocab-word-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span>${escapeHtml(data.word)}</span>
              <div class="vocab-badges" style="display: inline-flex; gap: 4px; align-items: center; vertical-align: middle; margin-left: 4px;">
                ${posHtml}
                <span class="level-badge" style="background: var(--accent); color: #fff;">AI Suggested</span>
              </div>
              <button class="vocab-audio-btn" onclick="speakWord('${safeWord}')" title="Listen to pronunciation">
                <span class="material-symbols-outlined" style="font-size: 18px;">volume_up</span>
              </button>
            </div>
          </div>
          
          <div class="vocab-word-meaning" style="margin-top: 8px; font-size: 13.5px; color: var(--ink-soft); line-height: 1.5; text-align: left;">
            <strong>Definition:</strong> ${escapeHtml(data.meaning || '')}
          </div>
          
          <div style="margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
            <div>
              <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-soft); font-weight: 700; margin-bottom: 10px; text-align: left;">Contextual Meanings &amp; Examples</div>
              ${contextsHtml}
            </div>
            <div class="vocab-try" style="margin: 0; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div class="vocab-try-label" style="text-align: left;">Practice Bench</div>
                <div class="vocab-try-row">
                  <input type="text" placeholder="Write a sentence using '${safeWord}'..." id="try-external" onkeypress="if(event.key==='Enter') checkSentence('external', '${safeWord}')">
                  <button class="vocab-try-check" onclick="checkSentence('external', '${safeWord}')">Check</button>
                  <button class="vocab-try-ai" onclick="aiGradeSentence('external', '${safeWord}', 'external')">🤖 AI Grade</button>
                </div>
              </div>
              <div class="vocab-try-feedback" id="try-fb-external" style="text-align: left;"></div>
            </div>
          </div>
        </div>
      `;
    } else if (data.status === 'typo') {
      const suggestionsHtml = (data.suggestions || []).map(s => {
        const sWord = s.word.replace(/'/g, "\\'");
        return `
          <div style="background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <div>
              <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px;">
                <strong style="font-family: var(--serif); font-size: 14px; color: var(--ink);">${escapeHtml(s.word)}</strong>
                <span class="pos-badge pos-noun" style="font-size: 10px; padding: 1px 4px;">${escapeHtml(s.pos)}</span>
              </div>
              <div style="font-size: 12px; color: var(--ink-soft);">${escapeHtml(s.meaning)}</div>
            </div>
            <button class="vocab-action-btn" onclick="applyExternalSuggestion('${sWord}')" style="font-size: 12px; padding: 6px 12px; flex-shrink: 0;">
              Use Suggestion
            </button>
          </div>
        `;
      }).join('');
      
      resultContainer.innerHTML = `
        <div style="margin-top: 14px; background: var(--bg-card); border: 1px solid var(--line-soft); border-radius: 12px; padding: 20px; text-align: left;">
          <div style="color: #ea580c; font-weight: 700; font-size: 14px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined" style="font-size: 18px;">warning</span>
            <span>Spelling suggestion or typo detected</span>
          </div>
          <p style="font-size: 13px; color: var(--ink-soft); margin-bottom: 14px;">"${escapeHtml(word)}" might be misspelled. Did you mean one of these?</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${suggestionsHtml}
          </div>
        </div>
      `;
    } else {
      throw new Error("Invalid response status from AI");
    }
  } catch (err) {
    console.error('Failed to load external word details:', err);
    resultContainer.innerHTML = `
      <div style="margin-top: 14px; padding: 14px; background: var(--bg); border: 1px solid #fca5a5; border-radius: 8px; color: #b91c1c; font-size: 13px;">
        AI query failed: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

function applyExternalSuggestion(word) {
  const searchInput = document.getElementById('masterSearch');
  if (searchInput) {
    searchInput.value = word;
    handleMasterSearch(word);
  }
}

window.queryExternalWord = queryExternalWord;
window.applyExternalSuggestion = applyExternalSuggestion;

async function checkUserEmailRequirement() {
  // Email collection is intentionally opt-in from the Account menu so startup
  // never interrupts practice with a browser prompt.
}

async function updateUserEmail() {
  let emailInput = prompt("Enter your new email address:", (userProfile && userProfile.email && !userProfile.email.toLowerCase().endsWith('@ptewriting.com')) ? userProfile.email : "");
  if (emailInput === null) return; // cancelled
  emailInput = emailInput.trim();
  if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
    toast("Invalid email address", true);
    return;
  }
  if (emailInput.toLowerCase().endsWith('@ptewriting.com')) {
    toast("Cannot use a @ptewriting.com email address", true);
    return;
  }
  userProfile.email = emailInput;
  currentUser.email = emailInput;
  localStorage.setItem('pte_preferred_email', emailInput);
  toast("Email address updated!");
  await flushSyncDirect();
  document.getElementById('userMenuEmail').textContent = emailInput;
  updateEmailLabels();
}

function updateEmailLabels() {
  const e = getCurrent();
  const written = essays.filter(x => essayStatus(x) !== 'empty');
  const emailEl = document.getElementById('emailRecipient');
  if (emailEl && currentUser) {
    if (e && essayStatus(e) !== 'empty') {
      emailEl.textContent = `Sending to ${currentUser.email}`;
    }
  }
  const emailBookEl = document.getElementById('emailBookRecipient');
  if (emailBookEl && currentUser) {
    if (written.length > 0) {
      emailBookEl.textContent = `Sending ${written.length} essays to ${currentUser.email} (~${Math.round(written.length * 3)}s to generate)`;
    }
  }
}

window.updateUserEmail = updateUserEmail;



document.addEventListener('click', function(event){
  const button = event.target && event.target.closest ? event.target.closest('#swtPane button[data-swt-word]') : null;
  if (!button) return;
  loadPassage(currentPassageId);
  applyVocabSwap(button.dataset.swtWord, button.dataset.swtReplacement);
  backToPractice();
});

