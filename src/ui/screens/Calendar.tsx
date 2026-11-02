import { useMemo, useState } from 'react';
import {
  WEEKDAY_NAMES, WEEKDAY_SHORT, addDays, addMonths, brDate, capitalize, daysOfMonth, formatDuration, hhmm, monthName, monthOf, parseDay, today, weekday,
} from '../../core/calendar';
import { chronological, needsReview, workdayOf, type TicketRecord } from '../../core/types';
import { balanceOf, isEstimate, issueMessage, planFor, rotationFor, summarizeDay, type WorkdaySummary } from '../../core/workday';
import { Card, Icon, MarkBadge, Notice, Page, Section, TicketRow } from '../components';
import { useStore } from '../store';

export function CalendarScreen() {
  const { tickets, settings } = useStore();
  const [month, setMonth] = useState(monthOf(today()));
  const t = today();
  const byDay = useMemo(() => {
    const map = new Map<string, TicketRecord[]>();
    for (const r of tickets) if (r.recordDate) map.set(r.recordDate, [...(map.get(r.recordDate) ?? []), r]);
    return map;
  }, [tickets]);
  const days = daysOfMonth(month);
  const blanks = weekday(days[0]);
  const withTickets = days.filter((d) => byDay.has(d));
  const undated = tickets.filter((r) => !r.recordDate).length;
  let touchX = 0;

  return (
    <Page title="Calendário" large>
      <div className="row month-nav">
        <button className="icon-button" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}><Icon name="back" /></button>
        <div className="grow center-text">
          <h2 className="month-title">{capitalize(monthName(month))}</h2>
          {month !== monthOf(t) && <button className="link small" onClick={() => setMonth(monthOf(t))}>Ir para hoje</button>}
        </div>
        <button className="icon-button" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}><Icon name="chevron" /></button>
      </div>

      <div className="calendar card" onTouchStart={(e) => { touchX = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) setMonth(addMonths(month, dx < 0 ? 1 : -1)); }}>
        {WEEKDAY_SHORT.map((w) => <span key={w} className="cal-head" aria-hidden="true">{w}</span>)}
        {Array.from({ length: blanks }, (_, i) => <span key={`b${i}`} />)}
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const pending = list.filter(needsReview).length;
          const off = planFor(settings.schedule, d).off;
          const { day } = parseDay(d);
          const label = `${day} de ${monthName(month).split(' ')[0]}${off ? ', folga' : ''}${list.length ? `, ${list.length} ticket(s)${pending ? `, ${pending} para revisar` : ''}` : ', sem tickets'}`;
          const cls = `cal-day${list.length ? ' has' : ''}${off ? ' off' : ''}${d === t ? ' today' : ''}`;
          return (
            <a key={d} className={cls} href={`#/dia/${d}`} aria-label={label}>
              <span>{day}</span>
              {list.length > 0 ? <span className="count">{list.length}</span> : off ? <span className="off-tag">Folga</span> : null}
              {pending > 0 && <span className="pend">!</span>}
            </a>
          );
        })}
      </div>
      <p className="legend small muted"><span className="dot" /> Com tickets &nbsp; <span className="off-dot" /> Folga prevista &nbsp; <span className="tint-orange">!</span> Precisa de revisão</p>
      <OffDaysCard month={month} />

      {withTickets.length > 0 && (
        <Card title={`Dias com tickets em ${monthName(month)}`}>
          {withTickets.map((d) => (
            <a key={d} className="row" href={`#/dia/${d}`}>
              <span className="day-label"><b>{brDate(d)}</b><span className="small muted">{WEEKDAY_NAMES[weekday(d)]}</span></span>
              <span className="grow mono">{[...byDay.get(d)!].sort(chronological).map((r) => (r.recordTime ? hhmm(r.recordTime) : '--:--')).join('  ')}</span>
              <span className="chev"><Icon name="chevron" size={16} /></span>
            </a>
          ))}
        </Card>
      )}
      {undated > 0 && <Notice>{undated} ticket(s) sem data identificada não aparecem no calendário. Encontre-os no Arquivo com o filtro “informações incompletas”.</Notice>}
    </Page>
  );
}

export function DayScreen({ day }: { day: string }) {
  const { tickets, settings, editTicket } = useStore();
  const journey = tickets.filter((r) => workdayOf(r) === day).sort(chronological);
  const movedAway = tickets.filter((r) => r.recordDate === day && r.journeyDate && r.journeyDate !== day);
  const summary = summarizeDay(day, journey, settings.schedule);
  const associate = (r: TicketRecord, to?: string) => editTicket({ ...r, journeyDate: to });

  const plan = planFor(settings.schedule, day);
  return (
    <Page title={brDate(day)} backTo="calendario">
      <div className={plan.off ? 'notice notice-off' : 'notice notice-info'} role="status">
        {plan.off
          ? <span><b>Folga prevista</b>{plan.rotation ? ` — escala ${plan.rotation.label}` : ''}.{journey.length > 0 ? ' Há marcações neste dia de folga.' : ''}</span>
          : <span><b>Dia de trabalho</b>{plan.start ? ` — previsto ${plan.start} às ${plan.end}` : ''} ({formatDuration(plan.expectedMinutes)}{plan.rotation ? `, escala ${plan.rotation.label}` : ''}).</span>}
      </div>
      <Section title={`Marcações (${journey.length})`}
        footer="Turno que atravessa a meia-noite? Use “Pertence à jornada anterior” no ticket da madrugada.">
        {journey.map((r) => (
          <div key={r.id}>
            <TicketRow t={r} />
            <div className="row-actions">
              {r.recordDate !== day && r.recordDate && <span className="small muted"><Icon name="link" size={14} /> Registrado em {brDate(r.recordDate)}</span>}
              {r.journeyDate
                ? <button className="link small" onClick={() => associate(r, undefined)}>Desfazer associação</button>
                : r.recordDate && <button className="link small" onClick={() => associate(r, addDays(r.recordDate!, -1))}>Pertence à jornada de {brDate(addDays(r.recordDate, -1))}</button>}
            </div>
          </div>
        ))}
      </Section>
      {movedAway.length > 0 && (
        <Section title="Associados a outra jornada">
          {movedAway.map((r) => (
            <div key={r.id}>
              <TicketRow t={r} />
              <div className="row-actions"><button className="link small" onClick={() => associate(r, undefined)}>Desfazer associação</button></div>
            </div>
          ))}
        </Section>
      )}
      {settings.analysisEnabled && <DaySummary summary={summary} />}
    </Page>
  );
}

export function DaySummary({ summary: s }: { summary: WorkdaySummary }) {
  return (
    <Section title="Resumo da jornada"
      footer="Comparação com a jornada que você configurou. Não indica horas extras, atrasos ou faltas: isso depende das regras da empresa, de acordos e de ajustes no sistema oficial.">
      {s.marks.map((m, i) => (
        <div className="row" key={m.ticketId}>
          <b className="mono">{m.time}</b>
          {m.date !== s.date && <span className="small muted">({m.date.slice(8)}/{m.date.slice(5, 7)})</span>}
          <MarkBadge type={m.type} />
          <span className="grow" />
          {i < s.gaps.length && <span className="small muted" aria-label={`${formatDuration(s.gaps[i])} até a próxima marcação`}>+{formatDuration(s.gaps[i])}</span>}
        </div>
      ))}
      <div className="row"><span className="grow">Tempo trabalhado{s.workedMinutes !== undefined && isEstimate(s) ? ' (estimativa)' : ''}</span>
        <span>{s.workedMinutes === undefined ? (s.marks.length ? 'Não calculado' : '—') : formatDuration(s.workedMinutes)}</span></div>
      {s.breaks.length > 0 && <div className="row"><span className="grow">Intervalos</span><span>{s.breaks.map((b) => formatDuration(b)).join(' + ')}</span></div>}
      <div className="row"><span className="grow">Jornada configurada</span><span>{formatDuration(s.expectedMinutes)}</span></div>
      {balanceOf(s) !== undefined && <div className="row"><span className="grow">Diferença indicativa</span><span>{formatDuration(balanceOf(s)!, true)}</span></div>}
      {s.issues.map((i, k) => <div className="row tint-orange small" key={k}>! {issueMessage(i)}</div>)}
    </Section>
  );
}


/** Lista as folgas do mês exibido (escala ou jornada semanal). */
function OffDaysCard({ month }: { month: string }) {
  const { settings } = useStore();
  const days = daysOfMonth(month).filter((d) => planFor(settings.schedule, d).off);
  const rotation = rotationFor(settings.schedule, days.at(-1) ?? `${month}-28`);
  if (!days.length) return null;
  return (
    <Card title={`Folgas em ${monthName(month)}`} icon="calendar">
      <p className="mono">{days.map((d) => `${WEEKDAY_SHORT[weekday(d)]} ${d.slice(8)}`).join(' · ')}</p>
      <p className="small muted">{rotation ? `Escala ${rotation.label}, ${rotation.start}–${rotation.end}.` : 'Pela jornada semanal configurada.'} <a href="#/ajustes/jornada">Alterar</a></p>
    </Card>
  );
}
