import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { it } from 'vitest';
import { grayToRGBA, ocrVariants, prepareTicket, type Gray } from '../../src/core/imageOps';
import { loadImage } from './harness';

const save = (g: Gray, f: string) => { const r = grayToRGBA(g); writeFileSync(f, jpeg.encode({ width: r.width, height: r.height, data: Buffer.from(r.data) }, 90).data); };
it('dump', () => {
  for (const name of (process.env.DUMP ?? 'henry-desbotada').split(',')) {
    const p = prepareTicket(loadImage(resolve(import.meta.dirname, `${name}.jpg`)));
    save(p.gray, `/tmp/${name}-prep.jpg`);
    ocrVariants(p.gray).forEach((v, i) => save(v.image, `/tmp/${name}-v${i}.jpg`));
  }
});
