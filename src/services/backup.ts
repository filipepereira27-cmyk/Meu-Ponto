import { createBackupZip, readBackupZip, type BackupSettings } from '../core/backup';
import type { TicketRecord } from '../core/types';
import { allTickets, deleteImages, getImage, hasImage, imageKey, putImage, putTickets, type ImageKind } from './db';
import { thumbnail } from './image';

export const APP_VERSION = '1.0.0';

const extOf = (mime: string) => (mime.includes('png') ? 'png' : mime.includes('heic') ? 'heic' : mime.includes('webp') ? 'webp' : 'jpg');
const pathOf = (r: TicketRecord, kind: 'original' | 'tratada') =>
  `imagens/${r.id}-${kind}.${kind === 'original' ? extOf(r.originalMimeType) : 'jpg'}`;

/** Backup completo (.zip): tickets, histórico, ajustes e imagens originais. */
export async function createBackup(settings: BackupSettings): Promise<File> {
  const tickets = await allTickets();
  const paths = new Map<string, [string, ImageKind]>();
  for (const r of tickets) {
    paths.set(pathOf(r, 'original'), [r.id, 'original']);
    if (r.hasProcessedImage) paths.set(pathOf(r, 'tratada'), [r.id, 'tratada']);
  }
  const blob = await createBackupZip(
    { createdAt: new Date().toISOString(), appVersion: APP_VERSION, tickets, settings },
    [...paths.keys()],
    async (path) => {
      const [id, kind] = paths.get(path)!;
      const img = await getImage(id, kind);
      return img ? new Uint8Array(await img.arrayBuffer()) : undefined;
    },
  );
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
  return new File([blob], `MeuPontoDigital-backup-${stamp}.zip`, { type: 'application/zip' });
}

export interface RestoreSummary {
  inserted: number;
  skipped: number;
  settings: BackupSettings;
}

/**
 * Restaura sem apagar nada: só entram tickets que ainda não existem (mesmo ID).
 * Imagens são verificadas (CRC) ao serem lidas; se algo falhar, tudo o que foi
 * gravado nesta restauração é desfeito.
 */
export async function restoreBackup(file: Blob): Promise<RestoreSummary> {
  const existing = new Set((await allTickets()).map((t) => t.id));
  const written: string[] = [];
  const mimeByPath = new Map<string, string>();
  try {
    const manifest = await readBackupZip(file, async (path, data) => {
      const m = path.match(/^imagens\/(.+)-(original|tratada)\.(\w+)$/);
      if (!m) return;
      const [, id, kind, ext] = m;
      if (existing.has(id) || (await hasImage(id, kind as ImageKind))) return;
      const type = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      mimeByPath.set(path, type);
      await putImage(id, kind as ImageKind, new Blob([data as BlobPart], { type }));
      written.push(imageKey(id, kind as ImageKind));
    });
    const fresh = manifest.tickets.filter((t) => !existing.has(t.id));
    for (const t of fresh) {
      const source = (await getImage(t.id, 'tratada')) ?? (await getImage(t.id, 'original'));
      if (source) {
        try {
          await putImage(t.id, 'miniatura', await thumbnail(source));
          written.push(imageKey(t.id, 'miniatura'));
        } catch { /* miniatura é opcional (ex.: HEIC em navegador sem suporte) */ }
      }
    }
    await putTickets(fresh);
    return { inserted: fresh.length, skipped: manifest.tickets.length - fresh.length, settings: manifest.settings };
  } catch (error) {
    await deleteImages(written);
    throw error;
  }
}
