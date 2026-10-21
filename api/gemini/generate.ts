import { messageOf, type ApiRequest, type ApiResponse } from '../../server/http.js';
import { isProjectId, ownedAssetPath } from '../../server/projectAudio.js';
import { logged } from '../../server/errorLog.js';
import { createHash } from 'node:crypto';
import { signAssets, writeAsset } from '../../server/assets.js';
import { requireMember, serviceDatabase } from '../../server/auth.js';
import { recordUsage, type UsageEvent } from '../../server/usage.js';
import { applyPronunciations, loadPronunciations, spokenOptionLetters } from '../../server/pronunciation.js';
import { storedNarrationAudio } from '../../server/mp3.js';
import {
  GEMINI_TTS_MODELS as GEMINI_MODELS, isDailyQuotaError, isInvalidKeyError, quotaTag, markTeacherKeyInvalid, normalizeApiKey,
  readDailyState, readTeacherKey, textMark, usageDetail, FREE_TTS_PER_MODEL, type KeySource,
} from '../../server/quota.js';

export const config = { maxDuration: 120 };
export const REQUEST_BUDGET_MS = 95_000;
const MIN_ATTEMPT_MS = 10_000;
/** One TTS request; longer solutions are sent in parts and joined by /api/gemini/join-parts. */
export const MAX_REQUEST_CHARS = 5000;

const VOICE_NAME = 'Achernar';
/**
 * The voice guesses an Arabic word's last vowel from grammar or habit (an option word read alone
 * comes out with damma although fatha is written) and drops it before a pause. Teachers write
 * every mark on purpose, so the voice is told to keep exactly the written marks.
 */
export const ARABIC_ENDINGS = 'Arabic vowel marks are written on purpose: pronounce each Arabic word with exactly the vowel marks written on it, above all its last mark. Never replace a written last vowel with the one grammar or habit suggests: a written fatha stays fatha (never damma), kasra stays kasra, damma stays damma, and tanwin stays tanwin (-un, -an, -in). This holds for a word standing alone (an answer option, a single verb), at the end of a line and before a pause; do not use the pausal form.';
/** A label like "D)" before an Arabic option is a Turkish letter, not an Arabic one (dal, he). */
export const OPTION_LETTERS = 'Answer option letters (A, B, C, D, E, also when Arabic text follows them) are Turkish letter names: say a, be, ce, de, e in Turkish.';
// 3.8 models read naturally on their own; the instructions are fidelity and the written Arabic endings.
export const STYLE = `Read the text exactly as written. Do not add anything. ${ARABIC_ENDINGS} ${OPTION_LETTERS}`;

/**
 * Older TTS models (3.1) read a director's prompt. No classroom scene: a scene invites the
 * model to improvise teacher talk. Fidelity comes first and the notes say they are not spoken.
 */
function legacyPrompt(text: string) {
  return `# AUDIO PROFILE: Achernar, experienced exam teacher

### DIRECTOR'S NOTES (never read these notes aloud)
Fidelity (most important): Speak only the transcript below, word for word, exactly once, from its first word to its last word. Do not add, drop, reorder, repeat, translate, summarize or explain anything. No greeting, no introduction, no closing remark, no words of your own.
Pronunciation: Read Turkish with native Turkish pronunciation and Arabic with native Arabic pronunciation, exactly as written, including Arabic vowel marks and Turkish circumflex letters (â, î, û). ${ARABIC_ENDINGS} ${OPTION_LETTERS} Switch languages without carrying one accent into the other.
Style: Natural, clear, calm and instructional, like a teacher explaining a solution. Not an announcer.
Pace: Moderate and steady, with brief natural pauses between reasoning steps.

#### TRANSCRIPT
${text}`;
}

function makeRequestBody(model: string, text: string) {
  const is38 = model.startsWith('gemini-3.8-');
  return {
    contents: [{
      role: 'user',
      parts: is38 ? [{ text, speech_metadata: { style: STYLE } }] : [{ text: legacyPrompt(text) }],
    }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: is38
          ? { voice: VOICE_NAME }
          : { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
      },
    },
  };
}

function pcmToWav(pcm: Buffer, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function wavDurationSeconds(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return 0;
  let offset = 12, byteRate = 0, dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ' && size >= 16 && offset + 20 <= buffer.length) byteRate = buffer.readUInt32LE(offset + 16);
    else if (id === 'data') {
      dataSize = Math.min(size, Math.max(0, buffer.length - offset - 8));
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : 0;
}

function sampleRateFromMime(mime: string) {
  const match = /rate=(\d+)/i.exec(mime || '');
  return match ? Number(match[1]) : 24000;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Storage calls hit a passing network error now and then: three tries before giving up. */
const STORE_RETRY_MS = [0, 700, 2000];

export async function saveGeneratedAudio(memberId: string, projectId: string, text: string, audio: Buffer, extension: string, contentType: string) {
  const db = serviceDatabase();
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 20);
  const path = `${memberId}/${projectId}/gemini-${digest}.${extension}`;
  if (!isProjectId(projectId) || !ownedAssetPath(memberId, path)) throw new StoreError('Gemini sesi depoya kaydedilemedi: geçersiz proje.');
  let failure = '';
  for (const delay of STORE_RETRY_MS) {
    if (delay) await wait(delay);
    try {
      await writeAsset(db, path, audio, contentType);
      const signedUrl = (await signAssets(db, [path])).get(path);
      if (!signedUrl) { failure = 'oynatma bağlantısı oluşturulamadı'; continue; }
      return { path, signedUrl };
    } catch (error) {
      failure = messageOf(error) || 'ağ hatası';
    }
  }
  throw new StoreError(`Gemini sesi depoya kaydedilemedi: ${failure}`);
}
/** The voice was made but could not be stored: it is sent to the browser instead, never thrown away. */
export class StoreError extends Error {}

/**
 * Rough time Google needs for a text (the voice is made about 5–6× faster than it is spoken).
 * A model is not started when the rest of the budget cannot fit it: a request cut off by our
 * timeout still counts against the day's allowance.
 */
export function neededMs(characters: number): number {
  return 8_000 + characters * 12;
}

/**
 * Google answered but would not voice this text: a filter on the text itself (finish reason
 * OTHER, SAFETY, PROHIBITED_CONTENT… or a blocked prompt), not a busy or used-up model. The same
 * text gets the same answer on another key, and each refusal still counts against the day's allowance.
 */
export function isContentRefusal(payload: any): boolean {
  const reason = String(payload?.candidates?.[0]?.finishReason || '');
  return !!payload?.promptFeedback?.blockReason || /^(OTHER|SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION|LANGUAGE)$/.test(reason);
}

/** Why a reply came without audio, for the admin failure list. */
export function missingAudioReason(payload: any): string {
  const candidate = payload?.candidates?.[0];
  const parts: any[] = candidate?.content?.parts || [];
  return [
    candidate?.finishReason && `neden ${candidate.finishReason}`,
    payload?.promptFeedback?.blockReason && `engel ${payload.promptFeedback.blockReason}`,
    parts.some(p => typeof p?.text === 'string') && 'yalnız yazı döndü',
    !payload?.candidates?.length && 'aday yok',
  ].filter(Boolean).join(', ') || 'ayrıntı yok';
}

export const NO_ANSWER = 'Google’dan cevap gelmedi. Birkaç dakika sonra tekrar deneyin.';

/** Google would not voice this text: the same text gets the same answer, on any key and any model. */
function refusedAnswer(attempts: Attempt[]) {
  return {
    error: 'Google bu metni seslendirmedi. Aynı metinle yeniden denemek sonuç vermez; metinde küçük bir değişiklik yapıp yeniden deneyin ya da sesi kendiniz kaydedip yükleyin.',
    code: 'CONTENT_REFUSED', fallbackAllowed: false, attempts,
  };
}

interface Attempt { model: string; status: number; detail?: string; daily?: boolean; quota?: string; refused?: boolean; keySource: KeySource }

/** Each model attempt is its own request against that key's per-model free-tier quota. */
function failedUsage(attempts: Attempt[], characters: number): UsageEvent[] {
  return attempts.map(a => ({ kind: 'gemini_tts', state: 'failed', detail: usageDetail(a.model, a.status, a.daily, a.quota, a.detail), characters, keySource: a.keySource }));
}

async function handler(req: ApiRequest, res: ApiResponse) {
  const member = await requireMember(req, res);
  if (!member) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
  // Longer solutions come in parts (see src/services/narration/narrationParts.ts), each its own request.
  if (!text || text.length > MAX_REQUEST_CHARS) {
    return res.status(400).json({ error: `Seslendirme metni 1–${MAX_REQUEST_CHARS} karakter arasında olmalıdır.`, code: 'INVALID_TEXT', fallbackAllowed: false });
  }
  if (!isProjectId(projectId)) {
    return res.status(400).json({ error: 'Gemini seslendirmesi için proje kimliği gerekli.', code: 'MISSING_PROJECT_ID', fallbackAllowed: false });
  }

  const db = serviceDatabase();
  const { data: project, error: projectError } = await db.from('projects').select('id').eq('id', projectId).eq('owner_id', member.user.id).maybeSingle();
  if (projectError || !project) {
    return res.status(403).json({ error: 'Gemini seslendirmesi için proje erişimi doğrulanamadı.', code: 'PROJECT_ACCESS_DENIED', fallbackAllowed: false });
  }

  // Teacher's own key first (their own free quota), then the studio key; models already
  // out of daily quota on that key are skipped until the Pacific reset.
  const systemKey = normalizeApiKey(process.env.GEMINI_API_KEY);
  const [teacherKey, today, pronunciations] = await Promise.all([readTeacherKey(db, member.user.id), readDailyState(db, member.user.id), loadPronunciations(db)]);
  // What the voice reads: the solution with the shared pronunciation list applied (the text itself stays as written).
  const spoken = spokenOptionLetters(applyPronunciations(text, pronunciations));
  const lanes: Array<{ source: KeySource; key: string; skip: string[] }> = [];
  if (teacherKey) lanes.push({ source: 'teacher', key: teacherKey, skip: today.own.ttsExhausted });
  if (systemKey) lanes.push({ source: 'system', key: systemKey, skip: today.shared.ttsExhausted });
  if (!lanes.length) {
    return res.status(503).json({ error: 'Gemini ses servisi yapılandırılmamış.', code: 'MISSING_GEMINI_API_KEY', fallbackAllowed: true });
  }

  // Google refuses a text the same way every time and each refusal uses up a voice: a model
  // that already refused this text today is not asked again (another model may still voice it).
  const mark = textMark(spoken);
  const refusedModels = new Set(GEMINI_MODELS.filter(model => today.own.refusedTexts.includes(`${model} ${mark}`)));

  // The best model on every key first; the weaker backups only after the teacher agreed
  // (they add or drop sentences, flip negations, mispronounce Turkish).
  const allowLower = req.body?.allowLower === true;
  const tries = GEMINI_MODELS.slice(0, allowLower ? undefined : 1)
    .flatMap(model => lanes.filter(lane => !lane.skip.includes(model)).map(lane => ({ model, lane })));

  // The function stops at 120 s: keep ~25 s for storing the audio and logging usage.
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const attempts: Attempt[] = [];
  const refusedKeys = new Set<KeySource>();
  if (tries.length && tries.every(t => refusedModels.has(t.model))) return res.status(422).json(refusedAnswer([]));
  tries: for (const { model, lane } of tries) {
    // A key Google refused (invalid or not allowed) is not tried with the other models.
    if (!refusedKeys.has(lane.source) && !refusedModels.has(model)) {
      const remaining = deadline - Date.now();
      if (remaining < Math.max(MIN_ATTEMPT_MS, neededMs(spoken.replace(/[\u064B-\u065F\u0670\u0640]/g, '').length))) break tries;
      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(remaining),
            headers: { 'x-goog-api-key': lane.key, 'Content-Type': 'application/json' },
            body: JSON.stringify(makeRequestBody(model, spoken)),
          }
        );

        const raw = await upstream.text();
        if (!upstream.ok) {
          let detail = '';
          try {
            const parsed = JSON.parse(raw);
            detail = parsed?.error?.message || parsed?.message || '';
          } catch {
            detail = raw.slice(0, 180);
          }
          attempts.push({ model, status: upstream.status, detail, daily: isDailyQuotaError(upstream.status, raw), quota: quotaTag(upstream.status, raw), keySource: lane.source });
          if (lane.source === 'teacher' && isInvalidKeyError(upstream.status, raw)) await markTeacherKeyInvalid(db, member.user.id);
          if (upstream.status === 401 || upstream.status === 403 || isInvalidKeyError(upstream.status, raw)) refusedKeys.add(lane.source);
          continue;
        }

        const payload = JSON.parse(raw);
        const audioPart = (payload?.candidates?.[0]?.content?.parts || []).find((part: any) => part?.inlineData?.data);
        if (!audioPart?.inlineData?.data) {
          const refused = isContentRefusal(payload);
          if (refused) refusedModels.add(model);
          attempts.push({ model, status: 502, detail: `Gemini yanıtında ses verisi yok (${missingAudioReason(payload)}).${refused ? ` metin:${mark}` : ''}`, refused, keySource: lane.source });
          continue;
        }

        const upstreamMime = String(audioPart.inlineData.mimeType || '');
        let wav = Buffer.from(audioPart.inlineData.data, 'base64');
        if (wav.toString('ascii', 0, 4) !== 'RIFF') wav = pcmToWav(wav, sampleRateFromMime(upstreamMime));
        const duration = wavDurationSeconds(wav);
        const audio = await storedNarrationAudio(wav);
        let stored: { path: string; signedUrl: string } | null = null;
        let storeNote = '';
        try {
          stored = await saveGeneratedAudio(member.user.id, projectId, text, audio.bytes, audio.extension, audio.mimeType);
        } catch (error) {
          // The voice exists: the browser gets it and stores it with the project instead.
          if (!(error instanceof StoreError)) throw error;
          storeNote = ` (depo: ${error.message}; ses tarayıcıya gönderildi)`;
        }

        await recordUsage(member.user.id, projectId, [...failedUsage(attempts, text.length),
          { kind: 'gemini_tts', state: 'succeeded', detail: model + storeNote, characters: text.length, keySource: lane.source }]);
        return res.status(200).json({
          ...(stored ? { audioUrl: stored.signedUrl, assetPath: stored.path } : { audioBase64: audio.bytes.toString('base64') }),
          mimeType: audio.mimeType,
          mode: 'live',
          durationSeconds: Number(duration.toFixed(3)),
          provider: 'gemini',
          modelId: model,
          voiceId: VOICE_NAME,
          voiceName: VOICE_NAME,
          attempts: attempts.length + 1,
          keySource: lane.source,
          lowerModel: model !== GEMINI_MODELS[0],
        });
      } catch (error) {
        attempts.push({ model, status: 502, detail: messageOf(error) || 'Ağ hatası', keySource: lane.source });
      }
    }
  }

  await recordUsage(member.user.id, projectId, failedUsage(attempts, text.length));
  // Google would not voice this text (a backup model would not either): the browser voices it
  // in smaller pieces, and names the piece that is still refused.
  if (attempts.some(a => a.refused) && attempts.every(a => a.refused || a.daily)) return res.status(422).json(refusedAnswer(attempts));
  if (!allowLower && GEMINI_MODELS.length > 1) {
    const daily = tries.length === 0 || (attempts.length > 0 && attempts.every(a => a.daily));
    if (!daily) {
      // The best model is not used up, Google just did not answer: try it again later, no other model.
      return res.status(503).json({ error: NO_ANSWER, code: 'GOOGLE_NO_ANSWER', fallbackAllowed: false, attempts });
    }
    // The best model's allowance is used up: the teacher decides whether the next model voices it.
    // A page opened before this rule cannot ask; its teacher is told to reload instead.
    const reload = req.body?.canAsk === true ? '' : ' Sonraki modelle seslendirmek için sayfayı yenileyin (F5).';
    const used = teacherKey ? today.own.ttsUsed : today.shared.ttsUsedAll;
    return res.status(409).json({
      error: 'En üst düzey modelin bugünkü kullanım hakkı bitti.' + reload,
      code: 'TOP_MODEL_UNAVAILABLE', reason: 'daily', used, limit: GEMINI_MODELS.length * FREE_TTS_PER_MODEL, fallbackAllowed: false, attempts,
    });
  }
  const compact = attempts.length
    ? attempts.map(a => `${a.keySource === 'teacher' ? 'kendi anahtarı' : 'ortak anahtar'} ${a.model}: HTTP ${a.status}${a.detail ? ` (${a.detail.slice(0, 120)})` : ''}`).join(' | ')
    : 'Bugünkü Gemini seslendirme kotaları dolu.';
  console.warn('[Gemini TTS] all free-tier models failed', attempts);
  return res.status(429).json({
    error: `Gemini TTS başarısız. ${compact || 'Model yanıtı alınamadı.'}`,
    code: 'GEMINI_TTS_EXHAUSTED',
    fallbackAllowed: true,
    attempts,
  });
}

export default logged('/api/gemini/generate', handler);
