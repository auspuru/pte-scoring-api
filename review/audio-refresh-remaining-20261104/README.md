# Remaining neural audio recordings — review set

Prepared after the approved RTS refresh. These **55 recordings are ready to listen to**, with native lossless masters, exact source scripts, provider receipts and independent transcripts. **They are not connected to the live portal.**

| Batch | Recordings | Listening index |
|---|---:|---|
| Summarise Group Discussion | 15 | [Open SGD clips](sgd/README.md) |
| Highlight Incorrect Words | 20 | [Open HIW clips](hiw/README.md) |
| Summarise Spoken Text | 17 | [Open SST clips](sst/README.md) |
| Write From Dictation | 3 | [Open WFD clips](wfd/README.md) |

All files decode fully and retain source/master/audio hashes and measured durations. Final encoded peaks are at or below -1.5 dBTP. New recordings use the approved voice profiles at source synthesis speed, with constant-gain processing and no tempo stretching, limiting or silence padding. Exact accepted SGD/HIW/SST pilot bytes are reused where the source matches. Brief declared pauses separate SGD narration and turns.

Technical validation covers all 55 source/media bindings, all 20 HIW answer maps, and all 15 complete SGD assemblies. The decoded lossless SGD masters equal their ordered native segment samples plus the declared gaps; per-segment hashes and timings allow that proof to be checked without provider access. Independent transcription is stored separately from listening acceptance. There are 9 flagged comparisons after spelling/number normalization; inspect the receipts rather than interpreting them as confirmed defects.

The 17 SST clips remain naturally short. The three WFD clips slightly exceed the frozen 5-second maximum and are flagged for practice use only. No frozen paper, historical attempt, mark, timer, question ID or live media resolver was changed.

## Verify or author a candidate

Run `python review/audio-refresh-remaining-20261104/author.py --verify` from the repository to verify the bundle offline using ffmpeg/ffprobe. This makes no provider calls.

To explicitly regenerate one review candidate using its recorded text and voice settings:

```sh
python review/audio-refresh-remaining-20261104/author.py \
  --generate sgd/sgd-2 --output work/new-audio-review
```

Generation uses the configured existing `OPENAI_API_KEY` and writes outside deployed content. Raw segments are cached with text/model/voice/instruction/speed hashes and provider receipts. Interrupted or uncertain requests are held for review instead of blindly repeated. The command does not publish media or claim a listening pass.

The final integration of each batch requires versioned playback keys and historical compatibility; short SST must bypass the old stretching path, HIW must retain its playback/answer lifecycle, and shared Listening consumers need an explicit new-version mapping. These integration changes are outside this preparation branch.
