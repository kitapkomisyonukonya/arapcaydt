import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PlusCircle, PresentationChart, Trash } from '@phosphor-icons/react';
import { useConfirm } from '../components/common/ConfirmDialog';
import type { LeaveGuard } from '../layouts/AppLayout';
import { pageHash, parseHash } from '../layouts/route';
import { LessonEditor } from '../features/lessons/LessonEditor';
import { lessonRepository, type LessonSummary } from '../features/lessons/lessonRepository';
import { clock, type Lesson } from '../features/lessons/lessonPlan';
import { plainMessage } from '../services/plainError';

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

  const load = useCallback(() => {
    setListError('');
    lessonRepository.list().then(setList, e => setListError(plainMessage(e, 'Konu anlatımları yüklenemedi.')));
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

  const remove = async (item: LessonSummary) => {
    if (!await confirm({
      title: `“${item.title || 'Adsız konu anlatımı'}” silinsin mi?`,
      message: 'Slaytlar, metinler ve sesler kalıcı olarak silinir. Bu işlem geri alınamaz.',
      confirmLabel: 'Kalıcı olarak sil', danger: true,
    })) return;
    try {
      await lessonRepository.delete(item.id);
      setList(l => l?.filter(x => x.id !== item.id) ?? l);
    } catch (e) {
      toast.error(plainMessage(e, 'Silinemedi.'));
    }
  };

  if (open) return <LessonEditor key={open.id} initial={open} registerLeaveGuard={registerLeaveGuard} onBack={() => { show(null); load(); }} />;
  if (opening) return <p className="p-8 text-sm text-[#787670]" role="status">Konu anlatımı açılıyor…</p>;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-2xl">
          <h1 className="text-xl font-bold text-[#1C1917]">Konu Anlatımı</h1>
          <p className="text-sm text-[#55544F]">
            Sunumunuzu PDF olarak yükleyin, her slayta ne anlatacağınızı yazıp sesini oluşturun. Hepsi hazır olunca slaytlar sırayla, sesiyle birlikte tek bir video olarak iner.
          </p>
        </div>
        <button type="button" onClick={() => void create()} disabled={creating}
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-[#8B1E2D] hover:bg-[#721824] text-white text-sm font-semibold disabled:opacity-60">
          <PlusCircle size={18} weight="bold" /> Yeni konu anlatımı
        </button>
      </div>

      {listError && <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{listError} <button type="button" onClick={load} className="underline">Yeniden dene</button></p>}
      {!list && !listError && <p role="status" className="text-sm text-[#787670]">Yükleniyor…</p>}
      {list && !list.length && (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center space-y-2">
          <PresentationChart size={32} className="mx-auto text-[#8B1E2D]" />
          <p className="text-sm text-[#55544F]">Henüz konu anlatımınız yok. <strong>Yeni konu anlatımı</strong> ile başlayın.</p>
        </div>
      )}
      {list && list.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(item => (
            <li key={item.id} className="rounded-xl border bg-white overflow-hidden flex flex-col">
              <button type="button" onClick={() => setOpening(item.id)} className="text-left">
                {item.thumbnail
                  ? <img src={item.thumbnail} alt="" className="w-full aspect-video object-contain bg-[#F5F4F0]" />
                  : <span className="w-full aspect-video bg-[#F5F4F0] flex items-center justify-center text-[#A8A69E]"><PresentationChart size={36} /></span>}
                <span className="block px-3 pt-2.5 font-semibold text-[#1C1917] truncate">{item.title || 'Adsız konu anlatımı'}</span>
                <span className="block px-3 pb-1 text-xs text-[#787670]">
                  {item.slideCount} slayt · {item.voiced}/{item.slideCount} ses · {clock(item.duration)}
                </span>
              </button>
              <div className="mt-auto flex items-center justify-between px-3 pb-2.5 pt-1">
                <span className="text-xs text-[#8C8A82]">{new Date(item.updatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</span>
                <button type="button" onClick={() => void remove(item)} className="p-1.5 rounded text-[#787670] hover:text-red-700 hover:bg-red-50" aria-label={`${item.title || 'Adsız konu anlatımı'}: sil`} title="Sil">
                  <Trash size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
