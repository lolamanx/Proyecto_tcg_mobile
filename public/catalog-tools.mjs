export const normalize = value => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const numberKey = value => normalize(value).replace(/^([a-z]*)0+(?=\d)/, '$1');

export function searchCards(catalog, query, edition = '', ocr = false) {
  const input = normalize(query);
  const pairs = [...input.matchAll(/\b([a-z]{0,4}\d{1,4}[a-z]?)\s*\/\s*([a-z]{0,4}\d{1,4})\b/g)];
  const single = input.match(/^#?([a-z]{0,4}\d{1,4}[a-z]?)$/)?.[1];
  if (!input && !edition) return [];
  if (ocr && !pairs.length && input.length < 3) return [];
  const wordText = ' ' + input.replace(/[^\p{L}\d]+/gu, ' ') + ' ';
  const candidates = [];
  for (const card of catalog.cards) {
    const [, name, set, number, , , aliases = []] = card;
    if (edition && set !== edition) continue;
    const [setName, total, setCode] = catalog.sets[set];
    const title = normalize(name);
    const cardNumber = numberKey(number);
    const matchingPair = pairs.some(([, numerator, denominator]) => {
      const expectedTotal = numberKey(denominator);
      return cardNumber === numberKey(numerator) && (expectedTotal === numberKey(total) ||
        (/^[a-z]/.test(expectedTotal) && expectedTotal.replace(/\d+$/, '') === cardNumber.replace(/\d+[a-z]?$/, '')));
    });
    let score = matchingPair ? 50 : 0;
    if (!ocr && (pairs.length || single)) {
      if (!matchingPair && cardNumber !== numberKey(single || '')) continue;
      score = 50;
    }
    if (ocr) {
      const matchingTitles = [title, ...aliases.map(normalize)].map(value => value.replace(/[^\p{L}\d]+/gu, ' ').trim())
        .filter(value => value.length >= 3 && wordText.includes(' ' + value + ' '));
      if (matchingTitles.length) score += 20 + Math.min(Math.max(...matchingTitles.map(value => value.length)), 25);
      if (setCode && wordText.includes(' ' + normalize(setCode) + ' ')) score += 22;
      if (wordText.includes(' ' + normalize(setName) + ' ')) score += 18;
    } else if (input && !pairs.length && !single) {
      const searchable = normalize([name, setName, setCode, number, ...aliases].join(' '));
      if (!input.split(/\s+/).every(token => searchable.includes(token))) continue;
      score = title === input ? 50 : title.startsWith(input) ? 30 : 10;
    }
    if (score || (!input && edition)) candidates.push({ card, score });
  }
  return candidates.sort((a, b) => b.score - a.score ||
    catalog.sets[b.card[2]][3].localeCompare(catalog.sets[a.card[2]][3])).slice(0, 30).map(item => item.card);
}

export function suggestLanguage(text, setCode = '') {
  const value = normalize(text);
  if (/^[a-z\d]+$/i.test(setCode)) {
    const code = value.match(new RegExp('\\b' + normalize(setCode) + '\\s+(en|es|fr|de|it|pt)\\b'));
    if (code) return code[1];
  }
  const markers = {
    es: /\b(?:debilidad|resistencia|retirada|energia|habilidad|descarta)\b/g,
    en: /\b(?:weakness|resistance|retreat|energy|ability|discard)\b/g,
    fr: /\b(?:faiblesse|retraite|energie|defaussez)\b/g,
    de: /\b(?:schwache|ruckzug|energie|fahigkeit)\b/g,
    it: /\b(?:debolezza|resistenza|ritirata|scarta)\b/g,
    pt: /\b(?:fraqueza|recuo|energia|habilidade)\b/g,
  };
  const scores = Object.entries(markers).map(([lang, rx]) => [lang, new Set(value.match(rx) || []).size])
    .sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 2 && scores[0][1] > scores[1][1] ? scores[0][0] : '';
}

export const printingKey = (id, language, finish) => JSON.stringify([id, language, finish]);
