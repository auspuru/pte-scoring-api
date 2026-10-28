"""Generate immutable RTS narration versions without editing legacy recordings."""
import asyncio
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import subprocess
import tempfile

import edge_tts
import edge_tts.communicate

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'content' / 'speaking-audio'
MANIFEST = DEST / 'rts-manifest.json'
VOICE = 'en-AU-NatashaNeural'
digest = lambda value: hashlib.sha256(value).hexdigest()


async def main():
    if os.environ.get('SSL_CERT_FILE'):
        edge_tts.communicate._SSL_CTX.load_verify_locations(os.environ['SSL_CERT_FILE'])
    questions = json.loads(subprocess.check_output(['node', '-e',
        'console.log(JSON.stringify(require("./content/speaking-bank").questions.filter(q=>q.type==="rts"&&q.promptAudioKey)))'], cwd=ROOT))
    manifest = json.loads(MANIFEST.read_text())
    limit = asyncio.Semaphore(3)

    async def generate(q):
        async with limit:
            key = q['promptAudioKey']
            target = DEST / (key + '.mp3')
            text_hash = digest(q['text'].encode())
            old = manifest.get(key)
            if old or target.exists():
                if not (old and target.exists() and old['textSha256'] == text_hash
                        and old['audioSha256'] == digest(target.read_bytes())):
                    raise ValueError('Existing RTS narration differs; create a new prompt version: ' + key)
                print(key, 'verified', flush=True)
                return
            with tempfile.TemporaryDirectory(prefix='rts-prompt-') as temporary:
                part, result = Path(temporary) / 'voice.mp3', Path(temporary) / 'result.mp3'
                await asyncio.wait_for(edge_tts.Communicate(q['text'], VOICE, rate='-3%').save(str(part)), 55)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(part), '-ac', '1', '-ar', '24000', '-b:a', '48k', str(result)], check=True)
                seconds = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(result)]))
                if not 5 <= seconds <= 35:
                    raise ValueError(f'{key}: invalid narration duration {seconds}')
                subprocess.run(['ffmpeg', '-v', 'error', '-i', str(result), '-f', 'null', '-'], check=True)
                data = result.read_bytes()
            target.write_bytes(data)
            manifest[key] = {'questionId': q['id'], 'promptVersion': q['promptVersion'],
                'textSha256': text_hash, 'audioSha256': digest(data), 'bytes': len(data),
                'seconds': round(seconds, 3), 'voices': [VOICE], 'generator': 'edge-tts ' + version('edge-tts')}
            MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
            print(key, round(seconds, 2), 'seconds', flush=True)

    await asyncio.gather(*(generate(q) for q in questions))


if __name__ == '__main__':
    asyncio.run(main())
