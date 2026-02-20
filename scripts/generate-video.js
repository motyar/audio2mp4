#!/usr/bin/env node
/**
 * generate-video.js
 * Takes words.json + audio file → renders a styled MP4 with animated subtitles.
 *
 * Usage:
 *   node scripts/generate-video.js \
 *     --words words.json \
 *     --audio audio/input.mp3 \
 *     --output output.mp4 \
 *     --style references/video-style.json \
 *     --mode chunk
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    words: null,
    audio: null,
    output: 'output.mp4',
    style: path.join(__dirname, '..', 'references', 'video-style.json'),
    mode: 'chunk',
    lang: null,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--words':  opts.words  = args[++i]; break;
      case '--audio':  opts.audio  = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--style':  opts.style  = args[++i]; break;
      case '--mode':   opts.mode   = args[++i]; break;
      case '--lang':   opts.lang   = args[++i]; break;
    }
  }
  if (!opts.words)  { console.error('ERROR: --words is required'); process.exit(1); }
  if (!opts.audio)  { console.error('ERROR: --audio is required'); process.exit(1); }
  return opts;
}

// ---------------------------------------------------------------------------
// Load words.json — supports both legacy array format and new object format
// ---------------------------------------------------------------------------
function loadWords(wordsPath) {
  const raw = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
  if (Array.isArray(raw)) {
    return { language: 'en', language_probability: 1, words: raw };
  }
  return raw;
}

// ---------------------------------------------------------------------------
// RTL language detection
// ---------------------------------------------------------------------------
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'dv']);
function isRTL(lang) { return lang && RTL_LANGS.has(lang.toLowerCase().split('-')[0]); }

// ---------------------------------------------------------------------------
// Chunk grouping
// ---------------------------------------------------------------------------
function buildChunks(words, style, mode) {
  const pauseThreshold = (style.animation && style.animation.pauseThreshold) || 0.3;
  const maxChunkSize   = (style.text && style.text.maxChunkSize) || 4;

  if (mode === 'word') {
    // one word per chunk
    return words.map(w => ({
      words: [w],
      start: w.start,
      end:   w.end,
    }));
  }

  // chunk and karaoke both group words into multi-word chunks
  const chunks = [];
  let current = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (current.length === 0) {
      current.push(w);
      continue;
    }
    const prev = current[current.length - 1];
    const gap  = w.start - prev.end;
    const isNaturalPause = gap > pauseThreshold;
    const isFull         = current.length >= maxChunkSize;

    if (isNaturalPause || isFull) {
      chunks.push({ words: current, start: current[0].start, end: prev.end });
      current = [w];
    } else {
      current.push(w);
    }
  }
  if (current.length > 0) {
    chunks.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSvg(chunk, style, mode, activeLang) {
  const W  = (style.video && style.video.width)  || 1080;
  const H  = (style.video && style.video.height) || 1920;
  const bg = (style.background && style.background.color) || '#000000';

  const fontFamily  = (style.text && style.text.fontFamily)  || 'Arial, sans-serif';
  const fontWeight  = (style.text && style.text.fontWeight)  || 'bold';
  const fontSize    = (style.text && style.text.fontSize)    || 90;
  const fillColor   = (style.text && style.text.color)       || '#FFFFFF';
  const strokeColor = (style.text && style.text.strokeColor) || '#000000';
  const strokeWidth = (style.text && style.text.strokeWidth) || 12;
  const lineHeight  = (style.text && style.text.lineHeight)  || 1.3;
  const maxPerLine  = (style.text && style.text.maxWordsPerLine) || 2;
  const positionY   = (style.text && style.text.positionY)   || 0.5;

  const hlColor     = (style.highlight && style.highlight.color)       || '#FFD700';
  const hlStroke    = (style.highlight && style.highlight.strokeColor)  || '#000000';

  const rtl         = isRTL(activeLang);
  const direction   = rtl ? 'rtl' : 'ltr';
  const langAttr    = activeLang ? ` lang="${escapeXml(activeLang)}"` : '';

  // Split words into lines
  const wordObjs = chunk.words;
  const lines = [];
  for (let i = 0; i < wordObjs.length; i += maxPerLine) {
    lines.push(wordObjs.slice(i, i + maxPerLine));
  }

  const totalLines   = lines.length;
  const lineHeightPx = fontSize * lineHeight;
  const blockHeight  = totalLines * lineHeightPx;
  const startY       = H * positionY - blockHeight / 2 + fontSize / 2;

  const cx = W / 2;

  // Build text elements
  let textElements = '';

  if (mode === 'karaoke') {
    // Each word is a separate <text> element (tspan spacing is unreliable in SVG renderers)
    // We lay words out on lines; highlight the active word
    const activeStart = chunk.activeStart;
    const activeEnd   = chunk.activeEnd;

    for (let li = 0; li < lines.length; li++) {
      const lineWords = lines[li];
      const y = startY + li * lineHeightPx;

      // Estimate x positions for each word on the line
      // We use a simple approach: center the whole line, approximate word widths
      const approxCharWidth = fontSize * 0.55;
      const lineText = lineWords.map(w => w.word).join(' ');
      const lineWidth = lineText.length * approxCharWidth;
      let xPos = cx - lineWidth / 2;

      for (let wi = 0; wi < lineWords.length; wi++) {
        const wo = lineWords[wi];
        const isActive = (wo.start <= (activeEnd || wo.end)) && (wo.end >= (activeStart || wo.start));
        const wFill   = isActive ? hlColor   : fillColor;
        const wStroke = isActive ? hlStroke  : strokeColor;
        const wText   = escapeXml(wo.word);
        const wWidth  = wo.word.length * approxCharWidth;
        const anchor  = rtl ? 'end' : 'start';

        textElements += `
  <text
    x="${xPos + wWidth / 2}"
    y="${y}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="${escapeXml(fontFamily)}"
    font-weight="${fontWeight}"
    font-size="${fontSize}"
    fill="${wFill}"
    stroke="${wStroke}"
    stroke-width="${strokeWidth}"
    paint-order="stroke fill"
    direction="${direction}"
  >${wText}</text>`;

        xPos += wWidth + approxCharWidth * 0.5;
      }
    }
  } else {
    // chunk or word mode: render full text lines
    for (let li = 0; li < lines.length; li++) {
      const lineWords = lines[li];
      const y = startY + li * lineHeightPx;
      const lineText = escapeXml(lineWords.map(w => w.word).join(' '));

      textElements += `
  <text
    x="${cx}"
    y="${y}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="${escapeXml(fontFamily)}"
    font-weight="${fontWeight}"
    font-size="${fontSize}"
    fill="${fillColor}"
    stroke="${strokeColor}"
    stroke-width="${strokeWidth}"
    paint-order="stroke fill"
    direction="${direction}"
  >${lineText}</text>`;
    }
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"${langAttr}>
  <rect width="${W}" height="${H}" fill="${bg}"/>
  ${textElements}
</svg>`;
}

// ---------------------------------------------------------------------------
// Sharp-based SVG → PNG rendering
// ---------------------------------------------------------------------------
async function renderFrame(svgString) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.error('ERROR: sharp is not installed. Run: npm install sharp');
    process.exit(1);
  }
  return sharp(Buffer.from(svgString)).png().toBuffer();
}

// ---------------------------------------------------------------------------
// FFmpeg helpers
// ---------------------------------------------------------------------------
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    console.log('ffmpeg ' + args.join(' '));
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.stdout.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr}`));
      } else {
        resolve();
      }
    });
    proc.on('error', err => reject(new Error(`Failed to start ffmpeg: ${err.message}`)));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  console.log(`\n=== generate-video.js ===`);
  console.log(`Words:  ${opts.words}`);
  console.log(`Audio:  ${opts.audio}`);
  console.log(`Output: ${opts.output}`);
  console.log(`Mode:   ${opts.mode}`);

  // Load inputs
  const wordsData = loadWords(opts.words);
  const words     = wordsData.words || [];
  const detectedLang = opts.lang || wordsData.language || 'en';

  if (words.length === 0) {
    console.warn('WARNING: No words in words.json — generating silent black video.');
  }

  const styleRaw = fs.existsSync(opts.style)
    ? JSON.parse(fs.readFileSync(opts.style, 'utf8'))
    : {};

  // Build chunks
  const chunks = words.length > 0 ? buildChunks(words, styleRaw, opts.mode) : [];
  console.log(`Built ${chunks.length} subtitle chunks`);

  // For karaoke, expand to one frame per word (within chunk)
  let frames = [];
  if (opts.mode === 'karaoke' && chunks.length > 0) {
    for (const chunk of chunks) {
      for (const wo of chunk.words) {
        frames.push({
          ...chunk,
          activeStart: wo.start,
          activeEnd:   wo.end,
          start: wo.start,
          end:   wo.end,
        });
      }
    }
  } else {
    frames = chunks;
  }

  // Create temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitles-'));
  console.log(`Temp dir: ${tmpDir}`);

  try {
    // Get audio duration via ffprobe; fall back to last word's end time
    let audioDuration = await getAudioDuration(opts.audio);
    if (audioDuration === 0 && words.length > 0) {
      audioDuration = words[words.length - 1].end;
    }
    console.log(`Audio duration: ${audioDuration.toFixed(2)}s`);

    // Generate PNG frames
    const frameFiles = [];
    for (let i = 0; i < frames.length; i++) {
      const frame  = frames[i];
      const svg    = buildSvg(frame, styleRaw, opts.mode, detectedLang);
      const pngBuf = await renderFrame(svg);
      const pngPath = path.join(tmpDir, `frame_${String(i).padStart(4, '0')}.png`);
      fs.writeFileSync(pngPath, pngBuf);
      frameFiles.push({ path: pngPath, start: frame.start, end: frame.end });
      process.stdout.write(`\rRendering frames: ${i + 1}/${frames.length}`);
    }
    console.log('');

    // Also generate a blank (black) frame for gaps and start/end
    const W  = (styleRaw.video && styleRaw.video.width)  || 1080;
    const H  = (styleRaw.video && styleRaw.video.height) || 1920;
    const bg = (styleRaw.background && styleRaw.background.color) || '#000000';
    const blankSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${bg}"/></svg>`;
    const blankPng = await renderFrame(blankSvg);
    const blankPath = path.join(tmpDir, 'frame_blank.png');
    fs.writeFileSync(blankPath, blankPng);

    // Build concat file with proper timing including gaps
    const concatPath = path.join(tmpDir, 'input.txt');
    const lines = buildConcatFile(frameFiles, blankPath, audioDuration);
    fs.writeFileSync(concatPath, lines);
    console.log(`Wrote concat file: ${concatPath}`);

    // Ensure output directory exists
    const outputDir = path.dirname(path.resolve(opts.output));
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Run FFmpeg
    const fps = (styleRaw.video && styleRaw.video.fps)    || 30;
    const codec   = (styleRaw.video && styleRaw.video.codec)  || 'libx264';
    const preset  = (styleRaw.video && styleRaw.video.preset) || 'fast';
    const crf     = (styleRaw.video && styleRaw.video.crf)    || 23;

    await runFFmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-i', opts.audio,
      '-c:v', codec,
      '-preset', preset,
      '-crf', String(crf),
      '-r', String(fps),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      opts.output,
    ]);

    console.log(`\n✅ Video written to: ${opts.output}`);
    const stat = fs.statSync(opts.output);
    console.log(`   File size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

  } finally {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Build the FFmpeg concat demuxer file, inserting blank frames for gaps
// ---------------------------------------------------------------------------
function buildConcatFile(frameFiles, blankPath, audioDuration) {
  const lines = [];
  let cursor = 0;

  for (const f of frameFiles) {
    const gapBefore = f.start - cursor;
    if (gapBefore > 0.01) {
      lines.push(`file '${blankPath}'`);
      lines.push(`duration ${gapBefore.toFixed(4)}`);
    }
    const duration = Math.max(f.end - f.start, 0.033); // at least 1 frame
    lines.push(`file '${f.path}'`);
    lines.push(`duration ${duration.toFixed(4)}`);
    cursor = f.end;
  }

  // Fill to end of audio
  if (cursor < audioDuration - 0.01) {
    lines.push(`file '${blankPath}'`);
    lines.push(`duration ${(audioDuration - cursor).toFixed(4)}`);
  }

  // concat demuxer requires a trailing entry (duplicate last file, no duration)
  // Find the last 'file ...' line (every even-indexed entry is a file line)
  const lastFileLine = lines.filter(l => l.startsWith('file ')).pop();
  if (lastFileLine) {
    lines.push(lastFileLine);
  } else {
    lines.push(`file '${blankPath}'`);
    lines.push(`duration ${audioDuration.toFixed(4)}`);
    lines.push(`file '${blankPath}'`);
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Get audio duration via ffprobe
// ---------------------------------------------------------------------------
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        // fallback: return 0 on error (caller will use last word's end time if needed)
        resolve(0);
        return;
      }
      const dur = parseFloat(out.trim());
      resolve(isNaN(dur) ? 0 : dur);
    });
    proc.on('error', () => resolve(0));
  });
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
