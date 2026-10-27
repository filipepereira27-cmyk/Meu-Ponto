import type { OCRLine } from './types';

interface BBox { x0: number; y0: number; x1: number; y1: number }
interface TesseractWord { text: string; confidence: number; bbox: BBox }
interface TesseractLine { text: string; confidence: number; words?: TesseractWord[]; bbox?: BBox }
interface TesseractBlock { paragraphs: { lines: TesseractLine[] }[] }

/**
 * Converte a saída do Tesseract em linhas com confiança 0…1.
 *
 * As linhas são remontadas pela posição das palavras: o Tesseract às vezes divide uma
 * linha do ticket em "colunas" (falhas da impressão térmica, espaços largos), o que
 * cortaria valores como "NOME: CARLOS | ALBERTO DE SOUZA".
 */
export function linesFromBlocks(blocks: TesseractBlock[] | null | undefined): OCRLine[] {
  const lines = (blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const rows = lines
    .map((l) => (l.words ?? []).filter((w) => w.text.trim() && w.bbox).sort((a, b) => a.bbox.x0 - b.bbox.x0))
    .filter((r) => r.length > 0);
  if (!rows.length) {
    return lines
      .map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), confidence: clamp(l.confidence / 100) }))
      .filter((l) => l.text.length > 0);
  }
  // Junta pedaços da mesma linha que o Tesseract separou em colunas: o fim de um
  // pedaço e o começo do outro estão lado a lado e na mesma altura. Comparar só as
  // pontas (e não a linha inteira) respeita a curvatura do papel.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < rows.length; j++) {
        if (i === j) continue;
        const a = rows[i], b = rows[j];
        const last = a[a.length - 1], first = b[0];
        if (first.bbox.x0 < last.bbox.x1 - charWidth(last)) continue;
        if (verticalOverlap(last, first) < 0.5) continue;
        rows[i] = [...a, ...b];
        rows.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return rows
    .sort((a, b) => center(a[0]) - center(b[0]))
    .map((r) => ({
      text: joinWords(r),
      // Média ponderada pelo tamanho da palavra (palavras longas pesam mais).
      confidence: clamp(r.reduce((s, w) => s + w.confidence * w.text.length, 0) / r.reduce((s, w) => s + w.text.length, 0) / 100),
    }))
    .filter((l) => l.text.length > 0);
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const center = (w: TesseractWord) => (w.bbox.y0 + w.bbox.y1) / 2;
const charWidth = (w: TesseractWord) => (w.bbox.x1 - w.bbox.x0) / Math.max(1, w.text.length);

/** Sobreposição vertical relativa à menor das duas palavras (0…1). */
function verticalOverlap(a: TesseractWord, b: TesseractWord): number {
  const top = Math.max(a.bbox.y0, b.bbox.y0), bottom = Math.min(a.bbox.y1, b.bbox.y1);
  const h = Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0);
  return h > 0 ? Math.max(0, bottom - top) / h : 0;
}

/** Junta palavras; espaço grande (vários caracteres) vira espaço duplo, como no papel. */
function joinWords(row: TesseractWord[]): string {
  let out = row[0].text.trim();
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1], cur = row[i];
    out += (cur.bbox.x0 - prev.bbox.x1 > charWidth(prev) * 3 ? '  ' : ' ') + cur.text.trim();
  }
  return out.replace(/\s{3,}/g, '  ').trim();
}
