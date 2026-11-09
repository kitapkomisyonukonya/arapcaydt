import type { QuestionProject } from '../../types';
import { freshAssetUrl } from '../projects/cloudProjectRepository';
import { lessonRepository } from './lessonRepository';
import type { LessonSlide } from './lessonPlan';
import { readPictureLines } from './pdfSlides';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav' };

/** A stored file copied into the lesson's own folder (deleting the question later deletes its folder). */
async function copied(lessonId: string, url: string): Promise<{ path: string; url: string }> {
  const link = await freshAssetUrl(url);
  const response = await fetch(link);
  if (!response.ok) throw new Error('Sorunun dosyası okunamadı.');
  const blob = await response.blob();
  // Storage takes only pictures and sounds it knows; the stored name's ending tells which when the answer does not.
  const type = Object.values(TYPES).includes(blob.type) ? blob.type : TYPES[new URL(link, location.href).pathname.split('.').pop()?.toLowerCase() || ''];
  if (!type) throw new Error('Sorunun dosyası tanınmadı.');
  const local = URL.createObjectURL(new Blob([blob], { type }));
  try {
    return await lessonRepository.storeFile(lessonId, local);
  } finally {
    URL.revokeObjectURL(local);
  }
}

const sizeOf = (url: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
  img.onerror = () => reject(new Error('Sorunun resmi açılamadı.'));
  img.src = url;
});

/**
 * A slide lesson made in the question studio by mistake, as a Konu Anlatımı: the picture becomes its
 * one slide, the solution text the slide's text, and a voice already made comes along (no new voice
 * is spent). The question itself stays as it was. Returns the new lesson's id.
 */
export async function lessonFromQuestion(project: QuestionProject): Promise<string> {
  if (!project.imageUrl) throw new Error('Önce slaytın resmini yükleyin.');
  const lesson = await lessonRepository.create(project.topic?.trim() || '');
  const picture = await copied(lesson.id, project.imageUrl);
  const size = project.imageDimensions?.width ? project.imageDimensions : await sizeOf(picture.url);
  const lines = await readPictureLines(picture.url, size.width, size.height);
  const voice = project.narrationSource;
  const text = project.solutionText.trim();
  const slide: LessonSlide = {
    id: crypto.randomUUID(), imagePath: picture.path, imageUrl: picture.url, width: size.width, height: size.height, text,
    ...(lines ? { lines } : {}),
  };
  if (voice?.audioUrl && voice.duration > 0) {
    const audio = await copied(lesson.id, voice.audioUrl);
    slide.audio = {
      path: audio.path, url: audio.url, duration: voice.duration, spokenText: (voice.spokenText ?? text).trim(),
      source: voice.type === 'gemini' ? 'gemini' : 'upload', ...(voice.fileName ? { fileName: voice.fileName } : {}),
    };
  }
  await lessonRepository.save({ ...lesson, slides: [slide] });
  return lesson.id;
}
