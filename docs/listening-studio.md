# Listening practice workspace

Listening Practice now routes all eight tasks through the shared Writing Lab attempt API. The six objective-task libraries reuse 33 immutable question records from the three listening mock papers. SST and dictation preserve their existing question ordering and assessments.

`public/listening-studio.js` supplies the shared task menu, question library, filters, mode selector and guidance. `public/listening-studio.css` scopes the layout to the listening workspace. `writing-lab-client.js` continues to own authentication, drafts, audio, submission and assessment requests.

## Modes and compatibility

- New individual attempts explicitly store `mode: practice` or `mode: exam`. Practice begins on Play, has no deadline, and permits pause/replay. Exam-style practice uses the existing per-question training timer and single-play interface. It is distinct from the full sectional mock.
- Existing attempts without mode retain their timed behaviour. Existing assessment results and immutable submitted answers are preserved.
- Mocks always store exam mode regardless of the requested practice mode. Their SST clock and shared listening clock remain unchanged. Writing mocks retain their existing workspace layout.
- Supported practice and exam-style attempts are labelled in My attempts. Playback counts are saved separately from answers; replay never starts another grading request.
- Answer keys, model responses, explanations and full recordings' transcripts remain hidden until final submission. FIB/HIW expose only the transcript necessary to answer that question.
- Earlier HCS/HIW libraries remain available through `listening-hcs-bank` and `listening-hiw-bank`. Existing reading-engine teacher assignments and resume links are forwarded to these routes.
- Bookmarks and selected mode are stored on the device under the signed-in account. Responses, notes and completed assessments continue to use the existing account store.

## Verification

`tests/listening-studio.test.js` covers all eight routes, filtering, answer review, word alignment, account isolation, server mode enforcement and all six individual objective-task submission/assessment flows. The extended Writing Lab client harness covers native input activation, untimed practice, pause/replay, response preservation and explicit exam-mode restrictions. Existing tests cover protected mocks, save conflicts, scoring, audio recovery and history.

Run `node scripts/verify-release.js` with the normal installed browser and Edge TTS dependencies. This runs the complete test suite, offline scoring calibration, production build and content/audio validators. Browser visual validation must be reported separately; a simulated DOM test does not verify the final responsive layout.
