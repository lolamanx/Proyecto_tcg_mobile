import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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
    const headers = { Accept: 'application/json' };
    if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;
    const reply = await fetch(`https://api.pokemontcg.io/v2/cards/${id}?select=id,tcgplayer,cardmarket`,
      { headers, signal: AbortSignal.timeout(8500) });
    if (reply.status === 404) return json(res, 200, { reason: 'missing' });
    if (!reply.ok) throw new Error(`HTTP ${reply.status}`);
    const { data } = await reply.json();
    const value = data.tcgplayer?.prices?.[finish]?.market;
    json(res, 200, {
      amount: Number.isFinite(value) ? value : null,
      currency: 'USD',
      updated: data.tcgplayer?.updatedAt ?? null,
      tcgplayer: data.tcgplayer?.url ?? null,
      cardmarket: data.cardmarket?.url ?? null,
    });
  } catch {
    json(res, 503, { error: 'La fuente de precios no está disponible en este momento.' });
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/scan') return await scan(req, res, url.searchParams.get('region') === 'footer');
    if (req.method === 'GET' && url.pathname === '/api/market') return await market(url, res);
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
