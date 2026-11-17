# Tutorial video pipeline

Real footage of the running app, recorded with Playwright + CDP screencast, edited with ffmpeg.

```bash
npx vite build && npx vite preview --port 4173 &      # serve the production build
export TF2_DIR="/path/to/Team Fortress 2/tf"            # your own TF2 install
node video/scripts/record.mjs landscape                 # 1920x1080 desktop session
node video/scripts/record.mjs portrait                  # 1080x1920 phone layout session
node video/scripts/build.mjs landscape                  # -> video/out/sfmc-studio-tutorial-youtube-1920x1080.mp4
node video/scripts/build.mjs portrait                   # -> video/out/sfmc-studio-tutorial-vertical-1080x1920.mp4
```

- Captions, intro and outro cards are rendered with the site's own fonts (Archivo, JetBrains Mono).
- Music is synthesised from scratch by `music.mjs` (original, no third-party audio).
- No narration: add a voice track by mixing a WAV into `build.mjs` (for example a Piper voice whose licence you have checked).
- Output: H.264 High, yuv420p BT.709, 30 fps, AAC 192 kbps, faststart.
