# Approved portal layout

Students enter Practice and use three main destinations: Practice, Mock Tests and Results. Practice shows one skill at a time; individual question lists retain their existing search, queues and attempt IDs. Individual practice uses a readable single-column layout. Optional instructions and filters are disclosed on demand. Results links to the current individual practice history and native mock-history screens.

The Home logo, More menu and account button retain the existing controls and handlers. Home, My Progress, Vocabulary, Essay library, theme, staff access and the study assistant remain available. Protected mock surfaces keep their existing geometry and exam controls.

## Assessment and report boundary

`portal-layout.js` and `portal-layout.css` implement presentation outside the existing review output. They do not grade, submit, fetch student reports or replace saved result values. Existing report, feedback, grading, provider, audio and task-controller files remain unchanged. `portal-layout-preservation.json` records their source hashes, including the original IPT logo. `tests/portal-layout.test.js` verifies those hashes.

Report and partial-feedback surfaces are excluded from question and library styles. Report widths retain the prior workspace dimensions; the new layout stylesheet is screen-only so report print styles remain native. Browser tests compare original report-node geometry, typography, colours, borders, spacing and logo dimensions with the new layout enabled and disabled at 1363, 390 and 320 pixels.

## Validation

- Native regression and calibration suites; unchanged source/scoring inventory.
- Layout navigation, menus and keyboard focus, skill filtering, question search and results routes.
- Native microphone, prompt, timer, recording and save controls through the existing browser systems.
- Authenticated storage/reload/account-switch and historical report regression checks.
- Existing staff analysis, two retries and separate publication checks remain required.
- Layout screenshots and validation evidence are bound to the final CI runtime.

Browser checks use synthetic accounts, microphone devices and provider fixtures. Production verification checks deployment and served asset hashes without creating a student attempt or making a paid assessment call.
