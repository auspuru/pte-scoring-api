# Portal practice layout

Individual Speaking, Reading, Summarise Written Text and Essay practice share the visual language introduced for Listening: navy task navigation, blue actions, white answer cards, quiet metadata and a responsive question workspace.

`public/practice-studio.js` renders task navigation from `PracticeCatalogue.groups`. Its single delegated click handler calls the existing `switchSection` dispatcher, so reading library IDs, speaking types and writing destinations keep their existing routing. Static writing panes mount navigation once; speaking and reading render it with their existing views. No observer or input handler rebuilds an editor.

`public/practice-studio.css` is scoped to the new practice wrappers. Speaking libraries use a searchable row list, retain their filters and saved attempts, and disable task switching during unfinished recording attempts. Reading individual questions use full passage width; search preserves each question's library number, title and ID. SWT keeps its summary/highlight modes and side-by-side passage/answer cards. Essay keeps its saved attempts and drafts, adds a labelled question search and a quieter welcome/setup flow. Task buttons scroll horizontally within their container on small screens. Dark mode, visible keyboard focus, touch targets and reduced motion are supported.

Protected mock players do not use the new wrapper. No question bank, answer key, score policy, recording lifecycle, timer or account-storage format is changed. Listening retains its existing studio.

All new assets and changed deferred practice scripts use source fingerprints to avoid serving older immutable cached files. Update their references and the source fingerprint for `index.min.js` whenever editing these scripts.

Validation includes real reading/speaking controller flows, draft navigation and recording tests, shared navigation through the actual parent dispatcher, fingerprint checks and `scripts/verify-release.js`. Cloud browser visual inspection of local fixtures was blocked by its URL policy; responsive styles still warrant a manual visual pass in a signed-in portal session.
