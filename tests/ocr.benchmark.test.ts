import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { readTicket } from '../src/core/ocrPipeline';
import { loadImage, makeWorker, recognizer } from './benchmark/harness';
import { score, truthTable } from './benchmark/score';

/**
 * Benchmark do OCR: 15 fotos sintéticas difíceis (tests/benchmark, geradas por
 * scripts/gerar-benchmark.py) com gabarito. Metas: ≥ 85% dos campos corretos e
 * NENHUM valor errado aceito sem pedir confirmação.
 * Relatório campo a campo em test-results/ocr-benchmark.txt.
 */
const REPORT = resolve(import.meta.dirname, '../test-results/ocr-benchmark.txt');
const log = (...s: string[]) => appendFileSync(REPORT, s.join(' ') + '\n');

it('benchmark de OCR em fotos difíceis', async () => {
  mkdirSync(resolve(REPORT, '..'), { recursive: true });
  writeFileSync(REPORT, '');
  const w = await makeWorker();
  const rec = recognizer(w);
  let ok = 0, total = 0, silent = 0;
  for (const [file, truth] of Object.entries(truthTable)) {
    const t0 = Date.now();
    const r = await readTicket(loadImage(resolve(import.meta.dirname, 'benchmark', file)), rec, { years: [2000, 2027] });
    const s = score(r.parsed, truth);
    ok += s.filter((x) => x.ok).length; total += s.length; silent += s.filter((x) => x.silentError).length;
    log(file.padEnd(28), `skew=${r.skew} passes=${r.passes} ${Date.now() - t0}ms`, s.map((x) => `${x.ok ? '✓' : x.silentError ? '✗!' : '✗'}${x.field}${x.ok ? '' : `(${x.got ?? '-'})`}`).join(' '));
  }
  log(`ACERTO ${ok}/${total} = ${Math.round((100 * ok) / total)}%  erros silenciosos: ${silent}`);
  await w.terminate();
  expect(silent, 'valores errados aceitos sem confirmação').toBe(0);
  expect(ok / total).toBeGreaterThanOrEqual(0.85);
}, 900_000);
