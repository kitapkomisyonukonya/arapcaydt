import { database } from '../../services/supabase';
import { CloudProjectRepository, ownerId, signedLinks, uploadAsset } from '../projects/cloudProjectRepository';
import { storedLesson, type Lesson, type LessonSlide } from './lessonPlan';
import { sceneFromOldMarks, type OldHandMark } from './slideScene';

/** A lesson in the list: no playback links except the first slide's picture. */
export interface LessonSummary {
  id: string;
  title: string;
  updatedAt: string;
  slideCount: number;
  voiced: number;
  duration: number;
  thumbnail: string;
}

/** A slide saved with the hand marks of 17 October gets them as the question editor's marks. */
function upgraded(slide: LessonSlide & { marks?: OldHandMark[] }): LessonSlide {
  const { marks, ...rest } = slide;
  if (!Array.isArray(marks) || rest.scene) return rest;
  return { ...rest, scene: sceneFromOldMarks(rest.lines, marks, rest.audio?.duration || 0) };
}

function fromRow(row: any): Lesson {
  const data = row.data || {};
  return {
    id: row.id, kind: 'lesson', title: data.title || '',
    slides: Array.isArray(data.slides) ? data.slides.map(upgraded) : [],
    ...(data.marksOff === true ? { marksOff: true } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Playback links for every slide picture and voice, in one request. */
async function withLinks(lesson: Lesson): Promise<Lesson> {
  const paths = lesson.slides.flatMap(s => [s.imagePath, s.audio?.path].filter((p): p is string => !!p));
  const links = await signedLinks([...new Set(paths)]);
  return {
    ...lesson,
    slides: lesson.slides.map(s => ({
      ...s, imageUrl: links.get(s.imagePath) || '',
      ...(s.audio ? { audio: { ...s.audio, url: links.get(s.audio.path) || '' } } : {}),
    })),
  };
}

/** Konu Anlatımları live in the projects table (`kind: 'lesson'`), so files, quotas and voices work as for questions. */
export const lessonRepository = {
  async list(): Promise<LessonSummary[]> {
    const owner = await ownerId();
    const { data, error } = await database().from('projects').select('id,updated_at,data').eq('owner_id', owner)
      .eq('data->>kind', 'lesson').order('updated_at', { ascending: false }).limit(500);
    if (error) throw error;
    const lessons = (data || []).map(fromRow);
    const thumbs = await signedLinks(lessons.map(l => l.slides[0]?.imagePath).filter((p): p is string => !!p));
    return lessons.map(l => ({
      id: l.id, title: l.title, updatedAt: l.updatedAt, slideCount: l.slides.length,
      voiced: l.slides.filter(s => s.audio).length,
      duration: l.slides.reduce((sum, s) => sum + (s.audio?.duration || 0), 0),
      thumbnail: (l.slides[0] && thumbs.get(l.slides[0].imagePath)) || '',
    }));
  },

  async get(id: string): Promise<Lesson | null> {
    const owner = await ownerId();
    const { data, error } = await database().from('projects').select('id,created_at,updated_at,data').eq('id', id).eq('owner_id', owner).maybeSingle();
    if (error) throw error;
    return data && data.data?.kind === 'lesson' ? withLinks(fromRow(data)) : null;
  },

  async create(title: string): Promise<Lesson> {
    const owner = await ownerId();
    const lesson: Lesson = { id: crypto.randomUUID(), kind: 'lesson', title, slides: [], createdAt: '', updatedAt: '' };
    const { data, error } = await database().from('projects').insert({ id: lesson.id, owner_id: owner, data: storedLesson(lesson) })
      .select('id,created_at,updated_at,data').single();
    if (error) throw error;
    return fromRow(data);
  },

  /** Saves the text, order and file paths (files are stored when they are added). Returns the new change time. */
  async save(lesson: Lesson): Promise<string> {
    const owner = await ownerId();
    const { data, error } = await database().from('projects').update({ data: storedLesson(lesson) })
      .eq('id', lesson.id).eq('owner_id', owner).select('updated_at').single();
    if (error) throw error;
    return data.updated_at;
  },

  /** Stores a picture or sound (a data: or blob: link) in the lesson's folder: its path and a playback link. */
  async storeFile(lessonId: string, url: string): Promise<{ path: string; url: string }> {
    const owner = await ownerId();
    const stored = await uploadAsset(url, owner, lessonId);
    const path = typeof stored === 'string' ? '' : stored.assetPath;
    if (!path) throw new Error('Dosya kaydedilemedi.');
    const link = (await signedLinks([path])).get(path);
    if (!link) throw new Error('Dosya bağlantısı alınamadı.');
    return { path, url: link };
  },

  /** Removes the lesson and its files for good. */
  delete: (id: string) => new CloudProjectRepository().delete(id),
};

export type { Lesson, LessonSlide };
