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


def digest(value):
    return hashlib.sha256(value).hexdigest()


async def main():
    # Honour the machine's additional trusted CA bundle without disabling TLS.
    if os.environ.get('SSL_CERT_FILE'):
        edge_tts.communicate._SSL_CTX.load_verify_locations(os.environ['SSL_CERT_FILE'])
    bank = json.loads((ROOT / 'content' / 'writing-lab.json').read_text())
    questions = bank['spoken'] + [q for m in bank['mocks'] for q in m['questions'] if q['type'] in ('sst', 'wfd')]
    DEST.mkdir(parents=True, exist_ok=True)
    manifest_path = DEST / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for q in questions:
        file = DEST / (q['id'] + '.mp3')
        existing = manifest.get(q['id'], {})
        text_hash = digest(q['text'].encode())
        if existing.get('textSha256') == text_hash and file.exists() and digest(file.read_bytes()) == existing.get('audioSha256'):
            print(q['id'], 'already verified', flush=True)
            continue
        tmp = file.with_suffix('.tmp.mp3')
        voice = VOICES[q['voice']]
        rate = q.get('audioRate', '-5%')
        await asyncio.wait_for(edge_tts.Communicate(q['text'], voice, rate=rate).save(str(tmp)), timeout=55)
        duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(tmp)]))
        low, high = (60, 90) if q['type'] == 'sst' else (3, 8)
        if not low <= duration <= high:
            raise ValueError(f"{q['id']}: {duration:.2f}s outside {low}–{high}s")
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(tmp), '-f', 'null', '-'], check=True)
        data = tmp.read_bytes()
        tmp.replace(file)
        manifest[q['id']] = {'textSha256': text_hash, 'audioSha256': digest(data), 'bytes': len(data), 'seconds': round(duration, 3), 'voice': voice, 'rate': rate}
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        print(q['id'], f'{duration:.2f}s', len(data), 'bytes', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
