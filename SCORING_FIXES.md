# Pearson-calibrated SWT scoring fix — v20.2.0

## Authoritative scoring criteria

The score is calculated from this fixed **9-point SWT profile**:

- **Content — 4 points:** accurately communicate the central message and at least two important supporting ideas. One secondary omission is acceptable. The stored What/Why/How/Result headlines are diagnostic coaching prompts, not four compulsory boxes.
- **Form — 1 point:** write exactly one sentence containing 5–75 words and end it with sentence punctuation.
- **Grammar — 2 points:** use a complete, clear and controlled sentence. Minor local errors may remain when meaning is unaffected. No fixed connector or semicolon pattern is required.
- **Vocabulary — 2 points:** use accurate, context-appropriate wording. Faithful source wording and accurate paraphrasing are both valid. No fixed number of synonym swaps is required.

A Band 9 result requires full Content, valid Form, clear cohesion, no material meaning change, at least 8/9 raw points, Grammar of at least 1.4/2 and Vocabulary of at least 1.5/2.

## Changes in this package

- The scoring criteria above are defined once in `server.js` and returned with each score result for transparent auditing.
- The four Pearson official mock-test responses supplied by the user remain regression-calibration cases.
- Incomplete, contradictory, fabricated and off-topic responses remain blocked from Band 9.
- The **student-facing admin panel link, launch control and embedded modal are removed entirely** from `public/index.js`, including entries inserted after login.
- Existing protected server maintenance APIs are not used to calculate student scores.

## Files

- `server.js` — authoritative scoring engine
- `passages.json` — diagnostic passage headlines and Pearson calibration cases
- `public/index.js` — student portal with the admin entry removed
- `tests/calibration.js` — scoring and admin-entry regression tests

## Run the tests

```bash
npm install
npm run test:calibration
```

The test starts a temporary local server, checks all four Pearson calibration responses, checks negative controls and verifies that the student client cannot expose an admin navigation entry. No Anthropic key is required.

## Production passage data

Where production passage records are stored in PostgreSQL or a persistent JSON volume, update those stored records directly from `passages.json` during deployment. The scoring engine itself does not depend on an admin panel.
