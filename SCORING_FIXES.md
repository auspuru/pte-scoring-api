# SWT scoring policy — draft 20.3.0

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

The draft does not modify production passages, accounts, progress records or deployment settings.

## Calibration and verification

The fixtures in `tests/swt-meaning-fixtures.json` preserve the four new user-supplied examples: film editors (74 words), caffeine and bees (64), number processing (75), and forgetting (61). Their expected scores are 4 + 1 + 2 + 2 = 9. Earlier user benchmarks remain in `passages.json`.

Run the dependency-free checks:

```bash
node --test tests/swt-scoring-policy.test.js
```

The 17 checks exercise the grading route with fixed, human-labelled semantic assessments. They cover expected full scores, missing causes despite complete checklist coverage, missing conclusions, errors that change meaning, invalid form, and provisional fallback.

These checks verify deterministic scoring behavior, not a live AI model's understanding. Live semantic calibration remains necessary before release. Syntax checks for the server and client also pass.

The existing server smoke test (`node tests/calibration.js`) requires the app dependencies. With no AI key, it checks provisional scoring and the existing student-admin-entry gate. That smoke test was not run in this workspace, where the app dependencies were unavailable.

## Release state

This is a draft for the user's sample review; it has not been deployed.

At inspection, production ran commit `b11c6631fb5fe43af22b2879b6c514253ab7f726`, while `main` was two commits ahead at `d705781022dbefaced43ba34d9c252f444f61689`. This draft is based on `main`. Account for its earlier pending changes before any release.
