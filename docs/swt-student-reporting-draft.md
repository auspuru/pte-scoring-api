# Student-reported SWT exam encounters (draft; not for production yet)

This feature is scoped to `questionSet: "nov23-2026-swt"`. It is proposed for the 43 November 23 SWT screenshots, which are not yet imported into the live database.

## Student workflow

1. Open Writing → Summarise Written Text → Choose a question.
2. For an imported November question, choose **Report exam encounters**.
3. Enter **how many times that exact passage appeared in a real, official PTE examination**, not practice or mock exams, as a lifetime cumulative integer from 0 to 50.
4. Save. The same student may edit that number later. Saving 3 after 2 means **3 total**, not 5. Entering 0 removes the previous report.
5. Each question displays **source-report mentions** separately from **student-reported exam encounters** and the number of students contributing. No reporter names or other student identities are returned.
6. The **NEW** label stays visible for each student until their first *practice submission*, independent of exam-frequency reports. Simply submitting a frequency report does not count as practicing the question.

## Database and API

- Migration: `swt_exam_occurrence_reports` table in `pgInitSchema()`, composite primary key `(username, passage_id)`, `CHECK times_seen BETWEEN 1 AND 50`. Cascades on account and question deletion.
- GET `/api/swt/exam-reports`: authenticated list of aggregated student encounters, number of reporters, and this student's own report.
- POST `/api/swt/exam-reports/:passageId` with JSON `{ "timesSeen": 3 }`: authenticated upsert. `0` removes the row.
- Both routes require an actual student session, not a client-supplied username or an admin impersonation token; write requests are rate limited where supported.

## Ranking

- The report's source count remains independent from student feedback.
- Student self-reports are **not official PTE exam statistics**. This patch does not automatically add them to the baseline counts or reorder questions, avoiding accidental or abusive rank inflation.
- The existing `swt-repeat-ranking.js` handles user-described source report counts once the imported questions and their metadata are reviewed and published.

## Verification and launch gate

- Focused authentication, count validation, update/withdrawal and aggregate-report checks passed in the isolated test harness.
- Run `node --test tests/swt-exam-reports.test.js tests/swt-repeat-ranking.test.js tests/swt-new-question.test.js` and `node scripts/verify-release.js` in the full repository before any rollout.
- Verify fresh signup, login, logout, blocked accounts, admin impersonation, user switching, draft resumes, practice submissions, zero-count withdrawals, invalid counts, and simultaneous reports.
- Confirm database schema migration and a read-only smoke test using the staging environment before production.
- Review transcriptions, question bank duplication, teaching references and source report counts.
- **Do not merge to main, deploy to Railway, or seed the live 43-question bank without user approval.**
