"""Synthesise narration lines with Kokoro (Apache-2.0) into video/tts/out/<id>.wav.

Usage: python -P video/tts/speak.py
Model files: ~/.cache/kokoro/kokoro-v1.0.onnx and voices-v1.0.bin (kokoro-onnx release model-files-v1.0).
"""
import json
import os

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

here = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(here, "lines.json"), encoding="utf-8"))
model_dir = os.path.expanduser("~/.cache/kokoro")
kokoro = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))
out = os.path.join(here, "out")
os.makedirs(out, exist_ok=True)
durations = {}
for line in cfg["lines"]:
    samples, sr = kokoro.create(line["text"], voice=line.get("voice", cfg["voice"]), speed=line.get("speed", cfg["speed"]), lang="en-us")
    # Trim leading/trailing near-silence so cuts stay tight.
    idx = np.where(np.abs(samples) > 0.01)[0]
    if len(idx):
        samples = samples[max(0, idx[0] - int(0.03 * sr)): idx[-1] + int(0.08 * sr)]
    sf.write(os.path.join(out, f"{line['id']}.wav"), samples, sr)
    durations[line["id"]] = round(len(samples) / sr, 3)
json.dump({"sampleRate": sr, "durations": durations}, open(os.path.join(out, "durations.json"), "w"), indent=1)
print(durations, "total", round(sum(durations.values()), 1))
