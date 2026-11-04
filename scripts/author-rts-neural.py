"""Verify immutable RTS media or author one review candidate; never publish it.

No provider calls occur unless --generate QUESTION_ID is explicitly supplied.
Existing delivery files, masters and manifests are never overwritten.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'content/speaking-audio/rts-neural-manifest.json'
digest = lambda data: hashlib.sha256(data).hexdigest()

def run(args):
    return subprocess.check_output(args, stderr=subprocess.STDOUT)

def measure(file):
    result = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(file), '-af',
        'loudnorm=I=-18:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'],
        capture_output=True, text=True, check=True)
    return json.JSONDecoder().raw_decode(result.stderr[result.stderr.rfind('{'):])[0]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument('--verify', action='store_true')
    actions.add_argument('--generate', metavar='QUESTION_ID')
    parser.add_argument('--speed', type=float)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/rts-neural-candidates')
    args = parser.parse_args()
    questions = {q['id']:q for q in json.loads((ROOT / 'content/rts-original-practice.json').read_text())}
    manifest = json.loads(MANIFEST.read_text())
    if args.verify:
        assert {entry['questionId'] for entry in manifest.values()} == set(questions)
        for key, entry in manifest.items():
            q = questions[entry['questionId']]
            assert digest(q['text'].encode()) == entry['textSha256'], key
            target = ROOT / 'content/speaking-audio' / (key + '.mp3')
            data = target.read_bytes()
            assert digest(data) == entry['audioSha256'] and len(data) == entry['bytes'], key
            master = entry['losslessMaster']
            assert digest((ROOT / master['path']).read_bytes()) == master['sha256'], key
            run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'null', '-'])
        print('Verified', len(manifest), 'RTS delivery files, source text and lossless masters. Listening status remains separate.')
        return
    if args.generate not in questions:
        parser.error('Choose an existing original RTS question ID.')
    q = questions[args.generate]
    keys = [key for key,entry in manifest.items() if entry['questionId'] == q['id']]
    active = max(keys, key=lambda key:tuple(map(int,re.search(r'-prompt-(\d+)-(\d+)$',key).groups())))
    settings = manifest[active]['generation']
    speed = args.speed if args.speed is not None else settings['speed']
    if not 0.75 <= speed <= 1.05:
        parser.error('Candidate speed must be between 0.75 and 1.05.')
    payload = {k:settings[k] for k in ['model', 'voice', 'instructions']}
    payload.update(input=q['text'], speed=speed, response_format='pcm')
    output_policy = 'constant-gain-mono-24khz-mp3-160k-v2'
    binding = digest(json.dumps({'generation':payload, 'outputPolicy':output_policy}, sort_keys=True).encode())
    directory = args.output.resolve()
    # Candidate output cannot collide with the deployed media directory.
    if directory.is_relative_to((ROOT / 'content').resolve()):
        parser.error('Write review candidates outside content/.')
    directory.mkdir(parents=True, exist_ok=True)
    stem = directory / (q['id'] + '-candidate-' + binding[:12])
    receipt = stem.with_suffix('.json')
    wav, mp3 = stem.with_suffix('.wav'), stem.with_suffix('.mp3')
    if receipt.exists():
        saved = json.loads(receipt.read_text())
        assert saved['inputHash'] == binding and saved['masterSha256'] == digest(wav.read_bytes())
        if mp3.exists():
            if not saved.get('audioSha256'):
                raise RuntimeError('Unreceipted encoded candidate exists; review it before retrying.')
            assert saved['audioSha256'] == digest(mp3.read_bytes())
    elif wav.exists() or mp3.exists():
        raise RuntimeError('Unreceipted candidate exists; review it before retrying.')
    else:
        key = os.environ.get('OPENAI_API_KEY')
        if not key:
            raise RuntimeError('OPENAI_API_KEY is not configured.')
        request = urllib.request.Request('https://api.openai.com/v1/audio/speech',
            data=json.dumps(payload).encode(), headers={'Authorization':'Bearer ' + key, 'Content-Type':'application/json'})
        with urllib.request.urlopen(request, timeout=180) as response:
            pcm, request_id = response.read(), response.headers.get('x-request-id')
        with wave.open(str(wav), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000); output.writeframes(pcm)
        saved = {'questionId':q['id'], 'inputHash':binding, 'outputPolicy':output_policy, 'textSha256':digest(q['text'].encode()),
            'settings':{k:v for k,v in payload.items() if k != 'input'}, 'requestId':request_id,
            'masterSha256':digest(wav.read_bytes()), 'status':'candidate; transcription and full listening pending'}
        receipt.write_text(json.dumps(saved, indent=2) + '\n')
    if not mp3.exists():
        m = measure(wav)
        gain = min(-18 - float(m['input_i']), -2 - float(m['input_tp']))
        run(['ffmpeg', '-v', 'error', '-i', str(wav), '-af', f'volume={gain:.6f}dB',
            '-codec:a', 'libmp3lame', '-b:a', '160k', str(mp3)])
        saved['processing'] = {'kind':'constant-gain-only', 'constantGainDb':gain,
            'tempoProcessing':'none', 'dynamicLoudnessProcessing':'none', 'limiting':'none'}
    run(['ffmpeg', '-v', 'error', '-i', str(mp3), '-f', 'null', '-'])
    m = measure(mp3)
    seconds = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(mp3)]))
    assert 5 <= seconds <= 35 and float(m['input_tp']) <= -1.5
    saved.update(audioSha256=digest(mp3.read_bytes()), bytes=mp3.stat().st_size, seconds=seconds,
        loudnessLUFS=float(m['input_i']), truePeakDbTP=float(m['input_tp']))
    receipt.write_text(json.dumps(saved, indent=2) + '\n')
    print('Candidate only:', mp3)

if __name__ == '__main__':
    main()
