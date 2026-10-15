import { signedLinkPath } from './projectAudio.js';

/** Supabase free plan storage. */
export const STORAGE_LIMIT_BYTES = 1024 ** 3;
/** An unreferenced file is kept this long: a narration may be generated before its project is saved. */
export const ORPHAN_MIN_AGE_MS = 7 * 86400_000;

export interface StoredObject { name: string; bytes: number; mimetype: string | null; created_at: string }
/** The project fields that can point at a stored file (see cloudProjectRepository.save). */
export interface ProjectAssetRow { id: string; owner_id: string; image?: unknown; nsAudio?: unknown; nsPath?: unknown; anAudio?: unknown; anPath?: unknown; slides?: unknown }

/** A Konu Anlatımı's slide pictures and voices (see src/features/lessons/lessonPlan.ts). */
function slideFiles(slides: unknown): Array<{ path: unknown; use: 'image' | 'audio' }> {
  if (!Array.isArray(slides)) return [];
  return slides.flatMap((slide: any) => [
    { path: slide?.imagePath, use: 'image' as const },
    { path: slide?.audio?.path, use: 'audio' as const },
  ]);
}

function pathOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof (value as any).assetPath === 'string') return (value as any).assetPath;
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? signedLinkPath(value) : value.includes('/') && !value.startsWith('data:') && !value.startsWith('blob:') ? value : null;
  return null;
}

export function referencedPaths(rows: ProjectAssetRow[]): Set<string> {
  const paths = new Set<string>();
  for (const row of rows) for (const value of [row.image, row.nsAudio, row.nsPath, row.anAudio, row.anPath, ...slideFiles(row.slides).map(f => f.path)]) {
    const path = pathOf(value);
    if (path) paths.add(path);
  }
  return paths;
}

type Kind = 'wav' | 'mp3' | 'image' | 'other';
const kindOf = (o: StoredObject): Kind =>
  /^audio\/(x-)?wav/.test(o.mimetype || '') || /\.wav$/i.test(o.name) ? 'wav'
    : o.mimetype === 'audio/mpeg' || /\.mp3$/i.test(o.name) ? 'mp3'
      : (o.mimetype || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(o.name) ? 'image' : 'other';

/**
 * Files no project points to. They are deleted only when older than a week,
 * or when they are a WAV already converted to an MP3 next to it.
 */
export function orphans(objects: StoredObject[], referenced: Set<string>, nowMs = Date.now()): StoredObject[] {
  const names = new Set(objects.map(o => o.name));
  return objects.filter(o => {
    if (referenced.has(o.name)) return false;
    const converted = kindOf(o) === 'wav' && names.has(o.name.replace(/\.wav$/i, '.mp3'));
    return converted || nowMs - new Date(o.created_at).getTime() > ORPHAN_MIN_AGE_MS;
  });
}

/** Narrations still stored as WAV that a project uses: [project id, WAV path]. */
export function convertibleAudio(rows: ProjectAssetRow[], objects: StoredObject[]): Array<{ projectId: string; path: string }> {
  const wavs = new Set(objects.filter(o => kindOf(o) === 'wav').map(o => o.name));
  const out = new Map<string, { projectId: string; path: string }>();
  for (const row of rows) for (const value of [row.nsAudio, row.anAudio]) {
    const path = pathOf(value);
    if (path && wavs.has(path) && path.startsWith(`${row.owner_id}/`)) out.set(`${row.id}|${path}`, { projectId: row.id, path });
  }
  return [...out.values()];
}

export function summarizeStorage(objects: StoredObject[], rows: ProjectAssetRow[], nowMs = Date.now()) {
  const byKind: Record<Kind, { count: number; bytes: number }> = { wav: { count: 0, bytes: 0 }, mp3: { count: 0, bytes: 0 }, image: { count: 0, bytes: 0 }, other: { count: 0, bytes: 0 } };
  let totalBytes = 0;
  for (const o of objects) { const k = byKind[kindOf(o)]; k.count++; k.bytes += o.bytes; totalBytes += o.bytes; }
  const unused = orphans(objects, referencedPaths(rows), nowMs);
  return {
    totalBytes, limitBytes: STORAGE_LIMIT_BYTES, byKind,
    orphans: { count: unused.length, bytes: unused.reduce((s, o) => s + o.bytes, 0) },
    convertible: convertibleAudio(rows, objects).length,
  };
}

export interface ExportOwner { id: string; name?: string | null; email?: string | null }
export interface ExportProjectRow extends ProjectAssetRow { title?: unknown; questionNumber?: unknown; examYear?: unknown }
export interface ExportEntry {
  path: string; bytes: number; mimetype: string | null; createdAt: string;
  ownerName: string; ownerEmail: string;
  projectId: string | null; projectTitle: string; use: 'image' | 'audio' | 'unused';
}

/**
 * Every stored file with who made it and which project uses it, for the admin's
 * archive download. The owner is the first folder of the path.
 */
export function exportEntries(objects: StoredObject[], rows: ExportProjectRow[], owners: ExportOwner[]): ExportEntry[] {
  const users = new Map(owners.map(o => [o.id, o]));
  const uses = new Map<string, { row: ExportProjectRow; use: 'image' | 'audio' }>();
  for (const row of rows) {
    const add = (value: unknown, use: 'image' | 'audio') => {
      const path = pathOf(value);
      if (path && !uses.has(path)) uses.set(path, { row, use });
    };
    add(row.image, 'image');
    for (const value of [row.nsAudio, row.nsPath, row.anAudio, row.anPath]) add(value, 'audio');
    for (const file of slideFiles(row.slides)) add(file.path, file.use);
  }
  return objects.map(o => {
    const owner = users.get(o.name.split('/')[0]);
    const hit = uses.get(o.name);
    const title = hit ? [hit.row.examYear, hit.row.questionNumber ? `Soru ${hit.row.questionNumber}` : '', hit.row.title]
      .filter(v => typeof v === 'string' || typeof v === 'number').map(String).map(s => s.trim()).filter(Boolean).join(' ') : '';
    return {
      path: o.name, bytes: o.bytes, mimetype: o.mimetype, createdAt: o.created_at,
      ownerName: owner?.name?.trim() || owner?.email?.split('@')[0] || 'Bilinmeyen', ownerEmail: owner?.email || '',
      projectId: hit?.row.id ?? null, projectTitle: title, use: hit?.use ?? 'unused',
    };
  });
}

/** R2 limit on Cloudflare's free plan. */
export const R2_LIMIT_BYTES = 10 * 1024 ** 3;
export interface R2Object { name: string; bytes: number; created_at: string }

/**
 * Supabase and R2 listings as one: a file in both places (copied) counts once,
 * keeping Supabase's content type. `copied` are Supabase files whose R2 copy
 * has the same size (safe to remove from Supabase); `toCopy` are the rest.
 */
export function mergeStores(supabase: StoredObject[], r2: R2Object[]) {
  const inR2 = new Map(r2.map(o => [o.name, o]));
  const names = new Set(supabase.map(o => o.name));
  const copied: StoredObject[] = [], toCopy: StoredObject[] = [];
  for (const o of supabase) (inR2.get(o.name)?.bytes === o.bytes ? copied : toCopy).push(o);
  const all: StoredObject[] = [...supabase, ...r2.filter(o => !names.has(o.name)).map(o => ({ ...o, mimetype: null }))];
  const sum = (list: Array<{ bytes: number }>) => ({ count: list.length, bytes: list.reduce((n, o) => n + o.bytes, 0) });
  return { all, copied, toCopy, supabase: sum(supabase), r2: sum(r2), copiedSum: sum(copied), toCopySum: sum(toCopy) };
}

/** Next files to copy in one request: at most `count` files and about `bytes` bytes (always at least one). */
export function copyBatch(toCopy: StoredObject[], skip: Set<string>, count = 12, bytes = 30 * 1024 * 1024): StoredObject[] {
  const batch: StoredObject[] = [];
  let size = 0;
  for (const o of toCopy) {
    if (skip.has(o.name)) continue;
    if (batch.length && (batch.length >= count || size + o.bytes > bytes)) break;
    batch.push(o); size += o.bytes;
  }
  return batch;
}
