"""Rebuild checked-in narration: pip install edge-tts==7.2.8; needs ffmpeg/ffprobe."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess

import edge_tts
import edge_tts.communicate

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'content' / 'writing-audio'
VOICES = {
    'nova': 'en-AU-NatashaNeural',
    'onyx': 'en-AU-WilliamNeural',
    'fable': 'en-GB-RyanNeural',
    'shimmer': 'en-GB-SoniaNeural',
    'echo': 'en-US-GuyNeural',
}
VOICE_KEYS = tuple(VOICES)


def voice_key(question):
    configured = question.get('voice')
    if configured in VOICES:
        return configured
    # Prediction items do not carry a voice. Keep their checked-in narration
    # deterministic so a rebuild does not reshuffle speakers.
    slot = int(hashlib.sha256(question['id'].encode()).hexdigest()[:8], 16) % len(VOICE_KEYS)
    return VOICE_KEYS[slot]


def audio_rate(question):
    if question.get('audioRate'):
        return question['audioRate']
    if question['type'] == 'wfd':
        return '-5%'
    # Aim prediction SST narration near the middle of the accepted 60–90s
    # window while keeping speech natural across different transcript lengths.
    words = len(question['text'].split())
    target_wpm = words / (72 / 60)
    percent = round((target_wpm / 170 - 1) * 100)
    percent = max(-25, min(12, percent))
    return f'{percent:+d}%'


def digest(value):
    return hashlib.sha256(value).hexdigest()


async def main():
    # Honour the machine's additional trusted CA bundle without disabling TLS.
    if os.environ.get('SSL_CERT_FILE'):
        edge_tts.communicate._SSL_CTX.load_verify_locations(os.environ['SSL_CERT_FILE'])
    bank = json.loads((ROOT / 'content' / 'writing-lab.json').read_text())
    prediction_data = json.loads(subprocess.check_output([
        'node', '-e',
        "const p=require('./content/writing-predictions-sep-2026');process.stdout.write(JSON.stringify({sst:p.sst||[],wfd:p.wfd||[]}));"
    ], cwd=ROOT, text=True))
    combined = bank['spoken'] + bank.get('dictation', []) + [q for m in bank['mocks'] for q in m['questions'] if q['type'] in ('sst', 'wfd')] + prediction_data['sst'] + prediction_data['wfd']
    questions = list({q['id']: q for q in combined}.values())
    DEST.mkdir(parents=True, exist_ok=True)
    manifest_path = DEST / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    semaphore = asyncio.Semaphore(4)
    async def generate(q):
        file = DEST / (q['id'] + '.mp3')
        existing = manifest.get(q['id'], {})
        text_hash = digest(q['text'].encode())
        if existing.get('textSha256') == text_hash and file.exists() and digest(file.read_bytes()) == existing.get('audioSha256'):
            print(q['id'], 'already verified', flush=True)
            return
        tmp = file.with_suffix('.tmp.mp3')
        voice = VOICES[voice_key(q)]
        initial_rate = audio_rate(q)
        percent = int(initial_rate.replace('%', ''))
        low, high = (60, 90) if q['type'] == 'sst' else (3, 8)
        target = 72 if q['type'] == 'sst' else 5.5
        duration = 0
        for attempt in range(4):
            rate = f'{percent:+d}%'
            tmp.unlink(missing_ok=True)
            async with semaphore:
                await asyncio.wait_for(edge_tts.Communicate(q['text'], voice, rate=rate).save(str(tmp)), timeout=55)
            duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(tmp)]))
            if low <= duration <= high:
                break
            # edge-tts rate is a speed percentage. Estimate the next rate from
            # the measured duration and aim for the centre of the quality gate.
            speed_factor = max(0.2, 1 + percent / 100)
            next_factor = speed_factor * duration / target
            percent = max(-70, min(60, round((next_factor - 1) * 100)))
        else:
            raise ValueError(f"{q['id']}: {duration:.2f}s outside {low}–{high}s after rate tuning")
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(tmp), '-f', 'null', '-'], check=True)
        data = tmp.read_bytes()
        tmp.replace(file)
        manifest[q['id']] = {'textSha256': text_hash, 'audioSha256': digest(data), 'bytes': len(data), 'seconds': round(duration, 3), 'voice': voice, 'rate': rate, 'validationStatus': 'validated', 'validatedAt': __import__('datetime').date.today().isoformat()}
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        print(q['id'], f'{duration:.2f}s', len(data), 'bytes', flush=True)

    await asyncio.gather(*(generate(q) for q in questions))


if __name__ == '__main__':
    asyncio.run(main())
