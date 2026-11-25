import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchCards, suggestLanguage, printingKey } from '../public/catalog-tools.mjs';

const catalog = JSON.parse(readFileSync(new URL('../public/catalog.json', import.meta.url)));

test('combines OCR title and collector number to identify the set', () => {
  const [first] = searchCards(catalog, 'Umbreon VMAX\nWeakness Resistance Retreat\n215/203', '', true);
  assert.equal(first[0], 'swsh7-215');
  assert.deepEqual(first[5], ['holo']);
});

test('supports localized names and distinguishes an ambiguous finish', () => {
  assert.equal(searchCards(catalog, 'Noctali VMAX', 'swsh7')[0][1], 'Umbreon VMAX');
  const [pinsir] = searchCards(catalog, '001', 'swsh7');
  assert.equal(pinsir[0], 'swsh7-1');
  assert.deepEqual(pinsir[5], ['normal', 'reverse']);
});

test('suggests language only when OCR contains evidence', () => {
  assert.equal(suggestLanguage('Debilidad Resistencia Retirada'), 'es');
  assert.equal(suggestLanguage('Pikachu OBF EN 063/197', 'OBF'), 'en');
  assert.equal(suggestLanguage('Pikachu 063/197'), '');
});

test('separates printings by language and finish', () => {
  const key = printingKey('swsh7-1', 'en', 'normal');
  assert.notEqual(key, printingKey('swsh7-1', 'es', 'normal'));
  assert.notEqual(key, printingKey('swsh7-1', 'en', 'reverse'));
});

test('ranks the collector number from the footer alongside other fractions', () => {
  assert.equal(searchCards(catalog, 'Umbreon VMAX\n10/20\n215 / 203', '', true)[0][0], 'swsh7-215');
});
