"""Generate frozen Full Mock recordings locally, without transmitting prompts.

Install requirements-full-mock-tts.txt into an authoring-only virtual environment.
Supply the downloaded public en_US-ljspeech-high voice under
.cache/full-mock-piper-voices; model provenance is recorded separately.
This script contains no network client and never generates audio at exam runtime.
"""
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

import onnxruntime
from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'content/full-mock/assets'
MANIFEST = ROOT / 'content/full-mock/audio-manifest.json'
MODEL_DIR = ROOT / '.cache/full-mock-piper-voices'
MODEL = MODEL_DIR / 'en_US-ljspeech-high.onnx'
digest = lambda value: hashlib.sha256(value).hexdigest()


def duration(file):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(file)]))


def main():
    onnxruntime.disable_telemetry_events()
    provenance = json.loads((MODEL_DIR / 'provenance.json').read_text())
    for name in ['en_US-ljspeech-high.onnx', 'en_US-ljspeech-high.onnx.json']:
        if digest((MODEL_DIR / name).read_bytes()) != provenance['files'][name]['sha256']:
            raise ValueError('Voice model bytes do not match provenance')
    voice = PiperVoice.load(str(MODEL))
    data = json.loads(subprocess.check_output(['node', '-e', '''
const {TASKS}=require('./full-mock/blueprint');
const {definition}=require('./full-mock/authoring');
console.log(JSON.stringify(definition().filter(q=>q.contentOrigin.kind==='original'&&TASKS.find(t=>t.type===q.type).timing.audio).map(q=>({...q,bounds:TASKS.find(t=>t.type===q.type).timing.promptSeconds}))));
'''], cwd=ROOT))
    if len(sys.argv) > 1:
        data = [q for q in data if q['id'] == sys.argv[1]]
        if not data:
            raise ValueError('Unknown original audio item')
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    DEST.mkdir(parents=True, exist_ok=True)
    for q in data:
        text_hash = digest(q['text'].encode())
        old = manifest.get(q['id'])
        if old:
            target = ROOT / old['path']
            if not (old['textSha256'] == text_hash and target.exists() and digest(target.read_bytes()) == old['audioSha256']):
                raise ValueError('Existing narration differs; author a new item version: ' + q['id'])
            print(q['id'], 'verified', flush=True)
            continue
        rate = int(q.get('audioRate', '-3%').rstrip('%'))
        with tempfile.TemporaryDirectory(prefix='full-mock-local-audio-') as temporary:
            raw = Path(temporary) / 'raw.wav'
            result = Path(temporary) / 'final.mp3'
            for attempt in range(3):
                with wave.open(str(raw), 'wb') as output:
                    voice.synthesize_wav(q['text'], output, syn_config=SynthesisConfig(length_scale=1 / (1 + rate / 100)))
                if q.get('audioEndCue'):
                    command = ['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.35:sample_rate=24000',
                               '-filter_complex', '[0:a]aresample=24000,aformat=channel_layouts=mono,apad=pad_dur=0.15[s];[1:a]volume=0.3[c];[s][c]concat=n=2:v=0:a=1,loudnorm=I=-18:TP=-1.5:LRA=7[out]', '-map', '[out]']
                else:
                    command = ['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af', 'loudnorm=I=-18:TP=-1.5:LRA=7']
                subprocess.run(command + ['-ac', '1', '-ar', '24000', '-b:a', '48k', str(result)], check=True)
                seconds = duration(result)
                low, high = q['bounds']
                if low <= seconds <= high:
                    break
                target_seconds = min(high * 0.94, max(low * 1.06, seconds))
                adjusted = round(((1 + rate / 100) * seconds / target_seconds - 1) * 100)
                if attempt == 2 or not -15 <= adjusted <= 15:
                    raise ValueError(f'{q["id"]}: {seconds:.3f}s outside {low}–{high}s at a natural narration rate')
                rate = adjusted
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(result), '-f', 'null', '-'], check=True)
            audio = result.read_bytes()
        audio_hash = digest(audio)
        target = DEST / (audio_hash + '.mp3')
        if target.exists():
            if target.read_bytes() != audio:
                raise ValueError('Content-addressed asset collision')
        else:
            with target.open('xb') as output:
                output.write(audio)
        manifest[q['id']] = {'path': target.relative_to(ROOT).as_posix(), 'textSha256': text_hash,
                            'audioSha256': audio_hash, 'bytes': len(audio), 'seconds': round(seconds, 3), 'voices': [provenance['voice']],
                            'generator': 'piper-tts ' + version('piper-tts') + ' (local)', 'rate': f'{rate:+d}%',
                            'voiceModelSha256': provenance['files'][MODEL.name]['sha256'], 'voiceModelRevision': provenance['revision'],
                            'normalization': 'EBU R128 -18 LUFS / -1.5 dBTP', 'validationStatus': 'decoded-and-probed',
                            'humanListeningReview': 'pending', 'endCue': bool(q.get('audioEndCue'))}
        MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
        print(q['id'], round(seconds, 3), 'seconds (local)', flush=True)


if __name__ == '__main__':
    main()
