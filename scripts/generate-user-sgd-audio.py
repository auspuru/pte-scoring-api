"""Author all SGD recordings with introductions and contrasting stable voices.

Uses piper-tts==1.3.0 and ffmpeg/ffprobe. Download the VCTK medium model and
its .onnx.json from the URL in content/speaking-audio/sgd-voice-source.json
into .cache/sgd-piper-voices/. Model weights are authoring-only, not deployed.
"""
import hashlib
import json
import re
import subprocess
import tempfile
import wave
from importlib.metadata import version
from pathlib import Path

import onnxruntime
from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'content/speaking-audio'
MODELS = ROOT / '.cache/sgd-piper-voices'
MODEL = 'en_GB-vctk-medium.onnx'
VOICES = ['p225', 'p237', 'p238']
PROFILE_VERSION = 'sgd-contrasting-voices-20261030-1'
digest = lambda value: hashlib.sha256(value).hexdigest()


def duration(file):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration', '-of', 'default=nw=1:nk=1', str(file)]))


def main():
    onnxruntime.disable_telemetry_events()
    source = json.loads((DEST / 'sgd-voice-source.json').read_text())
    for filename, expected in source['sha256'].items():
        if digest((MODELS / filename).read_bytes()) != expected:
            raise ValueError('Voice model does not match source checksum: ' + filename)
    voice = PiperVoice.load(str(MODELS / MODEL))
    config = json.loads((MODELS / (MODEL + '.json')).read_text())
    manifest_path = DEST / 'sgd-user-manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    questions = json.loads(subprocess.check_output(['node', '-e',
        'console.log(JSON.stringify(require("./content/speaking-bank").questions.filter(q=>q.type==="sgd")))'], cwd=ROOT))
    for q in questions:
        labels = list(dict.fromkeys(turn[0] for turn in q['turns']))
        if len(labels) != 3 or not q.get('narration'):
            raise ValueError(q['id'] + ': three speakers and introductory narration required')
        speakers = dict(zip(labels, VOICES))
        speaker_ids = {label: config['speaker_id_map'][name] for label, name in speakers.items()}
        rate = q.get('audioRate', '-17%')
        target = DEST / (q['id'] + '.mp3')
        text_hash = digest(q['text'].encode())
        old = manifest.get(q['id'], {})
        if target.exists() and old.get('textSha256') == text_hash and old.get('audioSha256') == digest(target.read_bytes()) and old.get('rate') == rate and old.get('profileVersion') == PROFILE_VERSION:
            print(q['id'], 'verified', flush=True)
            continue
        with tempfile.TemporaryDirectory(prefix='sgd-audio-') as directory:
            temporary = Path(directory)
            parts = []
            segments = [(labels[0], q['narration'])] + q['turns']
            for index, (speaker, text) in enumerate(segments):
                part = temporary / f'{index:02}.wav'
                # Pronounce the initialism as two letters, retaining the exact transcript.
                spoken = re.sub(r'\bAI\b', 'A I', text)
                pace = 1 / (1 + int(rate.rstrip('%')) / 100)
                with wave.open(str(part), 'wb') as output:
                    voice.synthesize_wav(spoken, output, syn_config=SynthesisConfig(
                        speaker_id=speaker_ids[speaker], length_scale=pace))
                parts.append(part)
            combined = temporary / 'discussion.wav'
            with wave.open(str(parts[0]), 'rb') as first:
                parameters = first.getparams()
            with wave.open(str(combined), 'wb') as output:
                output.setparams(parameters)
                for index, part in enumerate(parts):
                    with wave.open(str(part), 'rb') as audio:
                        output.writeframes(audio.readframes(audio.getnframes()))
                    # Brief, consistent turn gaps; voice identity follows the label, not position.
                    output.writeframes(b'\0' * int(parameters.framerate * (0.6 if index == 0 else 0.22)) * parameters.sampwidth)
            seconds = duration(combined)
            args = ['ffmpeg', '-v', 'error', '-y', '-i', str(combined)]
            spoken_words = sum(len(text.split()) for _, text in segments)
            # Keep the contrasting voices at a clear listening pace. Short
            # original discussions must still meet the SGD duration bounds.
            minimum = min(177, max(95, spoken_words / 180 * 60))
            tempo = seconds / min(177, max(minimum, seconds))
            if abs(tempo - 1) > 0.001:
                args += ['-af', f'atempo={tempo:.6f}']
            args += ['-ac', '1', '-ar', '24000', '-b:a', '48k', str(target)]
            subprocess.run(args, check=True)
        seconds = duration(target)
        if not 90 <= seconds <= 180:
            raise ValueError(f'{q["id"]}: {seconds:.2f}s outside 90–180 seconds')
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True)
        data = target.read_bytes()
        speaker_voices = {label: f'piper:{MODEL}:{name}' for label, name in speakers.items()}
        manifest[q['id']] = dict(textSha256=text_hash, audioSha256=digest(data), bytes=len(data),
            seconds=round(seconds, 3), voices=list(speaker_voices.values()),
            speakerVoices=speaker_voices, turnSpeakers=[turn[0] for turn in q['turns']],
            speakerAccents={label: source['speakerProfiles'][name]['accent'] for label, name in speakers.items()},
            narrationIncluded=True, narrationSha256=digest(q['narration'].encode()),
            profileVersion=PROFILE_VERSION, rate=rate, targetWordsPerMinute=180,
            generator='piper-tts ' + version('piper-tts'),
            source='sgd-voice-source.json')
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        print(q['id'], round(seconds, 2), 'seconds', flush=True)


if __name__ == '__main__':
    main()
