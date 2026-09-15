"""Generate original speaking prompts using the existing edge-tts/ffmpeg workflow."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

import edge_tts
import edge_tts.communicate

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'content' / 'speaking-audio'
VOICES = ['en-AU-NatashaNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural']
digest = lambda value: hashlib.sha256(value).hexdigest()

async def main():
    if os.environ.get('SSL_CERT_FILE'):
        edge_tts.communicate._SSL_CTX.load_verify_locations(os.environ['SSL_CERT_FILE'])
    bank = json.loads(subprocess.check_output(['node', '-e', 'console.log(JSON.stringify(require("./content/speaking-bank")))'], cwd=ROOT))
    DEST.mkdir(parents=True, exist_ok=True)
    manifest_path = DEST / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    limit = asyncio.Semaphore(3)
    async def generate(q):
        if q['type'] not in ('rs', 'rl', 'sgd', 'rts'):
            return
        async with limit:
            target = DEST / (q['id'] + '.mp3')
            text_hash = digest(q['text'].encode())
            entry = manifest.get(q['id'], {})
            if target.exists() and entry.get('textSha256') == text_hash and entry.get('audioSha256') == digest(target.read_bytes()):
                print(q['id'], 'verified', flush=True)
                return
            with tempfile.TemporaryDirectory(prefix='speaking-prompt-') as temporary:
                parts = []
                for i, (_, text) in enumerate(q.get('turns', [['Narrator', q['text']]])):
                    part = Path(temporary) / (str(i) + '.mp3')
                    await asyncio.wait_for(edge_tts.Communicate(text, VOICES[i % 3], rate='-3%').save(str(part)), 55)
                    parts.append(str(part))
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'concat:' + '|'.join(parts), '-ac', '1', '-ar', '24000', '-b:a', '48k', str(target)], check=True)
            seconds = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(target)]))
            low, high = {'rs': (3, 9), 'rl': (45, 90), 'sgd': (90, 180), 'rts': (5, 35)}[q['type']]
            if not low <= seconds <= high:
                raise ValueError(f'{q["id"]}: {seconds:.2f}s outside {low}–{high}s')
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True)
            data = target.read_bytes()
            manifest[q['id']] = {'textSha256': text_hash, 'audioSha256': digest(data), 'bytes': len(data), 'seconds': round(seconds, 3), 'voices': VOICES if q.get('turns') else VOICES[:1]}
            manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
            print(q['id'], round(seconds, 2), 'seconds', flush=True)
    await asyncio.gather(*(generate(q) for q in bank['questions']))

if __name__ == '__main__':
    asyncio.run(main())
