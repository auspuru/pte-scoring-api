"""Rebuild checked-in narration: pip install edge-tts==7.2.8; needs Node, ffmpeg and ffprobe."""
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
NORMALIZATION_FILTER = 'loudnorm=I=-18:TP=-1.5:LRA=7'
NORMALIZATION_LABEL = 'EBU R128 -18 LUFS / -1.5 dBTP'
VOICES = {
    'nova': 'en-AU-NatashaNeural',
    'onyx': 'en-AU-WilliamNeural',
    'alloy': 'en-GB-SoniaNeural',
    'fable': 'en-GB-RyanNeural',
    'shimmer': 'en-GB-SoniaNeural',
    'echo': 'en-US-GuyNeural',
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def prediction_questions():
    script = (
        "const p=require('./content/writing-predictions-sep-2026');"
        "process.stdout.write(JSON.stringify({sst:p.sst,wfd:p.wfd}));"
    )
    payload = subprocess.check_output(['node', '-e', script], cwd=ROOT, text=True)
    data = json.loads(payload)
    return data['sst'] + data['wfd']


async def main():
    # Honour the machine's additional trusted CA bundle without disabling TLS.
    if os.environ.get('SSL_CERT_FILE'):
        edge_tts.communicate._SSL_CTX.load_verify_locations(os.environ['SSL_CERT_FILE'])
    bank = json.loads((ROOT / 'content' / 'writing-lab.json').read_text())
    questions = (
        bank['spoken']
        + bank.get('dictation', [])
        + [q for m in bank['mocks'] for q in m['questions'] if q['type'] in ('sst', 'wfd')]
        + prediction_questions()
    )
    DEST.mkdir(parents=True, exist_ok=True)
    manifest_path = DEST / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    semaphore = asyncio.Semaphore(4)

    async def generate(q):
        file = DEST / (q['id'] + '.mp3')
        raw = DEST / (q['id'] + '.raw.mp3')
        tmp = DEST / (q['id'] + '.tmp.mp3')
        existing = manifest.get(q['id'], {})
        text_hash = digest(q['text'].encode())
        file_verified = (
            existing.get('textSha256') == text_hash
            and file.exists()
            and digest(file.read_bytes()) == existing.get('audioSha256')
        )
        if file_verified and existing.get('normalization') == NORMALIZATION_LABEL:
            print(q['id'], 'already verified and normalized', flush=True)
            return

        voice = existing.get('voice') if file_verified else VOICES[q['voice']]
        rate = existing.get('rate') if file_verified else q.get('audioRate', '-5%')
        source = file
        if not file_verified:
            source = raw
            async with semaphore:
                await asyncio.wait_for(
                    edge_tts.Communicate(q['text'], voice, rate=rate).save(str(raw)),
                    timeout=55
                )

        # Normalise every published recording once so old low-volume dictations
        # and newly generated prediction recordings have consistent playback.
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-i', str(source),
            '-af', NORMALIZATION_FILTER, '-codec:a', 'libmp3lame', '-b:a', '96k',
            str(tmp)
        ], check=True)
        duration = float(subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', str(tmp)
        ]))
        low, high = (60, 90) if q['type'] == 'sst' else (3, 8)
        if not low <= duration <= high:
            raise ValueError(f"{q['id']}: {duration:.2f}s outside {low}–{high}s")
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(tmp), '-f', 'null', '-'], check=True)
        data = tmp.read_bytes()
        tmp.replace(file)
        if raw.exists():
            raw.unlink()
        manifest[q['id']] = {
            'textSha256': text_hash,
            'audioSha256': digest(data),
            'bytes': len(data),
            'seconds': round(duration, 3),
            'voice': voice,
            'rate': rate,
            'normalization': NORMALIZATION_LABEL,
            'validationStatus': 'validated',
            'validatedAt': __import__('datetime').date.today().isoformat()
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        print(q['id'], f'{duration:.2f}s', len(data), 'bytes', flush=True)

    await asyncio.gather(*(generate(q) for q in questions))


if __name__ == '__main__':
    asyncio.run(main())
