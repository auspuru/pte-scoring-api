# One IPT practice workspace

## Goal
Make the existing student portal feel like one calm, dependable website. Students should immediately see where to practise, keep their place when moving between tasks, and understand whether a draft or assessment has saved.

## Design and delivery plan
1. Use one persistent sidebar and header for Home, SWT, Essay Practice, Essay Library and Vocabulary. Remove the duplicated vocabulary navigation and full-screen task overlays. Keep the existing Reading service accessible without replacing the writing workspace.
2. Put SWT, Essay and Vocabulary actions first on Home, with a visible return to an unfinished essay. Keep progress, history and study habits below the primary tasks.
3. Standardise typography, solid surfaces, indigo actions, clear borders, readable spacing and responsive layouts. On small screens, use a labelled navigation drawer and collapsible secondary lists. Support keyboard focus, reduced motion and both colour themes.
4. Give each section a URL and support browser Back/Forward. Keep the editor, results, question and vocabulary state while navigating. Recover unfinished essay drafts on this device after a refresh, scoped to the signed-in account. Distinguish device draft saves from cloud assessment history.
5. Keep the meaning-based scoring policy, evidence requirements, reference checking and cross-device attempt merging intact. Run the existing regression suite and focused tests for navigation and draft isolation before publishing to the existing Railway site.

## Boundaries
- The existing Reading mock app has a separate service and authentication. Its link opens a separate tab so the writing workspace remains available. Combining Reading's backend and accounts needs work on that service; embedding it without verified support would create an unreliable student flow.
- Draft recovery is labelled as local to this device. Submitted essay history continues using the existing cloud sync.
- No browser-based visual validation was requested; verification covers source structure, routing behaviour, draft recovery and the existing scoring/sync tests.
