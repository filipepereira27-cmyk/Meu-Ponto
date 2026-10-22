import { useMemo, useState } from 'react';
import { DUPLICATE_REASON_LABEL, duplicatesOf } from '../../core/archive';
import { WEEKDAY_NAMES, brDate, weekday } from '../../core/calendar';
import { FIELD_LABEL, MARK_LABEL, TICKET_FIELDS, type TicketField, type TicketRecord } from '../../core/types';
import { getImage } from '../../services/db';
import { shareOrDownload, ticketPDF } from '../../services/export';
import { Card, Confidence, Confirm, Empty, Icon, MarkBadge, Modal, Notice, Page, Section, TicketRow, formatDateTime, useImageURL } from '../components';
import { back } from '../router';
import { useStore } from '../store';
import { TicketForm, draftToRecord, makeDraft, type Draft } from './TicketForm';

export function Detail({ id }: { id: string }) {
  const { byId, tickets, editTicket, removeTicket } = useStore();
  const t = byId.get(id);
  const [showProcessed, setShowProcessed] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);
  const url = useImageURL(t?.id, showProcessed ? 'tratada' : 'original');
  const duplicates = useMemo(() => (t ? duplicatesOf(t, tickets) : []), [t, tickets]);

  if (!t) return <Page title="Ticket" backTo="arquivo"><Empty title="Ticket não encontrado">Ele pode ter sido excluído.</Empty></Page>;

  const save = async (edited: TicketRecord) => {
    try { await editTicket(edited); } catch (e) { setMessage(`Não foi possível salvar. (${(e as Error).message})`); }
  };

  const share = async (kind: 'pdf' | 'image') => {
    setWorking(true);
    try {
      const original = await getImage(t.id, 'original');
      if (kind === 'pdf') await shareOrDownload(await ticketPDF(t, original));
      else if (original) await shareOrDownload(new File([original], t.originalFileName || 'ticket.jpg', { type: original.type }));
    } catch (e) {
      setMessage(`Não foi possível gerar o arquivo. (${(e as Error).message})`);
    } finally {
      setWorking(false);
    }
  };

  const print = async () => {
    setWorking(true);
    try {
      const pdf = await ticketPDF(t, await getImage(t.id, 'original'));
      const u = URL.createObjectURL(pdf);
      const w = window.open(u);
      if (!w) await shareOrDownload(pdf);
    } finally {
      setWorking(false);
    }
  };

  const value = (f: TicketField): string => {
    switch (f) {
      case 'date': return t.recordDate ? `${brDate(t.recordDate)} (${WEEKDAY_NAMES[weekday(t.recordDate)]})` : '';
      case 'time': return t.recordTime ?? '';
      case 'markType': return t.markType === 'indefinido' ? '' : MARK_LABEL[t.markType];
      case 'company': return t.company;
      case 'cnpj': return t.cnpj;
      case 'employeeName': return t.employeeName;
      case 'employeeID': return t.employeeID;
      case 'clockID': return t.clockID;
      case 'ticketNumber': return t.ticketNumber;
      case 'authCode': return t.authCode;
    }
  };

  return (
    <Page title={t.recordDate ? brDate(t.recordDate) : 'Ticket'} backTo="arquivo"
      actions={<button className="link" onClick={() => setDraft(makeDraft(t))}>Editar</button>}>
      {t.hasProcessedImage && (
        <div className="segmented" role="tablist" aria-label="Imagem">
          <button role="tab" aria-selected={!showProcessed} onClick={() => setShowProcessed(false)}>Original</button>
          <button role="tab" aria-selected={showProcessed} onClick={() => setShowProcessed(true)}>Recortada</button>
        </div>
      )}
      <button className="photo" onClick={() => url && setViewer(true)} aria-label="Ampliar foto do comprovante">
        {url ? <img src={url} alt="Foto do comprovante" /> : <span className="spinner" />}
      </button>
      <p className="section-footer">{showProcessed ? 'Cópia recortada usada no reconhecimento.' : 'Fotografia original, preservada sem alterações. Toque para ampliar.'}</p>

      <Section>
        <div className="row">
          {t.isConfirmed ? <span className="grow tint-green"><Icon name="check" size={18} /> Revisão confirmada</span>
            : <span className="grow tint-orange">! Revisão pendente</span>}
          <MarkBadge type={t.markType} />
        </div>
        {!t.isConfirmed && <button className="row link-row" onClick={() => setDraft(makeDraft(t))}>Conferir e confirmar dados</button>}
        <button className="row link-row" onClick={() => {
          const tags = !t.isFlagged && !t.tags.includes('Divergência') ? [...t.tags, 'Divergência'] : t.tags;
          void save({ ...t, isFlagged: !t.isFlagged, tags });
        }}>{t.isFlagged ? 'Remover sinalização' : 'Sinalizar para conferência'}</button>
        {t.journeyDate && t.journeyDate !== t.recordDate && <div className="row muted"><Icon name="link" size={16} /> Associado à jornada de {brDate(t.journeyDate)}</div>}
      </Section>

      <Section title="Dados do registro">
        {TICKET_FIELDS.map((f) => (
          <div className="field" key={f}>
            <span className="field-label"><span>{FIELD_LABEL[f]}</span>{t.fieldConfidences[f] !== undefined && <Confidence value={t.fieldConfidences[f]} />}</span>
            <span className={value(f) ? 'selectable' : 'muted'}>{value(f) || 'Não informado'}</span>
          </div>
        ))}
      </Section>

      {t.otherFields.length > 0 && (
        <Section title="Outras informações do comprovante">
          {t.otherFields.map((o, i) => <div className="row" key={i}><span className="grow muted">{o.label}</span><span className="selectable">{o.value}</span></div>)}
        </Section>
      )}

      <Section title="Observações e etiquetas">
        {!t.tags.length && !t.notes && <button className="row link-row" onClick={() => setDraft(makeDraft(t))}>Adicionar observação ou etiqueta</button>}
        {t.tags.length > 0 && <div className="chips">{t.tags.map((tag) => <span key={tag} className="chip chip-on">{tag}</span>)}</div>}
        {t.notes && <p className="field selectable">{t.notes}</p>}
      </Section>

      {duplicates.length > 0 && (
        <Section title="Possível duplicidade" footer="Compare as imagens. Se for uma foto repetida, exclua a que não quiser manter. Nada é apagado automaticamente.">
          {duplicates.map((d) => {
            const other = byId.get(d.second);
            return other && (
              <div key={d.second}>
                <TicketRow t={other} />
                <p className="small tint-orange pad">{d.reasons.map((r) => DUPLICATE_REASON_LABEL[r]).join(' · ')}</p>
              </div>
            );
          })}
        </Section>
      )}

      <details className="group details">
        <summary>Texto reconhecido pelo OCR</summary>
        <pre className="ocr-text selectable">{t.ocrText || '(nenhum texto reconhecido)'}</pre>
      </details>
      <p className="section-footer">Texto preservado exatamente como reconhecido. Suas correções ficam no histórico.</p>

      <Section title="Arquivo">
        <div className="row"><span className="grow muted">Incluído em</span>{formatDateTime(t.importedAt)}</div>
        <div className="row"><span className="grow muted">Arquivo original</span><span className="ellipsis">{t.originalFileName}</span></div>
        <div className="row"><span className="grow muted">Confiança média do OCR</span>{Math.round(t.ocrConfidence * 100)}%</div>
      </Section>

      <Section title="Histórico de alterações">
        {[...t.changes].reverse().map((c) => (
          <div className="field" key={c.id}>
            <b>{c.field}</b>
            <span>{c.oldValue} → {c.newValue}</span>
            <span className="small muted">{formatDateTime(c.date)}</span>
          </div>
        ))}
        {!t.changes.length && <div className="row muted">Nenhuma alteração.</div>}
      </Section>

      <Card title="Exportar">
        <div className="stack">
          <button className="btn btn-secondary" disabled={working} onClick={() => share('pdf')}><Icon name="share" /> Compartilhar PDF</button>
          <button className="btn btn-secondary" disabled={working} onClick={() => share('image')}><Icon name="photo" /> Compartilhar foto original</button>
          <button className="btn btn-secondary" disabled={working} onClick={print}><Icon name="print" /> Imprimir</button>
          <button className="btn btn-danger-outline" onClick={() => setConfirmDelete(true)}><Icon name="trash" /> Excluir ticket</button>
        </div>
      </Card>

      {message && <Notice tone="error">{message}</Notice>}

      {viewer && url && <ImageViewer url={url} onClose={() => setViewer(false)} />}

      <Modal open={!!draft} onClose={() => setDraft(undefined)} title="Editar ticket" wide>
        {draft && <TicketForm draft={draft} setDraft={setDraft} saveLabel="Salvar"
          onSave={async (confirm) => { await save(draftToRecord(draft, confirm)); setDraft(undefined); }} />}
      </Modal>

      <Confirm open={confirmDelete} destructive title="Excluir este ticket?" confirmLabel="Excluir ticket e imagem"
        message="A foto original e os dados serão apagados deste aparelho. Esta ação não pode ser desfeita. Backups já feitos não são alterados."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => { setConfirmDelete(false); await removeTicket(t.id); back('arquivo'); }} />
    </Page>
  );
}

/** Visualizador em tela cheia com zoom (botões, toque duplo e pinça). */
function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Foto do comprovante">
      <div className="viewer-scroll" onDoubleClick={() => setZoom(zoom > 1 ? 1 : 2.5)}>
        <img src={url} alt="Foto do comprovante ampliada" style={{ width: `${zoom * 100}%` }} />
      </div>
      <div className="viewer-tools">
        <button className="icon-button" aria-label="Diminuir zoom" onClick={() => setZoom(Math.max(1, zoom / 1.5))}><Icon name="zoomOut" /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="icon-button" aria-label="Aumentar zoom" onClick={() => setZoom(Math.min(6, zoom * 1.5))}><Icon name="zoomIn" /></button>
        <button className="icon-button" aria-label="Fechar" onClick={onClose}><Icon name="x" /></button>
      </div>
    </div>
  );
}
