import {OCRWord} from './ocrTypes';

/** Crop only after three actual labels establish a two-column grid.
 * The crop is a search area, never an accepted annotation: OCR must read the
 * expected letter inside it before the detector receives a new marker. */
export function missingMarkerCrops(markers:OCRWord[],width:number,height:number){
  const byLetter=new Map(markers.map(w=>[w.text.replace(/[^A-E]/g,''),w]));
  const patterns=[['A','C','B','D'],['B','D','A','C'],['C','A','D','B'],['D','B','C','A']];
  return patterns.flatMap(([letter,columnLetter,rowLetter,cornerLetter])=>{
    if(byLetter.has(letter))return [];
    const column=byLetter.get(columnLetter),row=byLetter.get(rowLetter),corner=byLetter.get(cornerLetter);
    if(!column||!row||!corner)return [];
    if(Math.abs(column.y-corner.y)>.025||Math.abs(row.x-corner.x)>.035||Math.abs(column.x-row.x)<.12||Math.abs(column.y-row.y)<.04)return [];
    const left=Math.max(0,Math.floor(column.pixelX-width*.008));
    const top=Math.max(0,Math.floor(row.pixelY-height*.015));
    return [{letter,rectangle:{left,top,width:Math.min(width-left,Math.ceil(column.pixelWidth+width*.016)),height:Math.min(height-top,Math.ceil(row.pixelHeight+height*.03))}}];
  });
}

/** A label beside a short Arabic word ("C) التي") is often read with low confidence or not at all,
 * even on a clean page; alone in a narrow strip it reads clearly. A missing A-D label is looked for in
 * the column of the label that shares its column in the A B / C D grid (C under A, B over D, ...):
 * a strip as wide as that label, up to a quarter of the page high, stopping at the next label in it.
 * Like the grid crops above, it is only a search area: the expected letter must be read inside. */
export function columnCrops(markers: OCRWord[], width: number, height: number) {
  const letter = (w: OCRWord) => w.text.replace(/[^A-E]/g, '');
  const byLetter = new Map(markers.map(w => [letter(w), w]));
  const partners: [string, string, 1 | -1][] = [['C', 'A', 1], ['D', 'B', 1], ['A', 'C', -1], ['B', 'D', -1]];
  return partners.flatMap(([missing, partnerLetter, below]) => {
    const partner = byLetter.get(partnerLetter);
    if (byLetter.has(missing) || !partner) return [];
    const reach = height * .25, gap = Math.round(height * .005);
    const column = markers.filter(m => m !== partner && Math.abs(m.x - partner.x) < .035 && (m.y - partner.y) * below > .02);
    let top: number, bottom: number;
    if (below > 0) {
      top = partner.pixelY + partner.pixelHeight + gap;
      bottom = Math.min(height, top + reach, ...column.map(m => m.pixelY - gap));
    } else {
      bottom = partner.pixelY - gap;
      top = Math.max(0, bottom - reach, ...column.map(m => m.pixelY + m.pixelHeight + gap));
    }
    const left = Math.max(0, Math.floor(partner.pixelX - width * .008));
    const rectangle = { left, top: Math.floor(top), width: Math.min(width - left, Math.ceil(partner.pixelWidth + width * .016)), height: Math.floor(bottom - top) };
    return rectangle.height > partner.pixelHeight ? [{ letter: missing, rectangle }] : [];
  });
}

/** How far past its label an unread one-column option is looked for: short options stay in the left half. */
const MAX_REACH = .42;

type Box = { id: string; x: number; y: number; width: number; height: number; content?: string };

/** Short options are often missed by the page reading: the option box is then only its label.
 * The strip after such a label is read again on its own: in a grid ("A) المتبعة   B) التابعة") up to
 * the next label in its row (or one column step when it is last); with one option per row up to where
 * the Arabic options that were read end, as a short Arabic option sits at the right of its line.
 * When no option at all was read in one column (a slide whose short options the page reading skips
 * entirely), each strip reaches to the first word read further along its row (a solution panel beside
 * the options), at most a reach that keeps it in the option half of the page. */
export function emptyOptionCrops(regions: Box[], width: number, height: number, words: Omit<Box, 'id'>[] = []) {
  const options = regions.filter(r => /^option-[a-e]$/.test(r.id));
  const sameRow = (a: Box, b: Box) => Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < Math.max(a.height, b.height) * .6;
  const steps = options.flatMap(a => options.filter(b => b !== a && b.x > a.x && sameRow(a, b))
    .map(b => b.x - a.x).sort((p, q) => p - q).slice(0, 1));
  const step = steps.length ? Math.min(...steps) : 0;
  const arabic = (o: Box) => /[\u0621-\u064A]/.test(o.content || '');
  const read = options.filter(arabic);
  const lineEnd = !step && read.length ? Math.max(...read.map(o => o.x + o.width)) : 0;
  // In one column only a box that is just its label ("\u200eE)\u200f E)"): Turkish options are read too.
  const unread = (o: Box) => step ? !arabic(o) : !/\p{L}/u.test((o.content || '').replace(/[A-E]\s*[).]/g, ''));
  const column = !step && !lineEnd && options.length >= 3 && options.every(o => unread(o) && Math.abs(o.x - options[0].x) < .03);
  if (!step && !lineEnd && !column) return [];
  return options.filter(unread).map(o => {
    const next = options.filter(b => b.x > o.x && sameRow(o, b)).sort((p, q) => p.x - q.x)[0];
    // From inside the label: a short word can touch it ("A)إذ").
    const from = o.x + o.width - .008;
    const beside = column ? words.filter(w => w.x > o.x + o.width + .02 && sameRow(o, { ...w, id: '' })).map(w => w.x - .01) : [];
    const to = Math.min(1, step ? (next ? next.x : o.x + step) - .01 : column ? Math.min(o.x + MAX_REACH, ...beside) : lineEnd + .01);
    const top = Math.max(0, Math.floor((o.y - o.height * .6) * height));
    const left = Math.floor(from * width);
    return { id: o.id, rectangle: { left, top, width: Math.max(1, Math.ceil((to - from) * width)), height: Math.min(height - top, Math.ceil(o.height * 2.2 * height)) } };
  }).filter(c => c.rectangle.width > width * .02);
}
