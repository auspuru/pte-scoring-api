"""Verify review media, source/answer identities and lossless SGD assembly offline."""
import hashlib, io, json, re, subprocess, wave
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sha=lambda data:hashlib.sha256(data).hexdigest()
def run(args):return subprocess.check_output(args,stderr=subprocess.STDOUT)
def verify():
    manifest=json.loads((ROOT/'manifest.json').read_text())
    sources={(q['kind'],q['id']):q for q in json.loads((ROOT/'sources.json').read_text())}
    assert len(manifest['clips'])==55 and len(sources)==55
    counts={}
    for entry in manifest['clips']:
        counts[entry['kind']]=counts.get(entry['kind'],0)+1
        q=sources[(entry['kind'],entry['questionId'])];directory=ROOT/entry['directory']
        assert json.loads((directory/'source.json').read_text())==q
        assert json.loads((directory/'receipt.json').read_text())=={k:v for k,v in entry.items() if k!='directory'}
        source=q['audioText'] if entry['kind']=='hiw' else q['text']
        assert sha(source.encode())==entry['sourceTextSha256']
        spoken=(directory/'spoken-text.txt').read_text().rstrip('\n');assert sha(spoken.encode())==entry['spokenTextSha256']
        audio=directory/entry['audioFile'];master=directory/entry['masterFile']
        assert audio.stat().st_size==entry['bytes'] and sha(audio.read_bytes())==entry['audioSha256']
        assert sha(master.read_bytes())==entry['masterSha256']
        run(['ffmpeg','-v','error','-i',str(audio),'-f','null','-'])
        duration=float(run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(audio)]));assert abs(duration-entry['seconds'])<.002
        assert entry['truePeakDbTP']<=-1.5 and entry['transcription']['audioSha256']==entry['audioSha256']
        if entry['kind']=='hiw':
            a,b=q['audioText'].split(),q['passage'].split();assert len(a)==len(b)
            clean=lambda t:re.sub(r'^\W+|\W+$','',t.lower())
            assert sorted(q['answers'])==[i for i,(x,y) in enumerate(zip(a,b)) if clean(x)!=clean(y)]
        if entry['kind']=='sgd':
            proof=entry['assemblyVerification'];assert proof['status']=='passed'
            pcm=run(['ffmpeg','-v','error','-i',str(master),'-f','s16le','-acodec','pcm_s16le','pipe:1']);assert sha(pcm)==proof['pcmSha256']
            texts=[q['narration']]+[text for _,text in q['turns']]
            assert len(proof['segments'])==len(texts)==len(entry['generationReceipts'])
            for segment,text,receipt in zip(proof['segments'],texts,entry['generationReceipts']):
                data=pcm[segment['startSample']*2:segment['endSample']*2]
                assert sha(data)==segment['pcmSha256'] and sha(text.encode())==segment['textSha256']==receipt['textSha256']
                buffer=io.BytesIO()
                with wave.open(buffer,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(data)
                assert sha(buffer.getvalue())==segment['nativeWavSha256']==receipt['masterSha256']
            assert entry['turnSpeakers']==[label for label,_ in q['turns']]
            assert len(set(entry['speakerVoices'].values()))==3 and entry['narrationIncluded']
    assert counts=={'sgd':15,'hiw':20,'sst':17,'wfd':3}
    print('Verified 55 review recordings, exact source bindings, 20 HIW answer maps and all 15 SGD lossless turn assemblies. Listening status remains separate.')
if __name__=='__main__':verify()
