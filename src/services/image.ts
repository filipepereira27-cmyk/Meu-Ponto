import { differenceHash, enhanceForOCR, grayToRGBA, toGray, type Gray } from '../core/imageOps';

/** Imagem decodificada, já com a orientação da câmera aplicada. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const sizeOf = (s: ImageBitmap | HTMLImageElement | HTMLCanvasElement) =>
  s instanceof HTMLImageElement ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height };

/** Desenha numa tela (canvas) limitando o maior lado. */
export function toCanvas(source: CanvasImageSource & (ImageBitmap | HTMLImageElement | HTMLCanvasElement), maxSide = 3000): HTMLCanvasElement {
  const { w, h } = sizeOf(source);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function rotateCanvas(source: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
  const t = ((quarterTurns % 4) + 4) % 4;
  if (t === 0) return source;
  const canvas = document.createElement('canvas');
  canvas.width = t % 2 ? source.height : source.width;
  canvas.height = t % 2 ? source.width : source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((t * Math.PI) / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

/** Recorta por um retângulo normalizado (0…1). */
export function cropCanvas(source: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  if (r.x <= 0 && r.y <= 0 && r.w >= 1 && r.h >= 1) return source;
  const sx = Math.round(r.x * source.width), sy = Math.round(r.y * source.height);
  const sw = Math.max(1, Math.round(r.w * source.width)), sh = Math.max(1, Math.round(r.h * source.height));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function grayFromCanvas(c: HTMLCanvasElement): Gray {
  const data = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return toGray(data);
}

function canvasFromGray(g: Gray): HTMLCanvasElement {
  const rgba = grayToRGBA(g);
  const canvas = document.createElement('canvas');
  canvas.width = g.width;
  canvas.height = g.height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba.data as Uint8ClampedArray<ArrayBuffer>, g.width, g.height), 0, 0);
  return canvas;
}

/** Versão realçada para leitura (cinza, contraste, ampliação, binarização adaptativa). */
export function enhanceCanvas(source: HTMLCanvasElement, binarize = true): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true })!;
  const rgba = ctx.getImageData(0, 0, source.width, source.height);
  return canvasFromGray(enhanceForOCR(rgba, { binarize }));
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), type, quality));
}

export async function thumbnail(blob: Blob, maxSide = 240): Promise<Blob> {
  const img = await decodeImage(blob);
  return canvasToBlob(toCanvas(img, maxSide), 'image/jpeg', 0.8);
}

export function imageHash(canvas: HTMLCanvasElement): string {
  return differenceHash(grayFromCanvas(toCanvas(canvas, 300)));
}

/** URL temporária para exibir um Blob; revogue ao desmontar. */
export const objectURL = (blob: Blob) => URL.createObjectURL(blob);
