# Full Mock review deployment

The user approved an isolated Railway preview on 29 October 2026. This preview
does not merge the Full Mock branch or release Full Mock to students.

## Scope

- App: `pte-full-mock-review`, service `b188947e-64be-4f44-af42-071e2756a6aa`.
- URL: <https://pte-full-mock-review-production.up.railway.app>.
- Source pinned to tested commit `290f037068514229de2efa7497f689f5db79f4e5`
  on `codex/full-mock-phase-1-audit-20261028`; pushes do not advance this preview.
- New PostgreSQL service: `Postgres`, ID `11709075-889e-4d36-bff3-5dca7b1d115f`,
  database `pte_full_mock_review`, dedicated volume
  `3ca40885-2a74-40db-977e-07c6c02d4bea`. The standard Railway template keeps its
  service name; this is the separate review database proposed in the PR.
- App and database use `us-west2` in the existing `airy-embrace` project.
  The environment is named `production`; these two resources are separate from
  the existing production app, volume and student storage.
- `DATABASE_URL` references only the new database. The database has no public
  domain or TCP proxy. Session signing uses the new database's generated secret.
- Existing provider configuration and `ADMIN_KEY` use server-side variable
  references. No existing key was displayed, rotated or copied into source.
- Mail credentials were not connected, and speaking alert delivery is disabled.

The reviewed deployment patch created only the new app, database and database
volume. It contained no shared-variable edits, service deletions or changes to
the existing production app. The paper remains `frozen-draft`; normal accounts
cannot start a Full Mock, including the native-speaking test identity.

Both services reached `SUCCESS`. The app deployment is
`761f1505-491c-463a-9f11-8c94b6a7149b`, and the database deployment is
`16f95a73-9ed5-4d9e-b208-f9d63c5552dd`. All nine recorded check rows passed,
including fresh login, profile persistence, and saved audio/trait metadata after
an app restart. [Redacted results](full-mock-preview-validation.json) retain the
observed deployment and unchanged production deployment identifiers. These
contract checks leave all four independent/manual review rows pending.

## Admin access and device review

Open <https://pte-full-mock-review-production.up.railway.app/admin> and use the
existing admin key. Choose **Open Portal as User** for a preview test account.
The live-check runner creates an account whose name starts `fullmock-review-`.
Alternatively, register a fresh test account in this preview and open it from
the preview's admin page. Accounts and passwords from the student site are not
copied to this database.

In that admin view, open **Mock Tests → Full Mock**, or navigate to
<https://pte-full-mock-review-production.up.railway.app/full-mock>. The
impersonation session must remain active; an ordinary login alone is restricted.

On a physical desktop and each supported mobile browser, verify microphone
permission, the equipment sample and playback through the intended headphones,
prompt playback, the start tone, response capture and saved recording playback.
Include a short interruption/reconnect and confirm that the question deadline
does not restart. Record the actual OS/browser/device and observed result.
Touch emulation and a synthetic recording do not clear either physical-device
check.

An independent teacher/editor must also review the 65 question forms, keys,
images, all 36 prompt recordings, speaker distinction, cutoffs and answer
feedback. An early-finished preview makes the submitted review available without
claiming that skipped responses were attempted. A provider's successful response
does not establish editorial quality or score accuracy.

Use `node scripts/check-full-mock-release.js --template` to generate the manual
review template for the current runtime. Each passed manual check needs its
reviewer, timestamp and evidence reference. The automated contract checks below
do not supply an independent reviewer or enable student release.

## Bounded live checks

`scripts/check-full-mock-preview.js` is an opt-in runner hardcoded to this
preview origin. It has no alternate host, production fallback or provider-key
argument. `--dry-run` verifies local original fixtures without making requests.

Run `--run-paid` once against this new review database. It checks readiness and
authentication, confirms that ordinary accounts cannot start Full Mock, writes
a synthetic scratch marker, and exercises three Full Mock writing adapters
(SWT, SST and Essay) plus Describe Image content with the frozen original sample
responses. Models are reached through the preview's server-side provider calls.
The native result must pass the existing rubric, version and evidence checks;
a local/provisional fallback cannot pass as a complete native assessment.

The speaking smoke uses the repository's original `rs-1` recording and native
speaking routes, under a newly registered `pppp` test identity in this preview
only. It verifies OpenAI transcription, native RS marking, Azure delivery and
saved recording retrieval. Registration must succeed without replacing an
existing account; the runner never resets a password or changes an allowlist.
This fixture exercises the shared providers, not a real candidate's Full Mock
recording or a completed 65-item live-provider attempt.

The runner has a maximum of 55 preview HTTP requests. Native services retain
their own existing bounded validation/review budgets. Only the synthetic account
profile and one native-speaking attempt are written. No email or student-site
request is made. Session credentials stay in an ignored file with mode 0600;
stdout and the redacted evidence contain no credentials, account identifiers,
audio, transcripts or raw provider responses.

After restarting only this preview app, `--verify-saved` checks the scratch
marker and saved speaking/audio/trait metadata through fresh logins. It makes no
new paid scoring calls. The database service is not restarted.

```sh
node scripts/check-full-mock-preview.js --dry-run
node scripts/check-full-mock-preview.js --run-paid
# Restart only pte-full-mock-review, then:
node scripts/check-full-mock-preview.js --verify-saved
```

The private session file is `.cache/full-mock-preview-session.json`; do not
publish it. Redacted run results are written to
`.cache/full-mock-preview-live.json` and may be copied to a reviewed evidence
document. Automated results are kept separate from the Phase 6 manual checklist.

## Release boundary

Full Mock remains uncalibrated. Native scores in a synthetic smoke run are not
official PTE scores, an empirical conversion, or evidence of candidate accuracy.
Physical microphone, exact-attempt provider review and independent editorial
clearance remain required. No paired consented official-practice cohort has been
provided. The immutable v1 paper and its student-release flag are unchanged.
