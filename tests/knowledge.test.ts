import { describe, expect, it } from 'vitest';
import { applyKnowledge } from '../src/core/knowledge';
import { parseText } from '../src/core/parser';
import { needsConfirmation } from '../src/core/types';
import { rec } from './fixtures';

const NOW = new Date(2026, 9, 27, 18, 0); // 27/10/2026 18:00 (horário local)
const opts = { years: [2000, 2027] as [number, number] };

/** Histórico confirmado: mesmo funcionário, empresa e relógio; NSR crescendo com o tempo. */
const history = [
  rec('2026-10-20', '08:00', 'entrada', { company: 'METALURGICA SAO JOSE LTDA', cnpj: '45.723.174/0001-10', employeeName: 'CARLOS ALBERTO DE SOUZA', employeeID: '120.4567.890-5', clockID: '00004000660012345', ticketNumber: '000045800' }),
  rec('2026-10-20', '17:00', 'saida', { company: 'METALURGICA SAO JOSE LTDA', cnpj: '45.723.174/0001-10', employeeName: 'CARLOS ALBERTO DE SOUZA', employeeID: '120.4567.890-5', clockID: '00004000660012345', ticketNumber: '000045810' }),
  rec('2026-10-21', '08:00', 'entrada', { company: 'METALURGICA SAO JOSE LTDA', cnpj: '45.723.174/0001-10', employeeName: 'CARLOS ALBERTO DE SOUZA', employeeID: '120.4567.890-5', clockID: '00004000660012345', ticketNumber: '000045830' }),
];

const ticket = (lines: string) => parseText(lines, 0.9, opts);

describe('valores já confirmados', () => {
  it('corrige leitura parecida com valor conhecido e informa', () => {
    const p = ticket('EMPRESA: METALURGICA SAO JOSE LTIA\nNOME: CARLOS ALBERT0 DE SOUZA\nDATA: 22/10/2026 HORA: 08:01\nENTRADA');
    const k = applyKnowledge(p, history, NOW);
    expect(k.parsed.company?.value).toBe('METALURGICA SAO JOSE LTDA');
    expect(k.parsed.employeeName?.value).toBe('CARLOS ALBERTO DE SOUZA');
    expect(k.adjustments.filter((a) => a.includes('corrigido'))).toHaveLength(2);
    expect(k.adjustments.join(' ')).toContain('LTIA');
  });

  it('valor idêntico ganha confiança', () => {
    const p = ticket('EMPRESA: METALURGICA SAO JOSE LTDA');
    p.company!.confidence = 0.7;
    expect(applyKnowledge(p, history, NOW).parsed.company?.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('não corrige valores muito diferentes (outra empresa)', () => {
    const p = ticket('EMPRESA: PADARIA BOM DIA LTDA');
    const k = applyKnowledge(p, history, NOW);
    expect(k.parsed.company?.value).toBe('PADARIA BOM DIA LTDA');
    expect(k.adjustments.some((a) => a.startsWith('Empresa'))).toBe(false);
  });

  it('CNPJ com 1 dígito errado é corrigido; campo ausente é preenchido como sugestão', () => {
    const p = ticket('CNPJ: 45.723.174/0001-19\nDATA: 22/10/2026 HORA: 08:01');
    const k = applyKnowledge(p, history, NOW);
    expect(k.parsed.cnpj?.value).toBe('45.723.174/0001-10');
    expect(k.parsed.employeeName?.value).toBe('CARLOS ALBERTO DE SOUZA');
    expect(needsConfirmation(k.parsed, 'employeeName')).toBe(true);
  });

  it('só usa tickets confirmados e só preenche com 3+ confirmações', () => {
    const unconfirmed = history.map((h) => ({ ...h, isConfirmed: false }));
    expect(applyKnowledge(ticket('EMPRESA: METALURGICA SAO JOSE LTIA'), unconfirmed, NOW).adjustments).toEqual([]);
    expect(applyKnowledge(ticket('DATA: 22/10/2026'), history.slice(0, 2), NOW).parsed.employeeName).toBeUndefined();
  });

  it('com dois candidatos igualmente parecidos, não escolhe', () => {
    const two = [...history, rec('2026-10-01', '08:00', 'entrada', { employeeName: 'ANA SOUZA' }), rec('2026-10-01', '08:00', 'entrada', { employeeName: 'ANA SOUSA' })];
    const k = applyKnowledge(ticket('NOME: ANA SOUXA'), two, NOW);
    expect(k.parsed.employeeName?.value).toBe('ANA SOUXA');
  });
});

describe('sequência do NSR', () => {
  const base = 'REP: 00004000660012345\n';
  it('NSR coerente com a data: sem aviso', () => {
    const k = applyKnowledge(ticket(`${base}NSR: 000045840\nDATA: 22/10/2026 HORA: 08:01\nENTRADA`), history, NOW);
    expect(k.warnings).toEqual([]);
    expect(needsConfirmation(k.parsed, 'date')).toBe(false);
  });
  it('NSR maior com data anterior: data/hora/NSR passam a exigir conferência', () => {
    // Leu 20/10 (devia ser 22/10): NSR 45840 é maior que o de 21/10 (45830).
    const k = applyKnowledge(ticket(`${base}NSR: 000045840\nDATA: 20/10/2026 HORA: 12:00\nENTRADA`), history, NOW);
    expect(k.warnings[0]).toContain('NSR');
    expect(k.warnings[0]).toContain('21/10/2026');
    expect(needsConfirmation(k.parsed, 'date')).toBe(true);
    expect(needsConfirmation(k.parsed, 'time')).toBe(true);
  });
  it('sem data lida, indica o período provável pelo NSR', () => {
    const k = applyKnowledge(ticket(`${base}NSR: 000045820\nHORA: 12:00`), history, NOW);
    expect(k.adjustments.join(' ')).toContain('entre 20/10/2026 e 21/10/2026');
  });
  it('relógio diferente não é comparado', () => {
    const k = applyKnowledge(ticket('REP: 99999999999999999\nNSR: 000045840\nDATA: 01/10/2026 HORA: 08:00'), history, NOW);
    expect(k.warnings).toEqual([]);
  });
});

describe('plausibilidade', () => {
  it('data no futuro', () => {
    const k = applyKnowledge(ticket('DATA: 28/10/2026 HORA: 08:00'), [], NOW);
    expect(k.warnings[0]).toContain('futuro');
    expect(needsConfirmation(k.parsed, 'date')).toBe(true);
  });
  it('horário de hoje depois do momento da foto', () => {
    const k = applyKnowledge(ticket('DATA: 27/10/2026 HORA: 19:30'), [], NOW);
    expect(k.warnings[0]).toContain('posterior');
    expect(needsConfirmation(k.parsed, 'time')).toBe(true);
    expect(applyKnowledge(ticket('DATA: 27/10/2026 HORA: 17:55'), [], NOW).warnings).toEqual([]);
  });
});
