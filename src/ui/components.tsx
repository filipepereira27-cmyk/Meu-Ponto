import { useEffect, useState, type ReactNode } from 'react';
import { brDate, hhmm } from '../core/calendar';
import { CONFIRMATION_THRESHOLD, MARK_LABEL, needsReview, type MarkType, type TicketRecord } from '../core/types';
import { getImage, type ImageKind } from '../services/db';
import { back, go } from './router';

// ─── Ícones (traço, herdam a cor do texto) ─────────────────────────────────────

const PATHS: Record<string, string> = {
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  photo: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5 M15.5 9.5a1 1 0 1 0 0-.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  home: 'M3 11l9-7 9 7 M5 10v10h14V10',
  tray: 'M3 13l3-8h12l3 8v6H3z M3 13h5l1 2h6l1-2h5',
  calendar: 'M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 12l5 5L20 7',
  alert: 'M12 3l10 18H2z M12 10v4 M12 17.5v.01',
  flag: 'M5 21V4 M5 4h11l-2 4 2 4H5',
  lock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
  rotateL: 'M4 4v6h6 M4.5 10A8 8 0 1 1 6 16',
  rotateR: 'M20 4v6h-6 M19.5 10A8 8 0 1 0 18 16',
  wand: 'M5 19L19 5 M15 5h4v4 M7 3v2 M3 7h2 M17 17v2 M19 17h2',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5',
  share: 'M12 3v12 M7 8l5-5 5 5 M5 13v8h14v-8',
  print: 'M6 9V3h12v6 M6 18H4v-7h16v7h-2 M6 14h12v7H6z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5v.01',
  dup: 'M8 8h12v12H8z M4 16V4h12',
  x: 'M6 6l12 12 M18 6L6 18',
  plus: 'M12 5v14 M5 12h14',
  download: 'M12 3v12 M7 10l5 5 5-5 M5 21h14',
  folder: 'M3 6h6l2 2h10v11H3z',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4 M11 8v6 M8 11h6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4 M8 11h6',
};

export function Icon({ name, size = 22, label }: { name: keyof typeof PATHS; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={PATHS[name]} />
    </svg>
  );
}

// ─── Indicadores ──────────────────────────────────────────────────────────────

/** Confiança do OCR: texto + ícone + %, não só cor. */
export function Confidence({ value }: { value?: number }) {
  if (value === undefined) return <span className="conf conf-none">? Não encontrado</span>;
  const pct = Math.round(value * 100);
  if (value >= CONFIRMATION_THRESHOLD) return <span className="conf conf-high"><Icon name="check" size={13} /> Alta · {pct}%</span>;
  if (value >= 0.6) return <span className="conf conf-mid">! Média · {pct}%</span>;
  return <span className="conf conf-low">!! Baixa · {pct}%</span>;
}

export function MarkBadge({ type }: { type: MarkType }) {
  return <span className={`badge mark-${type}`}>{MARK_LABEL[type]}</span>;
}

/** Carrega uma imagem do banco como URL temporária. */
export function useImageURL(id: string | undefined, kind: ImageKind): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    let created: string | undefined;
    setUrl(undefined);
    if (id) {
      getImage(id, kind).then((blob) => {
        if (alive && blob) { created = URL.createObjectURL(blob); setUrl(created); }
      });
    }
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [id, kind]);
  return url;
}

export function Thumb({ id, size = 52 }: { id: string; size?: number }) {
  const url = useImageURL(id, 'miniatura');
  return url
    ? <img className="thumb" src={url} width={size} height={size} alt="" />
    : <span className="thumb thumb-empty" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function TicketRow({ t }: { t: TicketRecord }) {
  return (
    <a className="row ticket-row" href={`#/ticket/${t.id}`}>
      <Thumb id={t.id} />
      <span className="grow">
        <span className="row-title"><b className="time">{t.recordTime ? hhmm(t.recordTime) : '--:--'}</b> <span className="muted">{t.recordDate ? brDate(t.recordDate) : 'Sem data'}</span></span>
        <MarkBadge type={t.markType} />
        {t.company && <span className="small muted ellipsis">{t.company}</span>}
      </span>
      {t.isFlagged ? <span className="tint-red" title="Sinalizado"><Icon name="flag" size={18} label="Sinalizado para conferência" /></span>
        : needsReview(t) ? <span className="tint-orange"><Icon name="alert" size={18} label="Precisa de revisão" /></span> : null}
      <span className="chev"><Icon name="chevron" size={16} /></span>
    </a>
  );
}

// ─── Estrutura ────────────────────────────────────────────────────────────────

export function Page({ title, children, backTo, actions, large = false }: { title: string; children: ReactNode; backTo?: string; actions?: ReactNode; large?: boolean }) {
  useEffect(() => { document.title = `${title} · Meu Ponto Digital`; }, [title]);
  return (
    <main className="page">
      <header className={large ? 'bar bar-large' : 'bar'}>
        {backTo !== undefined && (
          <button className="link back" onClick={() => back(backTo)} aria-label="Voltar"><Icon name="back" /> Voltar</button>
        )}
        <h1>{title}</h1>
        <span className="bar-actions">{actions}</span>
      </header>
      <div className="content">{children}</div>
    </main>
  );
}

export function Card({ title, children, icon }: { title?: string; children: ReactNode; icon?: keyof typeof PATHS }) {
  return (
    <section className="card">
      {title && <h2 className="card-title">{icon && <Icon name={icon} size={18} />} {title}</h2>}
      {children}
    </section>
  );
}

export function Notice({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'info' | 'ok' | 'error' }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>{children}</div>;
}

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="section">
      {title && <h3 className="section-title">{title}</h3>}
      <div className="group">{children}</div>
      {footer && <p className="section-footer">{footer}</p>}
    </section>
  );
}

/** Janela modal acessível (diálogo nativo). */
export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Confirmação para ações importantes/irreversíveis. */
export function Confirm({ open, title, message, confirmLabel, destructive, onConfirm, onCancel }: {
  open: boolean; title: string; message: ReactNode; confirmLabel: string; destructive?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="stack">
        <div>{message}</div>
        <button className={destructive ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </Modal>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="row toggle-row">
      <span className="grow">{label}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function LinkRow({ href, children, badge }: { href: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <a className="row" href={href} onClick={(e) => { if (href.startsWith('#/')) { e.preventDefault(); go(href.slice(2)); } }}>
      <span className="grow">{children}</span>
      {badge}
      <span className="chev"><Icon name="chevron" size={16} /></span>
    </a>
  );
}

export function Empty({ title, children, icon = 'tray' }: { title: string; children?: ReactNode; icon?: keyof typeof PATHS }) {
  return (
    <div className="empty">
      <Icon name={icon} size={44} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
