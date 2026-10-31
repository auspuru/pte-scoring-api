# Describe Image reference review — 1 November 2026

Baseline: `d4b9f49441fb6eabb421fd10cfda93b98e8415de`.
Scope: eight findings from the reference audit, practice and current Speaking mocks. All 54 DI entries retain their original source identities; no image bytes, historical Full Mock papers, student answers, confirmed marks, providers or grading policies are changed.

## Fix register

All supplied assets below are `public/assets/di-predictions-20260930/<source ID>.png`. Before-reference fingerprints, samples, original image URLs and byte hashes are retained in `content/di-reference-history.json`. After-reference mappings and hashes are in `content/di-reference-manifest.json`, version `di-image-reference-2026-11-01.1`. Review is assistant visual/source inspection, not independent human certification.

| Source ID | Severity | Observed evidence | Correction / status |
| --- | --- | --- | --- |
| 3000137 — India Land Use | Medium | Shared facts named categories but did not describe their spatial distribution. The prior repair was limited to the Speaking worker. | Checked: shared practice/new-mock reference now includes spatial relationships, legend colours and absence of quantities. Existing historical Speaking repair is retained. Speaking Mock 2 uses this source. |
| 3000885 — Honey Production | Medium | Reference omitted visible percentage bands. | Checked: include all four bands, regional distribution and the distinction between national production share and land area. No state names or exact within-band values are invented. |
| 3000589 — Climate Zones | Medium | Reference omitted several legend categories. | Checked: all six categories, inland/coastal/northern distribution and categorical limits. |
| 3000580 — Australian Population Density | Medium | Reference lacked density units and bands. | Checked: five bands, people per square kilometre, coastal/interior distribution and separate distance-scale units. |
| 3000365 — World Population Density | Medium | Reference omitted legend bands and units. | Checked: all six bands, units, broad density patterns and limitations on exact population claims. Speaking Mock 3 uses this source. |
| 3001398 — Australian Birth Trends | Medium | Title/sample implied birth trends; the image compares resident populations by foreign country of birth. | Checked: corrected display/reference/sample title and scope, all country labels, date colours and count-axis context. Bar readings remain approximate. |
| 3001061 — Taxation | High | Several country labels and most exact quantities cannot be established from the supplied image. | Issue / source pending: withheld from new scored practice and direct starts until a clearer original is supplied and reviewed. Existing attempts/media/marks remain accessible. Not selected in the current Speaking/Full Mock papers. |
| 3001369 — Influenced English | High | Pie has no readable category labels, legend or numbers; its subject cannot be verified from the image. | Issue / source pending: withheld from new scored practice and direct starts. Do not infer labels from the catalogue title. Existing attempts/media/marks remain accessible. Not selected in the current Speaking/Full Mock papers. |

## History and assessment boundaries

New DI practice attempts save a full question snapshot. Legacy DI practice without a snapshot uses the retained original reference for these eight IDs. Viewing/resuming an existing held question is allowed; starting a fresh scored attempt is not. Existing confirmed results are not regenerated. A separate, explicitly scoped reassessment would be required to apply reviewed references to old answers.

Full Mock v1/v2 frozen papers retain all ten DI slot mappings and parent identities. Current Speaking mocks retain 15 slots; every selected slot is eligible. The source corrections affect new authoring through the canonical shared reference loader. A separate deployed Academy service is not independently synchronized by this change.

## Reproduction and verification

Run all commands through the test-and-release skill's safe launcher:

- `node scripts/verify-di-reference-sync.js`: all 54 source-bound reference mappings, samples and optional indices.
- `node scripts/verify-di-display.js`: 49 supplied original/display image pairs and 15 current Speaking mock placements.
- `node --test tests/di-reference-completeness.test.js tests/di-reference.test.js tests/di-image-display.test.js tests/speaking-practice-modes.test.js`: source preservation, facts, legacy review, saved snapshot isolation, both held questions, bypass prevention, idempotent resume, confirmed-result preservation, all current mock slots and both frozen Full Mock versions.
- `node scripts/verify-release.js` and final-head Portal CI: complete release/calibration/build checks and required isolated browser/PostgreSQL evidence.

Live provider quality and independent editorial review remain unverified by synthetic tests. The two unreadable sources remain explicitly unresolved; withholding them prevents new assessments from depending on guessed reference material.
