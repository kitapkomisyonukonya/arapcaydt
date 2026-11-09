import { ZipWriter } from './archiveZip';

/** One stored file as the server lists it for the archive (see server/storage.ts exportEntries). */
export interface ArchiveFile {
  path: string; bytes: number; mimetype: string | null; createdAt: string;
  ownerName: string; ownerEmail: string;
  projectId: string | null; projectTitle: string; use: 'image' | 'audio' | 'unused';
  /** A Konu Anlatımı's slide number. */
  slide?: number;
  url: string | null;
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
};
const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || '-';

/** Archive path for every file: teacher / question / görsel or ses; files no project uses go to "kullanılmayan". */
export function archiveNames(files: ArchiveFile[]): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const f of files) {
    const base = f.path.split('/').pop() || 'dosya';
    const ext = EXT[f.mimetype || ''] || base.match(/\.(\w{2,4})$/)?.[1] || 'bin';
    const folder = f.use === 'unused' ? 'kullanılmayan'
      : clean(f.projectTitle ? `${f.projectTitle} (${(f.projectId || '').slice(0, 8)})` : f.projectId || 'proje');
    const kind = f.use === 'image' ? 'görsel' : 'ses';
    const stem = f.use === 'unused' ? clean(base.replace(/\.\w{2,4}$/, '').slice(0, 16))
      : f.slide ? `slayt ${String(f.slide).padStart(2, '0')} ${kind}` : kind;
    let name = `${clean(f.ownerName)}/${folder}/${stem}.${ext}`;
    for (let i = 2; taken.has(name); i++) name = `${clean(f.ownerName)}/${folder}/${stem}-${i}.${ext}`;
    taken.add(name);
    names.set(f.path, name);
  }
  return names;
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Excel-friendly list (Turkish locale: semicolons, UTF-8 BOM). */
export function archiveList(files: ArchiveFile[], names: Map<string, string>): string {
  const head = ['Hoca', 'E-posta', 'Soru', 'Tür', 'Arşivdeki dosya', 'Boyut (KB)', 'Yüklenme', 'Depodaki yol'];
  const kind = { image: 'Görsel', audio: 'Ses', unused: 'Kullanılmayan' } as const;
  const rows = files.map(f => [f.ownerName, f.ownerEmail, f.projectTitle, kind[f.use], names.get(f.path) || '',
    Math.round(f.bytes / 1024), f.createdAt.slice(0, 10), f.path]);
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Downloads every file (four at a time) and packs them with liste.csv into one ZIP. */
export async function buildArchive(files: ArchiveFile[], onProgress: (done: number, total: number) => void): Promise<{ zip: Blob; failed: string[] }> {
  const names = archiveNames(files);
  const zip = new ZipWriter();
  const failed: string[] = [];
  let next = 0, done = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      try {
        if (!f.url) throw new Error('bağlantı yok');
        const res = await fetch(f.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        zip.add(names.get(f.path)!, new Uint8Array(await res.arrayBuffer()), new Date(f.createdAt));
      } catch (e) {
        failed.push(`${names.get(f.path)} (${f.path}): ${e instanceof Error ? e.message : 'indirilemedi'}`);
      }
      onProgress(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  zip.add('liste.csv', new TextEncoder().encode(archiveList(files, names)));
  if (failed.length) zip.add('indirilemeyenler.txt', new TextEncoder().encode(failed.join('\r\n') + '\r\n'));
  return { zip: zip.finish(), failed };
}
