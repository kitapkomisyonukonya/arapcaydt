import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSolutionSemantics } from '../src/services/analysis/solutionParser';
import { narrationDrift, alignEventsWithNarration, alignSolutionNarration } from '../src/services/analysis/timelineAligner';
import type { AnnotationRegion, NarrationWord } from '../src/types';
import type { ArabicMatchResult } from '../src/services/ocr/arabicMatcher';
const regions: AnnotationRegion[] = ['A','B','C','D','E'].map(letter => ({id: `option-${letter.toLowerCase()}`,type:'option',label:letter,x:0,y:0,width:.2,height:.1}));
// Regression fixture: approved Konak script and the actual local Whisper word
// timings from the user's 127.555875-second narration. No network/API needed.
const konakText = "Soru 1\nيَقَعُ بُرْجُ السَّاعَةِ الَّذِي يُعَدُّ رَمْزَ إِزْمِيرَ\nفِي مَيْدَانِ «كُونَاك»\nوَهُوَ مَكَانُ ---- سُكَّانِ إِزْمِيرَ حَالِيًّا.\nTürkçesi: İzmir’in simgesi sayılan Saat Kulesi,\nKonak Meydanı’nda yer almaktadır\nve burası günümüzde İzmir sakinlerinin ---- yeridir.\nİlk olarak cümlenin anlamına bakalım.\nيَقَعُ بُرْجُ السَّاعَةِ ifadesi, “Saat Kulesi yer almaktadır” demektir.\nالَّذِي يُعَدُّ رَمْزَ إِزْمِيرَ ifadesi ise,\n“İzmir’in simgesi sayılan” anlamına gelir.\nفِي مَيْدَانِ كُونَاك, “Konak Meydanı’nda” demektir.\nCümlenin ikinci kısmında وَهُوَ مَكَانُ ifadesini görüyoruz.\nBu ifade “ve burası ... yeridir” anlamına gelir.\nBoşluktan sonra سُكَّانِ إِزْمِيرَ,\nyani “İzmir sakinleri” ifadesi gelmektedir.\nDolayısıyla burada anlam bakımından\n“İzmir sakinlerinin buluşma veya toplanma yeri”\nanlamını verecek bir kelime arıyoruz.\nŞimdi şıklara bakalım.\nA şıkkı: اِسْتِخْدَامٌ. “Kullanım” demektir.\nمَكَانُ اِسْتِخْدَامِ سُكَّانِ إِزْمِيرَ şeklinde düşünüldüğünde,\n“İzmir sakinlerinin kullanım yeri” gibi bir anlam ortaya çıkar.\nCümlenin bağlamına uygun değildir. Olmaz.\nB şıkkı: اِخْتِيَارٌ.\n“Seçim” veya “seçme” anlamına gelir.\n“İzmir sakinlerinin seçim yeri” anlamı burada uygun değildir. Olmaz.\nC şıkkındaki kelime de cümlenin anlamına uygun\nbir “buluşma yeri” anlamı oluşturmamaktadır.\nBu nedenle onu da eliyoruz.\nD şıkkı: اِجْتِمَاعٌ.\n“Toplanma, buluşma” anlamına gelir.\nمَكَانُ اِجْتِمَاعِ سُكَّانِ إِزْمِيرَ ifadesi,\n“İzmir sakinlerinin buluşma veya toplanma yeri” demektir.\nBu hem dil bilgisi hem de cümlenin anlamı bakımından\ntam olarak uygundur.\nE şıkkı: اِكْتِمَالٌ.\n“Tamamlanma” anlamına gelir.\n“İzmir sakinlerinin tamamlanma yeri” şeklinde\nanlamsız bir ifade ortaya çıkar. Olmaz.\nDolayısıyla doğru cevap D şıkkı, اِجْتِمَاعٌ olur.\nCümlenin doğru hâli:\nيَقَعُ بُرْجُ السَّاعَةِ الَّذِي يُعَدُّ رَمْزَ إِزْمِيرَ\nفِي مَيْدَانِ «كُونَاك»\nوَهُوَ مَكَانُ اِجْتِمَاعِ سُكَّانِ إِزْمِيرَ حَالِيًّا.\nYani İzmir’in simgesi sayılan Saat Kulesi,\nKonak Meydanı’nda yer almaktadır\nve burası günümüzde İzmir sakinlerinin buluşma yeridir.\nDoğru cevap: D.";
const konakWords: NarrationWord[] = [{"text":"Soru","start":0.0,"end":0.34},{"text":"bir","start":0.34,"end":0.54},{"text":"yakao","start":0.54,"end":0.96},{"text":"burcu","start":0.96,"end":1.22},{"text":"saat","start":1.22,"end":1.5},{"text":"ile","start":1.5,"end":1.8},{"text":"deyiyor","start":1.8,"end":2.12},{"text":"at","start":2.12,"end":2.34},{"text":"duramıza","start":2.34,"end":2.68},{"text":"İzmir,","start":2.68,"end":3.02},{"text":"Fimeydani","start":3.24,"end":3.76},{"text":"Konak.","start":3.76,"end":4.18},{"text":"O","start":4.44,"end":4.58},{"text":"huamekanın","start":4.58,"end":5.08},{"text":"sükkani","start":5.08,"end":5.56},{"text":"İzmir","start":5.56,"end":5.94},{"text":"'e","start":5.94,"end":6.0},{"text":"haliye,","start":6.0,"end":6.58},{"text":"Türkçesi,","start":6.74,"end":7.28},{"text":"İzmir","start":7.72,"end":7.98},{"text":"'in","start":7.98,"end":8.12},{"text":"simgesi","start":8.12,"end":8.58},{"text":"sayılan","start":8.58,"end":8.94},{"text":"saat","start":8.94,"end":9.28},{"text":"kulesi","start":9.28,"end":9.92},{"text":"konak","start":9.92,"end":10.36},{"text":"meydanında","start":10.36,"end":10.9},{"text":"yer","start":10.9,"end":11.06},{"text":"almaktadır","start":11.06,"end":11.7},{"text":"ve","start":11.7,"end":11.8},{"text":"burası","start":11.8,"end":12.08},{"text":"günümüzde","start":12.08,"end":12.62},{"text":"İzmir","start":12.62,"end":12.9},{"text":"sakinlerinin","start":12.9,"end":13.74},{"text":"yeridir.","start":13.74,"end":14.2},{"text":"İk","start":14.86,"end":15.1},{"text":"olarak","start":15.1,"end":15.26},{"text":"cümlenin","start":15.26,"end":15.72},{"text":"anlamına","start":15.72,"end":16.12},{"text":"bakalım,","start":16.12,"end":16.42},{"text":"yakao","start":16.84,"end":17.16},{"text":"burcu","start":17.16,"end":17.46},{"text":"saat","start":17.46,"end":17.8},{"text":"ifadesi","start":17.8,"end":18.6},{"text":"saat","start":18.6,"end":19.06},{"text":"kulesi","start":19.06,"end":19.52},{"text":"yer","start":19.52,"end":19.66},{"text":"almaktadır","start":19.66,"end":20.28},{"text":"demektir.","start":20.28,"end":20.84},{"text":"Ellerliği","start":20.84,"end":21.8},{"text":"yiyor","start":21.8,"end":21.94},{"text":"at","start":21.94,"end":22.12},{"text":"duramıza","start":22.12,"end":22.52},{"text":"İzmir","start":22.52,"end":22.9},{"text":"'e","start":22.9,"end":23.06},{"text":"ifadesi","start":23.06,"end":23.72},{"text":"ise","start":23.72,"end":23.96},{"text":"İzmir","start":23.96,"end":24.58},{"text":"'in","start":24.58,"end":24.74},{"text":"simgesi","start":24.74,"end":25.24},{"text":"sayılan","start":25.24,"end":25.6},{"text":"anlamına","start":25.6,"end":26.18},{"text":"gelir.","start":26.18,"end":26.46},{"text":"Fimeydani","start":26.98,"end":27.72},{"text":"Konak,","start":27.72,"end":28.16},{"text":"Konak","start":28.3,"end":28.7},{"text":"meydanında","start":28.7,"end":29.26},{"text":"demektir.","start":29.26,"end":30.06},{"text":"Cümlenin","start":30.54,"end":31.04},{"text":"ikinci","start":31.04,"end":31.34},{"text":"kısmındaysı,","start":31.34,"end":32.1},{"text":"o","start":32.42,"end":32.5},{"text":"huamekani","start":32.5,"end":33.1},{"text":"ifadesini","start":33.1,"end":33.76},{"text":"görüyoruz,","start":33.76,"end":34.38},{"text":"bu","start":34.58,"end":34.64},{"text":"ifade","start":34.64,"end":35.08},{"text":"ve","start":35.08,"end":35.46},{"text":"burası","start":35.46,"end":35.9},{"text":"yeridir","start":35.9,"end":36.38},{"text":"anlamına","start":36.38,"end":37.0},{"text":"gelir.","start":37.0,"end":37.28},{"text":"Boşluktan","start":37.9,"end":38.5},{"text":"sonra,","start":38.5,"end":38.96},{"text":"sükkani","start":39.26,"end":39.64},{"text":"İzmir","start":39.64,"end":40.08},{"text":"'e","start":40.08,"end":40.5},{"text":"yani","start":40.5,"end":40.68},{"text":"İzmir","start":40.68,"end":41.14},{"text":"sakinleri","start":41.14,"end":41.7},{"text":"ifadesi","start":41.7,"end":42.3},{"text":"gelmektedir.","start":42.3,"end":43.04},{"text":"Dolayısıyla","start":43.42,"end":43.94},{"text":"burada","start":43.94,"end":44.2},{"text":"anlam","start":44.2,"end":44.5},{"text":"bakımından","start":44.5,"end":45.14},{"text":"İzmir","start":45.14,"end":45.74},{"text":"sakinlerinin","start":45.74,"end":46.56},{"text":"buluşma","start":46.56,"end":47.06},{"text":"veya","start":47.06,"end":47.3},{"text":"toplanma","start":47.3,"end":47.9},{"text":"yeri","start":47.9,"end":48.14},{"text":"anlamını","start":48.14,"end":48.56},{"text":"verecek","start":48.56,"end":48.88},{"text":"bir","start":48.88,"end":49.08},{"text":"kelime","start":49.08,"end":49.46},{"text":"arıyoruz.","start":49.46,"end":49.88},{"text":"Şimdi","start":49.88,"end":50.68},{"text":"şıklara","start":50.68,"end":51.1},{"text":"bakalım,","start":51.1,"end":51.6},{"text":"aşık","start":51.92,"end":52.32},{"text":"ki","start":52.32,"end":52.54},{"text":"istihdamun","start":52.54,"end":53.52},{"text":"kullanım","start":53.52,"end":54.18},{"text":"demektir.","start":54.18,"end":54.92},{"text":"Mekanun","start":55.34,"end":55.92},{"text":"istihdami,","start":55.92,"end":56.6},{"text":"sükkani","start":56.6,"end":57.0},{"text":"İzmir","start":57.0,"end":57.4},{"text":"'e","start":57.4,"end":57.48},{"text":"şeklinde","start":57.48,"end":57.98},{"text":"düşünüldüğünde","start":57.98,"end":58.82},{"text":"İzmir","start":58.82,"end":59.44},{"text":"sakinlerinin","start":59.44,"end":60.16},{"text":"kullanım","start":60.16,"end":60.64},{"text":"yeri","start":60.64,"end":60.88},{"text":"gibi","start":60.88,"end":61.06},{"text":"bir","start":61.06,"end":61.26},{"text":"anlam","start":61.26,"end":61.5},{"text":"ortaya","start":61.5,"end":61.92},{"text":"çıkar,","start":61.92,"end":62.22},{"text":"cümlenin","start":62.66,"end":63.04},{"text":"bağlamını","start":63.04,"end":63.5},{"text":"uygun","start":63.5,"end":63.8},{"text":"değildir,","start":63.8,"end":64.4},{"text":"olmaz.","start":64.52,"end":64.78},{"text":"Beşıkkı,","start":65.4,"end":66.22},{"text":"Ihtiyarun,","start":66.32,"end":66.96},{"text":"seçim","start":67.26,"end":67.6},{"text":"veya","start":67.6,"end":67.8},{"text":"seçme","start":67.8,"end":68.32},{"text":"anlamına","start":68.32,"end":68.9},{"text":"gelir.","start":68.9,"end":69.1},{"text":"İzmir","start":69.76,"end":70.08},{"text":"sakinlerinin","start":70.08,"end":70.82},{"text":"seçim","start":70.82,"end":71.2},{"text":"yere","start":71.2,"end":71.36},{"text":"anlamı","start":71.36,"end":71.84},{"text":"burada","start":71.84,"end":72.06},{"text":"uygun","start":72.06,"end":72.44},{"text":"değildir,","start":72.44,"end":73.08},{"text":"olmaz.","start":73.24,"end":73.5},{"text":"Ceşıkkındaki","start":74.3,"end":74.86},{"text":"kelime","start":74.86,"end":75.3},{"text":"de","start":75.3,"end":75.56},{"text":"cümlenin","start":75.56,"end":75.96},{"text":"anlamını","start":75.96,"end":76.38},{"text":"uygun","start":76.38,"end":76.7},{"text":"bir","start":76.7,"end":77.02},{"text":"buluşma","start":77.02,"end":77.6},{"text":"yeri","start":77.6,"end":77.82},{"text":"anlamı","start":77.82,"end":78.18},{"text":"oluşturmamaktadır.","start":78.18,"end":79.24},{"text":"Bu","start":79.5,"end":79.58},{"text":"nedenle","start":79.58,"end":80.0},{"text":"onu","start":80.0,"end":80.12},{"text":"da","start":80.12,"end":80.32},{"text":"eliyoruz.","start":80.32,"end":80.8},{"text":"Deşıkkı,","start":81.32,"end":82.0},{"text":"Ihtiyarun,","start":82.2,"end":82.82},{"text":"toplanma,","start":83.16,"end":83.7},{"text":"buluşma","start":83.9,"end":84.24},{"text":"anlamına","start":84.24,"end":84.74},{"text":"gelir.","start":84.74,"end":84.98},{"text":"Mekanun","start":85.52,"end":86.1},{"text":"Ihtiyar","start":86.1,"end":86.52},{"text":"'i","start":86.52,"end":86.64},{"text":"sükkani","start":86.64,"end":87.1},{"text":"İzmir","start":87.1,"end":87.48},{"text":"'e","start":87.48,"end":87.64},{"text":"ifadesi","start":87.64,"end":88.4},{"text":"İzmir","start":88.4,"end":88.9},{"text":"sakinlerinin","start":88.9,"end":89.68},{"text":"buluşma","start":89.68,"end":90.16},{"text":"veya","start":90.16,"end":90.38},{"text":"toplanma","start":90.38,"end":91.02},{"text":"yeri","start":91.02,"end":91.24},{"text":"demektir.","start":91.24,"end":91.86},{"text":"Bu","start":92.14,"end":92.38},{"text":"hem","start":92.38,"end":92.58},{"text":"dil","start":92.58,"end":92.74},{"text":"bilgisi","start":92.74,"end":93.24},{"text":"hem","start":93.24,"end":93.64},{"text":"de","start":93.64,"end":93.76},{"text":"cümlenin","start":93.76,"end":94.16},{"text":"anlamı","start":94.16,"end":94.52},{"text":"bakımından","start":94.52,"end":95.02},{"text":"tam","start":95.02,"end":95.24},{"text":"olarak","start":95.24,"end":95.56},{"text":"uygun","start":95.56,"end":95.96},{"text":"dur.","start":95.96,"end":96.16},{"text":"Eşıkkı,","start":96.16,"end":97.4},{"text":"Ihtiyarun,","start":97.64,"end":98.2},{"text":"tamamlanma","start":98.5,"end":99.14},{"text":"anlamına","start":99.14,"end":99.66},{"text":"gelir.","start":99.66,"end":99.9},{"text":"İzmir","start":100.44,"end":100.8},{"text":"sakinlerinin","start":100.8,"end":101.56},{"text":"tamamlanma","start":101.56,"end":102.24},{"text":"yeri","start":102.24,"end":102.42},{"text":"şeklinde","start":102.42,"end":102.92},{"text":"anlamsız","start":102.92,"end":103.54},{"text":"bir","start":103.54,"end":103.74},{"text":"ifade","start":103.74,"end":104.08},{"text":"ortaya","start":104.08,"end":104.46},{"text":"çıkar,","start":104.46,"end":104.72},{"text":"olmaz.","start":105.02,"end":105.3},{"text":"Dolayısıyla","start":105.9,"end":106.5},{"text":"doğru","start":106.5,"end":106.74},{"text":"cevap","start":106.74,"end":107.06},{"text":"değişikkı,","start":107.06,"end":107.8},{"text":"Ihtiyarun","start":108.06,"end":108.62},{"text":"olur.","start":108.62,"end":108.88},{"text":"Cümlenin","start":109.46,"end":109.9},{"text":"doğru","start":109.9,"end":110.1},{"text":"hali,","start":110.1,"end":110.54},{"text":"yakao","start":110.92,"end":111.26},{"text":"burcu","start":111.26,"end":111.54},{"text":"seyahatillediği","start":111.54,"end":112.36},{"text":"yuva","start":112.36,"end":112.54},{"text":"duranca","start":112.54,"end":113.02},{"text":"İzmir,","start":113.02,"end":113.42},{"text":"Fimeydani","start":113.68,"end":114.22},{"text":"Kunak,","start":114.22,"end":114.56},{"text":"vahuvamekano","start":114.92,"end":115.56},{"text":"Ihtiyar","start":115.56,"end":116.04},{"text":"'i","start":116.04,"end":116.18},{"text":"sükkani","start":116.18,"end":116.58},{"text":"İzmir","start":116.58,"end":117.0},{"text":"'e","start":117.0,"end":117.12},{"text":"haliyen.","start":117.12,"end":117.72},{"text":"Yani","start":118.16,"end":118.5},{"text":"İzmir","start":118.5,"end":119.2},{"text":"'in","start":119.2,"end":119.34},{"text":"simgesi","start":119.34,"end":119.82},{"text":"sayılan","start":119.82,"end":120.14},{"text":"saat","start":120.14,"end":120.5},{"text":"kulesi","start":120.5,"end":121.06},{"text":"konak","start":121.06,"end":121.56},{"text":"meydanında","start":121.56,"end":122.08},{"text":"yer","start":122.08,"end":122.24},{"text":"almaktadır","start":122.24,"end":122.98},{"text":"ve","start":122.98,"end":123.22},{"text":"burası","start":123.22,"end":123.52},{"text":"günümüzde","start":123.52,"end":124.08},{"text":"İzmir","start":124.08,"end":124.38},{"text":"sakinlerinin","start":124.38,"end":125.14},{"text":"buluşma","start":125.14,"end":125.6},{"text":"yeridir.","start":125.6,"end":125.96},{"text":"Dolayısıyla","start":125.96,"end":126.72},{"text":"doğru","start":126.72,"end":126.72},{"text":"cevap","start":126.72,"end":127.04},{"text":"değişikkı,","start":127.04,"end":127.52},{"text":"Ihtiyarun","start":127.52,"end":127.52},{"text":"olur.","start":127.52,"end":127.52}];

test('Konak: actual narration anchors each option, keeps explanations visible, and eliminates at the spoken judgment', () => {
  const parsed = parseSolutionSemantics(konakText, regions);
  const actions = alignEventsWithNarration(parsed.events, konakWords, 127.555875, konakText);
  assert.equal(parsed.deducedCorrectAnswer, 'D');
  // D is praised at 94.5 ("tam olarak uygundur"), but its check waits for "doğru cevap D" at 106.5.
  const expected = { A: [51.92, 63.6], B: [65.4, 72.3], C: [74.3, 80.32], D: [81.32, 106.5], E: [96.5, 105.02] };
  for (const [letter, [focusTime, markTime]] of Object.entries(expected)) {
    const focus = actions.find(a => a.targetRegionId === `option-${letter.toLowerCase()}` && a.type === 'focus');
    const mark = actions.find(a => a.targetRegionId === `option-${letter.toLowerCase()}` && a.type === (letter === 'D' ? 'correct' : 'reject'));
    assert.ok(focus, `${letter} focus missing`);
    assert.ok(mark, `${letter} mark missing`);
    assert.ok(Math.abs(focus.start - focusTime) < 1, `${letter} focus ${focus.start} vs ${focusTime}`);
    assert.ok(Math.abs(mark.start - markTime) < 1.4, `${letter} mark ${mark.start} vs ${markTime}`);
    assert.ok(focus.duration > 5, `${letter} explanation disappeared after ${focus.duration}s`);
    if (letter !== 'D') assert.ok(Math.abs(focus.start + focus.duration - mark.start) < .25);
  }
  assert.equal(actions.filter(a => a.type === 'correct').length, 1, 'Repeated final D must not replay check animation');
});

test('Konak: captions preserve supplied Arabic; Whisper Turkish phonetics are never displayed', () => {
  const aligned = alignSolutionNarration(konakText, konakWords, 127.555875);
  assert.equal(aligned.quality, 'anchored');
  assert.ok(aligned.matchedRatio > .5);
  const captionText = aligned.captions.map(c => c.text).join(' ');
  assert.ok(captionText.includes('يَقَعُ بُرْجُ السَّاعَةِ'));
  assert.ok(!captionText.includes('yakao'));
  assert.equal(captionText.replace(/\s+/g, ' '), konakText.replace(/\s+/g, ' '));
  const firstA = aligned.captions.find(c => c.text.includes('A şıkkı'));
  assert.ok(firstA && firstA.start > 51 && firstA.start < 53);
});

test('a repeated Arabic phrase is underlined once, at its first reading', () => {
  const phrase = 'بُرْجُ السَّاعَةِ';
  const text = `${phrase} yer alır. Şimdi tekrar ${phrase} ifadesini açıklayalım.`;
  const narration: NarrationWord[] = [
    {text:phrase,start:1,end:2},{text:'yer',start:2,end:2.3},{text:'alır',start:2.3,end:3},
    {text:'Şimdi',start:8,end:8.4},{text:'tekrar',start:8.4,end:8.8},
    {text:phrase,start:9,end:10},{text:'ifadesini',start:10,end:10.5},{text:'açıklayalım',start:10.5,end:11},
  ];
  const region: AnnotationRegion = {id:'phrase-tower',type:'phrase',label:phrase,x:.2,y:.2,width:.2,height:.1};
  const matches = [{phrase,region,matchedWords: []}] as ArabicMatchResult[];
  const parsed = parseSolutionSemantics(text, [region], matches);
  const actions = alignEventsWithNarration(parsed.events, narration, 12, text);
  const highlights = actions.filter(a => a.type === 'highlight');
  const underlines = actions.filter(a => a.type === 'underline');
  assert.equal(highlights.length, 0);
  assert.equal(underlines.length, 1);
  assert.ok(Math.abs(underlines[0].start - 1) < .1);
});

test('missing timing uses the complete script length, independent of animation event count', () => {
  const intro = 'Bu cümlede kelimelerin anlamlarını ayrıntılı olarak inceliyoruz. '.repeat(10);
  const text = `${intro} A şıkkı kullanım demektir. Bağlamı uzun uzun değerlendiriyoruz. Olmaz. B şıkkı doğrudur.`;
  const parsed = parseSolutionSemantics(text, regions);
  const actions = alignEventsWithNarration(parsed.events, [], 100, text);
  const focusA = actions.find(a => a.type === 'focus' && a.targetRegionId === 'option-a')!;
  const rejectA = actions.find(a => a.type === 'reject' && a.targetRegionId === 'option-a')!;
  assert.ok(focusA.start > 80, `Long introduction was discarded: ${focusA.start}`);
  assert.ok(rejectA.start > focusA.start + 5, 'Rejection must not be guessed 320ms after focus');
  assert.equal(alignSolutionNarration(text, [], 100).quality, 'approximate');
});

test('negative correctness never marks a wrong option; standalone Olmaz rejects and tam olarak uygundur accepts', () => {
  const text = 'A şıkkı doğru değildir. B şıkkı. Olmaz. D şıkkı. Bu hem dil bilgisi hem anlam bakımından tam olarak uygundur. Doğru cevap D. Doğru cevap D.';
  const parsed = parseSolutionSemantics(text, regions);
  assert.equal(parsed.deducedCorrectAnswer, 'D');
  assert.equal(parsed.optionStances.A, 'rejected');
  assert.equal(parsed.optionStances.B, 'rejected');
  assert.equal(parsed.events.filter(e => e.actionType === 'correct').length, 1);
  assert.ok(!parsed.events.some(e => e.actionType === 'correct' && e.targetOptionLetter === 'A'));
});

test('word-aligned and chunk-aligned timing quality remain distinguishable', () => {
  assert.equal(alignSolutionNarration('A şıkkı.', [{text:'A',start:0,end:1},{text:'şıkkı',start:1,end:2}], 3).quality, 'word-aligned');
  assert.equal(alignSolutionNarration('A şıkkı.', [{text:'A şıkkı',start:0,end:2}], 3).quality, 'anchored');
});

test('a generated voice that adds or skips words is caught from the timing transcript', () => {
  const script = 'A şıkkına bakalım. Bu kelime yazdı demektir, anlama uymaz. Doğru cevap E şıkkıdır.';
  const say = (text: string) => text.split(' ').map((t, i) => ({ text: t, start: i * .5, end: i * .5 + .4 }));
  assert.deepEqual(narrationDrift(script, say(script)), { added: [], skipped: [] }, 'faithful reading');
  const added = narrationDrift(script, say('A şıkkına bakalım. Sevgili öğrenciler şimdi hep birlikte bakalım. Bu kelime yazdı demektir, anlama uymaz. Doğru cevap E şıkkıdır.'));
  assert.equal(added.added.length, 1);
  assert.match(added.added[0].text, /Sevgili öğrenciler/);
  const skipped = narrationDrift(script, say('A şıkkına bakalım. Doğru cevap E şıkkıdır.'));
  assert.equal(skipped.skipped.length, 1);
  assert.match(skipped.skipped[0].text, /yazdı demektir/);
  // Arabic heard as Latin letters is a substitution, not an addition.
  const arabic = 'الكتاب مفيد demektir. Doğru cevap E şıkkıdır.';
  assert.deepEqual(narrationDrift(arabic, say('elkitabu mufid demektir. Doğru cevap E şıkkıdır.')), { added: [], skipped: [] });
});

test('a transcript that leaves out a read Arabic sentence does not push its underline past it', async () => {
  const { alignSolutionNarration } = await import('../src/services/analysis/timelineAligner');
  const text = 'Önce cümleyi okuyalım:\nيُعَرِّفُ الِاتِّحَادُ الْفَلَكِيُّ النَّيْزَكَ\nCümlede meteor anlatılıyor.';
  // The transcript wrote no Arabic: "okuyalım." swallowed the whole sentence (0.9–11.4 s).
  const spoken = [{ text: 'Önce', start: .1, end: .5 }, { text: 'cümleyi', start: .5, end: .9 }, { text: 'okuyalım.', start: .9, end: 11.4 },
    { text: 'Cümlede', start: 13.9, end: 14.4 }, { text: 'meteor', start: 14.4, end: 15 }, { text: 'anlatılıyor.', start: 15, end: 16 }];
  const arabic = alignSolutionNarration(text, spoken, 20).words.filter(w => /[\u0621-\u064A]/.test(w.text));
  assert.ok(arabic[0].start < 3, `the sentence starts right after "okuyalım" (${arabic[0].start.toFixed(1)} s)`);
  assert.ok(arabic[arabic.length - 1].end <= 13.9 + 1e-9, 'and is over before "Cümlede"');
});
