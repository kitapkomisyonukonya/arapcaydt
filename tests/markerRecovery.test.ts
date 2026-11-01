import {test} from 'node:test';
import assert from 'node:assert/strict';
import {columnCrops,missingMarkerCrops} from '../src/services/ocr/markerRecovery';
import {detectYdtQuestionRegions} from '../src/services/ocr/ydtQuestionDetector';
import fixture from './fixtures/soru4-ocr.json';
test('Soru 4: missing D label is recovered from its option text and matches the OCR-read box',()=>{
 const crops=missingMarkerCrops(fixture.optionMarkers,1920,1080);
 assert.equal(crops.length,1);assert.equal(crops[0].letter,'D');
 const r=crops[0].rectangle;assert.ok(r.left<=1008&&r.left+r.width>=1044&&r.top<=616&&r.top+r.height>=652);
 // The unread D is placed on the A B / C D / E lattice only because its option text exists there;
 // it must match the box a real OCR read of "D)" produces.
 const inferred=detectYdtQuestionRegions(fixture).regions.find(r=>r.id==='option-d')!;
 assert.ok(inferred.x>.50&&inferred.x+inferred.width<.64&&inferred.y>.54&&inferred.y+inferred.height<.64);
 const marker={text:'D)',confidence:89,x:1008/1920,y:616/1080,width:50/1920,height:36/1080,pixelX:1008,pixelY:616,pixelWidth:50,pixelHeight:36};
 const result=detectYdtQuestionRegions({...fixture,optionMarkers:[...fixture.optionMarkers,marker]});
 assert.deepEqual(result.detectedOptions,['A','B','C','D','E']);
 const d=result.regions.find(r=>r.id==='option-d')!;
 assert.ok(d.x>.50&&d.x+d.width<.64);assert.ok(d.y>.54&&d.y+d.height<.64);
 assert.deepEqual(missingMarkerCrops(fixture.optionMarkers.slice(0,2),1920,1080),[]);
});

test('A label missed beside its Arabic word is looked for in the column of its grid partner', () => {
  const W = 2400, H = 1350;
  const word = (text: string, px: number, py: number) => ({ text, confidence: 93, x: px / W, y: py / H,
    width: 52 / W, height: 51 / H, pixelX: px, pixelY: py, pixelWidth: 52, pixelHeight: 51 });
  // 2025 ÖSYM page (question 15): the label pass reads A), B), E) but not C) سليمة or D) سليمان.
  const a = word('A)', 500, 667), b = word('B)', 1217, 667), e = word('E)', 896, 968);
  const crops = columnCrops([a, b, e], W, H);
  assert.deepEqual(crops.map(c => c.letter), ['C', 'D']);
  const inside = (r: { left: number; top: number; width: number; height: number }, x0: number, y0: number, x1: number, y1: number) =>
    r.left <= x0 && r.top <= y0 && r.left + r.width >= x1 && r.top + r.height >= y1;
  assert.ok(inside(crops[0].rectangle, 502, 815, 555, 866)); // where C) is printed
  assert.ok(inside(crops[1].rectangle, 1217, 815, 1269, 866)); // where D) is printed
  // Narrow: never as far as the Arabic word or the other column.
  assert.ok(crops.every(c => c.rectangle.width < 100));
  // Question 14 (A) and D) read): B is looked for above D, C below A, and a strip stops at the next label in its column.
  const a14 = word('A)', 502, 683), d14 = word('D)', 1259, 841);
  const crops14 = columnCrops([a14, d14], W, H);
  assert.deepEqual(crops14.map(c => c.letter), ['C', 'B']);
  const [c14, b14] = crops14;
  assert.ok(inside(b14.rectangle, 1259, 683, 1310, 737) && b14.rectangle.top + b14.rectangle.height <= 841);
  assert.ok(c14.letter === 'C' && inside(c14.rectangle, 505, 841, 560, 895));
  assert.deepEqual(columnCrops([a, b, word('C)', 502, 815), word('D)', 1217, 815), e], W, H), []);
});
