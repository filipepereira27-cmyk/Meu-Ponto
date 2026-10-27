/**
 * OCR real (Tesseract, português) + pré-processamento + interpretação, sobre as
 * fotografias de exemplo em docs/amostras. Mesmo pipeline do navegador.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { differenceHash, hashDistance, toGray } from '../src/core/imageOps';
import { readTicket } from '../src/core/ocrPipeline';
import { recognizer } from './benchmark/harness';
import { needsConfirmation, type ParsedTicket } from '../src/core/types';

const root = resolve(__dirname, '..');
let worker: Worker;

beforeAll(async () => {
  worker = await createWorker('por', OEM.LSTM_ONLY, {
    langPath: resolve(root, 'node_modules/@tesseract.js-data/por/4.0.0_best_int'), gzip: true, cacheMethod: 'none',
  });
}, 60_000);
afterAll(async () => { await worker?.terminate(); });

function load(name: string) {
  return jpeg.decode(readFileSync(resolve(root, 'docs/amostras', name)), { useTArray: true });
}

async function read(name: string): Promise<ParsedTicket> {
  // Mesmo pipeline do navegador: recorte do papel, endireitamento, vários passes.
  return (await readTicket(load(name), recognizer(worker), { years: [2000, 2027] })).parsed;
}

/** O valor pode não ser lido, mas nunca pode estar errado sem pedir confirmação. */
function neverSilentlyWrong(p: ParsedTicket, field: 'date' | 'time', expected: string) {
  const v = p[field];
  if (v && v.value !== expected) expect(needsConfirmation(p, field), `${field} errado (${v.value}) sem pedir confirmação`).toBe(true);
}

describe('OCR nas amostras', () => {
  it('01 nítido (Portaria 671)', async () => {
    const p = await read('01-nitido-portaria671-entrada.jpg');
    expect(p.date?.value).toBe('2026-10-22');
    expect(p.time?.value).toBe('08:01');
    expect(p.markType?.value).toBe('entrada');
    expect(p.cnpj?.value).toBe('11.222.333/0001-81');
    expect(p.ticketNumber?.value).toBe('000012345');
    expect(p.employeeName?.value).toBe('JOÃO DA SILVA SANTOS');
  }, 60_000);

  it('02 inclinado, sem tipo impresso', async () => {
    const p = await read('02-inclinado-portaria1510-sem-tipo.jpg');
    neverSilentlyWrong(p, 'date', '2026-10-22');
    neverSilentlyWrong(p, 'time', '12:03');
    expect(p.markType).toBeUndefined();
    expect(needsConfirmation(p, 'markType')).toBe(true);
    expect(p.company?.value).toBe('COMERCIAL ALFA S/A');
  }, 60_000);

  it('03 desbotado e borrado', async () => {
    const p = await read('03-desbotado-borrado-intervalo.jpg');
    neverSilentlyWrong(p, 'date', '2026-10-23');
    neverSilentlyWrong(p, 'time', '12:00');
    expect(p.markType?.value).toBe('inicioIntervalo');
  }, 60_000);

  it('05 danificado (sem data)', async () => {
    const p = await read('05-danificado-sem-data-saida.jpg');
    expect(p.date).toBeUndefined();
    expect(p.time?.value).toBe('17:32');
    expect(p.markType?.value).toBe('saida');
  }, 60_000);

  it('04 é a mesma foto do 01 (duplicidade por imagem)', () => {
    const h1 = differenceHash(toGray(load('01-nitido-portaria671-entrada.jpg')));
    const h4 = differenceHash(toGray(load('04-foto-repetida-do-01.jpg')));
    const h2 = differenceHash(toGray(load('02-inclinado-portaria1510-sem-tipo.jpg')));
    expect(hashDistance(h1, h4)).toBeLessThan(hashDistance(h1, h2));
  });
});
