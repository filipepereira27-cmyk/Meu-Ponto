import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyEdit, searchableText } from '../core/archive';
import type { TicketRecord } from '../core/types';
import { STANDARD_SCHEDULE, type WorkSchedule } from '../core/workday';
import * as store from '../services/db';

export interface AppSettings {
  schedule: WorkSchedule;
  analysisEnabled: boolean;
  lockEnabled: boolean;
  credentialId?: string;
  lastBackupAt?: string;
  backupReminderDays: number;
  onboardingDone: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  schedule: STANDARD_SCHEDULE,
  analysisEnabled: true,
  lockEnabled: false,
  backupReminderDays: 7,
  onboardingDone: false,
};

export type CaptureMode = 'camera' | 'files';

interface Store {
  ready: boolean;
  tickets: TicketRecord[];
  byId: Map<string, TicketRecord>;
  settings: AppSettings;
  /** Texto pesquisável em cache (recalculado só quando o ticket muda). */
  searchText: (r: TicketRecord) => string;
  reload: () => Promise<void>;
  addTicket: (r: TicketRecord, images: Partial<Record<store.ImageKind, Blob>>) => Promise<void>;
  /** Grava a edição registrando o histórico. */
  editTicket: (edited: TicketRecord) => Promise<TicketRecord>;
  removeTicket: (id: string) => Promise<void>;
  removeAll: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  /** Abre a câmera ou o seletor de arquivos. Chame diretamente no toque do botão. */
  startCapture: (mode: CaptureMode) => void;
  /** O App registra aqui como abrir os seletores (inputs de arquivo). */
  registerCapture: (open: (mode: CaptureMode) => void) => void;
  backupOverdue: boolean;
}

const Ctx = createContext<Store | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const captureHandler = useRef<(mode: CaptureMode) => void>(undefined);
  const cache = useRef(new Map<string, { updatedAt: string; text: string }>());

  const reload = useCallback(async () => {
    setTickets(await store.allTickets());
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await store.getSetting<Partial<AppSettings>>('app', {});
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
      await reload();
      setReady(true);
    })();
  }, [reload]);

  const searchText = useCallback((r: TicketRecord) => {
    const hit = cache.current.get(r.id);
    if (hit && hit.updatedAt === r.updatedAt) return hit.text;
    const text = searchableText(r);
    cache.current.set(r.id, { updatedAt: r.updatedAt, text });
    return text;
  }, []);

  const addTicket = useCallback(async (r: TicketRecord, images: Partial<Record<store.ImageKind, Blob>>) => {
    await store.saveTicket(r, images);
    setTickets((list) => [...list, r]);
    void store.requestPersistence();
  }, []);

  const editTicket = useCallback(async (edited: TicketRecord) => {
    const current = (await store.getTicket(edited.id))!;
    const next = applyEdit(current, edited);
    if (next !== current) {
      await store.putTickets([next]);
      setTickets((list) => list.map((t) => (t.id === next.id ? next : t)));
    }
    return next;
  }, []);

  const removeTicket = useCallback(async (id: string) => {
    await store.deleteTicket(id);
    setTickets((list) => list.filter((t) => t.id !== id));
  }, []);

  const removeAll = useCallback(async () => {
    await store.clearAll();
    setTickets([]);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      void store.setSetting('app', next);
      return next;
    });
  }, []);

  // O Safari do iPhone só abre câmera/arquivos se o clique no input acontecer no mesmo
  // toque do usuário: por isso a chamada é síncrona (sem passar por estado/efeito).
  const startCapture = useCallback((mode: CaptureMode) => captureHandler.current?.(mode), []);
  const registerCapture = useCallback((open: (mode: CaptureMode) => void) => { captureHandler.current = open; }, []);

  const value = useMemo<Store>(() => {
    const last = settings.lastBackupAt ? new Date(settings.lastBackupAt).getTime() : 0;
    return {
      ready, tickets, settings, searchText, reload, addTicket, editTicket, removeTicket, removeAll, updateSettings,
      startCapture, registerCapture,
      byId: new Map(tickets.map((t) => [t.id, t])),
      backupOverdue: tickets.length > 0 && Date.now() - last > settings.backupReminderDays * 86_400_000,
    };
  }, [ready, tickets, settings, searchText, reload, addTicket, editTicket, removeTicket, removeAll, updateSettings, startCapture, registerCapture]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider ausente');
  return s;
}
