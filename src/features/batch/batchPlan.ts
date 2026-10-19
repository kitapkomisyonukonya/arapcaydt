import { parseSolutionSemantics } from '../../services/analysis/solutionParser';
import type { AnnotationRegion } from '../../types';
import { SPOKEN_LIMIT, startsWithArabic } from '../../services/narration/narrationParts';

type Letter = 'A' | 'B' | 'C' | 'D' | 'E';

export interface SolutionSection { number: number; text: string }

/**
 * One document, many questions: a line starting with "Soru 3", "3. Soru" or
 * "## Soru 3" opens question 3. The heading only names the question: it is
 * dropped from the solution, so the narration does not read "Soru 3" aloud.
 * Text before the first heading is ignored.
 */
export function splitSolutions(document: string): SolutionSection[] {
  // The number must end the line or be followed by punctuation: "Soru 1'de …" inside a solution is not a heading.
  const heading = /^[ \t]*(?:#{1,6}[ \t]*)?(?:soru[ \t]*(\d{1,3})(?=[ \t]*(?:[.:)\-–]|$))|(\d{1,3})[ \t]*\.[ \t]*soru(?=[ \t]*(?:[.:)\-–]|$)))/gimu;
  const text = document.replace(/\r\n?/g, '\n');
  const starts = Array.from(text.matchAll(heading)).map(m => ({ index: m.index!, end: m.index! + m[0].length, number: Number(m[1] || m[2]) }));
  return starts.map((start, i) => ({
    number: start.number,
    text: text.slice(start.end, starts[i + 1]?.index ?? text.length).replace(/^[ \t]*[.:)\-–]?/, '').trim(),
  })).filter(section => section.text.length > 0);
}

/**
 * Question number from a file name: "soru_12.png", "S3.jpg", "q07.mp3",
 * "2026-ydt-soru-12.png" → 12. A number after soru/s/q wins; otherwise the
 * only number in the name; a name with several unlabeled numbers is ambiguous.
 */
export function questionNumberFromFileName(name: string): number | null {
  const base = name.replace(/\.[^.]+$/, '');
  const labeled = base.match(/(?:soru|s|q)[ _\-.]*(\d{1,3})(?!\d)/i);
  if (labeled) return Number(labeled[1]);
  const numbers = base.match(/\d+/g) || [];
  return numbers.length === 1 && numbers[0].length <= 3 ? Number(numbers[0]) : null;
}

export interface BatchFileRef { name: string }
export interface BatchItem<F extends BatchFileRef = BatchFileRef> {
  number: number;
  image?: F;
  solution?: string;
  audio?: F;
  /** Answer the script states ("Doğru cevap C"); undefined when the text never says it. */
  answer?: Letter;
  /** Blocking problems; the item is skipped until they are fixed. */
  problems: string[];
  /** Non-blocking notes shown in the match table. */
  notes: string[];
}

const OPTION_REGIONS: AnnotationRegion[] = ['a', 'b', 'c', 'd', 'e'].map(l => ({ id: `option-${l}`, type: `option-${l}` as AnnotationRegion['type'], label: l.toUpperCase(), x: 0, y: 0, width: .1, height: .1 }));

export function buildBatchPlan<F extends BatchFileRef>(images: F[], solutionDocument: string, audios: F[] = []): { items: BatchItem<F>[]; unmatched: string[] } {
  const unmatched: string[] = [];
  const byNumber = new Map<number, BatchItem<F>>();
  const item = (n: number) => {
    if (!byNumber.has(n)) byNumber.set(n, { number: n, problems: [], notes: [] });
    return byNumber.get(n)!;
  };
  const place = (files: F[], key: 'image' | 'audio', kind: string) => {
    for (const file of files) {
      const n = questionNumberFromFileName(file.name);
      if (n === null) { unmatched.push(`${file.name}: dosya adında soru numarası bulunamadı`); continue; }
      const target = item(n);
      if (target[key]) { target.problems.push(`Aynı soru için iki ${kind}: ${target[key]!.name}, ${file.name}`); continue; }
      target[key] = file;
    }
  };
  place(images, 'image', 'görsel');
  place(audios, 'audio', 'ses dosyası');
  for (const section of splitSolutions(solutionDocument)) {
    const target = item(section.number);
    if (target.solution) { target.problems.push(`Metinde "Soru ${section.number}" iki kez geçiyor`); continue; }
    target.solution = section.text;
  }
  for (const it of byNumber.values()) {
    if (!it.image) it.problems.push('Görsel yok');
    if (!it.solution) it.problems.push('Çözüm metni yok');
    if (it.solution && it.solution.length > SPOKEN_LIMIT) it.problems.push(`Çözüm ${SPOKEN_LIMIT.toLocaleString('tr')} karakterden uzun`);
    if (it.solution) {
      it.answer = parseSolutionSemantics(it.solution, OPTION_REGIONS).deducedCorrectAnswer;
      if (!it.answer) it.notes.push('Metinde doğru cevap bulunamadı; işaretleri kontrol edin');
      if (startsWithArabic(it.solution)) it.notes.push('Çözüm Arapça başlıyor; kısa bir Türkçe cümleyle başlatın, yoksa ses Türkçeyi de Arap aksanıyla okur');
    }
  }
  return { items: [...byNumber.values()].sort((a, b) => a.number - b.number), unmatched };
}
