/**
 * Operações de imagem puras (sem DOM), usadas antes do OCR e na detecção de duplicidade.
 * Trabalham sobre buffers RGBA (como `ImageData`) ou em tons de cinza, para poderem ser
 * testadas fora do navegador.
 */

export interface Gray {
  width: number;
  height: number;
  data: Uint8ClampedArray; // 1 byte por pixel
}

export interface RGBA {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array; // 4 bytes por pixel
}

/** Luminância (ITU-R BT.601). */
export function toGray(img: RGBA): Gray {
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = (img.data[j] * 299 + img.data[j + 1] * 587 + img.data[j + 2] * 114) / 1000;
  }
  return { width: img.width, height: img.height, data: out };
}

export function grayToRGBA(img: Gray): RGBA {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.data.length; i++, j += 4) {
    out[j] = out[j + 1] = out[j + 2] = img.data[i];
    out[j + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

/** Estica o contraste entre os percentis informados (papel térmico desbotado fica legível). */
export function stretchContrast(img: Gray, low = 0.01, high = 0.99): Gray {
  const hist = new Uint32Array(256);
  for (const v of img.data) hist[v]++;
  const total = img.data.length;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * low) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * (1 - high)) { hi = v; break; } }
  if (hi - lo < 10) return img;
  const scale = 255 / (hi - lo);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = (img.data[i] - lo) * scale;
  return { width: img.width, height: img.height, data: out };
}

/** Redimensionamento bilinear. */
export function resize(img: Gray, width: number, height: number): Gray {
  const out = new Uint8ClampedArray(width * height);
  const sx = img.width / width, sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min((y + 0.5) * sy - 0.5, img.height - 1);
    const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(img.height - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min((x + 0.5) * sx - 0.5, img.width - 1);
      const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(img.width - 1, x0 + 1), wx = fx - x0;
      const a = img.data[y0 * img.width + x0], b = img.data[y0 * img.width + x1];
      const c = img.data[y1 * img.width + x0], d = img.data[y1 * img.width + x1];
      out[y * width + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return { width, height, data: out };
}

/**
 * Binarização adaptativa (Sauvola) com imagens integrais: separa o texto do fundo mesmo
 * com iluminação desigual ou papel amarelado.
 */
export function adaptiveThreshold(img: Gray, window = 31, k = 0.2): Gray {
  const { width: w, height: h, data } = img;
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      rs += v; rq += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rq;
    }
  }
  const r = window >> 1;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      const q = sq[y1 * W + x1] - sq[y0 * W + x1] - sq[y1 * W + x0] + sq[y0 * W + x0];
      const mean = s / n;
      const sd = Math.sqrt(Math.max(0, q / n - mean * mean));
      const t = mean * (1 + k * (sd / 128 - 1));
      out[y * w + x] = data[y * w + x] > t ? 255 : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Desfoque leve 3×3 (reduz ruído antes da binarização). */
export function boxBlur3(img: Gray): Gray {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += data[yy * w + xx]; n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return { width: w, height: h, data: out };
}

export interface EnhanceOptions {
  /** Largura mínima desejada para o OCR (texto pequeno é ampliado). */
  minWidth?: number;
  /** Largura máxima (fotos de 12 MP são reduzidas para acelerar). */
  maxWidth?: number;
  binarize?: boolean;
}

/** Pipeline usado antes do OCR: cinza → contraste → escala → (binarização adaptativa). */
export function enhanceForOCR(img: RGBA, opts: EnhanceOptions = {}): Gray {
  const { minWidth = 1600, maxWidth = 2400, binarize = true } = opts;
  let g = stretchContrast(toGray(img));
  let target = g.width;
  if (g.width < minWidth) target = minWidth;
  if (g.width > maxWidth) target = maxWidth;
  if (target !== g.width) g = resize(g, target, Math.round((g.height * target) / g.width));
  if (binarize) g = adaptiveThreshold(boxBlur3(g), Math.max(15, Math.round(g.width / 40) | 1), 0.15);
  return g;
}

/** Gira em múltiplos de 90° (positivo = horário). */
export function rotateGray(img: Gray, quarterTurns: number): Gray {
  const t = ((quarterTurns % 4) + 4) % 4;
  if (t === 0) return img;
  const { width: w, height: h, data } = img;
  const ow = t % 2 ? h : w, oh = t % 2 ? w : h;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number, ny: number;
      if (t === 1) { nx = h - 1 - y; ny = x; } else if (t === 2) { nx = w - 1 - x; ny = h - 1 - y; } else { nx = y; ny = w - 1 - x; }
      out[ny * ow + nx] = data[y * w + x];
    }
  }
  return { width: ow, height: oh, data: out };
}

/** Hash perceptual por diferença (dHash, 64 bits como string hexadecimal de 16 dígitos). */
export function differenceHash(img: Gray): string {
  const small = resize(img, 9, 8);
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += small.data[y * 9 + x] > small.data[y * 9 + x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Bits diferentes entre dois hashes (0 = idênticos). */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
