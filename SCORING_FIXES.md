# SWT scoring and student experience — 20.3.0

This is the institute's practice-scoring policy, calibrated against user-supplied examples. It does not claim to reproduce Pearson's proprietary scoring engine.

## Rules

- **Content — 4:** capture the central message, one or two relevant supporting ideas, and the passage conclusion where present. Preserve the necessary cause, background, references and relationships. A conclusion can be combined with another idea or clearly implied.
- **Grammar — 2:** minor article, agreement, spelling, repetition or punctuation slips do not reduce scores when meaning remains clear. Every deduction requires a quoted grammatical error and an explanation of how it changes or obscures meaning.
- **Vocabulary — 2:** source wording and accurate paraphrases are acceptable. Minor recoverable imprecision is optional feedback, including the supplied caffeine example. Wording that changes or obscures meaning loses marks.
- **Form — 1:** the existing one-sentence, 5–75-word checks remain.
- **Full result:** all these conditions produce 9/9. The top band label requires this complete assessment.

Missing necessary causes or context lower Content, without an automatic Grammar deduction. Compression of a causal chain is valid when its connection remains understandable. Descriptive and contrastive passages do not require invented cause-and-effect relationships.

## Implementation

The scoring policy module defines the rubric and validates the semantic assessment. The grader identifies the main idea, relevant support, conclusion status and missing dependencies. Counting matching headline ideas can no longer override missing relationships.

Harmless language corrections retain an explicit no-deduction label. Errors that affect scores retain a quotation and an explanation of their effect on meaning.

When the AI assessment is unavailable or incomplete, the result is marked provisional and cannot receive full Content from keyword overlap alone. The student notice explains this limitation.

This update does not modify production passages, accounts, progress records or deployment settings.

## Calibration and verification

The fixtures in `tests/swt-meaning-fixtures.json` preserve the four new user-supplied examples: film editors (74 words), caffeine and bees (64), number processing (75), and forgetting (61). Their expected scores are 4 + 1 + 2 + 2 = 9. Earlier user benchmarks remain in `passages.json`.

Run the dependency-free checks:

```bash
node --test tests/swt-scoring-policy.test.js tests/swt-feedback.test.js
```

The 23 checks exercise the grading route with fixed, human-labelled semantic assessments. They cover expected full scores, missing causes despite complete checklist coverage, missing conclusions, errors that change meaning, invalid form, and provisional fallback.

These checks verify deterministic scoring behavior, not a live AI model's understanding. Live model calibration has not been run in this workspace; model judgments may vary. Incomplete AI assessments are explicitly provisional. Syntax checks for the server and client also pass.

The existing server smoke test (`node tests/calibration.js`) requires the app dependencies. With no AI key, it checks provisional scoring and the existing student-admin-entry gate. That smoke test was not run in this workspace, where dependency installation could not complete because network approval was cancelled.

## Student experience

- A focused reading and writing layout, with responsive stacking for tablets and phones and support for the existing light and dark themes.
- Labelled passage controls, keyboard-accessible tabs, a clear word-count status, a larger editor, planning notes and undo for clearing a draft.
- Practice scores out of nine are prominent, with the existing PTE estimate shown separately.
- Feedback identifies missing context and meaning-changing errors, while harmless corrections are grouped under optional refinements with no deduction.
- Sample comparison, trait explanations and expandable passage/vocabulary details support revision without requiring every diagnostic idea or a fixed number of synonyms.
- Source wording is described as a text comparison; the previous hardcoded authorship claim is removed.

The six additional feedback checks cover optional refinements, missing causes, meaning-changing grammar, provisional assessments, invalid form and escaping at the rendering boundary. HTML checks confirm unique IDs and valid control/label references. No browser-based visual or end-to-end tests were run.

## Release

The user authorised pushing all updates on 8 September 2026. This release combines the saved scoring draft and the SWT interface/feedback changes, based on main at d705781022dbefaced43ba34d9c252f444f61689.
