import { useEffect, useRef, useState } from 'react';
import { WEEKDAY_NAMES, capitalize, formatDuration } from '../../core/calendar';
import { STANDARD_SCHEDULE } from '../../core/workday';
import { ticketsCSV } from '../../core/workday';
import { APP_VERSION, createBackup, restoreBackup } from '../../services/backup';
import { storageEstimate } from '../../services/db';
import { shareOrDownload, textFile } from '../../services/export';
import { enrollLock, lockSupported, verifyOwner } from '../../services/lock';
import { Confirm, Icon, LinkRow, Notice, Page, Section, Toggle, formatDateTime } from '../components';
import { useStore } from '../store';

export function Settings() {
  const { settings, updateSettings, tickets, removeAll, backupOverdue } = useStore();
  const [supported, setSupported] = useState<boolean>();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { lockSupported().then(setSupported); }, []);

  async function setLock(on: boolean) {
    try {
      if (on) {
        const credentialId = await enrollLock();
        await updateSettings({ lockEnabled: true, credentialId });
        setMessage({ tone: 'ok', text: 'Proteção ativada. O portal pedirá Face ID / código ao abrir.' });
      } else {
        if (settings.credentialId && !(await verifyOwner(settings.credentialId))) return;
        await updateSettings({ lockEnabled: false });
      }
    } catch {
      setMessage({ tone: 'error', text: 'Não foi possível ativar a proteção neste navegador.' });
    }
  }

  async function deleteAll() {
    setConfirmDelete(false);
    if (settings.lockEnabled && settings.credentialId && !(await verifyOwner(settings.credentialId))) return;
    await removeAll();
    setMessage({ tone: 'ok', text: 'Todos os tickets foram apagados deste aparelho.' });
  }

  return (
    <Page title="Ajustes" large>
      <Section title="Segurança" footer={supported === false
        ? 'Este navegador não oferece Face ID/Touch ID para sites. No iPhone, use o Safari com código configurado no aparelho.'
        : 'Pede Face ID, Touch ID ou o código do aparelho ao abrir o portal e depois de 1 minuto em segundo plano.'}>
        <Toggle label="Exigir Face ID / código" checked={settings.lockEnabled} disabled={!supported && !settings.lockEnabled} onChange={setLock} />
      </Section>

      <Section title="Seus dados" footer={settings.lastBackupAt ? `Último backup: ${formatDateTime(settings.lastBackupAt)}.` : 'Nenhum backup foi feito ainda.'}>
        <LinkRow href="#/ajustes/backup" badge={backupOverdue ? <span className="tint-orange" aria-label="Backup pendente">!</span> : undefined}>Backup e exportação</LinkRow>
        <LinkRow href="#/ajustes/armazenamento">Onde meus dados ficam</LinkRow>
      </Section>

      <Section title="Jornada de trabalho">
        <Toggle label="Análise de jornada" checked={settings.analysisEnabled} onChange={(v) => updateSettings({ analysisEnabled: v })} />
        <LinkRow href="#/ajustes/jornada">Jornada de referência</LinkRow>
      </Section>

      <Section title="Privacidade">
        <LinkRow href="#/ajustes/privacidade">Política de privacidade</LinkRow>
        <button className="row link-row tint-red" disabled={!tickets.length} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={18} /> Apagar todos os dados</button>
      </Section>

      <Section title="Sobre">
        <div className="row"><span className="grow">Versão</span>{APP_VERSION}</div>
        <div className="row"><span className="grow">Reconhecimento de texto</span>No aparelho</div>
        <div className="row"><span className="grow">Anúncios e rastreamento</span>Nenhum</div>
      </Section>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Confirm open={confirmDelete} destructive title={`Apagar todos os ${tickets.length} tickets?`} confirmLabel="Apagar tudo deste aparelho"
        message="Fotos, dados e histórico serão apagados deste aparelho. Arquivos de backup salvos em outros locais não são afetados. Recomendamos fazer um backup antes."
        onConfirm={deleteAll} onCancel={() => setConfirmDelete(false)} />
    </Page>
  );
}

export function BackupScreen() {
  const { settings, updateSettings, tickets, reload } = useStore();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'info'; text: string }>();
  const [pendingFile, setPendingFile] = useState<File>();
  const input = useRef<HTMLInputElement>(null);
  const overdue = !settings.lastBackupAt || Date.now() - new Date(settings.lastBackupAt).getTime() > settings.backupReminderDays * 86_400_000;

  async function backup() {
    setBusy(true);
    setMessage(undefined);
    try {
      const file = await createBackup({ schedule: settings.schedule, analysisEnabled: settings.analysisEnabled });
      await shareOrDownload(file);
      await updateSettings({ lastBackupAt: new Date().toISOString() });
      setMessage({ tone: 'ok', text: `Backup gerado (${(file.size / 1_048_576).toFixed(1)} MB). Guarde-o em local seguro, como o iCloud Drive.` });
    } catch (e) {
      setMessage({ tone: 'error', text: `Não foi possível gerar o backup. (${(e as Error).message})` });
    } finally {
      setBusy(false);
    }
  }

  async function restore(file: File) {
    setPendingFile(undefined);
    setBusy(true);
    setMessage(undefined);
    try {
      const r = await restoreBackup(file);
      if (!tickets.length && r.settings.schedule) await updateSettings({ schedule: r.settings.schedule, analysisEnabled: r.settings.analysisEnabled ?? true });
      await reload();
      setMessage({ tone: 'ok', text: `${r.inserted} ticket(s) restaurado(s).${r.skipped ? ` ${r.skipped} já existiam e foram mantidos sem alteração.` : ''}` });
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Backup e exportação" backTo="ajustes">
      <Section title="Situação do backup">
        <div className="row">
          <span className={tickets.length === 0 ? 'muted' : overdue ? 'tint-orange' : 'tint-green'}><Icon name={overdue ? 'alert' : 'check'} /></span>
          <span className="grow stack-tight">
            <b>{tickets.length === 0 ? 'Nada para copiar ainda' : !settings.lastBackupAt ? 'Nenhum backup feito' : overdue ? 'Backup desatualizado' : 'Backup em dia'}</b>
            <span className="small muted">{tickets.length} ticket(s) neste aparelho. {settings.lastBackupAt ? `Último backup: ${formatDateTime(settings.lastBackupAt)}.` : 'Faça um backup para não perder seus comprovantes se o aparelho for perdido, trocado ou se o navegador apagar os dados.'}</span>
          </span>
        </div>
      </Section>

      <Section title="Backup completo" footer="Gera um arquivo .zip com todos os tickets, fotos originais, histórico e uma planilha. Ele abre em qualquer computador. Você escolhe onde salvar (Arquivos, iCloud Drive, Google Drive, e-mail…). Guarde-o em local seguro: o arquivo não tem senha.">
        <button className="row link-row" disabled={!tickets.length || busy} onClick={backup}><Icon name="download" size={18} /> Fazer backup agora</button>
        <label className="row">
          <span className="grow">Lembrar de fazer backup a cada</span>
          <select className="input input-inline" value={settings.backupReminderDays} onChange={(e) => updateSettings({ backupReminderDays: Number(e.target.value) })}>
            <option value={7}>7 dias</option><option value={15}>15 dias</option><option value={30}>30 dias</option>
          </select>
        </label>
      </Section>

      <Section title="Restaurar" footer="A restauração só adiciona tickets que ainda não existem. Nenhum ticket existente é apagado ou substituído. O arquivo é verificado antes de qualquer gravação.">
        <button className="row link-row" disabled={busy} onClick={() => input.current?.click()}><Icon name="reset" size={18} /> Restaurar de um backup (.zip)</button>
        <input ref={input} type="file" accept=".zip,application/zip" hidden data-testid="restore-input"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPendingFile(f); }} />
      </Section>

      <Section title="Exportação" footer="A planilha abre no Excel, Numbers ou Planilhas Google.">
        <button className="row link-row" disabled={!tickets.length} onClick={() => shareOrDownload(textFile(ticketsCSV(tickets), 'MeuPontoDigital-tickets.csv'))}><Icon name="download" size={18} /> Exportar planilha (CSV)</button>
      </Section>

      {busy && <Notice tone="info"><span className="spinner" /> Processando… mantenha esta tela aberta.</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Confirm open={!!pendingFile} title="Restaurar backup?" confirmLabel="Restaurar"
        message={<p>Arquivo: <b>{pendingFile?.name}</b>. Os tickets do backup que ainda não estão neste aparelho serão adicionados. Nada será apagado.</p>}
        onConfirm={() => pendingFile && restore(pendingFile)} onCancel={() => setPendingFile(undefined)} />
    </Page>
  );
}

export function ScheduleScreen() {
  const { settings, updateSettings } = useStore();
  const s = settings.schedule;
  const set = (patch: Partial<typeof s>) => updateSettings({ schedule: { ...s, ...patch } });
  const step = (value: number, delta: number, max: number) => Math.min(max, Math.max(0, value + delta));

  return (
    <Page title="Jornada de referência" backTo="ajustes">
      <Section title="Horas previstas por dia" footer="Informe a jornada do seu contrato ou acordo. Ela serve só como referência para comparar com os tickets.">
        {s.expectedMinutesByWeekday.map((m, i) => (
          <div className="row" key={i}>
            <span className="grow">{capitalize(WEEKDAY_NAMES[i])}</span>
            <Stepper label={WEEKDAY_NAMES[i]} text={m === 0 ? 'Folga' : formatDuration(m)}
              onMinus={() => set({ expectedMinutesByWeekday: s.expectedMinutesByWeekday.map((v, k) => (k === i ? step(v, -30, 840) : v)) })}
              onPlus={() => set({ expectedMinutesByWeekday: s.expectedMinutesByWeekday.map((v, k) => (k === i ? step(v, 30, 840) : v)) })} />
          </div>
        ))}
      </Section>
      <Section title="Intervalo" footer="Usado apenas para destacar dias que merecem conferência. Regras de intervalo variam conforme contrato, convenção coletiva e legislação.">
        <div className="row"><span className="grow">Intervalo de referência</span>
          <Stepper label="intervalo" text={formatDuration(s.minimumBreakMinutes)} onMinus={() => set({ minimumBreakMinutes: step(s.minimumBreakMinutes, -15, 180) })} onPlus={() => set({ minimumBreakMinutes: step(s.minimumBreakMinutes, 15, 180) })} /></div>
        <div className="row"><span className="grow">Esperado em jornadas acima de</span>
          <Stepper label="limite" text={formatDuration(s.breakRequiredAfterMinutes)} onMinus={() => set({ breakRequiredAfterMinutes: step(s.breakRequiredAfterMinutes, -30, 720) })} onPlus={() => set({ breakRequiredAfterMinutes: step(s.breakRequiredAfterMinutes, 30, 720) })} /></div>
      </Section>
      <button className="btn btn-secondary" onClick={() => updateSettings({ schedule: STANDARD_SCHEDULE })}>Restaurar padrão (8h de segunda a sexta)</button>
    </Page>
  );
}

function Stepper({ text, onMinus, onPlus, label }: { text: string; onMinus: () => void; onPlus: () => void; label: string }) {
  return (
    <span className="stepper">
      <button aria-label={`Diminuir ${label}`} onClick={onMinus}>−</button>
      <span className="mono" aria-live="polite">{text}</span>
      <button aria-label={`Aumentar ${label}`} onClick={onPlus}>+</button>
    </span>
  );
}

export function StorageScreen() {
  const { tickets } = useStore();
  const [info, setInfo] = useState<{ usage?: number; quota?: number; persisted: boolean }>();
  useEffect(() => { storageEstimate().then(setInfo); }, []);
  const mb = (b?: number) => (b === undefined ? '—' : `${(b / 1_048_576).toFixed(1)} MB`);
  return (
    <Page title="Onde meus dados ficam" backTo="ajustes">
      <Section>
        <div className="row"><span className="grow">Tickets</span>{tickets.length}</div>
        <div className="row"><span className="grow">Espaço usado</span>{mb(info?.usage)}</div>
        <div className="row"><span className="grow">Local</span>Somente neste aparelho, neste navegador</div>
        <div className="row"><span className="grow">Armazenamento persistente</span>{info?.persisted ? 'Sim' : 'Não confirmado'}</div>
        <div className="row"><span className="grow">Envio para a internet</span>Nunca automático</div>
      </Section>
      <Notice tone="info">
        Os tickets ficam no armazenamento privado deste site, dentro do navegador (IndexedDB). O site não tem servidor de dados: nada é enviado. Isso também significa que <b>apagar os dados do site, desinstalar o app da Tela de Início ou trocar de aparelho apaga os tickets</b> — por isso faça backups. No iPhone, instale o portal na Tela de Início para que o Safari não apague os dados por falta de uso.
      </Notice>
    </Page>
  );
}

export function PrivacyScreen() {
  const items: [string, string][] = [
    ['Quais dados o portal trata', 'Fotografias de comprovantes de ponto e as informações impressas neles (nome, matrícula, PIS/CPF, empresa, CNPJ, data, horário, códigos), além das observações e etiquetas que você adicionar. São dados pessoais e são tratados como confidenciais.'],
    ['Para que são usados', 'Somente para organizar, consultar e analisar os seus próprios comprovantes, a seu pedido.'],
    ['Onde ficam', 'Exclusivamente neste aparelho, no armazenamento privado do navegador para este site. O reconhecimento de texto (OCR) roda no próprio aparelho. O portal não tem servidor de dados.'],
    ['Compartilhamento', 'Nenhum. O portal não envia fotos ou dados pela internet, não tem anúncios, não usa rastreamento nem ferramentas de análise de terceiros. Um ticket só sai do aparelho quando você toca em compartilhar, exportar, imprimir ou fazer backup — e você escolhe o destino.'],
    ['O que é baixado da internet', 'Apenas os arquivos do próprio portal (telas e o motor de reconhecimento de texto), do mesmo endereço do site. Depois disso, ele funciona sem internet.'],
    ['Backups', 'O backup é um arquivo .zip que você salva onde quiser. Ele não tem senha: guarde-o em local seguro.'],
    ['Seus direitos (LGPD)', 'Você pode consultar, corrigir (com histórico), exportar (backup .zip e CSV) e excluir um ticket ou todos os dados, a qualquer momento, no próprio portal. Como os dados não saem do aparelho, não há pedido a fazer a terceiros.'],
    ['Serviços externos', 'A versão atual não usa nenhum. Se no futuro algum recurso opcional precisar enviar dados (como sincronização), ele ficará desligado por padrão e pedirá seu consentimento explícito.'],
    ['Limites', 'Os dados extraídos por OCR podem conter erros; o comprovante original é a referência. O portal não altera horários impressos e não substitui o sistema oficial de ponto da empresa.'],
  ];
  return (
    <Page title="Política de privacidade" backTo="ajustes">
      <p className="small muted">Versão 1.0 — Meu Ponto Digital.</p>
      {items.map(([title, text]) => <section key={title} className="policy"><h2>{title}</h2><p>{text}</p></section>)}
    </Page>
  );
}
