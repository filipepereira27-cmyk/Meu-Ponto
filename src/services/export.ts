import { jsPDF } from 'jspdf';
import { WEEKDAY_SHORT, brDate, formatDuration, monthName, weekday } from '../core/calendar';
import { MARK_LABEL, type TicketRecord } from '../core/types';
import { balanceOf, isEstimate, issueMessage, scheduleDescription, type MonthSummary, type WorkSchedule } from '../core/workday';
import { decodeImage, toCanvas } from './image';

export const DISCLAIMER = 'Dados extraídos por reconhecimento automático (OCR) podem conter erros. O comprovante original é a referência. Este documento não substitui o sistema oficial de ponto da empresa.';

/**
 * Compartilha um arquivo pela folha do sistema (iPhone: Salvar em Arquivos, AirDrop,
 * Mail…). Sem suporte, baixa o arquivo. Nada é enviado sem a ação do usuário.
 */
export async function shareOrDownload(file: File): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const textFile = (content: string, name: string, type = 'text/csv;charset=utf-8') => new File([content], name, { type });

/** Escrita sequencial com quebra de página automática (A4, pontos). */
class Writer {
  doc = new jsPDF({ unit: 'pt', format: 'a4' });
  y = 40;
  readonly margin = 40;
  readonly width = 595 - 80;

  ensure(h: number) {
    if (this.y + h > 842 - this.margin) { this.doc.addPage(); this.y = this.margin; }
  }

  text(text: string, size = 10, style: 'normal' | 'bold' = 'normal', color = 20) {
    this.doc.setFont('helvetica', style).setFontSize(size).setTextColor(color);
    for (const paragraph of text.split('\n')) {
      const lines: string[] = this.doc.splitTextToSize(paragraph || ' ', this.width);
      for (const line of lines) {
        this.ensure(size * 1.35);
        this.doc.text(line, this.margin, this.y + size);
        this.y += size * 1.35;
      }
    }
  }

  heading(text: string) { this.y += 8; this.text(text, 13, 'bold'); this.y += 2; }
  field(label: string, value: string) { this.text(`${label}: ${value || '—'}`); }
  space(v: number) { this.y += v; }

  async image(blob: Blob, maxH: number) {
    const canvas = toCanvas(await decodeImage(blob), 1600);
    const ratio = Math.min(this.width / canvas.width, maxH / canvas.height);
    const w = canvas.width * ratio, h = canvas.height * ratio;
    this.ensure(h);
    this.doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', this.margin + (this.width - w) / 2, this.y, w, h);
    this.y += h + 6;
  }
}

const now = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export async function ticketPDF(r: TicketRecord, original?: Blob): Promise<File> {
  const w = new Writer();
  w.text('Comprovante de registro de ponto', 18, 'bold');
  w.text(`Gerado em ${now()} pelo Meu Ponto Digital`, 8, 'normal', 90);
  w.space(8);
  if (original) {
    try { await w.image(original, 420); } catch { w.text('(imagem original em formato não suportado para PDF)', 9); }
  }
  w.heading('Dados do registro');
  w.field('Data', r.recordDate ? brDate(r.recordDate) : 'Não informada');
  w.field('Horário', r.recordTime ?? 'Não informado');
  w.field('Tipo de marcação', MARK_LABEL[r.markType]);
  w.field('Empresa', r.company);
  w.field('CNPJ', r.cnpj);
  w.field('Funcionário', r.employeeName);
  w.field('Matrícula / identificador', r.employeeID);
  w.field('Relógio (REP)', r.clockID);
  w.field('NSR / nº do ticket', r.ticketNumber);
  w.field('Código de autenticação', r.authCode);
  w.field('Revisão', r.isConfirmed ? 'Confirmada pelo usuário' : 'Pendente de conferência');
  w.field('Incluído no app em', new Date(r.importedAt).toLocaleString('pt-BR'));
  if (r.tags.length) w.field('Etiquetas', r.tags.join(', '));
  if (r.notes) w.field('Observações', r.notes);
  w.heading('Texto reconhecido (OCR)');
  w.text(r.ocrText || '(nenhum texto reconhecido)', 8);
  if (r.changes.length) {
    w.heading('Histórico de alterações');
    for (const c of r.changes) w.text(`${new Date(c.date).toLocaleString('pt-BR')} — ${c.field}: ${c.oldValue} → ${c.newValue}`, 9);
  }
  w.space(10);
  w.text(DISCLAIMER, 8, 'normal', 90);
  const name = `ticket-${r.recordDate ?? 'sem-data'}-${(r.recordTime ?? '').replace(/:/g, '')}.pdf`;
  return new File([w.doc.output('blob')], name, { type: 'application/pdf' });
}

export function monthReportPDF(s: MonthSummary, schedule: WorkSchedule): File {
  const w = new Writer();
  w.text(`Relatório de jornada — ${monthName(s.month)}`, 18, 'bold');
  w.text(`Gerado em ${now()} pelo Meu Ponto Digital`, 8, 'normal', 90);
  w.space(6);
  w.text('Comparação com a jornada configurada no app. Valores marcados como estimativa dependem de conferência. Este relatório não afirma a existência de horas extras, atrasos, faltas ou infrações.', 9);
  w.heading('Resumo');
  w.field('Dias com tickets', String(s.days.length));
  w.field('Dias sem pendências', String(s.days.length - s.daysWithIssues));
  w.field('Tempo calculado (dias sem pendências)', formatDuration(s.workedMinutes));
  w.field('Jornada configurada nesses dias', formatDuration(s.expectedMinutes));
  w.field('Diferença indicativa', formatDuration(s.workedMinutes - s.expectedMinutes, true));
  w.field('Dias com pendências', String(s.daysWithIssues));
  if (s.expectedDaysWithoutTickets.length) w.field('Dias previstos sem ticket', s.expectedDaysWithoutTickets.map((d) => d.slice(8)).join(', '));
  w.heading('Dias');
  for (const d of s.days) {
    const worked = d.workedMinutes === undefined ? 'não calculado' : formatDuration(d.workedMinutes);
    const bal = balanceOf(d);
    w.text(`${brDate(d.date)} ${WEEKDAY_SHORT[weekday(d.date)]} — ${worked}${bal === undefined ? '' : ` (${formatDuration(bal, true)})`}${isEstimate(d) ? ' — estimativa' : ''}`, 10, 'bold');
    w.text(d.marks.map((m) => `${m.time} ${MARK_LABEL[m.type]}`).join('  ·  '), 9);
    for (const i of d.issues) w.text(`! ${issueMessage(i)}`, 8, 'normal', 90);
    w.space(4);
  }
  w.space(8);
  w.field('Jornada configurada', scheduleDescription(schedule));
  w.text(DISCLAIMER, 8, 'normal', 90);
  return new File([w.doc.output('blob')], `relatorio-jornada-${s.month}.pdf`, { type: 'application/pdf' });
}
