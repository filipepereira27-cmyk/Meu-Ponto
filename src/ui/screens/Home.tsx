import { useMemo, useState } from 'react';
import { allDuplicates } from '../../core/archive';
import { MONTH_ABBR, WEEKDAY_SHORT, parseDay, weekday } from '../../core/calendar';
import { isIncomplete } from '../../core/types';
import { Card, Icon, Page, TicketRow } from '../components';
import { go } from '../router';
import { useStore } from '../store';
import { setArchiveFilter } from './Archive';

export function Home() {
  const { tickets, backupOverdue, settings } = useStore();
  const [query, setQuery] = useState('');
  const pending = tickets.filter((t) => !t.isConfirmed).length;
  const incomplete = tickets.filter(isIncomplete).length;
  const flagged = tickets.filter((t) => t.isFlagged).length;
  const duplicates = useMemo(() => allDuplicates(tickets).length, [tickets]);
  const recent = [...tickets].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1)).slice(0, 5);
  const days = [...new Set(tickets.map((t) => t.recordDate).filter(Boolean) as string[])].sort().reverse().slice(0, 7);
  const countOn = (d: string) => tickets.filter((t) => t.recordDate === d).length;
  const attention = pending + incomplete + flagged + duplicates > 0 || backupOverdue;

  return (
    <Page title="Meu Ponto Digital" large actions={<a className="icon-button" href="#/calendario" aria-label="Calendário"><Icon name="calendar" /></a>}>
      <InstallHint />
      <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); setArchiveFilter({ text: query }); go('arquivo'); }}>
        <Icon name="search" size={18} />
        <input type="search" enterKeyHint="search" placeholder="Buscar por data, horário ou texto" aria-label="Buscar"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </form>

      <div className="stats">
        <div className="stat"><b>{tickets.length}</b><span>{tickets.length === 1 ? 'ticket arquivado' : 'tickets arquivados'}</span></div>
        <div className="stat"><b className={pending ? 'tint-orange' : 'tint-green'}>{pending}</b><span>para revisar</span></div>
      </div>

      {attention && (
        <Card title="Precisa da sua atenção" icon="alert">
          {pending > 0 && <AlertLink onClick={() => { setArchiveFilter({ onlyPendingReview: true }); go('arquivo'); }}>{pending} ticket(s) com revisão pendente</AlertLink>}
          {incomplete > 0 && <AlertLink onClick={() => { setArchiveFilter({ onlyIncomplete: true }); go('arquivo'); }}>{incomplete} com data, horário ou tipo ausente</AlertLink>}
          {flagged > 0 && <AlertLink onClick={() => { setArchiveFilter({ onlyFlagged: true }); go('arquivo'); }}>{flagged} sinalizado(s) para conferência</AlertLink>}
          {duplicates > 0 && <AlertLink onClick={() => go('duplicidades')}>{duplicates} possível(is) duplicidade(s)</AlertLink>}
          {backupOverdue && (
            <AlertLink onClick={() => go('ajustes/backup')}>
              {settings.lastBackupAt ? `Último backup há mais de ${settings.backupReminderDays} dias` : 'Você ainda não fez backup'}
            </AlertLink>
          )}
        </Card>
      )}

      <Card title="Adicionados recentemente" icon="tray">
        {recent.length === 0 ? (
          <div className="stack">
            <b>Nenhum ticket ainda.</b>
            <span className="muted">Toque em “Fotografar ticket” e enquadre o comprovante inteiro, com boa luz. O texto é reconhecido no próprio aparelho.</span>
          </div>
        ) : (
          <>
            <div className="list-plain">{recent.map((t) => <TicketRow key={t.id} t={t} />)}</div>
            <a className="link" href="#/arquivo">Ver todos</a>
          </>
        )}
      </Card>

      {days.length > 0 && (
        <Card title="Últimos dias com tickets" icon="calendar">
          <div className="day-chips">
            {days.map((d) => {
              const { day, month } = parseDay(d);
              return (
                <a key={d} className="day-chip" href={`#/dia/${d}`} aria-label={`${d.split('-').reverse().join('/')}: ${countOn(d)} tickets`}>
                  <span className="small">{WEEKDAY_SHORT[weekday(d)]}</span>
                  <b>{day}</b>
                  <span className="small">{MONTH_ABBR[month - 1].charAt(0) + MONTH_ABBR[month - 1].slice(1).toLowerCase()}</span>
                  <span className="count">{countOn(d)}</span>
                </a>
              );
            })}
          </div>
        </Card>
      )}
      <div className="capture-spacer" />
    </Page>
  );
}

function AlertLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button className="row alert-link" onClick={onClick}>
      <span className="grow">{children}</span>
      <span className="chev"><Icon name="chevron" size={16} /></span>
    </button>
  );
}

/** No iPhone, instalar na Tela de Início protege os dados da limpeza automática do Safari. */
function InstallHint() {
  const [hidden, setHidden] = useState(() => sessionStorageGet('install-hint-hidden') === '1');
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (!isIOS || standalone || hidden) return null;
  return (
    <div className="notice notice-info install-hint">
      <div className="grow">
        <b>Instale na Tela de Início</b>
        <p className="small">Toque em <b>Compartilhar</b> <Icon name="share" size={14} /> e depois em <b>Adicionar à Tela de Início</b>. Assim o portal abre como app, funciona sem internet e o Safari não apaga seus tickets por falta de uso.</p>
      </div>
      <button className="icon-button" aria-label="Fechar aviso" onClick={() => { sessionStorageSet('install-hint-hidden', '1'); setHidden(true); }}><Icon name="x" size={18} /></button>
    </div>
  );
}

function sessionStorageGet(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* ignorado */ } }
