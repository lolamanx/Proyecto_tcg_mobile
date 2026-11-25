const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const cleanNumber = value => String(value ?? '').toUpperCase().replace(/^0+(?=\d)/, '');
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function numericHypothesis(token) {
  const upper = token.toUpperCase();
  if (!/^[0-9OQDIILSZGB]+$/.test(upper)) return { value: cleanNumber(upper), penalty: /\d/.test(upper) ? 1 : 0 };
  const swaps = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', Z: '2', G: '6', B: '8' };
  let corrections = 0;
  const value = cleanNumber([...upper].map(char => {
    if (!swaps[char]) return char;
    corrections++;
    return swaps[char];
  }).join(''));
  return { value, penalty: Math.max(.62, 1 - corrections * .11) };
}

function parsePairs(text) {
  const pairs = [];
  const pattern = /([A-Z0-9]{1,6})\s*[\/|\\]\s*([A-Z0-9]{1,5})/gi;
  for (const match of String(text ?? '').toUpperCase().matchAll(pattern)) {
    const number = numericHypothesis(match[1]);
    const total = numericHypothesis(match[2]);
    const pair = { number: number.value, total: total.value, weight: Math.min(number.penalty, total.penalty) };
    if (!pairs.some(item => item.number === pair.number && item.total === pair.total)) pairs.push(pair);
  }
  return pairs;
}

function editSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.abs(a.length - b.length) > 3) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let col = 1; col <= b.length; col++) {
      current[col] = Math.min(current[col - 1] + 1, previous[col] + 1, previous[col - 1] + (a[row - 1] === b[col - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function phraseSimilarity(expected, text) {
  const phrase = normalize(expected);
  const body = normalize(text).replace(/[^\p{L}\d]+/gu, ' ').trim();
  if (!phrase || !body) return 0;
  if (body.includes(phrase)) return 1;
  const wanted = phrase.split(/\s+/).filter(Boolean);
  const words = body.split(/\s+/).filter(Boolean);
  const matched = wanted.map(token => {
    if (words.includes(token)) return 1;
    if (token.length < 4) return 0;
    return Math.max(0, ...words.filter(word => Math.abs(word.length - token.length) <= 2).map(word => editSimilarity(token, word)));
  });
  return matched.reduce((sum, value) => sum + value, 0) / wanted.length;
}

function manualSearchScore(card, query) {
  const input = normalize(query);
  const pair = parsePairs(input)[0];
  const number = cleanNumber(card.number);
  const total = cleanNumber(card.total);
  const name = normalize(card.name);
  const set = normalize(card.setName);
  if (pair) return pair.number === number && pair.total === total ? 1 : 0;
  if (/\d/.test(input) && /^#?\s*[\da-z]{1,6}$/i.test(input)) return number === cleanNumber(input.replace(/^#/, '')) ? .78 : 0;
  const tokens = input.split(/[^\p{L}\d]+/u).filter(token => token.length > 1);
  if (!tokens.length) return 0;
  const haystack = normalize(`${card.name} ${card.setName} ${card.number}/${card.total} ${card.setId ?? ''}`);
  if (!tokens.every(token => haystack.includes(token))) return 0;
  return input === name ? .92 : name.startsWith(input) ? .82 : set.includes(input) ? .76 : .68;
}

export function rankCardCandidates(catalog, text, { manual = false, ocrConfidence = 65, qualityPenalty = 0 } = {}) {
  const input = normalize(text);
  if (!input) return [];
  if (manual) return catalog.cards.map(card => ({ card, score: manualSearchScore(card, input), signals: ['texto'], visualScore: null }))
    .filter(result => result.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);

  const pairs = parsePairs(input);
  const confidence = Number.isFinite(Number(ocrConfidence)) ? Number(ocrConfidence) : 65;
  const ocrFactor = .88 + .12 * clamp(confidence / 100);
  const imageFactor = 1 - clamp(qualityPenalty, 0, .25);
  const names = new Map(), sets = new Map();
  const tokens = new Set(input.split(/[^a-z0-9]+/).map(cleanNumber));
  const results = [];
  for (const card of catalog.cards) {
    const number = cleanNumber(card.number);
    const total = cleanNumber(card.total);
    let pairQuality = 0;
    for (const pair of pairs) {
      if (pair.number === number && pair.total === total) pairQuality = Math.max(pairQuality, pair.weight);
    }
    if (!names.has(card.name)) names.set(card.name, phraseSimilarity(card.name, input));
    const name = names.get(card.name);
    if (!sets.has(card.setId)) sets.set(card.setId, phraseSimilarity(card.setName, input));
    const set = sets.get(card.setId);
    const codeRead = card.code && tokens.has(card.code.toUpperCase());
    const numberMentioned = tokens.has(number);
    let score = 0;
    const signals = [];
    if (pairQuality) { score += .56 * pairQuality; signals.push('número y total'); }
    else if (numberMentioned) { score += .28; signals.push('número'); }
    if (name >= .72) { score += .31 * name; signals.push(name === 1 ? 'nombre' : 'nombre aproximado'); }
    if (set >= .78) { score += .13 * set; signals.push('edición'); }
    if (codeRead && (pairQuality || numberMentioned || name >= .72)) { score += card.printedCode ? .22 : .08; signals.push('código de edición'); }
    if (pairs.some(pair => pair.weight === 1) && !pairQuality) score *= .35;
    if (!score) continue;
    score = clamp(score * ocrFactor * imageFactor);
    results.push({ card, score, signals, visualScore: null });
  }
  return results.sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name)).slice(0, 12);
}

function gridDescriptor(canvas, region) {
  const sample = document.createElement('canvas');
  sample.width = 6;
  sample.height = 6;
  const context = sample.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  const [x, y, width, height] = region;
  context.drawImage(canvas, x, y, width, height, 0, 0, 6, 6);
  const pixels = context.getImageData(0, 0, 6, 6).data;
  const channels = [[], [], []];
  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) channels[channel].push(pixels[index + channel]);
  }
  const descriptor = [];
  for (const values of channels) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    const scale = Math.max(deviation, 12);
    descriptor.push(...values.map(value => Math.round(clamp((value - mean) / scale * 38 + 128, 0, 255))));
  }
  return descriptor;
}

export function describeCardImage(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  return {
    full: gridDescriptor(canvas, [0, 0, width, height]),
    art: gridDescriptor(canvas, [width * .09, height * .19, width * .82, height * .43]),
  };
}

function descriptorDistance(first, second) {
  let total = 0;
  for (let index = 0; index < first.length; index++) total += Math.abs(first[index] - second[index]);
  return total / first.length;
}

function visualSimilarity(first, second) {
  const artDistance = descriptorDistance(first.art, second.art);
  const fullDistance = descriptorDistance(first.full, second.full);
  const art = clamp(1 - artDistance / 86);
  const full = clamp(1 - fullDistance / 100);
  return .72 * art + .28 * full;
}

export function assessCardImage(canvas) {
  const sample = document.createElement('canvas');
  sample.width = 72;
  sample.height = 100;
  const context = sample.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  let clipped = 0;
  let dark = 0;
  let sum = 0;
  let square = 0;
  const gray = new Float32Array(sample.width * sample.height);
  for (let i = 0, pixel = 0; i < pixels.length; i += 4, pixel++) {
    const value = .299 * pixels[i] + .587 * pixels[i + 1] + .114 * pixels[i + 2];
    gray[pixel] = value;
    sum += value;
    square += value * value;
    if (value > 247) clipped++;
    if (value < 12) dark++;
  }
  let laplace = 0;
  let laplaceSquare = 0;
  let count = 0;
  for (let y = 1; y < sample.height - 1; y++) for (let x = 1; x < sample.width - 1; x++) {
    const i = y * sample.width + x;
    const value = gray[i - 1] + gray[i + 1] + gray[i - sample.width] + gray[i + sample.width] - 4 * gray[i];
    laplace += value;
    laplaceSquare += value * value;
    count++;
  }
  const average = sum / gray.length;
  const contrast = Math.sqrt(Math.max(0, square / gray.length - average * average));
  const sharpness = Math.max(0, laplaceSquare / count - (laplace / count) ** 2);
  const glare = clipped / gray.length;
  const penalty = Math.min(.22, Math.max(0, glare - .035) * 1.2 + (contrast < 22 ? .06 : 0));
  return { glare, dark: dark / gray.length, contrast, sharpness, penalty };
}

export async function rankWithCardImage(frame, candidates, loadReference) {
  if (!candidates.length) return candidates;
  const source = describeCardImage(frame);
  const shortlist = candidates.slice(0, 10);
  const visual = await Promise.all(shortlist.map(async entry => {
    try {
      const reference = await loadReference(entry.card);
      const score = visualSimilarity(source, describeCardImage(reference));
      return { ...entry, visualScore: score };
    } catch {
      return entry;
    }
  }));
  const available = visual.filter(entry => Number.isFinite(entry.visualScore));
  if (!available.length) return candidates;
  const bestVisual = Math.max(...available.map(entry => entry.visualScore));
  const ranked = visual.map(entry => Number.isFinite(entry.visualScore) && bestVisual >= .48
    ? { ...entry, score: .72 * entry.score + .28 * entry.visualScore, signals: [...entry.signals, 'imagen'] }
    : entry);
  ranked.sort((a, b) => b.score - a.score);
  return ranked.concat(candidates.slice(shortlist.length));
}

export function consensusCandidates(history, ranked) {
  history.push(ranked.slice(0, 8));
  if (history.length > 3) history.shift();
  const totals = new Map();
  for (const pass of history) for (const result of pass) {
    const current = totals.get(result.card.id) || { ...result, count: 0, scoreSum: 0 };
    current.count++;
    current.scoreSum += result.score;
    if ((result.visualScore ?? -1) > (current.visualScore ?? -1)) current.visualScore = result.visualScore;
    current.signals = [...new Set([...current.signals, ...result.signals])];
    totals.set(result.card.id, current);
  }
  return [...totals.values()].filter(result => result.count >= 2)
    .map(result => ({ ...result, score: result.scoreSum / result.count }))
    .sort((a, b) => b.score - a.score).slice(0, 10);
}
