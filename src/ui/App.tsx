import { useEffect, useRef, useState } from 'react';
import { warmUpOCR } from '../services/ocr';
import { enrollLock, lockSupported, verifyOwner } from '../services/lock';
import { Icon, Modal } from './components';
import { useRoute } from './router';
import { useStore } from './store';
import { Analysis } from './screens/Analysis';
import { Archive, Duplicates } from './screens/Archive';
import { CalendarScreen, DayScreen } from './screens/Calendar';
import { CaptureFlow } from './screens/Capture';
import { Detail } from './screens/Detail';
import { Home } from './screens/Home';
import { BackupScreen, PrivacyScreen, ScheduleScreen, Settings, StorageScreen } from './screens/Settings';

const LOCK_GRACE_MS = 60_000;

export function App({ updateAvailable, onUpdate }: { updateAvailable: boolean; onUpdate: () => void }) {
  const { ready, settings, captureRequest } = useStore();
  const route = useRoute();
  const [locked, setLocked] = useState<boolean>();
  const [capture, setCapture] = useState<{ files: File[]; fromCamera: boolean }>();
  const cameraInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const hiddenAt = useRef<number>(0);

  // Bloqueio ao abrir e ao voltar depois de um tempo em segundo plano.
  useEffect(() => {
    if (!ready) return;
    setLocked((l) => l ?? (settings.lockEnabled && !!settings.credentialId));
  }, [ready, settings.lockEnabled, settings.credentialId]);
  useEffect(() => {
    const on = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (settings.lockEnabled && settings.credentialId && Date.now() - hiddenAt.current > LOCK_GRACE_MS) setLocked(true);
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [settings.lockEnabled, settings.credentialId]);

  // Deixa o OCR pronto (e guardado para uso sem internet) logo após abrir.
  useEffect(() => {
    if (!ready || !navigator.onLine) return;
    const t = setTimeout(warmUpOCR, 2500);
    return () => clearTimeout(t);
  }, [ready]);

  // Botões "Fotografar" / "Importar" de qualquer tela.
  useEffect(() => {
    if (!captureRequest) return;
    (captureRequest.mode === 'camera' ? cameraInput : filesInput).current?.click();
  }, [captureRequest]);

  if (!ready || locked === undefined) return <div className="splash"><span className="spinner" /></div>;
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;

  const [section, arg] = route;
  let screen: React.ReactNode;
  let tab = section ?? '';
  switch (section) {
    case undefined: screen = <Home />; break;
    case 'arquivo': screen = <Archive />; break;
    case 'duplicidades': screen = <Duplicates />; tab = 'arquivo'; break;
    case 'ticket': screen = <Detail id={arg} />; tab = 'arquivo'; break;
    case 'calendario': screen = <CalendarScreen />; break;
    case 'dia': screen = <DayScreen day={arg} />; tab = 'calendario'; break;
    case 'jornada': screen = <Analysis />; break;
    case 'ajustes':
      screen = arg === 'backup' ? <BackupScreen /> : arg === 'jornada' ? <ScheduleScreen /> : arg === 'privacidade' ? <PrivacyScreen />
        : arg === 'armazenamento' ? <StorageScreen /> : <Settings />;
      break;
    default: screen = <Home />; tab = '';
  }

  const pick = (fromCamera: boolean) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
    e.target.value = '';
    if (files.length) setCapture({ files: files.slice(0, 20), fromCamera });
  };

  return (
    <>
      {updateAvailable && (
        <div className="update-banner" role="status">
          Nova versão disponível. <button className="link" onClick={onUpdate}>Atualizar</button>
        </div>
      )}
      {screen}
      {tab === '' && !section && <CaptureBar />}
      <TabBar current={tab} analysis={settings.analysisEnabled} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={pick(true)} data-testid="camera-input" />
      <input ref={filesInput} type="file" accept="image/*" multiple hidden onChange={pick(false)} data-testid="files-input" />
      {capture && <CaptureFlow files={capture.files} fromCamera={capture.fromCamera} onClose={() => setCapture(undefined)} />}
      <Onboarding />
    </>
  );
}

/** Ações principais fixas na parte de baixo: alcançáveis com o polegar. */
function CaptureBar() {
  const { startCapture } = useStore();
  return (
    <div className="capture-bar">
      <button className="btn btn-primary btn-large" onClick={() => startCapture('camera')}><Icon name="camera" /> Fotografar ticket</button>
      <button className="btn btn-secondary" onClick={() => startCapture('files')}><Icon name="photo" /> Importar foto ou arquivo</button>
    </div>
  );
}

function TabBar({ current, analysis }: { current: string; analysis: boolean }) {
  const tabs: [string, string, Parameters<typeof Icon>[0]['name']][] = [
    ['', 'Início', 'home'], ['arquivo', 'Arquivo', 'tray'], ['calendario', 'Calendário', 'calendar'],
    ...(analysis ? [['jornada', 'Jornada', 'chart'] as [string, string, 'chart']] : []), ['ajustes', 'Ajustes', 'gear'],
  ];
  return (
    <nav className="tabbar" aria-label="Seções">
      {tabs.map(([path, label, icon]) => (
        <a key={path} href={`#/${path}`} aria-current={current === path ? 'page' : undefined}><Icon name={icon} /><span>{label}</span></a>
      ))}
    </nav>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { settings, updateSettings } = useStore();
  const [failed, setFailed] = useState(false);
  const tryUnlock = async () => {
    setFailed(false);
    if (settings.credentialId && (await verifyOwner(settings.credentialId))) onUnlock();
    else setFailed(true);
  };
  useEffect(() => { void tryUnlock(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className="lock">
      <Icon name="lock" size={56} />
      <h1>Meu Ponto Digital</h1>
      <p className="muted">Seus comprovantes estão protegidos.</p>
      {failed && <p className="tint-orange">Não foi possível confirmar. Tente novamente.</p>}
      <button className="btn btn-primary" onClick={tryUnlock}>Desbloquear com Face ID / código</button>
      <details className="small muted">
        <summary>Perdeu o acesso à chave?</summary>
        <p>Se a chave de acesso foi apagada (Ajustes do iPhone › Senhas), não é possível desbloquear por aqui. Você pode desativar a proteção — os dados continuam protegidos pela criptografia e pelo código do aparelho.</p>
        <button className="btn btn-secondary" onClick={async () => { await updateSettings({ lockEnabled: false }); onUnlock(); }}>Desativar proteção</button>
      </details>
    </main>
  );
}

function Onboarding() {
  const { settings, updateSettings } = useStore();
  const [supported, setSupported] = useState(false);
  const [lock, setLock] = useState(true);
  useEffect(() => { lockSupported().then(setSupported); }, []);
  if (settings.onboardingDone) return null;
  const finish = async () => {
    let patch = {};
    if (supported && lock) {
      try { patch = { lockEnabled: true, credentialId: await enrollLock() }; } catch { /* segue sem bloqueio */ }
    }
    await updateSettings({ ...patch, onboardingDone: true });
  };
  const points: [string, string][] = [
    ['Tudo fica no seu aparelho', 'Fotos e dados não são enviados para a internet. O texto é reconhecido no próprio aparelho.'],
    ['Você confere, o portal organiza', 'O reconhecimento automático pode errar. Quando houver dúvida na data, no horário ou no tipo, o portal pede sua confirmação.'],
    ['O original é preservado', 'A foto original é guardada sem alterações. Correções ficam registradas no histórico.'],
    ['Faça backups', 'Os dados ficam só neste navegador. Salve cópias em Ajustes › Backup e exportação.'],
  ];
  return (
    <Modal open onClose={finish} title="Bem-vindo ao Meu Ponto Digital" wide>
      <div className="stack">
        <p>Fotografe seus tickets de ponto e encontre qualquer um deles depois, por data, horário ou conteúdo.</p>
        {points.map(([t, d]) => <div key={t}><b>{t}</b><p className="small muted">{d}</p></div>)}
        {supported && (
          <label className="row toggle-row">
            <span className="grow">Proteger com Face ID / código</span>
            <input type="checkbox" role="switch" className="switch" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          </label>
        )}
        <button className="btn btn-primary" onClick={finish}>Começar</button>
        <a className="link small center-text" href="#/ajustes/privacidade" onClick={finish}>Ler a política de privacidade</a>
      </div>
    </Modal>
  );
}
