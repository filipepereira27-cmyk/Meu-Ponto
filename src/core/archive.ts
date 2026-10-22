import {
  MONTH_NAMES, WEEKDAY_NAMES, brDate, hhmm, minutesOf, monthOf, parseDay, weekday,
  type DayKey, type MonthKey,
} from './calendar';
import { hashDistance } from './imageOps';
import { fold, searchTokens } from './text';
import { compactCNPJ } from './validators';
import {
  MARK_LABEL, chronological, isIncomplete, newId,
  type ChangeEntry, type MarkType, type TicketRecord,
} from './types';

// ─── Busca e filtros ───────────────────────────────────────────────────────────

export interface TicketFilter {
  text: string;
  dateFrom?: DayKey;
  dateTo?: DayKey;
  month?: MonthKey;
  company: string;
  employee: string;
  markTypes: MarkType[];
  /** Faixa de horário em minutos desde a meia-noite (inclusiva). */
  timeFrom?: number;
  timeTo?: number;
  tags: string[];
  onlyIncomplete: boolean;
  onlyFlagged: boolean;
  onlyPendingReview: boolean;
}

export const emptyFilter = (): TicketFilter => ({
  text: '', company: '', employee: '', markTypes: [], tags: [],
  onlyIncomplete: false, onlyFlagged: false, onlyPendingReview: false,
});

export function activeFilterCount(f: TicketFilter): number {
  return [
    f.dateFrom || f.dateTo, f.month, f.company, f.employee, f.markTypes.length, f.timeFrom !== undefined || f.timeTo !== undefined,
    f.tags.length, f.onlyIncomplete, f.onlyFlagged, f.onlyPendingReview,
  ].filter(Boolean).length;
}

/**
 * Texto pesquisável de um ticket: todos os campos, o texto integral do OCR, observações,
 * etiquetas e formas alternativas de data e hora ("22/10", "outubro", "quinta-feira", "8h01").
 */
export function searchableText(r: TicketRecord): string {
  const parts = [
    r.ocrText, r.company, r.cnpj, compactCNPJ(r.cnpj), r.employeeName, r.employeeID, r.clockID, r.ticketNumber,
    r.authCode, r.notes, r.originalFileName, MARK_LABEL[r.markType], r.tags.join(' '),
    ...r.otherFields.flatMap((f) => [f.label, f.value]),
  ];
  if (r.recordDate) {
    const { year, month, day } = parseDay(r.recordDate);
    parts.push(brDate(r.recordDate), `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`, r.recordDate,
      MONTH_NAMES[month - 1], String(year), WEEKDAY_NAMES[weekday(r.recordDate)]);
  }
  if (r.recordTime) {
    const [h, m] = r.recordTime.split(':');
    parts.push(hhmm(r.recordTime), r.recordTime, `${Number(h)}h${m}`);
  }
  return fold(parts.join(' '));
}

/** Termos da consulta normalizados: "8:01"/"8h01" → "08:01"; "22/10/26" → "22/10/2026". */
export function queryTokens(query: string): string[] {
  return searchTokens(query).map((token) => {
    let m = token.match(/^(\d{1,2})[:H](\d{2})$/);
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${m[1].padStart(2, '0')}:${m[2]}`;
    m = token.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$/);
    if (m) {
      let out = `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}`;
      if (m[3]) out += `/${m[3].length === 2 ? 2000 + Number(m[3]) : m[3]}`;
      return out;
    }
    return token;
  });
}

export function matchesFilter(r: TicketRecord, f: TicketFilter, cachedText?: string, tokens?: string[]): boolean {
  if (f.dateFrom || f.dateTo || f.month) {
    if (!r.recordDate) return false;
    if (f.dateFrom && r.recordDate < f.dateFrom) return false;
    if (f.dateTo && r.recordDate > f.dateTo) return false;
    if (f.month && monthOf(r.recordDate) !== f.month) return false;
  }
  if (f.timeFrom !== undefined || f.timeTo !== undefined) {
    if (!r.recordTime) return false;
    const minutes = minutesOf(r.recordTime);
    if (f.timeFrom !== undefined && minutes < f.timeFrom) return false;
    if (f.timeTo !== undefined && minutes > f.timeTo) return false;
  }
  if (f.markTypes.length && !f.markTypes.includes(r.markType)) return false;
  if (f.company && !fold(`${r.company} ${r.cnpj}`).includes(fold(f.company))) return false;
  if (f.employee && !fold(`${r.employeeName} ${r.employeeID}`).includes(fold(f.employee))) return false;
  if (f.tags.length && !f.tags.some((t) => r.tags.includes(t))) return false;
  if (f.onlyIncomplete && !isIncomplete(r)) return false;
  if (f.onlyFlagged && !r.isFlagged) return false;
  if (f.onlyPendingReview && r.isConfirmed) return false;
  if (f.text.trim()) {
    const haystack = cachedText ?? searchableText(r);
    for (const token of tokens ?? queryTokens(f.text)) if (!haystack.includes(token)) return false;
  }
  return true;
}

/** Filtra e ordena pela data/horário impressos. */
export function applyFilter(records: TicketRecord[], f: TicketFilter, textCache?: Map<string, string>): TicketRecord[] {
  const tokens = queryTokens(f.text);
  return records
    .filter((r) => matchesFilter(r, f, textCache?.get(r.id), tokens))
    .sort(chronological);
}

// ─── Histórico de alterações ───────────────────────────────────────────────────

export function diffRecords(old: TicketRecord, next: TicketRecord, date = new Date()): ChangeEntry[] {
  const v = (s: string) => (s ? s : '(vazio)');
  const pairs: [string, string, string][] = [
    ['Data do registro', old.recordDate ? brDate(old.recordDate) : '', next.recordDate ? brDate(next.recordDate) : ''],
    ['Horário', old.recordTime ?? '', next.recordTime ?? ''],
    ['Tipo de marcação', MARK_LABEL[old.markType], MARK_LABEL[next.markType]],
    ['Empresa', old.company, next.company],
    ['CNPJ', old.cnpj, next.cnpj],
    ['Funcionário', old.employeeName, next.employeeName],
    ['Matrícula / identificador', old.employeeID, next.employeeID],
    ['Relógio de ponto (REP)', old.clockID, next.clockID],
    ['Nº do ticket / NSR', old.ticketNumber, next.ticketNumber],
    ['Código de autenticação', old.authCode, next.authCode],
    ['Observações', old.notes, next.notes],
    ['Etiquetas', old.tags.join(', '), next.tags.join(', ')],
    ['Jornada associada', old.journeyDate ? brDate(old.journeyDate) : '', next.journeyDate ? brDate(next.journeyDate) : ''],
    ['Situação da revisão', old.isConfirmed ? 'Confirmada' : 'Pendente', next.isConfirmed ? 'Confirmada' : 'Pendente'],
    ['Sinalizado para conferência', old.isFlagged ? 'Sim' : 'Não', next.isFlagged ? 'Sim' : 'Não'],
  ];
  return pairs
    .filter(([, a, b]) => a !== b)
    .map(([field, a, b]) => ({ id: newId(), date: date.toISOString(), field, oldValue: v(a), newValue: v(b) }));
}

/** Aplica uma edição registrando cada campo alterado no histórico. O texto do OCR nunca muda. */
export function applyEdit(old: TicketRecord, edited: TicketRecord, date = new Date()): TicketRecord {
  const changes = diffRecords(old, edited, date);
  if (!changes.length) return old;
  return {
    ...edited,
    id: old.id,
    ocrText: old.ocrText,
    ocrSnapshot: old.ocrSnapshot,
    importedAt: old.importedAt,
    updatedAt: date.toISOString(),
    changes: [...old.changes, ...changes],
  };
}

// ─── Duplicidades ──────────────────────────────────────────────────────────────

export type DuplicateReason = 'sameAuthCode' | 'sameTicketNumber' | 'sameDateTimeAndType' | 'similarImage';

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  sameAuthCode: 'Mesmo código de autenticação',
  sameTicketNumber: 'Mesmo NSR / nº do ticket no mesmo relógio',
  sameDateTimeAndType: 'Mesma data, horário e tipo de marcação',
  similarImage: 'Imagens muito parecidas',
};

export interface DuplicateMatch {
  first: string;
  second: string;
  reasons: DuplicateReason[];
}

export const IMAGE_DISTANCE_THRESHOLD = 6;

export const isStrongDuplicate = (m: DuplicateMatch) =>
  m.reasons.includes('sameAuthCode') || m.reasons.includes('sameTicketNumber') || m.reasons.length >= 2;

const norm = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, '');
const noLeadingZeros = (s: string) => norm(s).replace(/^0+/, '');

/** O app só sinaliza; quem decide é o usuário. */
export function compareTickets(a: TicketRecord, b: TicketRecord): DuplicateMatch | undefined {
  if (a.id === b.id) return undefined;
  const reasons: DuplicateReason[] = [];
  if (norm(a.authCode) && norm(a.authCode) === norm(b.authCode)) reasons.push('sameAuthCode');
  if (noLeadingZeros(a.ticketNumber) && noLeadingZeros(a.ticketNumber) === noLeadingZeros(b.ticketNumber) && norm(a.clockID) === norm(b.clockID)) {
    reasons.push('sameTicketNumber');
  }
  if (a.recordDate && a.recordDate === b.recordDate && a.recordTime && b.recordTime && hhmm(a.recordTime) === hhmm(b.recordTime)
    && a.markType === b.markType && (!a.company || !b.company || norm(a.company) === norm(b.company))) {
    reasons.push('sameDateTimeAndType');
  }
  if (a.imageHash && b.imageHash && hashDistance(a.imageHash, b.imageHash) <= IMAGE_DISTANCE_THRESHOLD) reasons.push('similarImage');
  return reasons.length ? { first: a.id, second: b.id, reasons } : undefined;
}

export function duplicatesOf(candidate: TicketRecord, existing: TicketRecord[]): DuplicateMatch[] {
  return existing.map((e) => compareTickets(candidate, e)).filter((m): m is DuplicateMatch => !!m);
}

/** Todas as duplicidades, comparando em detalhe só pares que compartilham alguma chave. */
export function allDuplicates(records: TicketRecord[]): DuplicateMatch[] {
  const buckets = new Map<string, number[]>();
  const add = (key: string, i: number) => buckets.set(key, [...(buckets.get(key) ?? []), i]);
  records.forEach((r, i) => {
    if (norm(r.authCode)) add(`a:${norm(r.authCode)}`, i);
    if (noLeadingZeros(r.ticketNumber)) add(`n:${noLeadingZeros(r.ticketNumber)}`, i);
    if (r.recordDate && r.recordTime) add(`d:${r.recordDate} ${hhmm(r.recordTime)}`, i);
  });
  const pairs = new Set<string>();
  for (const idx of buckets.values()) for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) pairs.add(`${idx[i]},${idx[j]}`);
  const hashed = records.map((r, i) => [i, r.imageHash] as const).filter(([, h]) => !!h);
  for (let i = 0; i < hashed.length; i++) for (let j = i + 1; j < hashed.length; j++) {
    if (hashDistance(hashed[i][1]!, hashed[j][1]!) <= IMAGE_DISTANCE_THRESHOLD) pairs.add(`${hashed[i][0]},${hashed[j][0]}`);
  }
  return [...pairs]
    .map((p) => p.split(',').map(Number))
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
    .map(([i, j]) => compareTickets(records[i], records[j]))
    .filter((m): m is DuplicateMatch => !!m);
}
