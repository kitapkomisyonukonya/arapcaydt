import { messageOf, type ApiRequest, type ApiResponse } from '../../server/http.js';
import { logged } from '../../server/errorLog.js';
import { requireMember, serviceDatabase, type Member } from '../../server/auth.js';
import { encodeMp3, pcmFromWav } from '../../server/mp3.js';
import { ownedAssetPath } from '../../server/projectAudio.js';
import { readAsset, removeAssets, signAssets, uploadLink, writeAsset } from '../../server/assets.js';
import { r2Config, r2List, r2Put, r2Size } from '../../server/r2.js';
import {
  R2_LIMIT_BYTES, convertibleAudio, copyBatch, exportEntries, mergeStores, orphans, referencedPaths, summarizeStorage,
  type ExportProjectRow, type ProjectAssetRow, type StoredObject,
} from '../../server/storage.js';

export const config = { maxDuration: 60 };

/** WAV narrations converted per request (download + encode + upload each). */
export const CONVERT_BATCH = 3;

const PROJECT_FIELDS = [
  'id', 'owner_id', 'image:data->imageUrl',
  'nsAudio:data->narrationSource->audioUrl', 'nsPath:data->narrationSource->assetPath',
  'anAudio:data->audioNarration->audioUrl', 'anPath:data->audioNarration->assetPath',
  'slides:data->slides',
].join(',');

async function readObjects(db: any): Promise<StoredObject[] | null> {
  const all: StoredObject[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc('project_asset_objects').range(from, from + 999);
    if (error) return null;
    all.push(...(data || []).map((o: any) => ({ ...o, bytes: Number(o.bytes) || 0 })));
    if ((data || []).length < 1000) break;
  }
  return all;
}

async function readProjects(db: any): Promise<ProjectAssetRow[]> {
  const all: ProjectAssetRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('projects').select(PROJECT_FIELDS).order('id').range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return all;
}

/** Every file with its owner, project and a two-hour download link (admin archive). */
async function exportList(db: any, objects: StoredObject[]) {
  const rows: ExportProjectRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('projects')
      .select(`${PROJECT_FIELDS},title:data->>title,examYear:data->>examYear,questionNumber:data->questionNumber`)
      .order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  const { data: owners, error } = await db.from('profiles').select('id,name,email');
  if (error) throw error;
  const files = exportEntries(objects, rows, owners || []);
  const links = await signAssets(db, files.map(f => f.path), 7200);
  return files.map(f => ({ ...f, url: links.get(f.path) || null }));
}

async function convert(db: any, item: { projectId: string; path: string }): Promise<string | null> {
  const wav = await readAsset(db, item.path);
  if (!wav) return 'WAV okunamadı';
  const pcm = pcmFromWav(wav.bytes);
  if (!pcm?.samples.length) return 'WAV biçimi desteklenmiyor';
  const mp3 = await encodeMp3(pcm);
  const mp3Path = item.path.replace(/\.wav$/i, '') + '.mp3';
  try { await writeAsset(db, mp3Path, mp3, 'audio/mpeg'); } catch (e) { return `MP3 kaydedilemedi: ${messageOf(e) || e}`; }
  const { data: replaced, error: rpcError } = await db.rpc('replace_project_audio',
    { target_project: item.projectId, old_path: item.path, new_path: mp3Path, new_mime: 'audio/mpeg' });
  if (rpcError) return `Proje güncellenemedi: ${rpcError.message}`;
  // false: the project no longer points at this WAV (edited meanwhile); the MP3 is swept later.
  return replaced ? null : 'Proje bu arada değişmiş';
}

/** Copies one Supabase file to R2 and checks the copy's size. */
async function copyToR2(db: any, o: StoredObject): Promise<string | null> {
  const c = r2Config()!;
  const { data, error } = await db.storage.from('project-assets').download(o.name);
  if (error || !data) return 'Supabase dosyası okunamadı';
  await r2Put(c, o.name, Buffer.from(await data.arrayBuffer()), o.mimetype || data.type || 'application/octet-stream');
  const size = await r2Size(c, o.name);
  return size === o.bytes ? null : `R2 kopyası farklı boyutta (${size} / ${o.bytes})`;
}

/**
 * Any approved member: POST {action:'sign', paths} gives playback links for
 * their own files (admins: any file); POST {action:'upload', path, contentType,
 * size} gives an R2 upload link for a new file in their folder, or {store:'supabase'}
 * while R2 is not configured.
 */
async function memberAction(req: ApiRequest, res: ApiResponse, member: Member) {
  const body = req.body ?? {};
  const isAdmin = member.profile?.role === 'admin';
  const allowed = (p: unknown): p is string => typeof p === 'string' && (isAdmin ? !!ownedAssetPath(p.split('/')[0], p) : !!ownedAssetPath(member.user.id, p));
  if (body.action === 'sign') {
    const paths = Array.isArray(body.paths) ? [...new Set(body.paths.filter(allowed))].slice(0, 2000) as string[] : [];
    const links = await signAssets(serviceDatabase(), paths, 21600);
    return res.status(200).json({ links: Object.fromEntries(links) });
  }
  const { contentType, size } = body;
  const path = ownedAssetPath(member.user.id, body.path);
  if (!path || !safeMediaType(contentType) || typeof size !== 'number'
    || !Number.isInteger(size) || size <= 0 || size > 25 * 1024 * 1024) return res.status(400).json({ error: 'Dosya bilgisi geçersiz.' });
  const url = uploadLink(path, contentType, size);
  return res.status(200).json(url ? { store: 'r2', url } : { store: 'supabase' });
}

/**
 * A picture or sound type the studio may store. Script-carrying types (SVG, XML, HTML) are refused
 * however they are spelled ("image/SVG+XML; charset=utf-8").
 */
export function safeMediaType(type: unknown): type is string {
  if (typeof type !== 'string' || !/^(image|audio)\/[\w.+-]+(\s*;\s*[\w-]+=[\w.+-]+)*$/i.test(type)) return false;
  return !/svg|xml|html/i.test(type.split(';')[0]);
}

/**
 * Admin storage housekeeping: GET usage; GET ?export=1 lists every file with
 * its owner and a download link; POST {action:'convert'} turns up to
 * CONVERT_BATCH WAV narrations into MP3 (timings unchanged); POST
 * {action:'sweep', scope:'wav'|'all'} deletes files no project uses; with R2
 * configured, POST {action:'copy'} copies a batch of Supabase files to R2 and
 * {action:'purge'} removes from Supabase the files whose R2 copy is verified.
 */
async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const member = await requireMember(req, res);
  if (!member) return;
  if (req.method === 'POST' && (req.body?.action === 'sign' || req.body?.action === 'upload')) {
    try { return await memberAction(req, res, member); }
    catch (error) {
      console.error('[Assets]', messageOf(error) || error);
      return res.status(500).json({ error: 'Dosya bağlantısı hazırlanamadı.' });
    }
  }
  if (member.profile?.role !== 'admin') return res.status(403).json({ error: 'Yönetici yetkisi gerekli.' });

  try {
    const db = serviceDatabase();
    const c = r2Config();
    let r2Error = '';
    const [stored, rows, inR2] = await Promise.all([readObjects(db), readProjects(db), c ? r2List(c).catch((e: unknown) => { r2Error = messageOf(e) || 'R2 okunamadı'; return []; }) : Promise.resolve([])]);
    if (!stored) return res.status(200).json({ migrationPending: true });
    const stores = mergeStores(stored, inR2);
    const objects = stores.all;

    if (req.method === 'GET' && req.query?.export) {
      return res.status(200).json({ files: await exportList(db, objects) });
    }

    if (r2Error && req.method === 'POST' && req.body?.action) {
      return res.status(502).json({ error: `R2'ye ulaşılamadı: ${r2Error}` });
    }

    if (req.method === 'POST' && req.body?.action === 'convert') {
      const pending = convertibleAudio(rows, objects);
      const skip = new Set<string>(Array.isArray(req.body?.skip) ? req.body.skip.filter((s: unknown) => typeof s === 'string') : []);
      const open = pending.filter(p => !skip.has(p.path));
      const batch = open.slice(0, CONVERT_BATCH);
      const failures: Array<{ path: string; reason: string }> = [];
      let converted = 0;
      for (const item of batch) {
        const reason = await convert(db, item).catch((e: unknown) => messageOf(e) || 'Bilinmeyen hata');
        if (reason) failures.push({ path: item.path, reason }); else converted++;
      }
      return res.status(200).json({ converted, failures, remaining: open.length - batch.length });
    }

    if (req.method === 'POST' && req.body?.action === 'sweep') {
      const unused = orphans(objects, referencedPaths(rows));
      const targets = req.body?.scope === 'all' ? unused : unused.filter(o => /\.wav$/i.test(o.name));
      await removeAssets(db, targets.map(o => o.name));
      return res.status(200).json({ removed: targets.length, bytes: targets.reduce((s, o) => s + o.bytes, 0) });
    }

    if (req.method === 'POST' && req.body?.action === 'copy') {
      if (!c) return res.status(400).json({ error: 'R2 bağlı değil.' });
      const skip = new Set<string>(Array.isArray(req.body?.skip) ? req.body.skip.filter((s: unknown) => typeof s === 'string') : []);
      const batch = copyBatch(stores.toCopy, skip);
      const failures: Array<{ path: string; reason: string }> = [];
      let copied = 0;
      for (const o of batch) {
        const reason = await copyToR2(db, o).catch((e: unknown) => messageOf(e) || 'Bilinmeyen hata');
        if (reason) failures.push({ path: o.name, reason }); else copied++;
      }
      return res.status(200).json({ copied, failures, remaining: stores.toCopy.filter(o => !skip.has(o.name)).length - batch.length });
    }

    // Removes from Supabase only the files whose R2 copy was checked to be the same size.
    if (req.method === 'POST' && req.body?.action === 'purge') {
      if (!c) return res.status(400).json({ error: 'R2 bağlı değil.' });
      const names = stores.copied.map(o => o.name);
      let removed = 0;
      for (let i = 0; i < names.length; i += 100) {
        const { data, error } = await db.storage.from('project-assets').remove(names.slice(i, i + 100));
        if (error) throw error;
        removed += (data || []).length;
      }
      return res.status(200).json({ removed, bytes: stores.copiedSum.bytes });
    }

    return res.status(200).json({
      migrationPending: false, ...summarizeStorage(objects, rows),
      supabase: stores.supabase,
      r2: c ? { ...stores.r2, limitBytes: R2_LIMIT_BYTES, toCopy: stores.toCopySum, copied: stores.copiedSum } : null,
      r2Error: r2Error || undefined,
    });
  } catch (error) {
    console.error('[Admin storage]', messageOf(error) || error);
    return res.status(500).json({ error: 'Depolama bilgisi hazırlanamadı.' });
  }
}

export default logged('/api/admin/storage', handler);
