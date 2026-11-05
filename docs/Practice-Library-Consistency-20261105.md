# Shared individual practice libraries

Use one SWT-style question-library renderer for all 21 task types: title and question count, search and status filter, numbered rows with stable IDs, titles and saved-attempt status. Essay enters at this list. Task-specific mode and category choices remain available.

The primary Practise action opens a fresh response, including completed questions. An explicit Resume draft action restores unfinished work. Earlier submitted responses and original feedback remain accessible below the question and from Results. SWT and Essay archive unfinished text before clearing it; archive writes use the signed-in account's durable practice-storage adapter and failure prevents clearing. Archived drafts are device backups, while existing completed-attempt/account sync contracts remain unchanged.

The native grading, feedback and IPT-branded score-report function/file pins remain protected by `portal-layout-preservation.json`. The shared Reading controller is a Full Mock dependency, so an exact reviewed source projection accepts the previous deployed snapshot while retaining its graders, provider/model metadata, paper, timing, successful marks and full historical compatibility chain. Arbitrary native source/model drift remains rejected.

Coverage includes a real isolated portal/browser check for all 21 desktop lists; fresh/resume and archive recovery; native Writing, Reading and all eight timed Listening flows; original reports and confirmed Full Mock marks. Portal CI runs these together with the full PostgreSQL, browser, calibration and production release checks and records evidence against its commit/runtime context. Tests use synthetic accounts and isolated storage, with provider and production database credentials removed.
