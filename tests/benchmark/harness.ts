import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { grayToRGBA, type Gray, type RGBA } from '../../src/core/imageOps';
import { linesFromBlocks } from '../../src/core/ocrLines';
import type { OCRLine } from '../../src/core/types';

const root = resolve(import.meta.dirname, '../..');

export async function makeWorker(): Promise<Worker> {
  return createWorker('por', OEM.LSTM_ONLY, {
    langPath: resolve(root, 'node_modules/@tesseract.js-data/por/4.0.0_best_int'), gzip: true, cacheMethod: 'none',
  });
}

export function loadImage(path: string): RGBA {
  return jpeg.decode(readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 1024 });
}

/** Reconhecedor equivalente ao do navegador (imagem em cinza → linhas). */
export function recognizer(worker: Worker) {
  return async (g: Gray, psm: 'auto' | 'block' = 'auto'): Promise<OCRLine[]> => {
    const rgba = grayToRGBA(g);
    const enc = jpeg.encode({ width: rgba.width, height: rgba.height, data: Buffer.from(rgba.data) }, 95).data;
    await worker.setParameters({ tessedit_pageseg_mode: psm === 'block' ? PSM.SINGLE_BLOCK : PSM.AUTO, user_defined_dpi: '300' });
    const { data } = await worker.recognize(Buffer.from(enc), {}, { blocks: true });
    return linesFromBlocks(data.blocks);
  };
}
