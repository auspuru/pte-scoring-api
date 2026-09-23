# Student Improvement V1

This release adds a teacher-assigned improvement workflow to the existing PTE portal.

## Student experience
- My Next Steps in the existing portal
- Up to three active focus plans
- Video, practice and exact-question actions
- One-time new-plan notification
- Ready for teacher review workflow

## Teacher experience
- Improvement action from the existing admin user list
- Reusable PTE improvement modules
- Exact question picker backed by the live Speaking, Reading, Listening, Writing and SWT catalogues
- Teacher notes, priority, optional due date and new-attempt marker
- Continue, Master and Archive review actions

The implementation uses the existing account/session system and a dedicated intervention store. Existing scoring and attempt tables are not repurposed.

V1 also supports assigning exact Essay prompts from the student's existing essay library.

## V2 refinements
- Exact assigned questions reconcile automatically from submitted portal attempts.
- Students can use Self-help Beta for SWT, SST and Essay suggestions based on recent score traits where available.
- Teachers can build fully manual custom plans with instructions and links.
- Missing legacy JSON accounts are merged into Postgres once without overwriting existing accounts.

## SWT highlight trainer
Students who struggle to identify important SWT content can practise on 15 existing passages by highlighting exact words and phrases inside the original paragraph. Feedback explains missed ideas, why they matter, and the central phrases that carry the summary.

## Real practice sets
Placeholder drill cards were removed. Practice items now launch real portal tasks and complete from submitted attempts; only videos and reading/instruction steps use manual acknowledgement.

## Inline SWT highlighting
Content-selection practice keeps the original passage intact. Students drag across key words and phrases directly inside the paragraph. SWT Practice asks students to choose Full Summary Mode or Highlight Key Phrases Mode.

Students can create several phrase highlights in one passage and remove any yellow highlight before checking their selection.
