import { describe, expect, it } from 'vitest';
import { addDays } from '../src/core/calendar';
import {
  STANDARD_SCHEDULE, nextDaysOff, planFor, scheduleDescription, shiftMinutes, summarizeDay, summarizeMonth,
  type RotatingSchedule, type WorkSchedule,
} from '../src/core/workday';
import { rec } from './fixtures';

/** Escala informada: 6x2, Letra B, desde seg 26/10/2026, folgas 29–30/10, 06:00–14:35. */
const escala: RotatingSchedule = {
  label: '6x2 — Letra B', validFrom: '2026-10-26', workDays: 6, offDays: 2, firstOffDay: '2026-10-29',
  start: '06:00', end: '14:35', breakMinutes: 60,
};
const schedule: WorkSchedule = { ...STANDARD_SCHEDULE, rotations: [escala] };
const offIn = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (planFor(schedule, d).off) out.push(d);
  return out;
};

describe('escala 6x2 (Letra B)', () => {
  it('folgas informadas pelo usuário', () => {
    expect(offIn('2026-10-26', '2026-11-16')).toEqual(['2026-10-29', '2026-10-30', '2026-11-06', '2026-11-07', '2026-11-14', '2026-11-15']);
  });
  it('continua a cada 8 dias', () => {
    expect(nextDaysOff(schedule, '2026-11-16', 6)).toEqual(['2026-11-22', '2026-11-23', '2026-11-30', '2026-12-01', '2026-12-08', '2026-12-09']);
  });
  it('dias de trabalho com turno 06:00–14:35', () => {
    const p = planFor(schedule, '2026-11-02');
    expect(p).toMatchObject({ off: false, start: '06:00', end: '14:35', expectedMinutes: 455 });
    expect(planFor(schedule, '2026-11-01').off).toBe(false); // domingo é dia de trabalho na escala
  });
  it('antes de 26/10 vale a jornada semanal antiga', () => {
    expect(planFor(schedule, '2026-10-24').off).toBe(true); // sábado
    expect(planFor(schedule, '2026-10-23')).toMatchObject({ off: false, expectedMinutes: 480 });
    expect(planFor(schedule, '2026-10-23').rotation).toBeUndefined();
  });
  it('intervalo configurável e turno noturno', () => {
    expect(shiftMinutes({ start: '06:00', end: '14:35', breakMinutes: 75 })).toBe(440);
    expect(shiftMinutes({ start: '22:00', end: '06:00', breakMinutes: 60 })).toBe(420);
  });
  it('análise usa a escala: folga não é dia "sem ticket" e o previsto é o turno', () => {
    const m = summarizeMonth('2026-11', [], schedule, '2026-11-09');
    expect(m.expectedDaysWithoutTickets).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-08']);
    const d = summarizeDay('2026-11-02', [rec('2026-11-02', '06:00', 'entrada'), rec('2026-11-02', '14:35', 'saida')], schedule);
    expect(d.expectedMinutes).toBe(455);
  });
  it('descrição para relatórios', () => {
    expect(scheduleDescription(schedule, '2026-11-02')).toContain('6x2 — Letra B desde 26/10/2026');
    expect(scheduleDescription(schedule, '2026-11-02')).toContain('06:00–14:35');
  });
});
