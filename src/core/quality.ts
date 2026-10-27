import { cropGray, findPaper, resize, toGray, toWhiteness, type Gray, type RGBA } from './imageOps';

/**
 * Avaliação rápida da foto ANTES da leitura: avisa quando ela está tremida, escura,
 * com reflexo ou com o ticket pequeno demais — situações em que é melhor fotografar
 * de novo do que tentar ler.
 */

export type QualityIssueCode = 'blur' | 'dark' | 'glare' | 'small' | 'noPaper';

export interface QualityIssue {
  code: QualityIssueCode;
  /** 'bad' = muito provável que a leitura falhe; 'warn' = pode prejudicar. */
  severity: 'warn' | 'bad';
  message: string;
}

export interface QualityMetrics {
  /** Nitidez: energia das bordas do texto, independente do contraste. */
  sharpness: number;
  /** Brilho do papel (percentil claro, 0–255). */
  paperBrightness: number;
  /** Fração do papel estourada (branco puro). */
  clipped: number;
  /** Largura do papel em pixels. */
  paperWidth: number;
  paperFound: boolean;
}

export interface QualityReport {
  level: 'ok' | 'warn' | 'bad';
  issues: QualityIssue[];
  metrics: QualityMetrics;
}

/** Limites calibrados com tests/benchmark (fotos boas, desbotadas e propositalmente ruins). */
export const QUALITY_LIMITS = {
  // Muito tremidas mediram 0,07–0,10 e não leram nada; tremidas leves e desbotadas,
  // 0,11–0,18 (leitura parcial); boas, acima de 0,35.
  sharpnessBad: 0.1,
  sharpnessWarn: 0.2,
  // Fotos escurecidas para brilho ~70 ainda leram 100% (o contraste é ajustado);
  // só avisa em casos extremos, em que o ruído do sensor domina.
  darkBad: 30,
  darkWarn: 55,
  clippedWarn: 0.35,
  // Ticket com ~200 px de largura leu 2/5; ~330 px, 5/6.
  smallBad: 260,
  smallWarn: 420,
};

function percentile(data: Uint8ClampedArray, p: number): number {
  const hist = new Uint32Array(256);
  for (const v of data) hist[v]++;
  const target = data.length * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
  return 255;
}

/**
 * Nitidez normalizada: média do gradiente nos pixels de borda dividida pela amplitude
 * de contraste local. Texto nítido tem transições curtas (valor alto); texto tremido
 * espalha a transição por vários pixels (valor baixo). Dividir pelo contraste evita
 * confundir papel térmico desbotado (claro, mas nítido) com foto tremida.
 */
function sharpnessOf(g: Gray): number {
  const { width: w, height: h, data } = g;
  const lo = percentile(data, 0.02), hi = percentile(data, 0.98);
  const range = Math.max(1, hi - lo);
  // Horizontal e vertical separados: tremido de movimento borra só uma direção.
  const gxs: number[] = [], gys: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = Math.abs(data[i + 1] - data[i - 1]) / 2, gy = Math.abs(data[i + w] - data[i - w]) / 2;
      if (gx > range * 0.06) gxs.push(gx);
      if (gy > range * 0.06) gys.push(gy);
    }
  }
  const strength = (list: number[]) => {
    if (list.length < 200) return 0;
    list.sort((a, b) => b - a);
    const top = list.slice(0, Math.max(50, Math.floor(list.length * 0.1)));
    return top.reduce((s, v) => s + v, 0) / top.length / range;
  };
  return Math.min(strength(gxs), strength(gys));
}

export function measureQuality(img: RGBA): QualityMetrics {
  let g = toGray(img);
  const white = toWhiteness(img);
  // Medidas feitas numa escala fixa (a largura final do ticket importa, não a da foto).
  const paper = findPaper(white) ?? findPaper(g);
  const paperWidth = paper ? paper.w : g.width;
  if (paper) g = cropGray(g, paper);
  // Sem papel localizado, mede no centro da foto (onde o ticket costuma estar).
  else g = cropGray(g, { x: Math.round(g.width * 0.2), y: Math.round(g.height * 0.2), w: Math.round(g.width * 0.6), h: Math.round(g.height * 0.6) });
  // Nitidez medida com o ticket em ~900 px de largura, como na leitura.
  const scale = Math.min(1, 900 / g.width);
  const small = scale < 1 ? resize(g, Math.round(g.width * scale), Math.max(1, Math.round(g.height * scale))) : g;
  return {
    sharpness: Math.round(sharpnessOf(small) * 1000) / 1000,
    paperBrightness: percentile(g.data, 0.8),
    clipped: Math.round((g.data.reduce((n, v) => n + (v >= 253 ? 1 : 0), 0) / g.data.length) * 100) / 100,
    paperWidth,
    paperFound: !!paper,
  };
}

export function assessQuality(img: RGBA): QualityReport {
  const m = measureQuality(img);
  const L = QUALITY_LIMITS;
  const issues: QualityIssue[] = [];
  if (m.sharpness < L.sharpnessBad) issues.push({ code: 'blur', severity: 'bad', message: 'A foto está tremida ou fora de foco. Apoie o celular, toque no ticket para focar e fotografe de novo.' });
  else if (m.sharpness < L.sharpnessWarn) issues.push({ code: 'blur', severity: 'warn', message: 'A foto parece um pouco desfocada. Se a leitura falhar, fotografe de novo com o celular apoiado.' });
  if (m.paperBrightness < L.darkBad) issues.push({ code: 'dark', severity: 'bad', message: 'A foto está muito escura. Procure um lugar mais iluminado.' });
  else if (m.paperBrightness < L.darkWarn) issues.push({ code: 'dark', severity: 'warn', message: 'Pouca luz. Uma foto mais clara melhora a leitura.' });
  if (m.clipped > L.clippedWarn) issues.push({ code: 'glare', severity: 'warn', message: 'Parte do ticket está estourada de luz (reflexo ou flash). Incline um pouco o celular ou desligue o flash.' });
  if (m.paperWidth < L.smallBad) issues.push({ code: 'small', severity: 'bad', message: 'O ticket aparece muito pequeno. Aproxime o celular até ele ocupar quase toda a tela.' });
  else if (m.paperWidth < L.smallWarn) issues.push({ code: 'small', severity: 'warn', message: 'O ticket está pequeno na foto. Aproximar o celular melhora a leitura.' });
  const level = issues.some((i) => i.severity === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok';
  return { level, issues, metrics: m };
}
