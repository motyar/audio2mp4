#!/usr/bin/env node
/**
 * telegram-poll.js
 * Polls Telegram bot for the latest unprocessed audio/voice message,
 * downloads the audio file, and saves metadata.
 *
 * Exit codes:
 *   0 — audio found and downloaded
 *   2 — no new audio messages
 *   1 — error
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    token:  process.env.TELEGRAM_BOT_TOKEN || '',
    output: 'audio/input',
    meta:   'telegram-meta.json',
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token':  opts.token  = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--meta':   opts.meta   = args[++i]; break;
    }
  }
  if (!opts.token) {
    console.error('ERROR: Telegram bot token is required (--token or TELEGRAM_BOT_TOKEN env var)');
    process.exit(1);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Simple HTTP/HTTPS GET helper that returns body as Buffer
// ---------------------------------------------------------------------------
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    lib.get(urlStr, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGet(res.headers.location));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Telegram API call
// ---------------------------------------------------------------------------
async function telegramApi(token, method, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.telegram.org/bot${token}/${method}${qs ? '?' + qs : ''}`;
  const body = await httpGet(url);
  const json = JSON.parse(body.toString('utf8'));
  if (!json.ok) {
    throw new Error(`Telegram API error [${method}]: ${json.description}`);
  }
  return json.result;
}

// ---------------------------------------------------------------------------
// Load offset
// ---------------------------------------------------------------------------
const OFFSET_FILE = path.join(__dirname, '..', 'references', 'telegram-offset.json');

function loadOffset() {
  try {
    const data = JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8'));
    return data.offset || 0;
  } catch (e) {
    return 0;
  }
}

function saveOffset(offset) {
  fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset }, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
    ? parseInt(process.env.TELEGRAM_ALLOWED_CHAT_ID, 10)
    : null;

  const lastOffset = loadOffset();
  console.log(`Polling Telegram from offset ${lastOffset}...`);

  const updates = await telegramApi(opts.token, 'getUpdates', {
    offset: lastOffset,
    limit:  20,
    timeout: 0,
  });

  if (!updates || updates.length === 0) {
    console.log('No new updates.');
    process.exit(2);
  }

  // Filter to audio/voice messages
  const audioUpdates = updates.filter(u => {
    const msg = u.message;
    if (!msg) return false;
    if (allowedChatId && msg.chat.id !== allowedChatId) return false;
    return !!(msg.voice || msg.audio || (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('audio/')));
  });

  // Update offset past all received updates
  const maxUpdateId = Math.max(...updates.map(u => u.update_id));
  saveOffset(maxUpdateId + 1);

  if (audioUpdates.length === 0) {
    console.log('No audio messages in updates.');
    process.exit(2);
  }

  // Take the most recent audio message
  const latest = audioUpdates[audioUpdates.length - 1];
  const msg    = latest.message;

  let fileId, fileName, mimeType, durationSec;

  if (msg.voice) {
    fileId      = msg.voice.file_id;
    mimeType    = msg.voice.mime_type || 'audio/ogg';
    durationSec = msg.voice.duration || 0;
    fileName    = 'voice.ogg';
  } else if (msg.audio) {
    fileId      = msg.audio.file_id;
    mimeType    = msg.audio.mime_type || 'audio/mpeg';
    durationSec = msg.audio.duration || 0;
    fileName    = msg.audio.file_name || 'audio.mp3';
  } else {
    fileId      = msg.document.file_id;
    mimeType    = msg.document.mime_type || 'audio/mpeg';
    durationSec = 0;
    fileName    = msg.document.file_name || 'audio';
  }

  // Determine extension
  const extMap = {
    'audio/ogg':  'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4':  'm4a',
    'audio/wav':  'wav',
    'audio/x-wav': 'wav',
  };
  const fileExt = extMap[mimeType] || path.extname(fileName).replace('.', '') || 'mp3';

  console.log(`Found audio: ${fileName} (${mimeType}, ${durationSec}s)`);

  // Get file path from Telegram
  const fileInfo = await telegramApi(opts.token, 'getFile', { file_id: fileId });
  const filePath = fileInfo.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${opts.token}/${filePath}`;

  // Download the file
  console.log(`Downloading from Telegram...`);
  const audioBuffer = await httpGet(downloadUrl);
  const outputPath  = `${opts.output}.${fileExt}`;
  const outputDir   = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, audioBuffer);
  console.log(`Saved audio to: ${outputPath} (${(audioBuffer.length / 1024).toFixed(1)} KB)`);

  // Write metadata
  const meta = {
    chat_id:    msg.chat.id,
    message_id: msg.message_id,
    offset:     maxUpdateId + 1,
    file_name:  fileName,
    file_ext:   fileExt,
    duration_sec: durationSec,
  };
  fs.writeFileSync(opts.meta, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`Saved metadata to: ${opts.meta}`);

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
