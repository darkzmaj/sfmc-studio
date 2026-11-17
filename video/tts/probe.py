import sys, soundfile as sf
from kokoro_onnx import Kokoro
import os
d = os.path.expanduser('~/.cache/kokoro')
k = Kokoro(os.path.join(d, 'kokoro-v1.0.onnx'), os.path.join(d, 'voices-v1.0.bin'))
print(sorted(k.get_voices())[:60])
for v in ['am_michael', 'am_puck', 'af_heart', 'am_fenrir']:
    s, sr = k.create("Wanna see your TF2 character before you spend a single cent? Watch this.", voice=v, speed=1.12, lang='en-us')
    sf.write(f'video/tts/probe_{v}.wav', s, sr)
print('ok', sr)
