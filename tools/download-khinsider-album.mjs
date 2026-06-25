#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (compatible; TrackifyKhinsiderDownloader/0.1; +https://github.com)';
const REQUEST_DELAY_MS = 400;
const REQUEST_TIMEOUT_MS = 30000;
const SONG_TABLE_SELECTOR = '#songlist';
const SONG_LINK_SELECTOR = `${SONG_TABLE_SELECTOR} tbody tr td:nth-child(3) a[href]`;
const DOWNLOAD_TEXT_PATTERN = /click here to download as mp3/i;
const LOG_PREFIX = '[khinsider-download]';

function logInfo(message) {
  process.stdout.write(`${LOG_PREFIX} ${message}\n`);
}

function logError(message) {
  process.stderr.write(`${LOG_PREFIX} ERROR: ${message}\n`);
}

async function sleep(ms) {
  if (!ms || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveFolderName(parsedUrl) {
  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || 'khinsider-downloads';
  const cleaned = String(last).replace(/[^a-z0-9._-]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '');
  return cleaned || 'khinsider-downloads';
}

function parseArguments(argv) {
  const positional = argv.slice(2);

  if (positional.length === 0 || positional[0] === '-h' || positional[0] === '--help') {
    process.stdout.write(
      [
        'Usage: node tools/download-khinsider-album.mjs <album-url> [folder]',
        '  album-url  e.g. https://downloads.khinsider.com/game-soundtracks/album/foo',
        '  folder     output directory (default: last URL path segment, relative to cwd)',
      ].join('\n') + '\n'
    );
    process.exit(positional.length === 0 ? 1 : 0);
  }

  const albumUrl = positional[0];
  let parsedUrl;
  try {
    parsedUrl = new URL(albumUrl);
  } catch {
    throw new Error(`Invalid URL: ${albumUrl}`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
  }

  const userFolder = positional[1] ? positional[1].trim() : '';
  const folderName = userFolder || deriveFolderName(parsedUrl);
  const folderPath = path.isAbsolute(folderName)
    ? folderName
    : path.resolve(process.cwd(), folderName);

  return { albumUrl: parsedUrl.toString(), folder: folderPath, origin: parsedUrl.origin };
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
    }
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function collectSongPageLinks(albumHtml, albumUrl) {
  const $ = cheerio.load(albumHtml);
  const albumBase = new URL(albumUrl);
  const links = new Set();

  $(SONG_LINK_SELECTOR).each((_index, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, albumBase).toString();
      if (resolved !== albumUrl) {
        links.add(resolved);
      }
    } catch {
      // ignore malformed hrefs
    }
  });

  return [...links];
}

function findDownloadUrl(html, pageUrl) {
  const $ = cheerio.load(html);
  const pageBase = new URL(pageUrl);

  const elements = $('a').toArray();
  for (const element of elements) {
    const text = $(element).text().trim();
    if (!DOWNLOAD_TEXT_PATTERN.test(text)) continue;
    const href = $(element).attr('href');
    if (!href) continue;
    try {
      return new URL(href, pageBase).toString();
    } catch {
      continue;
    }
  }

  return '';
}

function sanitizeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 200);
}

function inferFileNameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      return sanitizeFileName(decodeURIComponent(last));
    }
  } catch {
    // ignore
  }
  return '';
}

function uniqueFileName(folder, candidate, taken) {
  const base = sanitizeFileName(candidate) || 'download.mp3';
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length) || 'download';
  let name = base;
  let counter = 1;
  while (taken.has(name)) {
    name = `${stem}.${counter}${ext}`;
    counter += 1;
  }
  taken.add(name);
  return path.join(folder, name);
}

async function downloadToFile(url, outPath, referer) {
  try {
    const stat = await fs.stat(outPath);
    if (stat.isFile()) {
      return { skipped: true, bytes: stat.size };
    }
  } catch {
    // not present; proceed to download
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (referer) {
      headers.Referer = referer;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength === 0) {
      throw new Error('Empty response body');
    }
    await fs.writeFile(outPath, buffer);
    return { skipped: false, bytes: buffer.byteLength };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  const args = parseArguments(process.argv);
  await fs.mkdir(args.folder, { recursive: true });

  logInfo(`Output folder: ${args.folder}`);
  logInfo(`Album URL:     ${args.albumUrl}`);

  const albumHtml = await fetchHtml(args.albumUrl);
  const songPages = collectSongPageLinks(albumHtml, args.albumUrl);

  if (songPages.length === 0) {
    throw new Error(
      `No song links found via selector "${SONG_LINK_SELECTOR}" at ${args.albumUrl}`
    );
  }

  logInfo(`Discovered ${songPages.length} song page(s). Starting downloads...`);

  const takenNames = new Set();
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < songPages.length; i += 1) {
    const songUrl = songPages[i];
    logInfo(`[${i + 1}/${songPages.length}] ${songUrl}`);

    try {
      const songHtml = await fetchHtml(songUrl);
      const downloadUrl = findDownloadUrl(songHtml, songUrl);

      if (!downloadUrl) {
        logError(`No "Click here to download as MP3" link found at ${songUrl}`);
        failed += 1;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const inferredName = inferFileNameFromUrl(downloadUrl) || `track-${i + 1}.mp3`;
      const outPath = uniqueFileName(args.folder, inferredName, takenNames);

      const result = await downloadToFile(downloadUrl, outPath, songUrl);
      if (result.skipped) {
        logInfo(`Skipped (exists): ${path.basename(outPath)} (${result.bytes} bytes)`);
        skipped += 1;
      } else {
        logInfo(`Saved: ${path.basename(outPath)} (${result.bytes} bytes)`);
        downloaded += 1;
      }
    } catch (error) {
      logError(`Failed for ${songUrl}: ${String(error?.message || error)}`);
      failed += 1;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  logInfo(`Done. downloaded=${downloaded} skipped=${skipped} failed=${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`FATAL: ${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});
