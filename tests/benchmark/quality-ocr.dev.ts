import { readdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { readTicket } from '../../src/core/ocrPipeline';
import { measureQuality } from '../../src/core/quality';
import { loadImage, makeWorker, recognizer } from './harness';
import { score, truthTable } from './score';

it('qualidade x leitura', async () => {
  const dir = process.env.QDIR ?? '/tmp/qual';
  const w = await makeWorker();
  const rows: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jpg')).sort()) {
    const base = f.replace(/-(escura|movimento|muito-tremida|pequena|tremida)\.jpg$/, '.jpg');
    const truth = truthTable[base];
    if (!truth) continue;
    const img = loadImage(`${dir}/${f}`);
    const m = measureQuality(img);
    const s = score((await readTicket(img, recognizer(w), { years: [2000, 2027] })).parsed, truth);
    rows.push(`${f.padEnd(40)} nitidez=${m.sharpness.toFixed(3)} largura=${m.paperWidth} brilho=${m.paperBrightness} acerto=${s.filter((x) => x.ok).length}/${s.length} silenciosos=${s.filter((x) => x.silentError).length}`);
  }
  await w.terminate();
  writeFileSync(`${dir}/ocr.txt`, rows.join('\n'));
});
