import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { BackupError, crc32, createBackupZip, readBackupZip } from '../src/core/backup';
import { differenceHash, enhanceForOCR, hashDistance, rotateGray, type Gray } from '../src/core/imageOps';
import { parseText } from '../src/core/parser';
import { recordFromParsed } from '../src/core/types';
import { isEstimate, issueMessage, summarizeDay, summarizeMonth, ticketsCSV, workdaysCSV, groupByWorkday } from '../src/core/workday';
import { PORTARIA_671, rec } from './fixtures';

const day = '2026-10-22';

describe('análise de jornada', () => {
  it('dia completo', () => {
    const d = summarizeDay(day, [rec(day, '17:30', 'saida'), rec(day, '08:00', 'entrada'), rec(day, '12:00', 'inicioIntervalo'), rec(day, '13:00', 'fimIntervalo')]);
    expect(d.marks.map((m) => m.time)).toEqual(['08:00', '12:00', '13:00', '17:30']);
    expect(d.gaps).toEqual([240, 60, 270]);
    expect(d.workedMinutes).toBe(510);
    expect(d.breaks).toEqual([60]);
    expect(d.expectedMinutes).toBe(480);
    expect(d.issues).toEqual([]);
    expect(isEstimate(d)).toBe(false);
  });
  it('tipos indefinidos nunca são adivinhados', () => {
    const d = summarizeDay(day, [rec(day, '08:00', 'indefinido'), rec(day, '17:00', 'indefinido')]);
    expect(d.workedMinutes).toBeUndefined();
    expect(d.gaps).toEqual([540]);
    expect(d.issues).toEqual([{ kind: 'undefinedTypes', count: 2 }]);
  });
  it('saída ausente', () => {
    const d = summarizeDay(day, [rec(day, '08:00', 'entrada'), rec(day, '12:00', 'inicioIntervalo'), rec(day, '13:00', 'fimIntervalo')]);
    expect(d.issues).toEqual([{ kind: 'openPeriod', since: '13:00' }]);
    expect(d.workedMinutes).toBe(240);
    expect(isEstimate(d)).toBe(true);
  });
  it('saída sem entrada e entradas seguidas', () => {
    const d = summarizeDay(day, [rec(day, '07:00', 'saida'), rec(day, '08:00', 'entrada'), rec(day, '09:00', 'entrada'), rec(day, '17:00', 'saida')]);
    expect(d.issues).toContainEqual({ kind: 'endWithoutStart', at: '07:00' });
    expect(d.issues).toContainEqual({ kind: 'consecutiveStarts', at: '09:00' });
  });
  it('intervalo curto é referência, não infração', () => {
    const d = summarizeDay(day, [rec(day, '08:00', 'entrada'), rec(day, '12:00', 'inicioIntervalo'), rec(day, '12:30', 'fimIntervalo'), rec(day, '17:00', 'saida')]);
    expect(d.issues).toEqual([{ kind: 'shortBreak', minutes: 30 }]);
    expect(issueMessage(d.issues[0])).toContain('referência');
  });
  it('turno noturno com associação manual', () => {
    const records = [rec(day, '22:00', 'entrada'), rec('2026-10-23', '06:00', 'saida', { journeyDate: day })];
    const groups = groupByWorkday(records);
    expect([...groups.keys()]).toEqual([day]);
    const d = summarizeDay(day, groups.get(day)!);
    expect(d.workedMinutes).toBe(480);
    expect(d.issues).toEqual([{ kind: 'noBreak' }]);
  });
  it('resumo mensal soma só dias sem pendências', () => {
    const m = summarizeMonth('2026-10', [
      rec('2026-10-01', '08:00', 'entrada'), rec('2026-10-01', '12:00', 'inicioIntervalo'),
      rec('2026-10-01', '13:00', 'fimIntervalo'), rec('2026-10-01', '17:00', 'saida'),
      rec('2026-10-02', '08:00', 'entrada'),
    ], undefined, '2026-10-06');
    expect(m.days).toHaveLength(2);
    expect(m.workedMinutes).toBe(480);
    expect(m.expectedMinutes).toBe(480);
    expect(m.daysWithIssues).toBe(1);
    expect(m.expectedDaysWithoutTickets).toEqual(['2026-10-05']);
  });
});

describe('CSV', () => {
  it('escapa e usa BOM', () => {
    const r = rec(day, '08:01', 'entrada', { company: 'ALFA; BETA "LTDA"', notes: 'linha 1\nlinha 2' });
    const csv = ticketsCSV([r]);
    expect(csv.startsWith('﻿ID;Data do registro;Horário')).toBe(true);
    expect(csv).toContain(';22/10/2026;08:01;Entrada;"ALFA; BETA ""LTDA""";');
    expect(csv).toContain('"linha 1\nlinha 2"');
  });
  it('jornada marca estimativas', () => {
    const csv = workdaysCSV([summarizeDay(day, [rec(day, '08:00', 'entrada')])]);
    expect(csv).toContain('Estimativa');
    expect(csv).toContain('quinta-feira');
  });
});

describe('backup (.zip)', () => {
  const record = recordFromParsed(parseText(PORTARIA_671, 0.95), {
    changes: [{ id: 'c1', date: '2026-10-22T11:00:00.000Z', field: 'Horário', oldValue: '08:07', newValue: '08:01' }],
  });
  const image = new Uint8Array(100_000).map((_, i) => i % 251);
  const paths = [`imagens/${record.id}-original.jpg`];

  const make = () => createBackupZip({ createdAt: '2026-10-22T12:00:00.000Z', appVersion: '1.0.0', tickets: [record], settings: { analysisEnabled: true } },
    paths, async () => image);

  it('ida e volta preserva tickets e imagens byte a byte', async () => {
    const zip = await make();
    const got: Record<string, Uint8Array> = {};
    const manifest = await readBackupZip(zip, async (p, d) => { got[p] = d; });
    expect(manifest.tickets).toEqual([record]);
    expect(manifest.settings.analysisEnabled).toBe(true);
    expect(got[paths[0]]).toEqual(image);
  });

  it('corrupção é detectada', async () => {
    const bytes = new Uint8Array(await (await make()).arrayBuffer());
    // altera um byte no meio da imagem (o zip guarda sem compressão)
    bytes[bytes.length - 50_000] ^= 0xff;
    await expect(readBackupZip(new Blob([bytes]), async () => {})).rejects.toBeInstanceOf(BackupError);
  });

  it('arquivo truncado ou estranho é rejeitado', async () => {
    const bytes = new Uint8Array(await (await make()).arrayBuffer());
    await expect(readBackupZip(new Blob([bytes.slice(0, bytes.length - 60_000)]), async () => {})).rejects.toBeInstanceOf(Error);
    await expect(readBackupZip(new Blob([strToU8('não é zip')]), async () => {})).rejects.toBeInstanceOf(BackupError);
    const otherZip = zipSync({ 'manifest.json': strToU8('{"format":"outro"}') });
    await expect(readBackupZip(new Blob([otherZip as BlobPart]), async () => {})).rejects.toThrow('não é um backup');
  });

  it('CRC32 conhecido', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
  });
});

describe('imagem', () => {
  const gradient = (w: number, h: number): Gray => ({ width: w, height: h, data: new Uint8ClampedArray(w * h).map((_, i) => (i % w) * 3) });
  it('rotação troca dimensões e 4 voltas retornam ao original', () => {
    const g = gradient(30, 20);
    const r = rotateGray(g, 1);
    expect([r.width, r.height]).toEqual([20, 30]);
    expect(rotateGray(r, 3).data).toEqual(g.data);
  });
  it('dHash: imagem igual = 0; diferente = longe', () => {
    const g = gradient(90, 80);
    expect(hashDistance(differenceHash(g), differenceHash(g))).toBe(0);
    const inverted = { ...g, data: g.data.map((v) => 255 - v) };
    expect(hashDistance(differenceHash(g), differenceHash(inverted))).toBeGreaterThan(40);
  });
  it('realce amplia imagens pequenas e binariza', () => {
    const rgba = { width: 400, height: 100, data: new Uint8ClampedArray(400 * 100 * 4).map((_, i) => (i % 4 === 3 ? 255 : 120 + (i % 7))) };
    const out = enhanceForOCR(rgba);
    expect(out.width).toBe(1600);
    expect(new Set(out.data).size).toBeLessThanOrEqual(2);
  });
});
