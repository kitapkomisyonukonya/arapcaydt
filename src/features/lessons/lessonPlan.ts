import type { MarkFixes, SlideLine } from './slideMarks';

/**
 * "Konu Anlatımı": a teacher's slides (from a PDF or pictures), each with its own spoken text and
 * voice, played one after another as a single video. Slides from a PDF get marks while they are
 * explained (slideMarks.ts). Stored as a row of the projects table with `kind: 'lesson'` (question
 * lists leave these out).
 */

export interface LessonAudio {
  /** Storage path of the voice file; `url` is its playback link (not stored). */
  path: string;
  url?: string;
  duration: number;
  /** The text the voice was made from: when the slide's text changes after that, the voice is old. */
  spokenText: string;
  source: 'gemini' | 'upload';
  fileName?: string;
}

export interface LessonSlide {
  id: string;
  /** Storage path of the slide picture; `imageUrl` is its playback link (not stored). */
  imagePath: string;
  imageUrl?: string;
  width: number;
  height: number;
  text: string;
  audio?: LessonAudio;
  /** The slide's text lines and where they are, read from the PDF (none for a picture file). */
  lines?: SlideLine[];
  /** Marks the teacher changed by hand. */
  markFixes?: MarkFixes;
}

export interface Lesson {
  id: string;
  kind: 'lesson';
  title: string;
  slides: LessonSlide[];
  /** The teacher turned the marks off: slides stay plain. */
  marksOff?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A slide as the list shows it. */
export type SlideState = 'no-text' | 'no-voice' | 'old-voice' | 'ready';

export function slideState(slide: Pick<LessonSlide, 'text' | 'audio'>): SlideState {
  if (slide.audio) return slide.audio.source === 'gemini' && slide.audio.spokenText.trim() !== slide.text.trim() ? 'old-voice' : 'ready';
  return slide.text.trim() ? 'no-voice' : 'no-text';
}

export const SLIDE_STATE_LABELS: Record<SlideState, string> = {
  'no-text': 'Metin yok', 'no-voice': 'Ses yok', 'old-voice': 'Metin değişti', ready: 'Ses hazır',
};

/** Slides that can still be voiced from their text (no voice yet, or the text changed since). */
export function slidesToVoice(slides: LessonSlide[]): number[] {
  return slides.flatMap((s, i) => {
    const state = slideState(s);
    return state === 'no-voice' || state === 'old-voice' ? [i] : [];
  });
}

/** Files in the order a teacher numbered them: "Slayt2" before "Slayt10". */
export function naturalOrder<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true, sensitivity: 'base' }));
}

/** Seconds of silence before the first slide speaks, between two slides, and after the last one. */
export const LEAD_SECONDS = 0.6;
export const GAP_SECONDS = 1;
export const TAIL_SECONDS = 1.2;
/** The picture changes over this many seconds, in the middle of the pause. */
export const FADE_SECONDS = 0.4;

export interface LessonTimeline {
  /** When each slide's voice starts and ends in the video. */
  spans: Array<{ start: number; end: number }>;
  total: number;
}

export function lessonTimeline(durations: number[]): LessonTimeline {
  const spans: LessonTimeline['spans'] = [];
  let at = LEAD_SECONDS;
  durations.forEach((d, i) => {
    if (i) at += GAP_SECONDS;
    spans.push({ start: at, end: at + Math.max(0, d) });
    at += Math.max(0, d);
  });
  return { spans, total: spans.length ? at + TAIL_SECONDS : 0 };
}

/**
 * Which slide is on screen at `time`: the switch to the next slide happens in the middle of the
 * pause between them; during FADE_SECONDS around it `next` fades in (`mix` 0 → 1).
 */
export function slideAt(timeline: LessonTimeline, time: number): { index: number; next?: number; mix: number } {
  const { spans } = timeline;
  if (!spans.length) return { index: 0, mix: 0 };
  for (let i = 0; i < spans.length - 1; i++) {
    const cut = (spans[i].end + spans[i + 1].start) / 2;
    if (time < cut - FADE_SECONDS / 2) return { index: i, mix: 0 };
    if (time < cut + FADE_SECONDS / 2) return { index: i, next: i + 1, mix: (time - (cut - FADE_SECONDS / 2)) / FADE_SECONDS };
  }
  return { index: spans.length - 1, mix: 0 };
}

/** One sound track: each slide's voice at its place in the timeline, silence in between. */
export function joinVoices(voices: Float32Array[], rate: number): Float32Array {
  const timeline = lessonTimeline(voices.map(v => v.length / rate));
  const out = new Float32Array(Math.ceil(timeline.total * rate));
  voices.forEach((v, i) => out.set(v, Math.round(timeline.spans[i].start * rate)));
  return out;
}

/** 16-bit mono WAV of the samples (the video encoder reads it; nothing is stored). */
export function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return bytes;
}

/** Where a picture of this size sits on the video frame: whole, centered, as large as fits. */
export function fitInside(width: number, height: number, frameWidth: number, frameHeight: number) {
  const scale = Math.min(frameWidth / width, frameHeight / height);
  const w = width * scale, h = height * scale;
  return { x: (frameWidth - w) / 2, y: (frameHeight - h) / 2, width: w, height: h };
}

/** The stored form: playback links are left out (they expire). */
export function storedLesson(lesson: Lesson) {
  return {
    kind: 'lesson' as const,
    title: lesson.title,
    ...(lesson.marksOff ? { marksOff: true } : {}),
    slides: lesson.slides.map(({ imageUrl, audio, ...slide }) => ({
      ...slide,
      ...(audio ? { audio: (({ url, ...a }) => a)(audio) } : {}),
    })),
  };
}

/** "6:05" */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function lessonFileName(title: string) {
  const clean = (title.trim() || 'konu_anlatimi').replace(/[^a-zA-Z0-9_؀-ۿÀ-ſ-]/g, '_');
  return `${clean}_1080p.mp4`;
}
