# IPT Brisbane writing portal: whole-site organisation plan

## Outcome

Make the **IELTS and PTE Tutorial Brisbane** portal feel like one calm, dependable workspace. A learner should be able to choose a task, write without losing a draft, receive a trustworthy result, understand the next improvement, and return later without relearning the interface.

The plan keeps the existing blue branching-tree and red-star IPT branding, the external Reading mock-test link, the meaning-based SWT policy, and essay samples built from the learner's own ideas.

## Current baseline

- The writing portal is live at `swt.up.railway.app` on app release `20.4.7`.
- The main student areas are Home, Summarise Written Text, Essay Practice, Essay Library, Vocabulary, and the separate Reading mock test.
- Essay grading and 200–300-word Band 9-style samples have been verified with the learner's arguments and examples.
- SWT now handles pasted spacing differences and keeps a confirmed score when the assessment is complete.
- The next scoring improvement must address occasional incomplete AI assessment fields without adding another slow request chain. An experimental structured-output patch is currently local and should be measured before it is released.
- The current client bundles are large (`public/index.js` is about 780 KB and `public/index.css` is about 150 KB), so performance work should be part of the organisation effort rather than a later polish task.

## Principles

1. **Task first:** put SWT and Essay Practice above analytics, history, and administration.
2. **One clear action:** every screen has one primary button and a visible next step.
3. **Honest scoring:** a provisional result is labelled clearly; a missing AI assessment never becomes a false Band 9.
4. **State is safe:** drafts, timers, selected questions, and results survive navigation and refresh for the correct account.
5. **Progressive detail:** show the score and one useful action first; place evidence and technical detail behind expandable sections.
6. **Consistent IPT presentation:** use the supplied logo, blue/red palette, shared typography, spacing, buttons, cards, and voice throughout.
7. **Small releases:** each phase has a measurable acceptance check, a live smoke test, and a rollback point.

## Phased roadmap

### Phase 0 — Stabilise the foundation (P0)

Create one clean release baseline before reorganising the UI.

- Decide whether the local SWT assessment-format experiment is retained, simplified, or reverted after latency testing; do not deploy an unmeasured change to the scoring path.
- Keep one bounded request lifecycle for each assessment: duplicate-submit guard, browser abort timeout, server deadline, at most one retry/review, and a visible provisional state.
- Add a request ID and assessment stage to server diagnostics. Keep student text and account secrets out of logs.
- Separate model assessment, deterministic scoring, persistence, and rendering into clear service boundaries.
- Define a small release checklist: `npm test`, syntax check, diff check, health check, one complete answer, one incomplete answer, and one failed-provider response.

**Done when:** a stalled or malformed model response returns a useful message within the deadline, never leaves the controls locked, never overwrites a newer draft, and never hides a valid saved score.

### Phase 1 — Establish the information architecture (P0)

Keep the existing single workspace, but make its hierarchy explicit.

- **Home:** resume card, two primary task cards (SWT and Essay), recent activity, and one recommended next step.
- **SWT:** passage selection → read → write → score → review → retry or next passage.
- **Essay Practice:** question selection → plan ideas → write → score → improve → sample comparison.
- **Essay Library:** saved prompts, drafts, scored attempts, and exports.
- **Vocabulary:** daily word, search, practice, and mastery progress.
- **Reading Mock Test:** one clearly labelled external link that opens the separate service.
- Keep account, theme, sync status, and admin access in the shell; keep them out of the task content.
- Use the existing URL routes (`#/home`, `#/swt`, `#/essays`, `#/library`, `#/vocabulary`) as the stable navigation contract.

**Done when:** every section has a predictable URL, browser Back/Forward works, navigation does not rebuild an editor or stop a timer, and the active section is clear on desktop and mobile.

### Phase 2 — Smooth the learner flows (P0)

Remove friction from the actions Pia has already identified as distracting.

- Keep startup focused on practice; do not show the unnecessary email popup. Offer email changes only from the account menu when a learner asks for them.
- Use dynamic, task-specific welcome copy rather than “Opening your workspace.” Examples: “Choose a task and build today’s score,” “Your next summary is ready,” and “Turn one idea into a stronger essay.”
- Give every async action four states: ready, working, success, and recoverable error. The working state must say what is happening and provide no duplicate-submit path.
- Show draft status near the editor: saved on this device, syncing, synced, or unable to save.
- Add an unsaved-change guard only when leaving an active draft; never interrupt a completed result.
- Preserve the submitted text beside the result so a late response cannot be attached to another passage or account.
- Make empty states useful: explain what to do next and provide the direct button.

**Done when:** a learner can sign in, start either task, move between sections, refresh, return, submit once, recover from an error, and continue without losing work or guessing what happened.

### Phase 3 — Make scoring dependable and teachable (P0)

Treat scoring as a product flow, not just an API response.

- Keep SWT scoring holistic: central idea, relevant support, necessary relationships, conclusion where present, form, grammar, and vocabulary.
- Keep harmless grammar, spelling, article, agreement, and connector refinements separate from deductions when meaning remains clear.
- Keep exact evidence quotes grounded in the learner’s text, including flexible whitespace and smart quotes.
- Display the raw trait breakdown, the practice estimate, the provisional notice, and one priority repair in the same order every time.
- Keep incomplete answers below full Content and show the missing relationship in plain language.
- Keep essay scoring independent from sample generation. A sample failure must never erase the essay score.
- Store assessment version, model status, request timestamp, and submitted text hash with each result so an old result can be explained and reproduced.

**Done when:** complete benchmark summaries receive confirmed 9/9, incomplete summaries receive a useful deduction, malformed assessments are recoverable, and the UI always matches the stored result.

### Phase 4 — Organise Essay Practice around the learner’s ideas (P1)

Make the essay area follow the intended teaching sequence.

1. Show the prediction list and prompt.
2. Identify question type and approach.
3. Let the learner choose or enter supporting ideas.
4. Offer **Exam Template Mode** and **Natural Band 8/9 Mode** consistently for generation and rewrites.
5. Write or edit the response.
6. Score the original response.
7. Generate a 200–300-word, four-paragraph Band 9-style sample using the learner’s own position, reasons, examples, and conclusion.
8. Compare the learner’s response with the sample and practise one improvement.

The sample generator may expand a clear learner idea with a simple everyday explanation, but it must not invent named places, statistics, citations, or unrelated arguments. For questions that require an opinion, preserve the learner’s position; for questions that do not, do not add an unrequested opinion.

**Done when:** a learner can see which ideas were retained, the sample is grounded in the submitted response, and the original score remains unchanged if sample creation fails.

### Phase 5 — Refine SWT learning and review (P1)

- Keep the passage, response, score, and feedback visually connected.
- After submission, show captured ideas, missing ideas, the key relationship, and optional language refinements.
- Make the “retry assessment” action prominent only when the result is genuinely provisional.
- Let learners browse attempted and unattempted passages without losing the current result.
- Add a compact “next attempt” prompt such as “Add the consequence that explains why the finding matters.”
- Keep reference answers clearly labelled as verified or unverified and apply the same form and semantic policy to both references and learner responses.

**Done when:** a learner can move from a score to one concrete revision and then submit that revision without opening a new workflow.

### Phase 6 — Consolidate the visual system (P1)

- Create a small design-token layer for IPT blue, IPT red, ink, muted text, surfaces, borders, success, warning, and error.
- Use the supplied IPT Brisbane logo in login, sidebar, and exported results with consistent sizing and alternative text.
- Reduce competing card styles and inline styles; use shared components for buttons, badges, tabs, notices, score rings, and empty states.
- Keep headings, body text, labels, and help copy at a consistent scale.
- Ensure dark mode, focus rings, disabled states, and error states use the same tokens.
- Remove obsolete duplicate navigation and CSS rules after the new components are verified.

**Done when:** a new screen can be assembled from existing components without inventing a new button, card, colour, or spacing rule.

### Phase 7 — Improve speed and accessibility (P1)

- Split or defer large assets, especially the vocabulary dictionary and rarely used admin/export code.
- Remove duplicate network calls and cache read-only passage/configuration data.
- Keep cache-busting tied to the app release version and verify that HTML points to the same asset version.
- Use one fetch wrapper with timeout, abort, JSON validation, and consistent error text.
- Check keyboard order, visible focus, labels, tab/tabpanel relationships, dialog escape behavior, reduced motion, contrast, and mobile touch targets.
- Measure first load, time to interactive, score response time, and result-render time on a mid-range phone.

**Done when:** the first task is usable before nonessential assets finish loading, keyboard users can complete both tasks, and the score request cannot be duplicated accidentally.

### Phase 8 — Make admin and content maintenance safer (P2)

- Group passage tools into Draft, Review, Published, and Archived states.
- Preview key ideas, sample answers, form validity, and scoring policy before publishing a passage.
- Version passage text, key elements, sample answers, and policy references separately.
- Add a restore action for the previous published version.
- Show whether a reference answer is authored, checked, or awaiting review.

**Done when:** an admin can edit content, preview the student experience, publish it, and restore the previous version without touching student progress.

### Phase 9 — Operate the site with evidence (P2)

Track product signals that explain whether the site is becoming smoother:

- assessment success rate and provisional rate;
- median and 95th-percentile score response time;
- duplicate submissions and aborted requests;
- draft recovery success;
- essay sample success and retry rate;
- task completion by device size;
- most common next-step feedback categories.

Review these weekly, keep logs privacy-safe, and attach each release to a short verification record.

## Suggested delivery order

| Release | Scope | Main acceptance check |
| --- | --- | --- |
| A | Stabilise scoring and clean the pending patch | Complete, incomplete, malformed, and timed-out assessments recover correctly |
| B | Navigation, resume card, async states, and draft status | Back/Forward, refresh, and mobile menu preserve state |
| C | Essay sequence and grounded Band 9 sample comparison | Sample uses learner ideas and cannot change the original score |
| D | SWT review improvements and reference status | One score leads directly to one useful revision |
| E | Shared visual components and IPT branding pass | All primary screens use the same tokens and controls |
| F | Performance, accessibility, and admin publishing | Lighthouse-style checks, keyboard flow, and safe content release pass |

## Definition of done for every release

- The change has one owner, one user-facing outcome, and one rollback point.
- Existing accounts, progress, passages, and Reading navigation continue to work.
- `npm test`, syntax checks, and `git diff --check` pass.
- Focused client tests cover loading, duplicate submits, failures, refresh, and late responses.
- One live essay and two live SWT cases are checked after deployment, including a deliberately incomplete response.
- Railway reports a successful deployment and the health endpoint reports the expected release.
- The release note says what changed, what was tested, and what remains to measure.

## First implementation slice

Start with Release A and the first half of Release B:

1. Reconcile or remove the unmeasured local SWT structured-output patch.
2. Keep the current confirmed v20.4.7 production behavior as the rollback baseline.
3. Add the shared request/error state contract and score-result status component.
4. Finish the Home → SWT → Essay navigation and resume-card pass.
5. Run the full regression suite and live smoke checks before any visual cleanup.

This order puts reliability and state safety underneath the visual work, so later layout changes do not hide scoring or persistence problems.
