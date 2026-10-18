import React, { useEffect, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import { ArrowArcLeft, ArrowClockwise, ArrowCounterClockwise, ArrowsLeftRight, ClipboardText, Copy, MapPin, Trash, X } from '@phosphor-icons/react';
import type { AnnotationRegion, VideoAction } from '../../types';
import type { FitRect } from './engine/types';
import { ARROW_COLOR, NOTE_COLOR, regionCanvasRect, underlineY } from './engine/renderer';
import { clock, moveRegion, nudgeAction } from '../question-editor/workflow';
import { cueTitle, withLineOffset } from './markLabels';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
/** A corner, or one side: 'w' / 'e' move only the left / right edge, 'n' / 's' only the top / bottom. */
type Handle = Corner | 'n' | 's' | 'e' | 'w';
const MIN_SIZE = .01;
const ICON: Partial<Record<VideoAction['type'], { icon: string; color: string; name: string }>> = {
  reject: { icon: '✗', color: '#8B1E2D', name: 'Çarpı' }, correct: { icon: '✓', color: '#15803D', name: 'Doğru işareti' },
  focus: { icon: '◎', color: '#4338CA', name: 'Çerçeve' }, circle: { icon: '◯', color: '#DC2626', name: 'Daire' },
  underline: { icon: '▁', color: '#D97706', name: 'Altı çizgi' },
  highlight: { icon: '▮', color: '#B45309', name: 'Vurgu' },
  arrow: { icon: '➜', color: ARROW_COLOR, name: 'Ok' }, note: { icon: 'T', color: NOTE_COLOR, name: 'Yazı' },
};
/** Colours a teacher can give an underline, a ring, an arrow or a note. */
export const MARK_COLORS = [
  { color: '#DC2626', name: 'Kırmızı' }, { color: '#D97706', name: 'Turuncu' }, { color: '#16A34A', name: 'Yeşil' },
  { color: ARROW_COLOR, name: 'Mavi' }, { color: NOTE_COLOR, name: 'Mor' }, { color: '#1C1917', name: 'Siyah' },
];
const COLORABLE = new Set<VideoAction['type']>(['underline', 'circle', 'arrow', 'note']);
/** "A şıkkı" or the phrase the box holds. */
const boxName = (region: AnnotationRegion, regions: AnnotationRegion[]) =>
  cueTitle({ type: 'reset', targetRegionId: region.id } as VideoAction, regions);

/** Boxes a teacher can pick on the picture: options and phrases, not the frame around the whole question. */
export const pickableRegions = (regions: AnnotationRegion[]) => regions.filter(r => r.id !== 'question-root' && r.height <= .5);

/** Marks of one box that are on screen at `time` (crosses and ticks stay to the end). */
export const marksAt = (actions: VideoAction[], regionId: string, time: number) =>
  actions.filter(a => a.targetRegionId === regionId && ICON[a.type] && time >= a.start - .01 && time <= a.start + a.duration + .01);

/** Drags one corner or side; the opposite edge stays put and the box never turns inside out or leaves the image. */
export function resizeRegion(region: AnnotationRegion, handle: Handle, dx: number, dy: number): AnnotationRegion {
  let left = region.x, top = region.y, right = region.x + region.width, bottom = region.y + region.height;
  if (handle.includes('w')) left = Math.max(0, Math.min(right - MIN_SIZE, left + dx));
  else if (handle.includes('e')) right = Math.min(1, Math.max(left + MIN_SIZE, right + dx));
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - MIN_SIZE, top + dy));
  else if (handle.includes('s')) bottom = Math.min(1, Math.max(top + MIN_SIZE, bottom + dy));
  return { ...region, x: left, y: top, width: right - left, height: bottom - top, manuallyAdjusted: true };
}

/** Marks a teacher can put on the picture, in toolbar order. */
export const TOOLS = ['reject', 'correct', 'focus', 'circle', 'underline', 'highlight', 'arrow', 'note'] as const;
export type Tool = typeof TOOLS[number];

/**
 * A new mark at `time` on a box. Crosses and ticks stay to the end; frames, underlines and
 * highlights for a moment. A cross or tick replaces the box's earlier verdict.
 */
export function addMark(actions: VideoAction[], regionId: string, tool: Tool, time: number, total: number): VideoAction[] {
  const start = Math.max(0, Math.min(total - .1, time));
  const lasting = tool === 'reject' || tool === 'correct';
  const duration = lasting ? total - start : Math.min(tool === 'note' ? 4 : tool === 'focus' || tool === 'circle' || tool === 'arrow' ? 2.5 : 2, total - start);
  const mark: VideoAction = { id: `manual-${regionId}-${tool}-${Math.round(start * 1000)}-${actions.length}`, type: tool, targetRegionId: regionId,
    regionId, start, startTime: start, duration, label: `${tool}: elle eklendi` };
  // A box has one verdict: a new cross or tick replaces whichever it had.
  return [...actions.filter(a => !(lasting && a.targetRegionId === regionId && (a.type === 'reject' || a.type === 'correct'))), mark]
    .sort((a, b) => a.start - b.start);
}

/**
 * A copy of a box (Ctrl+V): a little down and to the right so it can be seen and dragged, with the
 * box's marks starting at the paused moment (crosses and ticks still last to the end).
 */
export function pastedBox(region: AnnotationRegion, marks: VideoAction[], id: string, time: number, total: number) {
  const nudge = (v: number, size: number) => Math.max(0, Math.min(1 - size, v + .02));
  const copy: AnnotationRegion = { ...region, id, type: 'keyword', label: 'Kopya', content: undefined, x: nudge(region.x, region.width), y: nudge(region.y, region.height), manuallyAdjusted: true };
  const first = marks.length ? Math.min(...marks.map(m => m.start)) : time;
  const copiedMarks = marks.map((m, i) => {
    const start = Math.max(0, Math.min(total - .1, time + (m.start - first)));
    const lasting = m.type === 'reject' || m.type === 'correct';
    return { ...m, id: `manual-${id}-${m.type}-${i}`, targetRegionId: id, regionId: id, start, startTime: start,
      duration: lasting ? total - start : Math.max(.3, Math.min(m.duration, total - start)), label: `${m.type}: kopya` };
  });
  return { region: copy, marks: copiedMarks };
}

/** A box drawn from one corner to the other, in image coordinates (0–1), kept on the image. */
export function drawnRegion(id: string, x1: number, y1: number, x2: number, y2: number): AnnotationRegion {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const left = clamp(Math.min(x1, x2)), top = clamp(Math.min(y1, y2));
  return { id, type: 'keyword', label: 'Elle eklenen alan', x: left, y: top,
    width: clamp(Math.max(x1, x2)) - left, height: clamp(Math.max(y1, y2)) - top, manuallyAdjusted: true };
}

type Gesture =
  | { mode: 'move' | Handle; x: number; y: number; region: AnnotationRegion }
  | { mode: 'line'; x: number; y: number; action: VideoAction; heightPx: number }
  /** A new place drawn with a tool; started on a box, a plain click marks that box instead. */
  | { mode: 'draw'; x: number; y: number; ix: number; iy: number; boxId?: string };

/**
 * The place a drawn stroke becomes: a box as drawn, or, for a flat stroke drawn with the underline
 * tool, the text line it sits under (one usual text height above the stroke). Null for a stray click.
 */
export function placeFromStroke(drawn: AnnotationRegion, tool: Tool, fit: FitRect, _lineHeight: number): AnnotationRegion | null {
  const wide = drawn.width * fit.width > 12, tall = drawn.height * fit.height > 8;
  if (tool === 'underline') return wide ? lineAt(drawn, drawn.y + drawn.height) : null;
  if (wide && tall) return drawn;
  return null;
}

/** Height of a drawn line's box (a share of the picture): the line runs through its middle. */
export const LINE_BOX = .016;
/** A line along `drawn`'s width whose middle is at `y`. */
const lineAt = (drawn: AnnotationRegion, y: number): AnnotationRegion =>
  ({ ...drawn, y: Math.max(0, Math.min(1 - LINE_BOX, y - LINE_BOX / 2)), height: LINE_BOX, shape: 'line' });

/** Smallest side of an arrow's box, in canvas pixels: a flat arrow still has a box to grab. */
const ARROW_MIN = 28;

/**
 * An arrow dragged from (x1, y1) to (x2, y2) on the image: its box and where tail and head sit in it.
 * Null for a stroke too short to be an arrow.
 */
export function arrowFromStroke(id: string, x1: number, y1: number, x2: number, y2: number, fit: FitRect): AnnotationRegion | null {
  if (Math.hypot((x2 - x1) * fit.width, (y2 - y1) * fit.height) < 24) return null;
  const span = (a: number, b: number, size: number) => {
    const min = ARROW_MIN / size, lo = Math.min(a, b), length = Math.abs(b - a);
    if (length >= min) return { from: Math.max(0, lo), size: Math.min(1 - Math.max(0, lo), length), flat: false };
    return { from: Math.max(0, Math.min(1 - min, (a + b) / 2 - min / 2)), size: min, flat: true };
  };
  const h = span(x1, x2, fit.width), v = span(y1, y2, fit.height);
  const at = (p: number, s: typeof h) => s.flat ? .5 : Math.max(0, Math.min(1, (p - s.from) / s.size));
  return { id, type: 'keyword', label: 'Ok', x: h.from, y: v.from, width: h.size, height: v.size, manuallyAdjusted: true, shape: 'arrow',
    arrow: { x1: at(x1, h), y1: at(y1, v), x2: at(x2, h), y2: at(y2, v) } };
}

/** A note box: as dragged, or (for a click) a short label centred where clicked. */
export function noteAt(id: string, ix: number, iy: number, fit: FitRect, scale: number, dragged?: AnnotationRegion | null): AnnotationRegion {
  const base = { id, type: 'keyword' as const, label: 'Yazı', manuallyAdjusted: true, shape: 'note' as const, text: 'Not' };
  if (dragged && dragged.width * fit.width > 40 && dragged.height * fit.height > 20) return { ...dragged, ...base };
  const width = Math.min(1, 260 * scale / fit.width), height = Math.min(1, 64 * scale / fit.height);
  return { ...base, x: Math.max(0, Math.min(1 - width, ix - width / 2)), y: Math.max(0, Math.min(1 - height, iy - height / 2)), width, height };
}

/** The box back where the studio found it ("Otomatiğe döndür"); unchanged when it was never moved. */
export function revertToAuto(region: AnnotationRegion): AnnotationRegion {
  if (!region.auto) return region;
  const { auto, manuallyAdjusted: _manual, ...rest } = region;
  return { ...rest, ...auto };
}

/** One colour for every colourable mark of a box. */
/** The box's underlines drawn the other way: right to left (as Arabic is read) or left to right. */
export function flipUnderlines(actions: VideoAction[], regionId: string): VideoAction[] {
  const lines = actions.filter(a => a.targetRegionId === regionId && a.type === 'underline');
  const fromLeft = !lines.every(a => a.fromLeft);
  return actions.map(a => {
    if (!lines.includes(a)) return a;
    const { fromLeft: _old, ...rest } = a;
    return fromLeft ? { ...rest, fromLeft: true } : rest;
  });
}

export const recolor = (actions: VideoAction[], regionId: string, color: string): VideoAction[] =>
  actions.map(a => a.targetRegionId === regionId && COLORABLE.has(a.type) ? { ...a, color } : a);

/** A ✗ or ✓ stamp of `side` canvas pixels centred where the teacher clicked (image shares). */
export function stampAt(id: string, ix: number, iy: number, fit: FitRect, side: number): AnnotationRegion {
  const width = side / fit.width, height = side / fit.height;
  return { id, type: 'keyword', label: 'Elle eklenen işaret', x: Math.max(0, Math.min(1 - width, ix - width / 2)),
    y: Math.max(0, Math.min(1 - height, iy - height / 2)), width, height, manuallyAdjusted: true, shape: 'stamp' };
}

/**
 * A line dropped close under printed text sits exactly under it: the nearest text box (a phrase,
 * an option, a line found earlier) whose bottom is within half a line of the stroke and which
 * overlaps it sideways lends the line its top and bottom. Otherwise the line stays where it was drawn.
 */
export function snapToText(place: AnnotationRegion, regions: AnnotationRegion[], lineHeight: number): AnnotationRegion {
  const bottom = place.y + place.height;
  const near = regions
    .filter(r => r.id !== 'question-root' && r.height <= .2 && r.x < place.x + place.width && r.x + r.width > place.x)
    .map(r => ({ r, gap: Math.abs(r.y + r.height - bottom) }))
    .filter(n => n.gap <= lineHeight * .5)
    .sort((a, b) => a.gap - b.gap)[0];
  // Just under the text: the line's middle a little below the text's bottom.
  return near ? { ...place, y: Math.min(1 - place.height, near.r.y + near.r.height + .004 - place.height / 2) } : place;
}

/** The usual height of a text line on this question: the median phrase box, else 5% of the image. */
export function typicalLineHeight(regions: AnnotationRegion[]): number {
  const heights = regions.filter(r => r.content && !r.type.startsWith('option') && r.height > 0 && r.height <= .2).map(r => r.height).sort((a, b) => a - b);
  return heights.length ? heights[Math.floor(heights.length / 2)] : .05;
}

interface Props {
  fit: FitRect;
  canvasWidth: number;
  canvasHeight: number;
  regions: AnnotationRegion[];
  actions: VideoAction[];
  time: number;
  total: number;
  underlineOffset?: number;
  /** New boxes can carry their first mark (`add`), saved in the same step. */
  onRegions: (regions: AnnotationRegion[], add?: VideoAction[]) => void;
  onActions: (actions: VideoAction[]) => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  /** The teacher says a box is option `letter` (the system then knows where "C şıkkı" is). */
  onAssignOption?: (boxId: string, letter: string) => void;
  /** A missing option to show on the picture: draw its box, or click the box that is it. */
  drawOption?: string | null;
  onDrawOptionDone?: () => void;
  /** A box to select at once ("Burada hata var" on the mark strip). */
  focusBox?: { id: string } | null;
}

/** The copied box lives outside the overlay, which is rebuilt every time the preview pauses. */
let copied: { region: AnnotationRegion; marks: VideoAction[] } | null = null;

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/**
 * On-picture editing of the paused preview: click a box to select it, drag it to move,
 * drag a corner to resize, drag its underline up or down, and change its marks from the
 * small menu next to it. Every change goes through the same data the exported MP4 uses.
 */
export function PreviewEditOverlay({ fit, canvasWidth, canvasHeight, regions, actions, time, total, underlineOffset = 0, onRegions, onActions, onUndo, canUndo, onRedo, canRedo, onAssignOption, drawOption, onDrawOptionDone, focusBox }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [draft, setDraft] = useState<AnnotationRegion | VideoAction | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [hasCopy, setHasCopy] = useState(!!copied);
  /** Where the pointer is while an arrow is drawn (its head). */
  const [pointer, setPointer] = useState<{ ix: number; iy: number } | null>(null);
  useEffect(() => { if (focusBox && !tool && !drawOption) setSelectedId(focusBox.id); }, [focusBox]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const onPicture = useRef(false);
  useEffect(() => {
    // Capture: runs before the page's Esc (leaving full screen), so Esc first lets go of a box or tool.
    const key = (e: KeyboardEvent) => keys.current(e);
    // Delete and copy act on the picture only when the teacher last clicked there (not on the strip's marks).
    const click = (e: PointerEvent) => { onPicture.current = !!box.current?.contains(e.target as Node); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', click, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', click, true); };
  }, []);
  // Showing a missing option puts the tools aside.
  useEffect(() => { if (drawOption) { setTool(null); setSelectedId(null); } }, [drawOption]);
  const drawing = !!tool || !!drawOption;

  const picks = pickableRegions(regions);
  const selected = picks.find(r => r.id === selectedId);
  // The selection frame follows the box at once when it is resized or moved (not one step later).
  const frame = useRef<Moveable>(null);
  useEffect(() => { frame.current?.updateRect(); },
    [selected?.x, selected?.y, selected?.width, selected?.height, canvasWidth, canvasHeight, fit.x, fit.y, fit.width, fit.height]);
  const shown = (r: AnnotationRegion) => draft && 'x' in draft && draft.id === r.id ? draft : r;
  // Percent of the overlay for a rectangle in canvas pixels.
  const pct = (rect: FitRect) => ({ left: `${rect.x / canvasWidth * 100}%`, top: `${rect.y / canvasHeight * 100}%`,
    width: `${rect.width / canvasWidth * 100}%`, height: `${rect.height / canvasHeight * 100}%` });
  const pxPerCanvas = () => (box.current?.clientWidth || canvasWidth) / canvasWidth;
  const scale = Math.min(canvasWidth / 1920, canvasHeight / 1080);

  const begin = (e: React.PointerEvent, next: Gesture) => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGesture(next);
  };
  /** Pointer position on the image, 0–1. */
  const onImage = (e: React.PointerEvent) => {
    const bounds = box.current!.getBoundingClientRect(), px = pxPerCanvas();
    return { ix: ((e.clientX - bounds.left) / px - fit.x) / fit.width, iy: ((e.clientY - bounds.top) / px - fit.y) / fit.height };
  };
  const drag = (e: React.PointerEvent) => {
    if (!gesture) return;
    const px = pxPerCanvas();
    if (gesture.mode === 'draw') {
      const { ix, iy } = onImage(e);
      // The underline tool draws a flat line of fixed thickness: only its length follows the pointer.
      setDraft(drawnRegion('drawing', gesture.ix, gesture.iy, ix, tool === 'underline' ? gesture.iy : iy));
      setPointer({ ix, iy });
      return;
    }
    if (gesture.mode === 'line') {
      const delta = (e.clientY - gesture.y) / px / gesture.heightPx;
      setDraft(withLineOffset(gesture.action, Math.round(delta * 20) / 20));
      return;
    }
    const dx = (e.clientX - gesture.x) / px / fit.width, dy = (e.clientY - gesture.y) / px / fit.height;
    setDraft(gesture.mode === 'move' ? moveRegion(gesture.region, dx, dy) : resizeRegion(gesture.region, gesture.mode, dx, dy));
  };
  const end = () => {
    if (gesture?.mode === 'draw' && drawOption) {
      // A box drawn for the missing option, or a click on the box that is it.
      const drawn = draft && 'x' in draft ? placeFromStroke(draft, 'focus', fit, 0) : null;
      if (drawn) {
        const id = `option-${drawOption.toLowerCase()}`;
        onRegions([...regions.filter(r => r.id !== id), { ...drawn, id, type: id as AnnotationRegion['type'], label: `${drawOption} Şıkkı` }]);
        setSelectedId(id); onDrawOptionDone?.();
      } else if (gesture.boxId && onAssignOption) {
        onAssignOption(gesture.boxId, drawOption);
        setSelectedId(`option-${drawOption.toLowerCase()}`); onDrawOptionDone?.();
      }
    } else if (gesture?.mode === 'draw') {
      // A drawn place (anywhere, even over a found box) gets the chosen mark; a click on a box marks that box.
      const lineHeight = typicalLineHeight(regions);
      const stamp = tool === 'reject' || tool === 'correct';
      const arrow = tool === 'arrow' && pointer ? arrowFromStroke(`manual-box-${Date.now()}`, gesture.ix, gesture.iy, pointer.ix, pointer.iy, fit) : null;
      const stroke = tool && !stamp && tool !== 'arrow' && tool !== 'note' && draft && 'x' in draft ? placeFromStroke(draft, tool, fit, lineHeight) : null;
      const place = stroke && tool === 'underline' ? snapToText(stroke, regions, lineHeight)
        : stroke ? { ...stroke, shape: 'drawn' as const } : null;
      const dragged = draft && 'x' in draft && (draft.width * fit.width > 12 || draft.height * fit.height > 8);
      if (arrow) {
        // An arrow points from where the drag began to where it ended; the tool stays on to draw more.
        onRegions([...regions, arrow], addMark([], arrow.id, 'arrow', time, total));
      } else if (tool === 'note') {
        // A note goes where clicked (or fills the dragged area); its text is typed in the small bar.
        const note = noteAt(`manual-box-${Date.now()}`, gesture.ix, gesture.iy, fit, scale, draft && 'x' in draft ? draft : null);
        onRegions([...regions, note], addMark([], note.id, 'note', time, total));
        setSelectedId(note.id); setTool(null);
      } else if (stamp && (dragged || !gesture.boxId)) {
        // ✗ and ✓ are stamps: put where clicked (or in the middle of a dragged area), not beside a box.
        const id = `manual-box-${Date.now()}`;
        const at = draft && 'x' in draft && dragged ? { ix: draft.x + draft.width / 2, iy: draft.y + draft.height / 2 } : gesture;
        onRegions([...regions, stampAt(id, at.ix, at.iy, fit, 44 * scale)], addMark([], id, tool!, time, total));
        setSelectedId(id); setTool(null);
      } else if (tool && place) {
        const id = `manual-box-${Date.now()}`;
        // Every mark starts at the paused moment, so it shows at once; its time is set on the strip.
        // The underline tool stays on to draw several lines; the line flows the way it was dragged.
        const line = tool === 'underline';
        const fromLeft = line && draft && 'x' in draft && gesture.ix <= draft.x + draft.width / 2;
        const marks = addMark([], id, tool, time, total).map(m => fromLeft ? { ...m, fromLeft: true } : m);
        onRegions([...regions, { ...place, id }], marks);
        if (!line) { setSelectedId(id); setTool(null); }
      } else if (gesture.boxId && tool !== 'arrow') markBox(gesture.boxId);
    } else if (gesture && draft && 'x' in draft) onRegions(regions.map(r => r.id === draft.id ? draft : r));
    else if (gesture && draft) onActions(actions.map(a => a.id === draft.id ? draft as VideoAction : a));
    // A box moved with the selection frame (react-moveable) is saved by its own end handlers.
    if (gesture) { setGesture(null); setDraft(null); setPointer(null); }
  };

  /** The selected box on screen, which the selection frame (react-moveable) moves and resizes. */
  const boxes = useRef(new Map<string, HTMLDivElement>());
  const latest = useRef<AnnotationRegion | null>(null);
  /** The box's own size styles while react-moveable resizes it on screen. */
  const resizing = useRef<{ width: string; height: string } | null>(null);
  /** A box from its on-screen position and size (overlay pixels), kept on the image. */
  const fromScreen = (region: AnnotationRegion, left: number, top: number, width: number, height: number): AnnotationRegion => {
    const px = pxPerCanvas();
    const x = (left / px - fit.x) / fit.width, y = (top / px - fit.y) / fit.height;
    const w = width / px / fit.width, h = height / px / fit.height;
    const clampedX = Math.max(0, Math.min(1 - Math.min(1, w), x)), clampedY = Math.max(0, Math.min(1 - Math.min(1, h), y));
    return { ...region, x: clampedX, y: clampedY, width: Math.min(1, w), height: Math.min(1, h), manuallyAdjusted: true };
  };
  const preview = (next: AnnotationRegion) => { latest.current = next; setDraft(next); };
  const commit = () => {
    const next = latest.current;
    latest.current = null; setDraft(null);
    if (next) onRegions(regions.map(r => r.id === next.id ? next : r));
  };

  const removeMark = (id: string) => onActions(actions.filter(a => a.id !== id));
  const markHere = (action: VideoAction) => onActions(actions.map(a => a.id === action.id ? nudgeAction(a, time - a.start, total) : a));
  const removeBox = (id: string) => { setSelectedId(null); onRegions(regions.filter(r => r.id !== id)); };
  const markBox = (id: string) => { if (tool) { onActions(addMark(actions, id, tool, time, total)); setSelectedId(id); setTool(null); } };
  const copy = (region: AnnotationRegion) => {
    copied = { region, marks: actions.filter(a => a.targetRegionId === region.id && ICON[a.type]) };
    setHasCopy(true);
  };
  const paste = () => {
    const source = copied;
    if (!source) return;
    const pasted = pastedBox(source.region, source.marks, `manual-box-${Date.now()}`, time, total);
    onRegions([...regions, pasted.region], pasted.marks);
    setSelectedId(pasted.region.id);
  };
  keys.current = e => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (selectedId || tool || drawOption) { e.preventDefault(); setSelectedId(null); setTool(null); onDrawOptionDone?.(); }
      return;
    }
    if (!ctrl && (e.key === 'Delete' || e.key === 'Backspace') && selected && onPicture.current) { e.preventDefault(); removeBox(selected.id); return; }
    if (!ctrl || e.altKey) return;
    const k = e.key.toLowerCase();
    // Ctrl+Y or Ctrl+Shift+Z brings back what Ctrl+Z took away.
    if ((k === 'y' || (k === 'z' && e.shiftKey)) && onRedo && canRedo) { e.preventDefault(); onRedo(); return; }
    if (e.shiftKey) return;
    if (k === 'z' && onUndo && canUndo) { e.preventDefault(); onUndo(); return; }
    if (k === 'c' && selected && onPicture.current && !window.getSelection()?.toString()) {
      e.preventDefault();
      copy(selected);
      return;
    }
    if (k === 'v' && copied) { e.preventDefault(); paste(); }
  };

  const selectedRect = selected ? regionCanvasRect(shown(selected), fit) : null;
  const selectedMarks = selected ? actions.filter(a => a.targetRegionId === selected.id && ICON[a.type]).sort((a, b) => a.start - b.start) : [];
  const line = selected && selectedRect ? selectedMarks.find(a => a.type === 'underline') : undefined;
  const lineAction = line && draft && !('x' in draft) && draft.id === line.id ? draft as VideoAction : line;
  const menuBelow = selectedRect ? selectedRect.y + selectedRect.height < canvasHeight * .62 : true;

  return (
    <div ref={box} className={`absolute inset-0 z-10 ${drawing ? 'cursor-crosshair' : ''}`} onPointerMove={drag} onPointerUp={end} onPointerCancel={end}
      onPointerDown={e => {
        // The selection frame's handles sit on this layer: pressing one keeps the box selected.
        if ((e.target as HTMLElement).closest('.moveable-control-box')) return;
        setSelectedId(null);
        if (!drawing) return;
        const { ix, iy } = onImage(e);
        begin(e, { mode: 'draw', x: e.clientX, y: e.clientY, ix, iy });
      }}>
      <div role="toolbar" aria-label="İşaret araçları" className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 p-1 rounded-xl bg-white/95 shadow-md border border-[#D5D4CC]"
        onPointerDown={e => e.stopPropagation()}>
        <button type="button" aria-pressed={!tool} onClick={() => setTool(null)} title="Seç ve taşı"
          className={`w-9 h-9 rounded-lg text-[15px] ${!tool ? 'bg-[#1C1917] text-white' : 'hover:bg-[#F2F1EB] text-[#33322E]'}`}>↖</button>
        {TOOLS.map(t => (
          <button key={t} type="button" aria-pressed={tool === t} onClick={() => { setTool(tool === t ? null : t); setSelectedId(null); onDrawOptionDone?.(); }}
            title={`${ICON[t]!.name} ekle`} aria-label={`${ICON[t]!.name} ekle`}
            className={`w-9 h-9 rounded-lg text-[16px] font-bold ${tool === t ? 'text-white' : 'hover:bg-[#F2F1EB]'}`}
            style={tool === t ? { background: ICON[t]!.color } : { color: ICON[t]!.color }}>{ICON[t]!.icon}</button>
        ))}
      </div>
      <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-auto" onPointerDown={e => e.stopPropagation()}>
        <span className={`px-2 py-1 rounded-md text-white text-xs ${drawOption ? 'bg-[#8B1E2D] font-semibold' : 'bg-black/60'}`}>
          {drawOption ? `${drawOption} şıkkı: kutusunu görselde sürükleyerek çizin ya da onu gösteren kutuya tıklayın · Esc: vazgeç` : tool === 'underline' ? 'Alt çizgi: başlangıca basın, sağa ya da sola sürükleyip bırakın · yazının altına bırakırsanız satıra oturur · bitince Esc'
            : tool === 'arrow' ? 'Ok: kuyruğundan basın, ucunun gideceği yere sürükleyip bırakın · bitince Esc'
            : tool === 'note' ? `Yazı: yazının çıkacağı yere tıklayın, sonra metni küçük çubuğa yazın · ${clock(time)} anında eklenir`
            : tool ? `${ICON[tool]!.name}: istediğiniz yere sürükleyip alan çizin ya da bir kutuya tıklayın · ${clock(time)} anında eklenir` : 'Düzenlemek için bir kutuya tıklayın · soldan işaret ekleyin'}
        </span>
        {onUndo && <button type="button" disabled={!canUndo} onClick={onUndo} title="Son değişikliği geri al"
          className="px-2 py-1 rounded-md bg-white/90 text-xs font-semibold text-[#33322E] inline-flex items-center gap-1 disabled:opacity-40">
          <ArrowCounterClockwise size={12} /> Geri al
        </button>}
        {onRedo && <button type="button" disabled={!canRedo} onClick={onRedo} title="Geri alınanı yinele (Ctrl+Y)"
          className="px-2 py-1 rounded-md bg-white/90 text-xs font-semibold text-[#33322E] inline-flex items-center gap-1 disabled:opacity-40">
          <ArrowClockwise size={12} /> Yinele
        </button>}
        {hasCopy && !selected && !drawing && <button type="button" onClick={paste} title="Kopyalanan kutuyu buraya yapıştır (Ctrl+V)"
          className="px-2 py-1 rounded-md bg-white/90 text-xs font-semibold text-[#33322E]">Yapıştır</button>}
      </div>

      {picks.map(region => {
        const r = shown(region);
        const rect = regionCanvasRect(r, fit);
        const active = marksAt(actions, region.id, time);
        const isSelected = region.id === selectedId;
        const color = region.shape ? undefined : ICON[active[0]?.type]?.color;
        // A stamp, a line or a drawn ring is the mark itself: grab it where it is drawn.
        const shapeClass = region.shape === 'stamp' ? 'rounded-full' : region.shape === 'line' ? 'rounded-full' : region.shape === 'drawn' ? 'rounded-[40%]' : region.shape === 'note' ? 'rounded-lg' : 'rounded-[3px]';
        return (
          <div key={region.id} role="button" aria-label={`${region.shape ? (active[0] ? ICON[active[0].type]!.name : 'İşaret') : boxName(region, regions)} kutusu`}
            title="Seç: taşımak için sürükleyin"
            className={`absolute ${shapeClass} ${drawing ? `cursor-crosshair ${region.shape ? '' : 'border border-dashed border-[#2563EB]/60'} hover:bg-[#2563EB]/10` : 'cursor-move'} transition-[border-color] ${drawing ? '' : isSelected ? (region.shape ? 'border border-dashed border-[#2563EB]' : 'border-2 border-[#2563EB] bg-[#2563EB]/5') : color ? 'border-2' : 'border border-dashed border-white/0 hover:border-[#2563EB]/70'}`}
            style={{ ...pct(rect), ...(isSelected || !color ? {} : { borderColor: `${color}AA` }) }}
            ref={el => { if (el) boxes.current.set(region.id, el); else boxes.current.delete(region.id); }}
            onPointerDown={e => {
              if (drawing) { setSelectedId(null); begin(e, { mode: 'draw', x: e.clientX, y: e.clientY, ...onImage(e), boxId: region.id }); return; }
              // The selected box is moved by its selection frame; another box is picked and dragged at once.
              if (isSelected) { e.stopPropagation(); return; }
              setSelectedId(region.id); begin(e, { mode: 'move', x: e.clientX, y: e.clientY, region });
            }} />
        );
      })}

      {selected && !drawing && boxes.current.get(selected.id) && (
        <Moveable ref={frame} key={selected.id} target={boxes.current.get(selected.id)!} draggable resizable origin={false} keepRatio={selected.shape === 'stamp'}
          // A line is lengthened from its two ends, a stamp sized from its corners; a box from every side.
          renderDirections={selected.shape === 'stamp' ? ['nw', 'ne', 'sw', 'se']
            : selected.shape === 'line' || (selectedMarks.length && selectedMarks.every(m => m.type === 'underline')) ? ['w', 'e']
            : ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
          hideDefaultLines={selected.shape === 'stamp' || selected.shape === 'line'} throttleDrag={0} throttleResize={0}
          // Alignment guides: edges and centres line up with the text boxes and the other marks.
          snappable snapThreshold={6} isDisplaySnapDigit={false}
          snapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}
          elementSnapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}
          elementGuidelines={[...boxes.current.entries()].filter(([id]) => id !== selected.id).map(([, el]) => el)}
          onDrag={e => preview(fromScreen(selected, e.left, e.top, e.width, e.height))}
          onDragEnd={commit}
          // Resizing follows react-moveable's own pattern: the box is sized on screen, then saved once.
          onResizeStart={e => { resizing.current = { width: e.target.style.width, height: e.target.style.height }; }}
          onResize={e => { e.target.style.width = `${e.width}px`; e.target.style.height = `${e.height}px`; e.target.style.transform = e.drag.transform; }}
          onResizeEnd={e => {
            const el = e.target as HTMLElement, rect = el.getBoundingClientRect(), frame = box.current!.getBoundingClientRect();
            Object.assign(el.style, resizing.current ?? {}, { transform: '' });
            resizing.current = null;
            if (e.lastEvent) preview(fromScreen(selected, rect.left - frame.left, rect.top - frame.top, rect.width, rect.height));
            commit();
          }} />
      )}

      {gesture?.mode === 'draw' && draft && 'x' in draft && tool === 'underline' && (() => {
        const rect = regionCanvasRect(draft, fit);
        return <div className="absolute rounded-full pointer-events-none bg-[#D97706] shadow-[0_0_0_2px_white]"
          style={{ left: `${rect.x / canvasWidth * 100}%`, width: `${Math.max(rect.width, 2) / canvasWidth * 100}%`,
            top: `${(rect.y - Math.max(2, 2.5 * scale)) / canvasHeight * 100}%`, height: `${Math.max(4, 5 * scale) / canvasHeight * 100}%` }} />;
      })()}
      {gesture?.mode === 'draw' && tool === 'arrow' && pointer && (() => {
        const at = (ix: number, iy: number) => ({ x: (fit.x + ix * fit.width) / canvasWidth * 100, y: (fit.y + iy * fit.height) / canvasHeight * 100 });
        const a = at(gesture.ix, gesture.iy), b = at(pointer.ix, pointer.iy);
        return (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ARROW_COLOR} strokeWidth={4 * scale} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
            <circle cx={b.x} cy={b.y} r={.6} fill={ARROW_COLOR} />
          </svg>
        );
      })()}
      {gesture?.mode === 'draw' && draft && 'x' in draft && tool !== 'underline' && tool !== 'arrow' && tool !== 'reject' && tool !== 'correct' && (
        <div className={`absolute border-2 ${tool === 'circle' ? 'rounded-[50%]' : 'border-dashed rounded-[3px]'} pointer-events-none`} style={{ ...pct(regionCanvasRect(draft, fit)), borderColor: tool ? ICON[tool]!.color : drawOption ? '#8B1E2D' : '#2563EB' }} />
      )}

      {selected && selectedRect && lineAction && selected.shape !== 'line' && (
        <div role="slider" aria-label="Altı çizgiyi yukarı-aşağı sürükleyin" aria-valuenow={lineAction.lineOffset ?? 0} title="Çizgiyi yukarı-aşağı sürükleyin"
          className="absolute cursor-ns-resize flex items-center"
          style={{ left: pct(selectedRect).left, width: pct(selectedRect).width,
            top: `${(underlineY(selectedRect, scale, underlineOffset + (lineAction.lineOffset ?? 0)) - 8 * scale) / canvasHeight * 100}%`, height: `${16 * scale / canvasHeight * 100}%` }}
          onPointerDown={e => begin(e, { mode: 'line', x: e.clientX, y: e.clientY, action: line!, heightPx: selectedRect.height })}>
          <span className="w-full h-[3px] rounded bg-[#D97706] shadow-[0_0_0_2px_white]" />
        </div>
      )}

      {selected && selectedRect && !gesture && !draft && (
        // A small bar by the selection: its marks (time, move to now, delete), colour, option letter, copy, remove.
        <div className="absolute flex flex-wrap items-center gap-1 max-w-[92%] rounded-lg bg-white/95 shadow-lg border border-[#D5D4CC] text-xs text-[#33322E] px-1.5 py-1"
          style={{ left: `${Math.min(selectedRect.x / canvasWidth * 100, 55)}%`,
            ...(menuBelow ? { top: `calc(${(selectedRect.y + selectedRect.height) / canvasHeight * 100}% + 10px)` }
              : { bottom: `calc(${(1 - selectedRect.y / canvasHeight) * 100}% + 10px)` }) }}
          onPointerDown={e => e.stopPropagation()}>
          {!selected.shape && <b className="px-1 max-w-[11rem] truncate" title={boxName(selected, regions)}>{boxName(selected, regions)}</b>}
          {selectedMarks.length === 0 && <span className="px-1 text-[#787670]">İşaret yok</span>}
          {selectedMarks.map(mark => (
            <span key={mark.id} className="inline-flex items-center gap-0.5 rounded border border-[#E5E4DC] pl-1" title={`${ICON[mark.type]!.name} · ${clock(mark.start)}`}>
              <span className="font-bold" style={{ color: ICON[mark.type]!.color }}>{ICON[mark.type]!.icon}</span>
              <span className="font-mono-code">{clock(mark.start)}</span>
              <button type="button" onClick={() => markHere(mark)} disabled={Math.abs(mark.start - time) < .05} title={`${clock(time)} anına al`}
                className="p-1 rounded hover:bg-[#F2F1EB] disabled:opacity-30" aria-label="Buraya al"><MapPin size={11} /></button>
              <button type="button" onClick={() => removeMark(mark.id)} title="İşareti sil" aria-label="İşareti sil"
                className="p-1 rounded text-[#8B1E2D] hover:bg-red-50"><X size={11} /></button>
            </span>
          ))}
          {onAssignOption && (selected.type.startsWith('option-') || (!selected.content && !selected.shape)) && (
            <span className="inline-flex items-center gap-0.5" role="group" aria-label="Bu kutu hangi şık?">
              <span className="text-[#787670] px-0.5">Şık:</span>
              {LETTERS.map(letter => {
                const current = selected.id === `option-${letter.toLowerCase()}`;
                return (
                  <button key={letter} type="button" aria-pressed={current} disabled={current}
                    onClick={() => { onAssignOption(selected.id, letter); setSelectedId(`option-${letter.toLowerCase()}`); }}
                    title={current ? `Bu kutu ${letter} şıkkı` : `Bu kutu ${letter} şıkkı: çarpısı ya da tiki sese göre kendiliğinden gelsin`}
                    className={`w-5 h-5 rounded border font-bold ${current ? 'bg-[#8B1E2D] border-[#8B1E2D] text-white' : 'bg-white hover:border-[#8B1E2D] hover:text-[#8B1E2D]'}`}>
                    {letter}
                  </button>
                );
              })}
            </span>
          )}
          {selected.shape === 'note' && (
            <input aria-label="Yazı" dir="auto" maxLength={80} defaultValue={selected.text ?? ''} key={selected.id} autoFocus
              placeholder="Yazıyı girin" className="w-40 px-1.5 py-0.5 rounded border border-[#D5D4CC] text-xs"
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              onBlur={e => { const text = e.target.value.trim(); if (text && text !== selected.text) onRegions(regions.map(r => r.id === selected.id ? { ...r, text } : r)); }} />
          )}
          {selectedMarks.some(m => COLORABLE.has(m.type)) && (
            <span className="inline-flex items-center gap-0.5" role="group" aria-label="Renk">
              {MARK_COLORS.map(c => {
                const current = selectedMarks.filter(m => COLORABLE.has(m.type)).every(m => (m.color ?? ICON[m.type]!.color).toUpperCase() === c.color);
                return <button key={c.color} type="button" aria-pressed={current} title={c.name} aria-label={`Renk: ${c.name}`}
                  onClick={() => onActions(recolor(actions, selected.id, c.color))}
                  className={`w-4 h-4 rounded-full border-2 ${current ? 'border-[#1C1917]' : 'border-white shadow-[0_0_0_1px_#D5D4CC]'}`} style={{ background: c.color }} />;
              })}
            </span>
          )}
          {selectedMarks.some(m => m.type === 'underline') && (() => {
            const fromLeft = selectedMarks.filter(m => m.type === 'underline').every(m => m.fromLeft);
            return (
              <button type="button" onClick={() => onActions(flipUnderlines(actions, selected.id))}
                title={fromLeft ? 'Çizgi soldan sağa çiziliyor: sağdan sola çevir' : 'Çizgi sağdan sola çiziliyor: soldan sağa çevir'}
                aria-label="Çizginin yönünü çevir" className="px-1.5 py-0.5 rounded hover:bg-[#F2F1EB] inline-flex items-center gap-1 font-semibold">
                <ArrowsLeftRight size={13} /> {fromLeft ? 'Soldan sağa' : 'Sağdan sola'}
              </button>
            );
          })()}
          {selected.shape === 'arrow' && selected.arrow && (
            <button type="button" title="Okun yönünü çevir" aria-label="Okun yönünü çevir" className="p-1 rounded hover:bg-[#F2F1EB]"
              onClick={() => { const a = selected.arrow!; onRegions(regions.map(r => r.id === selected.id ? { ...r, arrow: { x1: a.x2, y1: a.y2, x2: a.x1, y2: a.y1 } } : r)); }}>
              <ArrowsLeftRight size={14} />
            </button>
          )}
          {selected.auto && (
            <button type="button" title="Kutuyu stüdyonun bulduğu yere ve boya geri getir" className="px-1.5 py-0.5 rounded hover:bg-[#F2F1EB] inline-flex items-center gap-1 font-semibold"
              onClick={() => onRegions(regions.map(r => r.id === selected.id ? revertToAuto(r) : r))}>
              <ArrowArcLeft size={13} /> Otomatiğe döndür
            </button>
          )}
          <span className="inline-flex items-center ml-auto">
            <button type="button" onClick={() => copy(selected)} title="Kopyala (Ctrl+C)" aria-label="Kopyala" className="p-1 rounded hover:bg-[#F2F1EB]"><Copy size={14} /></button>
            {hasCopy && <button type="button" onClick={paste} title="Yapıştır (Ctrl+V): kopya biraz yanda çıkar" aria-label="Yapıştır" className="p-1 rounded hover:bg-[#F2F1EB]"><ClipboardText size={14} /></button>}
            <button type="button" onClick={() => removeBox(selected.id)} title="Kaldır (Delete)" aria-label="Kaldır" className="p-1 rounded text-[#8B1E2D] hover:bg-red-50"><Trash size={14} /></button>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Kapat" title="Kapat (Esc)" className="p-1 rounded hover:bg-[#F2F1EB]"><X size={13} /></button>
          </span>
        </div>
      )}
    </div>
  );
}
