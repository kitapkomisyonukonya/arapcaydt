import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { freshAssetUrl } from '../features/projects/cloudProjectRepository';
import { Plus, Copy, Trash, ArrowRight, MagnifyingGlass, ArrowCounterClockwise, FileZip, FolderSimple, Sparkle, X, PlayCircle, Tag, FileXls } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useProjects } from '../features/projects/ProjectContext';
import { QUESTION_CATEGORIES, getCategoryLabel } from '../config/categories';
import { resumeStep, stageLabels, steps } from '../features/question-editor/workflow';
import type { ProjectSummary } from '../types';
import { projectRepository } from '../features/projects/projectRepository';
import type { AppPage } from '../components/common/AppSidebar';
import { useConfirm } from '../components/common/ConfirmDialog';
import { CollectionInput } from '../features/projects/CollectionInput';
import { TopicInput } from '../features/projects/TopicInput';
import { videoInfoCsv } from '../features/video/videoInfo';
import { saveFile } from '../services/narration/browserMedia';
import { downloadBackup } from '../features/projects/backupActions';
import { TRASH_DAYS, trashDaysLeft } from '../features/projects/trash';
import type { MarkRow, MarkState } from '../features/batch/prepareMarks';
import { reportClientError } from '../services/supabase';

// The player and the marks pipeline load when first used (they bring the image reader and the video engine).
const SequencePlayer = lazy(() => import('../features/projects/SequencePlayer').then(m => ({ default: m.SequencePlayer })));
const loadMarks = () => Promise.all([import('../features/batch/prepareMarks'), import('../services/pipeline/localVideoPipeline')]);

/** Google Vision readings a teacher gets per day (the server's VISION_DAILY_PER_TEACHER). */
const VISION_PER_DAY = 30;
const markStates: Record<MarkState, { label: string; tone: string }> = {
  waiting: { label: 'Sırada', tone: 'text-[#787670]' },
  working: { label: 'Hazırlanıyor…', tone: 'text-[#8B1E2D]' },
  ready: { label: 'Yayına hazır', tone: 'text-[#15803D]' },
  check: { label: 'Kontrol önerilir', tone: 'text-[#B45309]' },
  blocked: { label: 'Düzeltme gerekli', tone: 'text-red-700' },
  skipped: { label: 'Atlandı', tone: 'text-[#787670]' },
  failed: { label: 'Hazırlanamadı', tone: 'text-red-700' },
  stopped: { label: 'Durduruldu', tone: 'text-[#787670]' },
};

/** How the list is ordered; the choice is remembered on this device. */
const SORTS = {
  updated: { label: 'Son düzenlenen önce', compare: (a: ProjectSummary, b: ProjectSummary) => b.updatedAt.localeCompare(a.updatedAt) },
  newest: { label: 'Son eklenen önce', compare: (a: ProjectSummary, b: ProjectSummary) => b.createdAt.localeCompare(a.createdAt) },
  oldest: { label: 'İlk eklenen önce', compare: (a: ProjectSummary, b: ProjectSummary) => a.createdAt.localeCompare(b.createdAt) },
  number: { label: 'Soru numarasına göre', compare: (a: ProjectSummary, b: ProjectSummary) => (a.examName || '').localeCompare(b.examName || '', 'tr') || a.questionNumber - b.questionNumber },
  title: { label: 'Ada göre (A–Z)', compare: (a: ProjectSummary, b: ProjectSummary) => a.title.localeCompare(b.title, 'tr', { numeric: true }) },
} as const;
type SortId = keyof typeof SORTS;
const SORT_KEY = 'studio-question-sort';
const savedSort = (): SortId => {
  try { const v = localStorage.getItem(SORT_KEY); return v && v in SORTS ? v as SortId : 'updated'; } catch { return 'updated'; }
};
interface Props {
  onNavigate: (page: AppPage) => void;
  onSelectProject: (id: string) => void;
  onNewQuestion: () => void;
}
export function QuestionsPage({ onSelectProject, onNewQuestion, onNavigate }: Props) {
  const confirm = useConfirm();
  const { projects, trash, moveToTrash, restoreFromTrash, deleteForever, moveToCollection, updateQuestions, createNewProject, isLoading } = useProjects();
  const [view, setView] = useState<'list' | 'trash'>('list');
  const [sort, setSort] = useState<SortId>(savedSort);
  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch { /* per-device only */ } }, [sort]);
  // Chosen questions for the actions bar; cleared when the list or the recycle bin is switched.
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => setChosen(new Set()), [view]);
  const [collectionFor, setCollectionFor] = useState<string[] | null>(null);
  /** "Arka arkaya izle": the chosen questions, in list order. */
  const [watching, setWatching] = useState<string[] | null>(null);
  const [topicFor, setTopicFor] = useState<string[] | null>(null);
  const [topicName, setTopicName] = useState('');
  const [topic, setTopic] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [collection, setCollection] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const collections = [...new Set(projects.map(p => p.examName).filter(Boolean))].sort();
  const topics = [...new Set(projects.map(p => p.topic?.trim()).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, 'tr'));
  const years = [...new Set(projects.map(p => p.examYear).filter(Boolean))].sort().reverse();
  const source = view === 'trash' ? trash : projects;
  const rows = source.filter(
    p =>
      (!category || p.category === category) &&
      (!collection || p.examName === collection) &&
      (!topic || (topic === '-' ? !p.topic?.trim() : p.topic?.trim() === topic)) &&
      (!year || p.examYear === year) &&
      (!status || (status === 'done' ? !!p.completedAt : String(resumeStep(p)) === status && !p.completedAt)) &&
      [p.title, p.examName, p.examYear, p.topic, p.arabicQuestionSnippet, String(p.questionNumber)]
        .join(' ')
        .toLocaleLowerCase('tr')
        .includes(search.toLocaleLowerCase('tr')),
  ).sort(view === 'trash' ? () => 0 : SORTS[sort].compare);
  const visibleChosen = rows.filter(p => chosen.has(p.id)).map(p => p.id);
  const allChosen = rows.length > 0 && visibleChosen.length === rows.length;
  const toggle = (id: string) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  /** Runs an action on questions, shows how it went, and clears the choice. */
  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    setError('');
    try {
      toast.success(await action());
      setChosen(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı. Tekrar deneyin.');
    } finally {
      setBusy('');
    }
  };
  const countNote = (done: number, wanted: number, what: string) =>
    done === wanted ? `${done} soru ${what}.` : `${done} / ${wanted} soru ${what}; kalanlar için tekrar deneyin.`;
  const trashChosen = async (ids: string[]) => {
    if (!ids.length) return;
    await run('trash', async () => countNote(await moveToTrash(ids), ids.length, `çöp kutusuna taşındı. ${TRASH_DAYS} gün içinde geri alabilirsiniz`));
  };
  const restoreChosen = (ids: string[]) => run('restore', async () => countNote(await restoreFromTrash(ids), ids.length, 'geri alındı'));
  const deleteChosen = async (ids: string[]) => {
    if (!ids.length || !await confirm({
      title: ids.length === 1 ? 'Soru kalıcı olarak silinsin mi?' : `${ids.length} soru kalıcı olarak silinsin mi?`,
      message: 'Görseli, sesi ve işaretleriyle birlikte silinir. Bu işlem geri alınamaz.',
      confirmLabel: 'Kalıcı olarak sil', danger: true,
    })) return;
    await run('delete', async () => countNote(await deleteForever(ids), ids.length, 'kalıcı olarak silindi'));
  };
  const backupChosen = (ids: string[]) => run('backup', async () => {
    const count = await downloadBackup(ids, p => setBusy(`backup:${p.done}/${p.total}`));
    return `${count} sorunun yedeği indirildi.`;
  });
  // "İşaretleri hazırla" for many questions: one by one, then one list of what needs a look.
  const [marks, setMarks] = useState<MarkRow[] | null>(null);
  const marksStop = useRef<AbortController | null>(null);
  const marksRunning = !!marks?.some(r => r.state === 'waiting' || r.state === 'working');
  const setMark = (id: string, row: Partial<MarkRow>) => setMarks(prev => prev && prev.map(r => r.id === id ? { ...r, ...row } : r));
  const prepareChosen = async (ids: string[]) => {
    if (ids.length > VISION_PER_DAY && !await confirm({
      title: `${ids.length} sorunun işaretleri hazırlansın mı?`,
      message: `Her soru bir Google Vision okuması kullanır; günde ${VISION_PER_DAY} hakkınız var. Hak bitince görseller tarayıcıdaki okuyucuyla okunur (Arapçada daha zayıftır).`,
      confirmLabel: 'Hazırla',
    })) return;
    const titles = new Map(projects.map(p => [p.id, p.title]));
    setMarks(ids.map(id => ({ id, title: titles.get(id) || 'Adsız soru', state: 'waiting' })));
    setChosen(new Set());
    const stop = marksStop.current = new AbortController();
    const outcome = new Map<string, MarkState>();
    const note = (id: string, row: Partial<MarkRow>) => { if (row.state) outcome.set(id, row.state); setMark(id, row); };
    const [{ prepareOne }, { localVideoPipeline }] = await loadMarks();
    const saved = await updateQuestions(ids, async project => {
      if (stop.signal.aborted) { note(project.id, { state: 'stopped' }); return null; }
      note(project.id, { state: 'working' });
      try {
        const { project: next, row } = await prepareOne(project, async params => localVideoPipeline.executePipeline({ ...params, imageUrl: await freshAssetUrl(params.imageUrl) }));
        note(project.id, row);
        return next;
      } catch (e) {
        reportClientError(project.id, 'isaretler', e);
        note(project.id, { state: 'failed', note: e instanceof Error ? e.message : 'Bilinmeyen hata' });
        return null;
      }
    }).catch(e => { setError(e instanceof Error ? e.message : 'İşaretler hazırlanamadı.'); return [] as string[]; });
    // A question that was prepared but could not be saved, or never reached.
    for (const id of ids) {
      const state = outcome.get(id);
      if (!state) note(id, { state: 'failed', note: 'Soru açılamadı.' });
      else if ((state === 'ready' || state === 'check' || state === 'blocked') && !saved.includes(id)) note(id, { state: 'failed', note: 'Hazırlandı ama kaydedilemedi. Tekrar deneyin.' });
    }
  };
  const duplicate = async (summary: ProjectSummary) => {
    setBusy(summary.id);
    setError('');
    try {
      // The list holds summaries; copying needs the full project (timings, regions, settings).
      const p = await projectRepository.getById(summary.id);
      if (!p) throw new Error('Proje bulunamadı.');
      let imageUrl = '';
      if (p.imageUrl) {
        const response = await fetch(p.imageUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error('Görsel kopyalanamadı. Tekrar deneyin.');
        const blob = await response.blob();
        imageUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      await createNewProject({
        title: p.title + ' (Kopya)',
        examYear: p.examYear,
        examName: p.examName,
        topic: p.topic,
        category: p.category,
        correctAnswer: p.correctAnswer,
        imageUrl,
        imageFileName: p.imageFileName,
        solutionText: p.solutionText,
        videoConfig: {
          ...p.videoConfig,
          annotations: [],
          regions: [],
          timelineActions: [],
          captions: [],
          warnings: [],
          suppressedRegionIds: [],
          pipelineVersion: undefined,
        },
        audioApproved: false,
        videoReady: false,
        status: 'draft',
      });
      onNavigate('editor');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Proje kopyalanamadı.');
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="studio-library">
      <header className="library-heading">
        <div>
          <h2>Sorularım</h2>
          <p>Sorularınız, koleksiyonlarınız ve kaldığınız yer.</p>
        </div>
        <button className="studio-primary" onClick={onNewQuestion}>
          <Plus size={18} />
          Yeni soru
        </button>
      </header>
      <div role="tablist" aria-label="Soru listesi" className="library-tabs">
        <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>Sorularım ({projects.length})</button>
        <button role="tab" aria-selected={view === 'trash'} onClick={() => setView('trash')}>
          <Trash size={18} /> Çöp kutusu ({trash.length})
        </button>
      </div>
      {view === 'trash' && (
        <p className="trash-note">
          Silinen sorular burada {TRASH_DAYS} gün bekler, sonra kendiliğinden kalıcı olarak silinir. Yanlışlıkla sildiğiniz soruyu “Geri al” ile listenize döndürebilirsiniz.
        </p>
      )}
      <div className="library-filters">
        <label className="library-search">
          <MagnifyingGlass size={20} />
          <input
            aria-label="Sorularda ara"
            placeholder="Başlık, yıl veya Arapça metin ara…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <div className="filter-row">
          <select aria-label="Koleksiyon" value={collection} onChange={e => setCollection(e.target.value)}>
            <option value="">Tüm koleksiyonlar</option>
            {collections.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select aria-label="Konu" value={topic} onChange={e => setTopic(e.target.value)}>
            <option value="">Tüm konular</option>
            {topics.map(t => <option key={t}>{t}</option>)}
            <option value="-">Konusu yazılmamış</option>
          </select>
          <select aria-label="Sınav yılı" value={year} onChange={e => setYear(e.target.value)}>
            <option value="">Tüm yıllar</option>
            {years.map(y => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <select aria-label="Kategori" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Tüm kategoriler</option>
            {QUESTION_CATEGORIES.map(c => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select aria-label="Hazırlık durumu" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Tüm aşamalar</option>
            {steps.map((s, i) => (
              <option key={s} value={String(i)}>
                {['Görsel bekliyor', 'Metin bekliyor', 'Ses kontrolü', 'İşaret kontrolü', 'Video hazır'][i]}
              </option>
            ))}
            <option value="done">Tamamlandı</option>
          </select>
          {view === 'list' && (
            <select aria-label="Sıralama" value={sort} onChange={e => setSort(e.target.value as SortId)}>
              {(Object.keys(SORTS) as SortId[]).map(id => <option key={id} value={id}>{SORTS[id].label}</option>)}
            </select>
          )}
          {(search || collection || topic || year || category || status) && (
            <button
              onClick={() => {
                setSearch('');
                setCollection('');
                setTopic('');
                setYear('');
                setCategory('');
                setStatus('');
              }}
            >
              Filtreleri temizle
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="save-alert">
          {error}
        </p>
      )}
      <div className="library-count" role="status">
        {rows.length > 0 && (
          <label className="choose-all">
            <input type="checkbox" checked={allChosen} onChange={() => setChosen(allChosen ? new Set() : new Set(rows.map(p => p.id)))} />
            Tümünü seç
          </label>
        )}
        <span>{isLoading ? 'Sorular yükleniyor…' : `${rows.length} soru${view === 'list' ? ` · ${SORTS[sort].label}` : ''}`}</span>
      </div>
      {!isLoading && !rows.length && view === 'trash' && (
        <div className="library-empty">
          <h3>Çöp kutusu boş</h3>
          <p>Sildiğiniz sorular {TRASH_DAYS} gün boyunca burada bekler.</p>
        </div>
      )}
      {!isLoading && !rows.length && view === 'list' && (
        <div className="library-empty">
          <h3>{projects.length ? 'Bu filtrelerde soru bulunamadı' : 'İlk soru videonuzu hazırlayın'}</h3>
          <p>
            {projects.length
              ? 'Filtreleri değiştirin veya yeni bir soru ekleyin.'
              : 'Bir soru görseliyle başlayın. Metin, ses ve işaretleri adım adım tamamlayabilirsiniz.'}
          </p>
          <button className="studio-primary" onClick={onNewQuestion}>
            Soru ekle
          </button>
        </div>
      )}
      <div>
        {rows.map(p => (
          <article key={p.id} className={`question-row ${chosen.has(p.id) ? 'is-chosen' : ''}`}>
            <label className="question-check" title="Seç">
              <input type="checkbox" aria-label={`${p.title} sorusunu seç`} checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
            </label>
            <button className="question-open" disabled={!!busy || view === 'trash'} onClick={() => onSelectProject(p.id)}>
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" loading="lazy" crossOrigin="anonymous" />
              ) : (
                <span className="empty-thumbnail">Soru {p.questionNumber}</span>
              )}
              <span>
                <strong>{p.title}</strong>
                <small>
                  {p.examName || p.examYear} · {getCategoryLabel(p.category)}{p.topic?.trim() ? ` · ${p.topic.trim()}` : ''}
                </small>
              </span>
            </button>
            {view === 'trash' ? (
              <>
                <span className="project-stage">{trashDaysLeft(p.deletedAt!) ? `${trashDaysLeft(p.deletedAt!)} gün sonra silinecek` : 'Bugün silinecek'}</span>
                <div className="row-actions">
                  <button className="studio-secondary" disabled={!!busy} onClick={() => void restoreChosen([p.id])}>
                    <ArrowCounterClockwise size={16} /> Geri al
                  </button>
                  <button disabled={!!busy} aria-label={`${p.title} sorusunu kalıcı olarak sil`} title="Kalıcı olarak sil" onClick={() => void deleteChosen([p.id])}>
                    <Trash size={19} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className={`project-stage ${p.completedAt ? 'is-done' : ''}`}>{p.completedAt ? '✓ Tamamlandı' : stageLabels[resumeStep(p)]}</span>
                <div className="row-actions">
                  <button
                    disabled={!!busy}
                    aria-label={`${p.title} projesini çoğalt`}
                    title="Ayarları ve metni kopyala; ses yeniden üretilir"
                    onClick={() => void duplicate(p)}
                  >
                    <Copy size={19} />
                  </button>
                  <button disabled={!!busy} aria-label={`${p.title} sorusunu çöp kutusuna taşı`} title="Çöp kutusuna taşı" onClick={() => void trashChosen([p.id])}>
                    <Trash size={19} />
                  </button>
                  <button className="studio-secondary" disabled={!!busy} onClick={() => onSelectProject(p.id)}>
                    Devam et
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {visibleChosen.length > 0 && (
        <div role="toolbar" aria-label="Seçili sorular" className="bulk-bar">
          <strong>{visibleChosen.length} soru seçildi</strong>
          {view === 'list' ? (
            <>
              <button disabled={!!busy || marksRunning} onClick={() => void prepareChosen(visibleChosen)}
                title="Seçilen soruların işaretlerini sırayla hazırlar; sesi seçilmemiş ve tamamlanmış sorular atlanır">
                <Sparkle size={18} /> İşaretleri hazırla
              </button>
              <button disabled={!!busy} onClick={() => setWatching(visibleChosen)}
                title="Seçilen soruların videolarını listedeki sırayla arka arkaya oynatır; hatalı olanları işaretlersiniz">
                <PlayCircle size={18} /> Arka arkaya izle
              </button>
              <button disabled={!!busy} onClick={() => { setCollectionName(''); setCollectionFor(visibleChosen); }}>
                <FolderSimple size={18} /> Koleksiyona taşı
              </button>
              <button disabled={!!busy} onClick={() => { setTopicName(''); setTopicFor(visibleChosen); }}>
                <Tag size={18} /> Konu ver
              </button>
              <button disabled={!!busy} title="Seçilen soruların başlık, koleksiyon, soru no, konu, doğru cevap ve süresini Excel’de açılan bir liste olarak indirir"
                onClick={() => saveFile(new Blob([videoInfoCsv(rows.filter(p => chosen.has(p.id)))], { type: 'text/csv;charset=utf-8' }), 'video-bilgileri.csv')}>
                <FileXls size={18} /> Bilgi listesi (Excel)
              </button>
              <button disabled={!!busy} onClick={() => void backupChosen(visibleChosen)}>
                <FileZip size={18} /> {busy.startsWith('backup:') ? `Hazırlanıyor ${busy.slice(7)}` : 'Yedeğini indir (ZIP)'}
              </button>
              <button disabled={!!busy} className="danger" onClick={() => void trashChosen(visibleChosen)}>
                <Trash size={18} /> Çöp kutusuna taşı
              </button>
            </>
          ) : (
            <>
              <button disabled={!!busy} onClick={() => void restoreChosen(visibleChosen)}>
                <ArrowCounterClockwise size={18} /> Geri al
              </button>
              <button disabled={!!busy} className="danger" onClick={() => void deleteChosen(visibleChosen)}>
                <Trash size={18} /> Kalıcı olarak sil
              </button>
            </>
          )}
          <button disabled={!!busy} onClick={() => setChosen(new Set())} aria-label="Seçimi kaldır">
            <X size={18} /> Seçimi kaldır
          </button>
        </div>
      )}
      {marks && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="marks-title"
          onKeyDown={e => { if (e.key === 'Escape' && !marksRunning) setMarks(null); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div>
              <h3 id="marks-title" className="text-lg font-bold">
                {marksRunning
                  ? `İşaretler hazırlanıyor · ${marks.filter(r => r.state !== 'waiting' && r.state !== 'working').length + 1} / ${marks.length}`
                  : 'İşaretler hazırlandı'}
              </h3>
              <p className="text-sm text-[#746e66] mt-1">
                {marksRunning
                  ? 'Bu pencereyi kapatmayın. Her soru yarım dakika kadar sürebilir.'
                  : (['ready', 'check', 'blocked', 'skipped', 'failed', 'stopped'] as MarkState[])
                    .map(s => [s, marks.filter(r => r.state === s).length] as const).filter(([, n]) => n)
                    .map(([s, n]) => `${n} ${markStates[s].label.toLocaleLowerCase('tr')}`).join(' · ')}
              </p>
            </div>
            <ul className="divide-y divide-[#EFEFEA] overflow-y-auto -mx-2 px-2">
              {marks.map(r => (
                <li key={r.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{r.title}</p>
                    <p className={`text-sm font-semibold ${markStates[r.state].tone}`}>{markStates[r.state].label}</p>
                    {r.note && <p className="text-sm text-[#55544F]">{r.note}</p>}
                  </div>
                  {!marksRunning && (r.state === 'check' || r.state === 'blocked' || r.state === 'ready') && (
                    <button type="button" className="studio-secondary shrink-0" onClick={() => { setMarks(null); onSelectProject(r.id); }}>
                      Aç <ArrowRight size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              {marksRunning ? (
                <button type="button" className="studio-secondary" disabled={marksStop.current?.signal.aborted}
                  onClick={() => { marksStop.current?.abort(); setMarks(prev => prev && [...prev]); }}>
                  {marksStop.current?.signal.aborted ? 'Bu soru bitince duracak…' : 'Durdur'}
                </button>
              ) : (
                <button type="button" className="studio-primary" onClick={() => setMarks(null)}>Kapat</button>
              )}
            </div>
          </div>
        </div>
      )}
      {watching && (
        <Suspense fallback={null}>
        <SequencePlayer ids={watching} titles={Object.fromEntries(projects.map(p => [p.id, p.title]))}
          onClose={() => setWatching(null)} onOpen={id => { setWatching(null); onSelectProject(id); }} />
        </Suspense>
      )}
      {topicFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="topic-title"
          onKeyDown={e => { if (e.key === 'Escape') setTopicFor(null); }}>
          <form className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
            onSubmit={e => {
              e.preventDefault();
              const ids = topicFor, name = topicName.trim();
              setTopicFor(null);
              void run('topic', async () => countNote((await updateQuestions(ids, async full => ({ ...full, topic: name || undefined }))).length, ids.length,
                name ? `“${name}” konusuna eklendi` : 'için konu silindi'));
            }}>
            <h3 id="topic-title" className="text-lg font-bold">{topicFor.length} soruya konu ver</h3>
            <label className="flex flex-col gap-2 text-base">
              Konu
              <TopicInput autoFocus value={topicName} onChange={setTopicName} placeholder="Örneğin: İsm-i mevsul"
                className="border rounded-lg px-3 py-2.5 text-base" />
            </label>
            <p className="text-sm text-[#746e66]">Listeden seçin ya da kendiniz yazın. Boş bırakırsanız soruların konusu silinir.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="studio-secondary" onClick={() => setTopicFor(null)}>Vazgeç</button>
              <button type="submit" className="studio-primary">Kaydet</button>
            </div>
          </form>
        </div>
      )}
      {collectionFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="collection-title"
          onKeyDown={e => { if (e.key === 'Escape') setCollectionFor(null); }}>
          <form className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
            onSubmit={e => {
              e.preventDefault();
              const ids = collectionFor;
              setCollectionFor(null);
              void run('collection', async () => countNote(await moveToCollection(ids, collectionName), ids.length,
                collectionName.trim() ? `“${collectionName.trim()}” koleksiyonuna taşındı` : 'koleksiyondan çıkarıldı'));
            }}>
            <h3 id="collection-title" className="text-lg font-bold">{collectionFor.length} soruyu koleksiyona taşı</h3>
            <label className="flex flex-col gap-2 text-base">
              Koleksiyon / deneme adı
              <CollectionInput autoFocus value={collectionName} onChange={setCollectionName} placeholder="Örneğin: 2026 Deneme 3"
                className="border rounded-lg px-3 py-2.5 text-base" />
            </label>
            <p className="text-sm text-[#746e66]">Boş bırakırsanız sorular koleksiyondan çıkarılır.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="studio-secondary" onClick={() => setCollectionFor(null)}>Vazgeç</button>
              <button type="submit" className="studio-primary">Taşı</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
