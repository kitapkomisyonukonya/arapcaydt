import { useEffect, useState } from 'react';
import { ArrowCounterClockwise, CaretLeft, CaretRight, CircleNotch, X } from '@phosphor-icons/react';
import type { AnnotationRegion, VideoAction, VideoConfig } from '../../types';
import { NARRATION_RATE, decodeAudio } from '../../services/narration/audioCodec';
import { plainMessage } from '../../services/plainError';
import { VideoPreviewCanvas } from '../video/VideoPreviewCanvas';
import { MarkTimeline } from '../video/MarkTimeline';
import { LINE_STEP, lineOffset } from '../question-editor/steps/EditorStage';
import type { LessonSlide } from './lessonPlan';
import { voicePauses, type DeckWords } from './slideMarks';
import { autoScene, withEnds, type SlideScene } from './slideScene';

async function fetchBlob(link: string, failed: string): Promise<Blob> {
  const response = await fetch(link, { cache: 'no-store' }).catch(() => null);
  if (!response?.ok) throw new Error(failed);
  return response.blob();
}

/**
 * "İşaretleri düzenle": the question editor's marks screen for one slide: the same preview with
 * its drawing tools on the paused picture (cross, tick, frame, ring, underline in either direction,
 * highlight, arrow, note, colours, undo), the same underline height buttons and the same time strip,
 * on the slide's own voice. Each slide has its own voice, so its marks are timed in it; the lesson
 * video puts the slides one after another. Every change is saved on the slide.
 */
export function SlideMarksEditor({ slide, number, count, deck, onChange, onClose, onPrevious, onNext }: {
  slide: LessonSlide;
  number: number;
  count: number;
  deck: DeckWords;
  /** The teacher's marks; undefined: back to the studio's own. */
  onChange: (scene: SlideScene | undefined) => void;
  onClose: () => void;
  /** Another slide's marks (undefined: none there, or it has no voice yet). */
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const [media, setMedia] = useState<{ imageUrl: string; audioUrl: string; duration: number; auto: SlideScene } | null>(null);
  const [error, setError] = useState('');
  const [scene, setScene] = useState<SlideScene | undefined>(slide.scene);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Ctrl+Z / Ctrl+Y, as in the question editor. */
  const [undo, setUndo] = useState<Array<SlideScene | undefined>>([]);
  const [redo, setRedo] = useState<Array<SlideScene | undefined>>([]);
  /** "Burada hata var" on the strip: the box of the mark just seen, selected on the picture. */
  const [focusBox, setFocusBox] = useState<{ id: string } | null>(null);

  // The slide's picture and voice are read once into this page (a link does not run out while editing).
  useEffect(() => {
    let alive = true;
    const links: string[] = [];
    (async () => {
      const [picture, voice] = await Promise.all([
        fetchBlob(slide.imageUrl || '', `${number}. slaytın resmi açılamadı. Sayfayı yenileyip tekrar deneyin.`),
        fetchBlob(slide.audio?.url || '', `${number}. slaytın sesi açılamadı. Sayfayı yenileyip tekrar deneyin.`),
      ]);
      const samples = await decodeAudio(voice);
      if (!alive) return;
      const duration = samples.length / NARRATION_RATE;
      links.push(URL.createObjectURL(picture), URL.createObjectURL(voice));
      setMedia({ imageUrl: links[0], audioUrl: links[1], duration,
        auto: autoScene(slide.text, slide.lines, slide.markFixes, duration, deck, voicePauses(samples, NARRATION_RATE)) });
    })().catch(e => { if (alive) setError(plainMessage(e, 'İşaret düzenleyici açılamadı.')); });
    return () => { alive = false; links.forEach(URL.revokeObjectURL); };
    // One slide and its voice; the marks edited here do not reload them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.id, slide.audio?.path]);

  const shown = withEnds(scene ?? media?.auto ?? { regions: [], actions: [] });
  const change = (next: SlideScene | undefined) => {
    setUndo(u => [...u.slice(-29), scene]); setRedo([]);
    const fixed = next && withEnds(next);
    setScene(fixed); onChange(fixed);
  };
  const undoOne = () => {
    if (!undo.length) return;
    const previous = undo[undo.length - 1];
    setRedo(r => [...r, scene]); setUndo(undo.slice(0, -1));
    setScene(previous); onChange(previous);
  };
  const redoOne = () => {
    if (!redo.length) return;
    const next = redo[redo.length - 1];
    setUndo(u => [...u, scene]); setRedo(redo.slice(0, -1));
    setScene(next); onChange(next);
  };
  const setActions = (actions: VideoAction[]) => change({ ...shown, actions });
  const setRegions = (regions: AnnotationRegion[], add: VideoAction[] = []) => {
    // Marks of a box that is gone go with it; a new box comes with its first mark.
    const ids = new Set(regions.map(r => r.id));
    change({ ...shown, regions, actions: [...shown.actions.filter(a => ids.has(a.targetRegionId)), ...add].sort((a, b) => a.start - b.start) });
  };
  const config: VideoConfig = {
    aspectRatio: '16:9', fps: 30, backgroundColor: '#FFFFFF', showWatermark: false, annotations: [],
    showCaptions: false, showOutro: false, markerPen: true, underlineOffset: shown.underlineOffset, regions: shown.regions, timelineActions: shown.actions,
  };
  const offset = shown.underlineOffset ?? 0;
  const togglePlay = () => setPlaying(p => !p);
  const nav = 'flex items-center gap-1 px-2 py-1 rounded-md border border-[#D5D4CC] bg-white text-sm hover:bg-[#F2F1EB] disabled:opacity-40';

  return (
    <div role="dialog" aria-modal="true" aria-label={`${number}. slaytın işaretleri`} className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-6xl bg-[#FAF9F5] rounded-xl shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b bg-white">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#1C1917]">{number}. slaytın işaretleri</p>
            <p className="text-xs text-[#787670]">Soru editöründeki gibi: videoyu durdurun, slayttaki yere tıklayıp işaret seçin ya da araçla çizin. Her değişiklik kaydedilir.</p>
          </div>
          <button type="button" className={nav} onClick={onPrevious} disabled={!onPrevious} title="Önceki slaytın işaretleri"><CaretLeft size={14} /> Önceki slayt</button>
          <span className="text-xs tabular-nums text-[#55544F]">{number} / {count}</span>
          <button type="button" className={nav} onClick={onNext} disabled={!onNext} title="Sonraki slaytın işaretleri">Sonraki slayt <CaretRight size={14} /></button>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-black/5" aria-label="Kapat" title="Kapat"><X size={18} /></button>
        </div>

        <div className="p-3 space-y-2">
          {error && <p role="alert" className="p-6 text-center text-sm text-red-700">{error}</p>}
          {!media && !error && (
            <p role="status" className="p-10 flex items-center justify-center gap-2 text-sm text-[#55544F]">
              <CircleNotch size={18} className="animate-spin" /> Slayt ve ses açılıyor…
            </p>
          )}
          {media && (
            <>
              <div className="mx-auto" style={{ maxWidth: 'max(480px, calc((100vh - 420px) * 16 / 9))' }}>
                <VideoPreviewCanvas imageUrl={media.imageUrl} regions={shown.regions} actions={shown.actions} currentTime={time} duration={media.duration}
                  isPlaying={playing} onPlayPause={togglePlay} onSeek={setTime} videoConfig={config} audioUrl={media.audioUrl}
                  editing={{
                    onRegions: setRegions, onActions: setActions,
                    canUndo: undo.length > 0, onUndo: undoOne, canRedo: redo.length > 0, onRedo: redoOne, focusBox,
                  }} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 items-center text-xs">
                <span className="flex gap-1 items-center" title="Bu slayttaki tüm altı çizgileri yukarı ya da aşağı kaydırır">
                  Altı çizgi
                  <button type="button" className="px-2 h-6 rounded border bg-white hover:bg-[#F2F1EB] font-semibold" aria-label="Altı çizgileri yukarı al"
                    onClick={() => change({ ...shown, underlineOffset: lineOffset(offset, -LINE_STEP) })}>↑ Yukarı</button>
                  <button type="button" className="px-2 h-6 rounded border bg-white hover:bg-[#F2F1EB] font-semibold" aria-label="Altı çizgileri aşağı al"
                    onClick={() => change({ ...shown, underlineOffset: lineOffset(offset, LINE_STEP) })}>↓ Aşağı</button>
                  {Math.abs(offset) > .02 && (
                    <button type="button" className="px-1.5 h-6 rounded text-[#787670] hover:text-[#8B1E2D] hover:underline" title="Normal yerine döndür"
                      onClick={() => change({ ...shown, underlineOffset: 0 })}>{offset < 0 ? 'yukarıda' : 'aşağıda'} · sıfırla</button>
                  )}
                </span>
                <span className="flex-1" />
                {scene && (
                  <button type="button" onClick={() => change(undefined)} className="flex items-center gap-1 text-[#55544F] hover:text-[#8B1E2D]"
                    title="Elle yaptığınız değişiklikler silinir, stüdyonun kendi işaretleri gelir">
                    <ArrowCounterClockwise size={13} /> Otomatik işaretlere dön
                  </button>
                )}
              </div>
              <MarkTimeline actions={shown.actions} regions={shown.regions} duration={media.duration} currentTime={time} audioUrl={media.audioUrl}
                onSeek={setTime} onPlayPause={togglePlay} keyboard playing={playing} onActions={setActions}
                onFlag={id => setFocusBox(id ? { id } : null)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
