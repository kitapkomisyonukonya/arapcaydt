import type { AppPage } from '../components/common/AppSidebar';

/** One short name per page: the sidebar, the top bar and the page heading all use it. */
export const PAGE_LABELS: Record<AppPage, string> = {
  admin: 'Yönetim', dashboard: 'Kontrol Paneli', questions: 'Sorularım', editor: 'Editör', batch: 'Toplu Üretim', lessons: 'Konu Anlatımı', settings: 'Ayarlar', help: 'Yardım ve rehber', news: 'Yenilikler', tools: 'Hazırlık Araçları',
};
