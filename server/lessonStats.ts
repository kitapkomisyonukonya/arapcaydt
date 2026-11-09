/** A Konu Anlatımı as the Yönetim page lists it: who, what, how far (no slide texts or pictures). */
export interface LessonStat {
  id: string; ownerId: string; title: string; updatedAt: string;
  slides: number; voiced: number; duration: number;
}

/** Rows of the projects table with `kind: 'lesson'`; the recycle bin is left out. */
export function lessonStats(rows: Array<{ id: string; owner_id: string; updated_at: string; title?: unknown; deletedAt?: unknown; slides?: unknown }>): LessonStat[] {
  return rows.filter(r => !r.deletedAt).map(r => {
    const slides = Array.isArray(r.slides) ? r.slides : [];
    const voiced = slides.filter((s: any) => s?.audio?.path);
    return {
      id: r.id, ownerId: r.owner_id, updatedAt: r.updated_at,
      title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : 'Adsız konu anlatımı',
      slides: slides.length, voiced: voiced.length,
      duration: Math.round(voiced.reduce((sum: number, s: any) => sum + (Number(s.audio.duration) || 0), 0)),
    };
  });
}
