# Mock content assessment

All newly created mocks use the owner-selected `gpt-6.1-sol` model for AI content assessment. Speaking tasks (Describe Image, Retell Lecture, Summarize Group Discussion and Respond to a Situation), SWT, Essay, SST and whole Writing Mock feedback use the existing OpenAI key. The Responses API uses medium reasoning, `store:false`, one forced structured function when a task has an evidence schema, and no unsupported sampling parameters. A provider failure never silently selects another model. Incomplete, refused, duplicate or malformed responses remain unassessed.

The content prompts, semantic validators, exact quotation checks, Visual Academy Describe Image rubric, independent SWT review and Essay review pipeline are retained. Objective tasks continue using their answer keys/alignment. Azure continues assessing pronunciation and fluency; recording transcription retains its dedicated transcription model. Individual practice routes retain their existing provider configuration.

New progressive Speaking Mocks record `contentProvider`, `contentModel` and `diBackend:portal-gpt` in their assessment profile. Their DI jobs use the same Visual Academy rubric and validator locally through the GPT transport, so they cannot accidentally reach the legacy external model. Already queued legacy DI jobs keep their durable remote receipts and are not duplicated. Existing successful marks are reused.

New Full Mocks freeze the GPT configuration and the new transport sources. Older frozen Full Mocks finish with their recorded providers through the retained legacy adapters. Compatibility accepts only audited source baselines and the exact new wiring hashes, preserves the original snapshot and every successful stage, and rejects unrelated model/source changes. Completed reports remain readable. The rollout does not trigger historical reassessment.

Writing and Listening sectional mocks choose the dedicated mock graders by the saved attempt's `kind`, including answer scoring and final overall feedback. Separate grader caches prevent a previous provider's assessment from being reused as a GPT assessment.

Production startup logs `[mock-content]` with the selected model and a key-presence boolean. Successful provider calls log only task, provider, model and duration; no response text, transcripts, recordings or keys. Existing mock alerts report assessment errors or unfinished reports through the normal notification workflow.

Official references: https://developers.openai.com/api/docs/models/gpt-6.1-sol and https://developers.openai.com/api/docs/guides/latest-model . Tests exercise the wire contracts, independent validators, sectional routing, progressive DI/Azure separation, failure handling and frozen-attempt continuity without live provider calls.
