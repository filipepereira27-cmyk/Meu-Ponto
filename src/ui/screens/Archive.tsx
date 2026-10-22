import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  DUPLICATE_REASON_LABEL, activeFilterCount, allDuplicates, emptyFilter, isStrongDuplicate, matchesFilter, queryTokens,
  type TicketFilter,
} from '../../core/archive';
import { addMonths, capitalize, minutesOf, monthName, monthOf, today } from '../../core/calendar';
import { MARK_LABEL, MARK_TYPES, chronological, type TicketRecord } from '../../core/types';
import { Empty, Icon, Modal, Page, Section, TicketRow, Toggle } from '../components';
import { useStore } from '../store';

// Filtro compartilhado (a busca da tela inicial abre o Arquivo já filtrado).
let current: TicketFilter = emptyFilter();
const listeners = new Set<() => void>();
export function setArchiveFilter(patch: Partial<TicketFilter>, replace = true) {
  current = { ...(replace ? emptyFilter() : current), ...patch };
  listeners.forEach((l) => l());
}
const useArchiveFilter = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);

export function Archive() {
  const { tickets, searchText, startCapture } = useStore();
  const filter = useArchiveFilter();
  const [newestFirst, setNewestFirst] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const results = useMemo(() => {
    const tokens = queryTokens(filter.text);
    const list = tickets.filter((t) => matchesFilter(t, filter, filter.text ? searchText(t) : undefined, tokens)).sort(chronological);
    return newestFirst ? list.reverse() : list;
  }, [tickets, filter, searchText, newestFirst]);

  const groups = useMemo(() => {
    const out: { key: string; title: string; items: TicketRecord[] }[] = [];
    for (const t of results) {
      const key = t.recordDate ? monthOf(t.recordDate) : 'sem-data';
      if (out.at(-1)?.key !== key) out.push({ key, title: t.recordDate ? capitalize(monthName(key)) : 'Sem data identificada', items: [] });
      out.at(-1)!.items.push(t);
    }
    return out;
  }, [results]);

  const count = activeFilterCount(filter);
  const tags = useMemo(() => [...new Set(tickets.flatMap((t) => t.tags))].sort(), [tickets]);

  return (
    <Page title="Arquivo" large actions={
      <>
        <button className="link" onClick={() => setNewestFirst(!newestFirst)} aria-label="Inverter ordem">{newestFirst ? 'Recentes ↓' : 'Antigos ↓'}</button>
        <button className="link" onClick={() => setShowFilters(true)}>Filtros{count ? ` (${count})` : ''}</button>
      </>
    }>
      <div className="search" role="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Data, horário, empresa ou texto" aria-label="Buscar no arquivo" value={filter.text}
          onChange={(e) => setArchiveFilter({ text: e.target.value }, false)} />
      </div>

      {(count > 0 || filter.text) && tickets.length > 0 && (
        <div className="row filter-summary">
          <span className="grow">{results.length} de {tickets.length} ticket(s)</span>
          <button className="link" onClick={() => setArchiveFilter({})}>Limpar</button>
        </div>
      )}

      {tickets.length === 0 ? (
        <Empty title="Arquivo vazio">
          <p className="muted">Os tickets que você fotografar ou importar aparecem aqui, em ordem de data e horário.</p>
          <button className="btn btn-primary" onClick={() => startCapture('camera')}><Icon name="camera" /> Fotografar ticket</button>
        </Empty>
      ) : results.length === 0 ? (
        <Empty title="Nada encontrado" icon="search">
          <p className="muted">Tente outra palavra, uma data como 22/10 ou um horário como 8:01.</p>
          <button className="btn btn-secondary" onClick={() => setArchiveFilter({})}>Limpar busca e filtros</button>
        </Empty>
      ) : (
        groups.map((g) => (
          <Section key={g.key} title={g.title}>
            {g.items.map((t) => <TicketRow key={t.id} t={t} />)}
          </Section>
        ))
      )}
      <p className="center-text"><a className="link" href="#/duplicidades">Ver possíveis duplicidades</a></p>
      <FilterSheet open={showFilters} onClose={() => setShowFilters(false)} filter={filter} tags={tags} />
    </Page>
  );
}

function FilterSheet({ open, onClose, filter, tags }: { open: boolean; onClose: () => void; filter: TicketFilter; tags: string[] }) {
  const [f, setF] = useState(filter);
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) { setF(filter); setLastOpen(true); }
  if (!open && lastOpen) setLastOpen(false);
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const t = today();
  const toTime = (m?: number) => (m === undefined ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

  return (
    <Modal open={open} onClose={onClose} title="Filtros" wide>
      <Section title="Data do registro">
        <label className="field-label row">De <input className="input input-inline" type="date" value={f.dateFrom ?? ''} onChange={(e) => setF({ ...f, dateFrom: e.target.value || undefined })} /></label>
        <label className="field-label row">Até <input className="input input-inline" type="date" value={f.dateTo ?? ''} onChange={(e) => setF({ ...f, dateTo: e.target.value || undefined })} /></label>
        <Toggle label="Mês e ano específicos" checked={!!f.month} onChange={(on) => setF({ ...f, month: on ? monthOf(t) : undefined })} />
        {f.month && (
          <div className="row month-nav">
            <button className="icon-button" aria-label="Mês anterior" onClick={() => setF({ ...f, month: addMonths(f.month!, -1) })}><Icon name="back" /></button>
            <b className="grow center-text">{capitalize(monthName(f.month))}</b>
            <button className="icon-button" aria-label="Próximo mês" onClick={() => setF({ ...f, month: addMonths(f.month!, 1) })}><Icon name="chevron" /></button>
          </div>
        )}
      </Section>
      <Section title="Horário registrado">
        <label className="field-label row">Das <input className="input input-inline" type="time" value={toTime(f.timeFrom)} onChange={(e) => setF({ ...f, timeFrom: e.target.value ? minutesOf(e.target.value) : undefined })} /></label>
        <label className="field-label row">Até <input className="input input-inline" type="time" value={toTime(f.timeTo)} onChange={(e) => setF({ ...f, timeTo: e.target.value ? minutesOf(e.target.value) : undefined })} /></label>
      </Section>
      <Section title="Tipo de marcação">
        {MARK_TYPES.map((m) => <Toggle key={m} label={MARK_LABEL[m]} checked={f.markTypes.includes(m)} onChange={() => setF({ ...f, markTypes: toggleIn(f.markTypes, m) })} />)}
      </Section>
      <Section title="Empresa e funcionário">
        <input className="input" placeholder="Empresa ou CNPJ" aria-label="Empresa ou CNPJ" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
        <input className="input" placeholder="Funcionário ou matrícula" aria-label="Funcionário ou matrícula" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })} />
      </Section>
      {tags.length > 0 && (
        <Section title="Etiquetas">
          {tags.map((tag) => <Toggle key={tag} label={tag} checked={f.tags.includes(tag)} onChange={() => setF({ ...f, tags: toggleIn(f.tags, tag) })} />)}
        </Section>
      )}
      <Section title="Situação">
        <Toggle label="Somente com informações incompletas" checked={f.onlyIncomplete} onChange={(v) => setF({ ...f, onlyIncomplete: v })} />
        <Toggle label="Somente sinalizados para conferência" checked={f.onlyFlagged} onChange={(v) => setF({ ...f, onlyFlagged: v })} />
        <Toggle label="Somente com revisão pendente" checked={f.onlyPendingReview} onChange={(v) => setF({ ...f, onlyPendingReview: v })} />
      </Section>
      <div className="stack">
        <button className="btn btn-primary" onClick={() => { setArchiveFilter(f); onClose(); }}>Aplicar</button>
        <button className="btn btn-secondary" onClick={() => setF({ ...emptyFilter(), text: f.text })}>Limpar filtros</button>
      </div>
    </Modal>
  );
}

export function Duplicates() {
  const { tickets, byId } = useStore();
  const matches = useMemo(() => allDuplicates(tickets), [tickets]);
  return (
    <Page title="Possíveis duplicidades" backTo="arquivo">
      <p className="muted">Estes tickets têm dados ou imagens muito parecidos. Abra cada um para comparar; se um deles for uma foto repetida, exclua-o na tela do ticket. <b>Nada é excluído automaticamente.</b></p>
      {matches.length === 0 && <Empty title="Nenhuma duplicidade encontrada" icon="check" />}
      {matches.map((m) => (
        <Section key={`${m.first}-${m.second}`} title={m.reasons.map((r) => DUPLICATE_REASON_LABEL[r]).join(' · ')}
          footer={isStrongDuplicate(m) ? 'Indício forte de que é o mesmo comprovante.' : undefined}>
          {[m.first, m.second].map((id) => byId.get(id)).filter(Boolean).map((t) => <TicketRow key={t!.id} t={t!} />)}
        </Section>
      ))}
    </Page>
  );
}

