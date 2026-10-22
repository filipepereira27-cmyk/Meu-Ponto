import type { OCRLine } from './types';

interface TesseractLine { text: string; confidence: number }
interface TesseractBlock { paragraphs: { lines: TesseractLine[] }[] }

/** Converte a saída em blocos do Tesseract em linhas com confiança 0…1. */
export function linesFromBlocks(blocks: TesseractBlock[] | null | undefined): OCRLine[] {
  return (blocks ?? [])
    .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
    .map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), confidence: Math.max(0, Math.min(1, l.confidence / 100)) }))
    .filter((l) => l.text.length > 0);
}
