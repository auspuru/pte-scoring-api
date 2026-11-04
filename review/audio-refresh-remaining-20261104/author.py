"""Verify the bundle or explicitly author one resumable review candidate.

Examples:
  python author.py --verify
  python author.py --generate sgd/sgd-2 --output /workspace/pte-scoring-api/work/new-review
No provider call occurs unless --generate is supplied. This never publishes media.
"""
import argparse, hashlib, json, os, subprocess, sys, urllib.request, urllib.error, uuid, wave
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sha=lambda data:hashlib.sha256(data).hexdigest()
def run(args):return subprocess.check_output(args,stderr=subprocess.STDOUT)
def save(path,data):
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp');temporary.write_text(json.dumps(data,indent=2)+'\n');temporary.replace(path)
def render(text,settings,cache):
    payload={**settings,'input':text,'response_format':'pcm'}
    binding=sha(json.dumps(payload,sort_keys=True).encode());wav=cache/(binding+'.wav');receipt=cache/(binding+'.json');pending=cache/(binding+'.request-started.json')
    if receipt.exists():
        saved=json.loads(receipt.read_text());assert saved['inputHash']==binding and saved['masterSha256']==sha(wav.read_bytes());return wav,saved
    if wav.exists() or pending.exists():raise RuntimeError('Unreceipted or uncertain prior request requires review before retrying: '+binding)
    key=os.environ.get('OPENAI_API_KEY')
    if not key:raise RuntimeError('OPENAI_API_KEY is not configured.')
    with pending.open('x') as f:json.dump({'inputHash':binding,'textSha256':sha(text.encode()),'status':'Request started; do not duplicate an uncertain call.'},f)
    request=urllib.request.Request('https://api.openai.com/v1/audio/speech',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=240) as r:pcm,rid=r.read(),r.headers.get('x-request-id')
    except urllib.error.HTTPError as e:raise RuntimeError('Speech API HTTP '+str(e.code)) from None
    with wave.open(str(wav),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(pcm)
    saved={'inputHash':binding,'textSha256':sha(text.encode()),'settings':settings,'requestId':rid,'masterSha256':sha(wav.read_bytes())}
    save(receipt,saved);pending.unlink();return wav,saved
def measure(file):
    p=subprocess.run(['ffmpeg','-hide_banner','-i',str(file),'-af','loudnorm=I=-18:TP=-2:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    return json.JSONDecoder().raw_decode(p.stderr[p.stderr.rfind('{'):])[0]
def main():
    parser=argparse.ArgumentParser(description=__doc__);action=parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--verify',action='store_true');action.add_argument('--generate',metavar='KIND/QUESTION_ID');parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if args.verify:
        sys.dont_write_bytecode=True
        from verify import verify
        verify();return
    if args.output is None:parser.error('--generate requires an explicit --output directory.')
    root=args.output.resolve();repository=ROOT.parents[1]
    if root.is_relative_to(ROOT) or root.is_relative_to(repository/'content') or root.is_relative_to(repository/'public'):
        parser.error('Write new candidates outside the review bundle and deployed content/public directories.')
    manifest=json.loads((ROOT/'manifest.json').read_text());entry=next((q for q in manifest['clips'] if q['directory']==args.generate),None)
    if entry is None:parser.error('Choose one of the 55 KIND/QUESTION_ID entries in manifest.json.')
    source=json.loads((ROOT/entry['directory']/'source.json').read_text());kind=entry['kind']
    texts=[source['narration']]+[t for _,t in source['turns']] if kind=='sgd' else [source['audioText'] if kind=='hiw' else source['text']]
    profiles=[g['settings'] for g in entry['generationReceipts']];assert len(profiles)==len(texts)
    binding=sha(json.dumps({'texts':texts,'profiles':profiles,'policy':'gain-only-native-24k-mp3-160k-v1'},sort_keys=True).encode())
    directory=root/(entry['questionId']+'-'+binding[:12]);cache=root/'segments';directory.mkdir(parents=True,exist_ok=True);cache.mkdir(exist_ok=True)
    target=directory/'candidate.mp3';master=directory/'native-master.flac';receipt=directory/'receipt.json'
    if receipt.exists():
        saved=json.loads(receipt.read_text());assert saved['inputHash']==binding and saved['audioSha256']==sha(target.read_bytes()) and saved['masterSha256']==sha(master.read_bytes())
        print('Verified cached candidate:',target);return
    if target.exists() or master.exists():raise RuntimeError('Unreceipted output exists; review it before retrying.')
    parts=[];receipts=[]
    for text,profile in zip(texts,profiles):
        file,generated=render(text,profile,cache);parts.append(file);receipts.append(generated)
    combined=directory/'assembled-native.wav'
    with wave.open(str(combined),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000)
        for i,file in enumerate(parts):
            with wave.open(str(file),'rb') as wav:f.writeframes(wav.readframes(wav.getnframes()))
            if kind=='sgd' and i<len(parts)-1:f.writeframes(b'\0'*(int(24000*(.6 if i==0 else .25))*2))
    m=measure(combined);gain=min(-18-float(m['input_i']),-2-float(m['input_tp']))
    run(['ffmpeg','-v','error','-i',str(combined),'-c:a','flac',str(master)])
    run(['ffmpeg','-v','error','-i',str(combined),'-af',f'volume={gain:.6f}dB','-codec:a','libmp3lame','-b:a','160k',str(target)])
    run(['ffmpeg','-v','error','-i',str(target),'-f','null','-']);measured=measure(target)
    assert float(measured['input_tp'])<=-1.5
    saved={'questionId':entry['questionId'],'kind':kind,'inputHash':binding,'sourceTextSha256':entry['sourceTextSha256'],'audioSha256':sha(target.read_bytes()),'masterSha256':sha(master.read_bytes()),'generationReceipts':receipts,'processing':{'kind':'constant-gain-only','constantGainDb':gain,'tempoProcessing':'none','limiting':'none'},'loudnessLUFS':float(measured['input_i']),'truePeakDbTP':float(measured['input_tp']),'status':'candidate only; independent transcription and full listening review pending'}
    save(receipt,saved);combined.unlink();print('New candidate only:',target)
if __name__=='__main__':main()
