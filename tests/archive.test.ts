import { describe, expect, it } from 'vitest';
import {
  activeFilterCount, allDuplicates, applyEdit, applyFilter, compareTickets, diffRecords, emptyFilter, isStrongDuplicate,
} from '../src/core/archive';
import { addDays, addMonths, brDate, daysBetween, daysOfMonth, formatDuration, makeDay, weekday } from '../src/core/calendar';
import { chronological, emptyRecord } from '../src/core/types';
import { rec } from './fixtures';

const records = [
  rec('2026-10-22', '08:01', 'entrada'),
  rec('2026-10-22', '17:30', 'saida'),
  rec('2026-09-15', '12:00', 'inicioIntervalo', { company: 'COMERCIAL ALFA S/A' }),
  rec(undefined, '09:00', 'indefinido', { isConfirmed: false }),
];
const search = (text: string) => applyFilter(records, { ...emptyFilter(), text });

describe('busca', () => {
  it('por data brasileira, parcial e ano curto', () => {
    expect(search('22/10/2026')).toHaveLength(2);
    expect(search('22/10')).toHaveLength(2);
    expect(search('22/10/26')).toHaveLength(2);
  });
  it('horário em várias grafias', () => {
    for (const q of ['8:01', '08:01', '8h01']) expect(search(q).map((r) => r.recordTime)).toEqual(['08:01']);
  });
  it('mês, dia da semana, sem acento e vários termos', () => {
    expect(search('setembro')).toHaveLength(1);
    expect(search('quinta-feira')).toHaveLength(2);
    expect(search('saida')[0].markType).toBe('saida');
    expect(search('padaria entrada')).toHaveLength(1);
  });
  it('dentro do texto do OCR', () => {
    const r = emptyRecord({ ocrText: 'LOCAL: RUA DAS FLORES, 100', recordDate: '2026-01-02' });
    expect(applyFilter([r], { ...emptyFilter(), text: 'flores' })).toHaveLength(1);
  });
  it('filtros estruturados', () => {
    const f = emptyFilter();
    expect(applyFilter(records, { ...f, dateFrom: '2026-10-01', dateTo: '2026-10-31' })).toHaveLength(2);
    expect(applyFilter(records, { ...f, month: '2026-09' })).toHaveLength(1);
    expect(applyFilter(records, { ...f, company: 'alfa' })).toHaveLength(1);
    expect(applyFilter(records, { ...f, markTypes: ['entrada', 'saida'] })).toHaveLength(2);
    expect(applyFilter(records, { ...f, timeFrom: 660, timeTo: 780 })).toHaveLength(1);
    expect(applyFilter(records, { ...f, onlyIncomplete: true })).toHaveLength(1);
    expect(activeFilterCount({ ...f, onlyIncomplete: true })).toBe(1);
  });
  it('ordem pela data impressa, não pela inclusão', () => {
    const late = rec('2026-10-22', '17:00', 'saida', { importedAt: '2020-01-01T00:00:00Z' });
    const early = rec('2026-10-22', '08:00', 'entrada', { importedAt: '2026-10-22T20:00:00Z' });
    const undated = rec(undefined, undefined, 'indefinido', { importedAt: '2019-01-01T00:00:00Z' });
    expect([undated, late, early].sort(chronological).map((r) => r.id)).toEqual([early.id, late.id, undated.id]);
  });
  it('10 mil tickets', () => {
    const many = Array.from({ length: 10_000 }, (_, i) =>
      rec(addDays('2020-01-01', Math.floor(i / 4)), `${String(7 + (i % 4) * 3).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, 'entrada'));
    const t0 = performance.now();
    expect(applyFilter(many, { ...emptyFilter(), text: '15/03/2022' })).toHaveLength(4);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('histórico', () => {
  it('registra só os campos alterados e preserva o OCR', () => {
    const old = rec('2026-10-22', '08:01', 'indefinido', { isConfirmed: false, ocrText: 'TEXTO ORIGINAL' });
    const edited = { ...old, markType: 'entrada' as const, isConfirmed: true, notes: 'Conferido', ocrText: 'ALTERADO' };
    const changes = diffRecords(old, edited);
    expect(changes.map((c) => c.field)).toEqual(['Tipo de marcação', 'Observações', 'Situação da revisão']);
    expect(changes[0]).toMatchObject({ oldValue: 'Não identificado', newValue: 'Entrada' });
    expect(changes[1].oldValue).toBe('(vazio)');
    const saved = applyEdit(old, edited);
    expect(saved.ocrText).toBe('TEXTO ORIGINAL');
    expect(saved.changes).toHaveLength(3);
    expect(applyEdit(old, { ...old })).toBe(old);
  });
});

describe('duplicidades', () => {
  it('mesmo NSR no mesmo relógio é indício forte', () => {
    const a = rec('2026-10-22', '08:01', 'entrada', { ticketNumber: '000012345', clockID: 'X1' });
    const b = rec('2026-10-22', '08:01', 'entrada', { ticketNumber: '12345', clockID: 'X1' });
    const m = compareTickets(a, b)!;
    expect(m.reasons).toEqual(['sameTicketNumber', 'sameDateTimeAndType']);
    expect(isStrongDuplicate(m)).toBe(true);
  });
  it('só imagem parecida', () => {
    const a = rec('2026-10-22', '08:01', 'entrada', { imageHash: 'ffff0000ffff0000' });
    const b = rec('2026-10-23', '08:05', 'entrada', { imageHash: 'ffff0000ffff0007' });
    expect(compareTickets(a, b)?.reasons).toEqual(['similarImage']);
  });
  it('tickets diferentes', () => {
    expect(compareTickets(rec('2026-10-22', '08:01', 'entrada', { ticketNumber: '1' }), rec('2026-10-22', '17:30', 'saida', { ticketNumber: '2' }))).toBeUndefined();
  });
  it('varredura do arquivo', () => {
    const list = [rec('2026-10-22', '08:01', 'entrada', { authCode: 'ABC' }), rec('2026-10-22', '12:00', 'inicioIntervalo'), rec('2026-10-23', '08:00', 'entrada', { authCode: 'abc' })];
    const m = allDuplicates(list);
    expect(m).toHaveLength(1);
    expect(m[0].reasons).toEqual(['sameAuthCode']);
  });
});

describe('calendário', () => {
  it('aritmética e formatos', () => {
    expect(brDate('2026-10-22')).toBe('22/10/2026');
    expect(weekday('2026-10-22')).toBe(4);
    expect(addDays('2026-10-22', 10)).toBe('2026-11-01');
    expect(daysBetween('2026-10-22', '2027-01-01')).toBe(71);
    expect(makeDay(2026, 2, 29)).toBeNull();
    expect(makeDay(2028, 2, 29)).toBe('2028-02-29');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(daysOfMonth('2026-02')).toHaveLength(28);
    expect(formatDuration(-75)).toBe('-1h15');
    expect(formatDuration(30, true)).toBe('+0h30');
  });
});
