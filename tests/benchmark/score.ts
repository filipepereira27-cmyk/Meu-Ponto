import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hhmm } from '../../src/core/calendar';
import { fold } from '../../src/core/text';
import { needsConfirmation, type ParsedTicket, type TicketField } from '../../src/core/types';

export interface Truth { date?: string; time?: string; cnpj?: string; ticketNumber?: string; employeeName?: string; company?: string; markType?: string }
export const truthTable: Record<string, Truth> = JSON.parse(readFileSync(resolve(import.meta.dirname, 'gabarito.json'), 'utf8'));

const norm = (s: string) => fold(s).replace(/[^A-Z0-9]/g, '');

export interface FieldScore { field: string; ok: boolean; got?: string; silentError: boolean }

/** Compara campo a campo. "Erro silencioso" = valor errado sem pedir confirmação. */
export function score(p: ParsedTicket, t: Truth): FieldScore[] {
  const out: FieldScore[] = [];
  const check = (field: keyof Truth, got: string | undefined, eq: (a: string, b: string) => boolean, critical: TicketField) => {
    const expected = t[field];
    if (expected === undefined) return;
    const ok = got !== undefined && eq(got, expected);
    out.push({ field, ok, got, silentError: got !== undefined && !ok && !needsConfirmation(p, critical) });
  };
  check('date', p.date?.value, (a, b) => a === b, 'date');
  check('time', p.time?.value, (a, b) => hhmm(a) === b, 'time');
  check('markType', p.markType?.value, (a, b) => a === b, 'markType');
  check('cnpj', p.cnpj?.value, (a, b) => norm(a) === norm(b), 'cnpj');
  check('ticketNumber', p.ticketNumber?.value, (a, b) => norm(a).replace(/^0+/, '') === b, 'ticketNumber');
  check('employeeName', p.employeeName?.value, (a, b) => norm(a) === norm(b), 'employeeName');
  check('company', p.company?.value, (a, b) => norm(a) === norm(b), 'company');
  return out;
}
