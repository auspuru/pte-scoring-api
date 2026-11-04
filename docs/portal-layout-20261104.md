# Approved portal layout

Students enter Practice and use four main destinations: Practice, Mock Tests, My Progress and Results. Practice shows one skill at a time; individual question lists retain their existing search, queues and attempt IDs. Individual practice uses a readable single-column layout, with SWT using a desktop workspace for simultaneous reading and writing. Optional instructions and filters are disclosed on demand. Results links to the current individual practice history and native mock-history screens.

The Home logo, More menu and account button retain the existing controls and handlers. Home, My Progress, Vocabulary, Essay library, theme, staff access and the study assistant remain available. Protected mock surfaces keep their existing geometry and exam controls.

## Desktop SWT workspace

At PC widths, SWT fills the available viewport. Passage and summary sit side by side; the passage scrolls independently while the timer, navigation, word count and Submit remain visible. Focus view temporarily hides the portal header for more room; its exit button or Escape restores the header. Entering feedback or leaving SWT restores the normal report/navigation layout. Existing editor nodes, notes, timers, drafts and scoring handlers are retained.

My Progress is a distinct top-level tab with its own active state and URL. Results remains the entry to saved histories and original reports.

## Assessment and report boundary

`portal-layout.js` and `portal-layout.css` implement presentation outside the existing review output. They do not grade, submit, fetch student reports or replace saved result values. Existing report, feedback, grading, provider, audio and task-controller files remain unchanged. `portal-layout-preservation.json` records their source hashes, including the original IPT logo. `tests/portal-layout.test.js` verifies those hashes.

Report and partial-feedback surfaces are excluded from question and library styles. Report widths retain the prior workspace dimensions; the new layout stylesheet is screen-only so report print styles remain native. Browser tests compare original report-node geometry, typography, colours, borders, spacing and logo dimensions with the new layout enabled and disabled at 1363, 390 and 320 pixels.

## Validation

- Native regression and calibration suites; unchanged source/scoring inventory.
- Layout navigation, menus and keyboard focus, skill filtering, question search and results routes.
- Native microphone, prompt, timer, recording and save controls through the existing browser systems.
- Authenticated storage/reload/account-switch and historical report regression checks.
- Existing staff analysis, two retries and separate publication checks remain required.
- PC SWT fit checks at 1024×768, 1280×720, 1366×768 and 1920×1080; focus exit, independent passage scroll, notes/timer/draft preservation and result-screen restoration.
- Layout screenshots and validation evidence are bound to the final CI runtime.

Browser checks use synthetic accounts, microphone devices and provider fixtures. Production verification checks deployment and served asset hashes without creating a student attempt or making a paid assessment call.
