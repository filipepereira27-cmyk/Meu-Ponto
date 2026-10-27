import { readdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { measureQuality } from '../../src/core/quality';
import { loadImage } from './harness';

it('qualidade', () => {
  const dir = process.env.QDIR ?? '/tmp/qual';
  const rows = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => {
    const m = measureQuality(loadImage(`${dir}/${f}`));
    return `${f.padEnd(40)} nitidez=${m.sharpness.toFixed(3)} brilho=${m.paperBrightness} estouro=${m.clipped} largura=${m.paperWidth} papel=${m.paperFound}`;
  });
  writeFileSync(`${dir}/report.txt`, rows.join('\n'));
});
