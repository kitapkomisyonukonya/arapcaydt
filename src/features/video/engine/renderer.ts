import { AnnotationRegion, VideoAction } from '../../../types';
import { RenderOptions, FitRect } from './types';
import { computeTimelineVisualState } from './timeline';
import { drawAnimatedCross, drawAnimatedCheck, easeOutBack, easeOutCubic } from './animations';

export function calculateFitRect(imgWidth: number, imgHeight: number, canvasWidth: number, canvasHeight: number, margin = 0): FitRect {
  const availableW = Math.max(1, canvasWidth - margin * 2);
  const availableH = Math.max(1, canvasHeight - margin * 2);
  const scale = Math.min(availableW / Math.max(1, imgWidth), availableH / Math.max(1, imgHeight));
  const width = imgWidth > 0 ? imgWidth * scale : availableW;
  const height = imgHeight > 0 ? imgHeight * scale : availableH;
  return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height };
}

export function regionCanvasRect(region: AnnotationRegion, fit: FitRect): FitRect {
  return { x: fit.x + region.x * fit.width, y: fit.y + region.y * fit.height,
    width: region.width * fit.width, height: region.height * fit.height };
}

// Marks belong outside the text. Correct marks prefer the right, crosses the left;
// a side is skipped when it leaves the canvas or would sit on another option
// (five options in one row leave no room between neighbours), then above is used.
export function markerGeometry(rect: FitRect, canvasWidth: number, scale = 1, correct = false,
  anchor?: AnnotationRegion['markerAnchor'], obstacles: FitRect[] = []) {
  const radius = 16 * scale;
  const gap = 12 * scale;
  const y = rect.y + rect.height * (anchor?.y ?? .5);
  const reach = radius * 1.35;
  const free = (x: number, cy: number) => x - reach >= 2 * scale && x + reach <= canvasWidth - 2 * scale
    && !obstacles.some(o => o.x < x + reach && o.x + o.width > x - reach && o.y < cy + reach && o.y + o.height > cy - reach);
  const left = { x: rect.x - gap - radius, y };
  const right = { x: rect.x + rect.width + gap + radius, y };
  const above = { x: correct ? rect.x + rect.width - radius : rect.x + radius, y: Math.max(radius, rect.y - gap - radius) };
  const order = correct ? [right, left] : [left, right];
  const spot = order.find(p => free(p.x, p.y))
    ?? (obstacles.length ? undefined : order.find(p => p.x - radius >= 2 * scale && p.x + radius <= canvasWidth - 2 * scale))
    ?? above;
  return { x: spot.x, y: spot.y, radius };
}

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-zÇĞİÖŞÜçğıöşü0-9]/;

interface CaptionToken { text: string; from: number; to: number; rtl: boolean; width: number; start?: number; glued?: boolean }

/**
 * Captions get their own strip so they never cover the question: at the bottom when the
 * caption sits low, at the top when it sits high, none for a caption placed mid-screen
 * (the teacher's explicit choice) or when there are no captions. Sized for two lines.
 */
export function captionStrip(options: Pick<RenderOptions, 'captions' | 'showCaptions' | 'captionY'>, height: number): { edge: 'top' | 'bottom'; size: number } | null {
  if (options.showCaptions === false || !options.captions?.length) return null;
  const y = options.captionY ?? .85;
  const size = 160 * height / 1080;
  return y >= .7 ? { edge: 'bottom', size } : y <= .3 ? { edge: 'top', size } : null;
}

/**
 * Where the question image goes: the whole frame by default. `imageScale` is the teacher's
 * own smaller size (0.5–1 of the whole frame), placed clear of the caption strip.
 */
export function imageFitRect(imgWidth: number, imgHeight: number, width: number, height: number,
  strip: ReturnType<typeof captionStrip>, imageScale?: number): FitRect {
  const full = calculateFitRect(imgWidth, imgHeight, width, height);
  if (imageScale === undefined || imageScale >= 1) return full;
  const s = Math.max(.5, imageScale);
  const w = full.width * s, h = full.height * s;
  const y = !strip ? (height - h) / 2
    : strip.edge === 'bottom' ? Math.max(0, Math.min((height - h) / 2, height - strip.size - h))
    : Math.min(height - h, Math.max((height - h) / 2, strip.size));
  return { x: (width - w) / 2, y, width: w, height: h };
}

/** Where an underline sits: just under its text (OCR boxes already include the vowel marks), plus the teacher's nudges. */
export function underlineY(rect: FitRect, scale: number, offset = 0): number {
  return rect.y + rect.height + 2 * scale + offset * rect.height;
}

/** Lays out words in visual order: Arabic runs read right-to-left inside a Turkish (LTR) line. */
function layoutCaptionLine(tokens: CaptionToken[], rtlBase: boolean, space: number) {
  const placed: Array<CaptionToken & { x: number }> = [];
  let x = 0;
  const gap = (token: CaptionToken, index: number) => index && !token.glued ? space : 0;
  const place = (run: CaptionToken[], rtl: boolean) => {
    if (placed.length && !run[0].glued) x += space;
    const runWidth = run.reduce((sum, token, index) => sum + token.width + gap(token, index), 0);
    let cursor = rtl ? x + runWidth : x;
    run.forEach((token, index) => {
      if (rtl) { cursor -= gap(token, index) + token.width; placed.push({ ...token, x: cursor }); }
      else { cursor += gap(token, index); placed.push({ ...token, x: cursor }); cursor += token.width; }
    });
    x += runWidth;
  };
  if (rtlBase) place(tokens, true);
  else for (let i = 0; i < tokens.length;) {
    let j = i + 1;
    while (j < tokens.length && tokens[j].rtl === tokens[i].rtl) j++;
    place(tokens.slice(i, j), tokens[i].rtl);
    i = j;
  }
  return { placed, width: x };
}

function drawCaption(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, options: RenderOptions) {
  if (options.showCaptions === false) return;
  const cue = options.captions?.find(c => time >= c.start && time < c.end);
  if (!cue) return;
  const scale = Math.min(width / 1920, height / 1080);
  const maxWidth = width - 180 * scale;
  const padX = 34 * scale;
  const rtlBase = !LATIN.test(cue.text);
  const fade = Math.min(1, (time - cue.start) / .12, (cue.end - time) / .12);
  // In a Turkish line, punctuation next to Arabic belongs to the Turkish flow ("فِي," keeps its comma on the right).
  const pieces = Array.from(cue.text.matchAll(/\S+/g)).flatMap(m => {
    const split = !rtlBase && ARABIC.test(m[0]) && !LATIN.test(m[0]) ? m[0].match(/^([^\u0600-\u06ff]*)(.*?)([^\u0600-\u06ff]*)$/su) : null;
    if (!split) return [{ text: m[0], from: m.index!, glued: false }];
    let from = m.index!;
    return [split[1], split[2], split[3]].flatMap((text, index) => {
      const piece = { text, from, glued: index > 0 };
      from += text.length;
      return text ? [piece] : [];
    }).map((piece, index) => ({ ...piece, glued: index > 0 }));
  });
  const tokens: CaptionToken[] = pieces.map(piece => ({
    ...piece, to: piece.from + piece.text.length, width: 0,
    rtl: rtlBase || (ARABIC.test(piece.text) && !LATIN.test(piece.text)),
    start: cue.words?.find(w => w.to > piece.from && w.from < piece.from + piece.text.length)?.start,
  }));
  let size = 36 * scale;
  let lines: CaptionToken[][] = [];
  let space = 0;
  ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  do {
    ctx.font = '700 ' + size + 'px "Manrope", "Amiri", sans-serif';
    space = ctx.measureText(' ').width;
    for (const token of tokens) { ctx.direction = token.rtl ? 'rtl' : 'ltr'; token.width = ctx.measureText(token.text).width; }
    lines = [];
    let line: CaptionToken[] = []; let lineWidth = 0;
    for (const token of tokens) {
      const next = line.length ? lineWidth + (token.glued ? 0 : space) + token.width : token.width;
      if (line.length && !token.glued && next > maxWidth - padX * 2) { lines.push(line); line = [{ ...token, glued: false }]; lineWidth = token.width; }
      else { line.push(token); lineWidth = next; }
    }
    if (line.length) lines.push(line);
    if (lines.length <= 2 || size <= 23 * scale) break;
    size -= scale;
  } while (true);
  const layouts = lines.map(line => layoutCaptionLine(line, rtlBase, space));
  const lineHeight = size * 1.6;
  const boxHeight = lines.length * lineHeight + 24 * scale;
  const boxWidth = Math.min(maxWidth, Math.max(...layouts.map(l => l.width)) + padX * 2);
  const strip = captionStrip(options, height);
  const centerY = strip ? (strip.edge === 'top' ? strip.size / 2 : height - strip.size / 2)
    : Math.max(boxHeight / 2, Math.min(height - boxHeight / 2, height * (options.captionY ?? .85)));
  ctx.globalAlpha = Math.max(0, fade);
  ctx.shadowColor = 'rgba(15,23,42,.35)'; ctx.shadowBlur = 24 * scale; ctx.shadowOffsetY = 6 * scale;
  ctx.fillStyle = 'rgba(24,16,20,.86)'; ctx.beginPath();
  ctx.roundRect((width - boxWidth) / 2, centerY - boxHeight / 2, boxWidth, boxHeight, 18 * scale);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // Karaoke: the word being spoken glows amber, spoken words stay white, upcoming words wait dimmed.
  // Punctuation and untimed pieces inherit the time of the word before them.
  let carry = -Infinity;
  const effective = tokens.map(token => (carry = token.start ?? carry));
  const timed = tokens.some(token => token.start !== undefined);
  const activeStart = Math.max(-Infinity, ...effective.filter(start => start <= time));
  layouts.forEach((layout, row) => {
    const left = (width - layout.width) / 2;
    const y = centerY + (row - (lines.length - 1) / 2) * lineHeight;
    for (const token of layout.placed) {
      const index = tokens.findIndex(t => t.from === token.from);
      ctx.direction = token.rtl ? 'rtl' : 'ltr';
      const current = timed && effective[index] === activeStart && activeStart > -Infinity;
      const spoken = !timed || effective[index] < activeStart;
      ctx.fillStyle = current ? '#FCD34D' : spoken ? '#FFFFFF' : 'rgba(255,255,255,.58)';
      ctx.fillText(token.text, left + token.x, y);
    }
  });
  ctx.restore();
}

/** Frame whose outline is traced around the box as `progress` goes 0 → 1. */
function tracedFrame(ctx: CanvasRenderingContext2D, r: FitRect, scale: number, stroke: string, fill: string,
  progress: number, opacity: number, glow: string, padding = 7 * scale) {
  if (opacity <= 0) return;
  const x = r.x - padding, y = r.y - padding, w = r.width + padding * 2, h = r.height + padding * 2;
  const perimeter = 2 * (w + h);
  ctx.save(); ctx.globalAlpha = opacity;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(12 * scale, h / 2));
  // Multiply tints the paper but leaves the printed letters at full contrast.
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = fill; ctx.globalAlpha = opacity * Math.min(1, progress * 1.6); ctx.fill();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = opacity;
  ctx.shadowColor = glow; ctx.shadowBlur = 18 * scale;
  ctx.strokeStyle = stroke; ctx.lineWidth = 3.5 * scale; ctx.lineJoin = 'round';
  ctx.setLineDash([perimeter * progress, perimeter]);
  ctx.stroke(); ctx.restore();
}

/** Colored disc + white glyph; pops in with a slight overshoot. */
function markBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, age: number, kind: 'reject' | 'correct', scale: number) {
  const pop = easeOutBack(Math.min(1, age / .32));
  if (pop <= 0) return;
  const color = kind === 'reject' ? '#DC2626' : '#16A34A';
  ctx.save();
  if (kind === 'correct' && age < .9) {
    // One expanding ring on arrival.
    const t = age / .9;
    ctx.globalAlpha = (1 - t) * .55; ctx.strokeStyle = color; ctx.lineWidth = 4 * scale * (1 - t) + scale;
    ctx.beginPath(); ctx.arc(cx, cy, radius * (1 + t * 1.3), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.translate(cx, cy); ctx.scale(pop, pop);
  ctx.shadowColor = 'rgba(15,23,42,.28)'; ctx.shadowBlur = 10 * scale; ctx.shadowOffsetY = 3 * scale;
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
  // The disc's drop shadow must not leak into the glyph: a leftover offset stamps a ghost copy of the X/✓ below it.
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.5 * scale; ctx.stroke();
  const stroke = Math.min(1, Math.max(0, (age - .08) / .3));
  if (kind === 'reject') drawAnimatedCross(ctx, 0, 0, radius * .5, stroke, '#FFFFFF', 4.5 * scale);
  else drawAnimatedCheck(ctx, 0, 0, radius * .62, stroke, '#FFFFFF', 5 * scale);
  ctx.restore();
}

export const ARROW_COLOR = '#2563EB', NOTE_COLOR = '#7C3AED';
/** A true statement's ✓ and a false one's ✗, unless the teacher picked another colour. */
export const TICK_COLOR = '#16A34A', CROSS_COLOR = '#DC2626';

/** A plain ✓ or ✗ (no disc), with a thin white edge so it reads on any background; pops in and is drawn. */
function truthGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, age: number, kind: 'tick' | 'cross', color: string, scale: number) {
  const pop = easeOutBack(Math.min(1, age / .32));
  if (pop <= 0) return;
  const stroke = Math.min(1, Math.max(0, (age - .05) / .3));
  ctx.save(); ctx.translate(cx, cy); ctx.scale(pop, pop);
  for (const [paint, width] of [['rgba(255,255,255,.95)', 10], [color, 6]] as const) {
    if (kind === 'tick') drawAnimatedCheck(ctx, 0, 0, size * .8, stroke, paint, width * scale);
    else drawAnimatedCross(ctx, 0, 0, size * .62, stroke, paint, width * scale);
  }
  ctx.restore();
}

/** An arrow from tail to head (shares of its box), grown to `progress` of its length; the head comes with the tip. */
function drawArrow(ctx: CanvasRenderingContext2D, r: FitRect, ends: NonNullable<AnnotationRegion['arrow']>, progress: number, opacity: number, color: string, scale: number) {
  const x1 = r.x + ends.x1 * r.width, y1 = r.y + ends.y1 * r.height;
  const length = Math.hypot(r.x + ends.x2 * r.width - x1, r.y + ends.y2 * r.height - y1);
  if (length < 1) return;
  const ux = (r.x + ends.x2 * r.width - x1) / length, uy = (r.y + ends.y2 * r.height - y1) / length;
  const head = Math.min(26 * scale, length * .45), tipX = x1 + ux * length * progress, tipY = y1 + uy * length * progress;
  ctx.save(); ctx.globalAlpha = opacity;
  ctx.shadowColor = 'rgba(255,255,255,.9)'; ctx.shadowBlur = 4 * scale;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 6 * scale; ctx.lineCap = 'round';
  // The shaft stops at the head's base so the tip stays sharp.
  const shaft = Math.max(0, length * progress - head * .8);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + ux * shaft, y1 + uy * shaft); ctx.stroke();
  if (length * progress > head * .5) {
    const bx = tipX - ux * head, by = tipY - uy * head, wing = head * .6;
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(bx - uy * wing, by + ux * wing); ctx.lineTo(bx + uy * wing, by - ux * wing); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** A label in its box: a coloured pill with the teacher's text, as large as the box allows. */
function drawNote(ctx: CanvasRenderingContext2D, r: FitRect, text: string, pop: number, opacity: number, color: string, scale: number) {
  ctx.save(); ctx.globalAlpha = opacity;
  ctx.translate(r.x + r.width / 2, r.y + r.height / 2); ctx.scale(pop, pop);
  ctx.shadowColor = 'rgba(15,23,42,.28)'; ctx.shadowBlur = 12 * scale; ctx.shadowOffsetY = 3 * scale;
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(-r.width / 2, -r.height / 2, r.width, r.height, Math.min(14 * scale, r.height / 2)); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.direction = ARABIC.test(text) && !LATIN.test(text) ? 'rtl' : 'ltr';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#FFFFFF';
  let size = r.height * .56;
  const pad = Math.min(16 * scale, r.width * .08);
  do {
    ctx.font = `700 ${size}px "Manrope", "Amiri", sans-serif`;
    if (ctx.measureText(text).width <= r.width - pad * 2 || size <= 8 * scale) break;
    size *= .92;
  } while (true);
  ctx.fillText(text, 0, size * .04);
  ctx.restore();
}

/** Silent closing frame after the narration that restates the answer. */
export const OUTRO_SECONDS = 2.5;
export function outroSeconds(actions: VideoAction[] = [], show = true): number {
  return show && actions.some(a => a.type === 'correct') ? OUTRO_SECONDS : 0;
}

function drawOutroCard(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, letter: string, options: RenderOptions) {
  const scale = Math.min(width / 1920, height / 1080);
  const reveal = easeOutCubic(Math.min(1, t / .45));
  if (reveal <= 0) return;
  const text = `Doğru cevap: ${letter}`;
  ctx.save();
  ctx.font = '700 ' + 46 * scale + 'px "Manrope", sans-serif';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const r = 26 * scale, gap = 18 * scale, padX = 34 * scale, h = 84 * scale;
  const w = padX * 2 + r * 2 + gap + ctx.measureText(text).width;
  const x = (width - w) / 2;
  const strip = captionStrip(options, height);
  const cy = (strip ? (strip.edge === 'top' ? strip.size / 2 : height - strip.size / 2)
    : Math.max(h / 2, Math.min(height - h / 2, height * (options.captionY ?? .85)))) + (1 - reveal) * 24 * scale;
  ctx.globalAlpha = reveal;
  ctx.shadowColor = 'rgba(15,23,42,.3)'; ctx.shadowBlur = 24 * scale; ctx.shadowOffsetY = 6 * scale;
  ctx.fillStyle = '#16A34A'; ctx.beginPath(); ctx.roundRect(x, cy - h / 2, w, h, h / 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x + padX + r, cy, r, 0, Math.PI * 2); ctx.fill();
  drawAnimatedCheck(ctx, x + padX + r, cy, r * .62, Math.min(1, t / .6), '#16A34A', 5 * scale);
  ctx.fillStyle = '#FFFFFF'; ctx.fillText(text, x + padX + r * 2 + gap, cy + 2 * scale);
  ctx.restore();
}

/** Fills the frame around the picture with the picture's own edge pixels (sides, then top and bottom). */
function extendEdges(ctx: CanvasRenderingContext2D, img: HTMLImageElement, fit: FitRect, width: number, height: number) {
  const iw = img.naturalWidth, ih = img.naturalHeight, edge = 2;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  const left = Math.max(0, fit.x), right = Math.max(0, width - fit.x - fit.width);
  const top = Math.max(0, fit.y), bottom = Math.max(0, height - fit.y - fit.height);
  if (left) ctx.drawImage(img, 0, 0, edge, ih, 0, fit.y, left + 1, fit.height);
  if (right) ctx.drawImage(img, iw - edge, 0, edge, ih, fit.x + fit.width - 1, fit.y, right + 1, fit.height);
  if (top) ctx.drawImage(img, 0, 0, iw, edge, fit.x, 0, fit.width, top + 1);
  if (bottom) ctx.drawImage(img, 0, ih - edge, iw, edge, fit.x, fit.y + fit.height - 1, fit.width, bottom + 1);
  // Corners: the corner pixel.
  if (left && top) ctx.drawImage(img, 0, 0, edge, edge, 0, 0, left + 1, top + 1);
  if (right && top) ctx.drawImage(img, iw - edge, 0, edge, edge, fit.x + fit.width - 1, 0, right + 1, top + 1);
  if (left && bottom) ctx.drawImage(img, 0, ih - edge, edge, edge, 0, fit.y + fit.height - 1, left + 1, bottom + 1);
  if (right && bottom) ctx.drawImage(img, iw - edge, ih - edge, edge, edge, fit.x + fit.width - 1, fit.y + fit.height - 1, right + 1, bottom + 1);
  ctx.restore();
}

/** One deterministic painter for editing, playback, and every encoded frame. */
export function renderQuestionVideoFrame(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  imageElement: HTMLImageElement | null, regions: AnnotationRegion[] = [],
  actions: VideoAction[] = [], currentTime: number, options: RenderOptions
): FitRect {
  const scale = Math.min(width / 1920, height / 1080);
  ctx.save(); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height);
  const fit = imageFitRect(imageElement?.naturalWidth || width, imageElement?.naturalHeight || height, width, height,
    captionStrip(options, height), options.imageScale);
  // The slide is always shown whole (no zoom on the examined option).
  ctx.save();
  if (imageElement?.complete && imageElement.naturalWidth > 0) {
    // A question made smaller keeps a full-width slide: its outermost pixels are stretched out to the
    // frame's edges, so the header band and the page colour run edge to edge instead of leaving white.
    if ((options.imageScale ?? 1) < 1) extendEdges(ctx, imageElement, fit, width, height);
    ctx.drawImage(imageElement, fit.x, fit.y, fit.width, fit.height);
  }
  const state = computeTimelineVisualState(currentTime, actions, regions, options.selectedRegionId);
  if (options.settled) {
    // Paused for editing: every mark on screen is shown whole, not at the first frame of its animation.
    for (const u of state.activeUnderlines) { u.progress = 1; u.opacity = 1; }
    for (const c of state.activeCircles) { c.progress = 1; c.opacity = 1; }
    for (const a of [...state.activeArrows, ...state.activeNotes]) { a.progress = 1; a.opacity = 1; }
    for (const h of state.activeHighlights) h.progress = 1;
    for (const f of state.activeFocus) f.intensity = 1;
  }
  const byId = new Map(regions.map(r => [r.id, r]));
  const rectFor = (id: string) => { const r = byId.get(id); return r ? regionCanvasRect(r, fit) : null; };
  const age = (mark: { timestamp: number }) => Math.max(options.settled ? 1.5 : 0, currentTime - mark.timestamp);
  // Frames of neighbouring options (A|B side by side, B above C) must never touch.
  const optionRects = regions.filter(r => r.type.startsWith('option')).map(r => ({ id: r.id, rect: regionCanvasRect(r, fit) }));
  const obstaclesFor = (id: string) => optionRects.filter(o => o.id !== id).map(o => o.rect);
  const framePad = (id: string) => {
    const r = rectFor(id); if (!r) return 7 * scale;
    let room = 7 * scale;
    for (const other of optionRects) {
      if (other.id === id) continue;
      const o = other.rect;
      const dx = Math.max(o.x - r.x - r.width, r.x - o.x - o.width);
      const dy = Math.max(o.y - r.y - r.height, r.y - o.y - o.height);
      if (dx < 0 && dy >= 0) room = Math.min(room, dy / 2 - scale);
      else if (dy < 0 && dx >= 0) room = Math.min(room, dx / 2 - scale);
    }
    return Math.max(scale, room);
  };
  const pad = (r: FitRect, p: number) => ({ x: r.x - p, y: r.y - p, width: r.width + p * 2, height: r.height + p * 2 });

  const focused = state.activeFocus.filter(f => !state.correctRegions[f.regionId] && !state.rejectedRegions[f.regionId]);
  // Naming the already-marked answer again ("Doğru cevap B") re-lights it instead of redrawing the check.
  const emphasis = state.activeFocus.filter(f => state.correctRegions[f.regionId]);
  for (const h of state.activeHighlights) {
    const r = rectFor(h.regionId); if (!r) continue;
    if (options.markerPen) {
      // A highlighter pen: strong yellow, laid across the line in reading direction.
      const w = (r.width + 8 * scale) * Math.max(0, Math.min(1, h.progress));
      if (w <= 0) continue;
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = Math.min(1, h.opacity / .24) * .85;
      ctx.fillStyle = '#FDE68A'; ctx.beginPath();
      ctx.roundRect(h.isRtl ? r.x + r.width + 4 * scale - w : r.x - 4 * scale, r.y + r.height * .04, w, r.height * .96, 5 * scale);
      ctx.fill(); ctx.restore();
      continue;
    }
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = h.opacity;
    ctx.fillStyle = '#FFD860'; ctx.beginPath(); ctx.roundRect(r.x, r.y, r.width, r.height, 5 * scale); ctx.fill(); ctx.restore();
  }
  // Arabic is underlined as it is read (right-to-left), just below the word's own box.
  for (const u of state.activeUnderlines) {
    const r = rectFor(u.regionId); if (!r || u.progress <= 0) continue;
    // Even speed: the line keeps pace with the voice over the whole mark.
    const swept = r.width * u.progress;
    // A line the teacher drew is its box: drawn through its middle, where it was put.
    const y = byId.get(u.regionId)?.shape === 'line' ? r.y + r.height / 2
      : underlineY(r, scale, (options.underlineOffset ?? 0) + (u.offset ?? 0));
    ctx.save(); ctx.globalAlpha = u.opacity ?? 1;
    ctx.strokeStyle = u.color || '#D97706'; ctx.lineWidth = 5 * scale; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(u.isRtl ? r.x + r.width : r.x, y);
    ctx.lineTo(u.isRtl ? r.x + r.width - swept : r.x + swept, y); ctx.stroke();
    ctx.restore();
  }
  // A ring as if drawn by hand: one stroke around the box that slightly overshoots its start.
  for (const c of state.activeCircles) {
    const r = rectFor(c.regionId); if (!r || c.progress <= 0) continue;
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    // A ring the teacher drew fills the place drawn; around a found word it leaves room.
    const drawn = byId.get(c.regionId)?.shape === 'drawn';
    const rx = r.width / 2 + (drawn ? 0 : 12 * scale), ry = r.height / 2 + (drawn ? 0 : 10 * scale);
    const from = -Math.PI * .6, sweep = Math.PI * 2.12 * easeOutCubic(c.progress);
    ctx.save(); ctx.globalAlpha = c.opacity;
    ctx.strokeStyle = c.color || '#DC2626'; ctx.lineWidth = 4.5 * scale; ctx.lineCap = 'round'; ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = from + sweep * i / 48;
      // The ring widens a little as it goes round, so its end passes outside its start.
      const grow = 1 + .06 * (i / 48) * (sweep / (Math.PI * 2));
      const x = cx + Math.cos(a) * rx * grow, y = cy + Math.sin(a) * ry * grow;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();
  }
  for (const a of state.activeArrows) {
    const region = byId.get(a.regionId), r = rectFor(a.regionId);
    if (!region || !r || a.progress <= 0) continue;
    drawArrow(ctx, r, region.arrow ?? { x1: 0, y1: .5, x2: 1, y2: .5 }, easeOutCubic(a.progress), a.opacity, a.color || ARROW_COLOR, scale);
  }
  for (const n of state.activeNotes) {
    const region = byId.get(n.regionId), r = rectFor(n.regionId);
    if (!region?.text?.trim() || !r || n.progress <= 0) continue;
    drawNote(ctx, r, region.text.trim(), easeOutBack(n.progress), n.opacity, n.color || NOTE_COLOR, scale);
  }
  // A stamp (✗/✓ put on the picture) is the badge itself, drawn in its box: no frame, no fading.
  const isStamp = (id: string) => byId.get(id)?.shape === 'stamp';
  const stampBadge = (r: FitRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2, radius: Math.min(r.width, r.height) / 2 });
  // Eliminated choices fade back so the remaining ones stand out.
  for (const [id, mark] of Object.entries(state.rejectedRegions)) {
    const r = rectFor(id); if (!r || state.correctRegions[id] || isStamp(id)) continue;
    ctx.save(); ctx.globalAlpha = .5 * Math.min(1, age(mark) / .45); ctx.fillStyle = '#FFFFFF';
    const p = pad(r, Math.min(4 * scale, framePad(id))); ctx.beginPath(); ctx.roundRect(p.x, p.y, p.width, p.height, 8 * scale); ctx.fill(); ctx.restore();
  }
  // Spotlight: while an option is examined the rest of the slide recedes; judged options stay visible.
  const lastCorrect = Object.values(state.correctRegions).sort((a, b) => b.timestamp - a.timestamp)[0];
  const lit = [...focused, ...emphasis];
  const outroT = options.duration && !options.interactiveMode && options.showOutro !== false ? currentTime - options.duration : -1;
  // A tick on a premise (I, II, III…) or a phrase is only a tick; the answer is a ticked option.
  const isOption = (id: string) => /^option-[a-e]$/i.test(id) || (byId.get(id)?.type ?? '').startsWith('option-');
  const correctIds = Object.keys(state.correctRegions).filter(isOption);
  const spot = outroT >= 0 && correctIds.length
    ? { ids: correctIds, strength: Math.min(1, outroT / .4) }
    : lit.length
    ? { ids: [...lit.map(f => f.regionId), ...correctIds], strength: Math.max(...lit.map(f => f.intensity)) }
    : lastCorrect && isOption(lastCorrect.regionId) && age(lastCorrect) < 2.4
      ? { ids: [lastCorrect.regionId], strength: Math.min(1, age(lastCorrect) / .3, (2.4 - age(lastCorrect)) / .5) }
      : state.activeDimOthers.active
        ? { ids: [state.activeDimOthers.targetRegionId!], strength: .6 }
        : null;
  if (spot?.ids.length && spot.strength > 0) {
    ctx.save(); ctx.fillStyle = `rgba(15,23,42,${.16 * spot.strength})`; ctx.beginPath();
    // The whole frame recedes, also the margin left around a question made smaller.
    ctx.rect(0, 0, width, height);
    // Each hole once: with even-odd filling a repeated or overlapping hole would be dimmed again.
    for (const id of new Set(spot.ids)) {
      const r = rectFor(id); if (!r) continue;
      const p = pad(r, framePad(id)); ctx.roundRect(p.x, p.y, p.width, p.height, Math.min(12 * scale, p.height / 2));
    }
    ctx.fill('evenodd'); ctx.restore();
  }

  for (const f of focused) {
    const r = rectFor(f.regionId); if (!r) continue;
    tracedFrame(ctx, r, scale, '#F59E0B', 'rgba(254,243,199,.38)', easeOutCubic(f.intensity), f.intensity, 'rgba(245,158,11,.45)', framePad(f.regionId));
  }
  for (const [id, mark] of Object.entries(state.rejectedRegions)) {
    const r = rectFor(id); if (!r || state.correctRegions[id]) continue;
    const t = age(mark);
    if (isStamp(id)) { const b = stampBadge(r); markBadge(ctx, b.x, b.y, b.radius, t, 'reject', scale); continue; }
    if (t < .45) tracedFrame(ctx, r, scale, '#DC2626', 'rgba(254,226,226,.35)', 1, 1 - t / .45, 'rgba(220,38,38,.35)', framePad(id));
    const m = markerGeometry(r, width, scale, false, byId.get(id)?.markerAnchor, obstaclesFor(id));
    markBadge(ctx, m.x, m.y, m.radius * 1.15, t, 'reject', scale);
  }
  // ✓ / ✗ on a statement: an option's goes where a cross would (its answer mark keeps the other side);
  // a numbered statement's or a phrase's at the end of its text (the left for Arabic).
  for (const [id, mark] of Object.entries(state.truthMarks)) {
    const r = rectFor(id); if (!r) continue;
    const color = mark.color || (mark.kind === 'tick' ? TICK_COLOR : CROSS_COLOR);
    if (isStamp(id)) { const b = stampBadge(r); truthGlyph(ctx, b.x, b.y, b.radius, age(mark), mark.kind, color, scale); continue; }
    const region = byId.get(id);
    const atEnd = !isOption(id) && !ARABIC.test(region?.content ?? '');
    const m = markerGeometry(r, width, scale, atEnd, region?.markerAnchor, obstaclesFor(id));
    truthGlyph(ctx, m.x, m.y, m.radius * 1.3, age(mark), mark.kind, color, scale);
  }
  for (const [id, mark] of Object.entries(state.correctRegions)) {
    const r = rectFor(id); if (!r) continue;
    const t = age(mark);
    if (isStamp(id)) { const b = stampBadge(r); markBadge(ctx, b.x, b.y, b.radius, t, 'correct', scale); continue; }
    const lift = emphasis.find(f => f.regionId === id)?.intensity ?? 0;
    // The answer option keeps its green frame; a tick on anything else (a premise, a drawn place)
    // only flashes it, like a cross, so no empty box is left beside the tick.
    if (isOption(id)) tracedFrame(ctx, r, scale, '#16A34A', `rgba(220,252,231,${.45 + .25 * lift})`, easeOutCubic(Math.min(1, t / .45)), 1, 'rgba(22,163,74,.5)', framePad(id));
    else if (t < .45) tracedFrame(ctx, r, scale, '#16A34A', 'rgba(220,252,231,.35)', 1, 1 - t / .45, 'rgba(22,163,74,.35)', framePad(id));
    if (lift > 0 && isOption(id)) tracedFrame(ctx, r, scale, 'rgba(22,163,74,.7)', 'transparent', 1, lift * (.55 + .45 * Math.sin(currentTime * 5) ** 2), 'rgba(22,163,74,.9)', framePad(id));
    const m = markerGeometry(r, width, scale, true, byId.get(id)?.markerAnchor, obstaclesFor(id));
    markBadge(ctx, m.x, m.y, m.radius * 1.3, t, 'correct', scale);
    const reveal = isOption(id) ? Math.min(1, Math.max(0, (t - .3) / .3)) : 0;
    if (reveal > 0) {
      ctx.save(); ctx.font = '700 ' + 25 * scale + 'px "Manrope", sans-serif';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const label = 'Doğru cevap';
      const labelWidth = ctx.measureText(label).width + 28 * scale;
      const labelX = m.x + m.radius * 1.3 + 10 * scale;
      const blocked = regions.some(other => {
        // Any printed content (other options, the stem, grounded phrases) blocks the label.
        if (other.id === id) return false;
        const b = regionCanvasRect(other, fit);
        return b.x < labelX + labelWidth && b.x + b.width > labelX
          && b.y < m.y + 20 * scale && b.y + b.height > m.y - 20 * scale;
      });
      if (m.x > r.x + r.width && labelX + labelWidth < width - 16 * scale && !blocked) {
        ctx.globalAlpha = reveal; ctx.translate((1 - reveal) * -12 * scale, 0);
        ctx.fillStyle = '#16A34A'; ctx.beginPath(); ctx.roundRect(labelX, m.y - 20 * scale, labelWidth, 40 * scale, 20 * scale); ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.fillText(label, labelX + 14 * scale, m.y + scale);
      }
      ctx.restore();
    }
  }
  ctx.restore();
  drawCaption(ctx, width, height, currentTime, options);
  if (outroT >= 0 && correctIds.length) drawOutroCard(ctx, width, height, outroT, (byId.get(correctIds[correctIds.length - 1])?.type?.startsWith('option-') ? byId.get(correctIds[correctIds.length - 1])!.type : correctIds[correctIds.length - 1]).slice(-1).toUpperCase(), options);
  if (!options.interactiveMode && options.duration && options.duration > 0) {
    const p = Math.max(0, Math.min(1, currentTime / options.duration));
    ctx.fillStyle = 'rgba(139,30,45,.14)'; ctx.fillRect(0, height - 6 * scale, width, 6 * scale);
    ctx.fillStyle = '#8B1E2D'; ctx.fillRect(0, height - 6 * scale, width * p, 6 * scale);
  }
  if (options.interactiveMode) for (const r of regions) {
    const b = regionCanvasRect(r, fit);
    ctx.save(); ctx.strokeStyle = r.id === options.selectedRegionId ? '#8B1E2D' : '#64748B';
    ctx.lineWidth = 2 * scale; ctx.setLineDash([5 * scale, 4 * scale]);
    ctx.strokeRect(b.x, b.y, b.width, b.height); ctx.restore();
  }
  ctx.restore(); return fit;
}
