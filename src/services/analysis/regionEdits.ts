import { AnnotationRegion, VideoConfig, NarrationWord } from '../../types';
import { parseSolutionSemantics } from './solutionParser';
import { alignEventsWithNarration } from './timelineAligner';

export function planRegionActions(regions: AnnotationRegion[], text: string, words: NarrationWord[], duration: number) {
  const matches = regions.filter(r => r.content && !r.type.startsWith('option') && r.id !== 'question-root')
    .map(region => ({ phrase: region.content!, region, matchedWords: [] }));
  return alignEventsWithNarration(parseSolutionSemantics(text, regions, matches).events, words, duration, text);
}

const sameBox = (a: Pick<AnnotationRegion, 'x' | 'y' | 'width' | 'height'>, b: Pick<AnnotationRegion, 'x' | 'y' | 'width' | 'height'>) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.height - b.height) < 1e-6;

/** Geometry edits retain existing timing; new/retargeted phrases get real audio timing. */
export function applyRegionEdits(config: VideoConfig, next: AnnotationRegion[], text: string, words: NarrationWord[], duration: number): VideoConfig {
  const before = config.regions || [];
  const regions = next.map(r => {
    const old = before.find(o => o.id === r.id);
    if (JSON.stringify(old) === JSON.stringify(r)) return r;
    // Back where the studio found it ("Otomatiğe döndür"): a found box again.
    if (old?.auto && !r.auto && !r.manuallyAdjusted && sameBox(r, old.auto)) return r;
    // A found box moved or resized for the first time remembers where it was found.
    const auto = r.auto ?? (old && !old.shape && !old.manuallyAdjusted && !sameBox(r, old)
      ? { x: old.x, y: old.y, width: old.width, height: old.height } : undefined);
    return { ...r, manuallyAdjusted: true, ...(auto ? { auto } : {}) };
  });
  const changedTargets = new Set(regions.filter(r => {
    const old = before.find(o => o.id === r.id);
    return !old || old.type !== r.type || old.content !== r.content;
  }).map(r => r.id));
  const ids = new Set(regions.map(r => r.id));
  const actions = (config.timelineActions || []).filter(a => ids.has(a.targetRegionId) && !changedTargets.has(a.targetRegionId));
  const fresh = planRegionActions(regions, text, words, duration).filter(a => changedTargets.has(a.targetRegionId));
  const removed = before.filter(r => !ids.has(r.id)).map(r => r.id);
  const missing = ['A','B','C','D','E'].filter(l => !ids.has(`option-${l.toLowerCase()}`));
  return { ...config, regions,
    suppressedRegionIds: [...new Set([...(config.suppressedRegionIds || []), ...removed])].filter(id => !ids.has(id)),
    timelineActions: [...actions, ...fresh.map(a => ({ ...a, id: `edit-${a.targetRegionId}-${a.type}-${a.start}` }))].sort((a,b) => a.start-b.start),
    warnings: [...(config.warnings || []).filter(w => !w.startsWith('Şu şıklar bulunamadı:')),
      ...(missing.length ? [`Şu şıklar bulunamadı: ${missing.join(', ')}. Önizlemede o şıkkın kutusuna tıklayıp harfini seçin ya da kutusunu çizin.`] : [])],
  };
}

const isVerdict = (type: string) => type === 'reject' || type === 'correct' || type === 'tick' || type === 'cross';

/**
 * The teacher says a box on the picture is option `letter`: the box becomes that option (an
 * earlier box for it goes away, its narrated marks stay on the new place). A newly found option
 * gets its cross or tick from the narration, at the moment the voice speaks about it. The box's
 * own marks move with it, apart from narrated ones of another option it was taken for.
 */
export function assignOption(config: VideoConfig, boxId: string, letter: string, text: string, words: NarrationWord[], duration: number): VideoConfig {
  const id = `option-${letter.toLowerCase()}`;
  const before = config.regions || [];
  const box = before.find(r => r.id === boxId);
  if (!box || boxId === id) return config;
  const old = before.find(r => r.id === id);
  const next = { ...box, id, type: id as AnnotationRegion['type'], label: `${letter.toUpperCase()} Şıkkı`, content: old ? old.content : undefined, manuallyAdjusted: true };
  const regions = before.filter(r => r.id !== id).map(r => (r.id === boxId ? next : r));
  const wasOption = /^option-[a-e]$/.test(boxId);
  const moved = (config.timelineActions || [])
    .filter(a => a.targetRegionId === boxId && (!wasOption || a.id.startsWith('manual-')))
    .map(a => ({ ...a, targetRegionId: id, ...(a.regionId ? { regionId: id } : {}) }));
  const edited = applyRegionEdits({ ...config, timelineActions: (config.timelineActions || []).filter(a => a.targetRegionId !== boxId) },
    regions, text, words, duration);
  const actions = edited.timelineActions || [];
  const narrated = actions.some(a => a.targetRegionId === id && isVerdict(a.type));
  return {
    ...edited,
    suppressedRegionIds: (edited.suppressedRegionIds || []).filter(r => r !== boxId),
    timelineActions: [...actions, ...moved.filter(a => !(narrated && isVerdict(a.type)))].sort((a, b) => a.start - b.start),
  };
}
