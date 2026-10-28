# Full Mock — Phase 1 scoring and content audit

Checked: 28 October 2026. Source revision: `89c096860cc262f06d435c1c102691a655ff45be` on `main`.

The Phase 1 implementation adds an immutable 65-question blueprint, all 22 task
contracts, an explicit integrated-skill matrix, scoring-source fingerprints, and a
repeatable content audit. **Editorial clearance is still pending.** This change
does not create a student paper, expose new routes, assess student answers, or
modify completed sectional attempts. PR #218 was open and unmerged at this audit;
none of its proposed score conversions are imported here.

## Commands

```sh
npm run audit:full-mock
node scripts/audit-full-mock.js --json
npm run validate:full-mock
node --test tests/full-mock-audit.test.js
```

The ordinary audit exits successfully when the audit runs and the scoring source
lock matches, even when content gaps are reported. `validate:full-mock` is the
strict **candidate-coverage** check: it also fails while the reviewed eligible
pool cannot cover the blueprint. It is intentionally failing at this baseline.
Neither command authorizes publication. A Phase 2 frozen selection must additionally
pass `validateSelection`, every selected candidate's review/asset checks, and the
subsequent player, scoring and reporting release criteria.

Existing production CI runs `npm test`, including the new audit regressions. The
strict content check is separate so unfinished Full Mock content cannot stop
unrelated improvements to the live sectional portal.

## Inventory findings

The inventory reads the three Speaking papers, three core Reading sets, SWT and
Essay items from two Writing papers, and the three Listening papers. Repeated
appearances of an identical speaking item are combined under one namespaced ID.
This is a candidate inventory, not an assembled full test or an exhaustive claim
about every standalone practice library in the repository.

| Task | Required | Candidates | Technical checks passed |
| --- | ---: | ---: | ---: |
| Read Aloud | 6 | 18 | 18 |
| Repeat Sentence | 10 | 30 | 30 |
| Describe Image | 5 | 15 | 15 |
| Retell Lecture | 2 | 5 | 5 |
| Answer Short Question | 5 | 0 | 0 |
| Summarize Group Discussion | 2 | 5 | 5 |
| Respond to a Situation | 2 | 5 | 5 |
| Summarize Written Text | 2 | 4 | 0 |
| Write Essay | 1 | 2 | 0 |
| Dropdown blanks | 5 | 17 | 17 |
| Reading multiple answers | 2 | 6 | 6 |
| Reorder Paragraphs | 2 | 6 | 6 |
| Drag-and-drop blanks | 4 | 12 | 12 |
| Reading single answer | 2 | 6 | 6 |
| Summarize Spoken Text | 1 | 3 | 0 |
| Listening multiple answers | 2 | 6 | 3 |
| Typed listening blanks | 2 | 6 | 0 |
| Highlight Correct Summary | 2 | 6 | 6 |
| Listening single answer | 2 | 6 | 0 |
| Select Missing Word | 1 | 3 | 0 |
| Highlight Incorrect Words | 2 | 6 | 0 |
| Write from Dictation | 3 | 9 | 0 |

There are 176 candidates across 21 types; 134 pass the current technical checks.
Technical success does not establish authorship, answer correctness, intelligible
audio, image readability or calibrated difficulty. All 176 still need a
full-mock-specific editorial record. Missing evidence is not evidence of a rights
violation or an incorrect answer. Shared instructions supplied by an existing
sectional player are also not necessarily embedded in its question data.

The machine checks found these concrete preparation tasks:

- Add five original or appropriately licensed ASQ items, accepted answer variants,
  fixed recordings, and an ASQ scoring adapter. Existing speaking services only
  support RA, RS, DI, RL, SGD and RTS.
- Replace or reauthor the chosen Listening stimuli to meet their own prompt
  ranges. Twenty-nine candidate recordings are outside range: three LMCMA,
  six LFI, six LMCSA, six HIW and eight WFD. This is not a proposal to change the
  existing sectional papers. LMCMA currently publishes 80–120 seconds, LFI and
  LMCSA 30–60 seconds, HIW 15–50 seconds, and WFD 3–5 seconds. The bounds and
  source URLs are explicit in `full-mock/blueprint.js`.
- Bundle the selected SMW recording, including its end cue. All three current
  candidates use runtime narration and cannot be treated as frozen audio.
- Embed and review task instructions for the chosen writing/SST/WFD items.
  Eighteen candidates currently lack an instruction field in their saved data.
- Avoid shared content across sections. The inventory identifies 22 distinct
  overlapping candidate pairs, represented by 40 source/stimulus groups. This
  includes RS/WFD aliases and Read Aloud excerpts whose parent lectures reappear
  in Listening. Different question IDs alone are insufficient.

Audio hashes, transcript hashes, byte lengths and MP3 frame integrity were checked
for 87 bundled candidate recordings. Duration checks use the pinned recording
manifest; they are not an independent acoustic timing or intelligibility review.
All five SGD candidates have three transcript speakers and three distinct voice
identifiers. This does not replace listening to the recordings. The fifteen DI
candidates match their source and display image hashes; their labels and
reference facts still require full-mock visual review.

## Scoring audit contract

`full-mock/rubrics.js` records the existing task rules, trait maxima, gating
criteria and source files. It preserves blank-level partial credit, correct
adjacent reorder pairs, MCMA/HIW penalties with a zero floor, and Content/Form
gates. WFD's existing sequence matching and RS's alignment thresholds are recorded
as practice policies, not represented as Pearson's proprietary implementation.

The source lock covers 27 files, including the scorer entry points, shared
policies, blueprint/rubric contracts and server dispatch. A changed, missing or
extra pin fails the audit and regression check. Review the actual change before
updating a pin; do not regenerate a lock just to make a failure disappear.

The lock pins **source code**, not deployed model configuration. For example,
`gpt-speaking-delivery.js` composes its version with a runtime-selected model, so
the audit records the expression instead of mislabelling the prefix as a complete
version. Phase 2/4 must capture model/provider configuration and rubric versions
with each frozen attempt and assessment. No provider calls occur during this audit.

The eight integrated routes are RS/RL/SGD → Listening + Speaking; SWT → Reading +
Writing; SST/WFD → Listening + Writing; HCS/HIW → Listening + Reading. RA contributes
to Speaking, ASQ to Listening, dropdown FIB to Reading, and typed listening FIB to
Listening. Overall requires a separate profile and counts each task once. The
matrix alone does not specify which traits route into each skill; that mapping
must be validated in the unified scoring implementation.

Five independent weighting profiles remain a Phase 4 requirement. The indexed
Pearson partners document contains average weights, including three Overall cells
published only as `<1%`. Direct opening of that URL on the audit date returned an
Institution Score Guide rather than the indexed partners report. Resolve this
source mismatch before locking numeric profiles. Do not silently replace `<1%`
with 0.5%, force rounded totals to 100, invent difficulty adjustments, average
sectional reports or import the independent holistic Speaking-mock estimate.
Practice estimates remain provisional and uncalibrated, and required pending or
failed assessments must block the corresponding final estimate.

**Phase 4 follow-up:** the actual partners report was retrieved from Pearson's
download CDN and its weighting table visually checked. See
`docs/full-mock-phase-4.md` for the verified source digest, five versioned profiles,
bounded `<1%` contributions, native adapters and provisional index contract. The
source mismatch above remains part of this historical Phase 1 audit record.

## Editorial evidence format

`content/full-mock/reviews.json` starts empty deliberately. Add only reviews that
have actually been performed. Each entry is keyed by the inventory ID and binds
to the candidate fingerprint returned by the JSON audit:

```json
{
  "fingerprint": "<current candidate fingerprint>",
  "rights": { "status": "original", "reviewer": "<name>", "date": "YYYY-MM-DD", "evidence": "<authorship or licence record>" },
  "answerKey": { "reviewer": "<name>", "date": "YYYY-MM-DD", "evidence": "<answer/rubric verification>" },
  "difficulty": { "band": "medium", "basis": "editorial", "reviewer": "<name>", "date": "YYYY-MM-DD", "evidence": "<reason for classification>" },
  "instructions": { "reviewer": "<name>", "date": "YYYY-MM-DD", "evidence": "<instruction check>" }
}
```

Rights status must be `original` or `licensed`; `verbatim-user-provided` and
`adapted` provenance by themselves do not prove suitable permission. Audio tasks
also require an `audio` review stamp, and DI requires a `visual` review stamp with
the same reviewer/date/evidence shape. Changing the question, key, instructions,
timers or asset descriptors invalidates the fingerprint. Actual asset-byte changes
also fail integrity checks. Difficulty labels describe content coverage only and
never adjust a student's score.

## Following phases

1. **Phase 1:** audit implementation and code verification; editorial content
   clearance remains open as recorded above.
2. **Phase 2:** author/clear the missing content, select 65 unique items in the
   blueprint's order, complete editorial evidence and freeze a server-side paper.
3. **Phase 3:** build the continuous player, microphone check, preparation/audio
   states, authoritative deadlines, forward-only submission and recovery.
4. **Phase 4:** add assessment adapters and the five independently versioned score
   profiles, completeness rules and protected result aggregation.
5. **Phase 5:** expose the submitted-only practice report, feedback and history.
6. **Phase 6:** validate desktop/mobile media, resilience and scoring regressions;
   calibrate only against consented independent reference data.

## Primary references

- [Pearson Test Taker Score Guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/resources/PTE-Academic-Test-Taker-Score-Guide.pdf), scoring criteria and skill routing, pages 15–44.
- [Speaking & Writing format](https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/).
- [Reading format](https://www.pearsonpte.com/pte-academic/test-format/reading/). Some introductory/legacy notes on format pages conflict with the task tables; the current Score Guide's task tables govern the skill matrix.
- [Listening format](https://www.pearsonpte.com/pte-academic/test-format/listening/), task-specific recording lengths.
- [Indexed partners report URL — requires re-verification](https://www.pearsonpte.com/ctf-assets/yqwtwibiobs4/UK8K7chHjNJhW9paYHxBd/8e89376c8a2a1d2efee4e3c0ec8200ee/pte-scoring-info-for-partners-report.pdf).
