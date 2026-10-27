import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { ocrVariants, prepareTicket } from '../../src/core/imageOps';
import { loadImage, makeWorker, recognizer } from './harness';

it('lines', async () => {
  const out = '/tmp/lines.txt';
  writeFileSync(out, '');
  const w = await makeWorker();
  const rec = recognizer(w);
  for (const name of (process.env.DUMP ?? '').split(',')) {
    const p = prepareTicket(loadImage(resolve(import.meta.dirname, `${name}.jpg`)));
    for (const v of ocrVariants(p.gray)) {
      appendFileSync(out, `== ${name} ${v.name}\n`);
      for (const l of await rec(v.image)) appendFileSync(out, `${Math.round(l.confidence * 100)} | ${l.text}\n`);
    }
  }
  await w.terminate();
}, 300_000);
