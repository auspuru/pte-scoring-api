# Retell Lecture: 23 November 2026 screenshot import review

## Review status

The uploaded ZIP contains **61 PNG screenshots** showing Retell Lecture question headings, on-screen source transcripts and, in some cases, visuals. It does **not** contain the actual lecture audio streams.

The deduplicated screenshot inventory is in `content/retell-nov23-screenshot-review.json`:

| Classification | Unique question titles |
| --- | ---: |
| New *candidates*, need transcription and live-bank verification | 36 |
| Potential matches in existing `content/user-speaking-oct24.json` | 21 |
| Ambiguous semantic overlap: `Survey` | 1 |
| **Unique titles** | **58** |

The 61 captures include three duplicate screenshot pairs: #205 America's Economic Size, #181 Animal Behavior and #123 Marshmallow Test. The `#N` heading values are source question IDs, **not** report frequencies. `Report(N)` on a screenshot is a separate field and has not been asserted as an authoritative rank.

## What is already prepared

A separate local review package contains machine-extracted draft transcripts, screenshot hashes, source filenames and an all-screenshots comparison CSV. The screenshots are the authoritative source; OCR is **not verified** and must not be automatically published.

Existing portal candidates are matched conservatively, by name and obvious subject correspondence. They are not declared to be exact transcript duplicates without a word-for-word comparison. No PostgreSQL production lookup was performed.

## Implementation once media and proofreading are complete

1. Check all 58 deduplicated screenshots against the extracted transcript drafts, especially long passages, names, numbers and transcription tails.
2. Compare the 21 possible matches **by the full text** against the live Retell Lecture question bank, including audio metadata and any already-generated media. Retain existing IDs, recordings, student scores and histories. Import only genuinely novel questions.
3. For the 36 apparent new items and the ambiguous Survey item, obtain properly licensed **original lecture audio**, or obtain explicit permission to create **synthetic practice narration clearly labelled as such**. Do not claim a screenshot contains an audio file.
4. For items with source visuals, review copyright permissions and extract/replace the illustration at appropriate quality rather than publishing a cropped screenshot containing another platform's controls or watermark.
5. Build complete `type:'rl'` question objects with stable portal IDs, `title`, verified `text`, supported `facts`, `sample`, source provenance, and audio file/hash/duration. Integrate into the existing `content/speaking-bank.js` ingestion path only after staging checks.
6. Generate or copy verified playable media, update the speaking audio manifest, and run duration, transcript, scoring and browser checks. Handle the wide lecture durations seen in these screenshots (some longer than 90 seconds) rather than bypassing validation.
7. Apply NEW and one-click exam-reporting behavior to newly added RL questions **only after confirming that those features are designed for Speaking**; existing SWT-specific code must not be blindly reused as-is.
8. Verify all questions appear correctly in the RL library with stable IDs, no duplicate records and accessible replay controls. Preserve user histories and question positions.
9. Before releasing playable questions, run GitHub Actions CI, full speaking/media tests and an authenticated staging integration test with a synthetic account.

This inventory records the candidate matches and the inputs needed for a future playable Retell Lecture import.
