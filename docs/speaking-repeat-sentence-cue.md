# Repeat Sentence start sound

Practice and mock Repeat Sentence questions play a short, quiet 1 kHz tone after
the sentence finishes. The microphone starts after a 300 ms cue interval, which
includes the 120 ms tone and a gap before capture. The full response lasts up to
15 seconds after recording starts; the cue is not part of the recorded answer.

The shared Web Audio helper unlocks on a start gesture and also supports Safari's
prefixed AudioContext. It cancels pending callbacks when the student navigates,
changes accounts, leaves the page or loses the protected mock screen. Timer ticks
and result polling never replay a cue. If audio output is blocked or unavailable,
recording still works. No scoring request is involved in playing the sound.

New mock snapshots reserve the cue interval in their server clock. A delayed
prompt completion is allowed to finish before the cue; the client measures the
response window from actual recording start. Existing upload-lock, expiry and
whole-mock deadline checks remain in force. Older snapshots retain their saved
server clock. New reattempts receive the updated RS cue setting.

All three new papers contain only the original supplied prediction PNG charts,
maps and diagrams. Their IDs, supplied-file provenance and original image checksums
are verified. Photographs and generated placeholders are rejected when a paper is
created. Mock 2 uses the supplied seasonal-rainfall chart in place of the bird
feeder photo. New reattempts replace disallowed legacy DI placements with the
current paper's supplied images; the previous attempt and recording remain intact.
