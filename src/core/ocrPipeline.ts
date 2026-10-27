import { hhmm } from './calendar';
import { ocrVariants, prepareTicket, type Gray, type RGBA } from './imageOps';
import { parseTicket, type ParserOptions } from './parser';
import { fold } from './text';
import { CONFIRMATION_THRESHOLD, type Extracted, type OCRLine, type ParsedTicket } from './types';

/**
 * Leitura em vários passes. O mesmo ticket é lido com tratamentos diferentes e os
 * resultados são combinados campo a campo:
 * - valores iguais em leituras independentes reforçam a confiança;
 * - valores diferentes viram dúvida (o usuário confirma).
 *
 * O reconhecedor é injetado: no navegador usa o Tesseract em WebAssembly; nos testes, o de Node.
 */

export type Recognizer = (image: Gray, mode: 'auto' | 'block') => Promise<OCRLine[]>;

type FieldKey = 'employeeName' | 'employeeID' | 'company' | 'cnpj' | 'date' | 'time' | 'markType' | 'clockID' | 'ticketNumber' | 'authCode';
const FIELDS: FieldKey[] = ['date', 'time', 'markType', 'cnpj', 'ticketNumber', 'employeeName', 'employeeID', 'company', 'clockID', 'authCode'];
const CRITICAL = new Set<FieldKey>(['date', 'time', 'markType']);

const keyOf = (field: FieldKey, value: string) => {
  if (field === 'time') return hhmm(value);
  if (field === 'ticketNumber') return fold(value).replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
  return fold(value).replace(/[^A-Z0-9]/g, '');
};

/** Combina as leituras. Exportada para teste. */
export function mergeReadings(readings: ParsedTicket[]): ParsedTicket {
  if (readings.length === 1) return readings[0];
  const best = [...readings].sort((a, b) => score(b) - score(a))[0];
  const merged: ParsedTicket = { ...best, warnings: [], otherFields: best.otherFields };

  for (const field of FIELDS) {
    const found = readings.map((r) => r[field] as Extracted<string> | undefined).filter((e): e is Extracted<string> => !!e);
    if (!found.length) { delete merged[field]; continue; }
    const groups = new Map<string, Extracted<string>[]>();
    for (const e of found) {
      // "indefinido" (tipos conflitantes) não é um valor: não vota.
      if (field === 'markType' && e.value === 'indefinido') continue;
      const k = keyOf(field, e.value);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    if (!groups.size) { (merged as unknown as Record<string, unknown>)[field] = found[0]; continue; }
    const ranked = [...groups.values()]
      .map((g) => ({ g, top: g.reduce((a, b) => (b.confidence > a.confidence ? b : a)), sum: g.reduce((s, e) => s + e.confidence, 0) }))
      .sort((a, b) => b.sum - a.sum);
    const winner = ranked[0];
    let confidence = winner.top.confidence;
    let note = winner.top.note;
    if (ranked.length > 1) {
      // Leituras discordam: nunca aceitar sem conferência.
      confidence = Math.min(confidence * 0.7, CONFIRMATION_THRESHOLD - 0.05);
      note = `leituras diferentes: ${ranked.map((r) => r.top.value).join(' / ')}`;
      if (CRITICAL.has(field)) merged.warnings.push(`${label(field)}: as leituras discordam (${ranked.map((r) => r.top.value).join(' ou ')}). Confira.`);
    } else if (winner.g.length >= 2 && !winner.top.note) {
      // Concordância entre leituras independentes.
      confidence = Math.min(1, Math.max(confidence, (winner.g[0].confidence + winner.g[1].confidence) / 2 + 0.12));
    }
    (merged as unknown as Record<string, unknown>)[field] = { ...winner.top, confidence, ...(note ? { note } : {}) };
  }

  // Avisos gerais recalculados sobre o resultado combinado.
  for (const w of best.warnings) {
    if (/^(Data|Horário):/.test(w) || w.includes('não encontrad') || w.includes('tipo de marcação')) continue;
    merged.warnings.push(w);
  }
  if (!merged.markType) merged.warnings.push('O tipo de marcação (entrada, saída, intervalo) não está impresso ou não foi reconhecido. Informe manualmente.');
  else if (merged.markType.value === 'indefinido') merged.warnings.push('O comprovante cita mais de um tipo de marcação. Confirme qual se aplica.');
  if (!merged.date) merged.warnings.push('Data do registro não encontrada.');
  if (!merged.time) merged.warnings.push('Horário do registro não encontrado.');
  return merged;
}

function label(f: FieldKey) {
  return f === 'date' ? 'Data' : f === 'time' ? 'Horário' : 'Tipo de marcação';
}

/** Qualidade de uma leitura: campos encontrados ponderados pela confiança. */
function score(p: ParsedTicket): number {
  return FIELDS.reduce((s, f) => s + ((p[f] as Extracted<string> | undefined)?.confidence ?? 0) * (CRITICAL.has(f) ? 2 : 1), 0) + p.averageConfidence;
}

export interface ReadResult {
  parsed: ParsedTicket;
  /** Imagem tratada que deu a melhor leitura (para exibir/guardar). */
  prepared: Gray;
  skew: number;
  passes: number;
}

/**
 * Pipeline completo: localizar o papel → endireitar → ler (binarizada e cinza) →
 * se ainda faltar data/horário, terceira leitura em modo "bloco único" → combinar.
 */
export async function readTicket(
  img: RGBA,
  recognize: Recognizer,
  opts: ParserOptions & { autoCrop?: boolean; onProgress?: (fraction: number) => void } = {},
): Promise<ReadResult> {
  const prep = prepareTicket(img, { autoCrop: opts.autoCrop });
  const variants = ocrVariants(prep.gray);
  const readings: ParsedTicket[] = [];
  const total = variants.length + 1;
  let done = 0;
  for (const v of variants) {
    readings.push(parseTicket(await recognize(v.image, 'auto'), opts));
    opts.onProgress?.(++done / total);
  }
  let merged = mergeReadings(readings);
  if (!merged.date || !merged.time || merged.date.confidence < CONFIRMATION_THRESHOLD || merged.time.confidence < CONFIRMATION_THRESHOLD) {
    readings.push(parseTicket(await recognize(variants[0].image, 'block'), opts));
    merged = mergeReadings(readings);
  }
  opts.onProgress?.(1);
  return { parsed: merged, prepared: prep.gray, skew: prep.skew, passes: readings.length };
}
