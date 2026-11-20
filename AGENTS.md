# IPT Brisbane PTE portal agents

For portal tasks, delegate to the matching project agent when delegation is available. Lead with the owner of the requested outcome and involve other specialists only when the evidence crosses responsibilities. Give each agent the requested scope, current revision, relevant identifiers and expected outcome. The parent integrates findings, applies authorization boundaries and verifies completion. Avoid concurrent changes to the same files, attempts, or accounts. If skills are unavailable in a spawned context, provide the relevant playbook instructions or have the specialist inspect the current contracts and report the gap.

| Agent name | Route here when |
| --- | --- |
| `mock-scoring-results` | Investigates, audits, recovers and reassesses practice and mock scoring, feedback and saved reports. |
| `question-bank-verification` | Adds, replaces and independently reviews portal questions, answer keys, transcripts and media. |
| `mock-test-builder` | Builds and validates Full and sectional mock papers, assets, timing, and attempt compatibility. |
| `portal-qa-release` | Runs portal acceptance and regression tests, fixes practice navigation, and verifies authorized releases. |
| `accounts-access` | Handles named portal accounts, authentication, feature entitlements and access windows. |
| `portal-support-triage` | Classifies incomplete portal bug reports and routes them using concise evidence and a clear owner. |
| `portal-engineering-reliability` | Diagnoses Railway, database, storage, worker, provider and portal availability incidents. |

A wrong mock key goes first to Question Bank and Verification for source evidence. Mock Test Builder traces affected paper IDs, versions and frozen snapshots. Mock Scoring and Results assesses active, paused, submitted-pending and scored attempts against their saved snapshots, including legacy attempts. Portal QA and Release verifies the proposed correction using isolated fixtures and records outstanding checks.

For a wrong-key investigation, the parent delivers one consolidated findings report before any correction is published or saved marks are changed. Include the verified key and source evidence, affected paper IDs and versions, affected saved-attempt counts or authorized identifiers by status, confirmed or potential scoring impact, QA evidence, remaining checks, and the proposed correction. Apply the existing authorization requirements before proceeding.

A pending result with a multi-user provider or queue incident goes to Engineering and Reliability for system diagnosis and Mock Scoring and Results for attempt recovery.

Use the historical cases in the agent files as pilot exercises. Start with redacted or synthetic fixtures, compare outcomes to current policies, and record correctness, missing evidence handling, preservation of previous results and publication scope. A passing case is evidence for that scenario. Require explicit authorization for production score publication, access changes, releases and infrastructure mutations.

Historical references are PR numbers or commit IDs in [the portal repository](https://github.com/auspuru/pte-scoring-api). Agent roles were seeded from current portal history through `93cc716` and the existing PTE skills. New incidents should update the closest specialist's playbook after the intended behavior is verified.
