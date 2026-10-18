import type { AnnotationRegion, VideoAction } from '../../types';
import {
  markable, slideBlocks, timedMarks, translationPairs, type DeckWords, type MarkFixes, type Pause, type SlideBlock, type SlideLine, type TimedMark,
} from './slideMarks';

/**
 * A slide's marks in the question editor's own form (the same boxes and marks a question video
 * has), timed in seconds of the slide's own voice. The question editor's screen edits them and the
 * question videos' painter draws them, in the preview and in the MP4.
 */
export interface SlideScene {
  regions: AnnotationRegion[];
  actions: VideoAction[];
  /** Moves every underline of this slide up (−) or down (+), in heights of its text line. */
  underlineOffset?: number;
}

const place = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x, y: b.y, width: b.width, height: b.height });

/**
 * The studio's marks as a scene: each spoken part of the slide is underlined line by line while it
 * is said (Turkish left to right, Arabic right to left, its translation with it), and a finished
 * list item, table row or Arabic example gets a tick that stays.
 */
function sceneOf(blocks: SlideBlock[], marks: TimedMark[], duration: number): SlideScene {
  const parts = markable(blocks);
  const regions = new Map<string, AnnotationRegion>();
  const actions: VideoAction[] = [];
  const underline = (b: SlideBlock, start: number, end: number) => {
    const k = parts.indexOf(b), width = b.lines.reduce((sum, l) => sum + l.width, 0) || 1;
    let at = start;
    b.lines.forEach((l, i) => {
      const id = `satir-${k}-${i}`, span = (end - start) * l.width / width;
      if (!regions.has(id)) regions.set(id, { id, type: 'phrase', label: l.text, content: l.text, ...place(l) });
      actions.push({ id: `oto-${id}-${Math.round(at * 1000)}`, type: 'underline', targetRegionId: id, start: at, startTime: at, duration: span, ...(b.rtl ? {} : { fromLeft: true }) });
      at += span;
    });
  };
  for (const m of marks) {
    underline(m.block, m.start, m.end);
    if (m.partner) underline(m.partner, m.start, m.end);
    if (m.block.kind === 'bullet' || m.block.kind === 'row' || m.block.rtl) {
      const k = parts.indexOf(m.block), id = `parca-${k}`, at = Math.max(m.start, m.end - 0.45);
      if (!regions.has(id)) regions.set(id, { id, type: 'phrase', label: m.block.text, content: m.block.text, ...place(m.block) });
      actions.push({ id: `oto-tik-${k}-${Math.round(at * 1000)}`, type: 'correct', targetRegionId: id, start: at, startTime: at, duration: Math.max(0.1, duration - at) });
    }
  }
  return { regions: [...regions.values()], actions: actions.sort((a, b) => a.start - b.start) };
}

/** The studio's own marks for a slide (from its text, its PDF lines and its voice's pauses). */
export function autoScene(text: string, lines: SlideLine[] | undefined, fixes: MarkFixes | undefined, duration: number, deck?: DeckWords, pauses?: Pause[]): SlideScene {
  const { blocks, marks } = timedMarks(text, lines, fixes, duration, deck, pauses);
  return sceneOf(blocks, marks, duration);
}

/** Marks placed by hand on 17 October, before slides used the question editor: a part of the slide or a drawn area. */
export interface OldHandMark { id: string; start: number; end: number; part?: number; area?: { x: number; y: number; width: number; height: number } }

/** Those marks as a scene, so nothing a teacher placed is lost: a drawn area is highlighted as before. */
export function sceneFromOldMarks(lines: SlideLine[] | undefined, old: OldHandMark[], duration: number): SlideScene {
  const blocks = lines?.length ? slideBlocks(lines) : [];
  const parts = markable(blocks), pairs = translationPairs(blocks);
  const marks = old.flatMap(m => {
    const block = !m.area && m.part !== undefined ? parts[m.part] : undefined;
    return block && m.end > m.start ? [{ start: m.start, end: m.end, block, partner: pairs.get(block) }] : [];
  });
  const scene = sceneOf(blocks, marks, duration);
  for (const m of old) {
    if (!m.area || m.end <= m.start) continue;
    const id = `alan-${m.id}`;
    scene.regions.push({ id, type: 'custom', label: 'Çizilen alan', shape: 'drawn', ...place(m.area) });
    scene.actions.push({ id: `el-${m.id}`, type: 'highlight', targetRegionId: id, start: m.start, startTime: m.start, duration: m.end - m.start });
  }
  scene.actions.sort((a, b) => a.start - b.start);
  return scene;
}

/** What stays of a scene on a new picture of the slide: what the teacher drew (the found lines were the old picture's). */
export function drawnOnly(scene: SlideScene | undefined): SlideScene | undefined {
  if (!scene) return undefined;
  const regions = scene.regions.filter(r => r.shape);
  if (!regions.length) return undefined;
  const ids = new Set(regions.map(r => r.id));
  return { ...scene, regions, actions: scene.actions.filter(a => ids.has(a.targetRegionId)) };
}
