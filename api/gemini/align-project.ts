import { messageOf, type ApiRequest, type ApiResponse } from '../../server/http.js';
import { logged } from '../../server/errorLog.js';
import { requireMember, serviceDatabase } from '../../server/auth.js';
import { recordUsage } from '../../server/usage.js';
import { ProjectAudioError, loadProjectAudio } from '../../server/projectAudio.js';
import {
  TRANSCRIBE_MODEL, isCapped, isDailyQuotaError, isInvalidKeyError, markTeacherKeyInvalid, quotaTag,
  normalizeApiKey, readDailyState, readTeacherKey, sharedTranscribeAllowed, usageDetail, type KeySource,
} from '../../server/quota.js';

export const config = { maxDuration: 120 };
const REQUEST_BUDGET_MS = 100_000;

function parseOffset(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = parseFloat(String(value).replace(/s$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

async function uploadGeminiFile(apiKey: string, bytes: Buffer, mimeType: string, displayName: string) {
  const start = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!start.ok) throw new Error(`Dosya yükleme oturumu açılamadı (HTTP ${start.status}).`);
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini dosya yükleme adresi döndürmedi.');

  const upload = await fetch(uploadUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Length': String(bytes.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': mimeType,
    },
    body: bytes,
  });
  const raw = await upload.text();
  if (!upload.ok) throw new Error(`Ses Gemini Files API'ye yüklenemedi (HTTP ${upload.status}).`);
  const info = JSON.parse(raw);
  const uri = info?.file?.uri;
  if (!uri) throw new Error('Gemini yüklenen ses için URI döndürmedi.');
  return { uri: String(uri), name: String(info?.file?.name || ''), mimeType: String(info?.file?.mimeType || mimeType) };
}

async function deleteGeminiFile(apiKey: string, name: string) {
  if (!name) return;
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    method: 'DELETE',
    headers: { 'x-goog-api-key': apiKey },
  }).catch(() => undefined);
}

async function handler(req: ApiRequest, res: ApiResponse) {
  const member = await requireMember(req, res);
  if (!member) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
  if (!projectId) return res.status(400).json({ error: 'Proje kimliği gerekli.' });

  const db = serviceDatabase();
  const { data: row, error: projectError } = await db
    .from('projects')
    .select('owner_id,data')
    .eq('id', projectId)
    .eq('owner_id', member.user.id)
    .maybeSingle();

  if (projectError || !row) return res.status(404).json({ error: 'Proje bulunamadı.' });

  const source = row.data?.narrationSource;
  // Generated voices and the teacher's own recordings, once stored with the project.
  if (!source || !['gemini', 'uploaded'].includes(source.type)) {
    return res.status(400).json({ error: 'Bu proje için kayıtlı bir ses bulunamadı.' });
  }

  const solutionText = typeof row.data?.solutionText === 'string' ? row.data.solutionText : '';
  let bytes: Buffer, mimeType: string;
  try {
    ({ bytes, mimeType } = await loadProjectAudio(db, member.user.id, source));
  } catch (error) {
    return res.status(error instanceof ProjectAudioError ? error.status : 502).json({ error: messageOf(error) || 'Ses dosyası okunamadı.' });
  }

  // Teacher's own Transcribe quota first, then the studio key (capped per teacher per day).
  // When neither is available the caller continues with ElevenLabs, then local Whisper.
  const systemKey = normalizeApiKey(process.env.GEMINI_API_KEY);
  const [teacherKey, today] = await Promise.all([readTeacherKey(db, member.user.id), readDailyState(db, member.user.id)]);
  const lanes: Array<{ source: KeySource; key: string }> = [];
  if (teacherKey && !today.own.transcribeExhausted) lanes.push({ source: 'teacher', key: teacherKey });
  if (systemKey && sharedTranscribeAllowed(today, isCapped(member))) lanes.push({ source: 'system', key: systemKey });
  if (!lanes.length) {
    const reason = !systemKey && !teacherKey ? 'Gemini API anahtarı yapılandırılmamış.'
      : today.shared.transcribeExhausted ? 'Bugünkü Gemini kelime zamanı kotaları doldu.'
      : `Bugünkü Gemini kelime zamanı hakkınız doldu (ortak kotadan günlük ${today.limits.sharedTranscribe}).`;
    return res.status(429).json({ error: reason, code: 'TRANSCRIBE_LIMIT' });
  }

  const failures: string[] = [];
  let lastStatus = 502;
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  for (const lane of lanes) {
    let result: TranscribeResult | undefined;
    // A per-minute 429 or a request that never reached Google is retried once on the teacher's
    // own key before the shared key is used; a daily quota or a bad key moves on at once.
    for (let attempt = 0; attempt < (lane.source === 'teacher' ? 2 : 1); attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 15_000) break;
      if (attempt) await new Promise(resolve => setTimeout(resolve, retryDelayMs(result!.raw)));
      result = await transcribe(lane.key, bytes, mimeType, projectId, deadline - Date.now());
      const gap = result.words?.length ? missingTurkish(result.words, solutionText) : '';
      if (gap) result = { status: 200, raw: '', error: gap };
      await recordUsage(member.user.id, projectId, [{ kind: 'gemini_transcribe', state: result.words ? 'succeeded' : 'failed',
        detail: usageDetail(TRANSCRIBE_MODEL, result.status, !result.words && isDailyQuotaError(result.status, result.raw),
          result.words ? '' : quotaTag(result.status, result.raw), result.words ? '' : result.error), keySource: lane.source }]);
      if (result.words?.length || !transient(result)) break;
    }
    if (!result) { failures.push('Süre doldu.'); break; }
    if (result.words?.length) {
      return res.status(200).json({ words: result.words, modelId: TRANSCRIBE_MODEL, timingSource: 'gemini-transcribe', keySource: lane.source });
    }
    if (lane.source === 'teacher' && result.status && isInvalidKeyError(result.status, result.raw)) await markTeacherKeyInvalid(db, member.user.id);
    failures.push(`${lane.source === 'teacher' ? 'Kendi anahtarınız' : 'Ortak anahtar'}: ${result.error}`);
    lastStatus = result.status && result.status >= 400 ? result.status : 502;
    // The model answered but found no words in this audio: the same audio on the shared key
    // gives the same empty answer and only spends the shared allowance. The next timing service takes over.
    if (result.status === 200) break;
    // Google's Transcribe model is overloaded (503): it is overloaded on the shared key too, and every
    // overloaded answer still counts against that key's 25 a day. The next timing service takes over.
    if (result.status >= 500) break;
  }
  return res.status(lastStatus).json({ error: failures.join(' · '), code: 'GEMINI_TRANSCRIBE_ERROR' });
}

/**
 * Transcribe sometimes takes a Turkish–Arabic narration for Arabic only: it writes the Arabic
 * sentences and leaves the Turkish out (or turns it into Arabic). Those timings cannot place
 * the solution's sentences, so they are not used; the text-based ElevenLabs alignment takes over.
 * Returns why, or '' when the Turkish was written.
 */
export function missingTurkish(words: Array<{ text: string }>, solutionText: string): string {
  const latin = (s: string) => /[A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû]/.test(s);
  const expected = solutionText.split(/\s+/).filter(latin).length;
  if (expected < 15) return '';
  const heard = words.filter(w => latin(w.text)).length;
  return heard < expected * 0.3 ? `Gemini Transcribe Türkçe kısmı yazmadı (${expected} Türkçe kelimeden ${heard}).` : '';
}

/**
 * Worth one more try on the same key: no answer, or a per-minute (not daily) 429. A server error
 * (503 "high demand") is not: Google counts it against the day's 25 Transcribe requests, and in
 * November 2026 the model stayed overloaded for hours, so a retry seconds later only burned quota.
 */
function transient(result: TranscribeResult): boolean {
  if (result.words?.length) return false;
  if (!result.status) return true;
  return result.status === 429 && !isDailyQuotaError(429, result.raw);
}

/** Google's suggested wait ("retryDelay": "7s"), kept between 2 and 12 seconds. */
function retryDelayMs(raw = ''): number {
  const seconds = Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(raw)?.[1] ?? 3);
  return Math.min(12, Math.max(2, seconds)) * 1000;
}

/**
 * Shape of a Transcribe reply that gave no word timings, for the admin failure list:
 * status, steps, content types, annotation types, bad offsets and text length. No transcript text.
 */
export function describeResponse(payload: any): string {
  const steps: any[] = Array.isArray(payload?.steps) ? payload.steps : [];
  const contents = steps.flatMap(step => Array.isArray(step?.content) ? step.content : []);
  const annotations = contents.flatMap(content => Array.isArray(content?.annotations) ? content.annotations : []);
  const words = annotations.filter(a => a?.type === 'word_info');
  const badOffsets = words.filter(a => parseOffset(a?.start_offset) == null || parseOffset(a?.end_offset) == null).length;
  const textLength = contents.reduce((n, content) => n + (typeof content?.text === 'string' ? content.text.length : 0), 0);
  const kinds = (items: any[]) => Array.from(new Set(items.map(i => String(i?.type ?? '?')))).join('/') || '-';
  return [
    payload?.status && `durum ${payload.status}`,
    `steps ${steps.length}`,
    `içerik ${kinds(contents)}`,
    `işaret ${kinds(annotations)}`,
    badOffsets && `${badOffsets} kelimenin zamanı okunamadı`,
    `metin ${textLength} karakter`,
    !steps.length && `alanlar ${Object.keys(payload || {}).slice(0, 5).join('/') || '-'}`,
  ].filter(Boolean).join(', ');
}

interface TranscribeResult { status: number; raw: string; error?: string; words?: Array<{ text: string; start: number; end: number }> }

/** One Transcribe request with one key; status 0 means the model was never called (upload/network failure). */
async function transcribe(apiKey: string, bytes: Buffer, mimeType: string, projectId: string, budgetMs: number): Promise<TranscribeResult> {
  const deadline = Date.now() + budgetMs;
  let uploadedName = '';
  let status = 0;
  try {
    const uploaded = await uploadGeminiFile(apiKey, bytes, mimeType, `narration-${projectId}.${mimeType === 'audio/mpeg' ? 'mp3' : 'wav'}`);
    uploadedName = uploaded.name;

    const interaction = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())),
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TRANSCRIBE_MODEL,
        input: [{
          type: 'audio',
          uri: uploaded.uri,
          mime_type: uploaded.mimeType,
        }],
        generation_config: {
          transcription_config: {
            language_codes: [],
            mode: {
              type: 'verbatim',
              timestamp_granularities: ['word'],
            },
          },
        },
      }),
    });

    const raw = await interaction.text();
    status = interaction.status;
    if (!interaction.ok) {
      let detail = '';
      try { detail = JSON.parse(raw)?.error?.message || ''; } catch {}
      return { status, raw, error: detail || `Gemini 3.5 Transcribe hata döndürdü (HTTP ${status}).` };
    }

    let payload: any;
    try { payload = JSON.parse(raw); } catch { return { status, raw: '', error: `Gemini Transcribe yanıtı JSON değil: ${raw.slice(0, 80)}` }; }
    const words: Array<{ text: string; start: number; end: number }> = [];
    for (const step of payload?.steps || []) {
      for (const content of step?.content || []) {
        for (const annotation of content?.annotations || []) {
          if (annotation?.type !== 'word_info' || typeof annotation?.text !== 'string') continue;
          const start = parseOffset(annotation.start_offset);
          const end = parseOffset(annotation.end_offset);
          if (start == null || end == null) continue;
          words.push({
            text: annotation.text.trim(),
            start: Number(start.toFixed(3)),
            end: Number(Math.max(start, end).toFixed(3)),
          });
        }
      }
    }

    if (!words.length) return { status, raw: '', error: `Gemini Transcribe kelime zaman damgası döndürmedi (${describeResponse(payload)}).` };
    return { status, raw: '', words };
  } catch (error) {
    console.error('[Gemini Transcribe alignment]', messageOf(error) || error);
    return { status, raw: '', error: messageOf(error) || 'Gemini zamanlama servisine ulaşılamadı.' };
  } finally {
    await deleteGeminiFile(apiKey, uploadedName);
  }
}

export default logged('/api/gemini/align-project', handler);
