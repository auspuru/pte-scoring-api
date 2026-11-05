# Reassess saved Full Mock delivery

Open **Admin → student → Full mock recording review**. Click **Find submitted Full Mocks**, choose the exact saved submission, then **Inspect full mock**. Verify the account, attempt ID and paper/version.

For a complete, settled report, click **Load saved recordings for reassessment**. Each eligible question has **Send saved recording to Azure**. This sends the original stored audio, including all verified chunks, to the continuous Azure pronunciation/fluency assessment. No upload, audio editing, content reassessment or transcript substitution is involved. Each send incurs a provider request.

Review or discard each completed proposal before sending the next recording. Discard retains the provider receipt and leaves marks unchanged.

Review the previous and proposed pronunciation/fluency marks and the resulting report indices. Check the replacement confirmation and click **Publish replacement scores**. This replaces that question’s published delivery marks and recalculates the normal report. Content, unrelated questions, frozen paper, assessment snapshot and original recordings remain intact. Original item results and delivery stages, provider result, audio hash and before/after profiles stay in the attempt’s reassessment history.

Only confirmed, ungated speaking answers with one original recording are eligible. ASQ has no delivery marks. Incomplete reports use the existing missing-assessment workflow. Multiple-recording answers require a separately audited assembly path.

A repeated operation does not send audio again. A lost browser response can be checked with **Refresh reassessment status**. A running or unconfirmed request blocks new sends; do not create a fresh operation to bypass it. If the process stops before a provider receipt is saved, an operator must resolve that request before another paid send. Failed/unconfirmed work never replaces confirmed marks. Changes to saved answers, jobs or snapshot invalidate a proposed replacement. Another reassessment published first also invalidates proposals based on the previous report; refresh before sending again.

The pathway uses existing admin authentication and owner-bound attempt storage. The API never accepts proposed scores or replacement audio from the browser. No student results are changed by deployment or tests.
