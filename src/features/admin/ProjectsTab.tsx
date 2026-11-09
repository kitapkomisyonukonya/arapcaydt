import { SectionTitle, card, sorted } from './adminShared';
import { ProjectsBrowser } from './ProjectsBrowser';
import { ActivityList } from './ActivityList';
import { MarkAccuracy } from './MarkAccuracy';
import { LessonsSection } from './LessonsSection';
import type { AdminCtx } from './adminShared';
import { getCategoryLabel } from '../../config/categories';
import { TOPIC_SUGGESTIONS } from '../../config/topics';

export function ProjectsTab({ ctx }: { ctx: AdminCtx }) {
  const { busy, open, who, members, analytics, data, importLegacy, importMessage, issuesList, projectOwner, showProjects } = ctx;
  return (
      <div className="space-y-6">
        <section className={card}>
          <SectionTitle title="Dikkat gerektiren projeler" note="Gemini'nin kullanılamadığı, kelime zamanı alınamayan veya yayın kontrolünde düzeltme gereken son projeler." />
          {issuesList()}
        </section>

        {analytics?.marks && <MarkAccuracy marks={analytics.marks} />}

        {analytics && (
          <section className={card}>
            <SectionTitle title="Soru tipi dağılımı" note="Tüm öğretmenlerin kaydettiği projeler, soru tipine göre." />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {sorted(analytics.categoryTotals).map(([id, n]) => (
                <div key={id} className="border rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                  <span className="text-sm">{getCategoryLabel(id)}</span>
                  <strong className="tabular-nums">{n}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {analytics?.topicTotals && (() => {
          const totals = analytics.topicTotals;
          const named = Object.entries(totals).filter(([t]) => t).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], 'tr'));
          const missing = TOPIC_SUGGESTIONS.filter(t => !Object.keys(totals).some(k => k.toLocaleLowerCase('tr') === t.toLocaleLowerCase('tr')));
          return (
            <section className={card}>
              <SectionTitle title="Konulara göre sorular" note="Tüm öğretmenlerin sorularında yazılan konu; hangi konudan kaç soru var, kaçının videosu tamamlandı." />
              {named.length ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {named.map(([t, n]) => (
                    <div key={t} className="border rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                      <span className="text-sm min-w-0 truncate" title={t}>{t}</span>
                      <span className="text-sm tabular-nums whitespace-nowrap"><strong>{n.total}</strong> <span className="text-[#787670]">· {n.completed} tamamlandı</span></span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-[#787670]">Henüz konusu yazılmış soru yok.</p>}
              {totals[''] && <p className="text-sm text-[#55544F] mt-3">Konusu yazılmamış: <strong>{totals[''].total}</strong> soru.</p>}
              {missing.length > 0 && (
                <p className="text-sm text-[#55544F] mt-2"><span className="font-semibold">Henüz sorusu olmayan konular:</span> {missing.join(', ')}.</p>
              )}
            </section>
          );
        })()}

        <ProjectsBrowser members={members} who={who} busy={busy} open={open} owner={projectOwner} onOwner={showProjects} />
        <LessonsSection lessons={analytics?.lessons} who={who} />
        <ActivityList who={who} first={data?.activity || []} />

        <details className={`${card} text-sm`}>
          <summary className="cursor-pointer font-semibold text-[#55544F]">Eski tarayıcı kayıtlarım</summary>
          <p className="my-3 text-[#55544F]">
            Önceki sürümde bu tarayıcıya kaydettiğiniz projeleri kendi yönetici hesabınıza aktarın. Daha önce aktarılanlar tekrar eklenmez.
          </p>
          <button disabled={busy} className="studio-secondary" onClick={() => void importLegacy()}>Eski projelerimi aktar</button>
          {importMessage && <p role="status" className="mt-2">{importMessage}</p>}
        </details>
      </div>
  );
}
