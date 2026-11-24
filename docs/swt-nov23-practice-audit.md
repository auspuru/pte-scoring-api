# November 2026 SWT import audit

The November import contains 31 standalone SWT passages from 43 supplied screenshots. Each passage has four source-grounded key ideas and a one-sentence teaching example. On deployment the portal imports the reviewed batch into its PostgreSQL practice catalogue. Mock selection uses its existing sources.

The earlier comparison covered 56 items and excluded 13 likely repository matches. Only the 43 images in the supplied review ZIP are included in this audit. The source manifest identifies each image by filename and SHA-256. It records the checked transcription's normalized text hash, word count, source question ID, visual notes and disposition.

| Disposition | Count | Details |
| --- | ---: | --- |
| Staged | 31 | Verified text, references and distinct provisional IDs |
| Incomplete screenshot | 2 | Learning and Growing in Relationships and Positive Mindset |
| Outside 150–360 verbatim words | 4 | Over-training (146), Academic Libraries (143), Negotiation (120) and Wright Brothers (384) |
| Existing live passage | 1 | Compulsory Reburial maps to Human Remains, ID 30 |
| Possible existing adapted prediction | 5 additional | Bank Overdraft, New Women, Solar Energy, Pre-service Teachers and House Mice |

Wright Brothers also has a same-title adapted prediction. It is counted once in the word-range row. The six adaptations share subject matter and some arguments or examples with the screenshots. They lack an exact text match or a reliable source link, so the audit records their existing prediction IDs and holds the proposed new rows. The missing and out-of-range excerpts remain outside the staged data. No passages were padded or shortened to meet the length rule.

## Bank and reporting checks

The repository comparison used 164 passage versions across the standalone banks, legacy and advanced revisions, Writing predictions, and frozen Full Mocks. The live comparison used all 60 rows returned by the normal read-only `GET /api/passages` response on 23 November 2026. The live health route confirmed PostgreSQL. The catalogue reads through the PostgreSQL passage adapter, which can serve a process-local cache. A fresh catalogue read on 24 November 2026 found the same 60 rows and no conflicts with the 31 approved candidates. At activation, the importer independently reads the authoritative PostgreSQL rows and checks all proposed IDs and normalized texts before writing.

The comparison used normalized exact text, shared four-word phrases, similar titles, similar openings and review of the strongest matches. The proposed numeric IDs were checked against the repository and observed live catalogue. There were no collisions across the 43 candidates. The importer takes the database check and all inserts in the same transaction. Another passage with the same text or an occupied ID causes the whole batch to roll back. A previously imported passage is retained, including any teacher edits to its original record.

The screenshot headers show source question IDs. The separate screenshot Report badge values are recorded as observed UI values. The source supplies no definition of what they count. The staged passages supply no `repeatCount` or `repeatEvidence`. The portal's existing distinct-student report totals continue to determine the global priority.

## Reproduce the audit checks

```sh
node scripts/validate-swt-nov23-staging.js /path/to/read-only-catalogue.json /path/to/extracted/screenshots
node scripts/validate-swt-content.js
node scripts/validate-prediction-swt-samples.js
```

The first check accepts the portal catalogue JSON or an array of passage rows. It reports normalized exact-text matches and ID collisions. The preflight accepts previously imported rows. A conflicting ID or a duplicate at a different ID requires review before activation. Compare near matches again using the source manifest and fresh catalogue. The screenshots remain in the supplied ZIP.

The browser regression exercises first submission, draft persistence, account switching, fresh-device sync and idempotent reporting in isolated PostgreSQL. It also verifies search and keyboard focus after reordering, including a report that finishes after another question is opened. The PostgreSQL system regression also verifies boot-time exposure, idempotent re-runs and rollback on conflicts.
