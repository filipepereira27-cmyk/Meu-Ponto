import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { DUPLICATE_REASON_LABEL, diffRecords, duplicatesOf, type DuplicateMatch } from '../../core/archive';
import { brDate } from '../../core/calendar';
import { parseTicket } from '../../core/parser';
import { newId, recordFromParsed, type ParsedTicket } from '../../core/types';
import { canvasToBlob, cropCanvas, decodeImage, imageHash, rotateCanvas, thumbnail, toCanvas } from '../../services/image';
import { readPlainCanvas, readTicketCanvas } from '../../services/ocr';
import { Confirm, Icon, Notice } from '../components';
import { useStore } from '../store';
import { TicketForm, draftToRecord, makeDraft, type Draft } from './TicketForm';

type Stage =
  | { kind: 'loading' }
  | { kind: 'editing'; base: HTMLCanvasElement }
  | { kind: 'reading'; progress: number }
  | { kind: 'review'; draft: Draft; parsed: ParsedTicket; processed: HTMLCanvasElement; previewURL: string }
  | { kind: 'failed'; message: string; processed?: HTMLCanvasElement };

interface Rect { x: number; y: number; w: number; h: number }
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Fluxo de inclusão: ajustar imagem → reconhecer → revisar → salvar. Vários arquivos em fila. */
export function CaptureFlow({ files, fromCamera, onClose }: { files: File[]; fromCamera: boolean; onClose: () => void }) {
  const { tickets, addTicket } = useStore();
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [saved, setSaved] = useState(0);
  const [askCancel, setAskCancel] = useState(false);
  const [duplicates, setDuplicates] = useState<{ matches: DuplicateMatch[]; confirm: boolean }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const file = files[index];

  useEffect(() => {
    let alive = true;
    setStage({ kind: 'loading' });
    decodeImage(file)
      .then((img) => { if (alive) setStage({ kind: 'editing', base: toCanvas(img, 2600) }); })
      .catch(() => { if (alive) setStage({ kind: 'failed', message: 'Este arquivo não é uma imagem que o navegador consiga abrir. Em iPhone, prefira JPEG ou escolha “Mais compatível” em Ajustes › Câmera › Formatos.' }); });
    return () => { alive = false; };
  }, [file]);

  const next = () => {
    if (index + 1 < files.length) setIndex(index + 1);
    else onClose();
  };

  async function read(base: HTMLCanvasElement, turns: number, crop: Rect, enhance: boolean) {
    const cropped = cropCanvas(rotateCanvas(base, turns), crop);
    setStage({ kind: 'reading', progress: 0 });
    let processed = cropped;
    try {
      let parsed: ParsedTicket;
      if (enhance) {
        // Recorte automático só quando o usuário não recortou à mão.
        const manualCrop = crop.x > 0 || crop.y > 0 || crop.w < 1 || crop.h < 1;
        const result = await readTicketCanvas(cropped, { autoCrop: !manualCrop, onProgress: (p) => setStage({ kind: 'reading', progress: p }) });
        processed = result.preparedCanvas;
        parsed = result.parsed;
      } else {
        parsed = parseTicket(await readPlainCanvas(cropped));
      }
      if (!parsed.fullText.trim()) {
        setStage({ kind: 'failed', message: 'Nenhum texto foi encontrado. Fotografe com boa luz, sem reflexo, e enquadre o ticket inteiro.', processed });
        return;
      }
      const record = recordFromParsed(parsed, { imageHash: imageHash(processed) });
      setStage({ kind: 'review', draft: makeDraft(record, parsed.warnings), parsed, processed, previewURL: processed.toDataURL('image/jpeg', 0.8) });
    } catch {
      setStage({
        kind: 'failed', processed,
        message: navigator.onLine
          ? 'O reconhecimento de texto falhou. Tente novamente ou preencha manualmente.'
          : 'O reconhecimento de texto ainda não foi baixado para uso sem internet. Conecte-se uma vez e tente de novo, ou preencha manualmente.',
      });
    }
  }

  function manual(processed?: HTMLCanvasElement) {
    const parsed: ParsedTicket = { otherFields: [], fullText: '', averageConfidence: 0, warnings: ['Preenchimento manual: confira os dados com o comprovante.'] };
    const canvas = processed ?? document.createElement('canvas');
    setStage({ kind: 'review', draft: makeDraft(recordFromParsed(parsed, processed ? { imageHash: imageHash(canvas) } : {}), parsed.warnings), parsed, processed: canvas, previewURL: processed ? canvas.toDataURL('image/jpeg', 0.8) : '' });
  }

  async function save(confirm: boolean, skipDuplicateCheck = false) {
    if (stage.kind !== 'review') return;
    const record = draftToRecord(stage.draft, confirm);
    if (!skipDuplicateCheck) {
      const matches = duplicatesOf(record, tickets);
      if (matches.length) { setDuplicates({ matches, confirm }); return; }
    }
    setBusy(true);
    try {
      const now = new Date();
      const id = newId();
      const name = fromCamera ? `Camera-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg` : file.name || 'imagem.jpg';
      const baseline = { ...recordFromParsed(stage.parsed), id, imageHash: record.imageHash };
      const final = {
        ...record, id, importedAt: now.toISOString(), updatedAt: now.toISOString(),
        originalFileName: name, originalMimeType: file.type || 'image/jpeg',
        hasProcessedImage: stage.processed.width > 0,
      };
      final.changes = [
        { id: newId(), date: now.toISOString(), field: 'Inclusão', oldValue: '—', newValue: `Digitalizado (${name}) e reconhecido por OCR` },
        ...diffRecords(baseline, final, now),
      ];
      const images: Record<string, Blob> = { original: file };
      if (final.hasProcessedImage) {
        images.tratada = await canvasToBlob(stage.processed, 'image/jpeg', 0.9);
        images.miniatura = await thumbnail(images.tratada);
      } else {
        try { images.miniatura = await thumbnail(file); } catch { /* sem miniatura */ }
      }
      await addTicket(final, images);
      setSaved((n) => n + 1);
      setDuplicates(undefined);
      next();
    } catch (e) {
      setError(`O ticket não foi salvo. Verifique o espaço livre no aparelho e tente novamente. (${(e as Error).message})`);
    } finally {
      setBusy(false);
    }
  }

  const byId = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);

  return (
    <div className="flow" role="dialog" aria-modal="true" aria-label="Novo ticket">
      <header className="bar">
        <button className="link" onClick={() => setAskCancel(true)}>Cancelar</button>
        <h1>{files.length > 1 ? `Ticket ${index + 1} de ${files.length}` : 'Novo ticket'}</h1>
        <span className="bar-actions">{files.length > 1 && <button className="link" onClick={next}>Pular</button>}</span>
      </header>
      <div className="flow-body">
        {stage.kind === 'loading' && <div className="center"><span className="spinner" /> Abrindo imagem…</div>}
        {stage.kind === 'editing' && <Editor key={index} base={stage.base} onDone={read} />}
        {stage.kind === 'reading' && (
          <div className="center stack">
            <span className="spinner" />
            <b>Reconhecendo o texto no aparelho…</b>
            <progress max={1} value={stage.progress} aria-label="Progresso do reconhecimento" />
            <span className="small muted">Nenhuma imagem é enviada para a internet.</span>
          </div>
        )}
        {stage.kind === 'failed' && (
          <div className="center stack">
            <Notice tone="error">{stage.message}</Notice>
            {stage.processed && <button className="btn btn-primary" onClick={() => decodeImage(file).then((i) => setStage({ kind: 'editing', base: toCanvas(i, 2600) }))}>Ajustar a imagem novamente</button>}
            <button className="btn btn-secondary" onClick={() => manual(stage.processed)}>Preencher manualmente</button>
          </div>
        )}
        {stage.kind === 'review' && (
          <div className="content">
            {stage.previewURL && <img className="review-image" src={stage.previewURL} alt="Ticket recortado" />}
            <TicketForm draft={stage.draft} setDraft={(d) => setStage({ ...stage, draft: d })} ocrText={stage.parsed.fullText}
              onSave={(c) => save(c)} busy={busy} />
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        )}
      </div>

      <Confirm open={askCancel} title="Descartar este ticket?" destructive confirmLabel="Descartar e sair"
        message={saved ? `${saved} ticket(s) já foram salvos. O atual não será salvo.` : 'A imagem e os dados reconhecidos não serão salvos.'}
        onConfirm={onClose} onCancel={() => setAskCancel(false)} />

      <Confirm open={!!duplicates} title="Possível duplicidade" confirmLabel="Salvar mesmo assim"
        message={<div className="stack">
          <p>Este ticket parece já estar arquivado:</p>
          <ul className="list">
            {duplicates?.matches.slice(0, 3).map((m) => {
              const other = byId.get(m.second);
              return <li key={m.second}><b>{other?.recordDate ? brDate(other.recordDate) : 'Sem data'} {other?.recordTime ?? ''}</b> — {m.reasons.map((r) => DUPLICATE_REASON_LABEL[r]).join('; ')}</li>;
            })}
          </ul>
          <p className="small muted">Nada será apagado automaticamente. Você decide.</p>
        </div>}
        onConfirm={() => duplicates && save(duplicates.confirm, true)} onCancel={() => setDuplicates(undefined)} />
    </div>
  );
}

/** Recorte pelos quatro cantos, giro de 90° e realce. Trabalha numa cópia: o original é preservado. */
function Editor({ base, onDone }: { base: HTMLCanvasElement; onDone: (base: HTMLCanvasElement, turns: number, crop: Rect, enhance: boolean) => void }) {
  const [turns, setTurns] = useState(0);
  const [crop, setCrop] = useState<Rect>(FULL);
  const [enhance, setEnhance] = useState(true);
  const rotated = useMemo(() => rotateCanvas(base, turns), [base, turns]);
  const url = useMemo(() => toCanvas(rotated, 1400).toDataURL('image/jpeg', 0.85), [rotated]);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ corner: number } | null>(null);

  const rotate = (d: number) => { setTurns((t) => t + d); setCrop(FULL); };

  function move(e: RPointerEvent) {
    if (!drag.current || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
    const y = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
    const min = 0.1;
    let { x: x0, y: y0 } = crop;
    let x1 = crop.x + crop.w, y1 = crop.y + crop.h;
    const c = drag.current.corner;
    if (c === 0 || c === 2) x0 = Math.min(x, x1 - min); else x1 = Math.max(x, x0 + min);
    if (c === 0 || c === 1) y0 = Math.min(y, y1 - min); else y1 = Math.max(y, y0 + min);
    setCrop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  const corners = [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]];
  const names = ['superior esquerdo', 'superior direito', 'inferior esquerdo', 'inferior direito'];

  return (
    <div className="editor">
      <div className="editor-stage">
        <div className="crop-box" ref={box} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
          <img src={url} alt="Prévia do ticket" draggable={false} />
          <div className="crop-rect" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
          {corners.map(([cx, cy], i) => (
            <button key={i} type="button" className="crop-handle" aria-label={`Canto ${names[i]}`}
              style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { corner: i }; }}
              onPointerMove={move} onPointerUp={() => (drag.current = null)} />
          ))}
        </div>
      </div>
      <div className="editor-tools">
        <p className="small muted center-text">O ticket é localizado e endireitado automaticamente. Se precisar, arraste os cantos.</p>
        <details className="small muted tips">
          <summary>Dicas para uma boa leitura</summary>
          <ul>
            <li>Luz uniforme, sem sombra do celular sobre o papel e sem flash refletindo.</li>
            <li>Ticket esticado sobre uma superfície escura e lisa.</li>
            <li>Aproxime até o ticket ocupar quase toda a tela, com foco nítido.</li>
            <li>Tickets térmicos desbotam com o tempo: fotografe logo após a marcação.</li>
          </ul>
        </details>
        <div className="tool-row">
          <button type="button" className="tool" onClick={() => rotate(-1)}><Icon name="rotateL" /><span>Girar ←</span></button>
          <button type="button" className="tool" onClick={() => rotate(1)}><Icon name="rotateR" /><span>Girar →</span></button>
          <button type="button" className={enhance ? 'tool tool-on' : 'tool'} aria-pressed={enhance} onClick={() => setEnhance(!enhance)}><Icon name="wand" /><span>Realce</span></button>
          <button type="button" className="tool" onClick={() => { setTurns(0); setCrop(FULL); setEnhance(true); }}><Icon name="reset" /><span>Restaurar</span></button>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => onDone(base, turns, crop, enhance)}>Reconhecer texto</button>
      </div>
    </div>
  );
}
