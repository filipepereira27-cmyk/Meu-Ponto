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

/** "Brancura": menor dos canais R, G, B (alto só em tons neutros e claros). */
export function toWhiteness(img: RGBA): Gray {
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = Math.min(img.data[j], img.data[j + 1], img.data[j + 2]);
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

// ─── Localização do ticket e endireitamento ───────────────────────────────────

/** Limiar de Otsu (separa claro/escuro pelo histograma). */
export function otsu(img: Gray): number {
  const hist = new Float64Array(256);
  for (const v of img.data) hist[v]++;
  const total = img.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Encontra o papel do ticket (maior região clara e contínua) para descartar a mesa
 * e o fundo, que confundem o OCR. Devolve `undefined` se não houver um papel claro
 * (ex.: a foto já é só o ticket).
 */
export function findPaper(img: Gray): Box | undefined {
  const scale = Math.min(1, 360 / Math.max(img.width, img.height));
  const small = scale < 1 ? resize(img, Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale))) : img;
  const { width: w, height: h, data } = boxBlur3(small);
  const t = otsu({ width: w, height: h, data });

  // 1. Semente: a maior região clara (acima do limiar de Otsu).
  const seedLabel = new Int32Array(w * h).fill(-1);
  let bestCount = 0, bestId = -1;
  const stack: number[] = [];
  const neighbors = (p: number) => {
    const x = p % w;
    return [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1];
  };
  for (let start = 0; start < w * h; start++) {
    if (seedLabel[start] !== -1 || data[start] <= t) continue;
    let count = 0;
    seedLabel[start] = start;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      for (const q of neighbors(p)) if (q >= 0 && seedLabel[q] === -1 && data[q] > t) { seedLabel[q] = start; stack.push(q); }
    }
    if (count > bestCount) { bestCount = count; bestId = start; }
  }
  if (bestId < 0) return undefined;

  // 2. Crescimento: avança enquanto o brilho muda suavemente (sombra sobre o papel),
  //    e para na borda nítida entre papel e mesa.
  const inside = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (seedLabel[p] === bestId) { inside[p] = 1; stack.push(p); }
  const floor = t * 0.45;
  const tol = 4;
  while (stack.length) {
    const p = stack.pop()!;
    for (const q of neighbors(p)) {
      if (q < 0 || inside[q] || data[q] < floor || Math.abs(data[q] - data[p]) > tol) continue;
      inside[q] = 1;
      stack.push(q);
    }
  }
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let p = 0; p < w * h; p++) {
    if (!inside[p]) continue;
    count++;
    const x = p % w, y = (p - x) / w;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return undefined;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const areaRatio = (bw * bh) / (w * h);
  // Papel ocupa quase toda a foto (já recortada), é pequeno demais ou a região vazou: não recorta.
  if (areaRatio > 0.9 || areaRatio < 0.04 || count / (bw * bh) < 0.45) return undefined;
  const m = 3;
  const x0 = Math.max(0, minX - m), y0 = Math.max(0, minY - m);
  const x1 = Math.min(w, maxX + 1 + m), y1 = Math.min(h, maxY + 1 + m);
  return { x: Math.round(x0 / scale), y: Math.round(y0 / scale), w: Math.round((x1 - x0) / scale), h: Math.round((y1 - y0) / scale) };
}

export function cropGray(img: Gray, b: Box): Gray {
  const x0 = Math.max(0, Math.min(img.width - 1, b.x)), y0 = Math.max(0, Math.min(img.height - 1, b.y));
  const w = Math.max(1, Math.min(img.width - x0, b.w)), h = Math.max(1, Math.min(img.height - y0, b.h));
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) out.set(img.data.subarray((y0 + y) * img.width + x0, (y0 + y) * img.width + x0 + w), y * w);
  return { width: w, height: h, data: out };
}

/**
 * Estima a inclinação das linhas de texto (graus, positivo = anti-horário) pelo
 * perfil de projeção: no ângulo certo as linhas formam picos nítidos.
 */
export function estimateSkew(img: Gray, maxAngle = 20): number {
  const scale = Math.min(1, 700 / img.width);
  const g = scale < 1 ? resize(img, Math.round(img.width * scale), Math.max(1, Math.round(img.height * scale))) : img;
  const bin = adaptiveThreshold(g, Math.max(15, Math.round(g.width / 30) | 1), 0.2);
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < bin.height; y++) for (let x = 0; x < bin.width; x++) {
    if (bin.data[y * bin.width + x] === 0) { xs.push(x - bin.width / 2); ys.push(y); }
  }
  if (xs.length < 50) return 0;
  const step = Math.max(1, Math.floor(xs.length / 40000));
  const rows = new Float64Array(bin.height * 2 + bin.width * 2);
  const off = bin.width;
  const scoreAt = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    rows.fill(0);
    for (let i = 0; i < xs.length; i += step) {
      const r = Math.round(ys[i] + xs[i] * t) + off;
      if (r >= 0 && r < rows.length) rows[r]++;
    }
    let s = 0;
    for (let i = 1; i < rows.length; i++) { const d = rows[i] - rows[i - 1]; s += d * d; }
    return s;
  };
  let best = 0, bestScore = -1;
  for (let a = -maxAngle; a <= maxAngle; a += 1) { const s = scoreAt(a); if (s > bestScore) { bestScore = s; best = a; } }
  const coarse = best;
  for (let a = coarse - 1; a <= coarse + 1; a += 0.2) { const s = scoreAt(a); if (s > bestScore) { bestScore = s; best = a; } }
  return Math.round(best * 10) / 10;
}

/** Rotação por ângulo qualquer (graus, positivo = horário), preenchendo com `fill`. */
export function rotateArbitrary(img: Gray, degrees: number, fill = 255): Gray {
  if (Math.abs(degrees) < 0.05) return img;
  const r = (degrees * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const { width: w, height: h, data } = img;
  const ow = Math.round(Math.abs(w * c) + Math.abs(h * s)), oh = Math.round(Math.abs(w * s) + Math.abs(h * c));
  const out = new Uint8ClampedArray(ow * oh);
  const cx = w / 2, cy = h / 2, ocx = ow / 2, ocy = oh / 2;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const dx = x - ocx, dy = y - ocy;
      const sx = dx * c + dy * s + cx, sy = -dx * s + dy * c + cy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { out[y * ow + x] = fill; continue; }
      const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
      out[y * ow + x] = (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + w] * (1 - fx) + data[i + w + 1] * fx) * fy;
    }
  }
  return { width: ow, height: oh, data: out };
}

/** Valor do papel (percentil claro), para preencher bordas sem criar "tinta". */
export function paperLevel(img: Gray): number {
  const hist = new Uint32Array(256);
  for (const v of img.data) hist[v]++;
  let acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= img.data.length * 0.2) return v; }
  return 255;
}

export interface PreparedTicket {
  /** Ticket recortado e endireitado, em cinza com contraste ajustado. */
  gray: Gray;
  paper?: Box;
  skew: number;
}

/** Recorta o papel, corrige a inclinação e ajusta contraste e tamanho. */
export function prepareTicket(img: RGBA, opts: { autoCrop?: boolean } = {}): PreparedTicket {
  let g = toGray(img);
  // Papel é branco/cinza neutro; mesas e fundos costumam ter cor. O menor canal RGB
  // separa os dois mesmo quando o brilho é parecido.
  let white = toWhiteness(img);
  if (Math.max(g.width, g.height) > 3200) {
    const k = 3200 / Math.max(g.width, g.height);
    g = resize(g, Math.round(g.width * k), Math.round(g.height * k));
    white = resize(white, g.width, g.height);
  }
  const paper = opts.autoCrop === false ? undefined : findPaper(white) ?? findPaper(g);
  if (paper) g = cropGray(g, paper);
  g = stretchContrast(g);
  const skew = estimateSkew(g);
  if (Math.abs(skew) >= 0.3) {
    g = rotateArbitrary(g, skew, paperLevel(g));
    // Após girar, recorta de novo as bordas que sobraram.
    const again = findPaper(g);
    if (again) g = cropGray(g, again);
  }
  const target = Math.min(2400, Math.max(1600, g.width));
  if (target !== g.width) g = resize(g, target, Math.max(1, Math.round((g.height * target) / g.width)));
  return { gray: g, paper, skew };
}

/** Variantes para leitura: binarizada (texto nítido) e em cinza (texto fino/desbotado). */
export function ocrVariants(g: Gray): { name: string; image: Gray }[] {
  const win = Math.max(15, Math.round(g.width / 40) | 1);
  return [
    { name: 'binarizada', image: clearBorder(adaptiveThreshold(boxBlur3(g), win, 0.15)) },
    // Fecha falhas finas da cabeça térmica e engrossa traços desbotados.
    { name: 'reforçada', image: clearBorder(adaptiveThreshold(boxBlur3(minFilter(g, 1)), win, 0.1)) },
  ];
}

/** Filtro de mínimo (engrossa o texto escuro) com raio horizontal `rx` e vertical 0. */
export function minFilter(img: Gray, rx: number): Gray {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dx = -rx; dx <= rx; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w) { const v = data[y * w + xx]; if (v < m) m = v; }
      }
      out[y * w + x] = m;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Remove manchas escuras ligadas à borda da imagem (resto da mesa, sombra, borda do
 * papel), que o OCR leria como letras soltas no começo das linhas.
 */
export function clearBorder(bin: Gray): Gray {
  const { width: w, height: h } = bin;
  const data = new Uint8ClampedArray(bin.data);
  const stack: number[] = [];
  const push = (p: number) => { if (data[p] === 0) { data[p] = 255; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  return { width: w, height: h, data };
}
