import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

async function referenceImage(url, res) {
  const set = url.searchParams.get('set') ?? '';
  const number = url.searchParams.get('number') ?? '';
  if (!/^[a-z0-9-]{1,24}$/i.test(set) || !/^[a-z0-9-]{1,16}$/i.test(number)) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Edición o número inválido.' }));
    return;
  }
  try {
    const response = await fetch(`https://images.pokemontcg.io/${encodeURIComponent(set)}/${encodeURIComponent(number)}.png`, { signal: AbortSignal.timeout(8000) });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || new URL(response.url).origin !== 'https://images.pokemontcg.io' || !type.startsWith('image/')) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Imagen de referencia no disponible.' }));
      return;
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > 3_000_000) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{}');
      return;
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 3_000_000) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=604800' });
    res.end(Buffer.from(bytes));
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'No se pudo cargar la imagen de referencia.' }));
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/reference-image') return await referenceImage(url, res);
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Método no permitido');
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '');
    const file = join(root, relative);
    if (!file.startsWith(root)) throw new Error('invalid path');
    const body = await readFile(file);
    const type = types[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}).listen(Number(process.env.PORT || 4173), '0.0.0.0', () => {
  console.log(`Cardfolio lista en http://localhost:${process.env.PORT || 4173}`);
});
