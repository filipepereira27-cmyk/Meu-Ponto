import { describe, expect, it } from 'vitest';
import { parseText, parseTicket } from '../src/core/parser';
import { needsConfirmation, CRITICAL_FIELDS } from '../src/core/types';
import { isValidCNPJ, isValidCPF, isValidPIS, formatCNPJ } from '../src/core/validators';
import { AMBIGUOUS, BLURRY, CONVENTIONAL, DAMAGED, PORTARIA_1510, PORTARIA_671 } from './fixtures';

const opts = { years: [2000, 2027] as [number, number] };
const pending = (p: ReturnType<typeof parseText>) => CRITICAL_FIELDS.filter((f) => needsConfirmation(p, f));

describe('TicketTextParser', () => {
  it('Portaria 671: extrai todos os campos', () => {
    const r = parseText(PORTARIA_671, 0.98, opts);
    expect(r.company?.value).toBe('PADARIA BOM DIA LTDA');
    expect(r.cnpj?.value).toBe('11.222.333/0001-81');
    expect(r.clockID?.value).toBe('00004000020005089');
    expect(r.employeeName?.value).toBe('JOÃO DA SILVA SANTOS');
    expect(r.employeeID?.value).toBe('120.4567.890-5');
    expect(r.employeeID?.note).toBe('PIS válido');
    expect(r.ticketNumber?.value).toBe('000012345');
    expect(r.date?.value).toBe('2026-10-22');
    expect(r.time?.value).toBe('08:01');
    expect(r.markType?.value).toBe('entrada');
    expect(pending(r)).toEqual([]);
    expect(r.otherFields).toEqual([{ label: 'LOCAL', value: 'RUA DAS FLORES, 100 - SAO PAULO/SP' }]);
  });

  it('Portaria 1510 sem tipo impresso exige confirmação do tipo', () => {
    const r = parseText(PORTARIA_1510, 0.95, opts);
    expect(r.company?.value).toBe('COMERCIAL ALFA S/A');
    expect(r.cnpj?.value).toBe('11.222.333/0001-81');
    expect(r.clockID?.value).toBe('0000100002000123');
    expect(r.employeeName?.value).toBe('MARIA OLIVEIRA');
    expect(r.ticketNumber?.value).toBe('000000987');
    expect(r.date?.value).toBe('2026-10-22');
    expect(r.time?.value).toBe('12:03');
    expect(r.markType).toBeUndefined();
    expect(pending(r)).toEqual(['markType']);
    expect(r.otherFields).toContainEqual({ label: 'END', value: 'AV. BRASIL 500' });
  });

  it('relógio convencional: mês por extenso e "saída para almoço" = início de intervalo', () => {
    const r = parseText(CONVENTIONAL, 0.97, opts);
    expect(r.employeeName?.value).toBe('Ana Paula Souza');
    expect(r.employeeID?.value).toBe('4521');
    expect(r.markType?.value).toBe('inicioIntervalo');
    expect(r.date?.value).toBe('2026-10-23');
    expect(r.time?.value).toBe('12:00');
    expect(r.authCode?.value).toBe('A1B2-C3D4-E5F6');
    expect(r.clockID?.value).toBe('03');
    expect(r.company?.value).toBe('Supermercado Preço Bom');
    expect(r.company?.note).toBeTruthy();
  });

  it('foto borrada: corrige dígitos mas pede confirmação', () => {
    const r = parseTicket(BLURRY, opts);
    expect(r.date?.value).toBe('2026-10-20');
    expect(r.time?.value).toBe('08:15');
    expect(r.markType?.value).toBe('fimIntervalo');
    expect(r.date?.note).toBeTruthy();
    expect(pending(r).sort()).toEqual(['date', 'markType', 'time']);
  });

  it('ticket danificado: avisa a data ausente', () => {
    const r = parseText(DAMAGED, 0.9, opts);
    expect(r.date).toBeUndefined();
    expect(r.time?.value).toBe('17:48');
    expect(r.markType?.value).toBe('saida');
    expect(needsConfirmation(r, 'date')).toBe(true);
    expect(r.warnings).toContain('Data do registro não encontrada.');
  });

  it('ticket ambíguo: nunca presume', () => {
    const r = parseText(AMBIGUOUS, 0.99, opts);
    expect(r.markType).toBeUndefined();
    expect(r.date?.value).toBe('2026-10-31');
    expect(r.time?.value).toBe('22:00');
    expect(needsConfirmation(r, 'date')).toBe(true);
    expect(needsConfirmation(r, 'time')).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('Data:'))).toBe(true);
  });

  it('tipos conflitantes viram "não identificado"', () => {
    const r = parseText('ENTRADA\nDATA 01/10/2026 07:58\nSAIDA', 1, opts);
    expect(r.markType?.value).toBe('indefinido');
    expect(needsConfirmation(r, 'markType')).toBe(true);
  });

  it.each([
    ['05/03/2026'], ['5-3-26'], ['05.03.2026'], ['2026-03-05'], ['05 de março de 2026'], ['05/MAR/26'],
  ])('formato de data %s', (text) => {
    expect(parseText(`DATA: ${text}`, 1, opts).date?.value).toBe('2026-03-05');
  });

  it('rejeita datas inválidas ou fora do intervalo', () => {
    expect(parseText('DATA: 31/02/2026', 1, opts).date).toBeUndefined();
    expect(parseText('DATA: 10/10/1985', 1, opts).date).toBeUndefined();
  });

  it('horários e falsos positivos', () => {
    expect(parseText('HORA: 08:01:33', 1, opts).time?.value).toBe('08:01:33');
    expect(parseText('7h05', 1, opts).time?.value).toBe('07:05');
    expect(parseText('HORA: 25:10', 1, opts).time).toBeUndefined();
    expect(parseText('CNPJ: 11.222.333/0001-81', 1, opts).time).toBeUndefined();
    expect(parseText('22/10/2026', 1, opts).time).toBeUndefined();
  });

  it('CNPJ com confusão do OCR é corrigido e sinalizado', () => {
    const r = parseText('CNPJ: 11.222.333/OOO1-81', 1, opts);
    expect(r.cnpj?.value).toBe('11.222.333/0001-81');
    expect(r.cnpj?.note).toBeTruthy();
    expect(needsConfirmation(r, 'cnpj')).toBe(true);
  });

  it('CNPJ alfanumérico', () => {
    const r = parseText('CNPJ: 12.ABC.345/01DE-35', 1, opts);
    expect(r.cnpj?.value).toBe('12.ABC.345/01DE-35');
    expect(r.cnpj?.note).toBeUndefined();
  });

  it('ruído do OCR antes do rótulo é ignorado', () => {
    const r = parseText('À Matrícula: 4521\n| Saída para almoço', 0.9, opts);
    expect(r.employeeID?.value).toBe('4521');
    expect(r.markType?.value).toBe('inicioIntervalo');
  });

  it('entrada vazia', () => {
    const r = parseTicket([], opts);
    expect(r.date).toBeUndefined();
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('validadores', () => {
  it('CNPJ', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
    expect(isValidCNPJ('11222333000181')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-82')).toBe(false);
    expect(isValidCNPJ('00.000.000/0000-00')).toBe(false);
    expect(isValidCNPJ('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCNPJ('12.ABC.345/01DE-36')).toBe(false);
    expect(formatCNPJ('11222333000181')).toBe('11.222.333/0001-81');
  });
  it('CPF e PIS', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('529.982.247-26')).toBe(false);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidPIS('120.4567.890-5')).toBe(true);
    expect(isValidPIS('120.4567.890-4')).toBe(false);
  });
});
