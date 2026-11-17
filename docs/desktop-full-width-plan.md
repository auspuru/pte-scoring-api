# Desktop full-width portal

Baseline: origin/main at 5c44aa42f0ab93c17c5aebbb24fda070fad31a23.

1. At desktop widths (1,000px and above), let the shared navigation, page heading and all portal panes use the available browser width with existing 32px gutters.
2. Remove nested practice workspace width caps so Speaking, Reading, Writing and Listening can use the expanded panes. Keep text, images, dialogs and native reports styled for readability.
3. Preserve the existing viewport-filling SWT workspace, protected exam layouts, print styling and smaller-window fallback. Full width requires no browser permission or forced fullscreen API.
4. Verify desktop pane/header width, overflow, native navigation, practice controls, report integrity and laptop SWT viewport geometry in browser tests. Run layout preservation tests and the full release verification.

Scope is presentation only: no scoring, question content, saved attempts, account permissions or timers change.
