import { loadCatalog, loadLiveCatalog } from './catalog-online.js';
import { assessCardImage, consensusCandidates, rankCardCandidates, rankWithCardImage } from './recognition.mjs';

const languages = { es: 'Español', en: 'Inglés', ja: 'Japonés', pt: 'Portugués', fr: 'Francés', de: 'Alemán', it: 'Italiano' };
const finishes = { normal: 'Normal', holo: 'Holográfica', reverse: 'Reverse holo', other: 'Otro acabado' };
const STORAGE_KEY = 'cardfolio.collection.v1';
const catalogRequest = loadCatalog().catch(async () => {
  const response = await fetch('/catalog.json');
  if (!response.ok) throw new Error('Catálogo inaccesible');
  return response.json();
});
let catalog = { cards: [] };
let stream;
let scanTimer;
let busy = false;
let ocrWorker;
const recognitionHistory = [];
const referenceCanvasCache = new Map();
let currentPhoto = '';
let detectedCards = [];
let collection = readCollection();

const $ = selector => document.querySelector(selector);
const camera = $('#camera-video');
const stage = $('#camera-stage');
const message = $('#scan-message');
const matches = $('#match-list');
const cardDialog = $('#card-dialog');

function readCollection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveCollection() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
    renderCollection();
    return true;
  } catch {
    return false;
  }
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function updateCounts() {
  const total = collection.reduce((sum, card) => sum + card.quantity, 0);
  $('#collection-total').textContent = total;
  $('#unique-count').textContent = collection.length;
  $('#value-count').textContent = collection.filter(card => card.price).length;
  $('#nav-count').hidden = total === 0;
  $('#nav-count').textContent = total;
  $('#empty-collection').hidden = collection.length !== 0;
}

function referenceURL(card) {
  if (card.image === `https://images.pokemontcg.io/${card.setId}/${card.number}.png`) return '/api/reference-image?' + new URLSearchParams({ set: card.setId, number: card.number });
  return card.image || '';
}

function loadReferenceCanvas(card) {
  if (!card.image) return Promise.reject(new Error('Sin referencia'));
  if (referenceCanvasCache.has(card.id)) return referenceCanvasCache.get(card.id);
  const request = new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 336;
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    image.onerror = reject;
    image.src = referenceURL(card);
  }).catch(error => {
    referenceCanvasCache.delete(card.id);
    throw error;
  });
  referenceCanvasCache.set(card.id, request);
  return request;
}

function cardPhoto(card) {
  return referenceURL(card);
}

function showMatches(results, note = '') {
  detectedCards = results.map(result => result.card || result);
  $('#match-count').textContent = results.length;
  matches.replaceChildren();
  if (!results.length) {
    message.textContent = note || 'No hubo coincidencias. Prueba con el nombre o el número de la carta.';
    $('#detected-badge').hidden = true;
    return;
  }
  message.textContent = note || 'Revisa la foto y confirma la edición antes de guardar.';
  $('#detected-badge').hidden = false;
  $('#detected-name').textContent = `${detectedCards[0].name} · ${detectedCards[0].number}/${detectedCards[0].total}`;
  for (const result of results) {
    const card = result.card || result;
    const score = Number.isFinite(result.score) ? `Puntaje ${Math.round(result.score * 100)}/100` : 'Coincidencia de texto';
    const signals = result.signals?.join(' + ') || 'texto';
    const visual = Number.isFinite(result.visualScore) ? ' · imagen comparada' : '';
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'match-card';
    item.innerHTML = `<img src="${html(cardPhoto(card))}" alt="Referencia ${html(card.name)}" loading="lazy"><span class="match-copy"><b>${html(card.name)}</b><small>${html(card.setName)} · ${html(card.number)}/${html(card.total)}</small><small class="match-score">${html(score)} · ${html(signals)}${visual}</small><small class="match-confirm">Confirma la edición con tu carta ↗</small></span><span class="match-arrow">›</span>`;
    item.querySelector('img').addEventListener('error', event => { event.currentTarget.src = '/icon.svg'; });
    item.addEventListener('click', () => openCard(card));
    matches.append(item);
  }
}

async function loadOcr() {
  if (ocrWorker) return ocrWorker;
  $('#ocr-state').textContent = 'CARGANDO OCR';
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }
  ocrWorker = await window.Tesseract.createWorker('eng', 1, {
    logger: event => {
      if (event.status === 'recognizing text') $('#ocr-state').textContent = `LEYENDO ${Math.round(event.progress * 100)}%`;
    }
  });
  return ocrWorker;
}

function makeOcrSheet(source) {
  const canvas = document.createElement('canvas');
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  canvas.width = Math.max(1, Math.min(1100, width));
  const top = Math.round(height * .02);
  const topHeight = Math.round(height * .20);
  const bottom = Math.round(height * .80);
  const bottomHeight = Math.round(height * .19);
  const bandHeight = Math.round(canvas.width * topHeight / width);
  const footerHeight = Math.round(canvas.width * bottomHeight / width);
  const gap = Math.max(16, Math.round(canvas.width * .035));
  canvas.height = bandHeight + footerHeight + gap;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'grayscale(1) contrast(1.38) brightness(1.04)';
  ctx.drawImage(source, 0, top, width, topHeight, 0, 0, canvas.width, bandHeight);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, bandHeight, canvas.width, gap);
  ctx.drawImage(source, 0, bottom, width, bottomHeight, 0, bandHeight + gap, canvas.width, footerHeight);
  return canvas;
}

function cropLiveCard(video) {
  const box = video.getBoundingClientRect();
  const guide = stage.querySelector('.scan-frame').getBoundingClientRect();
  const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
  const left = (guide.left - box.left + (video.videoWidth * scale - box.width) / 2) / scale;
  const top = (guide.top - box.top + (video.videoHeight * scale - box.height) / 2) / scale;
  const width = guide.width / scale;
  const height = guide.height / scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.min(1000, Math.round(width)));
  canvas.height = Math.max(1, Math.round(canvas.width * height / width));
  canvas.getContext('2d').drawImage(video, left, top, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function readFrame(source, live = false) {
  if (busy) return;
  busy = true;
  try {
    const worker = await loadOcr();
    const cardArea = live ? cropLiveCard(source) : source;
    const quality = assessCardImage(cardArea);
    const result = await worker.recognize(makeOcrSheet(cardArea));
    const text = result.data.text || '';
    let found = rankCardCandidates(catalog, text, {
      ocrConfidence: result.data.confidence,
      qualityPenalty: quality.penalty,
    });
    if (found.length) found = await rankWithCardImage(cardArea, found, loadReferenceCanvas);
    if (live) {
      const stable = consensusCandidates(recognitionHistory, found);
      if (stable.length) {
        $('#ocr-state').textContent = 'NÚMERO Y EDICIÓN LEÍDOS';
        $('#camera-state').textContent = 'CARTA DETECTADA · REVISA LA COINCIDENCIA';
        const glareHint = quality.glare > .10 ? ' Hay reflejo fuerte; inclina un poco la carta y compara otra vez.' : '';
        showMatches(stable, `Lectura estable en varias capturas. El puntaje ordena candidatos; no es una probabilidad.${glareHint}`);
      } else if (found.length) {
        $('#ocr-state').textContent = 'COMPARANDO NÚMERO, NOMBRE E IMAGEN';
        $('#camera-state').textContent = 'MANTÉN LA CARTA QUIETA PARA CONFIRMAR';
      } else {
        $('#ocr-state').textContent = 'BUSCANDO NÚMERO';
        recognitionHistory.push([]);
        if (recognitionHistory.length > 3) recognitionHistory.shift();
      }
      return;
    }
    $('#ocr-state').textContent = 'FOTO LEÍDA';
    const glareHint = quality.glare > .10 ? 'La foto tiene reflejos; revisa el número y las imágenes con cuidado.' : 'El puntaje combina el texto leído y la similitud de imagen cuando está disponible.';
    showMatches(found, found.length ? glareHint : 'No encontramos una coincidencia; busca manualmente abajo.');
  } catch (error) {
    $('#ocr-state').textContent = 'OCR NO DISPONIBLE';
    message.textContent = 'No pudimos leer el número. Usa la búsqueda manual o intenta otra foto.';
  } finally {
    busy = false;
  }
}

async function startCamera() {
  if (stream) {
    stopCamera();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    message.textContent = 'El navegador requiere una conexión segura (HTTPS) para abrir la cámara.';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } } });
    camera.srcObject = stream;
    await camera.play();
    stage.style.removeProperty('--photo-url');
    stage.classList.add('camera-on');
    stage.classList.remove('photo-on');
    $('#camera-placeholder').hidden = true;
    $('#camera-state').textContent = 'CÁMARA ACTIVA';
    $('#camera-button').innerHTML = '<span>■</span> Detener cámara';
    message.textContent = 'Mantén la carta dentro del marco y el número inferior enfocado.';
    recognitionHistory.length = 0;
    scanTimer = setInterval(() => { if (stream && !busy) readFrame(camera, true); }, 1600);
  } catch {
    message.textContent = 'No pudimos acceder a la cámara. Revisa el permiso o elige una foto.';
  }
}

function stopCamera() {
  clearInterval(scanTimer);
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  camera.srcObject = null;
  stage.classList.remove('camera-on');
  $('#camera-placeholder').hidden = false;
  $('#camera-state').textContent = 'CÁMARA DESACTIVADA';
  $('#camera-button').innerHTML = '<span>◉</span> Activar cámara';
  recognitionHistory.length = 0;
}

async function scanFile(file) {
  if (!file) return;
  stopCamera();
  currentPhoto = URL.createObjectURL(file);
  const preview = new Image();
  preview.onload = () => readFrame(preview, false);
  preview.onerror = () => { message.textContent = 'No se pudo abrir esta foto.'; };
  preview.src = currentPhoto;
  $('#camera-state').textContent = 'FOTO LISTA';
  stage.classList.add('photo-on');
  stage.style.setProperty('--photo-url', `url("${currentPhoto}")`);
  $('#camera-placeholder').hidden = true;
  camera.poster = currentPhoto;
}

function openCard(card) {
  const existing = collection.filter(item => item.cardId === card.id).reduce((n, item) => n + item.quantity, 0);
  const content = $('#dialog-content');
  const marketSearch = encodeURIComponent(`${card.name} ${card.number}`);
  content.innerHTML = `<div class="dialog-heading"><img src="${html(card.image)}" alt="${html(card.name)}"><div><p class="eyebrow">${html(card.setName)}</p><h2>${html(card.name)}</h2><p class="dialog-number">Carta ${html(card.number)}/${html(card.total)}</p></div></div>
    <div class="confirm-strip"><span>✓</span><p><b>Confirma con tu copia</b><small>Compara ilustración, número y símbolo de edición.</small>${card.symbol ? `<img width="32" alt="Símbolo de la edición" src="${html(card.symbol)}">` : '' }</p></div>
    <div class="market-links"><a href="https://www.tcgplayer.com/search/pokemon/product?q=${marketSearch}" rel="noopener noreferrer">TCGplayer ↗</a><a href="https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${marketSearch}" rel="noopener noreferrer">Cardmarket ↗</a><a href="https://tcgmatch.cl/" rel="noopener noreferrer">TCGMatch Chile ↗</a></div>
    <form id="card-form" class="card-form">
      <label>Idioma<select name="language" required><option value="">Elige idioma</option>${Object.entries(languages).map(([key, value]) => `<option value="${key}">${value}</option>`).join('')}</select></label>
      <label>Acabado<select name="finish" required><option value="">Elige acabado</option>${Object.entries(finishes).map(([key, value]) => `<option value="${key}">${value}</option>`).join('')}</select></label>
      <label>Cantidad<input name="quantity" type="number" min="1" max="999" value="1" required></label>
      <details class="price-entry"><summary>Anotar un precio local (CLP)</summary><p>Guarda el precio que observes en una tienda; se etiqueta con la fecha de hoy y no se convierte desde otra moneda.</p><div class="price-fields"><label>Precio<input name="price" type="number" min="1" max="999999999" placeholder="Ej. 12500"></label><label>Tienda o fuente<input name="source" maxlength="60" placeholder="Tienda, TCGMatch…"></label></div></details>
      <p class="already-owned" ${existing ? '' : 'hidden'}>Ya tienes ${existing} copia(s) de esta carta en tu colección.</p>
      <button class="button button-primary button-wide" type="submit">Añadir a mi colección</button>
      <p class="form-feedback" id="form-feedback" role="status"></p>
    </form>`;
  content.querySelector('.dialog-heading img').addEventListener('error', event => { event.currentTarget.src = '/icon.svg'; });
  content.querySelector('#card-form').addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const language = data.get('language');
    const finish = data.get('finish');
    const quantity = Number(data.get('quantity'));
    const key = `${card.id}|${language}|${finish}`;
    const price = Number(data.get('price'));
    const source = String(data.get('source') || '').trim();
    const previous = collection.find(item => item.key === key);
    if ((previous?.quantity || 0) + quantity > 999) {
      $('#form-feedback').textContent = 'El máximo es 999 copias de esta versión.';
      return;
    }
    const updated = { ...(previous || {}), key, cardId: card.id, name: card.name, setName: card.setName, number: card.number, total: card.total, image: card.image, language, finish, quantity: (previous?.quantity || 0) + quantity };
    if (price > 0) updated.price = { amount: price, source: source || 'Precio anotado', date: new Date().toISOString() };
    collection = collection.filter(item => item.key !== key).concat(updated);
    if (!saveCollection()) {
      $('#form-feedback').textContent = 'No se pudo guardar en este dispositivo.';
      return;
    }
    event.currentTarget.querySelector('button[type=submit]').textContent = 'Guardada ✓';
    $('#form-feedback').textContent = `${card.name} quedó en tu colección.`;
    setTimeout(() => cardDialog.close(), 600);
  });
  if (card.language) content.querySelector('[name=language]').value = card.language;
  cardDialog.showModal();
}

function renderCollection() {
  updateCounts();
  const term = normalize($('#collection-search').value);
  const list = $('#collection-list');
  list.replaceChildren();
  const rows = collection.filter(item => normalize(`${item.name} ${item.setName} ${item.number} ${languages[item.language]} ${finishes[item.finish]}`).includes(term));
  for (const item of rows) {
    const row = document.createElement('article');
    row.className = 'collection-card';
    row.innerHTML = `<img src="${html(item.image)}" alt="${html(item.name)}"><div class="collection-copy"><b>${html(item.name)}</b><small>${html(item.setName)} · ${html(item.number)}/${html(item.total)}</small><small>${languages[item.language]} · ${finishes[item.finish]}</small>${item.price ? `<small class="saved-price">${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(item.price.amount)} · ${html(item.price.source)} · ${new Date(item.price.date).toLocaleDateString('es-CL')}</small>` : ''}</div><div class="quantity-control"><button data-step="-1" aria-label="Quitar una copia">−</button><b>${item.quantity}</b><button data-step="1" aria-label="Añadir una copia">+</button></div>`;
    row.querySelector('img').addEventListener('error', event => { event.currentTarget.src = '/icon.svg'; });
    row.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
      const next = item.quantity + Number(button.dataset.step);
      if (next < 1) {
        if (!confirm(`¿Quitar ${item.name} de la colección?`)) return;
        collection = collection.filter(entry => entry.key !== item.key);
      } else {
        item.quantity = Math.min(999, next);
      }
      saveCollection();
    }));
    list.append(row);
  }
  $('#empty-collection').hidden = collection.length > 0;
  if (collection.length && !rows.length) list.innerHTML = '<p class="status-message">No encontramos cartas con esa búsqueda.</p>';
}

function navigate(page) {
  const scanning = page === 'scan';
  $('#scan-page').hidden = !scanning;
  $('#collection-page').hidden = scanning;
  $('#scan-page').classList.toggle('active', scanning);
  $('#collection-page').classList.toggle('active', !scanning);
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('selected', button.dataset.page === page));
  if (!scanning) stopCamera();
  else renderCollection();
}

$('#camera-button').addEventListener('click', startCamera);
$('#upload-button').addEventListener('click', () => $('#photo-input').click());
$('#photo-input').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; scanFile(file); });
$('#manual-search').addEventListener('submit', event => {
  event.preventDefault();
  const found = rankCardCandidates(catalog, $('#card-search').value, { manual: true });
  if (found.length) showMatches(found, `Coincidencias para “${$('#card-search').value.trim()}”. Confirma número, edición e imagen.`);
  else showMatches([], 'No encontramos esa carta en el catálogo incluido. Puedes ajustar la búsqueda.');
});
$('#collection-search').addEventListener('input', renderCollection);
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
document.querySelectorAll('[data-go-scan]').forEach(button => button.addEventListener('click', () => navigate('scan')));
$('#settings-button').addEventListener('click', () => $('#info-dialog').showModal());
window.addEventListener('hashchange', () => navigate(location.hash === '#coleccion' ? 'collection' : 'scan'));
window.addEventListener('pagehide', stopCamera);

try {
  catalog = await catalogRequest;
  message.textContent = `${catalog.editions ? catalog.editions + ' ediciones en línea' : 'Sin catálogo en línea · muestra local'} · ${catalog.cards.length} cartas.`;
} catch {
  message.textContent = 'No se pudo abrir el catálogo local. Revisa la conexión y recarga.';
}
const sourcePicker = $('#catalog-source');
sourcePicker.disabled = false;
sourcePicker.addEventListener('change', async () => {
  const previous = sourcePicker.dataset.active || 'archive';
  const selected = sourcePicker.value;
  sourcePicker.disabled = true;
  stopCamera();
  message.textContent = 'Consultando el catálogo…';
  try {
    const next = selected === 'archive' ? await loadCatalog() : await loadLiveCatalog(selected);
    catalog = next;
    sourcePicker.dataset.active = selected;
    showMatches([], next.editions + ' ediciones · ' + next.cards.length + ' cartas disponibles.');
  } catch {
    sourcePicker.value = previous;
    message.textContent = 'No se pudo cargar ese catálogo. Sigue disponible el anterior.';
  } finally {
    sourcePicker.disabled = false;
  }
});
renderCollection();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
