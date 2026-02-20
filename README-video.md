# Audio to Subtitle Video Pipeline

Automatically transcribe an audio file and generate a styled MP4 video with animated subtitles — TikTok/Reels style. Runs entirely on GitHub Actions with **zero API costs**.

---

## What It Does

```
Audio file (mp3/wav/m4a/ogg)
        ↓
faster-whisper (local, no API)
        ↓
words.json (word-level timestamps)
        ↓
generate-video.js (SVG → PNG frames via sharp + FFmpeg)
        ↓
output.mp4 (1080×1920, h264, animated subtitles)
```

---

## Prerequisites

- A GitHub repository with **Actions enabled** (free tier is sufficient)
- An audio file committed to `audio/input.mp3` **or** a public URL to download from

No local tools are required — everything runs in the cloud.

---

## Triggering via `workflow_dispatch`

1. Go to your repository on GitHub
2. Click **Actions** → **Generate Subtitle Video**
3. Click **Run workflow**
4. Fill in the inputs:

| Input | Description | Default |
|---|---|---|
| `audio_url` | Public URL to audio file (mp3/wav/m4a). Leave blank to use `audio/input.mp3` from the repo | _(blank)_ |
| `subtitle_mode` | Animation style: `chunk`, `word`, or `karaoke` | `chunk` |
| `whisper_model` | Whisper model size | `small` |

5. Click **Run workflow** → wait ~1–2 minutes
6. Download `output.mp4` from the **Artifacts** section of the completed run

---

## Providing Audio

### Option A: Commit audio to the repo
```bash
mkdir -p audio
cp your-audio.mp3 audio/input.mp3
git add audio/input.mp3
git commit -m "Add input audio"
git push
```

### Option B: Provide a public URL
Enter a direct download URL (Dropbox, S3, GitHub release asset, etc.) in the `audio_url` input.

Example:
```
https://example.com/my-audio.mp3
```

---

## Subtitle Modes

### `chunk` (default — most viral TikTok style)
Groups words into chunks of 2–4 words based on natural pauses. Shows the entire chunk at once, then switches to the next.

```
"and this"  →  "is CRAZY"  →  "right now"
```

### `word`
One word at a time, centered on screen. Each word pops in and replaces the previous.

```
"and"  →  "this"  →  "is"  →  "CRAZY"
```

### `karaoke`
Shows the full chunk, but highlights the currently spoken word in gold (`#FFD700`). Unspoken words appear in white.

```
[and] this is crazy   ← "and" is gold, rest is white
and [this] is crazy   ← "this" is highlighted
```

---

## Style Configuration (`references/video-style.json`)

```json
{
  "background": {
    "color": "#000000"       ← background color
  },
  "text": {
    "fontFamily": "Arial, sans-serif",
    "fontWeight": "bold",
    "fontSize": 90,          ← font size in pixels
    "color": "#FFFFFF",      ← text color
    "strokeColor": "#000000", ← outline color
    "strokeWidth": 12,       ← outline thickness
    "lineHeight": 1.3,       ← line spacing multiplier
    "maxWordsPerLine": 2,    ← max words before wrapping
    "maxChunkSize": 4,       ← max words per subtitle chunk
    "positionY": 0.5         ← vertical position (0=top, 1=bottom, 0.5=center)
  },
  "highlight": {
    "color": "#FFD700"       ← karaoke highlight color
  },
  "animation": {
    "mode": "chunk",         ← default subtitle mode
    "pauseThreshold": 0.3    ← seconds gap to split chunks
  },
  "video": {
    "width": 1080,
    "height": 1920,          ← 9:16 vertical format
    "fps": 30,
    "codec": "libx264",
    "preset": "fast",
    "crf": 23                ← quality (lower = better, larger file)
  }
}
```

---

## Expected Output

For a 60-second audio clip with `chunk` mode:
- **~25–40 subtitle chunks**
- Perfectly synced to spoken audio
- Black background, bold white text with black outline
- 1080×1920 vertical MP4
- ~5–15 MB file size

---

## Cost Breakdown

| Component | Cost |
|---|---|
| GitHub Actions minutes | **Free** (2000 min/month on free tier) |
| faster-whisper | **Free** (runs locally on runner) |
| FFmpeg | **Free** (installed via apt-get in workflow) |
| sharp | **Free** (open source npm package) |
| **Total** | **$0.00** |

---

## Telegram Bot Integration

You can also use the Telegram bot workflow to automatically process audio messages sent to your bot.

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and get your token
2. Get your chat ID from [@userinfobot](https://t.me/userinfobot)
3. Add secrets to your repo (`Settings → Secrets and variables → Actions`):

| Secret | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Your bot token (e.g. `123456:ABC-DEF...`) |
| `TELEGRAM_ALLOWED_CHAT_ID` | Your chat ID (optional, but recommended for security) |

### How It Works

1. Workflow runs every 5 minutes via cron
2. Polls your bot for new audio/voice messages
3. Downloads the audio, transcribes it, generates the video
4. Sends the MP4 back to you in Telegram
5. Updates the offset so messages are never processed twice

### Usage

Send any audio or voice message to your bot → receive the subtitle video within ~5 minutes.

---

## Troubleshooting

### "No audio file found"
Make sure `audio/input.mp3` exists in the repo, or provide an `audio_url`.

### "ffmpeg: command not found"
FFmpeg is automatically installed by the workflow. If running locally, install FFmpeg: `apt-get install ffmpeg` (or `brew install ffmpeg` on macOS).

### "sharp is not installed"
Run `npm install sharp` before running `generate-video.js`.

### "faster-whisper is not installed"
Run `pip install faster-whisper` before running `transcribe.py`.

### Whisper model download is slow
The model is cached in `~/.cache/huggingface` between runs. First run downloads it; subsequent runs skip the download entirely.

### Video has no audio
Check that your audio file is a valid mp3/wav/m4a/ogg. The pipeline copies audio as-is (`-c:a aac`).

### Words are not synced
Try a larger Whisper model (`medium`) for better accuracy on noisy audio.

---

## Local Development

```bash
# Install dependencies
pip install faster-whisper
npm install sharp

# Transcribe
python3 scripts/transcribe.py --audio audio/input.mp3 --output words.json --model small

# Generate video
node scripts/generate-video.js \
  --words words.json \
  --audio audio/input.mp3 \
  --output output.mp4 \
  --mode chunk
```
