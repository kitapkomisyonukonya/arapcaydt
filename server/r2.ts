import { createHash, createHmac } from 'node:crypto';

/**
 * Cloudflare R2 (S3-compatible) access with presigned links only: the server
 * signs, the browser or the server itself then calls the link. Enabled when the
 * four R2_* variables are set in the hosting environment; otherwise every
 * caller keeps using Supabase Storage.
 */
export interface R2Config { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }

export function r2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = (env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (env.R2_BUCKET || '').trim();
  return accountId && accessKeyId && secretAccessKey && bucket ? { accountId, accessKeyId, secretAccessKey, bucket } : null;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');

export interface PresignInput {
  method: string; host: string; path: string; region: string; accessKeyId: string; secretAccessKey: string;
  expires: number; now?: Date; query?: Record<string, string>; headers?: Record<string, string>;
}

/** AWS Signature V4 query-string signing (UNSIGNED-PAYLOAD). `path` is unencoded and starts with "/". */
export function presign(input: PresignInput): string {
  const now = input.now || new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const headers: Record<string, string> = { host: input.host };
  for (const [k, v] of Object.entries(input.headers || {})) headers[k.toLowerCase()] = String(v).trim();
  const signedHeaders = Object.keys(headers).sort().join(';');
  const query: Record<string, string> = {
    ...input.query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expires),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonicalPath = input.path.split('/').map(enc).join('/');
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join('');
  const request = [input.method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(request)].join('\n');
  let key = hmac(`AWS4${input.secretAccessKey}`, day);
  for (const part of [input.region, 's3', 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `https://${input.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

const hostOf = (c: R2Config) => `${c.accountId}.r2.cloudflarestorage.com`;

/**
 * Links handed to the browser go through the site's own address (vercel.json rewrites /r2/… to the
 * bucket's host), because some school networks (MEB) block *.r2.cloudflarestorage.com. The signature
 * is for the bucket's host, which the rewrite sends on, so the link stays valid.
 */
export const R2_PROXY = '/r2';
export function browserLink(url: string): string {
  const link = new URL(url);
  return link.host.endsWith('.r2.cloudflarestorage.com') ? `${R2_PROXY}${link.pathname}${link.search}` : url;
}

export function r2Link(c: R2Config, method: string, key: string, expires = 21600, headers?: Record<string, string>, query?: Record<string, string>): string {
  return presign({
    method, host: hostOf(c), path: `/${c.bucket}${key ? `/${key}` : ''}`, region: 'auto',
    accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, expires, headers, query,
  });
}

/** Key of a presigned link to this bucket (direct or through the site's /r2 address), or null for any other URL. */
export function r2LinkPath(url: string, c: R2Config | null = r2Config()): string | null {
  if (!c) return null;
  try {
    const link = new URL(url.startsWith(`${R2_PROXY}/`) ? `https://${hostOf(c)}${url.slice(R2_PROXY.length)}` : url);
    const prefix = `/${c.bucket}/`;
    if (link.protocol !== 'https:' || link.host !== hostOf(c) || !link.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(link.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

export async function r2Get(c: R2Config, key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const res = await fetch(r2Link(c, 'GET', key, 600));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 okuma hatası (HTTP ${res.status})`);
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'application/octet-stream' };
}

export async function r2Put(c: R2Config, key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void> {
  const res = await fetch(r2Link(c, 'PUT', key, 600), { method: 'PUT', body: bytes as BodyInit, headers: { 'Content-Type': contentType } });
  if (!res.ok) throw new Error(`R2 yazma hatası (HTTP ${res.status})`);
}

/** Size of a stored object, or null when it is not there. */
export async function r2Size(c: R2Config, key: string): Promise<number | null> {
  const res = await fetch(r2Link(c, 'HEAD', key, 600), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 kontrol hatası (HTTP ${res.status})`);
  return Number(res.headers.get('content-length')) || 0;
}

export async function r2Delete(c: R2Config, key: string): Promise<void> {
  const res = await fetch(r2Link(c, 'DELETE', key, 600), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`R2 silme hatası (HTTP ${res.status})`);
}

const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** One page of a ListObjectsV2 response. */
export function parseList(xml: string): { objects: Array<{ name: string; bytes: number; created_at: string }>; next: string | null } {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(m => ({
    name: xmlText(m[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || ''),
    bytes: Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] || 0),
    created_at: m[1].match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] || new Date(0).toISOString(),
  })).filter(o => o.name);
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = truncated ? xmlText(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || '') || null : null;
  return { objects, next };
}

export async function r2List(c: R2Config): Promise<Array<{ name: string; bytes: number; created_at: string }>> {
  const all: Array<{ name: string; bytes: number; created_at: string }> = [];
  let token: string | null = null;
  do {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) };
    const res = await fetch(r2Link(c, 'GET', '', 600, undefined, query));
    if (!res.ok) throw new Error(`R2 listesi okunamadı (HTTP ${res.status})`);
    const page = parseList(await res.text());
    all.push(...page.objects);
    token = page.next;
  } while (token);
  return all;
}
