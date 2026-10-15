import type { AppPage } from '../components/common/AppSidebar';

/** Readable addresses for the studio's pages, so a reload or a bookmark returns to the same place. */
const PATHS: Record<Exclude<AppPage, 'editor'>, string> = {
  dashboard: '', questions: 'sorular', batch: 'toplu', lessons: 'konu', settings: 'ayarlar', admin: 'yonetim', help: 'yardim', news: 'yenilikler', tools: 'araclar',
};

/** The address of a page; the editor's address names its question, the help page its topic, Konu Anlatımı its open lesson. */
export function pageHash(page: AppPage, id?: string | null): string {
  if (page === 'editor') return id ? `#/soru/${encodeURIComponent(id)}` : '#/soru';
  if (page === 'lessons' && id) return `#/konu/${encodeURIComponent(id)}`;
  if (page === 'help' && id) return `#/yardim/${encodeURIComponent(id)}`;
  return `#/${PATHS[page]}`;
}

/** The page (and question) an address points to; unknown addresses open the dashboard. */
export function parseHash(hash: string): { page: AppPage; projectId?: string; topic?: string; lessonId?: string } {
  const path = hash.replace(/^#\/?/, '').split(/[?&]/)[0];
  const [first, second] = path.split('/');
  if (first === 'soru') return { page: 'editor', ...(second ? { projectId: decodeURIComponent(second) } : {}) };
  if (first === 'yardim' && second) return { page: 'help', topic: decodeURIComponent(second) };
  if (first === 'konu' && second) return { page: 'lessons', lessonId: decodeURIComponent(second) };
  const page = (Object.keys(PATHS) as Array<keyof typeof PATHS>).find(key => PATHS[key] === first);
  return { page: page ?? 'dashboard' };
}
