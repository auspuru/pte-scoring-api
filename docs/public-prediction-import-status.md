# Public prediction import status — 30 September 2026

## What this change delivers

Describe Image can be filtered by bar chart, line graph, pie chart, process chart, table, map, mixed charts, photograph/random image, other diagram, and unclassified. Existing visual kinds supply the category. Future items may explicitly set `imageCategory`; unknown values are unclassified, never guessed from a title.

Speaking lists support title/ID search, category counts, empty states, clear filters and 20-question pages. Filters persist within the current account's session, and Back/Next stays within the filtered set. No microphone or attempt is started by filtering.

**No third-party questions or images have been imported by this change.** The existing practice items remain in place. The random-image category currently has no items.

## Source coverage

The following public PTE Nepal lists cover 28 September–4 October 2026. They are discovery references, not an imported or licensed content manifest.

| Task | Public reference |
| --- | --- |
| Respond to a Situation | https://ptenepal.com/blog/pte-prediction-sep28-oct4-2026-respond-to-situation/ |
| Describe Image | https://ptenepal.com/blog/pte-prediction-sep28-oct4-2026-describe-image/ |
| Summarize Written Text | https://ptenepal.com/blog/pte-prediction-sep28-oct4-2026-summarize-written-text/ |
| Reading Drag and Drop | https://ptenepal.com/blog/pte-prediction-sep28-oct4-2026-reading-fib/ |
| Reading Dropdown | https://ptenepal.com/blog/pte-prediction-sep28-oct4-2026-reading-writing-fib/ |
| Summarize Spoken Text | https://ptenepal.com/blog/pte-prediction-sep28-oct4-2026-summarize-spoken-text/ |
| Write From Dictation | https://ptenepal.com/blog/pte-prediction-sep28-oct4-2026-write-from-dictation/ |
| Highlight Incorrect Words | No current qualifying public list verified. |

The public labels are Prediction and New Prediction. No highest-priority tier or independent monthly overlap was verified. The September index groups weekly editions; it does not establish monthly membership. Source IDs must not be relabelled as verified ApeUni IDs.

The WFD list includes misplaced long passages at Q27–Q34. Do not import the advertised total without validating individual task content. Reading pages also contain extraction artifacts and incomplete option lists.

## Pending question import

Import exact text and images only from material supplied by the user or authorized for reuse. Do not silently replace requested exact questions with newly written adaptations. Preserve provenance and distinguish supplied/verbatim material from original or adapted practice, following existing `predictionSource` metadata conventions.

Before integrating each item:

- Deduplicate by provider, task and source ID, with a normalized-content check for duplicate IDs.
- Preserve original IDs separately from stable portal IDs; preserve any existing attempts.
- Store actual weekly/monthly membership and dates only when verified. New is not a priority rank, and source order is not likelihood.
- Inspect DI visuals to set `imageCategory`; do not infer a chart type from its title. Provide a usable local asset, reference facts and sample response.
- Provide complete passages, blank positions, options and validated answer keys for reading items.
- Provide verified transcripts, durable audio assets and samples for SST; correct sentences and durable audio for WFD; aligned displayed/spoken text and mismatch indices for HIW.
- Expand the speaking content validator's current fixed bank-size assumptions when actual new speaking items are added; validate audio manifests and source provenance before publication.

This change is filter support and a documented import boundary, not a completed question import or production deployment.
