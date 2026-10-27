import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { grayToRGBA, toGray, type Gray } from '../core/imageOps';
import { linesFromBlocks } from '../core/ocrLines';
import { readTicket, type ReadResult } from '../core/ocrPipeline';
import type { OCRLine } from '../core/types';

/**
 * OCR no próprio navegador (Tesseract, português). O motor e os dados do idioma são
 * servidos pelo próprio portal e guardados no aparelho: nenhuma imagem sai dele.
 */

const base = import.meta.env.BASE_URL;
let workerPromise: Promise<Worker> | undefined;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('por', OEM.LSTM_ONLY, {
    workerPath: `${base}ocr/worker.min.js`,
    corePath: `${base}ocr/core`,
    langPath: `${base}ocr/lang`,
    gzip: true,
    // O service worker já guarda os arquivos; evita uma segunda cópia no IndexedDB.
    cacheMethod: 'none',
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

function grayToCanvas(g: Gray): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = g.width;
  canvas.height = g.height;
  canvas.getContext('2d')!.putImageData(new ImageData(grayToRGBA(g).data as Uint8ClampedArray<ArrayBuffer>, g.width, g.height), 0, 0);
  return canvas;
}

/** Uma leitura do Tesseract sobre uma imagem em cinza. */
export async function recognize(image: Gray, mode: 'auto' | 'block' = 'auto'): Promise<OCRLine[]> {
  const worker = await getWorker();
  // Resolução informada: evita a estimativa (e o aviso no console) a cada leitura.
  await worker.setParameters({ tessedit_pageseg_mode: mode === 'block' ? PSM.SINGLE_BLOCK : PSM.AUTO, user_defined_dpi: '300' });
  const { data } = await worker.recognize(grayToCanvas(image), {}, { blocks: true, text: false });
  return linesFromBlocks(data.blocks);
}

/**
 * Leitura completa do ticket: localiza o papel, endireita, lê em mais de um passe e
 * combina os resultados (ver core/ocrPipeline).
 */
export async function readTicketCanvas(
  canvas: HTMLCanvasElement,
  opts: { autoCrop: boolean; onProgress?: (p: number) => void },
): Promise<ReadResult & { preparedCanvas: HTMLCanvasElement }> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Cede a vez para a tela mostrar o progresso antes do processamento pesado.
  await new Promise((r) => setTimeout(r, 30));
  const result = await readTicket(rgba, recognize, { autoCrop: opts.autoCrop, onProgress: opts.onProgress });
  return { ...result, preparedCanvas: grayToCanvas(result.prepared) };
}

/** Leitura simples (sem tratamento), quando o usuário desliga o realce. */
export async function readPlainCanvas(canvas: HTMLCanvasElement): Promise<OCRLine[]> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return recognize(toGray(ctx.getImageData(0, 0, canvas.width, canvas.height)));
}
