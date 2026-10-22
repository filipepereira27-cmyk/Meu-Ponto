import {
  WEEKDAY_NAMES, WEEKDAY_SHORT, brDate, daysBetween, daysOfMonth, formatDuration, minutesOf, monthOf, weekday,
  type DayKey, type MonthKey, type TimeText,
} from './calendar';
import { MARK_LABEL, endsWork, startsWork, workdayOf, type MarkType, type TicketRecord } from './types';

/** Jornada de referência configurada pelo usuário (apenas para comparação). */
export interface WorkSchedule {
  /** Minutos previstos por dia da semana (0 = domingo … 6 = sábado). */
  expectedMinutesByWeekday: number[];
  minimumBreakMinutes: number;
  breakRequiredAfterMinutes: number;
}

export const STANDARD_SCHEDULE: WorkSchedule = {
  expectedMinutesByWeekday: [0, 480, 480, 480, 480, 480, 0],
  minimumBreakMinutes: 60,
  breakRequiredAfterMinutes: 360,
};

export interface WorkdayMark {
  ticketId: string;
  date: DayKey;
  time: TimeText;
  type: MarkType;
  /** Minutos desde a meia-noite do dia da jornada (passa de 1440 em turnos noturnos). */
  minute: number;
}

/** Pendências: indícios para conferência, não conclusões. */
export type WorkdayIssue =
  | { kind: 'undefinedTypes'; count: number }
  | { kind: 'missingTime'; count: number }
  | { kind: 'consecutiveStarts'; at: TimeText }
  | { kind: 'endWithoutStart'; at: TimeText }
  | { kind: 'openPeriod'; since: TimeText }
  | { kind: 'shortBreak'; minutes: number }
  | { kind: 'noBreak' }
  | { kind: 'oddMarks' };

export function issueMessage(i: WorkdayIssue): string {
  switch (i.kind) {
    case 'undefinedTypes': return `${i.count} marcação(ões) sem tipo confirmado. Confirme entrada/saída para calcular a jornada.`;
    case 'missingTime': return `${i.count} ticket(s) deste dia sem data ou horário reconhecido.`;
    case 'consecutiveStarts': return `Duas marcações de início seguidas (${i.at}). Pode haver uma marcação de saída ausente.`;
    case 'endWithoutStart': return `Marcação de saída/intervalo às ${i.at} sem início correspondente. Pode haver uma entrada ausente.`;
    case 'openPeriod': return `Período iniciado às ${i.since} sem marcação de encerramento. Pode haver uma saída ausente.`;
    case 'shortBreak': return `Intervalo registrado de ${formatDuration(i.minutes)}, menor que a referência configurada.`;
    case 'noBreak': return 'Nenhum intervalo registrado em jornada acima da referência configurada.';
    case 'oddMarks': return 'Número ímpar de marcações. Pode haver marcação ausente.';
  }
}

/** Avisos sobre intervalo são informativos; os demais impedem somar o dia aos totais. */
export const isBlockingIssue = (i: WorkdayIssue) => i.kind !== 'shortBreak' && i.kind !== 'noBreak';

export interface WorkdaySummary {
  date: DayKey;
  marks: WorkdayMark[];
  gaps: number[];
  periods: { start: WorkdayMark; end: WorkdayMark; minutes: number }[];
  breaks: number[];
  /** `undefined` quando os tipos não permitem calcular. */
  workedMinutes?: number;
  expectedMinutes: number;
  issues: WorkdayIssue[];
}

export const isEstimate = (d: WorkdaySummary) => d.issues.length > 0;
export const balanceOf = (d: WorkdaySummary) => (d.workedMinutes === undefined ? undefined : d.workedMinutes - d.expectedMinutes);

/**
 * Resumo de um dia. O tipo de cada marcação vem do ticket (impresso ou confirmado):
 * nunca se presume que a primeira é entrada ou a última é saída.
 */
export function summarizeDay(day: DayKey, records: TicketRecord[], schedule: WorkSchedule = STANDARD_SCHEDULE): WorkdaySummary {
  const issues: WorkdayIssue[] = [];
  const missing = records.filter((r) => !r.recordDate || !r.recordTime).length;
  if (missing) issues.push({ kind: 'missingTime', count: missing });

  const marks: WorkdayMark[] = records
    .filter((r) => r.recordDate && r.recordTime)
    .map((r) => ({
      ticketId: r.id, date: r.recordDate!, time: r.recordTime!, type: r.markType,
      minute: daysBetween(day, r.recordDate!) * 1440 + minutesOf(r.recordTime!),
    }))
    .sort((a, b) => a.minute - b.minute || (a.time < b.time ? -1 : 1));

  const gaps = marks.slice(1).map((m, i) => m.minute - marks[i].minute);
  const periods: WorkdaySummary['periods'] = [];
  const breaks: number[] = [];
  let worked: number | undefined;

  const undefinedCount = marks.filter((m) => m.type === 'indefinido').length;
  if (undefinedCount) {
    issues.push({ kind: 'undefinedTypes', count: undefinedCount });
    if (marks.length % 2) issues.push({ kind: 'oddMarks' });
  } else {
    let open: WorkdayMark | undefined;
    let lastEnd: WorkdayMark | undefined;
    for (const mark of marks) {
      if (startsWork(mark.type)) {
        if (open) issues.push({ kind: 'consecutiveStarts', at: mark.time });
        else if (lastEnd) breaks.push(mark.minute - lastEnd.minute);
        open = mark;
        lastEnd = undefined;
      } else if (endsWork(mark.type)) {
        if (open) {
          periods.push({ start: open, end: mark, minutes: mark.minute - open.minute });
          open = undefined;
          lastEnd = mark;
        } else {
          issues.push({ kind: 'endWithoutStart', at: mark.time });
        }
      }
    }
    if (open) issues.push({ kind: 'openPeriod', since: open.time });
    if (marks.length) worked = periods.reduce((s, p) => s + p.minutes, 0);
    if (worked !== undefined && !issues.length && worked > schedule.breakRequiredAfterMinutes) {
      const total = breaks.reduce((s, b) => s + b, 0);
      if (!breaks.length) issues.push({ kind: 'noBreak' });
      else if (total < schedule.minimumBreakMinutes) issues.push({ kind: 'shortBreak', minutes: total });
    }
  }
  return {
    date: day, marks, gaps, periods, breaks, workedMinutes: worked,
    expectedMinutes: schedule.expectedMinutesByWeekday[weekday(day)], issues,
  };
}

export function groupByWorkday(records: TicketRecord[]): Map<DayKey, TicketRecord[]> {
  const map = new Map<DayKey, TicketRecord[]>();
  for (const r of records) {
    const d = workdayOf(r);
    if (d) map.set(d, [...(map.get(d) ?? []), r]);
  }
  return map;
}

export interface MonthSummary {
  month: MonthKey;
  days: WorkdaySummary[];
  /** Somente dias sem pendências que impeçam o cálculo. */
  workedMinutes: number;
  expectedMinutes: number;
  daysWithIssues: number;
  daysWithoutCalculation: number;
  expectedDaysWithoutTickets: DayKey[];
}

export function summarizeMonth(month: MonthKey, records: TicketRecord[], schedule: WorkSchedule = STANDARD_SCHEDULE, today?: DayKey): MonthSummary {
  const groups = groupByWorkday(records.filter((r) => { const d = workdayOf(r); return d && monthOf(d) === month; }));
  const days = [...groups.entries()].map(([d, rs]) => summarizeDay(d, rs, schedule)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const calculable = days.filter((d) => d.workedMinutes !== undefined && !d.issues.some(isBlockingIssue));
  const withTickets = new Set(days.map((d) => d.date));
  return {
    month,
    days,
    workedMinutes: calculable.reduce((s, d) => s + (d.workedMinutes ?? 0), 0),
    expectedMinutes: calculable.reduce((s, d) => s + d.expectedMinutes, 0),
    daysWithIssues: days.filter((d) => d.issues.length).length,
    daysWithoutCalculation: days.filter((d) => d.workedMinutes === undefined).length,
    // "Sem ticket" só considera dias que já passaram.
    expectedDaysWithoutTickets: daysOfMonth(month).filter((d) =>
      schedule.expectedMinutesByWeekday[weekday(d)] > 0 && !withTickets.has(d) && (!today || d < today)),
  };
}

// ─── CSV (Excel/Numbers em português: `;`, UTF-8 com BOM) ──────────────────────

function csvEscape(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function csvDocument(header: string[], rows: string[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\r\n') + '\r\n';
}

export function ticketsCSV(records: TicketRecord[]): string {
  const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR');
  return csvDocument(
    ['ID', 'Data do registro', 'Horário', 'Tipo de marcação', 'Empresa', 'CNPJ', 'Funcionário', 'Matrícula/identificador',
      'Relógio (REP)', 'NSR/Nº ticket', 'Código de autenticação', 'Revisão', 'Sinalizado', 'Etiquetas', 'Observações',
      'Confiança OCR (%)', 'Incluído em', 'Arquivo original'],
    [...records].sort((a, b) => (a.recordDate ?? '9') + (a.recordTime ?? '') < (b.recordDate ?? '9') + (b.recordTime ?? '') ? -1 : 1).map((r) => [
      r.id, r.recordDate ? brDate(r.recordDate) : '', r.recordTime ?? '', MARK_LABEL[r.markType], r.company, r.cnpj,
      r.employeeName, r.employeeID, r.clockID, r.ticketNumber, r.authCode, r.isConfirmed ? 'Confirmada' : 'Pendente',
      r.isFlagged ? 'Sim' : 'Não', r.tags.join(', '), r.notes, String(Math.round(r.ocrConfidence * 100)), fmt(r.importedAt),
      r.originalFileName,
    ]),
  );
}

export function workdaysCSV(days: WorkdaySummary[]): string {
  return csvDocument(
    ['Data', 'Dia da semana', 'Marcações', 'Tempo trabalhado', 'Intervalos', 'Jornada configurada', 'Diferença (indicativa)', 'Situação', 'Pendências'],
    days.map((d) => [
      brDate(d.date), WEEKDAY_NAMES[weekday(d.date)], d.marks.map((m) => `${m.time} ${MARK_LABEL[m.type]}`).join(' | '),
      d.workedMinutes === undefined ? 'Não calculado' : formatDuration(d.workedMinutes),
      formatDuration(d.breaks.reduce((s, b) => s + b, 0)), formatDuration(d.expectedMinutes),
      balanceOf(d) === undefined ? '' : formatDuration(balanceOf(d)!, true),
      isEstimate(d) ? 'Estimativa' : 'Calculado', d.issues.map(issueMessage).join(' / '),
    ]),
  );
}

export function scheduleDescription(s: WorkSchedule): string {
  const days = s.expectedMinutesByWeekday.map((m, i) => (m > 0 ? `${WEEKDAY_SHORT[i]} ${formatDuration(m)}` : '')).filter(Boolean);
  return `${days.join(', ')}; intervalo de referência ${formatDuration(s.minimumBreakMinutes)}`;
}
