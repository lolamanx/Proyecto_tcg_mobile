import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = new URL('./public/', import.meta.url);
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp',
};
const finishes = {
  normal: 'normal', holo: 'holofoil', reverse: 'reverseHolofoil',
  first: '1stEditionNormal', firstHolo: '1stEditionHolofoil',
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function scan(req, res, footer) {
  if (!/^image\/jpeg(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
    return json(res, 415, { error: 'La foto debe estar en formato JPEG.' });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5_000_000) {
      json(res, 413, { error: 'La foto supera el tamaño permitido.' });
      return;
    }
    chunks.push(chunk);
  }
  if (size < 3) return json(res, 400, { error: 'La foto está vacía.' });
  const buffer = Buffer.concat(chunks);
  if (buffer[0] !== 255 || buffer[1] !== 216 || buffer[2] !== 255) {
    return json(res, 400, { error: 'El archivo no es una imagen JPEG válida.' });
  }
  const text = await new Promise((resolve, reject) => {
    const child = execFile('tesseract', ['stdin', 'stdout', '-l', 'eng', '--psm', footer ? '6' : '11'],
      { timeout: 12000, env: { ...process.env, OMP_THREAD_LIMIT: '1' } },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(buffer);
  });
  json(res, 200, { text });
}

const marketCachePath = fileURLToPath(new URL('./data/market-cache.json', import.meta.url));
let marketCachePromise;
async function marketCache() {
  marketCachePromise ??= readFile(marketCachePath, 'utf8').then(JSON.parse).catch(() => ({}));
  return marketCachePromise;
}

async function saveMarketCache(cache) {
  await mkdir(new URL('./data/', import.meta.url), { recursive: true });
  await writeFile(marketCachePath, JSON.stringify(cache));
}

function priceValue(record) {
  if (!record || typeof record !== 'object') return null;
  const amount = Number(record.market ?? record.marketPrice ?? record.avg);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

async function market(url, res) {
  const id = url.searchParams.get('id') ?? '';
  const finish = finishes[url.searchParams.get('finish')];
  if (!/^[a-z0-9]+-[a-z0-9]+$/i.test(id) || !Object.values(finishes).includes(finish)) {
    return json(res, 400, { error: 'Carta o acabado inválidos.' });
  }
  if (url.searchParams.get('language') !== 'en') {
    return json(res, 200, { reason: 'language' });
  }
  try {
    const cache = await marketCache();
    const cached = cache[id];
    if (cached && Date.now() - cached.savedAt < 24 * 60 * 60 * 1000) {
      return json(res, 200, { ...cached.value, amount: cached.value.prices?.[finish] ?? null });
    }
    const reply = await fetch('https://api.tcgdex.net/v2/en/cards/' + encodeURIComponent(id),
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    if (reply.status === 404) return json(res, 200, { reason: 'missing' });
    if (!reply.ok) throw new Error('TCGdex HTTP ' + reply.status);
    const card = await reply.json();
    const pricing = card.pricing ?? {};
    const player = pricing.tcgplayer ?? {};
    const marketPrices = {};
    for (const variant of Object.values(finishes)) marketPrices[variant] = priceValue(player[variant]);
    const value = {
      prices: marketPrices,
      currency: String(player.unit ?? 'USD').toUpperCase(),
      updated: player.updated ?? pricing.updated ?? null,
      tcgplayer: player.url ?? null,
      cardmarket: pricing.cardmarket?.url ?? null,
      source: 'TCGdex',
    };
    cache[id] = { savedAt: Date.now(), value };
    const ids = Object.keys(cache);
    if (ids.length > 1200) {
      ids.sort((a, b) => cache[a].savedAt - cache[b].savedAt);
      for (const key of ids.slice(0, ids.length - 1200)) delete cache[key];
    }
    await saveMarketCache(cache);
    json(res, 200, { ...value, amount: marketPrices[finish] ?? null });
  } catch {
    const cached = (await marketCache())[id];
    if (cached && Date.now() - cached.savedAt < 30 * 24 * 60 * 60 * 1000) {
      return json(res, 200, { ...cached.value, amount: cached.value.prices?.[finish] ?? null, stale: true });
    }
    json(res, 503, { error: 'TCGdex no está disponible y todavía no hay un precio guardado en caché.' });
  }
}

async function cardImage(url, res) {
  const set = url.searchParams.get('set') ?? '';
  const number = url.searchParams.get('number') ?? '';
  if (!/^[a-z0-9-]{1,24}$/i.test(set) || !/^[a-z0-9-]{1,16}$/i.test(number)) {
    return json(res, 400, { error: 'Edición o número inválido.' });
  }
  try {
    const response = await fetch('https://images.pokemontcg.io/' + encodeURIComponent(set) + '/' +
      encodeURIComponent(number) + '.png', { signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      return json(res, 404, { error: 'Imagen de referencia no disponible.' });
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > 3_000_000) return json(res, 413, { error: 'Imagen demasiado grande.' });
    res.writeHead(200, { 'Content-Type': response.headers.get('content-type'), 'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff' });
    res.end(Buffer.from(body));
  } catch {
    json(res, 503, { error: 'No se pudo cargar la imagen de referencia.' });
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/scan') return await scan(req, res, url.searchParams.get('region') === 'footer');
    if (req.method === 'GET' && url.pathname === '/api/market') return await market(url, res);
    if (req.method === 'GET' && url.pathname === '/api/card-image') return await cardImage(url, res);
    if (req.method !== 'GET') return json(res, 405, { error: 'Método no disponible.' });
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(file) || file.startsWith('.')) return json(res, 404, {});
    const contentType = mime[extname(file)];
    if (!contentType) return json(res, 404, {});
    const body = await readFile(fileURLToPath(new URL(file, publicDir)));
    res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT' && req.method === 'GET') return json(res, 404, {});
    json(res, 500, { error: 'No se pudo procesar la solicitud. Puedes buscar la carta manualmente.' });
  }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
