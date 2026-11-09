import { STUDIO_TRANSCRIBE_DAILY, SectionTitle, Stat, card } from './adminShared';
import type { AdminCtx } from './adminShared';
import { FeedbackSection } from './FeedbackSection';
import { UserPlus } from '@phosphor-icons/react';

export function OverviewTab({ ctx }: { ctx: AdminCtx }) {
  const { busy, open, who, members, pending, change, analytics, requests, activeKeys, totalVideoReady, voice, setTab, issuesList } = ctx;
  return (
      <div className="space-y-6">
        <FeedbackSection who={who} onOpen={id => void open(id)} />
        {pending.length > 0 && (
          <section className="rounded-xl border border-[#E5D7B0] bg-[#FFF8E6] p-5">
            <SectionTitle title={`Onay bekleyen hesaplar (${pending.length})`} note="E-postasını doğrulamış ve onayınızı bekleyen öğretmenler." />
            <ul className="space-y-2">
              {pending.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white border px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <UserPlus size={20} className="text-[#78540E] shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{m.name}</p>
                      <p className="text-xs text-[#787670] truncate">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={busy} className="studio-primary !min-h-0 !py-2" onClick={() => void change(m, 'approved')}>
                      Onayla
                    </button>
                    <button disabled={busy} className="studio-secondary !min-h-0 !py-2" onClick={() => void change(m, 'blocked')}>
                      Reddet
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Onaylı öğretmen" value={members.filter((m) => m.status === 'approved' && m.role === 'teacher').length}
            hint={`${activeKeys} kişi kendi Google anahtarını bağladı`} />
          <Stat label="Soru" value={analytics?.totalProjects ?? members.reduce((s, m) => s + m.questions, 0)}
            hint={`${analytics?.funnel.withAudio ?? 0} tanesi seslendirildi`} />
          <Stat label="Video hazır" value={totalVideoReady} tone="text-[#8B1E2D]"
            hint={`${members.reduce((s, m) => s + m.exports, 0)} MP4 indirildi`} />
          <Stat label="Tamamlandı" value={analytics?.funnel.completed ?? 0} tone="text-[#1E562A]"
            hint={analytics ? `Bekleyenler: ${analytics.quality.ready} yayına hazır · ${analytics.quality.check} kontrol önerilir · ${analytics.quality.blocked} düzeltme gerekli` : undefined} />
          <Stat label="Konu anlatımı" value={analytics?.lessons?.length ?? '—'}
            hint={analytics?.lessons ? `${analytics.lessons.filter(l => l.slides && l.voiced === l.slides).length} tanesinin bütün slaytları seslendirildi` : undefined} />
        </div>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
          <section className={card}>
            <SectionTitle
              title="Dikkat gerektiren projeler"
              action={analytics && analytics.issues.length > 6 ? (
                <button className="text-sm font-semibold text-[#8B1E2D] hover:underline" onClick={() => setTab('projects')}>Tümü</button>
              ) : undefined}
            />
            {issuesList(6)}
          </section>
          <section className={card}>
            <SectionTitle title="Üretim hunisi" />
            {analytics && (
              <div className="space-y-3">
                {([
                  ['Proje', analytics.funnel.total],
                  ['Sesli', analytics.funnel.withAudio],
                  ['İşaretleri hazır', analytics.funnel.withMarkers],
                  ['Tamamlandı', analytics.funnel.completed ?? 0],
                ] as Array<[string, number]>).map(([label, value]) => (
                  <div key={label}>
                    <div className="flex justify-between text-sm"><span className="text-[#55544F]">{label}</span><strong className="tabular-nums">{value}</strong></div>
                    <div className="h-2 rounded-full bg-[#F2F1EB] mt-1 overflow-hidden">
                      <div className="h-full bg-[#8B1E2D]" style={{ width: `${analytics.funnel.total ? (value / analytics.funnel.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {requests && !requests.migrationPending && (
              <div className="mt-5 pt-4 border-t text-sm space-y-1.5">
                <div className="flex justify-between"><span className="text-[#55544F]">Ortak anahtar · bugünkü zamanlama</span>
                  <strong className={`tabular-nums ${requests.studio?.transcribeExhausted ? 'text-red-700' : ''}`}>{requests.studio?.transcribeUsed ?? 0} / ~{STUDIO_TRANSCRIBE_DAILY}</strong></div>
                <div className="flex justify-between" title="Ayda ilk 1000 okuma ücretsiz; sınıra gelince tarayıcıdaki okuyucu kullanılır. Hoca başına günde 30 okuma.">
                  <span className="text-[#55544F]">Google Vision · bu ay</span>
                  <strong className="tabular-nums">{!analytics?.vision?.configured ? 'kapalı' : analytics.vision.month == null ? '—' : `${analytics.vision.month} / ${analytics.vision.limit}`}</strong></div>
                <div className="flex justify-between"><span className="text-[#55544F]">ElevenLabs yedek kotası</span>
                  <strong className="tabular-nums">{voice?.remainingCharacters != null ? `${voice.remainingCharacters.toLocaleString('tr')} karakter` : '—'}</strong></div>
              </div>
            )}
          </section>
        </div>

        {analytics?.week && (
          <section className={card}>
            <SectionTitle title="Bu hafta" note="Son 7 gün, öğretmen başına: bitirilen sorular, üzerinde çalışılan sorular ve bunların nerede beklediği. Tarayıcı hatası: İşaretler veya MP4 sırasında çıkan hata." />
            {Object.keys(analytics.week).length === 0 ? (
              <p className="text-sm text-[#787670]">Bu hafta çalışılan soru yok.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-[#666560]">
                    <tr>{['Öğretmen', 'Bitirdi', 'Çalıştı', 'Ses bekliyor', 'İşaret bekliyor', 'Düzeltme gerekli', 'Tarayıcı hatası'].map(t => (
                      <th key={t} className="px-2 py-2 font-semibold whitespace-nowrap">{t}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEFEA]">
                    {Object.entries(analytics.week)
                      .sort(([, a], [, b]) => (b.completed + b.working) - (a.completed + a.working))
                      .map(([id, w]) => (
                        <tr key={id} className="tabular-nums">
                          <td className="px-2 py-2 font-semibold whitespace-nowrap">{who(id)}</td>
                          <td className="px-2 py-2 font-bold text-[#166534]">{w.completed}</td>
                          <td className="px-2 py-2">{w.working}</td>
                          <td className={`px-2 py-2 ${w.needsVoice ? 'text-[#B45309] font-semibold' : 'text-[#A8A69E]'}`}>{w.needsVoice}</td>
                          <td className={`px-2 py-2 ${w.needsMarks ? 'text-[#B45309] font-semibold' : 'text-[#A8A69E]'}`}>{w.needsMarks}</td>
                          <td className={`px-2 py-2 ${w.needsFix ? 'text-red-700 font-semibold' : 'text-[#A8A69E]'}`}>{w.needsFix}</td>
                          <td className={`px-2 py-2 ${w.errors ? 'text-red-700 font-semibold' : 'text-[#A8A69E]'}`}>{w.errors}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
  );
}
