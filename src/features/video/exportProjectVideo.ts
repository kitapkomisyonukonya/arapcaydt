import type { QuestionProject } from '../../types';
import { freshAssetUrl } from '../projects/cloudProjectRepository';
import { videoExporter } from './engine/exporter';
import { outroSeconds, renderQuestionVideoFrame } from './engine/renderer';

/** Renders one project to a 1080p MP4 in this browser (single editor download and batch queue share it). */
export async function exportProjectVideo(project: QuestionProject, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<Blob> {
  const storedAudio = project.narrationSource?.audioUrl || project.audioNarration?.audioUrl || '';
  // A question video always has narration; never produce a silent file without saying so.
  if (!storedAudio) throw new Error('Bu sorunun sesi bulunamadı. Ses adımında sesi yeniden oluşturun ya da MP3 yükleyin.');
  // Stored files are read through new links: the editor's links expire after six hours of work.
  const [audioUrl, imageUrl] = await Promise.all([freshAssetUrl(storedAudio), freshAssetUrl(project.imageUrl)]);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Soru görseli yüklenemedi.'));
    img.src = imageUrl;
  });

  const duration = project.narrationSource?.duration || project.audioNarration?.duration || 15;
  const config = project.videoConfig;
  return videoExporter.exportVideo(
    (ctx, time) => {
      renderQuestionVideoFrame(ctx, ctx.canvas.width, ctx.canvas.height, img, config.regions, config.timelineActions, time, {
        width: 1920,
        height: 1080,
        aspectRatio: config.aspectRatio || '16:9',
        showWatermark: config.showWatermark,
        teacherTag: config.teacherTag || 'Arapça YDT • Video Stüdyosu',
        captions: config.captions,
        showCaptions: config.showCaptions,
        captionY: config.captionY,
        underlineOffset: config.underlineOffset,
        imageScale: config.imageScale,
        showOutro: config.showOutro,
        duration,
      });
    },
    audioUrl,
    duration + outroSeconds(config.timelineActions, config.showOutro !== false),
    { resolution: '1080p', fps: 30, format: 'mp4', aspectRatio: (config.aspectRatio || '16:9') as '16:9' | '9:16' },
    progress => onProgress(progress.percent),
    signal,
  );
}

export function videoFileName(project: QuestionProject) {
  const cleanTitle = (project.title || 'ydt_soru_cozumu').replace(/[^a-zA-Z0-9_؀-ۿÀ-ſ-]/g, '_');
  return `${cleanTitle}_1080p.mp4`;
}
