import { createWorker, OEM, type Worker } from 'tesseract.js';
import { linesFromBlocks } from '../core/ocrLines';
import type { OCRLine } from '../core/types';

/**
 * OCR no próprio navegador (Tesseract, português). O motor e os dados do idioma são
 * servidos pelo próprio portal e guardados no aparelho: nenhuma imagem sai dele.
 */

const base = import.meta.env.BASE_URL;
let workerPromise: Promise<Worker> | undefined;
let progressListener: ((p: number) => void) | undefined;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('por', OEM.LSTM_ONLY, {
    workerPath: `${base}ocr/worker.min.js`,
    corePath: `${base}ocr/core`,
    langPath: `${base}ocr/lang`,
    gzip: true,
    // O service worker já guarda os arquivos; evita uma segunda cópia no IndexedDB.
    cacheMethod: 'none',
    logger: (m) => { if (m.status === 'recognizing text') progressListener?.(m.progress); },
  }).catch((error) => {
    workerPromise = undefined;
    throw error;
  });
  return workerPromise;
}

/** Carrega o OCR em segundo plano (deixa pronto para uso sem internet). */
export function warmUpOCR(): void {
  getWorker().catch(() => {});
}

export async function recognize(image: HTMLCanvasElement | Blob, onProgress?: (p: number) => void): Promise<OCRLine[]> {
  const worker = await getWorker();
  progressListener = onProgress;
  try {
    const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
    return linesFromBlocks(data.blocks);
  } finally {
    progressListener = undefined;
  }
}
