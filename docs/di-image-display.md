# Clear Describe Image display

The portal displays the same verified clear versions already reviewed in Visual Academy (`auspuru/Describe`, commit `fd65b34bd66849e2148188e05f4e14a78fb77d76`). All 49 supplied DI images are covered, including all 15 mock placements. Files are copied byte-for-byte; their source-repository Git blob IDs were checked before import.

- Eleven images use existing vector renditions with verified labels and values.
- Three use verified higher-resolution copies of the same image, including the India map's existing enlarged copy.
- Thirty-five use existing lossless resampling of the supplied image. This improves display size and edges; unreadable source detail cannot be recovered or invented.

`content/di-display-manifest.json` binds each display asset to the original PNG's SHA-256 and records the display checksum, derivation and available source attribution. Display filenames include their content hash. `scripts/verify-di-display.js` runs in the release build and checks original/display files, checksums and full practice/mock coverage. To reimport a reviewed release, run `node scripts/import-di-display.js /path/to/Describe <reviewed-commit>` and verify every copied file against that source commit before shipping.

Practice, active mocks and completed reports receive `displayImageUrl` separately from `imageUrl`. The saved question, recording, scoring image, metadata mapping and assessment job remain unchanged. Unknown historical questions and questions with different source hashes keep their saved image. If a clear image download fails, the player retries the saved original once.

The image viewer is loaded only when a speaking route opens; individual clear image files load only when their question is displayed. Both players preserve aspect ratio and offer an accessible enlarged viewer with zoom, scroll and fit-to-screen controls. Opening or closing it does not restart or pause the question clock, prompt or microphone. Normal navigation closes the viewer and removes its resize/load handlers.
