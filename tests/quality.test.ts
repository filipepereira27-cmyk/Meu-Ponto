import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boxBlur3, grayToRGBA, resize, toGray, type RGBA } from '../src/core/imageOps';
import { assessQuality } from '../src/core/quality';
import { loadImage } from './benchmark/harness';

const load = (n: string) => loadImage(resolve(import.meta.dirname, 'benchmark', `${n}.jpg`));
function blurred(img: RGBA, passes: number): RGBA {
  let g = toGray(img);
  for (let i = 0; i < passes; i++) g = boxBlur3(g);
  return grayToRGBA(g);
}
function darkened(img: RGBA, f: number): RGBA {
  return { ...img, data: img.data.map((v, i) => (i % 4 === 3 ? v : v * f)) };
}

describe('qualidade da foto', () => {
  it('fotos boas, inclinadas e desbotadas não são bloqueadas', () => {
    for (const n of ['henry-boa', 'repp-inclinada', 'controlid-boa', 'nsrlinha-desbotada']) {
      expect(assessQuality(load(n)).level, n).not.toBe('bad');
    }
    expect(assessQuality(load('henry-boa')).level).toBe('ok');
  });
  it('foto muito tremida é apontada', () => {
    const r = assessQuality(blurred(load('henry-boa'), 60));
    expect(r.level).toBe('bad');
    expect(r.issues[0].code).toBe('blur');
  });
  it('foto extremamente escura é apontada', () => {
    expect(assessQuality(darkened(load('repp-boa'), 0.1)).issues.map((i) => i.code)).toContain('dark');
  });
  it('ticket muito pequeno na foto é apontado', () => {
    const img = load('repp-boa');
    const g = resize(toGray(img), Math.round(img.width / 4), Math.round(img.height / 4));
    expect(assessQuality(grayToRGBA(g)).issues.map((i) => i.code)).toContain('small');
  });
});
