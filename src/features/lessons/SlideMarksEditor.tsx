import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowCounterClockwise, CircleNotch, Pause, Play, Rectangle, Trash, X } from '@phosphor-icons/react';
import type { AnnotationRegion, VideoAction } from '../../types';
import { NARRATION_RATE, decodeAudio } from '../../services/narration/audioCodec';
import { plainMessage } from '../../services/plainError';
import { MarkTimeline } from '../video/MarkTimeline';
import { clock } from '../question-editor/workflow';
import { fitInside, type LessonSlide } from './lessonPlan';
import { loadSlideImage } from './lessonVideo';
import {
  drawSlideMarks, handTimedMarks, markable, slideBlocks, timedMarks, voicePauses,
  type DeckWords, type HandMark, type SlideArea, type SlideBlock,
} from './slideMarks';
import { partLabel } from './SlideMarksPanel';

const W = 1280, H = 720;
/** A new mark lasts this long until the teacher ends it ("Şimdi bitsin" or dragging its edge). */
const NEW_MARK_SECONDS = 3;
const newId = () => Math.random().toString(36).slice(2, 10);

/** The studio's own marks for this slide, timed on its voice's pauses, as marks the teacher can move. */
function studioMarks(slide: LessonSlide, duration: number, deck: DeckWords, samples: Float32Array): HandMark[] {
  const { blocks, marks } = timedMarks(slide.text, slide.lines, slide.markFixes, duration, deck, voicePauses(samples, NARRATION_RATE));
  const parts = markable(blocks);
  return marks.map(m => ({ id: newId(), start: m.start, end: m.end, part: parts.indexOf(m.block) }));
}

/**
 * "İşaretleri düzenle": the slide with its marks as they play in the video, the slide's voice as a
 * waveform with every mark under it (the question editor's time strip). The teacher listens, drags
 * a mark to when it should come and its edge to how long it stays, or taps "Şimdi" while listening;
 * clicking a line on the slide puts a mark there (or moves the chosen one there); "Alan çiz" marks
 * any place, also on a slide added as a picture. Every change is saved on the slide.
 */
export function SlideMarksEditor({ slide, number, deck, onChange, onClose }: {
  slide: LessonSlide;
  number: number;
  deck: DeckWords;
  /** The teacher's marks; undefined: back to the studio's own. */
  onChange: (marks: HandMark[] | undefined) => void;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState<{ url: string; image: HTMLImageElement; duration: number; samples: Float32Array } | null>(null);
  const [error, setError] = useState('');
  const [hand, setHand] = useState<HandMark[]>(slide.marks || []);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [rubber, setRubber] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    let alive = true, url = '';
    (async () => {
      const response = await fetch(slide.audio?.url || '', { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) throw new Error('Slaytın sesi açılamadı. Sayfayı yenileyip tekrar deneyin.');
      const blob = await response.blob();
      const [samples, image] = await Promise.all([decodeAudio(blob), loadSlideImage(slide.imageUrl || '', number)]);
      url = URL.createObjectURL(blob);
      if (!alive) { URL.revokeObjectURL(url); return; }
      const duration = samples.length / NARRATION_RATE;
      if (!slide.marks) setHand(studioMarks(slide, duration, deck, samples));
      setReady({ url, image, duration, samples });
    })().catch(e => { if (alive) setError(plainMessage(e, 'İşaret düzenleyici açılamadı.')); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    // Opened for one slide and its voice; edits made here do not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.id, slide.audio?.url]);

  const blocks = useMemo(() => slide.lines?.length ? slideBlocks(slide.lines) : [], [slide.lines]);
  const parts = useMemo(() => markable(blocks), [blocks]);
  const timed = useMemo(() => handTimedMarks(slide.lines, hand), [slide.lines, hand]);
  const fit = ready ? fitInside(ready.image.naturalWidth || 16, ready.image.naturalHeight || 9, W, H) : fitInside(slide.width || 16, slide.height || 9, W, H);

  // The slide and its marks at the voice's time, every frame.
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const tick = () => {
      const t = audio.current?.currentTime ?? 0;
      const ctx = canvas.current?.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(ready.image, fit.x, fit.y, fit.width, fit.height);
        drawSlideMarks(ctx, fit, timed.blocks, timed.marks, t);
      }
      setTime(t);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ready, timed, fit.x, fit.y, fit.width, fit.height]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (drawing) setDrawing(false); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, drawing]);

  const change = (next: HandMark[]) => { setHand(next); onChange(next); };
  const seek = (t: number) => { if (audio.current) audio.current.currentTime = t; setTime(t); };
  const toggle = () => { const a = audio.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); };
  const duration = ready?.duration || slide.audio?.duration || 1;
  /** Puts the chosen mark on `target`, or a new mark there from now on. */
  const place = (target: { part: number } | { area: SlideArea }) => {
    const current = hand.find(m => m.id === selected);
    if (current) { change(hand.map(m => m.id === current.id ? { id: m.id, start: m.start, end: m.end, ...target } : m)); return; }
    const start = Math.min(time, Math.max(0, duration - 0.3));
    const mark: HandMark = { id: newId(), start, end: Math.min(duration, start + NEW_MARK_SECONDS), ...target };
    change([...hand, mark].sort((a, b) => a.start - b.start));
    setSelected(mark.id);
  };
  const remove = (id: string) => { change(hand.filter(m => m.id !== id)); if (selected === id) setSelected(null); };
  const backToStudio = () => {
    onChange(undefined);
    setSelected(null);
    if (ready) setHand(studioMarks({ ...slide, marks: undefined }, ready.duration, deck, ready.samples));
  };

  // The strip works on the question editor's marks: a highlighter ("Vurgu") from start to end.
  const actions: VideoAction[] = hand.map(m => ({
    id: m.id, type: 'highlight', start: m.start, startTime: m.start, duration: m.end - m.start,
    targetRegionId: m.area ? `area-${m.id}` : `part-${m.part}`,
  }));
  const regions = [
    ...parts.map((b, k): AnnotationRegion => ({ id: `part-${k}`, label: partLabel(b, parts), content: partLabel(b, parts), type: 'paragraph', ...box(b) })),
    ...hand.filter(m => m.area).map((m): AnnotationRegion => ({ id: `area-${m.id}`, label: 'Çizilen alan', content: 'Çizilen alan', type: 'paragraph', ...m.area! })),
  ];
  const fromStrip = (next: VideoAction[]) => change(next.flatMap(a => {
    const m = hand.find(h => h.id === a.id);
    return m ? [{ ...m, start: a.start, end: a.start + a.duration }] : [];
  }));

  // Where a part of the slide is over the drawn canvas, as CSS percentages.
  const pct = (b: SlideArea, pad = 0) => ({
    left: `${(fit.x + b.x * fit.width - pad * fit.width) / W * 100}%`, top: `${(fit.y + b.y * fit.height - pad * fit.height) / H * 100}%`,
    width: `${(b.width + 2 * pad) * fit.width / W * 100}%`, height: `${(b.height + 2 * pad) * fit.height / H * 100}%`,
  });
  const slideAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return { x: clamp(((e.clientX - r.left) / r.width * W - fit.x) / fit.width), y: clamp(((e.clientY - r.top) / r.height * H - fit.y) / fit.height) };
  };
  const chosen = hand.find(m => m.id === selected);
  const nameOf = (m: HandMark) => m.area ? 'Çizilen alan' : m.part !== undefined && parts[m.part] ? partLabel(parts[m.part], parts) : 'Slaytta yok';

  return (
    <div role="dialog" aria-modal="true" aria-label={`${number}. slaytın işaretleri`} className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-6xl bg-[#FAF9F5] rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b bg-white">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1C1917]">{number}. slaytın işaretleri</p>
            <p className="text-xs text-[#787670]">Dinleyin; yanlış yerdeki ya da yanlış zamandaki işareti düzeltin. Her değişiklik kaydedilir.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-black/5" aria-label="Kapat" title="Kapat (Esc)"><X size={18} /></button>
        </div>

        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-2 min-w-0">
            <div className="relative bg-white border rounded-lg overflow-hidden aspect-video">
              <canvas ref={canvas} width={W} height={H} className="w-full h-full block" />
              {!ready && !error && (
                <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-[#55544F]">
                  <CircleNotch size={18} className="animate-spin" /> Slayt ve ses açılıyor…
                </p>
              )}
              {error && <p role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-700">{error}</p>}
              {ready && !drawing && parts.map((b, k) => (
                <button key={k} type="button" style={pct(b, 0.006)}
                  onMouseEnter={() => setHovered(k)} onMouseLeave={() => setHovered(null)} onClick={() => place({ part: k })}
                  title={chosen ? `Seçili işaret buraya taşınsın: ${partLabel(b, parts)}` : `Şu andan itibaren burası işaretlensin: ${partLabel(b, parts)}`}
                  aria-label={chosen ? `Seçili işareti taşı: ${partLabel(b, parts)}` : `Buraya işaret koy: ${partLabel(b, parts)}`}
                  className={`absolute rounded border-2 border-dashed transition-colors ${
                    chosen?.part === k && !chosen.area ? 'border-[#2563EB] bg-[#2563EB]/10' : hovered === k ? 'border-[#8B1E2D] bg-[#8B1E2D]/10' : 'border-transparent hover:border-[#8B1E2D]/60'}`} />
              ))}
              {ready && chosen?.area && <span aria-hidden="true" className="absolute rounded border-2 border-[#2563EB] pointer-events-none" style={pct(chosen.area)} />}
              {ready && drawing && (
                <div className="absolute inset-0 cursor-crosshair bg-[#2563EB]/5"
                  onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); const p = slideAt(e); setRubber({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
                  onPointerMove={e => { if (rubber) { const p = slideAt(e); setRubber({ ...rubber, x1: p.x, y1: p.y }); } }}
                  onPointerUp={() => {
                    if (rubber) {
                      const area = { x: Math.min(rubber.x0, rubber.x1), y: Math.min(rubber.y0, rubber.y1), width: Math.abs(rubber.x1 - rubber.x0), height: Math.abs(rubber.y1 - rubber.y0) };
                      if (area.width > 0.01 && area.height > 0.01) { place({ area }); setDrawing(false); }
                    }
                    setRubber(null);
                  }}>
                  {rubber && <span className="absolute border-2 border-[#2563EB] bg-[#2563EB]/10 rounded pointer-events-none"
                    style={pct({ x: Math.min(rubber.x0, rubber.x1), y: Math.min(rubber.y0, rubber.y1), width: Math.abs(rubber.x1 - rubber.x0), height: Math.abs(rubber.y1 - rubber.y0) })} />}
                  <span className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-[#1C1917]/80 text-white text-xs">İşaretlenecek yeri fareyle çizin (Esc: vazgeç)</span>
                </div>
              )}
            </div>

            {ready && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={toggle} className="w-9 h-9 rounded-full bg-[#8B1E2D] hover:bg-[#721824] text-white flex items-center justify-center shrink-0" aria-label={playing ? 'Durdur' : 'Dinle'}>
                    {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" className="ml-0.5" />}
                  </button>
                  <span className="text-sm tabular-nums text-[#33322E]">{clock(time)} / {clock(duration)}</span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => setDrawing(d => !d)} aria-pressed={drawing}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm font-medium ${drawing ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]' : 'border-[#E5E4DC] bg-white text-[#33322E] hover:border-[#8B1E2D]/50'}`}
                    title={chosen ? 'Seçili işaretin yerini slaytta çizin' : 'Slaytta istediğiniz yeri çizin; şu andan itibaren işaretlenir'}>
                    <Rectangle size={16} /> Alan çiz
                  </button>
                </div>
                {chosen && (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] rounded-md px-2.5 py-1.5">
                    <span className="min-w-0">Seçili işaret ({nameOf(chosen)}): slaytta tıkladığınız satıra taşınır.</span>
                    <button type="button" onClick={() => setSelected(null)} className="underline font-semibold">Seçimi kaldır (yeni işaret koymak için)</button>
                  </p>
                )}
                <MarkTimeline actions={actions} regions={regions} duration={duration} currentTime={time} audioUrl={ready.url}
                  onSeek={seek} onPlayPause={toggle} onActions={fromStrip} keyboard playing={playing} select={selected} onSelect={setSelected} />
                <audio ref={audio} src={ready.url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
              </>
            )}
          </div>

          <aside className="space-y-2.5 min-w-0">
            <div className="rounded-lg border border-[#E5E4DC] bg-white p-3 text-xs text-[#55544F] space-y-1.5 leading-relaxed">
              <p><b className="text-[#1C1917]">Yeni işaret:</b> sesi o ana getirin, slaytta boyanacak satıra tıklayın (ya da <b>Alan çiz</b>).</p>
              <p><b className="text-[#1C1917]">Yerini değiştirmek:</b> işareti seçin, slaytta doğru satıra tıklayın.</p>
              <p><b className="text-[#1C1917]">Zamanı:</b> şeritte sürükleyin, kenarından uzatın ya da dinlerken <b>Şimdi başlasın / bitsin</b>.</p>
            </div>
            <ol className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1" aria-label="İşaretler">
              {hand.map((m, i) => (
                <li key={m.id}>
                  <div className={`rounded-lg border bg-white px-2 py-1.5 space-y-1 ${m.id === selected ? 'border-[#2563EB] ring-2 ring-[#2563EB]/20' : 'border-[#E5E4DC]'}`}>
                    <button type="button" onClick={() => { setSelected(m.id); seek(m.start); }} className="w-full text-left text-[13px] leading-snug text-[#33322E]" dir="auto">
                      <span className="tabular-nums text-[#787670]">{i + 1}. {clock(m.start)}–{clock(m.end)}</span> · {nameOf(m)}
                    </button>
                    <div className="flex items-center gap-1.5">
                      <select value={m.area ? 'area' : String(m.part ?? '')} aria-label={`${i + 1}. işaretin yeri`}
                        onChange={e => { const k = Number(e.target.value); change(hand.map(o => o.id === m.id ? { id: o.id, start: o.start, end: o.end, part: k } : o)); }}
                        className="flex-1 min-w-0 rounded-md border border-[#D5D4CC] px-1.5 py-1 text-xs bg-white">
                        {m.area && <option value="area">Çizilen alan</option>}
                        {parts.map((b, k) => <option key={k} value={k}>{partLabel(b, parts)}</option>)}
                      </select>
                      <button type="button" onClick={() => remove(m.id)} className="p-1 rounded text-[#787670] hover:text-[#8B1E2D]" aria-label={`${i + 1}. işareti sil`} title="Sil"><Trash size={14} /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {ready && !hand.length && <p className="text-sm text-[#55544F]">Bu slaytta işaret yok.</p>}
            {slide.marks && (
              <button type="button" onClick={backToStudio} className="flex items-center gap-1.5 text-sm text-[#55544F] hover:text-[#8B1E2D]" title="Elle yaptığınız değişiklikler silinir, stüdyonun kendi işaretleri gelir">
                <ArrowCounterClockwise size={14} /> Otomatik işaretlere dön
              </button>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

const box = (b: SlideBlock) => ({ x: b.x, y: b.y, width: b.width, height: b.height });
