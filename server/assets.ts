import { browserLink, r2Config, r2Delete, r2Get, r2Link, r2Put } from './r2.js';

/**
 * Project files (question images, narrations) live under "<owner>/<project>/…".
 * New files go to Cloudflare R2 when it is configured; files still in Supabase
 * Storage keep working from there until they are copied and removed.
 */
const BUCKET = 'project-assets';

export async function readAsset(db: any, path: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const c = r2Config();
  if (c) {
    const found = await r2Get(c, path).catch(() => null);
    if (found) return found;
  }
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || 'application/octet-stream' };
}

export async function writeAsset(db: any, path: string, bytes: Buffer, contentType: string): Promise<void> {
  const c = r2Config();
  if (c) return r2Put(c, path, bytes, contentType);
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(error.message);
}

/** Playback links: from Supabase where the file still is, otherwise from R2. */
export async function signAssets(db: any, paths: string[], seconds = 21600): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const bucket = db.storage.from(BUCKET);
  for (let i = 0; i < paths.length; i += 200) {
    const { data, error } = await bucket.createSignedUrls(paths.slice(i, i + 200), seconds);
    for (const item of error ? [] : data || []) if (item.path && item.signedUrl && !item.error) links.set(item.path, item.signedUrl);
  }
  const c = r2Config();
  if (c) for (const path of paths) if (!links.has(path)) links.set(path, browserLink(r2Link(c, 'GET', path, seconds)));
  return links;
}

export async function removeAssets(db: any, paths: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await db.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw error;
    removed += (data || []).length;
  }
  const c = r2Config();
  if (c) for (let i = 0; i < paths.length; i += 10) await Promise.all(paths.slice(i, i + 10).map(p => r2Delete(c, p)));
  return removed;
}

/**
 * Where the browser should send a new file: a one-time R2 upload link through the site's address
 * (`url`) and the same link straight to R2 (`direct`, tried if the first does not go through), or
 * null to keep using Supabase.
 */
export function uploadLink(path: string, contentType: string, size: number): { url: string; direct: string } | null {
  const c = r2Config();
  if (!c) return null;
  const direct = r2Link(c, 'PUT', path, 900, { 'content-type': contentType, 'content-length': String(size) });
  return { url: browserLink(direct), direct };
}
