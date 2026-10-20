import { supabase } from '../../services/supabase';

/** Where reports are sent when the database is not ready (e-mail fallback). */
export const ADMIN_EMAIL = 'yunusemreyilmaz93@gmail.com';

export interface ReportContext {
  page?: string;
  projectId?: string;
  projectTitle?: string;
  step?: string;
  /** The open question's teşhis record, taken only when a report is sent. */
  snapshot?: () => unknown;
}

/** What the teacher picks in one tap; the admin sees it as the report's title. */
export const REPORT_REASONS = [
  'Çizgi yanlış yerde', 'Tik / çarpı yanlış şıkta', 'Ses yanlış okudu', 'İşaret zamanı kaymış', 'Hata verdi / takıldı', 'Başka bir şey',
] as const;

export interface FeedbackContext extends Omit<ReportContext, 'snapshot'> {
  /** The one-tap reason, when the teacher picked one. */
  reason?: string;
  /** The report carries the question's teşhis record (feedback.diagnostics). */
  hasDiagnostics?: boolean;
  url: string;
  at: string;
  browser: string;
  screen: string;
  /** Messages the teacher could see (role="alert") when opening the form. */
  shownErrors: string[];
  /** Recent errors from the page itself, newest last. */
  recentErrors: string[];
  /** How many screenshots came with the report (feedback.screenshots). */
  screenshotCount?: number;
}

let current: ReportContext = {};
/** Pages and the editor say what the teacher is working on, so a report needs no explanation. */
export function setReportContext(context: ReportContext) {
  current = context;
}

const recent: string[] = [];
const remember = (text: string) => {
  const line = `${new Date().toLocaleTimeString('tr')} · ${text}`.replace(/\s+/g, ' ').slice(0, 300);
  if (recent[recent.length - 1] !== line) recent.push(line);
  if (recent.length > 8) recent.shift();
};

let installed = false;
/** Keeps the last few page errors in memory (never sent unless the teacher sends a report). */
export function installErrorBuffer() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', e => remember(e.message || 'Bilinmeyen hata'));
  window.addEventListener('unhandledrejection', e => remember(String((e.reason as any)?.message || e.reason || 'İşlenmemiş hata')));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    remember(args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : '')).filter(Boolean).join(' '));
    original(...args);
  };
}

export function collectContext(doc: Pick<Document, 'querySelectorAll'> = document): FeedbackContext {
  const { snapshot: _snapshot, ...page } = current;
  const shownErrors = Array.from(doc.querySelectorAll('[role="alert"]'))
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 5)
    .map(text => text.slice(0, 300));
  return {
    ...page,
    url: location.pathname + location.search,
    at: new Date().toISOString(),
    browser: navigator.userAgent.slice(0, 200),
    screen: `${window.innerWidth}×${window.innerHeight}`,
    shownErrors,
    recentErrors: [...recent],
  };
}

/** Plain text of a report, for the e-mail fallback and the admin list. */
export function describeReport(message: string, context: FeedbackContext, sender?: string): string {
  const lines = [
    context.reason && `Sorun: ${context.reason}`,
    message.trim() || '(Açıklama yazılmadı)',
    '',
    sender && `Gönderen: ${sender}`,
    context.page && `Sayfa: ${context.page}`,
    context.projectTitle && `Soru: ${context.projectTitle}${context.step ? ` · ${context.step} adımı` : ''}`,
    `Zaman: ${new Date(context.at).toLocaleString('tr')}`,
    context.shownErrors.length && `Ekrandaki uyarılar:\n- ${context.shownErrors.join('\n- ')}`,
    context.recentErrors.length && `Son hatalar:\n- ${context.recentErrors.join('\n- ')}`,
    `Tarayıcı: ${context.browser} · ${context.screen}`,
  ];
  return lines.filter((line): line is string => typeof line === 'string').join('\n');
}

export type SendResult = { sent: true } | { sent: false; reason: string; mailto: string };

/** The open question's teşhis record, or undefined when no question is open or it cannot be read. */
export function currentSnapshot(): unknown {
  try { return current.snapshot?.(); } catch { return undefined; }
}

/** At most this many screenshots go with one report. */
export const MAX_SCREENSHOTS = 3;
/** A screenshot as stored with a report: a JPEG at most 1600 pixels wide (about 100–250 KB). */
export function shrinkImage(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, 1600 / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .72);
}

/** A picture the teacher chose or pasted, made ready to send. */
export async function screenshotFromFile(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try { return shrinkImage(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
}

/** Whether this browser can take a picture of the page itself (not Safari on iPad). */
export const canCaptureScreen = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

/**
 * One picture of the screen: the browser asks which tab or screen to share (this tab is offered
 * first), one frame is taken and sharing stops at once. Null when the teacher cancels.
 */
export async function captureScreen(): Promise<string | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include' } as DisplayMediaStreamOptions);
  } catch { return null; }
  try {
    const video = document.createElement('video');
    video.muted = true; video.srcObject = stream;
    await video.play();
    // Let the hidden form's last frame pass so the picture shows the page, not the dialog.
    await new Promise(resolve => setTimeout(resolve, 350));
    return shrinkImage(video, video.videoWidth, video.videoHeight);
  } finally {
    stream.getTracks().forEach(track => track.stop());
  }
}

/** Only pictures the studio itself made are shown back (never another kind of data link). */
export const isScreenshot = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);

export async function sendFeedback(message: string, context: FeedbackContext, sender?: string, diagnostics?: unknown, screenshots: string[] = []): Promise<SendResult> {
  const mailto = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent('Soru Stüdyosu · Sorun bildirimi')}&body=${encodeURIComponent(describeReport(message, context, sender).slice(0, 1800))}`;
  if (!supabase) return { sent: false, reason: 'Bağlantı kurulamadı.', mailto };
  try {
    const pictures = screenshots.filter(isScreenshot).slice(0, MAX_SCREENSHOTS);
    const row = { message: message.trim().slice(0, 2000), context: { ...context, hasDiagnostics: diagnostics != null, ...(pictures.length ? { screenshotCount: pictures.length } : {}) } };
    const full: Record<string, unknown> = { ...row, ...(diagnostics != null ? { diagnostics } : {}), ...(pictures.length ? { screenshots: pictures } : {}) };
    let { error } = await supabase.from('feedback').insert(full);
    // The teşhis and screenshot columns come with later database updates; until then the report goes without them.
    if (error && (diagnostics != null || pictures.length) && /diagnostics|screenshots/i.test(error.message)) {
      const { screenshots: _pictures, ...withoutPictures } = full;
      ({ error } = await supabase.from('feedback').insert({ ...withoutPictures, context: { ...row.context, screenshotCount: undefined } }));
      if (error && diagnostics != null && /diagnostics/i.test(error.message)) ({ error } = await supabase.from('feedback').insert({ ...row, context: { ...context, screenshotCount: undefined } }));
    }
    if (!error) return { sent: true };
    return { sent: false, reason: /çok fazla/i.test(error.message) ? error.message : 'Bildirim kaydedilemedi.', mailto };
  } catch {
    return { sent: false, reason: 'Bildirim gönderilemedi.', mailto };
  }
}
