# Describe Image clarity filter — 17 November 2026

Scope: visually screened all 83 supplied practice originals, including the 34 images added on 17 November, and contact sheets of the 17 additional Speaking mock source images. Inspected the two newly held images at original resolution and their actual display variants. Checked display provenance to avoid rejecting small originals that already have clearer versions. This is a legibility review, not a complete reference/scoring audit or a review of every frozen Full Mock asset.

| Question | Finding | Action |
| --- | --- | --- |
| `di-pred-3000481` — Years to Double Population | Lower-right annotations overlap and remain unreadable in the original and higher-resolution display. | Hold out of new practice and random sets. Replace this slot in new Speaking Mock 3 attempts with `di-pred-3000739`, a readable fast-food-frequency chart not used in the other current papers. |
| `di-pred-3000742` — Average Weekly Household Expenditure | The source is cropped on both side edges. Its resampled display retains blur and missing edge content. | Hold out of new practice and random sets pending a complete clearer source. |
| `di-pred-3001061`, `di-pred-3001369` | Existing holds: unreadable taxation labels and an unlabeled pie chart. | Retain both exclusions. |

The source-bound availability flags reuse the existing catalogue/direct-start guard. The practice library changes from 86 to 84 eligible DI questions (88 retained in the bank). All original files, IDs, samples, mapping hashes and historical media remain unchanged. Existing attempts retain their snapshots or existing legacy-reference behavior; saved marks are untouched. Mock 3 retains five DI questions, its question count and timings; its contentVersion becomes 2. Retained Full Mock papers are unchanged.

Verification: API regression checks cover hidden catalogue entries, rejection of new direct starts, and successful reading/resuming of existing attempts with original confirmed results for all four held IDs. Reference/display hash validators and Speaking mock uniqueness/count checks also apply. The 38 focused tests passed. Broader release verification is recorded in the pull request.
