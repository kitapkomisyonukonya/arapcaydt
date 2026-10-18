import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import TimelinePlugin from 'wavesurfer.js/plugins/timeline';
import HoverPlugin from 'wavesurfer.js/plugins/hover';
import { ArrowsOutLineHorizontal, CaretLeft, CaretRight, MagnifyingGlassMinus, MagnifyingGlassPlus, Minus, Plus, Timer, Trash, HandPalm } from '@phosphor-icons/react';
import type { AnnotationRegion, VideoAction } from '../../types';
import { adjacentAction, clock, isTypingTarget, nudgeAction } from '../question-editor/workflow';

const MARK: Partial<Record<VideoAction['type'], { icon: string; color: string; name: string }>> = {
  reject: { icon: '✗', color: '#8B1E2D', name: 'Çarpı' }, correct: { icon: '✓', color: '#15803D', name: 'Doğru' },
  focus: { icon: '◎', color: '#4338CA', name: 'Çerçeve' }, circle: { icon: '◯', color: '#DC2626', name: 'Daire' },
  underline: { icon: '▁', color: '#D97706', name: 'Altı çizgi' },
  highlight: { icon: '▮', color: '#B45309', name: 'Vurgu' },
  arrow: { icon: '➜', color: '#2563EB', name: 'Ok' }, note: { icon: 'T', color: '#7C3AED', name: 'Yazı' },
};
/** Crosses and ticks stay to the end of the video: only their start moves. */
const lasting = (a: VideoAction) => a.type === 'reject' || a.type === 'correct';
const MIN_SECONDS = .3;
const LANE = 27, PILL_PX = 30, WAVE = 44, RULER = 16;
/** On a short screen the strip gives the question room: a thinner waveform and two rows of marks in view (the rest scroll). */
const COMPACT_WAVE = 26, COMPACT_ROWS = 2;
/** Zoom steps, as multiples of "the whole narration fits". */
const ZOOMS = [1, 2, 4, 8, 16];

/** Marks shown on the strip, in time order. */
export const stripMarks = (actions: VideoAction[]) => actions.filter(a => MARK[a.type]).sort((a, b) => a.start - b.start);

const pillSeconds = (mark: VideoAction, minSeconds: number) => lasting(mark) ? minSeconds : Math.max(minSeconds, mark.duration);
/** Where a pill is drawn: at its start, pulled left near the end so it never sticks out of the strip. */
export const pillStart = (mark: VideoAction, minSeconds: number, total: number) =>
  Math.max(0, Math.min(mark.start, total - pillSeconds(mark, minSeconds)));

/** Rows so no two marks overlap on screen; a pill is at least `minSeconds` wide and stays within `total`. */
export function laneLayout(marks: VideoAction[], minSeconds: number, total = Infinity): Map<string, number> {
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const mark of marks) {
    const start = pillStart(mark, minSeconds, total);
    let lane = ends.findIndex(end => end <= start + 1e-9);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = start + pillSeconds(mark, minSeconds);
    lanes.set(mark.id, lane);
  }
  return lanes;
}

export type PillDrag = 'move' | 'start' | 'end';
/** A pill dragged by `delta` seconds: moved whole, or its start / end edge (the other edge stays). */
export function dragPill(action: VideoAction, mode: PillDrag, delta: number, total: number): VideoAction {
  if (mode === 'move' || lasting(action)) return nudgeAction(action, delta, total);
  const end = action.start + action.duration;
  if (mode === 'start') {
    const start = Math.max(0, Math.min(end - MIN_SECONDS, action.start + delta));
    return { ...action, start, startTime: start, duration: end - start, retimed: true };
  }
  return { ...action, duration: Math.max(MIN_SECONDS, Math.min(total - action.start, action.duration + delta)), retimed: true };
}

/**
 * "Şimdi" while listening: the first tap starts the mark at `time`; for a mark that ends, the next
 * tap ends it there. Crosses and ticks only start (they stay to the end).
 */
export function tapMark(action: VideoAction, time: number, total: number, stage: 'start' | 'end'): VideoAction {
  if (stage === 'end' && !lasting(action)) return { ...action, duration: Math.max(MIN_SECONDS, Math.min(total - action.start, time - action.start)), retimed: true };
  return nudgeAction(action, time - action.start, total);
}

const seconds = (s: number) => `${s.toLocaleString('tr', { maximumFractionDigits: 1 })} sn`;

interface Props {
  actions: VideoAction[];
  regions: AnnotationRegion[];
  duration: number;
  currentTime: number;
  audioUrl?: string;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  onActions: (actions: VideoAction[]) => void;
  /** Space, arrows and Delete work only while this editor is on screen. */
  keyboard?: boolean;
  /** Short screen: thinner waveform, two rows of marks in view. */
  compact?: boolean;
  /** The preview is playing ("Burada hata var" pauses it). */
  playing?: boolean;
  /** "Burada hata var": the box of the mark just seen, to select it on the picture (null: none). */
  onFlag?: (regionId: string | null) => void;
}

/**
 * What the teacher just saw: the latest mark that appeared at or before `time`, if it appeared in
 * the last few seconds or (an underline, a frame) is still on screen.
 */
export function markJustSeen(marks: VideoAction[], time: number, within = 4): VideoAction | null {
  const lasting = (m: VideoAction) => m.type === 'reject' || m.type === 'correct';
  const seen = marks.filter(m => m.start <= time + .1 && (m.start >= time - within || (!lasting(m) && m.start + m.duration >= time)));
  return seen.length ? seen.reduce((a, b) => (b.start >= a.start ? b : a)) : null;
}

/**
 * The narration as a waveform (wavesurfer.js) with every mark under it: click or drag on the
 * waveform to move the playhead, drag a mark to change when it appears, drag its edge to change
 * how long it stays (an underline is drawn over that whole time). Crosses and ticks stay to the
 * end, so only their start moves. Zoom in for fine timing; the marks follow the zoom and scroll.
 */
export function MarkTimeline({ actions, regions, duration, currentTime, audioUrl, onSeek, onPlayPause, onActions, keyboard, compact, playing, onFlag }: Props) {
  const waveBox = useRef<HTMLDivElement>(null);
  const lanesBox = useRef<HTMLDivElement>(null);
  const surfer = useRef<WaveSurfer | null>(null);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The next "Şimdi" tap ends the selected mark (after a first tap started it). */
  const [tapEnds, setTapEnds] = useState(false);
  useEffect(() => setTapEnds(false), [selectedId]);
  const [drag, setDrag] = useState<{ id: string; mode: PillDrag; x: number; moved: boolean } | null>(null);
  const [draft, setDraft] = useState<VideoAction | null>(null);
  /** Horizontal scale and scroll of the waveform, which the marks follow. */
  const [view, setView] = useState({ width: 0, scroll: 0, visible: 0 });
  const [zoom, setZoom] = useState(0);
  const scrubbing = useRef(false);
  const total = Math.max(1, duration);

  useEffect(() => {
    if (!waveBox.current) return;
    const ws = WaveSurfer.create({
      container: waveBox.current, height: compact ? COMPACT_WAVE : WAVE, waveColor: '#D5D4CC', progressColor: '#C98A93', cursorColor: '#8B1E2D', cursorWidth: 2,
      barWidth: 2, barGap: 1, barRadius: 2, normalize: true, dragToSeek: true, autoScroll: false, hideScrollbar: false,
      // The strip works without the narration file too: a flat outline of the video's length.
      ...(audioUrl ? { url: audioUrl, fetchParams: { cache: 'no-store' } } : { peaks: [new Array(400).fill(.08)], duration: total }),
      plugins: [
        TimelinePlugin.create({ height: RULER, formatTimeCallback: s => clock(s).replace(/,\d$/, ''), style: { fontSize: '10px', color: '#8A8880' } }),
        HoverPlugin.create({ lineColor: '#8B1E2D66', lineWidth: 1, labelBackground: '#1C1917', labelColor: '#fff', labelSize: '11px', formatTimeCallback: clock }),
      ],
    });
    surfer.current = ws;
    const sync = () => {
      const width = ws.getWrapper().clientWidth;
      setView({ width, scroll: ws.getScroll(), visible: waveBox.current?.clientWidth || width });
    };
    ws.on('ready', sync); ws.on('redrawcomplete', sync); ws.on('zoom', sync); ws.on('resize', sync);
    ws.on('scroll', (_from, _to, left) => setView(v => ({ ...v, scroll: left })));
    ws.on('interaction', time => { setSelectedId(null); seekRef.current(time); });
    return () => { surfer.current = null; ws.destroy(); };
  }, [audioUrl, total, compact]);

  // The waveform's playhead follows the preview; when zoomed in it keeps the playhead in sight.
  useEffect(() => {
    const ws = surfer.current;
    if (!ws || !ws.getDuration()) return;
    if (Math.abs(ws.getCurrentTime() - currentTime) > .02) ws.setTime(Math.min(currentTime, ws.getDuration()));
    if (zoom > 0 && view.width) {
      const x = currentTime / total * view.width;
      if (x < view.scroll || x > view.scroll + view.visible - 20) ws.setScroll(Math.max(0, x - view.visible * .2));
    }
  }, [currentTime, zoom, view.width, view.visible, total]);

  const setZoomStep = (step: number) => {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, step));
    setZoom(next);
    const ws = surfer.current;
    if (ws) ws.zoom(next === 0 ? 0 : (waveBox.current!.clientWidth / total) * ZOOMS[next]);
  };

  const pxPerSec = (view.width || lanesBox.current?.clientWidth || 800) / total;
  const marks = stripMarks(actions).map(a => draft && a.id === draft.id ? draft : a);
  const minSeconds = PILL_PX / pxPerSec;
  const lanes = laneLayout(marks, minSeconds, total);
  const laneCount = Math.max(1, ...[...lanes.values()].map(l => l + 1));
  const px = (t: number) => t * pxPerSec - view.scroll;

  const label = (a: VideoAction) => {
    const option = /^option-([a-e])$/.exec(a.targetRegionId);
    if (option) return option[1].toUpperCase();
    const region = regions.find(r => r.id === a.targetRegionId);
    return (region?.content || region?.label || '').replace(/\s+/g, ' ').trim().slice(0, 18);
  };
  const replace = (next: VideoAction) => onActions(actions.map(a => a.id === next.id ? next : a));
  const remove = (id: string) => { onActions(actions.filter(a => a.id !== id)); setSelectedId(null); };
  const tap = () => {
    const mark = actions.find(a => a.id === selectedId);
    if (!mark) return;
    replace(tapMark(mark, currentTime, total, tapEnds ? 'end' : 'start'));
    setTapEnds(!tapEnds && !lasting(mark));
  };

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === ' ' || e.code === 'Space') {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
        e.preventDefault(); onPlayPause(); return;
      }
      const selected = actions.find(a => a.id === selectedId);
      if (e.key === 'Enter' && selected) {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
        e.preventDefault(); tap(); return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); remove(selected.id); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const direction = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey && selected) {
        const moved = nudgeAction(selected, direction * .1, total);
        replace(moved); onSeek(moved.start); return;
      }
      const next = adjacentAction(stripMarks(actions), currentTime, direction);
      if (next) { setSelectedId(next.id); onSeek(next.start); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const begin = (e: React.PointerEvent, id: string, mode: PillDrag) => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, mode, x: e.clientX, moved: false });
  };
  const timeAt = (e: React.PointerEvent) => {
    const bounds = lanesBox.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total, (e.clientX - bounds.left + view.scroll) / pxPerSec));
  };
  const move = (e: React.PointerEvent) => {
    if (scrubbing.current) { onSeek(timeAt(e)); return; }
    if (!drag) return;
    const action = actions.find(a => a.id === drag.id);
    if (!action || Math.abs(e.clientX - drag.x) < 3 && !drag.moved) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    const delta = Math.round((e.clientX - drag.x) / pxPerSec * 10) / 10;
    setDraft(dragPill(action, drag.mode, delta, total));
  };
  const end = () => {
    scrubbing.current = false;
    if (!drag) return;
    const action = actions.find(a => a.id === drag.id);
    if (drag.moved && draft) { replace(draft); onSeek(draft.start); }
    else if (action) { setSelectedId(action.id); onSeek(action.start); }
    setDrag(null); setDraft(null);
  };
  const scrub = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubbing.current = true;
    onSeek(timeAt(e));
    setSelectedId(null);
  };

  // While a mark is dragged, the bar under the strip shows its time as it changes.
  const selected = drag?.moved && draft ? draft : marks.find(a => a.id === selectedId);
  const button = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#D5D4CC] bg-white hover:bg-[#F2F1EB] disabled:opacity-40';

  return (
    <div className="rounded-xl border border-[#E5E4DC] bg-white px-3 py-2 space-y-1.5 select-none">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-[#55544F]">
          <b className="text-[#1C1917] text-sm" title={keyboard ? 'Klavye: Boşluk oynat/durdur · Enter seçili işaret şimdi başlasın / bitsin · ←/→ önceki/sonraki işaret · Shift+←/→ seçili işareti 0,1 sn kaydır · Delete sil' : undefined}>Zaman şeridi</b>
          {compact ? ' · sürükleyin: ne zaman · kenarından: ne kadar' : ' · işareti sürükleyin: ne zaman çıksın · kenarından çekin: ne kadar kalsın (altı çizgi bu sürede çizilir)'}
        </p>
        <span className="flex items-center gap-1" role="group" aria-label="Yakınlaştırma">
          {onFlag && (
            <button type="button" className={`${button} mr-2 border-[#E6B8BF] bg-[#FBF0F1] text-[#8B1E2D] font-semibold hover:bg-[#F6E3E5]`}
              title="Önizlemeyi durdurur ve az önce çıkan işaretin kutusunu seçer"
              onClick={() => {
                if (playing) onPlayPause();
                const mark = markJustSeen(marks, currentTime);
                setSelectedId(mark?.id ?? null);
                onFlag(mark?.targetRegionId ?? null);
              }}>
              <HandPalm size={14} /> Burada hata var
            </button>
          )}
          <button type="button" className={button} onClick={() => setZoomStep(zoom - 1)} disabled={zoom === 0} title="Uzaklaştır"><MagnifyingGlassMinus size={14} /></button>
          <span className="w-10 text-center font-semibold text-[#55544F]">{ZOOMS[zoom]}×</span>
          <button type="button" className={button} onClick={() => setZoomStep(zoom + 1)} disabled={zoom === ZOOMS.length - 1} title="Yakınlaştır: ince ayar için"><MagnifyingGlassPlus size={14} /></button>
          <button type="button" className={button} onClick={() => setZoomStep(0)} disabled={zoom === 0} title="Tüm sesi göster"><ArrowsOutLineHorizontal size={14} /> Tümü</button>
        </span>
      </div>

      <div ref={waveBox} className="rounded-md bg-[#FAF9F5] cursor-pointer" title="Tıklayın ya da sürükleyin: o ana gidin" />

      <div className={compact && laneCount > COMPACT_ROWS ? 'overflow-y-auto rounded-md' : undefined}
        style={compact && laneCount > COMPACT_ROWS ? { maxHeight: COMPACT_ROWS * LANE + 14 } : undefined}
        title={compact && laneCount > COMPACT_ROWS ? 'Diğer işaretler için şeridi aşağı kaydırın' : undefined}>
      <div ref={lanesBox} className="relative overflow-hidden cursor-pointer rounded-md bg-[#FCFBF8]" style={{ height: laneCount * LANE + 8 }}
        onPointerDown={scrub} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {marks.map(mark => {
          const style = MARK[mark.type]!;
          const width = pillSeconds(mark, minSeconds) * pxPerSec;
          const left = px(pillStart(mark, minSeconds, total));
          const top = 4 + lanes.get(mark.id)! * LANE;
          const isSelected = mark.id === selectedId;
          return (
            <React.Fragment key={mark.id}>
              {lasting(mark) && <span className="absolute h-px pointer-events-none" style={{ left: px(mark.start), right: 0, top: top + 12, background: `${style.color}55` }} />}
              <div role="button" aria-label={`${style.name} ${label(mark)} · ${clock(mark.start)}`} title={`${style.name} ${label(mark)} · ${clock(mark.start)} — sürükleyin`}
                className={`absolute h-6 rounded-md text-xs font-semibold text-white flex items-center gap-1 px-2 overflow-hidden cursor-grab active:cursor-grabbing shadow-sm ${isSelected ? 'ring-2 ring-offset-1 ring-[#2563EB]' : 'hover:brightness-110'}`}
                style={{ left, width, top, background: mark.color || style.color }}
                onPointerDown={e => begin(e, mark.id, 'move')}>
                {!lasting(mark) && <span className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-black/15 hover:bg-black/30" title="Başını çekin" onPointerDown={e => begin(e, mark.id, 'start')} />}
                <span className="pl-1">{style.icon}</span><span className="truncate">{label(mark)}</span>
                {!lasting(mark) && <span className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/25 hover:bg-white/50" title="Sonunu çekin: ne kadar kalsın" onPointerDown={e => begin(e, mark.id, 'end')} />}
              </div>
            </React.Fragment>
          );
        })}
        <span className="absolute top-0 bottom-0 w-0.5 -ml-px bg-[#8B1E2D] pointer-events-none" style={{ left: px(currentTime) }} />
      </div>
      </div>

      <div className="min-h-8 flex flex-wrap items-center gap-2 text-xs">
        {selected ? (
          <>
            <span style={{ color: MARK[selected.type]!.color }} className="font-semibold text-sm">{MARK[selected.type]!.icon} {MARK[selected.type]!.name} {label(selected)}</span>
            <span className="font-mono-code text-[#55544F]">{clock(selected.start)}{lasting(selected) ? ' · sona kadar' : ` · ${seconds(selected.duration)}`}</span>
            <span className="flex items-center gap-1 ml-auto flex-wrap">
              <button type="button" className={button} onClick={() => { const m = nudgeAction(selected, -.1, total); replace(m); onSeek(m.start); }} title="0,1 saniye erken"><CaretLeft size={12} /> Erken</button>
              <button type="button" className={button} onClick={() => { const m = nudgeAction(selected, .1, total); replace(m); onSeek(m.start); }} title="0,1 saniye geç">Geç <CaretRight size={12} /></button>
              {!lasting(selected) && <>
                <button type="button" className={button} onClick={() => replace(dragPill(selected, 'end', -.5, total))} title="Yarım saniye kısalt"><Minus size={12} /> Kısa</button>
                <button type="button" className={button} onClick={() => replace(dragPill(selected, 'end', .5, total))} title="Yarım saniye uzat"><Plus size={12} /> Uzun</button>
              </>}
              <button type="button" className={`${button} border-[#8B1E2D] text-[#8B1E2D] font-semibold`} onClick={tap}
                title={tapEnds ? 'Dinlerken işaretin bitmesi gereken anda basın (Enter)' : 'Dinlerken işaretin çıkması gereken anda basın (Enter)'}>
                <Timer size={12} /> {tapEnds ? 'Şimdi bitsin' : 'Şimdi başlasın'}
              </button>
              <button type="button" className={`${button} text-[#8B1E2D]`} onClick={() => remove(selected.id)}><Trash size={12} /> Sil</button>
            </span>
          </>
        ) : (
          <span className="text-[#A8A69E]">Bir işarete tıklayın: “Şimdi” (Enter), erken/geç, kısa/uzun ve sil burada çıkar.</span>
        )}
      </div>
    </div>
  );
}
