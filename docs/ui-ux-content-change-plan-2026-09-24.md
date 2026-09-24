# UI/UX and Content Change Plan — 24 September 2026

## Scope

Repository: `auspuru/pte-scoring-api`

This plan covers front-end architecture, usability, accessibility, learning flow, content quality, practice/mock organisation, and teacher/content operations.

**Scoring logic is explicitly out of scope and remains on hold.** UI wording around scores may change for clarity, but no score calculation, weighting, thresholds, or grading policy should be altered under this plan.

Current baseline checked against `main` at commit `52cedea6c4` (24 September 2026).

## Agreed implementation order

1. **Items 1–5 first** — foundation/performance/accessibility.
2. **Items 13 and 17 next** — student-facing content risk.
3. **Items 6–8 and 12 next** — learning guidance, progress, score presentation, SWT consistency.
4. **Items 9–11 and 14–16 afterward** — mock flow, retry flow, FIB/audio/source transparency and content operations.

---

## 1. Remove the Tailwind Play CDN

### Change
Remove the production runtime dependency on `https://cdn.tailwindcss.com` and the inline Tailwind configuration in `public/index.html`.

The current app already has its own IPT design tokens and CSS. Compile only the utility classes actually used into a production stylesheet, or replace the remaining utility usage with local CSS.

### Why
The Play CDN compiles in the browser and is not intended as the production CSS pipeline. It also introduces a second design system: an indigo/violet palette plus Manrope/JetBrains Mono tokens that conflict with the IPT blue/red system and fonts actually loaded.

### Pass
- No Tailwind Play CDN script in production HTML.
- No runtime Tailwind compiler.
- Existing layouts render the same or better.
- IPT colour/font tokens remain authoritative.
- Dark mode, responsive layouts, focus states and mock/practice screens still work.

---

## 2. Add a real front-end build step and split the client bundle

### Change
Add a lightweight production build using esbuild.

Bundle related modules instead of loading the current long chain of independent scripts. Start by separating:
- authentication/account bootstrap;
- portal shell/navigation;
- reading practice/mock features;
- writing/SWT/essay features;
- progress/interventions;
- admin/teacher-only code.

Lazy-load large modules such as vocabulary, admin, mock review and export/report code when they are first opened.

### Why
The current `public/index.html` loads many separate JavaScript files and the main `index.js` is still roughly 764 KB. The browser must parse a large amount of code before the app is fully interactive.

### Pass
- `npm run build` produces versioned production assets.
- Production starts successfully from built assets.
- Login/account bootstrap is not blocked by unrelated Reading, mock, vocabulary or admin code.
- Nonessential modules load on demand.
- Existing tests remain green.

---

## 3. Fix the literal `\n` HTML defect

### Change
Replace the literal text sequences between Reading script tags in `public/index.html` with actual line breaks.

Current affected block includes:
- `reading-predictions-sep-2026.js`
- `reading-fib-quality.js`
- `reading-fib-pattern-bank.js`
- `reading-mock-tools.js`

### Pass
- No literal `\n` appears between tags.
- HTML validates cleanly.
- All four Reading assets still load in the intended order until Item 2 replaces the script chain with bundles.

---

## 4. Remove stale and duplicated front-end weight

### Change
Audit and remove source/output duplication, obsolete CSS, dead scripts, superseded navigation code, unused inline styles, and old compatibility layers that are no longer referenced by the live portal.

Pay particular attention to:
- root vs `public/` copies of `index.html` and other front-end assets;
- old portal/nav presentation rules superseded by `portal-workspace.css` / `portal-polish.css`;
- dead mock/practice paths;
- old versioned assets still served but no longer referenced;
- duplicate helper functions now provided by newer modules.

### Pass
- Every retained production asset has a live reference or test.
- No duplicate source-of-truth file can accidentally be edited instead of the deployed copy.
- No broken route, mock, practice, result, admin or login flow after cleanup.
- Bundle size decreases measurably.

---

## 5. Fix muted-text contrast and accessibility inconsistencies

### Change
Audit `--ink-soft`, `--ink-mute`, secondary text, disabled states, placeholder text, status labels and dark-mode equivalents.

Also standardise:
- keyboard focus;
- button/link semantics;
- 44px minimum touch targets;
- dialog escape/return focus;
- reduced motion;
- label associations;
- visible error/status messages;
- tab/tabpanel ARIA states.

### Pass
- Normal text meets WCAG AA contrast.
- Keyboard-only users can sign in, navigate, launch practice/mock tests, submit, review and return.
- Focus is always visible.
- Dark mode maintains readable contrast.
- Reduced-motion preference is respected.

---

## 6. Add onboarding target/date and a clear “Today’s plan”

### Change
For new or returning students, capture a simple study target:
- target PTE score;
- target test date;
- optional weekly study frequency.

Use it to show a short **Today’s plan** on Home rather than a generic dashboard.

The plan should prioritise:
1. unfinished assigned/started work;
2. one weakest-area activity when progress data exists;
3. one short revision task.

### Pass
- A learner can understand what to do today within a few seconds of opening Home.
- The plan never blocks practice if profile fields are blank.
- The target/test date can be edited from account/settings.

---

## 7. Make “My Progress” actionable and server-backed

### Change
Replace surface-level counts with useful learning signals sourced from saved attempts.

Show:
- recent activity by task type;
- trend where enough data exists;
- weakest task type/skill;
- last attempt;
- recommended next action.

Keep the progress calculation on the server so it works across devices.

### Pass
- Progress survives device changes.
- “Weakest area” links directly to a relevant practice action.
- Sparse data is labelled honestly rather than over-interpreted.
- Progress never changes scoring logic.

---

## 8. Demote per-item /90 estimates and clarify official task-scale displays

### Change
Do not make a converted /90 number the dominant result for individual practice items.

For SWT/SST-style practice, prioritise the task-level trait/result scale already used by the product (for example /9 where applicable). For Essay Practice, explain the existing /26 rubric clearly before showing any converted estimate.

This is a presentation change only; **no scoring formula changes**.

### Pass
- Students see the native practice/task result first.
- Any /90 estimate is secondary and clearly labelled as an estimate.
- Essay Practice explains what the /26 rubric represents.
- No backend scoring thresholds or weights change.

---

## 9. Make Home/resume behaviour explicit

### Change
Home should foreground:
- **Continue your last activity**;
- any active teacher-assigned task;
- a short practice option.

A resume card must identify the exact task/question/mock and return the learner to the correct state instead of only opening the parent section.

### Pass
- Refresh/sign-in shows the correct resumable activity.
- Resume reopens the exact question/mock/draft where technically recoverable.
- Completed work does not remain as an “unfinished” resume card.

---

## 10. Clarify Mock Test labels and remove the empty Full Mock destination

### Change
Keep the agreed Mock Tests structure:
- **Full Mock**
- **Practice Mock**
- **Sectional Mock**

Make scope explicit on each card. FIB-only sets must be labelled as focused practice, not as a full Reading mock.

Until a real full PTE mock exists, do not present an empty Full Mock destination as if it were available. Either hide/disable it with a clear “Coming later” state or remove the tab until content exists.

### Pass
- No mock card overstates its coverage.
- FIB-only sets are clearly identified.
- Users cannot navigate into an unexplained empty Full Mock list.

---

## 11. Reduce confirmation interruptions and add direct retry/revision flows

### Change
Do not confirm every Next/Submit action.

Explain forward-only/no-return behaviour once when a mock begins. Reserve confirmation for:
- final submission;
- abandoning an in-progress attempt;
- destructive reset actions.

After practice results, provide direct actions such as:
- **Retry this question**
- **Revise this response**
- **Next question**
- **Review explanation**

### Pass
- Routine practice requires fewer modal confirmations.
- A learner can move from result to retry/revision in one action.
- No accidental final submission/reset path is introduced.

---

## 12. Standardise SWT source passages

### Change
Bring SWT passages into a consistent editorial specification:
- approximately 200–300 words;
- neutral academic/informational tone;
- clear central idea and supporting relationships;
- no fabricated attribution, citations, institutions or statistics;
- no passage whose answer depends on outside knowledge.

Run the standard across practice, prediction and mock content.

### Pass
- Every published SWT passage meets the length/content rules or has a documented exception.
- Source/attribution fields are either real/verified or absent.
- Teacher review status is visible in content metadata.

---

## 13. Regenerate the September prediction SWT samples

### Change
Regenerate the sample responses for all **18 SWT items** used across the September prediction mocks.

The current samples are not acceptable because they are effectively the first part of the passage copied verbatim, joined with semicolons (roughly 65 words), and often omit the conclusion/relationship.

Samples must:
- summarise rather than copy;
- capture the central idea and relevant support;
- include the key relationship/conclusion where present;
- remain one sentence;
- be teacher-editable;
- avoid invented information.

Add an automated content check that runs each published sample through the existing grader and requires the expected benchmark result before publication. This check validates sample quality; it does **not** alter scoring logic.

### Pass
- All 18 September SWT samples are regenerated.
- No sample is a copied passage fragment.
- Teacher review is recorded.
- CI flags any sample that fails the agreed benchmark.

---

## 14. Improve Reading FIB alternatives and explanations consistently

### Change
Apply the established FIB quality model everywhere:
- grammatically plausible distractors;
- meaningful word-form/collocation/context traps;
- avoid near-synonyms that are equally acceptable;
- sentence-specific explanations for why the answer fits and why alternatives do not.

Keep the newer prediction-pattern FIB work as the model.

### Pass
- All active FIB pools pass the same quality validation.
- Every published FIB has a usable explanation.
- No question has two defensible answers.

---

## 15. Validate SST/audio assets before publication

### Change
Introduce publication checks for listening content, especially SST:
- audio exists and decodes;
- duration is appropriate for the intended task (target range roughly 60–90 seconds for SST unless the specific task spec says otherwise);
- transcript and audio match;
- no silent/corrupt/truncated files;
- playback works in supported browsers.

### Pass
- Broken/missing audio cannot be published.
- Each audio item records duration and validation status.
- The UI has a recoverable error state when playback fails.

---

## 16. Make content source, freshness and repetition transparent

### Change
For prediction/adapted content, record and surface appropriate metadata:
- provider/source;
- date/week;
- adapted/original status;
- last review date.

Because the current mocks reuse a relatively small pool (including 18 unique SWT items, 17 SST items and 36 dictations across a larger mock catalogue), add explicit unseen/revision handling rather than making repeated questions look new.

Expand thin banks over time instead of hiding repetition.

### Pass
- Repeated items can be identified as revision rather than unseen.
- Prediction material has traceable metadata.
- Students are not misled into thinking repeated content is new.
- Bank growth is measured by unique items, not only mock count.

---

## 17. Cap template dependence in Essay Practice

### Change
Keep the existing essay skeleton/structure teaching, but reduce the risk that learners treat a memorised template as exam-ready content.

Add:
- a template-overlap meter against the portal’s stored templates;
- a warning when overlap exceeds a defined threshold;
- guidance to replace memorised wording with prompt-specific argument/content;
- relabel **Exam Template Mode** as **Structure Practice** (or equivalent), making clear that it is a learning scaffold, not a guarantee of exam suitability.

Pearson guidance warns that heavy memorised/pre-prepared material can fail Content and receive no points, so the product should not encourage excessive template copying.

### Pass
- Learners can still use the structure/skeleton.
- High template overlap is visibly flagged before submission/generation.
- UI copy no longer presents a memorised template as inherently exam-ready.
- No score calculation changes are made.

---

## Release sequence

### Release 1 — Foundation
Items **1–5**

Primary outcome: faster, cleaner, accessible production frontend with one design system and a build pipeline.

### Release 2 — Highest student-content risk
Items **13 and 17**

Primary outcome: reliable SWT benchmark samples and safer essay-structure teaching.

### Release 3 — Learning guidance and result clarity
Items **6–8 and 12**

Primary outcome: clearer daily direction, useful progress, clearer score presentation and consistent SWT material.

### Release 4 — Mock/practice flow and content trust
Items **9–11 and 14–16**

Primary outcome: clearer mock scope, better resume/retry flow, higher-quality FIB/audio content, and transparent freshness/repetition.

---

## Definition of done for every item

- Existing scoring logic remains unchanged unless a separate scoring task is explicitly approved later.
- `npm test` passes.
- JavaScript syntax/build checks pass.
- `git diff --check` passes.
- Sign-in, Home, Practice, Mock Tests, progress, result review and account flows are smoke-tested.
- Existing attempts/progress remain readable.
- Railway deployment completes successfully.
- The release note states what changed, what was tested, and what remains deferred.
