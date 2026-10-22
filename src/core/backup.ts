import { Unzip, UnzipInflate, Zip, ZipPassThrough, strToU8, strFromU8 } from 'fflate';
import { ticketsCSV, type WorkSchedule } from './workday';
import type { TicketRecord } from './types';

/**
 * Backup = arquivo .zip comum, que abre em qualquer computador:
 *
 *   manifest.json   todos os tickets (JSON), ajustes e CRC32 de cada imagem
 *   tickets.csv     planilha legível
 *   imagens/…       fotos originais (bytes intactos) e cópias tratadas
 *   LEIA-ME.txt
 *
 * É gravado e lido em fluxo (uma imagem por vez), sem carregar o acervo na memória.
 */

export const BACKUP_FORMAT = 'meu-ponto-digital-backup';
export const BACKUP_VERSION = 1;

export interface BackupSettings {
  schedule?: WorkSchedule;
  analysisEnabled?: boolean;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  tickets: TicketRecord[];
  settings: BackupSettings;
  /** caminho no zip → CRC32 */
  checksums: Record<string, number>;
}

export class BackupError extends Error {}

// CRC-32 (IEEE)
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface BackupImage {
  /** caminho dentro do zip, ex.: `imagens/<id>-original.jpg` */
  path: string;
  data: Uint8Array;
}

/**
 * Gera o zip. As imagens são lidas uma a uma do banco: primeiro para calcular os CRCs
 * (que vão no manifesto, gravado no início do arquivo), depois para gravar o conteúdo.
 * Assim a restauração consegue validar cada imagem assim que a lê.
 */
export async function createBackupZip(
  base: Omit<BackupManifest, 'format' | 'formatVersion' | 'checksums'>,
  imagePaths: string[],
  readImage: (path: string) => Promise<Uint8Array | undefined>,
): Promise<Blob> {
  const checksums: Record<string, number> = {};
  for (const path of imagePaths) {
    const data = await readImage(path);
    if (data) checksums[path] = crc32(data);
  }
  const manifest: BackupManifest = { format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, checksums, ...base };

  const chunks: Uint8Array[] = [];
  let failure: Error | undefined;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else chunks.push(chunk);
  });
  const addFile = (path: string, data: Uint8Array) => {
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    entry.push(data, true);
  };
  addFile('manifest.json', strToU8(JSON.stringify(manifest, null, 2)));
  addFile('tickets.csv', strToU8(ticketsCSV(manifest.tickets)));
  addFile('LEIA-ME.txt', strToU8(README(manifest)));
  for (const path of Object.keys(checksums)) {
    const data = await readImage(path);
    if (data) addFile(path, data);
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

const README = (m: BackupManifest) => `Backup do Meu Ponto Digital
Criado em: ${new Date(m.createdAt).toLocaleString('pt-BR')}
Tickets: ${m.tickets.length}

manifest.json  Todos os dados (texto do OCR, histórico de alterações, ajustes).
tickets.csv    Planilha com um ticket por linha (Excel, Numbers, Planilhas Google).
imagens/       Fotografias originais (…-original) e cópias tratadas usadas no OCR.

Para restaurar: Meu Ponto Digital › Ajustes › Backup › Restaurar e escolha este arquivo .zip.
Os dados extraídos por OCR podem conter erros. O comprovante original é a referência.
`;

/**
 * Lê um backup em fluxo. Valida formato, versão e o CRC de cada imagem.
 * `onImage` é chamado para cada imagem já verificada; se algo falhar depois,
 * quem chama deve desfazer o que gravou (ver services/backup).
 */
export async function readBackupZip(
  file: Blob,
  onImage: (path: string, data: Uint8Array) => Promise<void>,
): Promise<BackupManifest> {
  let manifest: BackupManifest | undefined;
  const seen = new Set<string>();
  const ready: { path: string; data: Uint8Array }[] = [];
  let error: Error | undefined;

  const unzip = new Unzip((entry) => {
    const parts: Uint8Array[] = [];
    entry.ondata = (err, data, final) => {
      if (err) { error = new BackupError('O arquivo está danificado. Nenhum dado foi alterado.'); return; }
      parts.push(data);
      if (final) {
        const size = parts.reduce((s, p) => s + p.length, 0);
        const all = new Uint8Array(size);
        let o = 0;
        for (const p of parts) { all.set(p, o); o += p.length; }
        ready.push({ path: entry.name, data: all });
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  const drain = async () => {
    while (ready.length) {
      const { path, data } = ready.shift()!;
      if (path === 'manifest.json') {
        try { manifest = JSON.parse(strFromU8(data)); } catch { throw new BackupError('O backup está danificado (manifesto ilegível). Nenhum dado foi alterado.'); }
        if (manifest?.format !== BACKUP_FORMAT) throw new BackupError('Este arquivo não é um backup do Meu Ponto Digital.');
        if (manifest.formatVersion > BACKUP_VERSION) throw new BackupError('Backup criado por uma versão mais nova do app. Atualize a página e tente de novo.');
      } else if (path.startsWith('imagens/')) {
        if (!manifest) throw new BackupError('Este arquivo não é um backup do Meu Ponto Digital.');
        const expected = manifest.checksums[path];
        if (expected === undefined) continue;
        if (crc32(data) !== expected) throw new BackupError(`O backup está danificado (${path}). Nenhum dado foi alterado.`);
        seen.add(path);
        await onImage(path, data);
      }
    }
  };

  const reader = (file.stream() as ReadableStream<Uint8Array>).getReader();
  let sawAnything = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (value?.length) sawAnything = true;
    try {
      unzip.push(value ?? new Uint8Array(0), done);
    } catch {
      throw new BackupError('Este arquivo não é um backup do Meu Ponto Digital (ou está danificado).');
    }
    if (error) throw error;
    await drain();
    if (done) break;
  }
  if (!sawAnything || !manifest) throw new BackupError('Este arquivo não é um backup do Meu Ponto Digital (ou está incompleto).');
  if (Object.keys(manifest.checksums).some((p) => !seen.has(p))) {
    throw new BackupError('O backup está incompleto (faltam imagens). Nenhum dado foi alterado.');
  }
  return manifest;
}
