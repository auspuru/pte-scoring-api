# Verified Describe Image references

The current portal bank uses `content/di-reference-manifest.json`, exported from
Visual Academy's effective, image-verified catalogue. The unchanged prediction
import remains an attribution snapshot, rather than the scoring reference.

The manifest contains all 54 shared DI questions, original image SHA-256 values
(or a structured-visual checksum), verified facts, optional fact indices, and a
short spoken sample. `di-reference.js` verifies the source when current questions
are loaded. Both practice and mock questions receive those same references.

New DI service requests carry the question ID, source identity, metadata version
and incoming mapping checksum. Academy verifies the identity, resolves its own
canonical mapping and pins that mapping in the durable job. Older text references
for the same unchanged image use the verified facts without restarting a completed
job. Receipts continue to hash the exact original request; repeated requests do
not replace an existing job's input, reference, marks or provider-call history.

Requests without a reference descriptor remain compatible with existing saved
jobs. Current attempts and completed results are not rewritten. New reattempts
refresh references for known images and replace legacy photographs or generated
DI placements with the current paper's supplied original charts and diagrams.
The previous attempt remains intact.
Azure delivery marks and the requirement to finish every scored question before
publication are unchanged. There is no automatic historical rescoring.

When changing metadata:

1. Verify the facts against the original image. Update Academy's authoritative
   reference audit or reviewed prediction source and regenerate derived files.
2. Run `node scripts/export-portal-di-references.js` in Academy. Copy that exact
   manifest to the portal. The exporter includes runtime image corrections and
   optional fields; copying the raw import catalogue loses those corrections.
3. Run `node scripts/verify-di-reference-sync.js
   ../describe-academy/content/di-reference-manifest.json` in the portal. Both
   manifests must match. Academy's tests also rebuild and compare its export;
   portal release validation checks every current question and sample.
4. Run the required release checks in both repositories. Deploy Academy first,
   verify it is healthy, and then deploy the portal. No runtime fetch of GitHub
   or a second service is needed to load a question or display a sample.

Reference facts are allowed source detail, not a list a student must recite.
Keep short, connected descriptions eligible for full content. Preserve explicit
limits for unlabelled charts, missing units and inconsistent source dates.
