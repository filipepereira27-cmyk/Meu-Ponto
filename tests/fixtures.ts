import { emptyRecord, type MarkType, type OCRLine, type TicketRecord } from '../src/core/types';

/** Textos de comprovantes simulando a saída do OCR. */
export const PORTARIA_671 = `COMPROVANTE DE REGISTRO DE PONTO DO TRABALHADOR
PADARIA BOM DIA LTDA
CNPJ: 11.222.333/0001-81
LOCAL: RUA DAS FLORES, 100 - SAO PAULO/SP
REP: 00004000020005089
NOME: JOÃO DA SILVA SANTOS
PIS: 120.4567.890-5
NSR: 000012345
DATA: 22/10/2026 HORA: 08:01
ENTRADA`;

export const PORTARIA_1510 = `EMPREGADOR: COMERCIAL ALFA S/A
CNPJ 11222333000181
END: AV. BRASIL 500
N° REP 0000100002000123
EMPREGADO: MARIA OLIVEIRA
PIS 12045678905
NSR 000000987 22/10/26 12:03`;

export const CONVENTIONAL = `Supermercado Preço Bom
Funcionário: Ana Paula Souza
Matrícula: 4521
Saída para almoço
23 OUT 2026   12h00
Código de autenticação: A1B2-C3D4-E5F6
Terminal: 03`;

export const BLURRY: OCRLine[] = [
  { text: 'COMPROVANTE DE REGISTRO DE PONTO', confidence: 0.6 },
  { text: 'NOME: CARLOS PEREIRA', confidence: 0.5 },
  { text: 'DATA: 2O/1O/2O26', confidence: 0.4 },
  { text: 'HORA: O8:l5', confidence: 0.4 },
  { text: 'RETORNO INTERVALO', confidence: 0.5 },
];

export const DAMAGED = `COMPROVANTE DE REGISTRO
NOME: JOSE
HORA: 17:48
SAÍDA`;

export const AMBIGUOUS = `REGISTRO DE ENTRADA E SAÍDA
EMISSÃO: 01/11/2026 09:00
DATA: 31/10/2026 HORA: 22:00`;

export function rec(
  date: string | undefined, time: string | undefined, type: MarkType,
  extra: Partial<TicketRecord> = {},
): TicketRecord {
  return emptyRecord({
    recordDate: date, recordTime: time, markType: type, company: 'PADARIA BOM DIA LTDA', isConfirmed: true, ...extra,
  });
}
