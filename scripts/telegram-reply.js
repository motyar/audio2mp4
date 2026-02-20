#!/usr/bin/env node
/**
 * telegram-reply.js
 * Sends the generated output.mp4 back to the Telegram chat via sendVideo.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    video: 'output.mp4',
    meta:  'telegram-meta.json',
    mode:  'chunk',
    lang:  'en',
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token': opts.token = args[++i]; break;
      case '--video': opts.video = args[++i]; break;
      case '--meta':  opts.meta  = args[++i]; break;
      case '--mode':  opts.mode  = args[++i]; break;
      case '--lang':  opts.lang  = args[++i]; break;
    }
  }
  if (!opts.token) {
    console.error('ERROR: Telegram bot token is required (--token or TELEGRAM_BOT_TOKEN env var)');
    process.exit(1);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Language code → display name (minimal map)
// ---------------------------------------------------------------------------
const LANG_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi',
  tr: 'Turkish', pl: 'Polish', nl: 'Dutch', sv: 'Swedish',
  fa: 'Persian', he: 'Hebrew', ur: 'Urdu',
};
function langName(code) { return LANG_NAMES[code] || code; }

// ---------------------------------------------------------------------------
// Multipart form-data upload helper
// ---------------------------------------------------------------------------
function sendVideo(token, chatId, videoPath, caption) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const videoBuffer = fs.readFileSync(videoPath);
    const fileName = path.basename(videoPath);

    const parts = [];

    // chat_id field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
      `${chatId}`
    );

    // caption field
    if (caption) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="caption"\r\n\r\n` +
        `${caption}`
      );
    }

    // Assemble body
    const preamble = Buffer.from(parts.join('\r\n') + '\r\n', 'utf8');
    const fileHeader = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="video"; filename="${fileName}"\r\n` +
      `Content-Type: video/mp4\r\n\r\n`,
      'utf8'
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

    const body = Buffer.concat([preamble, fileHeader, videoBuffer, epilogue]);

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendVideo`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };

    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!json.ok) {
          reject(new Error(`Telegram sendVideo error: ${json.description}`));
        } else {
          resolve(json.result);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.video)) {
    console.error(`ERROR: Video file not found: ${opts.video}`);
    process.exit(1);
  }

  if (!fs.existsSync(opts.meta)) {
    console.error(`ERROR: Metadata file not found: ${opts.meta}`);
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(opts.meta, 'utf8'));
  const chatId = meta.chat_id;
  if (!chatId) {
    console.error('ERROR: chat_id not found in metadata');
    process.exit(1);
  }

  const durationSec = meta.duration_sec || 0;
  const caption = [
    '✅ Done!',
    `🌍 Language: ${langName(opts.lang)}`,
    durationSec ? `⏱ Audio: ${durationSec} sec` : '',
    `🎬 Subtitles: ${opts.mode} mode`,
  ].filter(Boolean).join('\n');

  console.log(`Sending video to chat ${chatId}...`);
  console.log(`Caption:\n${caption}`);

  const result = await sendVideo(opts.token, chatId, opts.video, caption);
  console.log(`✅ Video sent! Message ID: ${result.message_id}`);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
