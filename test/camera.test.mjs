import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFoil } from '../public/camera.mjs';

function sample(zone) {
  const pixels = new Uint8ClampedArray(96 * 134 * 4);
  for (let y = 0; y < 134; y++) {
    for (let x = 0; x < 96; x++) {
      const base = x % 12 < 6 ? 78 : 128;
      const lit = zone === 'art' && y > 30 && y < 68 || zone === 'body' && y > 82 && y < 111;
      const color = zone === 'glare' ? [255, 255, 255] : lit ? [base + 86, base + 26, base + 3] : [base, base, base];
      pixels.set([...color, 255], (y * 96 + x) * 4);
    }
  }
  return pixels;
}

test('suggests a finish from localized color changes in aligned frames', () => {
  assert.equal(compareFoil(sample(), sample('art')), 'holo');
  assert.equal(compareFoil(sample(), sample('body')), 'reverse');
});

test('abstains with unchanged frames or broad white glare', () => {
  assert.equal(compareFoil(sample(), sample()), '');
  assert.equal(compareFoil(sample(), sample('glare')), '');
});
