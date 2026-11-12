"""Derive immutable normal-paced mock audio from retained recordings; no TTS calls.

Input is a JSON source inventory with key/type/words/textSha256/file/entry.
Existing source files are never overwritten. The output manifest records every
source hash and exact processing parameters so each derivation is reproducible.
"""
import argparse,hashlib,json,pathlib,re,subprocess,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
sha=lambda data:hashlib.sha256(data).hexdigest()
def seconds(file):
 return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(file)]))
def prepare(row):
 source=ROOT/row['file'];data=source.read_bytes()
 if sha(data)!=row['entry']['audioSha256']:raise ValueError('Source hash mismatch: '+row['file'])
 if row['entry']['textSha256']!=row['textSha256']:raise ValueError('Transcript hash mismatch: '+row['file'])
 duration=seconds(source)
 probe=subprocess.run(['ffmpeg','-nostats','-hide_banner','-i',str(source),'-af','silencedetect=noise=-45dB:d=0.25','-f','null','-'],capture_output=True,text=True,check=True)
 pauses=[(float(end)-float(length),float(end)) for end,length in re.findall(r'silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)',probe.stderr)]
 removals=[]
 for start,end in pauses:
  if start<.02 and end>.3:removals.append((0,max(0,end-.15)))
  elif end>duration-.02 and end-start>.4:removals.append((start+.2,duration))
  elif end-start>1.5:removals.append((start+.4,end-.4))
 # Leave recordings already at a normal pace alone unless a long gap needs
 # repair. Do not re-encode a good recording just to trim a short lead-in.
 long_gap=any(end-start>1.5 if start>.02 and end<duration-.02 else end-start>.8 for start,end in pauses)
 if row['words']/duration*60>=145 and not long_gap:removals=[]
 segments=[];cursor=0
 for start,end in removals:
  if start>cursor:segments.append((cursor,start))
  cursor=max(cursor,end)
 if cursor<duration:segments.append((cursor,duration))
 clean=sum(end-start for start,end in segments)
 wpm=row['words']/clean*60
 target=(170 if row['words']>=9 else 155) if row['type']=='wfd' else 165
 tempo=target/wpm if wpm<145 else 1
 # Compress pauses and accelerate only; never slow or pad a short passage.
 if not removals and tempo==1:
  output=data;measured=duration
 else:
  filters=[]
  for index,(start,end) in enumerate(segments):filters.append(f'[0:a]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS[a{index}]')
  chain=''.join(f'[a{i}]' for i in range(len(segments)))+f'concat=n={len(segments)}:v=0:a=1'
  if tempo!=1:chain+=f',atempo={tempo:.8f}'
  filters.append(chain+',loudnorm=I=-18:TP=-2:LRA=11[out]')
  with tempfile.TemporaryDirectory(prefix='mock-pace-') as directory:
   result=pathlib.Path(directory)/'normal.mp3'
   subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-filter_complex',';'.join(filters),'-map','[out]','-ac','1','-ar','24000','-b:a','128k',str(result)],check=True)
   output=result.read_bytes();measured=seconds(result)
   subprocess.run(['ffmpeg','-v','error','-i',str(result),'-f','null','-'],check=True)
 audio_hash=sha(output)
 if row.get('consumerAudioSha256s') and all(value==audio_hash for value in row['consumerAudioSha256s']):return None
 relative='content/full-mock/assets/'+audio_hash+'.mp3';target_file=ROOT/relative
 if target_file.exists():
  if target_file.read_bytes()!=output:raise ValueError('Immutable audio collision')
 else:target_file.write_bytes(output)
 entry={**row['entry'],'path':relative,'textSha256':row['textSha256'],'audioSha256':audio_hash,'bytes':len(output),'seconds':round(measured,3),
  'pacingVersion':'mock-normal-pace-v1','wordsPerMinuteIncludingPauses':round(row['words']/measured*60,1),
  'publicMockPlayback':any(not c['mock'].startswith('full-mock-') for c in row.get('consumers',[])),
  'derivation':{'sourcePath':row['file'],'sourceAudioSha256':sha(data),'tempo':round(tempo,8),'removedSilenceIntervals':removals,'speechAdded':False},
  'validationStatus':'decoded-and-probed','humanListeningReview':'pending'}
 return entry
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--inventory',required=True,type=pathlib.Path);parser.add_argument('--only-key');args=parser.parse_args()
 rows=json.loads(args.inventory.read_text());manifest_file=ROOT/'content/mock-audio-pace.json'
 manifest=json.loads(manifest_file.read_text()) if args.only_key else {'version':'mock-normal-pace-v1','sourceCommit':'2f5776bf5eca29c9074cd95f4ffae9a548d32ea8','entries':{}}
 if args.only_key:rows=[row for row in rows if row['key']==args.only_key]
 for row in rows:
  entry=prepare(row)
  if entry:manifest['entries'][row['key']]=entry
  else:manifest['entries'].pop(row['key'],None)
 manifest_file.write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps({'sources':len(rows),'assets':len({e['audioSha256'] for e in manifest['entries'].values()}),'derived':sum(e['derivation']['sourceAudioSha256']!=e['audioSha256'] for e in manifest['entries'].values()),'paidCalls':0}))
if __name__=='__main__':main()
