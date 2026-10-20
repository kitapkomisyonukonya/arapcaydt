import type { ApiRequest, ApiResponse } from '../../server/http.js';
import { timingSafeEqual } from 'node:crypto';
import { serviceDatabase } from '../../server/auth.js';
import { logged } from '../../server/errorLog.js';
import { readAsset, signAssets } from '../../server/assets.js';
import { pacificDayStart } from '../../server/quota.js';

/**
 * Read-only report for the morning check (a scheduled Claude session): the last hours' problem
 * reports, teachers' own Mesajlar, browser errors, server errors and failed service requests. It is opened with the
 * MONITOR_TOKEN secret, never with a teacher's session, and returns no keys or audio.
 *   GET /api/admin/monitor?hours=24         the report (up to 90 days back; &until=<ISO> pages older service failures)
 *   GET /api/admin/monitor?feedback=<id>    one report's teşhis record
 *   GET /api/admin/monitor?screenshots=<id> one report's screenshots (JPEG data links)
 *   GET /api/admin/monitor?project=<id>     one question (text, answer, marks, a 10-minute picture link; no audio)
 *   GET /api/admin/monitor?project=<id>&picture=1   that question's picture itself
 *   GET /api/admin/monitor?list=1           question ids with a picture (for measuring the reader)
 *   GET /api/admin/monitor?usage=1          today's (Google day) voice and timing requests per teacher and key, and who has a key (last 4 only)
 * The check may also send one fixed answer (SOLVED_REPLY), nothing else, once a problem is fixed:
 *   POST /api/admin/monitor?feedback=<id>   answers that report and marks it solved
 *   POST /api/admin/monitor?teacher=<id>    writes it to that teacher under Mesajlar
 */
export function tokenMatches(header: unknown, token: string | undefined): boolean {
  if (!token || token.length < 24 || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7)), wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export const SOLVED_REPLY = 'Sorunu çözdüm hocam, sayfayı yenileyip tekrar deneyebilirsiniz.';

const FAILED_SERVICES = ['gemini_tts', 'gemini_transcribe', 'elevenlabs_align', 'voice', 'client_error'];

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.MONITOR_TOKEN) return res.status(404).json({ error: 'Not found' });
  if (!tokenMatches(req.headers.authorization, process.env.MONITOR_TOKEN)) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Cache-Control', 'no-store');
  const db = serviceDatabase();
  const id = (v: unknown) => typeof v === 'string' && /^[\w-]{1,80}$/.test(v) ? v : null;

  if (req.method === 'POST') return answer(db, req, res, id);

  if (req.query?.feedback) {
    const { data, error } = await db.from('feedback').select('id,diagnostics').eq('id', id(req.query.feedback)).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return data ? res.status(200).json(data.diagnostics ?? null) : res.status(404).json({ error: 'Not found' });
  }
  if (req.query?.screenshots) {
    const { data, error } = await db.from('feedback').select('id,screenshots').eq('id', id(req.query.screenshots)).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return data ? res.status(200).json(data.screenshots ?? []) : res.status(404).json({ error: 'Not found' });
  }
  if (req.query?.usage) {
    const [activity, keys, profiles] = await Promise.all([
      db.from('activity').select('owner_id,kind,state,key_source').in('kind', ['gemini_tts', 'gemini_transcribe'])
        .gte('created_at', pacificDayStart()).limit(5000),
      db.from('teacher_gemini_keys').select('owner_id,last4,status,updated_at'),
      db.from('profiles').select('id,name'),
    ]);
    if (activity.error) return res.status(500).json({ error: activity.error.message });
    const names = Object.fromEntries((profiles.data || []).map((p: any) => [p.id, p.name || 'Öğretmen']));
    const teachers: Record<string, any> = {};
    const of = (owner: string) => teachers[owner] ??= { name: names[owner] ?? owner, key: null, counts: {} };
    for (const k of keys.data || []) of(k.owner_id).key = { last4: k.last4, status: k.status, updatedAt: k.updated_at };
    for (const a of activity.data || []) {
      const label = `${a.kind} ${a.key_source || '-'} ${a.state}`;
      const counts = of(a.owner_id).counts;
      counts[label] = (counts[label] || 0) + 1;
    }
    return res.status(200).json({ since: pacificDayStart(), teachers });
  }
  if (req.query?.list) {
    const { data, error } = await db.from('projects').select('id,updated_at,category:data->>category,vision:data->videoConfig->visionReading->>key')
      .not('data->imageUrl', 'is', null).order('updated_at', { ascending: false }).limit(1000);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json((data || []).map((p: any) => ({ id: p.id, updated_at: p.updated_at, category: p.category, vision: !!p.vision })));
  }
  if (req.query?.project) {
    const { data, error } = await db.from('projects').select('id,owner_id,updated_at,image:data->imageUrl,title:data->>title,category:data->>category,solutionText:data->>solutionText,'
      + 'correctAnswer:data->>correctAnswer,narrationType:data->narrationSource->>type,words:data->narrationSource->words,'
      + 'duration:data->narrationSource->duration,videoConfig:data->videoConfig').eq('id', id(req.query.project)).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Not found' });
    // The question picture as a link that works for ten minutes (for checking how it is read).
    const path = typeof (data as any).image === 'object' ? (data as any).image?.assetPath : null;
    if (req.query?.picture && path) {
      // The picture itself (for a checker that cannot reach the storage host).
      const file = await readAsset(db, path);
      if (!file) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Type', file.contentType);
      return res.status(200).send(file.bytes);
    }
    const signed = path ? (await signAssets(db, [path], 600)).get(path) : null;
    return res.status(200).json({ ...(data as object), image: signed ?? (typeof (data as any).image === 'string' && /^https:/.test((data as any).image) ? (data as any).image : null) });
  }

  const hours = Math.min(2160, Math.max(1, Number(req.query?.hours) || 24));
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const until = typeof req.query?.until === 'string' && !Number.isNaN(Date.parse(req.query.until)) ? new Date(req.query.until).toISOString() : null;
  const [feedback, activity, server, profiles, messages] = await Promise.all([
    db.from('feedback').select('id,owner_id,message,context,status,reply,replied_at,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(200),
    db.from('activity').select('owner_id,project_id,kind,state,detail,key_source,created_at').in('kind', FAILED_SERVICES).gte('created_at', since)
      .lt('created_at', until ?? new Date(Date.now() + 60e3).toISOString())
      .order('created_at', { ascending: false }).limit(500),
    db.from('server_errors').select('owner_id,route,status,message,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(200),
    db.from('profiles').select('id,name'),
    db.from('messages').select('teacher_id,body,created_at,read_at').eq('from_admin', false).gte('created_at', since).order('created_at', { ascending: false }).limit(300),
  ]);
  const names = Object.fromEntries((profiles.data || []).map((p: any) => [p.id, p.name || 'Öğretmen']));
  const failures = (activity.data || []).filter((a: any) => a.kind === 'client_error' || a.state === 'failed');
  return res.status(200).json({
    since, hours, names,
    feedback: feedback.error ? { unavailable: feedback.error.message } : feedback.data,
    messages: messages.error ? { unavailable: messages.error.message } : messages.data,
    browserErrors: failures.filter((a: any) => a.kind === 'client_error'),
    requestFailures: failures.filter((a: any) => a.kind !== 'client_error'),
    serverErrors: server.error ? { unavailable: server.error.message } : server.data,
  });
}

async function answer(db: any, req: ApiRequest, res: ApiResponse, id: (v: unknown) => string | null) {
  const repliedAt = new Date().toISOString();
  if (req.query?.feedback) {
    const { data, error } = await db.from('feedback').update({ reply: SOLVED_REPLY, replied_at: repliedAt, status: 'resolved' })
      .eq('id', id(req.query.feedback)).is('replied_at', null).select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ sent: (data || []).length > 0 });
  }
  if (req.query?.teacher) {
    const teacher = id(req.query.teacher);
    const [{ data: who }, { data: admin }] = await Promise.all([
      db.from('profiles').select('id').eq('id', teacher).maybeSingle(),
      db.from('profiles').select('id').eq('role', 'admin').eq('status', 'approved').order('created_at').limit(1).maybeSingle(),
    ]);
    if (!who || !admin) return res.status(404).json({ error: 'Not found' });
    const { error } = await db.from('messages').insert({ teacher_id: who.id, sender_id: admin.id, from_admin: true, body: SOLVED_REPLY });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ sent: true });
  }
  return res.status(400).json({ error: 'feedback or teacher required' });
}

export default logged('/api/admin/monitor', handler);
