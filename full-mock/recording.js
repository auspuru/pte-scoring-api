'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const run = require('node:util').promisify(require('node:child_process').execFile);
const { hash } = require('./store');
const VERSION = 'full-mock-recording-2026-10-29.1';
function wav(pcm) {
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40); return Buffer.concat([header, pcm]);
}
async function convert(segments, maximumSeconds) {
  const extensions = { 'audio/webm':'webm', 'audio/mp4':'mp4', 'audio/ogg':'ogg', 'audio/wav':'wav', 'audio/mpeg':'mp3' };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-recording-'));
  try {
    const pieces = [];
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]; if (!extensions[segment.mime]) throw Error('Unsupported saved recording.');
      const source = path.join(directory, index + '.' + extensions[segment.mime]), target = path.join(directory, index + '.pcm');
      await fs.writeFile(source, segment.bytes, { mode: 0o600 });
      // Decode each independent codec container. Raw WebM/MP4 concatenation is
      // not a valid reconstruction of recordings interrupted by a refresh.
      await run('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-y',
        '-protocol_whitelist','file,pipe','-format_whitelist','wav,matroska,webm,mov,mp4,m4a,ogg,mp3',
        '-i',source,'-t',String(maximumSeconds + 1),'-vn','-ac','1','-ar','16000','-f','s16le',target], { timeout: 30000, maxBuffer: 65536 });
      pieces.push(await fs.readFile(target));
    }
    const pcm = Buffer.concat(pieces), seconds = pcm.length / 32000;
    if (!pcm.length || seconds > maximumSeconds + 0.5) throw Error('Saved recording duration is invalid.');
    return { bytes: wav(pcm), seconds };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function assemble(uid, id, q, response, { getChunk, decode = convert }) {
  const segments = response.segments.filter(value => !value.cancelled && value.chunkCount !== 0);
  if (!segments.length) return { status: 'missing' };
  if (segments.some(segment => !segment.finished || !segment.chunkCount)) return { status: 'pending' };
  if (segments.some(segment => segment.lateActivation || Object.values(segment.chunks).some(chunk => chunk.late))) return { status: 'needs-review', reason: 'late-recording' };
  const containers = [];
  for (const segment of segments) {
    if (Object.keys(segment.chunks).length !== segment.chunkCount) return { status: 'pending' };
    const pieces = [];
    for (let sequence = 0; sequence < segment.chunkCount; sequence++) {
      const metadata = segment.chunks[sequence]; if (!metadata?.stored) return { status: 'pending' };
      const chunk = await getChunk(uid, id, segment.id, sequence);
      if (!chunk || chunk.mime !== segment.mime || chunk.bytes.length !== metadata.bytes || chunk.sha256 !== metadata.sha256 || hash(chunk.bytes) !== metadata.sha256) return { status: 'needs-review', reason: 'recording-integrity' };
      pieces.push(chunk.bytes);
    }
    containers.push({ mime: segment.mime, bytes: Buffer.concat(pieces) });
  }
  try {
    const value = await decode(containers, q.seconds);
    if (!Buffer.isBuffer(value.bytes) || !Number.isFinite(value.seconds) || value.seconds <= 0 || value.seconds > q.seconds + 0.5) throw Error('Invalid decoded recording');
    // Older segment manifests do not retain the pause between interruptions.
    // Keep the reconstruction, but do not invent a fluency judgment from it.
    return { status: containers.length > 1 ? 'needs-review' : 'ready', ...(containers.length > 1 ? { reason: 'interrupted-recording' } : {}),
      recording: { mime: 'audio/wav', data: value.bytes.toString('base64'), hash: hash(value.bytes), seconds: value.seconds, assemblyVersion: VERSION } };
  } catch { return { status: 'needs-review', reason: 'recording-decode' }; }
}
module.exports = { VERSION, wav, convert, assemble };
