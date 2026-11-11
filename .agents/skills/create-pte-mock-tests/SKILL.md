---
name: create-pte-mock-tests
description: Create full, Speaking, Writing, Reading and Listening mock tests for IPT Brisbane in auspuru/pte-scoring-api. Use for additional papers, prediction-based mock sets and mock question replacements. Covers question selection, audio/images, clocks, scoring integration, catalogue exposure, reports, saved attempts, validation and publishing.
---

# Create PTE Mock Tests

Use this file as the complete creation handbook. Execute its bundled preflight without reading its implementation. Do not reopen old conversations, Library tester guides or the practice-question skill to rediscover instructions. Read supplied source material and the precise code/data sections being edited. Follow higher-priority environment instructions. If a contract has changed, inspect the affected loader/validator and update this skill after verified implementation.

## Scope and operating defaults

- Repository: `auspuru/pte-scoring-api`, default branch `main`; portal `https://swt.up.railway.app/`. Use a clean isolated branch/worktree from freshly fetched main and preserve unrelated work. Verified against `f393d3c7eb3aec02707cc723756ab77b81b1c419` (Full Mocks 2/3 and multi-paper registry), 3 November 2026.
- Determine the requested engine: full, speaking, writing, reading or listening. Infer from the current request/context; ask one concise question only when the engine cannot be determined. Use the next unused paper number by default. Distinguish **another selectable mock** from **a new question version of an existing mock**; do not silently substitute one for the other.
- Prefer existing approved/prediction content and ready recordings. Use real supplied DI images. Make question selection deterministic; snapshot definitions instead of selecting new random questions every time a saved attempt is opened.
- Preserve all existing papers, question identities, student answers/audio, marks, report versions, access, navigation, timing and scoring. A request for a new mock authorizes necessary content-selection/catalogue integration and normal publishing, not a scoring redesign, reassessment or account/environment reset.
- Retain GPT 6.1 Sol (`gpt-6.1-sol`) for mock content, Visual Academy DI scoring and Azure-only pronunciation/fluency. Preserve connected-meaning RL/SGD/RTS policies. Reuse configured keys without revealing, replacing or unnecessarily asking for them.
- Keep the original IPT Brisbane logo, clean relaxed layout, full-screen mock flow, headset test, preparation countdown and seamless Next. Do not introduce a preview label, per-question popup, scoring-weight/formula explanation, CEFR block or new visual redesign.
- Speaking **practice** gained timed/untimed modes in #247. Mock tests retain their own timed contracts; never inherit an untimed practice flag into a mock.
- Treat draft/plan-only requests as draft/plan-only. Otherwise carry the work through meaningful tests, successful CI, publication and confirmed deployment. Do not add another approval checkpoint for routine work already authorized.

## Inspect and capture before editing

Set `PTE_REPO` to the checkout, `PTE_MOCK_SKILL_DIR` to this installed skill directory and `PTE_MOCK_BASELINE` to a fresh temporary filename. Never repurpose HOME or CODEX_HOME. Install matching dependencies with `npm ci --ignore-scripts` only when absent; inspection must not launch narration/postinstall.

```bash
node "$PTE_MOCK_SKILL_DIR/scripts/mock_preflight.js" inventory --repo "$PTE_REPO"
node "$PTE_MOCK_SKILL_DIR/scripts/mock_preflight.js" capture \
  --repo "$PTE_REPO" --file "$PTE_MOCK_BASELINE"
# After implementation:
node "$PTE_MOCK_SKILL_DIR/scripts/mock_preflight.js" verify \
  --repo "$PTE_REPO" --file "$PTE_MOCK_BASELINE"
```

The read-only helper records all engine definitions, frozen versions, Reading compositions, existing practice fingerprints, source pins and native objective scorer functions. It imports definitions without starting the server or calling providers. Default verification permits additions and protects every old mock/practice question. Use `--replace 'engine/id'` only for an explicitly requested replacement of a non-frozen existing mock; it can never waive an old frozen Full Mock. Use `--allow-source exact/path` only after reviewing a necessary supported integration change, never to bypass a grader/UI/timing change. For an intended change of the default active Full Mock, name the exact `--activate 'full-mock-1@v3'` (using the actual target), rather than silently switching the default while adding another selectable paper. Native score functions, weighting profiles and the Full Mock blueprint remain protected. Audit expected new IDs and exposure separately: guard success alone does not prove a playable mock.

Write a compact paper manifest before implementation: engine, stable ID/title/version, task counts/order, chosen source IDs, source/adaptation provenance, clock policy, ready/missing audio/images, catalogue entry and intended audience. Resolve missing content/media concretely. Do not invent question availability, media quality or user approval.

## Engine map and creation paths

| Engine | Definition | Runtime / catalogue |
|---|---|---|
| Full | `content/full-mock/papers/<paper-id>.vN.json`, `catalogue.json`; authoring/audit in `full-mock/` | `full-mock/api.js`, `session.js`, `store.js`, `assessment.js`, `report.js`; `public/full-mock-client.js` / report |
| Speaking | `content/speaking-mocks.js` exports `papers`, `catalogue`, `publicQuestion` | `speaking-mock.js`, store/jobs/report/Azure modules; exposed through Speaking and Writing-lab catalogues |
| Writing | Explicit `content/writing-lab.json.mocks` or generated `.predictionEssays` through `writing-lab.js.predictionMocks` | `writing-lab.js` merges `allMocks`; `public/writing-lab-client.js`; common mock report UI |
| Listening | `content/listening-mocks.js` exports `mocks`, `missing`, `listeningFormat` | Merged into `writing-lab.js.allMocks`, `/api/writing-lab/catalog.listeningMocks` |
| Reading | `public/reading-bank.json`, `public/reading-mock-tools.js` composers | `public/practice-catalogue.js.readingMocks`, `public/reading-practice.js`, exam player/session timing |

### Speaking: add a selectable paper

Append a new stable `speaking-mock-N` to `content/speaking-mocks.js.papers`, using its existing `paper(number,items)`, `source(q,folder,id)`, `readAloud(q)` and `repeatSentence(q)` helpers. Keep all earlier array entries unchanged. `paper()` is internal to that module; call it there, not through a nonexistent exported authoring API. The `/api/speaking-mocks/catalog` and start lookup use the exported papers.

Standard existing paper: unscored introduction, then **6 RA, 10 RS, 5 DI, 2 RL, 2 SGD, 2 RTS** = 27 scored / 28 items. Preserve existing types/order unless the user specifies a different bounded practice format; label any custom format accurately. Intro is 25 s preparation/30 s response and never contributes marks.

Build a fixed selection from explicit source IDs. Copy new arrays/objects; never mutate the shared source bank. `source()` attaches `{audioSource:{folder:'speaking'|'writing',id},audioSeconds}` and verifies the transcript SHA. RTS uses its versioned `promptAudioKey`. Source question IDs may repeat across different papers, but must be unique within one paper, with no repeated passage/parent recording. RA/RS adapted from other tasks require honest source metadata and must not duplicate their parent elsewhere in the same paper.

For each DI, `suppliedMockImage()` requires an original user-supplied chart/diagram, matching image/reference hash, sample and facts; no stock photo/generated replacement. Preserve the instructor-approved **40-minute overall clock** for new Speaking starts and reattempts (`content/speaking-mocks.js.OVERALL_MINUTES`; PR #287, 4 November 2026). Existing attempts retain their serialized deadlines. Keep individual prompt/preparation/recording/cue windows intact; calculate their actual total to identify a content/time conflict rather than silently changing the overall clock. Update only content-related count expectations in validators. Verify catalogue/start/reattempt, saved-deadline preservation and old paper hashes. Do not change overall scoring while creating another Speaking paper.


### Instructor defaults for new Speaking mock content (11 November 2026)

- Ask before implementation when the instructor explicitly requests a review or approval first. Confirm the proposed scope, then carry out their approved scope without asking again.
- Use five DI images in this order: **one pie chart, one static bar chart, one grouped bar chart requiring comparison, one line chart, then the existing final process/diagram**. Keep the final image unchanged when requested. Choose different original images for each mock, sourced from supplied material or the internet; never redraw charts or invent data. Preserve source URLs, figure/page identity, original bytes, reference/display hashes, matching facts and a grounded sample. Multiple different figures may come from one source document.
- Start with eight easy Repeat Sentences of 6–8 words (normally 7–8); no Repeat Sentence may exceed 12 words. Use distinct sentence texts and recordings across the requested mocks. Do not duplicate one recording under new IDs or repeat a parent stimulus in the same mock.
- If existing audio is reported distorted, treat it as an audio-quality repair: replace only the affected mock recordings with immutable new IDs/URLs and matching exact transcripts. Preserve old audio and prompt lookup for saved attempts. Prefer stable natural narration at normal speed; do not fix distortion by time stretching, replaying, duplicating, silence-padding, or truncating speech. Decode every replacement and inspect sample rate, duration, peak/clipping, missing or invalid samples, and transcript agreement. For short 6–8-word sectional Repeat Sentences, natural 2–3-second audio is acceptable; do not slow or pad clean speech merely to meet the older 3-second minimum. Preserve frozen Full Mock audio bounds. Do not claim human listening or physical-device verification when only automated checks were run.
- Keep edits and checks targeted to the affected mock definitions, media/manifests, reference registries, relevant tests and this skill. Snapshot unaffected papers and historical asset entries, then verify they remain unchanged. Do not change scorers, accounts, report rules, timers, player code, global build/release configuration or unrelated tests for a content/audio repair.
- When the instructor explicitly says **skip CI**, respect that exception: use targeted local content/audio/reference/playback checks and commit with `[skip ci]`; do not launch the full regression/database/browser suites. State which checks were run. Existing platform build checks may still run during deployment; do not alter global build settings solely to bypass them. Otherwise follow the normal CI workflow below.
- A content revision updates new starts and reattempts. Existing saved attempts retain their exact question snapshots and prior recordings. For Speaking Mocks 4/5, retain all historical prompt entries in `audioQuestions` before replacing the current selection; immutable URLs must remain playable. Compare the requested five-image order by question identity/role, not only by broad `imageCategory:'bar'`.

### Random single-task practice sets

`random-practice.js` owns the eligible pools and server-side selection for Read Aloud, Repeat Sentence, Describe Image, Retell Lecture, Respond to a Situation, Summarise Group Discussion and Write From Dictation. Students choose one type and 5/10/15/20 questions; never expose manual question selection, mixed types or a client-controlled seed. Advertise only counts supported by the actual ready pool, with no repeats within a set. Prefer unused questions from that account's earlier sets where possible. Keep RS at at most 12 words and exclude unavailable images or prompt audio.

Speaking types reuse `/api/speaking-mocks/attempts`; WFD reuses `/api/writing-lab/attempts`. Creation accepts `practiceSet:{type,count}` and snapshots the server-selected questions in the existing owned stores. Reopening or retrying the same creation UUID must retain that exact selection; a fresh set/reattempt can select new questions. The shared `/api/practice-sets/catalog` and `/attempts` routes are authenticated and honour existing speaking access. Overall and individual results come from the existing native graders/reports, including zero-credit deliberate skips. Keep ordinary mock definitions and all native scoring sources unchanged.

The portal entry is Practice → Random practice sets, implemented by `public/random-practice.js` with existing speaking/dictation players. Targeted coverage is in `tests/random-practice.test.js`, `tests/random-practice-client.test.js` and `tests/random-practice-browser.system.js`. Do not generate extra questions/audio merely to fill an unsupported count without authorization for new content.

### Writing: explicit or prediction paper

Standard order: **2 SWT, 1 essay, 1 SST, 3 WFD**. SWT 10 minutes each; essay 20; SST 10 including listening; three WFD share **one 4-minute `timeGroup:'dictation'`**. Total 54 minutes, not 62. Use the existing `minutesFor()` calculation rather than summing a shared clock three times.

```js
// Append to content/writing-lab.json.mocks for an explicit selected paper.
{id:'writing-mock-3',title:'Writing Sectional Mock 3',category:'special',
 description:'...',questions:[swt1,swt2,essay,sst,wfd1,wfd2,wfd3]}
```

Alternatively append a new `.predictionEssays` row with unused `predictionNumber`, `title`, exact `text`, `keyPoints`, 200–300 word `sample`. `writing-lab.js` creates `writing-prediction-mock-NN` and selects other prediction tasks. Preserve prior essay order/numbers. Do not modify prediction pool sizes or modulo/round-robin algorithms merely to select one new paper: those can rewrite every previous prediction mock. Use an explicit `.mocks` entry for exact source choices. If extending generated selection, prove all older mock manifests unchanged.

The new mock enters `allMocks` and the catalogue automatically through `.mocks`; verify that the rendered card's existing title mapping and `testId` open the intended paper. Snapshot cloned question rows in attempts. Reuse existing graders and narration resolver; do not write an alternate essay/SWT scoring implementation.

### Listening: append all eight task types

Standard existing order: **1 SST, 2 LMCMA, 2 LFI, 2 HCS, 2 LMCSA, 1 SMW, 2 HIW, 3 WFD** = 15 questions. Published configuration ranges in `listeningFormat` allow 2–3 for several types, 1–2 SMW and 3–4 WFD; use the existing standard unless the user requests otherwise.

Append a new `listening-mock-N` object to the exported mocks in `content/listening-mocks.js`; the current generator creates exactly three papers, so adding unused source rows alone does not create paper four. Do not change the original three selections. Use an explicit new paper or safely extend its definition list with stable IDs.

```js
{id:'listening-mock-4',title:'Listening Sectional Mock 4',module:'listening',
 questions:[{...sst,minutes:10},...remainingQuestions.map(q=>({
   ...q,minutes:25,timeGroup:'listening'}))]}
```

This engine gives SST 10 minutes and the remaining items one shared 25-minute clock: 35 minutes total. Reuse source `audioId` for objective tasks only when its complete text matches. New SST/WFD/SMW narration-owning IDs must be included in `writing-lab-audio.js` lookup; new SMW should enter the exported `missing` collection used by lookup/prewarm. Objective items with an existing audioId reuse that source's recording. Catalogue and attempt exposure are through Writing-lab; a `module:'listening'` paper must not be mislabeled Writing. Add matching keys/explanations and confirm report/alert handling for the new ID.

### Reading: pure section versus integrated paper

Current **Reading Practice Mocks 1–15** are Reading-only, 23 minutes, and compose **5 dropdown, 2 MCMA, 2 reorder, 5 wordbank, 2 MCSA** in that order (16 questions). A different valid full Reading section can follow the existing ranges: dropdown 5–6, MCMA 2–3, reorder 2–3, wordbank 4–5, MCSA 2–3; 23–30 minutes. Keep existing 25-minute legacy sets and their timers unchanged.

To add Reading Practice Mock 16, update all three content/identifier boundaries: `public/practice-catalogue.js` generated catalogue length (15), `public/reading-mock-tools.js.practiceMockNumber()` upper bound (15), and `public/reading-practice.js.isReadingPracticeMockId()` upper bound (15). Reuse `composeReadingPractice()`, preserve seeds and question selections for mocks 1–15, and prove the new ID starts and is recognized as an exam by `public/reading-exam-player.js.isExam()`. Changing only the catalogue card is insufficient.

For an exact fixed new section, add an explicitly-IDed set (prefer `importedSets` when adding to rotating `sets` would affect old papers), then a `sectionalMocks` entry with `id`, `name`, `setId`, `minutes:23` and optional `questionRefs:[{setId,questionId}]`. The current `compose()` sectional fallback searches `bank.sets`, and its questionRefs lookup also searches `bank.sets`: extend those lookups to the union with `importedSets` for an imported fixed set, without changing the old rotating pool. Confirm catalogue exposure too: the top-level `readingMocks()` mainly lists `mockCatalogue` plus the synthetic 15. Add a minimal catalogue mapping for the new sectional ID if absent; keep launch mode, exam-ID recognition and title accurate.

Do not accidentally create an **integrated** paper when Reading-only was requested. Most `reading-bank.json.mockCatalogue` entries (`practice-mock-N`, family practice/sectional) add **2 SWT + Reading + 2 HCS + 2 HIW**, using `setId`, `swtOffset`, `audioQuestionIds`, timed/family/minutes metadata. `kind:'reading-blanks'` follows a separate Reading-only composer. `composeIntegrated()` requires two distinct SWT sources and complete HCS/HIW recordings, and supports a shared overall or staged clock. Retain its existing stage semantics; compute total from the actual plan rather than relabeling it a 23-minute pure Reading mock.

Changing Reading composers touches files also pinned as Full Mock scorer dependencies. Preserve exported native scoring functions, capture the exact pre-change baseline and add narrowly reviewed source compatibility for pending Full Mocks when needed. Never waive native scorer changes merely because the edit is in a shared file.

## Full Mock contract

Use the active approved paper as the template. Current `full-mock-1.v2.json` uses prediction material and real supplied DI images. The legacy `freezePaper()`/`freeze-full-mock-1.js` builds v1 and is not a generic new-paper publisher; do not run it to overwrite existing JSON/catalogue or reintroduce old generated vectors.

| Task order | Count | Preparation / response or clock |
|---|---:|---|
| RA | 6 | 35 s / 40 s in the existing paper; source <=60 words |
| RS | 10 | listen once, existing lead-in, cue then 15 s response |
| DI | 5 | 25 s / 40 s |
| RL | 2 | audio, 10 s / 40 s |
| ASQ | 5 | audio, no start cue, 10 s; short accepted-answer list |
| SGD | 2 | audio, 10 s / 120 s, exactly three speakers |
| RTS | 2 | visible and voiced prompt, 10 s / 40 s |
| SWT | 2 | 600 s each; source <=300 words |
| Essay | 1 | 1200 s |
| Dropdown / MCMA / Reorder / Wordbank / MCSA | 5 / 2 / 2 / 4 / 2 | shared Reading 1500 s in this frozen Full Mock |
| SST | 1 | 600 s including audio |
| LMCMA / LFI / HCS / LMCSA / SMW / HIW / WFD | 2 / 2 / 2 / 2 / 1 / 2 / 3 | one remaining Listening 1500 s clock |

This is **65 scored questions / 22 types**, plus the unscored 25/30 s introduction. Preserve `overallCountdown:false`, `speakingWriting:'per-item'`, `readingSeconds:1500`, `sstSeconds:600`, `sstIncludesPlayback:true`, `listeningAfterSstSeconds:1500`, and continuing shared Listening clock between items. A separate request for new exam timing is a different implementation change; do not silently replace this with the 23-minute Reading-only timer.

### Preserve section instructions, preparation and volume

Preserve the exam-flow contract verified in PR #272 on 3 November 2026. New API-created Full Mock attempts use `sectionTransitions:true`: written instructions appear before Parts 1 Speaking & Writing, 2 Reading and 3 Listening. Persist the transition ID with no current question/response/clock, then start timing only through the authenticated, owned, idempotent `/attempts/:id/begin-section` operation. Preserve old attempts without this opt-in. Direct `session.create()` retains its legacy default; explicitly opt in when testing the new flow. Preserve late upload receipts and early-finish handling across a transition.

Retain task-specific preparation and pre-playback countdowns, rather than adding the same free delay to every question. Use the frozen paper values: RA 30–40 seconds (these three papers use 35), DI 25, RL/SGD/RTS 10 after audio; RS/ASQ open recording after prompt/cue. SWT and Essay have individual clocks, Reading shares its section clock, SST includes playback in its individual clock, and remaining Listening shares a continuing clock. New mixed Reading practice mocks use 10-minute SWT stages, then shared Reading and HCS/HIW stages; retain serialized old stages/deadlines and the existing total. Keep Reading-only mocks on their separate policy.

Keep Full/Speaking equipment samples local and 10 seconds long, with complete playback and explicit sound confirmation. Preserve the visible volume control on every mock question and instruction screen, apply it to current/future audio and cues without replaying or resetting clocks, and retain the `ipt-exam-volume` preference. Check responsive headers after adding controls. Run `tests/full-mock-transitions.test.js`, `tests/mock-clock-contracts.test.js` and affected client tests; retain native desktop/mobile transition, preparation, volume and recording coverage in the system suite. Review `.cache/full-mock-flow-*.png` in the CI artifact. Existing papers, scoring functions, models and confirmed grades remain pinned.

### Version replacement versus an additional selectable Full Mock

- **New question version of Full Mock 1:** clone active paper to vN+1 with the same paper ID and slot identities. Keep old vN JSON, digest and all assets. Append catalogue version, change only that paper's active version, preserve saved attempts.
- **Full Mock 2 (another selectable paper):** use a new paper ID `full-mock-2`, version 1, title and namespaced candidate/question IDs. Keep Full Mock 1 selectable. Do not label a v3 replacement of paper 1 as paper 2.
- Multi-paper support now retains Full Mock 1 v1/v2 and adds Full Mock 2 v1 and Full Mock 3 v1. `loadPaper(id, version)` accepts only a catalogue-approved exact ID/version/file/digest; omitted versions use `catalogue.activeVersions[id]`, with legacy `activeVersion` fallback for paper 1. `registeredPapers({activeOnly:true})` feeds the selectable catalogue; `registeredPapers()` retains every canonical historical paper for assessment. A new JSON file alone is still insufficient: append its catalogue entry and per-paper active version.

Preserve the implemented multi-paper registry: strict catalogue-approved IDs/versions and safe exact filenames; per-paper active versions (preserving legacy `activeVersion` handling for paper 1); all authorized active papers in `/catalog`; selected-paper resolution in `/attempts`; a trusted assessment snapshot with correct native maxima per retained canonical paper/hash; and safe background recovery for every paper. Keep old exports/callers compatible where possible.

Retain canonical paper 1 v1 **and v2**, all older supported versions and every new paper; do not derive trusted maxima from caller-supplied saved data. Persist selected paper ID/version/hash and the full question snapshot in the existing store. Reuse existing active-attempt policy and ownership/UUID checks; a resumed active attempt must not be silently relabeled as the newly selected paper. Test starting paper 2 when a paper 1 attempt exists.

The Full Mock client renders `catalog.papers`, uses the neutral “Full Mock Tests” heading, and passes the clicked ID to equipment setup/start. The API resolves that selected paper and uses `assessor.snapshotFor(selected)` for its canonical hash/native maxima. Keep `assessor.snapshot` compatible for old callers. Retain the existing player/layout. Reports, saved media and resume must use each attempt's saved paper, not the current catalogue selection.

### Reuse the verified additional-paper authoring path

`full-mock/additional-papers.js` records the fixed selections/provenance for papers 2 and 3; `docs/additional-full-mocks-manifest.json` records their composition and overlap. Use this authoring shape for the next unused paper, without rebuilding or rewriting an existing frozen paper. `scripts/verify-additional-full-mocks.js --freeze` was the one-time publisher for these selections; do not blindly rerun it after source pins or authoring code change, because immutable files must reject different bytes. For a future paper, assemble only the new ID, append its catalogue entry/active version, and create its own empty benchmark template. Preserve existing paper benchmark contexts.

Use `tests/full-mock-multi-paper.test.js` for catalogue/selected-start/resume, canonical maxima, ownership, old v1/v2 completion and successful-stage preservation. `tests/full-mock-browser.system.js` covers all 22 forms for paper 1 on desktop/mobile, paper 2 on desktop, and paper 3 in mobile emulation. Extend actual new-paper coverage rather than merely changing an expected card count. Select the first RA/RS by task type in the selected paper, never by hardcoded paper-1 IDs. Include unchanged reorder submission: Next must save the visible order even if no paragraph moved; untouched items must stay unanswered on timeout/early submission. `scripts/validate-full-mock-1.js --probe` now validates every registered paper and decodes each unique fixed recording.

When changing the Full Mock client, refresh its SHA256-prefix URL in `public/index.js`, then refresh the main source SHA256-prefix URL in `public/index.html`, and run `scripts/build-frontend.js`; the builder minifies but does not update these source cache keys itself. For large native GitHub tree writes, reuse existing blob SHAs for byte-identical media and verify that the returned tree SHA exactly equals the reviewed local tree.

### Freeze and pin

Each question is a candidate `{id:'full-mock-2/fm2-rs-01',question:{id:'fm2-rs-01',type:'rs',...},origins:[...],audio?,image?}`. Keep explicit instructions and timing from the blueprint. Attach truthful `contentOrigin`/`predictionSource`, exact keys/facts/keyPoints/sample and parent source IDs. Use namespaced slot IDs for a new paper, stable slots for a version replacement.

Private media: copy exact bytes to `content/full-mock/assets/<raw-byte-sha256>.(mp3|png|...)`; audio descriptor has `path` and `entry` containing matching `path`, `textSha256`, `audioSha256`, `bytes`, `seconds`; image descriptor has `path`, `sha256`. Paper assets list every and only referenced file with path/hash/bytes/MIME. Preserve old asset files and source bytes, deduplicate identical assets by hash.

Add JSON using `putImmutable()` and calculate the **canonical structural `digest(paper)`** for the catalogue, not the raw pretty-printed file hash. Preserve schema/blueprint, introduction, clock policy, source files and exact final `scoringSourcesAtFreeze`. Record source key/visual/media review truthfully; do not invent independent editorial listening or empirical calibration.

Before modifying a pinned loader/API/assessment source, capture current `scoringSnapshot(root)` as the exact compatibility baseline. Preserve native graders, configuration, weights, saved marks and old provider adapters. Permit only reviewed exact before/after source revisions; never accept arbitrary future source drift. Update the audit lock and empty benchmark template for the new active paper, while leaving historical benchmark records pinned. Validate frozen bytes after the final code change.

## Question, key and provenance checklist

Reuse current banks: `content/speaking-bank.js`, `content/user-sgd-oct30.json`, supplied RL/RTS batches, `content/writing-predictions-sep-2026.js`, `content/writing-lab.json`, `public/reading-predictions-sep-2026.js`, `public/reading-bank.json`, `content/listening-mocks.js`. Inspect exports programmatically; do not invent availability or an external prediction label.

| Type | Required content/key |
|---|---|
| RA / RS | exact `text`; matching sample; retain source ID for excerpts/adaptations |
| DI | original `imageUrl`, category/visual, verified `facts`, <=100-word sample, source/reference/display hashes |
| RL / RTS | full `text`, grounded facts/keyPoints and sample; RTS ends “What would you say to <addressee>?” and <=60 words |
| SGD | `narration`, ordered `turns:[[speaker,text],...]` with three stable speakers, facts and third-person sample |
| ASQ | spoken question, explicit `acceptedAnswers`, no pronunciation/fluency traits |
| SWT / SST / Essay | `text`, `keyPoints`, accurate sample; SWT single sentence 5–75 words, SST 50–70, essay 200–300 |
| Dropdown | consecutive `[[1]]` blanks, string `answers`, option array per gap including the key |
| Wordbank | marked passage, string answers with correct multiplicities, bank including distractors |
| MCMA / LMCMA | choices, distinct valid zero-based numeric answers; wrong-choice penalty floors at zero |
| MCSA / LMCSA / HCS / SMW | choices, valid zero-based integer `answer`; HCS choices are summaries |
| Reorder | keyed text boxes and a permutation answer; grade adjacent pairs, not whole-paragraph exactness |
| LFI | full heard `text`, marked passage and string answers reconstructing that text exactly |
| HIW | correct audio `text`, substituted shown passage, same whitespace-token count, changed zero-based positions as answers |
| WFD | exact source sentence/sample; existing native word sequence/spelling policy |

Use unique identities within each mock. Reject duplicate normalized stimuli, image hashes and parent recording/source IDs, including RA/SWT or RS/WFD reuse of one parent. Vary options without corrupting key indexes. Keep difficulty as editorial only; do not scale marks by an invented difficulty curve. Preserve supplied text faithfully; a long supplied SWT outside Full Mock limits needs a different valid selection or an explicitly labeled permitted adaptation, not silent truncation. Record actual source dates/filenames and whether original, supplied, adapted or excerpted. Never claim an adapted cross-task item is a verbatim prediction of its target task.

## Media production and verification

- Original DI data: `content/di-user-predictions.json`; canonical mappings: `content/di-reference-manifest.json`; display variants: `content/di-display-manifest.json`. Inspect actual image labels and facts. Keep original bytes/watermarks; no stock images, regenerated numbers or new vector replacements. Use `require('./scoring-jobs').hash()` and `describe-image-feedback.mapping(q)` for canonical mapping hashes. Missing reference entries break bank import. Keep originals canonical and variants linked to the original SHA; use existing verified clear assets or a truthful original copy if already legible.
- Speaking recording manifests: `content/speaking-audio-manifest.js()` merges base/user/RTS/SGD manifests. For RS/RL use `.edge-tts/bin/python scripts/generate-speaking-audio.py` (optional `--user-imports`). RTS uses `.edge-tts/bin/python scripts/generate-rts-prompt-audio.py` and immutable computed `promptAudioKey`; never overwrite a previous key's text/MP3.
- SGD: `scripts/generate-user-sgd-audio.py`, existing p225/p237/p238 stable contrasting voices, spoken introduction, source model/config SHA checks from `content/speaking-audio/sgd-voice-source.json`. Use piper-tts 1.3.0 in the authoring environment, retain license metadata and exclude model weights from deployment. Manifest must prove three actual voices/accents, `speakerVoices`, `speakerAccents`, `turnSpeakers`, `narrationIncluded:true`, narration hash and full scored-text hash. Bank scored text is `Narration: ...\n<speaker>: ...` including labels.
- Writing: `.edge-tts/bin/python scripts/generate-writing-audio.py`, `content/writing-audio/manifest.json`. Runtime individual HD TTS remains in `writing-lab-audio.js`; frozen Full Mock requires committed fixed audio. Reuse valid assets rather than buying/regenerating identical speech. Install missing existing Edge TTS venv via `npm run install:edge-tts`, without changing dependency versions.
- Probe every new/reused fixed recording with ffprobe and decode with ffmpeg. Verify bytes, exact transcript/audio SHA256 and duration. RS 3–9 s; normal RL 45–90; SGD 90–180; RTS 5–35; Full Mock SST 60–90; LMCMA 80–120; LFI 30–60; HCS 30–90; LMCSA 30–60; SMW 20–70; HIW 15–50; WFD 3–5. Use the current blueprint's exact applicable bounds. Never pad silence, duplicate content or truncate a supplied source merely to pass duration checks.
- SMW has a real end beep; the missing answer is not narrated. Keep restrained approved SST effects separate from scored text; WFD stays clean. Preserve existing global audio cleanup and caching.

## Scoring, flow, reports and alerts

Connect existing engine graders; do not build new scoring logic during paper assembly. Full Mock uses `full-mock/adapters.js` native results, `aggregation.js` and five versioned profiles in `profiles.js`. Sum native earned/possible within task types and use the existing integrated-skill routes and Overall policy. Do not average the four skill scores, import sectional /90 estimates into raw item marks, invent the exact value of published `<1%` entries or call the uncalibrated practice index an official Pearson conversion.

Native reference maxima: RS content 3 plus Azure P/F 5 each; DI/RL/SGD/RTS content 6 plus P/F 5 each; RA content uses prompt words; ASQ content 1 only; SWT 9, essay 26, SST 12. Preserve the existing Content/Form zero gates and objective penalties. Reuse Speaking's existing task/whole-audio assessment and report modules rather than substituting Full Mock aggregation. Preserve each sectional engine's current scorer/report. Successful results and uncertain provider requests must not be retried/regraded indiscriminately.

Equipment checks must complete before a new timed attempt consumes question time. Keep a visible audio lead-in; preparation begins after actual prompt completion; RS cue finishes before its full response window. Next saves durably or preserves the existing local queue, advances seamlessly and seals the previous response. Account switches, retries, reloads and concurrent tabs must not attach audio/results to the wrong question or user. Do not loosen ownership or protected exam behaviour.

Run per-answer scoring through existing background jobs. Show a preparing-results banner after submission, and the complete report only when required marks are confirmed. Distinguish explicit skips/blank answers from missing provider evidence; do not fabricate zeros or full marks to complete a report. Reuse missing-stage recovery and admin alert hooks for submission/error/overdue cases, with existing idempotency and recipient configuration. Do not send a live alert test during paper creation.

Keep original IPT logo and clean reports showing earned scores, useful feedback, saved responses and matching DI samples/media. Include existing integrated-skill contribution feedback where appropriate, while keeping formulas/provider diagnostics/overall weighting mechanisms out of student-facing content. A saved report must read the saved question/reference, not the latest bank row.

## Validation and publication

Run focused content/compatibility checks, not implementation-mirroring tests. Confirm catalogue card, selected paper ID, equipment setup, every task type/media, actual timers, save/Next, submit, background recovery, final report, history, reattempt and ownership. Use synthetic accounts, injected providers and isolated storage; do not edit live students or spend provider credits merely for smoke tests.

| Scope | Commands / regression files |
|---|---|
| Full | `node scripts/validate-full-mock-1.js --probe`; `tests/full-mock-paper.test.js`, `full-mock-predictions.test.js`, `full-mock-api.test.js`, `full-mock-session.test.js`, `full-mock-assessment.test.js`, report/client/scoring tests |
| Speaking | `node scripts/validate-speaking-content.js`; `tests/speaking-mock.test.js`, client/report/Azure tests, new paper content tests |
| DI | `node scripts/verify-di-reference-sync.js`; `node scripts/verify-di-display.js`; DI reference/Academy tests |
| Writing / Listening | `node scripts/validate-writing-audio.js`; `tests/writing-lab.test.js`, `listening-mocks.test.js`, `writing-audio.test.js`, writing-overall/client tests |
| SWT / Reading | `node scripts/validate-swt-content.js`; `node scripts/validate-prediction-swt-samples.js`; `node scripts/validate-reading-fib-content.js`; Reading variations/catalogue/navigation tests |
| All | `git diff --check`; bundled preflight verify; `npm test`; safe release/build and browser/database checks in Portal CI |

Select actual filenames with `rg --files tests`. For new paper families/IDs extend validators meaningfully; never switch off key/media/timing checks. For multi-paper Full Mock prove independent starts, media/report isolation, unknown IDs rejected, old active/pending v1/v2 completion with successful marks untouched, and all catalogue papers reachable. Do not weaken old-version regression assertions to hide incompatibility.

`scripts/verify-release.js` runs tests/calibration/build through a safe environment clearing production storage, paid provider and mail credentials. `scripts/verify-full-mock-systems.js --evidence-out <temporary.json>` additionally needs an isolated local `FULL_MOCK_TEST_DATABASE_URL` and Chromium; never point it at production. Existing CI runs those checks. A dry-run/fake-provider test is not proof of real microphone or provider quality; record manual hardware/media review honestly. Do not change release/access flags to pretend evidence exists or ask for repetitive approval where the requested scope already authorizes normal publication.

Prefer native GitHub tools: create branch/commit/PR based on latest main and inspect the content/integration-only diff. Normally wait for **Portal CI success** before merging. If the instructor explicitly requests skipping CI, record that instruction, use `[skip ci]`, run only the targeted checks described above, and merge within that authorized scope while preserving concurrent work. Reuse existing blob SHAs for byte-identical repository assets; base64 only for genuinely new binary blobs. Build generated frontend through `node scripts/build-frontend.js` if required; never hand-edit minified assets.

Main deploys through Railway. Verified project `9dfedf2a-125e-4f61-acde-1e96538fa7f0`, environment `601b7d8b-5a66-44a1-ab8d-c01c37bc04ba`, service `6b46842f-d3e6-4665-be8e-1a24807448f1`; resolve by repository/domain if stale. Discover current native tool schemas and wait for the **merged commit's** deployment to reach terminal **SUCCESS** before saying live. Do not restart the service, change environment variables or send mail to force a release.

Finish briefly with new mock IDs/titles, question counts, actual exposure/audience, checks and live status. For a version replacement say new attempts get the new paper and saved attempts retain their original paper. Update this installed skill after verified workflow changes so future mock creation starts from this file.
