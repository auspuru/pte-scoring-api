'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');\nconst predictions = require('../content/writing-predictions-sep-2026');

const BITRATE_MPEG1_L3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const BITRATE_MPEG2_L3 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
const SAMPLE_RATES = [44100,48000,32000,0];

function id3v2Size(bytes) {
  if (bytes.length < 10 || bytes.toString('ascii',0,3) !== 'ID3') return 0;
  const size = ((bytes[6]&0x7f)<<21)|((bytes[7]&0x7f)<<14)|((bytes[8]&0x7f)<<7)|(bytes[9]&0x7f);
  return 10 + size + ((bytes[5] & 0x10) ? 10 : 0);
}

function frameInfo(bytes, offset) {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset+1] & 0xe0) !== 0xe0) return null;
  const versionBits=(bytes[offset+1]>>3)&3, layerBits=(bytes[offset+1]>>1)&3;
  if (versionBits===1 || layerBits!==1) return null; // Layer III only; reserved MPEG version rejected.
  const bitrateIndex=(bytes[offset+2]>>4)&15, sampleIndex=(bytes[offset+2]>>2)&3, padding=(bytes[offset+2]>>1)&1;
  if (!bitrateIndex || bitrateIndex===15 || sampleIndex===3) return null;
  const mpeg1=versionBits===3, divisor=versionBits===2?2:versionBits===0?4:1;
  const bitrate=(mpeg1?BITRATE_MPEG1_L3:BITRATE_MPEG2_L3)[bitrateIndex]*1000;
  const sampleRate=SAMPLE_RATES[sampleIndex]/divisor;
  const length=Math.floor((mpeg1?144:72)*bitrate/sampleRate)+padding;
  if (!Number.isFinite(length) || length < 24 || offset + length > bytes.length) return null;
  return { length, sampleRate, bitrate, mpeg1 };
}

function inspectMp3(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1000) return { valid:false, reason:'file too small', frames:0 };
  let offset=id3v2Size(bytes);
  while (offset + 4 <= bytes.length && !frameInfo(bytes,offset)) offset++;
  const first=offset, frames=[];
  while (offset + 4 <= bytes.length) {
    const info=frameInfo(bytes,offset);
    if (!info) break;
    frames.push(info); offset+=info.length;
  }
  const trailing=bytes.length-offset;
  const id3v1=trailing===128 && bytes.toString('ascii',offset,offset+3)==='TAG';
  const consumed=offset-first;
  const payload=Math.max(1,bytes.length-first-(id3v1?128:0));
  const valid=frames.length>=20 && consumed/payload>=0.98 && (trailing===0 || id3v1);
  return { valid, reason:valid?'':('frames='+frames.length+', consumed='+Math.round(consumed/payload*100)+'%, trailing='+trailing), frames:frames.length };
}

function validateWritingAudio(root = path.join(__dirname, '..')) {
  const bank = JSON.parse(fs.readFileSync(path.join(root, 'content', 'writing-lab.json'), 'utf8'));
  const directory = path.join(root, 'content', 'writing-audio');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const questions = [...bank.spoken, ...(bank.dictation || []), ...bank.mocks.flatMap(m => m.questions), ...predictions.sst, ...predictions.wfd].filter(q => ['sst', 'wfd'].includes(q.type));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const ids = new Set();
  for (const q of questions) {
    if (ids.has(q.id)) continue;
    ids.add(q.id);
    const entry = manifest[q.id];
    if (!entry || entry.textSha256 !== hash(q.text)) throw Error('Missing or outdated recording: ' + q.id);
    if (entry.validationStatus !== 'validated' || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.validatedAt || ''))) {
      throw Error('Recording validation metadata missing: ' + q.id);
    }
    const bytes = fs.readFileSync(path.join(directory, q.id + '.mp3'));
    if (bytes.length < 1000 || bytes.length !== entry.bytes || hash(bytes) !== entry.audioSha256) throw Error('Invalid recording: ' + q.id);
    const inspected = inspectMp3(bytes);
    if (!inspected.valid) throw Error('Corrupt or truncated MP3: ' + q.id + ' (' + inspected.reason + ')');
    const [min, max] = q.type === 'sst' ? (q.predictionSource ? [30, 90] : [60, 90]) : [3, 8];
    if (!Number.isFinite(entry.seconds) || entry.seconds < min || entry.seconds > max) throw Error('Invalid recording duration: ' + q.id);
  }
  return ids.size;
}

if (require.main === module) console.log('Validated ' + validateWritingAudio() + ' bundled narration recordings with transcript hashes, durations and MP3 frame integrity.');
module.exports = { validateWritingAudio, inspectMp3 };
