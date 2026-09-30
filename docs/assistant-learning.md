# AI Learning

Admin → AI Learning shows question topics, task trends, recurring feedback patterns and repeated lower-scoring traits. Teachers can create, edit and disable reviewed guidance notes. Enabled notes enter both assistant coaching endpoints on the next request. This is contextual improvement, not model fine-tuning, and never changes assessment scores.

Collection runs on successful saved progress, speaking submission and writing answer/scoring requests. Frequent saves are coalesced. Opening Next Steps and asking the assistant also refresh the student's snapshot. There are no additional model calls for classification or collection.

The dashboard starts accumulating after deployment. Stored snapshots contain keyed hashes of account IDs, fixed question-topic categories and numerical summaries, with no raw chat, answer text, names or audio. Daily question-topic buckets count once per student/task/topic/day. Repeated refreshes overwrite the same snapshot rather than multiplying attempt counts. Records expire after 90 days of inactivity and are capped at 5,000 observed accounts. Questions expire after 90 days. Task scores describe available saved history for recently observed students, not all attempts made in a 90-day period.

Recurring trait weaknesses require two below-benchmark results among the five recent available results, an average below 75%, and recent evidence. Missing key-point patterns require two distinct AI-reviewed speaking attempts. Read Aloud and Repeat Sentence omissions are transcript comparisons, not acoustic diagnoses. These patterns do not prove their underlying cause.

Cohort context needs at least three students per pattern and remains secondary to the current student's evidence and institute task rules. Reviewed teacher notes can be used immediately, are scoped by task, and can be disabled without deletion. The prompt does not treat a common error as an error made by the current student.

Storage uses PostgreSQL when configured, otherwise an atomic file in the existing data directory. Collection failures do not block progress saves or coaching. Admin endpoints require the existing admin key:

- `GET /api/admin/assistant-learning`
- `POST /api/admin/assistant-learning/guidance`

Focused validation covers deduplication, restart persistence, expiry, topic classification, task-scoped guidance, recurring patterns, authorization and both assistant endpoints.
