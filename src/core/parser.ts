import { MONTH_ABBR, makeDay, makeTime, type DayKey, type TimeText } from './calendar';
import { collapseSpaces, digitsOnly, fold, normalizeLabel } from './text';
import { compactCNPJ, formatCNPJ, isValidCNPJ, isValidCPF, isValidPIS } from './validators';
import {
  CONFIRMATION_THRESHOLD, MARK_LABEL, type Extracted, type MarkType, type OCRLine, type ParsedTicket,
} from './types';

/**
 * Interpreta o texto do OCR de um comprovante de ponto.
 *
 * Funciona com os modelos comuns no Brasil (REP das Portarias 1510/2009 e 671/2021 e
 * relógios convencionais) sem depender de layout fixo: rótulos ("NOME:", "NSR:"), padrões
 * (datas, horas, CNPJ) e heurísticas com confiança reduzida. Na dúvida, pede confirmação.
 */

type Category =
  | 'employeeName' | 'employeeID' | 'company' | 'cnpj' | 'clockID' | 'ticketNumber' | 'authCode'
  | 'markType' | 'date' | 'time' | 'ignored';

const LABELS: [string, Category][] = [
  ['NOME', 'employeeName'], ['NOME DO TRABALHADOR', 'employeeName'], ['TRABALHADOR', 'employeeName'],
  ['FUNCIONARIO', 'employeeName'], ['NOME DO FUNCIONARIO', 'employeeName'], ['NOME FUNCIONARIO', 'employeeName'],
  ['EMPREGADO', 'employeeName'], ['NOME DO EMPREGADO', 'employeeName'], ['COLABORADOR', 'employeeName'],
  ['NOME DO COLABORADOR', 'employeeName'],

  ['MATRICULA', 'employeeID'], ['MAT', 'employeeID'], ['PIS', 'employeeID'], ['PIS/PASEP', 'employeeID'],
  ['PASEP', 'employeeID'], ['NIT', 'employeeID'], ['CPF', 'employeeID'], ['CPF DO TRABALHADOR', 'employeeID'],
  ['CRACHA', 'employeeID'], ['CHAPA', 'employeeID'], ['CODIGO DO FUNCIONARIO', 'employeeID'],
  ['CODIGO DO EMPREGADO', 'employeeID'], ['ID FUNCIONARIO', 'employeeID'], ['REGISTRO', 'employeeID'],

  ['EMPRESA', 'company'], ['EMPREGADOR', 'company'], ['RAZAO SOCIAL', 'company'],
  ['NOME DO EMPREGADOR', 'company'], ['NOME DA EMPRESA', 'company'],

  ['CNPJ', 'cnpj'], ['CNPJ/CPF', 'cnpj'], ['CPF/CNPJ', 'cnpj'], ['CNPJ DO EMPREGADOR', 'cnpj'],
  ['CPF DO EMPREGADOR', 'cnpj'], ['CNPJ/CPF DO EMPREGADOR', 'cnpj'], ['CPF/CNPJ DO EMPREGADOR', 'cnpj'],

  ['REP', 'clockID'], ['N REP', 'clockID'], ['NR REP', 'clockID'], ['NUMERO DO REP', 'clockID'],
  ['NUMERO REP', 'clockID'], ['N DO REP', 'clockID'], ['ID DO REP', 'clockID'], ['REP C', 'clockID'],
  ['REP A', 'clockID'], ['REP P', 'clockID'], ['N FABRICACAO', 'clockID'], ['N DE FABRICACAO', 'clockID'],
  ['NUMERO DE FABRICACAO', 'clockID'], ['N FAB', 'clockID'], ['NUMERO DE SERIE', 'clockID'],
  ['N SERIE', 'clockID'], ['RELOGIO', 'clockID'], ['EQUIPAMENTO', 'clockID'], ['COLETOR', 'clockID'],
  ['TERMINAL', 'clockID'], ['IDENTIFICADOR DO REP', 'clockID'],

  ['NSR', 'ticketNumber'], ['N S R', 'ticketNumber'], ['TICKET', 'ticketNumber'], ['N TICKET', 'ticketNumber'],
  ['NUMERO DO TICKET', 'ticketNumber'], ['COMPROVANTE N', 'ticketNumber'], ['SEQUENCIAL', 'ticketNumber'],
  ['N SEQUENCIAL', 'ticketNumber'], ['NUMERO SEQUENCIAL DO REGISTRO', 'ticketNumber'],

  ['CODIGO DE AUTENTICACAO', 'authCode'], ['AUTENTICACAO', 'authCode'], ['COD AUTENTICACAO', 'authCode'],
  ['HASH', 'authCode'], ['CODIGO HASH', 'authCode'], ['CHAVE', 'authCode'], ['ASSINATURA', 'authCode'],
  ['CODIGO', 'authCode'], ['COD VERIFICACAO', 'authCode'], ['CODIGO DE VERIFICACAO', 'authCode'],
  ['CODIGO DE CONTROLE', 'authCode'], ['CRC', 'authCode'],

  ['TIPO', 'markType'], ['TIPO DE MARCACAO', 'markType'], ['MARCACAO', 'markType'], ['EVENTO', 'markType'],
  ['OPERACAO', 'markType'], ['SENTIDO', 'markType'], ['MOVIMENTO', 'markType'],

  ['DATA', 'date'], ['DATA DO REGISTRO', 'date'], ['DATA DA MARCACAO', 'date'], ['DIA', 'date'],
  ['HORA', 'time'], ['HORARIO', 'time'], ['HORA DO REGISTRO', 'time'], ['DATA/HORA', 'date'], ['DATA E HORA', 'date'],

  ['LOCAL', 'ignored'], ['ENDERECO', 'ignored'], ['END', 'ignored'], ['CEI', 'ignored'], ['CAEPF', 'ignored'], ['CNO', 'ignored'],
];

function matchLabel(normalized: string, exact: boolean): { label: string; category: Category } | undefined {
  let best: { label: string; category: Category } | undefined;
  for (const [label, category] of LABELS) {
    const ok = exact ? normalized === label : normalized === label || normalized.startsWith(label + ' ');
    if (ok && label.length > (best?.label.length ?? 0)) best = { label, category };
  }
  return best;
}

/** Divide "RÓTULO: valor" ou "RÓTULO valor" (rótulos conhecidos). */
type Split = { label: string; category: Category; value: string; fuzzy?: boolean };

export function splitLabel(text: string): Split | undefined {
  // Ruído do OCR antes do rótulo ("| Saída", "À Matrícula:", "Sofa  REP:") é descartado.
  const cleaned = text.replace(/^[^\p{L}\p{N}]+/u, '');
  const direct = splitLabelClean(cleaned);
  if (direct && !direct.fuzzy) return direct;
  const words = cleaned.split(' ').filter(Boolean);
  for (let drop = 1; drop <= 2 && drop < words.length; drop++) {
    // Só descarta palavras curtas (lixo típico de borda/sombra), nunca o conteúdo.
    if (words.slice(0, drop).some((w) => w.length > 6)) break;
    const rest = splitLabelClean(words.slice(drop).join(' '));
    if (rest && !rest.fuzzy) return rest;
  }
  return direct;
}

/** Distância de edição (Levenshtein). */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Dígitos que o OCR coloca no lugar de letras em rótulos ("N5R" → "NSR", "0ATA" → "OATA"). */
const letterize = (s: string) => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');

/**
 * Rótulo aproximado ("DAZA" → DATA, "CPE" → CPF, "TONE" → NOME). Só para rótulos com
 * 3+ letras, tolerando 1 erro (2 em rótulos longos); a confiança do valor é reduzida.
 */
function fuzzyLabel(normalized: string): { label: string; category: Category } | undefined {
  const candidate = letterize(normalized);
  if (candidate.length < 3 || /\d/.test(candidate)) return undefined;
  let best: { label: string; category: Category; d: number } | undefined;
  for (const [label, category] of LABELS) {
    if (label.length < 3 || Math.abs(label.length - candidate.length) > 2) continue;
    const limit = label.length >= 8 ? 2 : 1;
    const d = editDistance(candidate, label);
    if (d <= limit && (!best || d < best.d || (d === best.d && label.length > best.label.length))) best = { label, category, d };
  }
  return best && { label: best.label, category: best.category };
}

function splitLabelClean(text: string): Split | undefined {
  const colon = text.indexOf(':');
  if (colon >= 0) {
    const normalized = normalizeLabel(text.slice(0, colon));
    const exact = matchLabel(normalized, true) ?? matchLabel(letterize(normalized), true);
    if (exact) return { ...exact, value: text.slice(colon + 1) };
    // Complemento sem números antes dos dois-pontos ("NOME DO TRABALHADOR (A):").
    // Com números, os dois-pontos são de um horário ("NSR 000000987 22/10/26 12:03").
    const prefix = matchLabel(normalized, false);
    if (prefix && prefix.label.length >= 3 && !/\d/.test(normalized.slice(prefix.label.length))) {
      return { ...prefix, value: text.slice(colon + 1) };
    }
  }
  const words = text.split(' ');
  for (let count = Math.min(5, words.length - 1); count >= 1; count--) {
    const candidate = normalizeLabel(words.slice(0, count).join(' '));
    if (candidate.split(' ').length !== count) continue;
    const m = matchLabel(candidate, true);
    if (m && m.label.length >= 3) return { ...m, value: words.slice(count).join(' ') };
  }
  // Rótulo deformado pelo OCR, sempre seguido de dois-pontos ("Daza: 01/10/2026").
  if (colon > 0 && colon <= 24) {
    const fuzzy = fuzzyLabel(normalizeLabel(text.slice(0, colon)));
    if (fuzzy) return { ...fuzzy, value: text.slice(colon + 1), fuzzy: true };
  }
  return undefined;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ex = <T>(value: T, confidence: number, source: string, note?: string): Extracted<T> =>
  note ? { value, confidence: clamp(confidence), source, note } : { value, confidence: clamp(confidence), source };

function isPlausibleName(text: string): boolean {
  const letters = [...text].filter((c) => /\p{L}/u.test(c)).length;
  return letters >= 3 && letters / Math.max(text.length, 1) > 0.6;
}

/** Códigos (REP, NSR, autenticação). */
function extractCode(text: string, allowSpaces = false): string | undefined {
  const source = allowSpaces ? text : text.split(' ')[0] ?? '';
  const code = source.replace(allowSpaces ? /[^\p{L}\p{N}\-/. ]/gu : /[^\p{L}\p{N}\-/.]/gu, '').trim();
  if (!code) return undefined;
  if (!/\d/.test(code) && code.length < 4) return undefined;
  return code;
}

/** Letras que o OCR confunde com dígitos, dentro de trechos numéricos. */
export function fixDigits(text: string): string {
  return text.replace(/[OoQD]/g, '0').replace(/[Il|iL!]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8').replace(/[Zz]/g, '2');
}

interface Candidate<T> { value: T; score: number; note?: string; line: number }

export interface ParserOptions {
  /** Intervalo de anos aceito (padrão: 2000 até o ano seguinte ao atual). */
  years?: [number, number];
}

export function parseTicket(rawLines: OCRLine[], options: ParserOptions = {}): ParsedTicket {
  const [minYear, maxYear] = options.years ?? [2000, new Date().getFullYear() + 1];
  const lines = rawLines
    .map((l) => ({ text: collapseSpaces(l.text), confidence: clamp(l.confidence) }))
    .filter((l) => l.text.length > 0);

  const result: ParsedTicket = {
    otherFields: [],
    fullText: lines.map((l) => l.text).join('\n'),
    averageConfidence: lines.length ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length : 0,
    warnings: [],
  };
  if (!lines.length) {
    result.warnings.push('Nenhum texto foi reconhecido. Tente outra foto, com mais luz e o ticket inteiro visível.');
    return result;
  }

  const dateLines = new Set<number>(), timeLines = new Set<number>(), markLines = new Set<number>();

  // 1. Pares rótulo/valor
  lines.forEach((original, index) => {
    let line = original;
    const split = splitLabel(line.text);
    if (!split) return;
    const value = split.value.replace(/^[\s:\-.]+|[\s:\-.]+$/g, '');
    // Rótulo reconhecido só por aproximação: o valor merece conferência.
    if (split.fuzzy) line = { ...line, confidence: line.confidence * 0.85 };
    switch (split.category) {
      case 'employeeName':
        if (!result.employeeName && isPlausibleName(value)) { result.employeeName = ex(value, line.confidence * 0.97, line.text); }
        break;
      case 'employeeID':
        if (!result.employeeID) { const id = extractIdentifier(value, split.label, line); if (id) { result.employeeID = id; } }
        break;
      case 'company':
        if (!result.company && isPlausibleName(value)) { result.company = ex(value, line.confidence * 0.97, line.text); }
        break;
      case 'cnpj':
        if (!result.cnpj) { const c = extractCNPJ(value, true, line); if (c) { result.cnpj = c; } }
        break;
      case 'clockID':
        if (!result.clockID) { const c = numericCode(value, line, split.label !== 'TERMINAL' && split.label !== 'EQUIPAMENTO'); if (c) result.clockID = c; }
        break;
      case 'ticketNumber':
        if (!result.ticketNumber) { const c = numericCode(value, line, split.label === 'NSR' || split.label === 'N S R'); if (c) result.ticketNumber = c; }
        break;
      case 'authCode':
        if (!result.authCode) { const c = extractCode(value, true); if (c) { result.authCode = ex(c, line.confidence * 0.9, line.text); } }
        break;
      case 'markType': markLines.add(index); break;
      case 'date':
        dateLines.add(index);
        if (fold(line.text).includes('HORA')) timeLines.add(index);
        break;
      case 'time': timeLines.add(index); break;
      case 'ignored': break;
    }
  });

  // 2. CNPJ formatado em qualquer linha
  if (!result.cnpj) {
    for (const line of lines) { const c = extractCNPJ(line.text, false, line); if (c) { result.cnpj = c; break; } }
  }

  // 3. Data e horário
  const dates = lines.flatMap((l, i) => findDates(l, i, minYear, maxYear));
  const date = choose(dates, new Set([...dateLines, ...timeLines]), lines);
  if (date) { result.date = date.value; if (date.warning) result.warnings.push(`Data: ${date.warning}`); }
  const dateLine = dates.find((d) => d.value === result.date?.value)?.line;
  const times = lines.flatMap((l, i) => findTimes(l, i));
  const preferredTime = new Set(timeLines);
  if (dateLine !== undefined) preferredTime.add(dateLine);
  const time = choose(times, preferredTime, lines);
  if (time) { result.time = time.value; if (time.warning) result.warnings.push(`Horário: ${time.warning}`); }

  // 4. Tipo de marcação
  result.markType = findMarkType(lines, markLines);
  if (!result.markType) {
    result.warnings.push('O tipo de marcação (entrada, saída, intervalo) não está impresso ou não foi reconhecido. Informe manualmente.');
  } else if (result.markType.value === 'indefinido') {
    result.warnings.push('O comprovante cita mais de um tipo de marcação. Confirme qual se aplica.');
  }

  // 5. Empresa sem rótulo
  if (!result.company) result.company = guessCompany(lines, result.cnpj?.source);

  // 6. Outros pares "rótulo: valor"
  const sources = new Set([result.employeeName, result.employeeID, result.company, result.cnpj, result.clockID, result.ticketNumber, result.authCode]
    .filter(Boolean).map((e) => e!.source));
  for (const line of lines) {
    if (sources.has(line.text)) continue;
    const colon = line.text.indexOf(':');
    if (colon < 0) continue;
    const label = line.text.slice(0, colon).trim().replace(/^[^\p{L}\p{N}]+/u, '');
    const value = line.text.slice(colon + 1).trim();
    if (!label || !value || label.length > 40) continue;
    const m = matchLabel(normalizeLabel(label), false);
    if (m && ['date', 'time', 'markType'].includes(m.category)) continue;
    result.otherFields.push({ label, value });
  }

  if (!result.date) result.warnings.push('Data do registro não encontrada.');
  if (!result.time) result.warnings.push('Horário do registro não encontrado.');
  if (result.cnpj?.note) result.warnings.push(`CNPJ: ${result.cnpj.note}`);
  if (result.employeeID?.note?.includes('inválido')) result.warnings.push(`Identificador: ${result.employeeID.note}`);
  return result;
}

/** Conveniência para texto simples (mesma confiança em todas as linhas). */
export function parseText(text: string, confidence = 1, options?: ParserOptions): ParsedTicket {
  return parseTicket(text.split(/\r?\n/).map((t) => ({ text: t, confidence })), options);
}

/**
 * Códigos que são sempre numéricos (NSR, nº do REP): letras parecidas com dígitos
 * ("OO0OOO317") são convertidas, com confiança reduzida e aviso.
 */
function numericCode(value: string, line: OCRLine, numeric: boolean): Extracted<string> | undefined {
  const code = extractCode(value);
  if (!code) return undefined;
  if (!numeric || /^\d+$/.test(code)) return ex(code, line.confidence * 0.95, line.text);
  const fixed = fixDigits(code.replace(/[Cc]/g, '0'));
  const digitShare = (code.match(/\d/g) ?? []).length / code.length;
  if (/^\d+$/.test(fixed) && digitShare >= 0.3) {
    return ex(fixed, Math.min(line.confidence * 0.75, CONFIRMATION_THRESHOLD - 0.05), line.text, `caracteres corrigidos (${code})`);
  }
  return ex(code, line.confidence * 0.6, line.text, 'código com caracteres inesperados — confira');
}

function extractIdentifier(value: string, label: string, line: OCRLine): Extracted<string> | undefined {
  const token = value.split(' ').slice(0, 3).join(' ');
  const code = extractCode(token, true);
  if (!code || !/\d/.test(code)) return undefined;
  const digits = digitsOnly(code);
  let confidence = line.confidence * 0.95;
  let note: string | undefined = label;
  if (label.startsWith('PIS') || label === 'NIT' || label === 'PASEP') {
    if (isValidPIS(digits)) note = 'PIS válido';
    else { note = 'PIS inválido — confira os dígitos'; confidence *= 0.6; }
  } else if (label.startsWith('CPF')) {
    if (isValidCPF(digits)) note = 'CPF válido';
    else { note = 'CPF inválido — confira os dígitos'; confidence *= 0.6; }
  }
  return ex(code, confidence, line.text, note);
}

function extractCNPJ(text: string, labeled: boolean, line: OCRLine): Extracted<string> | undefined {
  const upper = text.toUpperCase();
  const candidates: string[] = [];
  for (const m of upper.matchAll(/(?<![0-9A-Z])[0-9A-Z]{2}\s?\.\s?[0-9A-Z]{3}\s?\.\s?[0-9A-Z]{3}\s?\/\s?[0-9A-Z]{4}\s?-\s?[0-9]{2}(?![0-9])/g)) candidates.push(m[0]);
  if (labeled) {
    for (const m of upper.matchAll(/[0-9A-Z!|./\- ]{14,22}/g)) if (compactCNPJ(m[0].replace(/[!|]/g, '1')).length === 14) candidates.push(m[0].replace(/[!|]/g, '1'));
  }
  for (const candidate of candidates) {
    const compact = compactCNPJ(candidate);
    if (isValidCNPJ(compact)) return ex(formatCNPJ(compact), line.confidence * 0.98, line.text);
    const fixed = fixDigits(compact);
    if (fixed !== compact && isValidCNPJ(fixed)) {
      return ex(formatCNPJ(fixed), Math.min(line.confidence * 0.8, CONFIRMATION_THRESHOLD - 0.05), line.text, 'caracteres corrigidos automaticamente — confira');
    }
  }
  if (candidates.length) {
    const compact = compactCNPJ(candidates[0]);
    if (compact.length === 14) return ex(formatCNPJ(compact), line.confidence * 0.5, line.text, 'dígitos verificadores não conferem — confira');
  }
  return undefined;
}

const D = '[0-9OoIl|SB]';

function findDates(line: OCRLine, index: number, minYear: number, maxYear: number): Candidate<DayKey>[] {
  const out: Candidate<DayKey>[] = [];
  const re = new RegExp(`(?<![0-9A-Za-z])(${D}{1,2})\\s?[/.\\-]\\s?(${D}{1,2})\\s?[/.\\-]\\s?(${D}{4}|${D}{2})(?![0-9])`, 'g');
  for (const m of line.text.matchAll(re)) {
    const parts = [m[1], m[2], m[3]];
    const fixed = parts.map(fixDigits);
    const day = Number(fixed[0]), month = Number(fixed[1]);
    let year = Number(fixed[2]);
    let score = line.confidence;
    let note: string | undefined;
    if (m[3].length === 2) { year += 2000; score *= 0.95; }
    if (fixed.join('') !== parts.join('')) { score *= 0.75; note = `caracteres corrigidos (${m[0]})`; }
    const key = year >= minYear && year <= maxYear ? makeDay(year, month, day) : null;
    if (key) out.push({ value: key, score, note, line: index });
    else {
      // Data impossível ("23/16/2026"): o OCR costuma trocar 0 por 6, 8 ou 9 em fotos
      // borradas. Sugere a correção, sempre pedindo conferência.
      const rescued = rescueDigits(`${fixed[0].padStart(2, '0')}${fixed[1].padStart(2, '0')}`, (s) => {
        const k = year >= minYear && year <= maxYear ? makeDay(year, Number(s.slice(2)), Number(s.slice(0, 2))) : null;
        return k ?? undefined;
      });
      if (rescued) out.push({ value: rescued, score: Math.min(score * 0.5, CONFIRMATION_THRESHOLD - 0.1), note: `corrigido de ${m[0]} — confira`, line: index });
    }
  }
  for (const m of line.text.matchAll(/(?<![0-9])([0-9]{4})[/.\-]([0-9]{1,2})[/.\-]([0-9]{1,2})(?![0-9])/g)) {
    const year = Number(m[1]);
    const key = year >= minYear && year <= maxYear ? makeDay(year, Number(m[2]), Number(m[3])) : null;
    if (key) out.push({ value: key, score: line.confidence, line: index });
  }
  const folded = fold(line.text);
  const months = MONTH_ABBR.join('|');
  const re2 = new RegExp(`(?<![0-9])([0-9]{1,2})\\s?(?:DE\\s+|[/.\\-]\\s?)?(${months})[A-Z]*\\.?\\s?(?:DE\\s+|[/.\\-]\\s?)?([0-9]{4}|[0-9]{2})(?![0-9])`, 'g');
  for (const m of folded.matchAll(re2)) {
    let year = Number(m[3]);
    let score = line.confidence * 0.97;
    if (m[3].length === 2) { year += 2000; score *= 0.95; }
    const key = year >= minYear && year <= maxYear ? makeDay(year, MONTH_ABBR.indexOf(m[2]) + 1, Number(m[1])) : null;
    if (key) out.push({ value: key, score, line: index });
  }
  return out;
}

function findTimes(line: OCRLine, index: number): Candidate<TimeText>[] {
  const out: Candidate<TimeText>[] = [];
  const d = '[0-9OoIl|]';
  const re = new RegExp(`(?<![0-9A-Za-z/.,])(${d}{1,2})\\s?[:hH]\\s?(${d}{2})(?:\\s?:\\s?(${d}{2}))?(?![0-9/])`, 'g');
  for (const m of line.text.matchAll(re)) {
    if ((m[0].match(/\d/g) ?? []).length < 2) continue;
    const h = fixDigits(m[1]), mi = fixDigits(m[2]), s = m[3] !== undefined ? fixDigits(m[3]) : undefined;
    let time = makeTime(Number(h), Number(mi), s !== undefined ? Number(s) : undefined);
    let rescuedNote: string | undefined;
    if (!time) {
      // Horário impossível ("12:69"): tenta as trocas típicas do OCR, sempre pedindo conferência.
      time = rescueDigits(`${h.padStart(2, '0')}${mi}`, (v) => makeTime(Number(v.slice(0, 2)), Number(v.slice(2)), s !== undefined ? Number(s) : undefined) ?? undefined) ?? null;
      if (!time) continue;
      rescuedNote = `corrigido de ${m[0]} — confira`;
    }
    let score = line.confidence;
    let note: string | undefined;
    if (h !== m[1] || mi !== m[2] || s !== m[3]) { score *= 0.75; note = `caracteres corrigidos (${m[0]})`; }
    if (/h/i.test(m[0])) score *= 0.97;
    if (rescuedNote) { score = Math.min(score * 0.5, CONFIRMATION_THRESHOLD - 0.1); note = rescuedNote; }
    out.push({ value: time, score, note, line: index });
  }
  return out;
}

/** Trocas que o OCR faz com dígitos em fotos borradas (o "0" vira 6, 8 ou 9 etc.). */
const CONFUSIONS: Record<string, string[]> = { '6': ['0', '5'], '8': ['0', '3'], '9': ['0'], '7': ['1'], '3': ['8'], '0': ['8', '6'], '5': ['6'], '1': ['7'] };

/** Tenta trocar um dígito de cada vez até obter um valor válido (ou desiste). */
function rescueDigits<T>(digits: string, validate: (s: string) => T | undefined): T | undefined {
  for (let i = 0; i < digits.length; i++) {
    for (const alt of CONFUSIONS[digits[i]] ?? []) {
      const v = validate(digits.slice(0, i) + alt + digits.slice(i + 1));
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function choose<T>(candidates: Candidate<T>[], preferred: Set<number>, lines: OCRLine[]): { value: Extracted<T>; warning?: string } | undefined {
  if (!candidates.length) return undefined;
  const ranked = candidates
    .map((c) => ({ c, s: c.score * (preferred.size === 0 || preferred.has(c.line) ? 1 : 0.92) }))
    .sort((a, b) => b.s - a.s);
  const best = ranked[0];
  const distinct = new Set(candidates.map((c) => c.value)).size;
  let confidence = best.s;
  let warning: string | undefined;
  if (distinct > 1) {
    // Valores diferentes no mesmo ticket: nunca assumir.
    confidence = Math.min(confidence * 0.6, CONFIRMATION_THRESHOLD - 0.05);
    warning = `foram encontrados ${distinct} valores diferentes; confirme o correto.`;
  }
  return { value: ex(best.c.value, confidence, lines[best.c.line].text, best.c.note), warning };
}

const MARK_PHRASES: [string, MarkType][] = [
  ['INICIO DO INTERVALO', 'inicioIntervalo'], ['INICIO INTERVALO', 'inicioIntervalo'], ['INICIO DE INTERVALO', 'inicioIntervalo'],
  ['SAIDA PARA INTERVALO', 'inicioIntervalo'], ['SAIDA INTERVALO', 'inicioIntervalo'], ['SAIDA PARA ALMOCO', 'inicioIntervalo'],
  ['SAIDA ALMOCO', 'inicioIntervalo'], ['SAIDA REFEICAO', 'inicioIntervalo'], ['SAIDA PARA REFEICAO', 'inicioIntervalo'],
  ['INTERVALO INICIO', 'inicioIntervalo'], ['INI INTERVALO', 'inicioIntervalo'],
  ['FIM DO INTERVALO', 'fimIntervalo'], ['FIM INTERVALO', 'fimIntervalo'], ['FIM DE INTERVALO', 'fimIntervalo'],
  ['RETORNO DO INTERVALO', 'fimIntervalo'], ['RETORNO INTERVALO', 'fimIntervalo'], ['RETORNO DE INTERVALO', 'fimIntervalo'],
  ['RETORNO DO ALMOCO', 'fimIntervalo'], ['RETORNO ALMOCO', 'fimIntervalo'], ['VOLTA DO ALMOCO', 'fimIntervalo'],
  ['VOLTA ALMOCO', 'fimIntervalo'], ['RETORNO REFEICAO', 'fimIntervalo'], ['INTERVALO FIM', 'fimIntervalo'],
  ['RETORNO', 'fimIntervalo'],
  ['ENTRADA', 'entrada'],
  ['SAIDA', 'saida'],
];

function findMarkType(lines: OCRLine[], labeled: Set<number>): Extracted<MarkType> | undefined {
  const found: { type: MarkType; confidence: number; source: string }[] = [];
  lines.forEach((line, index) => {
    let text = ` ${normalizeLabel(line.text)} `;
    // Cabeçalhos genéricos não indicam o tipo.
    for (const header of ['REGISTRO DE ENTRADA E SAIDA', 'ENTRADA E SAIDA', 'ENTRADA/SAIDA', 'ENTRADAS E SAIDAS']) text = text.split(header).join(' ');
    for (const [phrase, type] of MARK_PHRASES) {
      if (text.includes(` ${phrase} `)) {
        found.push({ type, confidence: line.confidence * (labeled.has(index) ? 0.97 : 0.9), source: line.text });
        text = text.split(` ${phrase} `).join(' ');
      }
    }
  });
  if (!found.length) return undefined;
  const types = new Set(found.map((f) => f.type));
  if (types.size > 1) {
    return ex<MarkType>('indefinido', 0, found.map((f) => f.source).join(' | '), 'tipos conflitantes: ' + found.map((f) => MARK_LABEL[f.type]).join(', '));
  }
  return ex(found[0].type, Math.max(...found.map((f) => f.confidence)), found[0].source);
}

const COMPANY_SUFFIXES = ['LTDA', 'S/A', 'S A', 'SA', 'ME', 'EPP', 'EIRELI', 'MEI', 'CIA', 'COMERCIO', 'INDUSTRIA', 'SERVICOS',
  'HOSPITAL', 'SUPERMERCADO', 'SUPERMERCADOS', 'ASSOCIACAO', 'COOPERATIVA', 'FUNDACAO', 'INSTITUTO', 'CONDOMINIO', 'LOJAS'];
const HEADER_WORDS = ['COMPROVANTE', 'REGISTRO DE PONTO', 'PONTO DO TRABALHADOR', 'CNPJ', 'LOCAL', 'ENDERECO'];

function guessCompany(lines: OCRLine[], cnpjSource?: string): Extracted<string> | undefined {
  for (const line of lines.slice(0, 8)) {
    const normalized = normalizeLabel(line.text);
    const words = new Set(normalized.split(' '));
    if (HEADER_WORDS.some((h) => normalized.includes(h)) || !isPlausibleName(line.text) || splitLabel(line.text)) continue;
    if (COMPANY_SUFFIXES.some((s) => (s.includes(' ') ? normalized.includes(s) : words.has(s)))) {
      return ex(line.text, line.confidence * 0.75, line.text, 'identificada sem rótulo — confira');
    }
  }
  if (cnpjSource) {
    const i = lines.findIndex((l) => l.text === cnpjSource);
    if (i > 0) {
      const prev = lines[i - 1];
      const normalized = normalizeLabel(prev.text);
      if (!HEADER_WORDS.some((h) => normalized.includes(h)) && isPlausibleName(prev.text) && !splitLabel(prev.text)) {
        return ex(prev.text, prev.confidence * 0.6, prev.text, 'identificada pela posição — confira');
      }
    }
  }
  return undefined;
}
