import { AnnotationRegion, VideoAction } from '../../../types';
import { RenderState } from './types';
import { easeOutCubic } from './animations';

/** How far an underline is drawn `elapsed` seconds in, following its word steps (0–1). */
export function stepProgress(steps: Array<{ at: number; to: number }>, elapsed: number): number {
  let previous = { at: 0, to: 0 };
  for (const step of steps) {
    if (elapsed <= step.at) {
      return step.at <= previous.at ? step.to : previous.to + (step.to - previous.to) * (elapsed - previous.at) / (step.at - previous.at);
    }
    previous = step;
  }
  return 1;
}

/**
 * An underline is drawn over its whole length on the strip: a 1 s mark draws in about 1 s, a 5 s
 * mark in about 5 s. Only a short moment at the end shows the finished line (a fifth, at most 0.8 s).
 */
export const underlineDrawTime = (duration: number) => Math.max(.05, duration - Math.min(.8, duration * .2));
/** The strip length whose drawing takes `draw` seconds (the inverse of underlineDrawTime). */
export const underlineSpanFor = (draw: number) => draw + .8 >= 4 ? draw + .8 : draw / .8;

/** How far an underline is drawn `elapsed` seconds in: evenly over its draw time, or word by word. */
export function underlineProgress(action: VideoAction, elapsed: number): number {
  // A held line (a passage line) is drawn in the time before its hold.
  const hold = Math.min(action.holdFor ?? 0, Math.max(0, action.duration - .5));
  const draw = underlineDrawTime(action.duration - hold);
  const steps = action.drawSteps;
  if (!steps?.length) return Math.max(0, Math.min(1, elapsed / draw));
  // Word steps are stretched or squeezed with the mark, so a longer mark draws each word slower.
  const scale = draw / Math.max(.05, steps[steps.length - 1].at);
  return stepProgress(steps.map(s => ({ at: s.at * scale, to: s.to })), elapsed);
}

/**
 * Deterministic pure function: Computes the exact visual render state at timestamp `currentTime`.
 * Seeking backward or forward calculates from scratch based on actions up to `currentTime`.
 */
export function computeTimelineVisualState(
  currentTime: number,
  actions: VideoAction[] = [],
  regions: AnnotationRegion[] = [],
  selectedRegionId?: string | null
): RenderState {
  const state: RenderState = {
    activeHighlights: [],
    activeUnderlines: [],
    activeFocus: [],
    activeCircles: [],
    activeArrows: [],
    activeNotes: [],
    activeDimOthers: { active: false, opacity: 0 },
    rejectedRegions: {},
    correctRegions: {},
    truthMarks: {},
    selectedRegionId: selectedRegionId || null,
  };

  if (!actions || actions.length === 0) {
    return state;
  }

  // Sort actions by start time
  const sortedActions = [...actions].sort((a, b) => a.start - b.start);

  for (const action of sortedActions) {
    // Has this action occurred yet?
    if (currentTime < action.start) {
      continue;
    }

    const elapsed = currentTime - action.start;
    const animDuration = 0.35; // 350ms for transition
    const rawProgress = Math.min(1, Math.max(0, elapsed / animDuration));
    const animProgress = easeOutCubic(rawProgress);

    switch (action.type) {
      case 'reject': {
        delete state.correctRegions[action.targetRegionId];
        // Permanent rejection mark until explicit reset
        state.rejectedRegions[action.targetRegionId] = {
          regionId: action.targetRegionId,
          drawProgress: animProgress,
          timestamp: action.start,
        };
        break;
      }

      case 'correct': {
        delete state.rejectedRegions[action.targetRegionId];
        // Permanent correct answer checkmark until explicit reset
        state.correctRegions[action.targetRegionId] = {
          regionId: action.targetRegionId,
          drawProgress: animProgress,
          timestamp: action.start,
        };
        break;
      }

      case 'tick':
      case 'cross': {
        // A statement is true or false once: a later tick or cross replaces the earlier one.
        state.truthMarks[action.targetRegionId] = {
          regionId: action.targetRegionId,
          drawProgress: animProgress,
          timestamp: action.start,
          kind: action.type,
          color: action.color,
        };
        break;
      }

      case 'highlight': {
        // Highlight is active during [action.start, action.start + action.duration]
        const duration = action.duration ?? 3.0;
        if (currentTime <= action.start + duration) {
          const fadeOutThreshold = duration - 0.25;
          let opacity = Math.min(1, elapsed / 0.2); // fade in in 200ms
          if (elapsed > fadeOutThreshold) {
            opacity = Math.max(0, (duration - elapsed) / 0.25); // fade out
          }
          state.activeHighlights.push({
            regionId: action.targetRegionId,
            opacity: opacity * 0.24,
            // A highlighter pen (Konu anlatımı) crosses the line in 0.6 s, or as its words are said.
            progress: action.drawSteps?.length ? stepProgress(action.drawSteps, elapsed) : Math.min(1, elapsed / .6),
            isRtl: !action.fromLeft,
          });
        }
        break;
      }

      case 'underline': {
        // Underline draws along line, stays for duration, then clears
        const duration = action.duration ?? 3.5;
        if (currentTime <= action.start + duration) {
          state.activeUnderlines.push({
            regionId: action.targetRegionId,
            progress: underlineProgress(action, elapsed),
            // Arabic is underlined right-to-left; a line the teacher dragged left-to-right is drawn that way.
            isRtl: !action.fromLeft,
            offset: action.lineOffset,
            color: action.color,
            opacity: duration > .5 ? Math.min(1, (duration - elapsed) / .18) : 1,
          });
        }
        break;
      }

      case 'focus': {
        // Focus box emphasizes region during duration
        const duration = action.duration ?? 2.5;
        if (currentTime <= action.start + duration) {
          // Soft exit so switching options never snaps; very short cues keep full strength.
          const intensity = Math.min(1, elapsed / 0.25, duration > .6 ? (duration - elapsed) / .15 : 1);
          state.activeFocus.push({
            regionId: action.targetRegionId,
            intensity,
          });
        }
        break;
      }

      case 'circle': {
        // A ring drawn in 0.6 s around the box, kept for the mark's duration, then faded.
        const duration = action.duration ?? 2.5;
        if (currentTime <= action.start + duration) {
          state.activeCircles.push({
            regionId: action.targetRegionId,
            progress: Math.min(1, elapsed / .6),
            opacity: duration > .5 ? Math.min(1, (duration - elapsed) / .2) : 1,
            color: action.color,
          });
        }
        break;
      }

      case 'arrow':
      case 'note': {
        // An arrow grows from its tail in 0.5 s; a note fades in. Both stay for the mark's duration, then fade.
        const duration = action.duration ?? 2.5;
        if (currentTime <= action.start + duration) {
          (action.type === 'arrow' ? state.activeArrows : state.activeNotes).push({
            regionId: action.targetRegionId,
            progress: Math.min(1, elapsed / (action.type === 'arrow' ? .5 : .25)),
            opacity: duration > .5 ? Math.min(1, (duration - elapsed) / .2) : 1,
            color: action.color,
          });
        }
        break;
      }

      case 'dim-others': {
        const duration = Math.max(0.8, action.duration || 3.0);
        if (currentTime <= action.start + duration) {
          state.activeDimOthers = {
            active: true,
            targetRegionId: action.targetRegionId,
            opacity: 0.55,
          };
        }
        break;
      }

      case 'reset': {
        // Reset explicitly clears active transients and optionally removes specific markers
        if (action.targetRegionId && action.targetRegionId !== 'all') {
          delete state.rejectedRegions[action.targetRegionId];
          delete state.correctRegions[action.targetRegionId];
          delete state.truthMarks[action.targetRegionId];
        } else {
          state.rejectedRegions = {};
          state.correctRegions = {};
          state.truthMarks = {};
          state.activeHighlights = [];
          state.activeUnderlines = [];
          state.activeFocus = [];
          state.activeCircles = [];
          state.activeArrows = [];
          state.activeNotes = [];
          state.activeDimOthers = { active: false, opacity: 0 };
        }
        break;
      }
    }
  }

  return state;
}
