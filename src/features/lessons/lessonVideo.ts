import { NARRATION_RATE, decodeAudio } from '../../services/narration/audioCodec';
import { videoExporter } from '../video/engine/exporter';
import { fitInside, joinVoices, lessonTimeline, slideAt, wavBytes, type Lesson, type LessonTimeline } from './lessonPlan';

/** The lesson's sound as one track (a WAV link in this browser) and where each slide speaks. */
export async function lessonTrack(lesson: Lesson, signal?: AbortSignal): Promise<{ url: string; timeline: LessonTimeline }> {
  const missing = lesson.slides.findIndex(s => !s.audio?.url);
  if (missing >= 0) throw new Error(`${missing + 1}. slaytın sesi yok. Önce her slaytın sesini oluşturun ya da MP3 yükleyin.`);
  const voices: Float32Array[] = [];
  for (const [i, slide] of lesson.slides.entries()) {
    if (signal?.aborted) throw new DOMException('İptal edildi.', 'AbortError');
    try { voices.push(await decodeAudio(slide.audio!.url!)); } catch { throw new Error(`${i + 1}. slaytın sesi okunamadı. Sayfayı yenileyip tekrar deneyin.`); }
  }
  const timeline = lessonTimeline(voices.map(v => v.length / NARRATION_RATE));
  const wav = wavBytes(joinVoices(voices, NARRATION_RATE), NARRATION_RATE);
  return { url: URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' })), timeline };
}

/** The slide pictures, loaded so they can be drawn on a canvas. */
export async function loadSlideImages(lesson: Lesson): Promise<HTMLImageElement[]> {
  return Promise.all(lesson.slides.map((slide, i) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${i + 1}. slaytın resmi yüklenemedi. Sayfayı yenileyip tekrar deneyin.`));
    img.src = slide.imageUrl || '';
  })));
}

/** One frame: the slide whole on white; between two slides the next one fades in. */
export function drawLessonFrame(ctx: CanvasRenderingContext2D, width: number, height: number, images: HTMLImageElement[], timeline: LessonTimeline, time: number) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  if (!images.length) return;
  const { index, next, mix } = slideAt(timeline, time);
  const draw = (img: HTMLImageElement, alpha: number) => {
    const box = fitInside(img.naturalWidth || 16, img.naturalHeight || 9, width, height);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, box.x, box.y, box.width, box.height);
  };
  draw(images[index], 1);
  if (next !== undefined && mix > 0) draw(images[next], mix);
  ctx.globalAlpha = 1;
}

/** The whole lesson as a 1080p MP4, made in this browser like the question videos. */
export async function exportLessonVideo(lesson: Lesson, onProgress: (percent: number, message: string) => void, signal?: AbortSignal): Promise<Blob> {
  onProgress(1, 'Sesler birleştiriliyor…');
  const [images, track] = await Promise.all([loadSlideImages(lesson), lessonTrack(lesson, signal)]);
  try {
    return await videoExporter.exportVideo(
      (ctx, time) => drawLessonFrame(ctx, ctx.canvas.width, ctx.canvas.height, images, track.timeline, time),
      track.url, track.timeline.total,
      { resolution: '1080p', fps: 30, format: 'mp4', aspectRatio: '16:9' },
      progress => onProgress(progress.percent, progress.message || ''),
      signal,
    );
  } finally {
    URL.revokeObjectURL(track.url);
  }
}
