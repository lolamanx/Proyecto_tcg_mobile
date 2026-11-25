function addJapanesePromos(cards) {
  for (let n = 293; n <= 296; n++) {
    const number = String(n);
    const existing = cards.find(c => c.language === 'ja' && /xy.{0,3}p/i.test(c.setId + ' ' + c.setName) && parseInt(c.number,10) === n);
    const name = (n < 295 ? 'Mario' : 'Luigi') + ' Pikachu';
    if (existing) { existing.exclusiveLanguage = 'ja'; existing.name += ' · ' + name; }
    else cards.push({id:'jp:xyp:'+number, name, number, total:'XY-P', setName:'XY-P Promos', setId:'xy-p', language:'ja',exclusiveLanguage:'ja', image:''});
  }
}
const root = 'https://raw.githubusercontent.com/lolamanx/Proyecto_tcg_mobile/main/data/90f27d0/';
export async function loadCatalog() {
  async function read(path) {
    let response;
    try { response = await fetch('/data/90f27d0/' + path); } catch {}
    if (!response?.ok) response = await fetch(root + path);
    if (!response.ok) throw new Error('Catálogo temporalmente inaccesible');
    return response.json();
  }
  const shards = await read('index.json');
  const groups = (await Promise.all(shards.map(read))).flat();
  const symbols = await fetch('/edition-symbols.json').then(r => r.json()).catch(() => ({}));
  const profiles = await fetch('/edition-profiles.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const cards = groups.flatMap(([setId,setName,total,code,rows]) => rows.map(([id,name,number,image]) =>
    ({id,name,number,image,setId,setName,code, symbol: symbols[setId], printedCode: profiles[setId]?.code,
      total: /^(TG|GG|RC|SV)\d+$/i.test(number) && rows.every(row => row[2].startsWith(number.match(/^[A-Z]+/i)[0]))
        ? number.match(/^[A-Z]+/i)[0] + total : total})));
  addJapanesePromos(cards);
  return {cards, editions: groups.length+1};
}

// TCGdex card IDs end with "-" followed by the exact local collector number.
export async function loadLiveCatalog(language) {
  const base = 'https://api.tcgdex.net/v2/' + encodeURIComponent(language) + '/';
  async function list(path) {
    const response = await fetch(base + path);
    if (!response.ok) throw new Error('No se pudo consultar TCGdex');
    const items = await response.json();
    if (!Array.isArray(items) || !items.length) throw new Error('Catálogo vacío');
    return items;
  }
  const [sets, briefs] = await Promise.all([list('sets'), list('cards')]);
  const byId = new Map(sets.map(set => [set.id, set]));
  const editions = new Set();
  const cards = [];
  for (const brief of briefs) {
    if (!brief.localId || !brief.id.endsWith('-' + brief.localId)) continue;
    const setId = brief.id.slice(0, -(brief.localId.length + 1));
    const set = byId.get(setId);
    if (!set || /\/tcgp\//i.test(brief.image || set.logo || '')) continue;
    editions.add(setId);
    cards.push({
      id: 'tcgdex:' + language + ':' + brief.id, name: brief.name, setId, setName: set.name,
      number: brief.localId, total: set.cardCount?.official || '—',
      image: brief.image ? brief.image + '/high.webp' : '',
      symbol: set.symbol ? set.symbol + '.webp' : '', language,
    });
  }
  if (!cards.length) throw new Error('Sin cartas');
  if (language === 'ja') addJapanesePromos(cards);
  return {cards, editions: editions.size};
}
