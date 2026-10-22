/**
 * Datas e horários civis, como impressos no comprovante.
 *
 * Datas são chaves `aaaa-mm-dd` e horários `HH:MM` ou `HH:MM:SS`: sem fuso horário,
 * para que o dia do registro nunca mude por conversões. Ordenam corretamente como texto.
 */

export type DayKey = string;
export type TimeText = string;

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

export function makeDay(year: number, month: number, day: number): DayKey | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function parseDay(key: DayKey): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseDay(value);
  return makeDay(year, month, day) === value;
}

/** `22/10/2026` */
export function brDate(key: DayKey): string {
  const { year, month, day } = parseDay(key);
  return `${pad(day)}/${pad(month)}/${pad(year, 4)}`;
}

function utc(key: DayKey): number {
  const { year, month, day } = parseDay(key);
  return Date.UTC(year, month - 1, day);
}

/** 0 = domingo … 6 = sábado. */
export function weekday(key: DayKey): number {
  return new Date(utc(key)).getUTCDay();
}

export function addDays(key: DayKey, days: number): DayKey {
  const d = new Date(utc(key) + days * 86_400_000);
  return makeDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())!;
}

/** Dias de `a` até `b` (positivo se `b` for posterior). */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** Dia civil local de um instante. */
export function dayOf(date: Date): DayKey {
  return makeDay(date.getFullYear(), date.getMonth() + 1, date.getDate())!;
}

export const today = (): DayKey => dayOf(new Date());

// Horários

export function makeTime(hour: number, minute: number, second?: number): TimeText | null {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (second !== undefined && (!Number.isInteger(second) || second < 0 || second > 59)) return null;
  return second === undefined ? `${pad(hour)}:${pad(minute)}` : `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export function isTimeText(value: unknown): value is TimeText {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return false;
  const [h, m, s] = value.split(':').map(Number);
  return makeTime(h, m, s) === value;
}

export function minutesOf(time: TimeText): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function secondsOf(time: TimeText): number {
  const [h, m, s = 0] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** `08:01` (sem segundos) */
export const hhmm = (time: TimeText) => time.slice(0, 5);

// Meses

export type MonthKey = string; // aaaa-mm

export const monthOf = (key: DayKey): MonthKey => key.slice(0, 7);

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

export function daysOfMonth(month: MonthKey): DayKey[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => makeDay(y, m, i + 1)!);
}

export const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTH_ABBR = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
export const WEEKDAY_NAMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "outubro de 2026" */
export function monthName(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

/** Minutos como `7h48`, `-0h12`, `+0h30`. */
export function formatDuration(minutes: number, showSign = false): string {
  const sign = minutes < 0 ? '-' : showSign && minutes > 0 ? '+' : '';
  const v = Math.abs(minutes);
  return `${sign}${Math.floor(v / 60)}h${pad(v % 60)}`;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
