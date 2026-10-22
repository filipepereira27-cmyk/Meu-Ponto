import { useState } from 'react';
import { makeTime } from '../../core/calendar';
import {
  CONFIRMATION_THRESHOLD, CRITICAL_FIELDS, FIELD_LABEL, MARK_LABEL, MARK_TYPES,
  type MarkType, type TicketField, type TicketRecord,
} from '../../core/types';
import { Confidence, Icon, Notice } from '../components';

export const SUGGESTED_TAGS = ['Entrada', 'Saída', 'Intervalo', 'Divergência'];

/** Estado editável da revisão/edição. */
export interface Draft {
  base: TicketRecord;
  warnings: string[];
  record: TicketRecord;
  /** Campos críticos conferidos pelo usuário (ou com confiança alta). */
  confirmed: TicketField[];
}

export function makeDraft(base: TicketRecord, warnings: string[] = []): Draft {
  const confirmed = base.isConfirmed
    ? [...CRITICAL_FIELDS]
    : CRITICAL_FIELDS.filter((f) => (base.fieldConfidences[f] ?? 0) >= CONFIRMATION_THRESHOLD && !(f === 'markType' && base.markType === 'indefinido'));
  return { base, warnings, record: { ...base }, confirmed };
}

export const pendingConfirmation = (d: Draft, f: TicketField) => CRITICAL_FIELDS.includes(f) && !d.confirmed.includes(f);

export function blockers(d: Draft): string[] {
  const out: string[] = [];
  if (!d.record.recordDate) out.push('Informe a data do registro.');
  if (!d.record.recordTime) out.push('Informe o horário.');
  if (d.record.markType === 'indefinido') out.push('Escolha o tipo de marcação.');
  const pending = CRITICAL_FIELDS.filter((f) => pendingConfirmation(d, f));
  if (pending.length) out.push(`Confira: ${pending.map((f) => FIELD_LABEL[f]).join(', ')}.`);
  return out;
}

/** Registro final a partir do rascunho. Confirmado só se não houver pendências. */
export function draftToRecord(d: Draft, confirm: boolean): TicketRecord {
  const r = d.record;
  const trim = (s: string) => s.trim();
  return {
    ...r,
    company: trim(r.company), cnpj: trim(r.cnpj), employeeName: trim(r.employeeName), employeeID: trim(r.employeeID),
    clockID: trim(r.clockID), ticketNumber: trim(r.ticketNumber), authCode: trim(r.authCode),
    isConfirmed: confirm && blockers(d).length === 0,
  };
}

export function TicketForm({ draft, setDraft, ocrText, onSave, saveLabel = 'Salvar', busy }: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  ocrText?: string;
  onSave: (confirm: boolean) => void;
  saveLabel?: string;
  busy?: boolean;
}) {
  const r = draft.record;
  const [newTag, setNewTag] = useState('');
  const set = (patch: Partial<TicketRecord>, confirmField?: TicketField) =>
    setDraft({ ...draft, record: { ...r, ...patch }, confirmed: confirmField && !draft.confirmed.includes(confirmField) ? [...draft.confirmed, confirmField] : draft.confirmed });
  const confirm = (f: TicketField) => setDraft({ ...draft, confirmed: [...draft.confirmed, f] });
  const conf = (f: TicketField) => draft.base.fieldConfidences[f];
  const problems = blockers(draft);
  const hasSeconds = (r.recordTime ?? '').length === 8;

  const critical = (f: TicketField, input: React.ReactNode, canConfirm: boolean) => (
    <div className={pendingConfirmation(draft, f) ? 'field field-pending' : 'field'}>
      {input}
      <div className="field-meta">
        <Confidence value={f === 'markType' && draft.base.markType === 'indefinido' && conf(f) === 0 ? 0 : conf(f)} />
        {pendingConfirmation(draft, f)
          ? <button type="button" className="btn-chip btn-chip-warn" disabled={!canConfirm} onClick={() => confirm(f)}>Está correto</button>
          : <span className="ok small"><Icon name="check" size={14} /> Conferido</span>}
      </div>
    </div>
  );

  const text = (f: TicketField, key: keyof TicketRecord, mode: 'text' | 'code' = 'text') => (
    <label className="field">
      <span className="field-label"><span>{FIELD_LABEL[f]}</span>{(r[key] || conf(f) !== undefined) ? <Confidence value={conf(f)} /> : null}</span>
      <input className="input" value={r[key] as string} autoCapitalize={mode === 'code' ? 'characters' : 'words'} autoCorrect="off"
        spellCheck={false} onChange={(e) => set({ [key]: e.target.value } as Partial<TicketRecord>)} />
    </label>
  );

  return (
    <form className="form" onSubmit={(e) => e.preventDefault()}>
      {draft.warnings.map((w) => <Notice key={w}>{w}</Notice>)}

      <h3 className="section-title">Registro</h3>
      <div className="group">
        {critical('date', (
          <label className="field-label"><span>Data</span>
            <input className="input input-inline" type="date" value={r.recordDate ?? ''} required
              onChange={(e) => set({ recordDate: e.target.value || undefined }, 'date')} />
          </label>
        ), !!r.recordDate)}
        {critical('time', (
          <label className="field-label"><span>Horário</span>
            <input className="input input-inline" type="time" step={hasSeconds ? 1 : 60} value={r.recordTime ?? ''}
              onChange={(e) => {
                const [h, m, s] = e.target.value.split(':').map(Number);
                set({ recordTime: e.target.value ? makeTime(h, m, hasSeconds ? s ?? 0 : undefined) ?? undefined : undefined }, 'time');
              }} />
          </label>
        ), !!r.recordTime)}
        {critical('markType', (
          <label className="field-label"><span>Tipo</span>
            <select className="input input-inline" value={r.markType}
              onChange={(e) => { const v = e.target.value as MarkType; set({ markType: v }, v === 'indefinido' ? undefined : 'markType'); }}>
              {MARK_TYPES.map((t) => <option key={t} value={t}>{MARK_LABEL[t]}</option>)}
            </select>
          </label>
        ), r.markType !== 'indefinido')}
      </div>
      <p className="section-footer">O tipo nunca é deduzido pela ordem dos tickets: use o que está impresso ou informe.</p>

      <h3 className="section-title">Empresa e funcionário</h3>
      <div className="group">
        {text('company', 'company')}
        {text('cnpj', 'cnpj', 'code')}
        {text('employeeName', 'employeeName')}
        {text('employeeID', 'employeeID', 'code')}
      </div>

      <h3 className="section-title">Identificação do comprovante</h3>
      <div className="group">
        {text('clockID', 'clockID', 'code')}
        {text('ticketNumber', 'ticketNumber', 'code')}
        {text('authCode', 'authCode', 'code')}
      </div>

      <h3 className="section-title">Organização</h3>
      <div className="group">
        <div className="field">
          <span className="field-label">Etiquetas</span>
          <div className="chips">
            {[...new Set([...SUGGESTED_TAGS, ...r.tags])].sort().map((tag) => {
              const on = r.tags.includes(tag);
              return (
                <button type="button" key={tag} className={on ? 'chip chip-on' : 'chip'} aria-pressed={on}
                  onClick={() => set({ tags: on ? r.tags.filter((t) => t !== tag) : [...r.tags, tag] })}>
                  {on ? '✓ ' : '+ '}{tag}
                </button>
              );
            })}
          </div>
          <div className="inline">
            <input className="input" placeholder="Nova etiqueta" value={newTag} onChange={(e) => setNewTag(e.target.value)} aria-label="Nova etiqueta" />
            <button type="button" className="btn btn-secondary btn-small" disabled={!newTag.trim()}
              onClick={() => { const t = newTag.trim(); if (t && !r.tags.includes(t)) set({ tags: [...r.tags, t] }); setNewTag(''); }}>Adicionar</button>
          </div>
        </div>
        <label className="row toggle-row">
          <span className="grow">Sinalizar para conferência</span>
          <input type="checkbox" role="switch" className="switch" checked={r.isFlagged} onChange={(e) => set({ isFlagged: e.target.checked })} />
        </label>
        <label className="field">
          <span className="field-label">Observações pessoais</span>
          <textarea className="input" rows={3} value={r.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>

      {ocrText && (
        <details className="group details">
          <summary>Texto reconhecido</summary>
          <pre className="ocr-text">{ocrText}</pre>
        </details>
      )}

      <div className="actions">
        {problems.map((p) => <p key={p} className="small tint-orange">! {p}</p>)}
        <button type="button" className="btn btn-primary" disabled={problems.length > 0 || busy} onClick={() => onSave(true)}>
          <Icon name="check" /> {saveLabel} e confirmar
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onSave(false)}>
          {saveLabel} para revisar depois
        </button>
      </div>
    </form>
  );
}
