import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowCounterClockwise, ArrowRight, Plus, Trash } from '@phosphor-icons/react';
import { useConfirm } from '../components/common/ConfirmDialog';
import type { LeaveGuard } from '../layouts/AppLayout';
import { pageHash, parseHash } from '../layouts/route';
import { LessonEditor } from '../features/lessons/LessonEditor';
import { lessonRepository, type LessonSummary } from '../features/lessons/lessonRepository';
import { clock, type Lesson } from '../features/lessons/lessonPlan';
import { plainMessage } from '../services/plainError';
import { TRASH_DAYS, trashDaysLeft, trashExpired } from '../features/projects/trash';

/**
 * "Konu Anlatımı": the teacher's slide lessons. Opening one shows its editor on this page;
 * the address names the open lesson, so a reload keeps it open.
 */
export function LessonsPage({ registerLeaveGuard }: { registerLeaveGuard?: (guard: LeaveGuard | null) => void }) {
  const confirm = useConfirm();
  const [list, setList] = useState<LessonSummary[] | null>(null);
  const [listError, setListError] = useState('');
  const [open, setOpen] = useState<Lesson | null>(null);
  const [opening, setOpening] = useState(() => parseHash(window.location.hash).lessonId || '');
  const [creating, setCreating] = useState(false);

  const [view, setView] = useState<'list' | 'trash'>('list');
  const [busy, setBusy] = useState('');

  // Lessons that spent their 30 days in the recycle bin are deleted for good, as questions are.
  const load = useCallback(() => {
    setListError('');
    lessonRepository.list().then(async all => {
      const expired = all.filter(l => trashExpired(l.deletedAt));
      await Promise.all(expired.map(l => lessonRepository.delete(l.id).catch(() => undefined)));
      setList(all.filter(l => !expired.includes(l)));
    }, e => setListError(plainMessage(e, 'Konu anlatımları yüklenemedi.')));
  }, []);
  useEffect(load, [load]);

  const show = (lesson: Lesson | null) => {
    setOpen(lesson);
    const hash = pageHash('lessons', lesson?.id);
    if (window.location.hash !== hash) window.history.replaceState({ ...(window.history.state || {}), studioPage: 'lessons' }, '', hash);
  };

  // A lesson named in the address opens once; a missing one falls back to the list.
  useEffect(() => {
    if (!opening) return;
    let alive = true;
    lessonRepository.get(opening).then(lesson => {
      if (!alive) return;
      if (!lesson) toast.error('Bu konu anlatımı bulunamadı.');
      show(lesson);
    }, e => { if (alive) toast.error(plainMessage(e, 'Konu anlatımı açılamadı.')); }).finally(() => { if (alive) setOpening(''); });
    return () => { alive = false; };
  }, [opening]);

  const create = async () => {
    setCreating(true);
    try {
      show(await lessonRepository.create(''));
    } catch (e) {
      toast.error(plainMessage(e, 'Konu anlatımı oluşturulamadı.'));
    } finally {
      setCreating(false);
    }
  };

  const name = (item: LessonSummary) => item.title || 'Adsız konu anlatımı';
  const act = async (item: LessonSummary, run: () => Promise<unknown>, failed: string) => {
    setBusy(item.id);
    try { await run(); load(); } catch (e) { toast.error(plainMessage(e, failed)); } finally { setBusy(''); }
  };
  const toTrash = (item: LessonSummary) => act(item, () => lessonRepository.setDeleted(item.id, new Date().toISOString()), 'Çöp kutusuna taşınamadı.');
  const restore = (item: LessonSummary) => act(item, () => lessonRepository.setDeleted(item.id, null), 'Geri alınamadı.');
  const remove = async (item: LessonSummary) => {
    if (!await confirm({
      title: `“${name(item)}” kalıcı olarak silinsin mi?`,
      message: 'Slaytlar, metinler ve sesler kalıcı olarak silinir. Bu işlem geri alınamaz.',
      confirmLabel: 'Kalıcı olarak sil', danger: true,
    })) return;
    await act(item, () => lessonRepository.delete(item.id), 'Silinemedi.');
  };

  if (open) return <LessonEditor key={open.id} initial={open} registerLeaveGuard={registerLeaveGuard} onBack={() => { show(null); load(); }} />;
  if (opening) return <p className="p-8 text-sm text-[#787670]" role="status">Konu anlatımı açılıyor…</p>;

  const lessons = list?.filter(l => !l.deletedAt) ?? [];
  const trash = list?.filter(l => l.deletedAt) ?? [];
  const rows = view === 'list' ? lessons : trash;
  const stage = (item: LessonSummary) => !item.slideCount ? 'Slayt bekliyor'
    : item.voiced < item.slideCount ? `Ses: ${item.voiced}/${item.slideCount} slayt` : 'Video hazır';
  return (
    <section className="studio-library">
      <header className="library-heading">
        <div>
          <h2>Konu Anlatımı</h2>
          <p>Sunumunuzu PDF ya da resim olarak yükleyin, her slayta ne anlatacağınızı yazıp sesini oluşturun. Hepsi hazır olunca slaytlar sesiyle birlikte tek bir video olarak iner.</p>
        </div>
        <button className="studio-primary" onClick={() => void create()} disabled={creating}>
          <Plus size={18} />
          Yeni konu anlatımı
        </button>
      </header>
      <div role="tablist" aria-label="Konu anlatımı listesi" className="library-tabs">
        <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>Konu anlatımlarım ({lessons.length})</button>
        <button role="tab" aria-selected={view === 'trash'} onClick={() => setView('trash')}>
          <Trash size={18} /> Çöp kutusu ({trash.length})
        </button>
      </div>
      {view === 'trash' && (
        <p className="trash-note">
          Silinen konu anlatımları burada {TRASH_DAYS} gün bekler, sonra kendiliğinden kalıcı olarak silinir. Yanlışlıkla sildiğinizi “Geri al” ile listenize döndürebilirsiniz.
        </p>
      )}
      {listError && <p role="alert" className="save-alert">{listError} <button type="button" onClick={load} className="underline">Yeniden dene</button></p>}
      <div className="library-count" role="status">
        <span>{!list && !listError ? 'Konu anlatımları yükleniyor…' : `${rows.length} konu anlatımı`}</span>
      </div>
      {list && !rows.length && view === 'trash' && (
        <div className="library-empty">
          <h3>Çöp kutusu boş</h3>
          <p>Sildiğiniz konu anlatımları {TRASH_DAYS} gün boyunca burada bekler.</p>
        </div>
      )}
      {list && !rows.length && view === 'list' && (
        <div className="library-empty">
          <h3>İlk konu anlatımı videonuzu hazırlayın</h3>
          <p>Sunumunuzun PDF’iyle başlayın. Metin, ses ve işaretleri slayt slayt tamamlarsınız.</p>
          <button className="studio-primary" onClick={() => void create()} disabled={creating}>Konu anlatımı ekle</button>
        </div>
      )}
      <div>
        {rows.map(item => (
          <article key={item.id} className="question-row">
            <button className="question-open" disabled={!!busy || view === 'trash'} onClick={() => setOpening(item.id)}>
              {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" crossOrigin="anonymous" /> : <span className="empty-thumbnail">Slayt yok</span>}
              <span>
                <strong>{name(item)}</strong>
                <small>{item.slideCount} slayt · {clock(item.duration)} · {new Date(item.updatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</small>
              </span>
            </button>
            {view === 'trash' ? (
              <>
                <span className="project-stage">{trashDaysLeft(item.deletedAt!) ? `${trashDaysLeft(item.deletedAt!)} gün sonra silinecek` : 'Bugün silinecek'}</span>
                <div className="row-actions">
                  <button className="studio-secondary" disabled={!!busy} onClick={() => void restore(item)}>
                    <ArrowCounterClockwise size={16} /> Geri al
                  </button>
                  <button disabled={!!busy} aria-label={`${name(item)}: kalıcı olarak sil`} title="Kalıcı olarak sil" onClick={() => void remove(item)}>
                    <Trash size={19} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className={`project-stage ${item.slideCount && item.voiced === item.slideCount ? 'is-done' : ''}`}>{stage(item)}</span>
                <div className="row-actions">
                  <button disabled={!!busy} aria-label={`${name(item)}: çöp kutusuna taşı`} title="Çöp kutusuna taşı" onClick={() => void toTrash(item)}>
                    <Trash size={19} />
                  </button>
                  <button className="studio-secondary" disabled={!!busy} onClick={() => setOpening(item.id)}>
                    Devam et
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
