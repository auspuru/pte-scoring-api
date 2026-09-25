#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.edge-tts')
site_packages = next((root / 'lib').glob('python*/site-packages'))
communicate = site_packages / 'edge_tts' / 'communicate.py'
constants = site_packages / 'edge_tts' / 'constants.py'
text = communicate.read_text(encoding='utf-8')

low = 'audio-24khz-48kbitrate-mono-mp3'
high = 'audio-48khz-192kbitrate-mono-mp3'
if low not in text and high not in text:
    raise SystemExit('Could not locate Edge TTS output format setting.')
text = text.replace(low, high)

communicate.write_text(text, encoding='utf-8')

# Long-text boundary compensation is imported from constants.py.
constants_text = constants.read_text(encoding='utf-8')
if 'MP3_BITRATE_BPS = 48_000' not in constants_text and 'MP3_BITRATE_BPS = 192_000' not in constants_text:
    raise SystemExit('Could not locate Edge TTS bitrate compensation constant.')
constants_text = constants_text.replace(low, high)
constants_text = constants_text.replace('MP3_BITRATE_BPS = 48_000', 'MP3_BITRATE_BPS = 192_000')
constants.write_text(constants_text, encoding='utf-8')
print('Patched Edge TTS for native 48 kHz / 192 kbps mono MP3 output and timing compensation.')
