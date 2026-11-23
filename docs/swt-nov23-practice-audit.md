# November 2026 SWT import audit

The draft stages 31 standalone SWT passages from 43 supplied screenshots. Each staged passage has four source-grounded key ideas and a one-sentence teaching example. The staged data can be reviewed independently of the portal's runtime passage loaders. It is not loaded at startup or included in any mock selection.

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

The repository comparison used 164 passage versions across the standalone banks, legacy and advanced revisions, Writing predictions, and frozen Full Mocks. The live comparison used all 60 rows returned by the normal read-only `GET /api/passages` response on 23 November 2026. The live health route confirmed PostgreSQL. The catalogue reads through the PostgreSQL passage adapter, which can serve a process-local cache. An independent SQL snapshot was unavailable. Take a fresh read-only table snapshot before any separately approved production activation and repeat the ID and normalized-text checks against it.

The comparison used normalized exact text, shared four-word phrases, similar titles, similar openings and review of the strongest matches. The proposed numeric IDs were checked against the repository and observed live catalogue. There were no collisions across the 43 candidates. New IDs remain provisional until the direct pre-import check.

The screenshot headers show source question IDs. The separate screenshot Report badge values are recorded as observed UI values. The source supplies no definition of what they count. The staged passages supply no `repeatCount` or `repeatEvidence`. The portal's existing distinct-student report totals continue to determine the global priority.

## Reproduce the audit checks

```sh
node scripts/validate-swt-nov23-staging.js /path/to/read-only-catalogue.json /path/to/extracted/screenshots
node scripts/validate-swt-content.js
node scripts/validate-prediction-swt-samples.js
```

The first check accepts the portal catalogue JSON or an array of passage rows. It reports normalized exact-text matches and ID collisions. If an ID and passage already match, its status is `already-present`. Any overlap requires review before activation. Compare near matches again using the source manifest and fresh catalogue. The screenshots remain in the supplied ZIP.

The browser regression exercises first submission, draft persistence, account switching, fresh-device sync and idempotent reporting in isolated PostgreSQL. It also verifies search and keyboard focus after reordering, including a report that finishes after another question is opened. Current main and Railway are outside this draft's release scope.
