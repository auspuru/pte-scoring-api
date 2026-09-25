#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.edge-tts')
site_packages = next((root / 'lib').glob('python*/site-packages'))
communicate = site_packages / 'edge_tts' / 'communicate.py'
text = communicate.read_text(encoding='utf-8')

low = 'audio-24khz-48kbitrate-mono-mp3'
high = 'audio-48khz-192kbitrate-mono-mp3'
if low not in text and high not in text:
    raise SystemExit('Could not locate Edge TTS output format setting.')
text = text.replace(low, high)

# Long-text boundary compensation is based on CBR byte rate.
text = text.replace('MP3_BITRATE_BPS = 48_000', 'MP3_BITRATE_BPS = 192_000')
text = text.replace('// 48_000', '// 192_000')
communicate.write_text(text, encoding='utf-8')
print('Patched Edge TTS for native 48 kHz / 192 kbps mono MP3 output.')
