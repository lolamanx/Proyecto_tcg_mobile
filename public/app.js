import { searchCards, suggestLanguage, normalize, printingKey } from './catalog-tools.mjs';

import { compareFoil, openCamera, reflectionPixels, rankCardImages } from './camera.mjs';

const androidOcr = window.CardfolioAndroid;
const nativeShell = location.origin === 'https://appassets.androidplatform.net';
let nativeScanId = 0;
const nativeScans = new Map();
androidOcr?.addEventListener('message', event => {
  const { id, text } = JSON.parse(event.data);
  nativeScans.get(id)?.(text);
});

function readAndroidPhoto(jpeg, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    if (!androidOcr) return reject(Error('Actualiza Android System WebView para escanear fotos.'));
    const id = ++nativeScanId;
    const abort = () => finish(null);
    const timer = setTimeout(abort, 15000);
    function finish(text) {
      nativeScans.delete(id);
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (typeof text === 'string') resolve(text);
      else reject(Error('El escáner Android no pudo leer la foto.'));
    }
    nativeScans.set(id, finish);
    signal.addEventListener('abort', abort, { once: true });
    try {
      androidOcr.postMessage(JSON.stringify({ id, jpeg }));
    } catch {
      finish(null);
    }
  });
}

const cameraDialog = document.querySelector('#camera-dialog');
let stopCamera;
const view = document.querySelector('#view');
const languages = { es: 'Español', en: 'Inglés', ja: 'Japonés', pt: 'Portugués', fr: 'Francés', de: 'Alemán', it: 'Italiano', ko: 'Coreano', zh: 'Chino', other: 'Otro' };
const finishes = { normal: 'Normal', holo: 'Holográfica', reverse: 'Reverse holo', first: '1.ª edición normal', firstHolo: '1.ª edición holo', other: 'Otro acabado' };
const storageKey = 'cardfolio-v1';
let state = { collection: {}, quotes: {} };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved?.collection && saved?.quotes) state = saved;
} catch {
  document.querySelector('.device').textContent = 'Almacenamiento no disponible';
}

let catalogRequest;
function getCatalog() {
  catalogRequest ??= fetch('/catalog.json').then(response => {
    if (!response.ok) throw Error('No se pudo abrir el catálogo.');
    return response.json();
  }).catch(error => {
    catalogRequest = null;
    throw error;
  });
  return catalogRequest;
}

function save(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    state = next;
    return true;
  } catch {
    return false;
  }
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function money(amount, currency) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency, currencyDisplay: 'code' }).format(amount);
}

function options(values) {
  return Object.entries(values).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
}

function heading(title, subtitle) {
  return `<h1 tabindex="-1">${title}</h1><p class="intro">${subtitle}</p>`;
}

function section(title, link = '') {
  return `<div class="section-title"><h2>${title}</h2>${link}</div>`;
}

function collectionRows(rows) {
  return rows.map(([key, item]) => `<article class="collection-item" data-key="${esc(key)}">
    ${item.photo ? `<img class="card-art" src="${esc(item.photo)}" alt="">` : '<span class="mini-icon" aria-hidden="true">▱</span>'}
    <div><strong>${esc(item.name)}</strong><small>${esc(item.edition)} · #${esc(item.number)}</small><small>${languages[item.language]} · ${finishes[item.finish]}</small></div>
    <div class="actions"><div class="count"><button class="button ghost" data-delta="-1" aria-label="Quitar una copia" ${item.quantity === 1 ? 'disabled' : ''}>−</button><b aria-label="Cantidad">${item.quantity}</b><button class="button ghost" data-delta="1" aria-label="Añadir una copia" ${item.quantity === 999 ? 'disabled' : ''}>+</button></div><button class="button ghost danger" data-remove>Eliminar</button></div>
  </article>`).join('');
}

function home() {
  const entries = Object.values(state.collection);
  const count = entries.reduce((total, item) => total + item.quantity, 0);
  view.innerHTML = `<section class="hero">
    <img class="hero-art" src="/hero.webp" alt="">
    <div class="hero-copy"><h1>Tu colección<br>Pokémon TCG</h1><p>Registra tus cartas y consulta su valor de mercado.</p>
    <a class="button primary" href="#registrar"><span aria-hidden="true">＋</span> Registrar carta</a></div>
  </section>
  ${section('Tu colección', '<a href="#coleccion">Ver colección →</a>')}
  <div class="stats">${[
    ['▱', count, 'Cartas registradas'], ['✦', new Set(entries.map(item => item.id)).size, 'Cartas distintas'],
    ['▤', new Set(entries.map(item => item.set)).size, 'Ediciones'],
  ].map(([icon, value, label]) => `<div class="stat"><span class="tile-icon" aria-hidden="true">${icon}</span><div><b>${value}</b><small>${label}</small></div></div>`).join('')}</div>
  ${section('Acciones rápidas')}
  <div class="quick">
    <a href="#registrar"><span class="tile-icon" aria-hidden="true">▧</span><div><strong>Registrar carta</strong><small>Identifica una carta con tu cámara</small></div><span class="arrow" aria-hidden="true">→</span></a>
    <a href="#mercado"><span class="tile-icon" aria-hidden="true">⌕</span><div><strong>Consultar carta</strong><small>Revisa tu álbum y precios</small></div><span class="arrow" aria-hidden="true">→</span></a>
  </div>
  ${section('Añadidas recientemente')}
  ${entries.length ? `<div class="collection-grid">${collectionRows(Object.entries(state.collection).slice(-3).reverse())}</div>` : '<div class="empty">Las cartas que registres aparecerán aquí.</div>'}
  <p class="feedback" role="status"></p>`;
  attachCollectionActions(home);
}

function collection() {
  view.innerHTML = heading('Mi colección', 'Revisa tus cartas por edición, idioma y acabado.') +
    '<div class="page-actions"><a class="button primary" href="#registrar">＋ Registrar carta</a></div><label class="collection-filter">Filtrar colección<input type="search" placeholder="Nombre, edición, número o idioma"></label><div class="collection-grid"></div><p class="feedback" role="status"></p>';
  const grid = view.querySelector('.collection-grid');
  const filter = view.querySelector('input');
  function list() {
    const term = normalize(filter.value);
    const matches = Object.entries(state.collection).filter(([, item]) =>
      normalize([item.name, item.edition, item.number, languages[item.language], finishes[item.finish]].join(' ')).includes(term));
    grid.innerHTML = collectionRows(matches.reverse()) || `<div class="empty">${term ? 'No hay cartas que coincidan.' : 'Aún no tienes cartas registradas.'}</div>`;
  }
  filter.addEventListener('input', list);
  list();
  attachCollectionActions(list);
}

function attachCollectionActions(refresh) {
  for (const grid of view.querySelectorAll('.collection-grid')) {
    grid.onclick = event => {
      const button = event.target.closest('button');
      const row = button?.closest('[data-key]');
      if (!row) return;
      const key = row.dataset.key;
      const current = state.collection[key];
      const collection = { ...state.collection };
      if (button.hasAttribute('data-remove')) {
        if (!confirm(`¿Eliminar ${current.name} de tu colección?`)) return;
        delete collection[key];
      } else {
        collection[key] = { ...current, quantity: Math.min(999, Math.max(1, current.quantity + Number(button.dataset.delta))) };
      }
      if (save({ ...state, collection })) refresh();
      else view.querySelector('.feedback').textContent = 'El dispositivo no pudo guardar el cambio.';
    };
  }
}

async function toPhoto(file) {
  const image = file instanceof HTMLCanvasElement ? file : await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    function make(max, quality) {
      const ratio = Math.min(1, max / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', quality);
    }
    return { full: make(1900, .92), thumb: make(280, .72) };
  } finally {
    image.close?.();
  }
}

function finder(mode) {
  const register = mode === 'registrar';
  view.innerHTML = heading(register ? 'Registrar carta' : 'Consultar carta', register
    ? 'Añade una carta a tu colección con el idioma y acabado de tu copia.'
    : 'Comprueba si ya tienes esa versión y compara referencias en CLP y USD.');
  view.append(document.querySelector('#finder').content.cloneNode(true));
  const root = view.querySelector('.finder');
  const query = root.querySelector('.query');
  const sets = root.querySelector('.sets');
  const results = root.querySelector('.results');
  const selection = root.querySelector('.selection');
  const notice = root.querySelector('.catalog-status');
  const scanResult = root.querySelector('.scan-result');
  const scanStatus = root.querySelector('.scan-status');
  let catalog;
  let photo;
  let scannedText = '';
  let scanSequence = 0;
  let liveSignature = '';
  let liveRepeats = 0;
  let liveRanked = [];

  async function load() {
    if (catalog) return catalog;
    notice.hidden = false;
    notice.textContent = 'Cargando catálogo…';
    try {
      catalog = await getCatalog();
      sets.innerHTML = '<option value="">Todas las ediciones</option>' + Object.entries(catalog.sets)
        .sort(([, a], [, b]) => a[0].localeCompare(b[0])).map(([id, [name]]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
      notice.hidden = true;
      return catalog;
    } catch {
      notice.textContent = 'No se pudo cargar el catálogo. Vuelve a intentar la búsqueda.';
      return null;
    }
  }

  function show(matches, empty) {
    selectedCard = undefined;
    selection.replaceChildren();
    results.replaceChildren();
    if (!matches.length) {
      results.innerHTML = `<p class="result-note" role="status">${empty}</p>`;
      return;
    }
    for (const card of matches) {
      const [, name, set, number] = card;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'card-option';
      const imageUrl = '/api/card-image?' + new URLSearchParams({ set, number });
      button.innerHTML = `<img class="card-option-art" src="${esc(imageUrl)}" alt="Referencia de ${esc(name)}" loading="lazy"><span><strong>${esc(name)}</strong><small>${esc(catalog.sets[set][0])} · #${esc(number)}</small><small>Confirma que coincide con la imagen de referencia</small></span>`;
      button.querySelector('img').onerror = event => { event.currentTarget.hidden = true; };
      button.onclick = () => select(card);
      results.append(button);
    }
  }

  root.querySelector('.search-form').onsubmit = async event => {
    event.preventDefault();
    scanSequence += 1;
    if (!scanResult.hidden) scanStatus.textContent = 'Foto adjunta. Elige la carta correcta en los resultados.';
    if (!await load()) return;
    scanRequest?.abort();
    const term = query.value.trim();
    show(searchCards(catalog, term, sets.value), term || sets.value
      ? 'No encontramos coincidencias. Revisa el número o prueba con el nombre.'
      : 'Escribe el nombre o número, o elige una edición.');
  };

  const foilButton = root.querySelector('.foil-camera');
  const foilStatus = root.querySelector('.foil-status');
  let reflection;
  let foil = '';
  let selectedCard;
  let scanRequest;
  const guided = Boolean(navigator.mediaDevices?.getUserMedia && cameraDialog.showModal);

  function capture(hint, onCapture, onFrame) {
    stopCamera = openCamera(cameraDialog, hint, onCapture, onFrame);
  }

  root.querySelector('.guided-camera').onclick = () => {
    if (!guided) return root.querySelector('.camera').click();
    liveSignature = '';
    liveRepeats = 0;
    liveRanked = [];
    scanResult.hidden = false;
    scanStatus.textContent = 'Busca el número de la carta y la edición en tiempo real.';
    capture('Encuadra la carta. Buscando número y edición…', canvas => readPhoto(canvas, true), readLiveFrame);
  };

  foilButton.onclick = () => {
    capture('Inclina un poco la carta hacia una luz difusa. Mantén sus bordes cerca del marco.', canvas => {
      foil = compareFoil(reflection, reflectionPixels(canvas));
      foilStatus.hidden = false;
      foilStatus.textContent = foil
        ? 'Reflejo compatible con ' + finishes[foil].toLowerCase() + '. Confirma el acabado con la carta.'
        : 'El reflejo no fue concluyente. Puedes repetir la captura o elegir el acabado manualmente.';
      if (selectedCard) {
        const listed = selectedCard[5] || [];
        const field = selection.querySelector('[name=finish]');
        if (foil && !field.value && listed.includes(foil)) {
          field.value = foil;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
  };

  async function recognize(jpeg, signal, footer = false) {
    if (nativeShell) return readAndroidPhoto(jpeg, signal);
    const body = await (await fetch(jpeg)).blob();
    const reply = await fetch('/api/scan' + (footer ? '?region=footer' : ''), {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body, signal,
    });
    if (!reply.ok) throw Error();
    return (await reply.json()).text;
  }

  async function readLiveFrame(frame) {
    if (!await load() || !root.isConnected) return;
    const footer = document.createElement('canvas');
    const height = Math.round(frame.height * .22);
    const width = Math.round(frame.width * .96);
    footer.width = Math.min(width * 2, 1400);
    footer.height = Math.max(1, Math.round(footer.width * height / width));
    const context = footer.getContext('2d');
    context.filter = 'grayscale(1) contrast(1.35) brightness(1.04)';
    context.drawImage(frame, Math.round(frame.width * .02), frame.height - height,
      width, height, 0, 0, footer.width, footer.height);
    const controller = new AbortController();
    const text = await recognize(footer.toDataURL('image/jpeg', .9), controller.signal, true);
    if (!cameraDialog.open || !root.isConnected) return;
    let matches = searchCards(catalog, text, '', true);
    if (!matches.length) {
      liveSignature = '';
      liveRepeats = 0;
      liveRanked = [];
      cameraDialog.querySelector('.camera-status').textContent = 'Leyendo el número de colección y la edición…';
      return;
    }
    const signature = matches.slice(0, 3).map(card => card[0]).join('|');
    const repeated = signature === liveSignature;
    liveRepeats = repeated ? liveRepeats + 1 : 1;
    if (!repeated) liveRanked = [];
    liveSignature = signature;
    if (liveRepeats < 2) {
      cameraDialog.querySelector('.camera-status').textContent = 'Posible número detectado. Mantén la carta quieta…';
      return;
    }
    scannedText = text;
    if (liveRepeats === 2) liveRanked = await rankCardImages(frame, matches);
    if (!cameraDialog.open || !root.isConnected) return;
    if (liveRanked.length) matches = liveRanked;
    const [id, name, set, number] = matches[0];
    cameraDialog.querySelector('.camera-status').textContent =
      'Coincidencia: ' + name + ' · ' + catalog.sets[set][0] + ' · #' + number + '. Toca capturar para confirmar.';
    scanStatus.textContent = 'Encontramos una posible carta. Captúrala y confirma la edición, número, idioma y acabado.';
    if (liveRepeats === 2) show(matches, 'No encontramos otras coincidencias.');
  }

  async function readPhoto(file, framed = false) {
    const seq = ++scanSequence;
    scanRequest?.abort();
    scanRequest = new AbortController();
    const { signal } = scanRequest;
    selection.replaceChildren();
    results.replaceChildren();
    selectedCard = undefined;
    photo = undefined;
    scannedText = '';
    foil = '';
    reflection = framed ? reflectionPixels(file) : undefined;
    foilButton.hidden = !reflection;
    foilStatus.hidden = true;
    scanResult.hidden = false;
    const image = scanResult.querySelector('img');
    image.hidden = true;
    scanStatus.textContent = 'Leyendo el texto de la foto…';
    try {
      const converted = await toPhoto(file);
      if (seq !== scanSequence || !root.isConnected) return;
      photo = converted.thumb;
      image.src = photo;
      image.hidden = false;
      const reads = [recognize(converted.full, signal)];
      if (framed) {
        const footer = document.createElement('canvas');
        const height = Math.round(file.height * .21);
        const width = Math.round(file.width * .96);
        footer.width = Math.min(width * 2, 1600);
        footer.height = Math.round(footer.width * height / width);
        const context = footer.getContext('2d');
        context.filter = 'grayscale(1) contrast(1.3)';
        context.drawImage(file, Math.round(file.width * .02), file.height - height,
          width, height, 0, 0, footer.width, footer.height);
        reads.push(recognize(footer.toDataURL('image/jpeg', .93), signal, true));
      }
      const scans = await Promise.allSettled(reads);
      if (!await load() || seq !== scanSequence || !root.isConnected) return;
      const successful = scans.filter(scan => scan.status === 'fulfilled');
      if (!successful.length) throw Error();
      scannedText = successful.map(scan => scan.value).join('\n');
      let matches = searchCards(catalog, scannedText, '', true);
      if (framed && matches.length) matches = await rankCardImages(file, matches);
      if (seq !== scanSequence || !root.isConnected) return;
      scanStatus.textContent = matches.length
        ? 'Elige la coincidencia correcta y revisa el idioma y acabado.'
        : 'No encontramos una coincidencia en la foto. Prueba por nombre, edición o número.';
      show(matches, 'La búsqueda manual sigue disponible.');
    } catch {
      if (seq === scanSequence && root.isConnected) scanStatus.textContent = 'No pudimos leer la foto. Puedes buscar por edición y número.';
    }
  }

  for (const input of root.querySelectorAll('input[type=file]')) {
    input.onchange = () => {
      const file = input.files[0];
      input.value = '';
      if (file) readPhoto(file);
    };
  }

  function select(card) {
    selectedCard = card;
    const [id, name, set, number, rarity, listedFinishes = []] = card;
    const [edition, , setCode] = catalog.sets[set];
    const language = suggestLanguage(scannedText, setCode);
    const visualFinish = listedFinishes.includes(foil) ? foil : '';
    const catalogFinish = listedFinishes.length === 1 && listedFinishes[0] !== 'other' ? listedFinishes[0] : '';
    const hints = [];
    if (language) hints.push('La foto sugiere ' + languages[language].toLowerCase() + '.');
    if (visualFinish) hints.push('Reflejo compatible con ' + finishes[visualFinish].toLowerCase() + '.');
    else if (catalogFinish) hints.push('Acabado según el catálogo: ' + finishes[catalogFinish].toLowerCase() + '.');
    if (listedFinishes.length > 1) {
      hints.push('Versiones en el catálogo: ' + listedFinishes.map(value => finishes[value].toLowerCase()).join(', ') + '.');
    }
    const image = `/api/card-image?${new URLSearchParams({ set, number })}`;
    selection.innerHTML = `<div class="card-heading"><img class="card-art" src="${esc(image)}" alt=""><div><h3 tabindex="-1">${esc(name)}</h3><p>${esc(edition)} · #${esc(number)}${rarity ? ' · ' + esc(rarity) : ''}</p></div></div>
      <form><div class="fields">
      <label>Idioma<select name="language" required><option value="">Selecciona</option>${options(languages)}</select></label>
      <label>Acabado<select name="finish" required><option value="">Selecciona</option>${options(finishes)}</select></label>
      ${register ? '<label>Cantidad<input name="quantity" type="number" min="1" max="999" value="1" required></label>' : ''}
      </div><p>${hints.join(' ')} Confirma el idioma y el acabado con tu carta.</p>
      <div class="row"><button class="button primary">${register ? 'Guardar en mi colección' : 'Ver colección y precios'}</button></div>
      </form><p class="feedback" role="status"></p><div class="market"></div>`;
    const art = selection.querySelector('img');
    art.onerror = () => { art.hidden = true; };
    const form = selection.querySelector('form');
    form.language.value = language;
    form.finish.value = visualFinish || catalogFinish;
    const feedback = selection.querySelector('.feedback');
    const market = selection.querySelector('.market');
    form.oninput = () => {
      market.replaceChildren();
      feedback.textContent = '';
    };
    form.onsubmit = event => {
      event.preventDefault();
      const { language, finish, quantity } = Object.fromEntries(new FormData(form));
      const key = printingKey(id, language, finish);
      const current = state.collection[key];
      if (register) {
        const total = (current?.quantity || 0) + Number(quantity);
        if (total > 999) {
          feedback.textContent = 'Puedes guardar hasta 999 copias de esta versión.';
          return;
        }
        const item = { id, name, set, edition, number, language, finish, quantity: total, photo: photo || current?.photo };
        feedback.textContent = save({ ...state, collection: { ...state.collection, [key]: item } })
          ? `Guardada. Tienes ${total} ${total === 1 ? 'copia' : 'copias'} de esta versión.`
          : 'No se pudo guardar. Puede que el almacenamiento esté lleno.';
      } else {
        feedback.textContent = current ? `En tu colección · ${current.quantity} ${current.quantity === 1 ? 'copia' : 'copias'} de esta versión.`
          : 'Esta versión aún no está en tu colección.';
        showMarket(market, key, { id, name, edition, number, language, finish });
      }
    };
    selection.querySelector('h3').focus();
  }

  load();
}

async function showMarket(target, key, card) {
  const search = encodeURIComponent(`${card.name} ${card.number}`);
  const box = document.createElement('section');
  box.className = 'market-box';
  box.innerHTML = `<h3>Referencias de mercado</h3>
    <p>${languages[card.language]} · ${finishes[card.finish]}</p>
    <p><strong>Internacional · TCGplayer</strong></p>
    <p class="usd" role="status">Consultando precio en USD…</p>
    <div class="market-links">
      <a class="tcgplayer" href="https://www.tcgplayer.com/search/pokemon/product?q=${search}" target="_blank" rel="noopener noreferrer">Buscar en TCGplayer ↗</a>
      <a class="cardmarket" href="https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${search}" target="_blank" rel="noopener noreferrer">Buscar en Cardmarket ↗</a>
    </div>
    <form class="quotes-form"><p><strong>Chile · CLP</strong></p>
      <p class="clp" role="status"></p>
      <div class="market-links"><a href="https://tcgmatch.cl/" target="_blank" rel="noopener noreferrer">Abrir TCGMatch Chile ↗</a></div>
      <div class="fields">
        <label>Precio observado en CLP<input name="amount" type="number" min="1" max="999999999" step="1" placeholder="Ej. 12500" required></label>
        <label>Fuente<input name="source" value="TCGMatch" required maxlength="60"></label>
      </div><button class="button secondary">Guardar referencia local</button>
    </form>`;
  target.replaceChildren(box);
  const clp = box.querySelector('.clp');
  const usd = box.querySelector('.usd');
  const form = box.querySelector('form');
  function renderQuote() {
    const quote = state.quotes[key];
    clp.textContent = quote
      ? `${money(quote.amount, 'CLP')} · ${quote.source} · Registrada el ${new Date(quote.date).toLocaleDateString('es-CL')}`
      : 'Puedes guardar el precio publicado que observes para esta versión.';
  }
  renderQuote();
  form.onsubmit = event => {
    event.preventDefault();
    const data = new FormData(form);
    const source = data.get('source').trim();
    if (!source) {
      clp.textContent = 'Escribe el nombre de la fuente.';
      return;
    }
    const quote = { amount: Number(data.get('amount')), source, date: new Date().toISOString() };
    if (save({ ...state, quotes: { ...state.quotes, [key]: quote } })) {
      renderQuote();
      form.elements.amount.value = '';
    } else {
      clp.textContent = 'El dispositivo no pudo guardar la referencia.';
    }
  };
  if (card.language !== 'en' || card.finish === 'other') {
    usd.textContent = 'Sin cotización automática para este idioma o acabado. Puedes comparar buscando en las fuentes.';
    return;
  }
  try {
    const reply = await fetch('/api/market?' + new URLSearchParams(card));
    const value = await reply.json();
    if (!reply.ok) throw Error(value.error);
    usd.textContent = value.amount != null
      ? `${money(value.amount, value.currency)} · TCGdex${value.updated ? ' · ' + value.updated : ''}${value.stale ? ' · dato guardado en caché' : ''}`
      : 'TCGplayer no tiene un precio de mercado disponible para este acabado.';
    for (const [key, allowed] of [['tcgplayer', 'tcgplayer.com'], ['cardmarket', 'cardmarket.com']]) {
      if (!value[key]) continue;
      const url = new URL(value[key]);
      if (url.protocol === 'https:' && (url.hostname === allowed || url.hostname.endsWith('.' + allowed))) {
        box.querySelector('.' + key).href = url.href;
      }
    }
  } catch {
    usd.textContent = 'No se pudo cargar el precio en USD. Prueba de nuevo o revisa las fuentes.';
  }
}

const pages = { inicio: home, coleccion: collection, registrar: () => finder('registrar'), mercado: () => finder('mercado') };
function route() {
  if (cameraDialog.open) {
    stopCamera?.();
    cameraDialog.close();
  }
  const hash = location.hash.slice(1);
  const page = Object.hasOwn(pages, hash) ? hash : 'inicio';
  for (const link of document.querySelectorAll('[data-page]')) {
    const active = link.dataset.page === (page === 'registrar' ? 'coleccion' : page);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  pages[page]();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
window.addEventListener('storage', event => {
  if (event.key !== storageKey) return;
  try {
    state = JSON.parse(event.newValue) || { collection: {}, quotes: {} };
    if (['#coleccion', '#inicio', ''].includes(location.hash)) route();
  } catch {}
});
let installPrompt;
const installButton = document.querySelector('.install-app');
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => { installButton.hidden = true; });
installButton.hidden = nativeShell || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
installButton.onclick = async () => {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = undefined;
    await prompt.prompt();
  } else {
    document.querySelector('#install-dialog').showModal();
  }
};
route();
if (!nativeShell && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
