import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TicketRecord } from '../core/types';

/**
 * Banco local (IndexedDB) do navegador. Nada é enviado para servidores.
 *
 * Versões do esquema: cada mudança futura incrementa DB_VERSION e acrescenta um
 * passo em `upgrade` — os passos antigos nunca são alterados, para que atualizações
 * do portal não percam registros.
 */

export type ImageKind = 'original' | 'tratada' | 'miniatura';
export const imageKey = (id: string, kind: ImageKind) => `${id}:${kind}`;

interface Schema extends DBSchema {
  tickets: { key: string; value: TicketRecord; indexes: { recordDate: string } };
  images: { key: string; value: { key: string; ticketId: string; kind: ImageKind; blob: Blob } ; indexes: { ticketId: string } };
  settings: { key: string; value: { key: string; value: unknown } };
}

const DB_NAME = 'meu-ponto-digital';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const tickets = database.createObjectStore('tickets', { keyPath: 'id' });
        tickets.createIndex('recordDate', 'recordDate');
        const images = database.createObjectStore('images', { keyPath: 'key' });
        images.createIndex('ticketId', 'ticketId');
        database.createObjectStore('settings', { keyPath: 'key' });
      }
      // if (oldVersion < 2) { … próxima migração … }
    },
    blocked() {
      alert('Feche as outras abas do Meu Ponto Digital para concluir a atualização.');
    },
  });
  return dbPromise;
}

export async function allTickets(): Promise<TicketRecord[]> {
  return (await db()).getAll('tickets');
}

export async function getTicket(id: string): Promise<TicketRecord | undefined> {
  return (await db()).get('tickets', id);
}

/** Grava o ticket e suas imagens numa única transação (tudo ou nada). */
export async function saveTicket(record: TicketRecord, images: Partial<Record<ImageKind, Blob>> = {}): Promise<void> {
  const d = await db();
  const tx = d.transaction(['tickets', 'images'], 'readwrite');
  await Promise.all([
    tx.objectStore('tickets').put(record),
    ...Object.entries(images).map(([kind, blob]) =>
      tx.objectStore('images').put({ key: imageKey(record.id, kind as ImageKind), ticketId: record.id, kind: kind as ImageKind, blob: blob! })),
    tx.done,
  ]);
}

export async function putTickets(records: TicketRecord[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('tickets', 'readwrite');
  await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
}

export async function putImage(id: string, kind: ImageKind, blob: Blob): Promise<void> {
  await (await db()).put('images', { key: imageKey(id, kind), ticketId: id, kind, blob });
}

export async function getImage(id: string, kind: ImageKind): Promise<Blob | undefined> {
  return (await (await db()).get('images', imageKey(id, kind)))?.blob;
}

export async function hasImage(id: string, kind: ImageKind): Promise<boolean> {
  return (await (await db()).getKey('images', imageKey(id, kind))) !== undefined;
}

/** Exclui o ticket e todas as suas imagens. */
export async function deleteTicket(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['tickets', 'images'], 'readwrite');
  const keys = await tx.objectStore('images').index('ticketId').getAllKeys(id);
  await Promise.all([tx.objectStore('tickets').delete(id), ...keys.map((k) => tx.objectStore('images').delete(k)), tx.done]);
}

export async function deleteImages(keys: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('images', 'readwrite');
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}

export async function clearAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['tickets', 'images'], 'readwrite');
  await Promise.all([tx.objectStore('tickets').clear(), tx.objectStore('images').clear(), tx.done]);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await (await db()).get('settings', key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', { key, value });
}

/** Pede ao navegador para não apagar os dados automaticamente (armazenamento persistente). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage?: number; quota?: number; persisted: boolean }> {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usage: e?.usage, quota: e?.quota, persisted: (await navigator.storage?.persisted?.()) ?? false };
  } catch {
    return { persisted: false };
  }
}
