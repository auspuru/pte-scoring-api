# Contribution-based mock feedback

The Feedback tab now explains the tasks supporting a saved result and the tasks
with the largest remaining contribution gaps. This is a report-only change:
native marks, gates, providers, timing, question banks and displayed scores are
unchanged.

Full Mock reads the attempt's saved weighting snapshot and verified native
groups. Overall has its own profile, independent of the four skills. Each profile
ranks task groups by its relative weight times the unearned native fraction.
Published `<1` values remain intervals; overlapping priorities are not labelled
as an exact order. Contributions count each task once within each relevant
profile. Question count does not multiply task weights again.

Sectional Speaking uses the active Azure report and its included task weights;
authorised exclusions are omitted and incomplete assessments cannot become
weaknesses. Sectional Writing uses the current displayed task-weighted report.
Listening and Reading retain their existing pooled native-point calculations;
their priorities explain those actual results. Related-skill labels describe
integrated task routing without inventing full-test scores for a sectional mock.

Task examples use confirmed saved marks and saved assessment coaching. Quotations
must occur literally in the response. Acoustic coaching requires matching Azure
recording evidence. Source text, answers and coaching are escaped in HTML. The
student view contains no weighting formulas, invented score gains or provider
payloads. The leading profile is expanded; the four Full Mock skill explanations
can be opened individually.

Existing submitted attempts receive the new score-priority summary on every
normal report read, without a migration, regrading or paid summary request.
Reading computes the same summary from the saved local/cloud review. Writing
and Listening recompute it from the latest verified results as assessments
finish, so an initially pending summary updates without reopening the mock. Historical
answers, recordings, saved feedback and scores remain intact. Legacy Speaking
priority advice is retained in storage but replaced in the displayed summary.

Writing's AI response review now receives verified marks and the deterministic
priority context. Its feedback fingerprint includes that context: old narratives
are refreshed through the existing deduplicated reviewer when their report is
opened; changes to confirmed marks invalidate stale narratives. Normalisation
enforces the calculated priority order. No cohort-wide provider job is started.

The exact pre-change Full Mock source baseline is retained for pending attempts.
Only report/compatibility wiring changes are accepted; graders, configuration,
native maxima, saved paper and successful grades stay pinned. Regression tests
cover that baseline and older paper/provider baselines.

Validation includes weighted-gap versus accuracy counterexamples, separate skill
profiles, integrated routing, blanks, zero gates, pending/provisional/invalid
marks, historical weighting, immutable records, stale AI contexts, literal
evidence, HTML escaping and desktop/mobile feedback rendering.
