import type { DayKey, TimeText } from './calendar';

/** Tipo de marcação. `indefinido` = não impresso ou não reconhecido (nunca deduzido). */
export type MarkType = 'entrada' | 'saida' | 'inicioIntervalo' | 'fimIntervalo' | 'indefinido';

export const MARK_TYPES: MarkType[] = ['entrada', 'saida', 'inicioIntervalo', 'fimIntervalo', 'indefinido'];

export const MARK_LABEL: Record<MarkType, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  inicioIntervalo: 'Início de intervalo',
  fimIntervalo: 'Fim de intervalo',
  indefinido: 'Não identificado',
};

export const startsWork = (t: MarkType) => t === 'entrada' || t === 'fimIntervalo';
export const endsWork = (t: MarkType) => t === 'saida' || t === 'inicioIntervalo';

/** Linha reconhecida pelo OCR, confiança 0…1. */
export interface OCRLine {
  text: string;
  confidence: number;
}

/** Valor extraído automaticamente, com confiança e linha de origem. */
export interface Extracted<T> {
  value: T;
  confidence: number;
  source: string;
  note?: string;
}

export interface LabeledValue {
  label: string;
  value: string;
}

export type TicketField =
  | 'employeeName' | 'employeeID' | 'company' | 'cnpj' | 'date' | 'time' | 'markType' | 'clockID' | 'ticketNumber' | 'authCode';

export const TICKET_FIELDS: TicketField[] = ['date', 'time', 'markType', 'company', 'cnpj', 'employeeName', 'employeeID', 'clockID', 'ticketNumber', 'authCode'];

export const FIELD_LABEL: Record<TicketField, string> = {
  employeeName: 'Funcionário',
  employeeID: 'Matrícula / identificador',
  company: 'Empresa',
  cnpj: 'CNPJ',
  date: 'Data do registro',
  time: 'Horário',
  markType: 'Tipo de marcação',
  clockID: 'Relógio de ponto (REP)',
  ticketNumber: 'Nº do ticket / NSR',
  authCode: 'Código de autenticação',
};

/** Data, horário e tipo: com dúvida, o usuário precisa confirmar. */
export const CRITICAL_FIELDS: TicketField[] = ['date', 'time', 'markType'];

/** Abaixo deste valor o campo é destacado para confirmação. */
export const CONFIRMATION_THRESHOLD = 0.85;

export interface ParsedTicket {
  employeeName?: Extracted<string>;
  employeeID?: Extracted<string>;
  company?: Extracted<string>;
  cnpj?: Extracted<string>;
  date?: Extracted<DayKey>;
  time?: Extracted<TimeText>;
  markType?: Extracted<MarkType>;
  clockID?: Extracted<string>;
  ticketNumber?: Extracted<string>;
  authCode?: Extracted<string>;
  otherFields: LabeledValue[];
  fullText: string;
  averageConfidence: number;
  warnings: string[];
}

export function fieldConfidence(p: ParsedTicket, field: TicketField): number | undefined {
  if (field === 'markType') return p.markType ? (p.markType.value === 'indefinido' ? 0 : p.markType.confidence) : undefined;
  return p[field]?.confidence;
}

export function needsConfirmation(p: ParsedTicket, field: TicketField): boolean {
  const c = fieldConfidence(p, field);
  if (c === undefined) return CRITICAL_FIELDS.includes(field);
  return c < CONFIRMATION_THRESHOLD;
}

export function fieldConfidences(p: ParsedTicket): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of TICKET_FIELDS) {
    const c = fieldConfidence(p, f);
    if (c !== undefined) out[f] = c;
  }
  return out;
}

/** Alteração de um campo, registrada separadamente do comprovante original. */
export interface ChangeEntry {
  id: string;
  date: string; // ISO 8601
  field: string;
  oldValue: string;
  newValue: string;
}

/** Ticket armazenado. As imagens ficam à parte (ver services/db). */
export interface TicketRecord {
  id: string;
  /** Nome do arquivo importado ou gerado para fotos da câmera. */
  originalFileName: string;
  originalMimeType: string;
  /** Existe imagem tratada (cópia recortada/realçada usada no OCR). */
  hasProcessedImage: boolean;
  /** dHash da imagem tratada (16 dígitos hexadecimais). */
  imageHash?: string;

  /** Texto integral reconhecido — nunca alterado. */
  ocrText: string;
  ocrConfidence: number;
  fieldConfidences: Record<string, number>;
  /** Valores extraídos antes de qualquer correção. */
  ocrSnapshot?: ParsedTicket;

  recordDate?: DayKey;
  recordTime?: TimeText;
  markType: MarkType;
  company: string;
  cnpj: string;
  employeeName: string;
  employeeID: string;
  clockID: string;
  ticketNumber: string;
  authCode: string;
  otherFields: LabeledValue[];

  importedAt: string; // ISO 8601
  updatedAt: string;
  isConfirmed: boolean;
  isFlagged: boolean;
  notes: string;
  tags: string[];
  /** Associação manual a uma jornada (ex.: turno que atravessa a meia-noite). */
  journeyDate?: DayKey;
  changes: ChangeEntry[];
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function emptyRecord(partial: Partial<TicketRecord> = {}): TicketRecord {
  const now = new Date().toISOString();
  return {
    id: newId(),
    originalFileName: '',
    originalMimeType: 'image/jpeg',
    hasProcessedImage: false,
    ocrText: '',
    ocrConfidence: 0,
    fieldConfidences: {},
    markType: 'indefinido',
    company: '',
    cnpj: '',
    employeeName: '',
    employeeID: '',
    clockID: '',
    ticketNumber: '',
    authCode: '',
    otherFields: [],
    importedAt: now,
    updatedAt: now,
    isConfirmed: false,
    isFlagged: false,
    notes: '',
    tags: [],
    changes: [],
    ...partial,
  };
}

/** Registro inicial a partir do OCR (ainda não confirmado). */
export function recordFromParsed(p: ParsedTicket, partial: Partial<TicketRecord> = {}): TicketRecord {
  return emptyRecord({
    ocrText: p.fullText,
    ocrConfidence: p.averageConfidence,
    fieldConfidences: fieldConfidences(p),
    ocrSnapshot: p,
    recordDate: p.date?.value,
    recordTime: p.time?.value,
    markType: p.markType?.value ?? 'indefinido',
    company: p.company?.value ?? '',
    cnpj: p.cnpj?.value ?? '',
    employeeName: p.employeeName?.value ?? '',
    employeeID: p.employeeID?.value ?? '',
    clockID: p.clockID?.value ?? '',
    ticketNumber: p.ticketNumber?.value ?? '',
    authCode: p.authCode?.value ?? '',
    otherFields: p.otherFields,
    ...partial,
  });
}

export const isIncomplete = (r: TicketRecord) => !r.recordDate || !r.recordTime || r.markType === 'indefinido';
export const needsReview = (r: TicketRecord) => !r.isConfirmed || isIncomplete(r) || r.isFlagged;
/** Dia da jornada (associação manual ou data impressa). */
export const workdayOf = (r: TicketRecord) => r.journeyDate ?? r.recordDate;

/** Ordem pela data e horário impressos; sem data vai para o fim (pela data de inclusão). */
export function chronological(a: TicketRecord, b: TicketRecord): number {
  if (a.recordDate !== b.recordDate) {
    if (!a.recordDate) return 1;
    if (!b.recordDate) return -1;
    return a.recordDate < b.recordDate ? -1 : 1;
  }
  const ta = a.recordTime ?? '99', tb = b.recordTime ?? '99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : 0;
}
