import { NARRATION_RATE, decodeAudio } from '../../services/narration/audioCodec';
import { videoExporter } from '../video/engine/exporter';
import { fitInside, joinVoices, lessonTimeline, slideAt, wavBytes, type Lesson, type LessonTimeline } from './lessonPlan';
import { deckWords, drawSlideMarks, handTimedMarks, timedMarks, voicePauses, type Pause, type SlideBlock, type TimedMark } from './slideMarks';

/** Each slide's marks, timed inside its own voice (none when the teacher turned them off). */
export type LessonMarks = Array<{ blocks: SlideBlock[]; marks: TimedMark[] }>;
export function lessonMarks(lesson: Lesson, timeline: LessonTimeline, pauses?: Pause[][]): LessonMarks {
  if (lesson.marksOff) return lesson.slides.map(() => ({ blocks: [], marks: [] }));
  const deck = deckWords(lesson.slides.map(s => s.lines));
  return lesson.slides.map((slide, i) => {
    const span = timeline.spans[i];
    if (!span) return { blocks: [], marks: [] };
    if (slide.marks) return handTimedMarks(slide.lines, slide.marks);
    return timedMarks(slide.text, slide.lines, slide.markFixes, span.end - span.start, deck, pauses?.[i]);
  });
}

/**
 * The lesson's sound as one track (a WAV link in this browser), where each slide speaks, and the
 * pauses in each slide's voice (the marks follow them).
 */
export async function lessonTrack(lesson: Lesson, signal?: AbortSignal): Promise<{ url: string; timeline: LessonTimeline; pauses: Pause[][] }> {
  const missing = lesson.slides.findIndex(s => !s.audio?.url);
  if (missing >= 0) throw new Error(`${missing + 1}. slaytın sesi yok. Önce her slaytın sesini oluşturun ya da MP3 yükleyin.`);
  const voices: Float32Array[] = [];
  for (const [i, slide] of lesson.slides.entries()) {
    if (signal?.aborted) throw new DOMException('İptal edildi.', 'AbortError');
    try { voices.push(await decodeAudio(slide.audio!.url!)); } catch { throw new Error(`${i + 1}. slaytın sesi okunamadı. Sayfayı yenileyip tekrar deneyin.`); }
  }
  const timeline = lessonTimeline(voices.map(v => v.length / NARRATION_RATE));
  const wav = wavBytes(joinVoices(voices, NARRATION_RATE), NARRATION_RATE);
  return {
    url: URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' })), timeline,
    pauses: voices.map(v => voicePauses(v, NARRATION_RATE)),
  };
}

/**
 * The slide pictures, loaded so they can be drawn on a canvas. Each is fetched afresh (not from the
 * browser cache: the page showed the same picture without CORS, and a cached copy without the CORS
 * header taints the canvas) and drawn from this page's own blob link.
 */
export async function loadSlideImages(lesson: Lesson): Promise<HTMLImageElement[]> {
  return Promise.all(lesson.slides.map((slide, i) => loadSlideImage(slide.imageUrl || '', i + 1)));
}

export async function loadSlideImage(link: string, number: number): Promise<HTMLImageElement> {
  const failed = () => new Error(`${number}. slaytın resmi yüklenemedi. Sayfayı yenileyip tekrar deneyin.`);
  let blob: Blob;
  try {
    const response = await fetch(link, { cache: 'no-store' });
    if (!response.ok) throw failed();
    blob = await response.blob();
  } catch {
    throw failed();
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(failed());
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One frame: the slide whole on white with its marks; between two slides the next one fades in. */
export function drawLessonFrame(ctx: CanvasRenderingContext2D, width: number, height: number, images: HTMLImageElement[], timeline: LessonTimeline, time: number, marks?: LessonMarks) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  if (!images.length) return;
  const { index, next, mix } = slideAt(timeline, time);
  const draw = (i: number, alpha: number) => {
    const img = images[i];
    const box = fitInside(img.naturalWidth || 16, img.naturalHeight || 9, width, height);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, box.x, box.y, box.width, box.height);
    const plan = marks?.[i], span = timeline.spans[i];
    if (plan && span && alpha === 1) drawSlideMarks(ctx, box, plan.blocks, plan.marks, time - span.start);
  };
  draw(index, 1);
  if (next !== undefined && mix > 0) draw(next, mix);
  ctx.globalAlpha = 1;
}

/** The whole lesson as a 1080p MP4, made in this browser like the question videos. */
export async function exportLessonVideo(lesson: Lesson, onProgress: (percent: number, message: string) => void, signal?: AbortSignal): Promise<Blob> {
  onProgress(1, 'Sesler birleştiriliyor…');
  const [images, track] = await Promise.all([loadSlideImages(lesson), lessonTrack(lesson, signal)]);
  const marks = lessonMarks(lesson, track.timeline, track.pauses);
  try {
    return await videoExporter.exportVideo(
      (ctx, time) => drawLessonFrame(ctx, ctx.canvas.width, ctx.canvas.height, images, track.timeline, time, marks),
      track.url, track.timeline.total,
      { resolution: '1080p', fps: 30, format: 'mp4', aspectRatio: '16:9' },
      progress => onProgress(progress.percent, progress.message || ''),
      signal,
    );
  } finally {
    URL.revokeObjectURL(track.url);
  }
}
