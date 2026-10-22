import { useMemo, useState } from 'react';
import { WEEKDAY_SHORT, addMonths, brDate, capitalize, formatDuration, monthName, monthOf, today, weekday } from '../../core/calendar';
import { balanceOf, isEstimate, summarizeMonth, ticketsCSV, workdaysCSV } from '../../core/workday';
import { monthReportPDF, shareOrDownload, textFile } from '../../services/export';
import { Icon, LinkRow, Notice, Page, Section } from '../components';
import { useStore } from '../store';

export function Analysis() {
  const { tickets, settings } = useStore();
  const [month, setMonth] = useState(monthOf(today()));
  const [error, setError] = useState<string>();
  const s = useMemo(() => summarizeMonth(month, tickets, settings.schedule, today()), [month, tickets, settings.schedule]);

  const run = async (make: () => File) => {
    try { await shareOrDownload(make()); } catch (e) { setError(`Não foi possível gerar o arquivo. (${(e as Error).message})`); }
  };

  return (
    <Page title="Jornada" large>
      <div className="row month-nav">
        <button className="icon-button" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}><Icon name="back" /></button>
        <h2 className="grow center-text month-title">{capitalize(monthName(month))}</h2>
        <button className="icon-button" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}><Icon name="chevron" /></button>
      </div>

      <Notice tone="info">Esta análise compara os tickets com a jornada que você configurou. Não afirma horas extras, atrasos, faltas ou infrações e não substitui o sistema oficial de ponto. Quando faltam informações, os valores são estimativas.</Notice>

      <Section title="Resumo do mês" footer="* Somente dias sem pendências entram nestes totais.">
        <div className="row"><span className="grow">Dias com tickets</span>{s.days.length}</div>
        <div className="row"><span className="grow">Dias sem pendências</span>{s.days.length - s.daysWithIssues}</div>
        <div className="row"><span className="grow">Tempo calculado*</span>{formatDuration(s.workedMinutes)}</div>
        <div className="row"><span className="grow">Jornada configurada*</span>{formatDuration(s.expectedMinutes)}</div>
        <div className="row"><span className="grow">Diferença indicativa*</span>{formatDuration(s.workedMinutes - s.expectedMinutes, true)}</div>
        {s.daysWithIssues > 0 && <div className="row tint-orange">! {s.daysWithIssues} dia(s) com pendências (marcação ausente ou tipo não confirmado)</div>}
        {s.expectedDaysWithoutTickets.length > 0 && <div className="row muted">Dias previstos sem ticket: {s.expectedDaysWithoutTickets.map((d) => d.slice(8)).join(', ')}</div>}
      </Section>

      <Section title="Dias">
        {!s.days.length && <div className="row muted">Nenhum ticket com data neste mês.</div>}
        {s.days.map((d) => (
          <a key={d.date} className="row" href={`#/dia/${d.date}`}>
            <span className="grow stack-tight">
              <b>{brDate(d.date)} · {WEEKDAY_SHORT[weekday(d.date)]}</b>
              <span className="small muted mono">{d.marks.map((m) => m.time).join(' · ')}</span>
              {balanceOf(d) !== undefined && !isEstimate(d) && <span className="small muted">Diferença indicativa: {formatDuration(balanceOf(d)!, true)}</span>}
            </span>
            {d.workedMinutes !== undefined && <span className="mono">{formatDuration(d.workedMinutes)}</span>}
            {isEstimate(d) && <span className="tint-orange" aria-label="Estimativa, há pendências">!</span>}
            <span className="chev"><Icon name="chevron" size={16} /></span>
          </a>
        ))}
      </Section>

      <Section title="Relatórios">
        <button className="row link-row" onClick={() => run(() => monthReportPDF(s, settings.schedule))}><Icon name="download" size={18} /> Relatório do mês em PDF</button>
        <button className="row link-row" onClick={() => run(() => textFile(workdaysCSV(s.days), `jornada-${month}.csv`))}><Icon name="download" size={18} /> Jornada do mês em CSV</button>
        <button className="row link-row" onClick={() => run(() => textFile(ticketsCSV(tickets.filter((t) => t.recordDate && monthOf(t.recordDate) === month)), `tickets-${month}.csv`))}><Icon name="download" size={18} /> Tickets do mês em CSV</button>
        <LinkRow href="#/ajustes/jornada">Configurar jornada de referência</LinkRow>
      </Section>
      {error && <Notice tone="error">{error}</Notice>}
    </Page>
  );
}
