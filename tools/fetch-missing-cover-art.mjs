import fs from 'node:fs/promises';
import path from 'node:path';
const sampleDir = path.resolve(process.cwd(), 'sample-files');
const indexPath = path.join(sampleDir, 'index.json');
const gamesPath = path.join(sampleDir, 'games.json');

const COVER_ART_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TRACK_EXTENSIONS = new Set([
  'psf',
  'minipsf',
  'psf2',
  'minipsf2',
  'spc',
  'nsf',
  'nsfe',
  'gbs',
  'hes',
  'kss',
  'vgm',
  'vgz',
  'gym',
  'ay',
  'sng',
  'n64',
  'z64',
  'v64',
  'usf',
  'miniusf',
  'opx',
]);

const PLATFORM_LABELS = {
  psx: 'PlayStation',
  snes: 'SNES',
  nez: 'NES',
  n64: 'Nintendo 64',
  vgm: 'Mega Drive',
  xa: 'PlayStation',
};

const COVER_MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const WIKIPEDIA_PAGE_BASE_URL = 'https://en.wikipedia.org/wiki/';

const fetchCoverArtDryRun = process.env.TRACKIFY_FETCH_COVER_ART_DRY_RUN === '1';
const fetchCoverArtAllowNonCommons = process.env.TRACKIFY_FETCH_COVER_ART_ALLOW_NON_COMMONS !== '0';
const fetchCoverArtTimeoutMs = parsePositiveInt(process.env.TRACKIFY_FETCH_COVER_ART_TIMEOUT_MS, 8000);
const fetchCoverArtMaxPerRun = parsePositiveInt(process.env.TRACKIFY_FETCH_COVER_ART_MAX_PER_RUN, 25);
const fetchCoverArtMaxBytes = parsePositiveInt(process.env.TRACKIFY_FETCH_COVER_ART_MAX_BYTES, 5 * 1024 * 1024);
const fetchCoverArtInsecureTls = process.env.TRACKIFY_FETCH_COVER_ART_INSECURE_TLS !== '0';
const fetchCoverArtRequestDelayMs = parsePositiveInt(process.env.TRACKIFY_FETCH_COVER_ART_REQUEST_DELAY_MS, 250);
const fetchCoverArtRetryMaxAttempts = parsePositiveInt(process.env.TRACKIFY_FETCH_COVER_ART_RETRY_MAX_ATTEMPTS, 4);
const fetchCoverArtRetryBaseDelayMs = parsePositiveInt(process.env.TRACKIFY_FETCH_COVER_ART_RETRY_BASE_DELAY_MS, 1000);

if (fetchCoverArtInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function parsePositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function logInfo(message) {
  process.stdout.write(`[trackify-coverart] ${message}\n`);
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function getExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

function stripExtension(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function normalizeTitleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function formatErrorDetails(error) {
  if (!error) return 'unknown-error';

  const parts = [];
  let current = error;
  let depth = 0;

  while (current && depth < 5) {
    const message = String(current.message || current);
    const code = current && current.code ? ` code=${String(current.code)}` : '';
    const errno = current && typeof current.errno !== 'undefined' ? ` errno=${String(current.errno)}` : '';
    const syscall = current && current.syscall ? ` syscall=${String(current.syscall)}` : '';
    parts.push(`${message}${code}${errno}${syscall}`.trim());
    current = current && typeof current === 'object' ? current.cause : null;
    depth += 1;
  }

  return parts.join(' <- ');
}

function parseRetryAfterMs(retryAfterHeader) {
  const raw = String(retryAfterHeader || '').trim();
  if (!raw) return -1;

  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    const deltaMs = asDate - Date.now();
    return deltaMs > 0 ? deltaMs : 0;
  }

  return -1;
}

async function sleep(ms) {
  if (!ms || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value) {
  return (
    String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'cover'
  );
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function simplifyGameTitle(title) {
  return String(title || '')
    .replace(/\b(complete|disc|sample|ost|soundtrack)\b/gi, ' ')
    .replace(/\s+-\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildHeuristicAliases(values = []) {
  const normalized = normalizeSearchText(values.join(' '));
  const aliases = [];

  if (/\bbio\s*hazard\b/.test(normalized)) {
    aliases.push('Resident Evil');
  }

  return aliases;
}

function buildSearchCandidates(gameTitle, platform, year, aliases = []) {
  const cleanTitle = String(gameTitle || '').trim();
  if (!cleanTitle && aliases.length === 0) return [];

  const platformLabel = PLATFORM_LABELS[platform] || '';
  const simplifiedTitle = simplifyGameTitle(cleanTitle);
  const normalizedAliases = aliases.map((alias) => String(alias || '').trim()).filter(Boolean);
  const heuristicAliases = buildHeuristicAliases([cleanTitle, simplifiedTitle, ...normalizedAliases]);
  const candidates = [
    `${cleanTitle} video game`,
    simplifiedTitle ? `${simplifiedTitle} video game` : '',
    platformLabel ? `${cleanTitle} ${platformLabel} video game` : '',
    platformLabel && simplifiedTitle ? `${simplifiedTitle} ${platformLabel} video game` : '',
    year ? `${cleanTitle} ${year} video game` : '',
    year && simplifiedTitle ? `${simplifiedTitle} ${year} video game` : '',
    cleanTitle,
    simplifiedTitle,
    ...normalizedAliases,
    ...heuristicAliases,
    ...normalizedAliases.map((alias) => `${alias} video game`),
    ...heuristicAliases.map((alias) => `${alias} video game`),
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function computeTitleSimilarity(gameTitle, pageTitle) {
  const left = normalizeSearchText(gameTitle);
  const right = normalizeSearchText(pageTitle);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const compactLeft = left.replace(/\s+/g, '');
  const compactRight = right.replace(/\s+/g, '');
  if (compactLeft && compactLeft === compactRight) return 0.95;
  if (compactLeft && compactRight.includes(compactLeft)) return 0.9;
  if (compactRight && compactLeft.includes(compactRight)) return 0.85;
  if (right.includes(left)) return 0.9;
  if (left.includes(right)) return 0.85;

  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  const denom = Math.max(leftTokens.size, rightTokens.size, 1);
  return intersection / denom;
}

function inferCoverExtension(imageUrl, contentType) {
  const normalizedType = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (COVER_MIME_EXTENSION[normalizedType]) {
    return COVER_MIME_EXTENSION[normalizedType];
  }

  try {
    const ext = path.extname(new URL(imageUrl).pathname).toLowerCase();
    if (ext === '.jpeg') return 'jpg';
    if (ext.startsWith('.')) {
      const candidate = ext.slice(1);
      if (COVER_ART_EXTENSIONS.has(candidate) || candidate === 'webp') {
        return candidate;
      }
    }
  } catch {
    // Ignore malformed URL extension parsing.
  }

  return 'jpg';
}

function isAllowedCoverUrl(imageUrl) {
  if (fetchCoverArtAllowNonCommons) return true;

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return false;
  }

  if (parsed.hostname !== 'upload.wikimedia.org') return false;
  return parsed.pathname.includes('/wikipedia/commons/');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeWikipediaImageUrl(rawUrl) {
  const source = decodeHtmlEntities(String(rawUrl || '').trim());
  if (!source) return '';

  if (source.startsWith('//')) {
    return `https:${source}`;
  }

  if (source.startsWith('/')) {
    return `https://en.wikipedia.org${source}`;
  }

  try {
    return new URL(source).toString();
  } catch {
    return '';
  }
}

function pickFirstInfoboxImageFromHtml(htmlText) {
  const html = String(htmlText || '');
  if (!html) return '';

  const infoboxMatch = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<\/table>/i);
  const infoboxHtml = infoboxMatch ? infoboxMatch[0] : html;
  const imageMatch = infoboxHtml.match(/<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>/i);
  if (!imageMatch || !imageMatch[1]) return '';
  return normalizeWikipediaImageUrl(imageMatch[1]);
}

async function fetchJson(url) {
  for (let attempt = 1; attempt <= fetchCoverArtRetryMaxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchCoverArtTimeoutMs);

    try {
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Trackify/0.1 (sample-cover-fetch)',
            Accept: 'application/json',
          },
        });
      } catch (error) {
        throw new Error(`Request failed for ${url}: ${formatErrorDetails(error)}`);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if ((response.status === 429 || response.status === 503) && attempt < fetchCoverArtRetryMaxAttempts) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
          const fallbackBackoffMs = fetchCoverArtRetryBaseDelayMs * 2 ** (attempt - 1);
          const backoffMs = retryAfterMs >= 0 ? retryAfterMs : fallbackBackoffMs;
          const retryMode = retryAfterMs >= 0 ? `Retry-After(${String(retryAfterHeader).trim()})` : 'exponential-backoff';

          logInfo(
            `Rate limited (HTTP ${response.status}) for lookup request; retrying in ${backoffMs}ms via ${retryMode} (attempt ${attempt}/${fetchCoverArtRetryMaxAttempts})`
          );
          await sleep(backoffMs);
          continue;
        }
        throw new Error(`HTTP ${response.status} for ${url}${text ? `: ${text.slice(0, 160)}` : ''}`);
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        const text = await response.text().catch(() => '');
        throw new Error(`Non-JSON response for ${url}: ${text.slice(0, 160)}`);
      }

      try {
        return await response.json();
      } catch (error) {
        throw new Error(`JSON parse failed for ${url}: ${formatErrorDetails(error)}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(`Request failed after ${fetchCoverArtRetryMaxAttempts} attempts for ${url}`);
}

async function searchWikipediaTitles(query) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '5',
    format: 'json',
    utf8: '1',
    origin: '*',
  });

  const json = await fetchJson(`${WIKIPEDIA_API_URL}?${params.toString()}`);
  const entries = json?.query?.search;
  if (!Array.isArray(entries)) return [];

  return entries.map((entry) => (entry && typeof entry.title === 'string' ? entry.title : '')).filter(Boolean);
}

async function fetchWikipediaSummaryImage(pageTitle) {
  const encodedTitle = encodeURIComponent(pageTitle.replace(/\s+/g, '_'));
  const json = await fetchJson(`${WIKIPEDIA_SUMMARY_URL}${encodedTitle}`);

  if (json?.type === 'disambiguation') {
    return '';
  }

  const source = json?.originalimage?.source || json?.thumbnail?.source || '';
  return typeof source === 'string' ? source : '';
}

async function fetchWikipediaPageImageViaApi(pageTitle) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'pageimages',
    titles: pageTitle,
    piprop: 'original|thumbnail',
    pithumbsize: '1200',
    format: 'json',
    utf8: '1',
    origin: '*',
  });

  const json = await fetchJson(`${WIKIPEDIA_API_URL}?${params.toString()}`);
  const pages = Object.values(json?.query?.pages || {});
  for (const page of pages) {
    if (!page || typeof page !== 'object') continue;
    const source = page?.original?.source || page?.thumbnail?.source || '';
    if (typeof source === 'string' && source.trim()) {
      return source.trim();
    }
  }

  return '';
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchCoverArtTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Trackify/0.1 (sample-cover-fetch)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scrapeWikipediaInfoboxImage(pageTitle) {
  const pageSlug = encodeURIComponent(pageTitle.replace(/\s+/g, '_'));
  const pageUrl = `${WIKIPEDIA_PAGE_BASE_URL}${pageSlug}`;
  const html = await fetchText(pageUrl);
  return pickFirstInfoboxImageFromHtml(html);
}

async function resolveRemoteCoverUrl(gameTitle, platform, year, aliases = []) {
  const candidates = buildSearchCandidates(gameTitle, platform, year, aliases);
  const lookupNames = [...candidates];
  let best = { title: '', score: 0 };
  const scoreNames = [gameTitle, ...aliases, ...buildHeuristicAliases([gameTitle, ...aliases])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  let hasQuerySuccess = false;
  let queryFailures = 0;
  const queryFailureDetails = [];

  for (const query of candidates) {
    await sleep(fetchCoverArtRequestDelayMs);
    let titles;
    try {
      titles = await searchWikipediaTitles(query);
      hasQuerySuccess = true;
    } catch (error) {
      queryFailures += 1;
      if (queryFailureDetails.length < 4) {
        queryFailureDetails.push(`${query}: ${formatErrorDetails(error)}`);
      }
      continue;
    }

    for (const title of titles) {
      const score = scoreNames.reduce((maxScore, candidateName) => {
        const nextScore = computeTitleSimilarity(candidateName, title);
        return nextScore > maxScore ? nextScore : maxScore;
      }, 0);
      if (score > best.score) {
        best = { title, score };
      }
    }
  }

  if (!hasQuerySuccess && queryFailures > 0) {
    return {
      url: '',
      reason: 'lookup-request-failed',
      lookupNames,
      queryFailureDetails,
    };
  }

  if (!best.title || best.score < 0.45) {
    return {
      url: '',
      reason: 'no-confident-page-match',
      lookupNames,
      matchedPage: best.title,
      matchScore: best.score,
    };
  }

  let imageUrl = '';
  try {
    imageUrl = await fetchWikipediaSummaryImage(best.title);
  } catch {
    // Continue to fallback strategies.
  }

  if (!imageUrl) {
    try {
      imageUrl = await fetchWikipediaPageImageViaApi(best.title);
    } catch {
      // Continue to HTML scraping fallback.
    }
  }

  if (!imageUrl) {
    try {
      imageUrl = await scrapeWikipediaInfoboxImage(best.title);
    } catch {
      return {
        url: '',
        reason: 'image-fetch-fallbacks-failed',
        lookupNames,
        matchedPage: best.title,
        matchScore: best.score,
      };
    }
  }

  if (!imageUrl) {
    return {
      url: '',
      reason: 'no-image-on-page',
      lookupNames,
      matchedPage: best.title,
      matchScore: best.score,
    };
  }

  if (!isAllowedCoverUrl(imageUrl)) {
    return {
      url: '',
      reason: 'image-source-not-allowed',
      lookupNames,
      matchedPage: best.title,
      matchScore: best.score,
    };
  }

  return {
    url: imageUrl,
    reason: '',
    lookupNames,
    matchedPage: best.title,
    matchScore: best.score,
  };
}

async function downloadCoverImage(imageUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchCoverArtTimeoutMs);

  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Trackify/0.1 (sample-cover-fetch)',
        Accept: 'image/*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = String(response.headers.get('content-type') || '');
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength <= 0) {
      throw new Error('Empty image response');
    }
    if (data.byteLength > fetchCoverArtMaxBytes) {
      throw new Error(`Image exceeds max bytes (${data.byteLength})`);
    }

    return {
      data,
      contentType,
      extension: inferCoverExtension(imageUrl, contentType),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function collectRelativeFiles(rootDir) {
  const output = [];

  async function walk(currentDir, relativePrefix = '') {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        output.push(rel);
      }
    }
  }

  await walk(rootDir);
  return output;
}

function buildCoverArtByDirectory(relativeFiles) {
  const byDirectory = new Map();

  for (const relPath of relativeFiles) {
    const ext = getExtension(relPath);
    if (!COVER_ART_EXTENSIONS.has(ext)) continue;

    const dir = path.posix.dirname(relPath);
    if (!byDirectory.has(dir)) {
      byDirectory.set(dir, []);
    }
    byDirectory.get(dir).push(relPath);
  }

  for (const files of byDirectory.values()) {
    files.sort((a, b) => a.localeCompare(b));
  }

  return byDirectory;
}

function chooseTopByCount(mapValue) {
  const ranked = [...mapValue.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return String(a[0]).localeCompare(String(b[0]));
  });
  return ranked[0]?.[0] || '';
}

function buildGameLookup(indexItems) {
  const lookup = new Map();

  for (const item of indexItems) {
    const trackFile = String(item?.file || '').trim();
    if (!trackFile) continue;

    const ext = getExtension(trackFile);
    if (!TRACK_EXTENSIONS.has(ext)) continue;

    const title = normalizeTitleKey(item?.game);
    if (!title) continue;

    if (!lookup.has(title)) {
      lookup.set(title, {
        directories: new Map(),
        platforms: new Map(),
        years: new Map(),
      });
    }

    const bucket = lookup.get(title);
    const trackDir = path.posix.dirname(trackFile);
    const platform = String(item?.platform || '').trim();
    const year = String(item?.metadata?.year || item?.year || '').trim();

    bucket.directories.set(trackDir, (bucket.directories.get(trackDir) || 0) + 1);
    if (platform) {
      bucket.platforms.set(platform, (bucket.platforms.get(platform) || 0) + 1);
    }
    if (year) {
      bucket.years.set(year, (bucket.years.get(year) || 0) + 1);
    }
  }

  return lookup;
}

function collectMissingCoverTargets(gamesItems, gameLookup, coverArtByDirectory) {
  const targets = [];

  for (const game of gamesItems) {
    if (String(game?.coverArt || '').trim()) continue;

    const title = String(game?.title || '').trim();
    if (!title) continue;

    const key = normalizeTitleKey(title);
    const bucket = gameLookup.get(key);
    if (!bucket) continue;

    const trackDir = chooseTopByCount(bucket.directories);
    if (!trackDir) continue;

    const existingImages = coverArtByDirectory.get(trackDir) || [];
    const platform = chooseTopByCount(bucket.platforms);
    const year = String(game?.year || '').trim() || chooseTopByCount(bucket.years);
    const folderAlias = stripExtension(path.posix.basename(trackDir)).replace(/-/g, ' ').trim();
    const aliases = folderAlias ? [folderAlias] : [];

    targets.push({
      gameRef: game,
      gameTitle: title,
      trackDir,
      platform,
      year,
      aliases,
      existingImages,
    });
  }

  targets.sort((a, b) => a.trackDir.localeCompare(b.trackDir));
  return targets;
}

async function main() {
  const sampleDirExists = await fs
    .stat(sampleDir)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
  if (!sampleDirExists) {
    throw new Error(`sample-files directory not found under current working directory: ${sampleDir}`);
  }

  logInfo(`Starting cover-art fetch using ${indexPath} and ${gamesPath}`);
  logInfo(
    `Cover art settings: dryRun=${fetchCoverArtDryRun} maxPerRun=${fetchCoverArtMaxPerRun} timeoutMs=${fetchCoverArtTimeoutMs} insecureTls=${fetchCoverArtInsecureTls}`
  );

  const [indexRaw, gamesRaw] = await Promise.all([fs.readFile(indexPath, 'utf8'), fs.readFile(gamesPath, 'utf8')]);
  const indexItems = JSON.parse(indexRaw);
  const gamesItems = JSON.parse(gamesRaw);

  if (!Array.isArray(indexItems)) {
    throw new Error(`${indexPath} must contain a JSON array`);
  }
  if (!Array.isArray(gamesItems)) {
    throw new Error(`${gamesPath} must contain a JSON array`);
  }

  const relativeFiles = await collectRelativeFiles(sampleDir);
  const coverArtByDirectory = buildCoverArtByDirectory(relativeFiles);
  const gameLookup = buildGameLookup(indexItems);
  const targets = collectMissingCoverTargets(gamesItems, gameLookup, coverArtByDirectory);

  const summary = {
    dryRun: fetchCoverArtDryRun,
    scanned: targets.length,
    matched: 0,
    downloaded: 0,
    linkedExisting: 0,
    skipped: 0,
    errors: 0,
    updatedGames: 0,
  };

  const touchedGames = new Set();
  logInfo(`Found ${targets.length} games missing coverArt in games.json.`);

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];

    if (summary.matched >= fetchCoverArtMaxPerRun) {
      summary.skipped += 1;
      continue;
    }

    logInfo(`Cover lookup [${i + 1}/${targets.length}] ${target.trackDir}`);

    if (target.existingImages.length > 0) {
      const existingCover = target.existingImages[0];
      target.gameRef.coverArt = existingCover;
      touchedGames.add(target.gameTitle);
      summary.linkedExisting += 1;
      summary.matched += 1;
      process.stdout.write(`Linked existing cover art for ${target.gameTitle}: ${existingCover}\n`);
      continue;
    }

    let resolved;
    try {
      resolved = await resolveRemoteCoverUrl(target.gameTitle, target.platform, target.year, target.aliases || []);
    } catch (error) {
      summary.errors += 1;
      process.stderr.write(`Cover lookup failed for ${target.trackDir}: ${formatErrorDetails(error)}\n`);
      continue;
    }

    if (!resolved.url) {
      const lookupNamesText =
        Array.isArray(resolved.lookupNames) && resolved.lookupNames.length ? resolved.lookupNames.join(' | ') : '(none)';
      const matchedPageText = resolved.matchedPage ? ` matchedPage=${resolved.matchedPage}` : '';
      const matchScoreText = Number.isFinite(resolved.matchScore) ? ` matchScore=${resolved.matchScore.toFixed(3)}` : '';
      if (resolved.reason === 'lookup-request-failed') {
        summary.errors += 1;
        const queryFailureText =
          Array.isArray(resolved.queryFailureDetails) && resolved.queryFailureDetails.length
            ? ` errors=${resolved.queryFailureDetails.join(' || ')}`
            : '';
        process.stderr.write(
          `Cover lookup failed for ${target.trackDir}: reason=${resolved.reason}; lookupNames=${lookupNamesText};${queryFailureText}\n`
        );
      } else {
        summary.skipped += 1;
        logInfo(
          `Cover lookup skipped for ${target.trackDir}: reason=${resolved.reason || 'no-match'}; lookupNames=${lookupNamesText};${matchedPageText}${matchScoreText}`
        );
      }
      continue;
    }

    summary.matched += 1;

    if (fetchCoverArtDryRun) {
      process.stdout.write(`Dry-run cover match: ${target.trackDir} <- ${resolved.url}\n`);
      continue;
    }

    let image;
    try {
      image = await downloadCoverImage(resolved.url);
    } catch (error) {
      summary.errors += 1;
      process.stderr.write(`Cover download failed for ${target.trackDir}: ${formatErrorDetails(error)}\n`);
      continue;
    }

    const outName = `auto_cover_${slugify(target.gameTitle)}.${image.extension}`;
    const outRelPath = toPosixPath(path.posix.join(target.trackDir, outName));
    const outFullPath = path.join(sampleDir, outRelPath);

    try {
      await fs.mkdir(path.dirname(outFullPath), { recursive: true });
      await fs.writeFile(outFullPath, image.data);
    } catch (error) {
      summary.errors += 1;
      process.stderr.write(`Cover write failed for ${target.trackDir}: ${formatErrorDetails(error)}\n`);
      continue;
    }

    target.gameRef.coverArt = outRelPath;
    touchedGames.add(target.gameTitle);
    summary.downloaded += 1;
    process.stdout.write(`Downloaded cover art for ${target.gameTitle}: ${outRelPath}\n`);
  }

  summary.updatedGames = touchedGames.size;

  if (!fetchCoverArtDryRun && summary.updatedGames > 0) {
    await fs.writeFile(gamesPath, `${JSON.stringify(gamesItems, null, 2)}\n`, 'utf8');
    logInfo(`Updated ${gamesPath} with ${summary.updatedGames} coverArt entries.`);
  }

  process.stdout.write(
    [
      'Cover fetch summary:',
      `dryRun=${summary.dryRun}`,
      `scanned=${summary.scanned}`,
      `matched=${summary.matched}`,
      `downloaded=${summary.downloaded}`,
      `linkedExisting=${summary.linkedExisting}`,
      `skipped=${summary.skipped}`,
      `errors=${summary.errors}`,
      `updatedGames=${summary.updatedGames}`,
    ].join(' ') + '\n'
  );
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error) + '\n');
  process.exitCode = 1;
});
