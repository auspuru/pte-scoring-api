# Describe Image import — 17 November 2026, second batch

The supplied `Screenshot 2026-11-17 144914.zip` contains 35 distinct PNG files. Add 32 new questions with IDs `di-user-2026111735` through `di-user-2026111766`. Preserve the original image bytes, attribution and watermarks, with byte-identical display copies and SHA256-bound reference mappings.

Three stimuli are already in practice and are omitted from this additive batch despite different screenshot bytes:

| Supplied filename | Existing question | Matching stimulus |
| --- | --- | --- |
| Screenshot 2026-11-17 144443.png | di-pred-3000669 | The World's Water |
| Screenshot 2026-11-17 144455.png | di-pred-3000589 | Australian climate zones |
| Screenshot 2026-11-17 144557.png | di-pred-3000579 | Drinking habits by age (US) |

The remaining images were visually inspected. References use readable source details and approximate values where a chart is not explicitly labelled. The graduates chart retains its unusual printed `1–15` band without inventing missing intermediate labels. The home-ownership/unemployment chart has no geographic title, so none is inferred. Local source identifiers are the supplied filenames, with no invented external question codes or weekly-prediction status.

Existing questions, mappings, display metadata, timing and mock exports are preserved by a before/after comparison. Only the three DI JSON collections, new PNGs, collection-count test expectations and this note change. The handbook's bundled scope helper remains unavailable in the cloud skill; the equivalent snapshot guard is reused from the earlier verified import rather than repeating discovery.

Validation before the full suite: source/display checksum validators, Speaking content validation, 120 focused DI/Speaking/catalogue tests, and all 32 entries checked through local authenticated synthetic attempts with image delivery, transcript persistence, saved sample snapshots and unchanged 25-second preparation/40-second response timing. No live student attempts or paid providers are used.
