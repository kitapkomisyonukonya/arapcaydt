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

type Box = { id: string; x: number; y: number; width: number; height: number; content?: string };

/** Short options in a grid ("A) المتبعة   B) التابعة") are often missed by the page reading:
 * the option box is then only its label. The strip after such a label, up to the next label in
 * its row (or one column step when it is last), is read again on its own. */
export function emptyOptionCrops(regions: Box[], width: number, height: number) {
  const options = regions.filter(r => /^option-[a-e]$/.test(r.id));
  const sameRow = (a: Box, b: Box) => Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < Math.max(a.height, b.height) * .6;
  const steps = options.flatMap(a => options.filter(b => b !== a && b.x > a.x && sameRow(a, b))
    .map(b => b.x - a.x).sort((p, q) => p - q).slice(0, 1));
  const step = steps.length ? Math.min(...steps) : 0;
  if (!step) return [];
  return options.filter(o => !/[\u0621-\u064A]/.test(o.content || '')).map(o => {
    const next = options.filter(b => b.x > o.x && sameRow(o, b)).sort((p, q) => p.x - q.x)[0];
    // From inside the label: a short word can touch it ("A)إذ").
    const from = o.x + o.width - .008;
    const to = Math.min(1, (next ? next.x : o.x + step) - .01);
    const top = Math.max(0, Math.floor((o.y - o.height * .6) * height));
    const left = Math.floor(from * width);
    return { id: o.id, rectangle: { left, top, width: Math.max(1, Math.ceil((to - from) * width)), height: Math.min(height - top, Math.ceil(o.height * 2.2 * height)) } };
  }).filter(c => c.rectangle.width > width * .02);
}
