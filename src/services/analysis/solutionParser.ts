import { AnnotationRegion } from '../../types';
import { ArabicMatchResult } from '../ocr/arabicMatcher';

export interface SemanticParsedEvent {
  id: string;
  targetRegionId: string;
  actionType: 'focus' | 'reject' | 'correct' | 'tick' | 'cross' | 'highlight' | 'underline' | 'dim-others';
  semanticTriggerPhrase: string;
  sentenceText: string;
  targetOptionLetter?: 'A' | 'B' | 'C' | 'D' | 'E';
  order: number;
  /** Offsets into the unchanged narration, so repeated phrases stay distinct. */
  sourceStart?: number;
  sourceEnd?: number;
  sentenceStart?: number;
  sentenceEnd?: number;
  sourceText?: string;
}

export interface SolutionParseResult {
  events: SemanticParsedEvent[];
  deducedCorrectAnswer?: 'A' | 'B' | 'C' | 'D' | 'E';
  optionStances: Record<'A' | 'B' | 'C' | 'D' | 'E', 'rejected' | 'correct' | 'neutral'>;
  /** What triggers each option's mark; inferred = crossed because it was discussed and is not the answer. */
  verdicts?: Partial<Record<'A' | 'B' | 'C' | 'D' | 'E', { stance: 'rejected' | 'correct'; trigger: string; inferred: boolean }>>;
}

export const REJECTION_PATTERNS = [
  /doğru\s+(?:değil|olmaz|olamaz)/i,
  /olmaz/i,
  /uygun\s+değil/i,
  /uygun\s+olmaz/i,
  /eliyoruz/i,
  /eleyebiliriz/i,
  /elememiz\s+gerekir/i,
  /elenir/i,
  /elendi/i,
  /yanlış/i,
  /olamaz/i,
  /tercih\s+edemeyiz/i,
  /tercih\s+edilmez/i,
  /bu\s+seçenek\s+değil/i,
  /kullanılamaz/i,
  /kullanamayız/i,
  /hatalı/i,
  /anlamca\s+uymaz/i,
  /uymuyor/i,
  /uyuşmaz/i,
  /çelişmektedir/i,
  /geçersizdir/i,
  /doğru\s+olamaz/i,
  /bu\s+(?:yüzden|nedenle)\s+(?:onu\s+(?:da\s+)?|bunu\s+(?:da\s+)?)?el[ei]/i,
];

export const CORRECT_PATTERNS = [
  /tam\s+olarak\s+uygundur/i,
  /doğru\s+cevap/i,
  /doğru\s+yanıt/i,
  /cevabımız/i,
  /cevap\s+olarak/i,
  /doğrudur/i,
  /doğru\s+seçenek/i,
  /doğru\s+şık/i,
  /tamamen\s+uygundur/i,
  /en\s+uygun\s+seçenek/i,
  /aradığımız\s+seçenek/i,
  /aradığımız\s+cevap/i,
  /sağlamaktadır/i,
  /karşılamaktadır/i,
  /işaretliyoruz/i,
];

export const QUESTION_ROOT_PATTERNS = [
  /soruda/i,
  /soru\s+kökünde/i,
  /boşluğa/i,
  /boşlukta/i,
  /cümlede/i,
  /parçada/i,
  /ifadeye\s+baktığımızda/i,
];

type OptionLetter = 'A' | 'B' | 'C' | 'D' | 'E';
const LETTERS: OptionLetter[] = ['A', 'B', 'C', 'D', 'E'];

/** Only spoken forms that unambiguously name one option. Lower-case "de" is a Turkish particle. */
const LETTER_SRC = String.raw`(?:[BCD]e|[A-E]|[a-e])`;
const OPTION_WORD_SRC = String.raw`(?:seçene[a-zçğıöşü]*|şı[kğ][a-zçğıöşü]*)`;
const JOIN_SRC = String.raw`\s*(?:,|ve|ile|veya|ya\s+da|&|-)\s*`;
const toLetter = (raw: string) => raw[0].toUpperCase() as OptionLetter;

interface OptionMention {
  kind: 'option' | 'answer' | 'others';
  letters: OptionLetter[];
  start: number;
  end: number;
  text: string;
}

const NEGATED_CORRECT = /doğru\s+(?:cevap\s+|yanıt\s+|seçenek\s+|şık\s+)?(?:değil|olamaz|olmaz)/i;
/** Weak acceptance words are trusted only right after an option is named. */
const LOCAL_CORRECT_PATTERNS = [...CORRECT_PATTERNS, /(?<!\p{L})uygundur/iu, /doğru\s+olan/i, /cevaptır/i, /gelmelidir/i];
const EXTRA_REJECTION_PATTERNS = [/(?<!\p{L})uymaz/iu, /elemeliyiz/i, /eleriz/i, /eliyorum/i, /uymamaktadır/i, /uymadığı/i, /uygun\s+düşmez/i,
  /uygun\s+olmadığı/i, /karşılamaz/i, /anlamı\s+boz/i, /çeldirici/i,
  /(?<!\p{L})elen(?:ir|iyor|meli|mektedir|di|ecek)/iu, /(?<!\p{L})ele(?:yelim|yeceğiz|yebiliriz|memiz)/iu,
];
/**
 * Descriptions that show an option is wrong without the explicit verdict
 * ("ilgisi yoktur", "anlamsız bir ifade", "oluşturmamaktadır"). They cross the
 * option only when no explicit verdict ("olmaz", "eliyoruz") follows in its explanation.
 */
const WEAK_REJECTION_PATTERNS = [
  // "ilgisi yoktur", "alakası yok", "yeri yok", "karşılığı yok"
  /(?<!\p{L})(?:ilgi|alaka|yer|karşılı[kğ]|bağlantı|ilişki)\p{L}*\s+(?:da\s+|de\s+|hiç\s+)?yok/iu,
  /(?<!\p{L})(?:ilgisiz|alakasız|anlamsız|gereksiz|uyumsuz|yersiz|isabetsiz|aykırı)/iu,
  /(?<!\p{L})çeliş/iu, /ters\s+düş/i, /(?<!\p{L})boz(?:ar|uyor|maktadır|duğu)/iu, /dışında\s+kal|dışarıda\s+kal/i,
  // "anlamlı değildir", "uygun bir kullanım değil", "cevap değil"
  /(?<!\p{L})(?:anlamlı|uygun|geçerli|mümkün|yerinde|isabetli|doğru)\s+(?:bir\s+\p{L}+\s+)?değil/iu,
  /(?<!\p{L})(?:cevap|seçenek|karşılık|kullanım)\p{L}*\s+(?:olarak\s+)?değil/iu,
];
/** Words that end like a negative verb but are not one (DKAB and everyday vocabulary). */
const NOT_NEGATIVE = new Set(['namaz', 'namazlar', 'cemaz']);
/** Negative verb forms: uymaz, gelmez, karşılamıyor, taşımamaktadır, olmadığı, uymamış. */
const NEGATIVE_VERB = /(?<!\p{L})\p{L}+?(?:m[ıiuü]yor(?:lar)?|m[ae]z(?:lar)?|m[ae]m[ae]kt[ae]d[ıiuü]r|m[ae]d[ıiuü][ğk]\p{L}*|m[ae]m[ıiuü]ş(?:tır|tir)?)(?!\p{L})/giu;
/** A negative word that is itself negated means acceptance: "yanlış değildir", "hatalı sayılmaz". */
const DOUBLE_NEGATIVE = /(?<!\p{L})(?:yanlış|hatalı|geçersiz|ilgisiz|anlamsız|uygunsuz)\s+(?:bir\s+\p{L}+\s+)?(?:değil|sayılmaz)/iu;

function negativeVerb(text: string): { index: number; text: string } | null {
  for (const m of text.matchAll(NEGATIVE_VERB)) if (!NOT_NEGATIVE.has(m[0].toLocaleLowerCase('tr-TR'))) return { index: m.index!, text: m[0] };
  return null;
}

function findPattern(text: string, patterns: RegExp[]): { index: number; text: string } | null {
  let best: { index: number; text: string } | null = null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && (!best || match.index! < best.index)) best = { index: match.index!, text: match[0] };
  }
  return best;
}

/**
 * "Hangisi yanlıştır / değildir / söylenemez?": the answer is the option that is NOT true, so an
 * option explained as true ("bu ifade doğrudur") is eliminated and one explained as false is the answer.
 */
export function asksForFalse(solutionText: string): boolean {
  const question = solutionText.match(/[^\n.?!]*(?<!\p{L})hangi\p{L}*[^\n.?!]*\?/iu)?.[0];
  const last = question?.replace(/[\s?]+$/, '').split(/\s+/).pop()?.toLocaleLowerCase('tr-TR') || '';
  return /^(?:yanlış|hatalı|değil|yok|aykırı)/u.test(last) || /(?:m[ae]z|m[ae]m[ıi]şt[ıi]r)$/u.test(last);
}
/** Whether a segment calls the option's statement true or false (doğru / yanlış), not "doğru cevap". */
function truthIn(segment: string): { stance: 'rejected' | 'correct'; index: number; text: string } | null {
  const said = [
    { stance: 'correct' as const, match: segment.match(/(?<!\p{L})doğru\s+(?:değil|olamaz|olmaz)/iu) },
    { stance: 'rejected' as const, match: segment.match(DOUBLE_NEGATIVE) },
    { stance: 'correct' as const, match: segment.match(/(?<!\p{L})(?:yanlış|hatalı)/iu) },
    { stance: 'rejected' as const, match: segment.match(/(?<!\p{L})doğru(?:dur|dır)?(?!\s+(?:ceva[pb]|yanıt|seçenek|şık|olan))(?!\p{L})/iu) },
  ].filter(s => s.match).sort((a, b) => a.match!.index! - b.match!.index!)[0];
  return said ? { stance: said.stance, index: said.match!.index!, text: said.match![0] } : null;
}

/** Judgment spoken in a segment: rejection wins over incidental praise ("uygundur ama anlamca uymaz"). */
function stanceIn(segment: string, local: boolean, forFalse = false) {
  if (forFalse) {
    // Only true/false is turned around; "olmaz", "eliyoruz", "doğru cevap" keep their meaning.
    const truth = truthIn(segment);
    if (truth) return truth;
    const rejection = findPattern(segment, [...REJECTION_PATTERNS, ...EXTRA_REJECTION_PATTERNS]);
    if (rejection) return { stance: 'rejected' as const, ...rejection };
    const correct = findPattern(segment, local ? LOCAL_CORRECT_PATTERNS : CORRECT_PATTERNS);
    return correct ? { stance: 'correct' as const, ...correct } : null;
  }
  const negated = segment.match(NEGATED_CORRECT);
  if (negated) return { stance: 'rejected' as const, index: negated.index!, text: negated[0] };
  const accepted = segment.match(DOUBLE_NEGATIVE);
  if (accepted) return local ? { stance: 'correct' as const, index: accepted.index!, text: accepted[0] } : null;
  const rejection = findPattern(segment, [...REJECTION_PATTERNS, ...EXTRA_REJECTION_PATTERNS]);
  if (rejection) return { stance: 'rejected' as const, ...rejection };
  const correct = findPattern(segment, local ? LOCAL_CORRECT_PATTERNS : CORRECT_PATTERNS);
  if (correct) return { stance: 'correct' as const, ...correct };
  const listed = findPattern(segment, WEAK_REJECTION_PATTERNS);
  const verb = negativeVerb(segment);
  const weak = listed && verb ? (verb.index < listed.index ? verb : listed) : listed || verb;
  if (weak) return { stance: 'rejected' as const, weak: true, ...weak };
  return null;
}

/** Every option reference in a sentence, including lists ("A ve B şıkları") and "diğer seçenekler". */
function findOptionMentions(sentence: string): OptionMention[] {
  const found: OptionMention[] = [];
  const add = (mention: OptionMention) => {
    if (found.some(other => mention.start < other.end && other.start < mention.end)) return;
    found.push(mention);
  };
  const answer = new RegExp(String.raw`(?:[Dd]oğru\s+(?:ceva[pb]|yanıt|seçenek|şık)[a-zçğıöşü]*|[Cc]evab[ıi]m[ıi]z|[Cc]evap|[Yy]anıt)\s*(?:ise\s*|da\s*|de\s*)?[:\-–]?\s*((?:[BCD]e|[A-E]))(?![\p{L}\p{N}])(?:['’][a-zçğıöşü]+)?(?:\s*${OPTION_WORD_SRC})?`, 'gu');
  for (const m of sentence.matchAll(answer)) add({ kind: 'answer', letters: [toLetter(m[1])], start: m.index!, end: m.index! + m[0].length, text: m[0] });
  // "… olmayan ifade B seçeneğinde verilmiştir", "aranan bilgi D seçeneğidir": the closing answer.
  const given = /(?<!\p{L})(?:ifade|bilgi|yargı|cümle|görüş)\s+([A-E])\s+(?:seçene[ğk]|şıkk)(?:inde\s+(?:verilmiştir|yer\s+almaktadır|bulunmaktadır)|ıdır|idir)(?!\p{L})/gu;
  for (const m of sentence.matchAll(given)) add({ kind: 'answer', letters: [m[1] as OptionLetter], start: m.index!, end: m.index! + m[0].length, text: m[0] });
  const named = new RegExp(String.raw`(?<![\p{L}\p{N}])(${LETTER_SRC}(?:${JOIN_SRC}${LETTER_SRC})*)\s*(${OPTION_WORD_SRC})`, 'gu');
  for (const m of sentence.matchAll(named)) {
    const letters = [...new Set(Array.from(m[1].matchAll(new RegExp(String.raw`(?<![\p{L}])${LETTER_SRC}(?![\p{L}])`, 'gu')), x => toLetter(x[0])))];
    // "Şimdi de şıklara bakalım" is not option D; a single letter never takes a plural option word.
    if (!letters.length || (letters.length === 1 && /^(?:seçenekler|şıklar)/i.test(m[2]))) continue;
    add({ kind: 'option', letters, start: m.index!, end: m.index! + m[0].length, text: m[0] });
  }
  for (const m of sentence.matchAll(/(?<![\p{L}\p{N}])([A-E])['’][a-zçğıöşü]+/gu))
    add({ kind: 'option', letters: [m[1] as OptionLetter], start: m.index!, end: m.index! + m[0].length, text: m[0] });
  for (const m of sentence.matchAll(/(?<![\p{L}\p{N}])([A-E])\s*(?:\)|[:.](?=\s|$))/gu))
    add({ kind: 'option', letters: [m[1] as OptionLetter], start: m.index!, end: m.index! + m[0].length, text: m[0].trim() });
  for (const m of sentence.matchAll(/(?<![\p{L}])(?:diğer|geri\s+kalan|kalan|öteki)\s+(?:(?:dört|üç|iki)\s+)?(?:seçenek|şık)[a-zçğıöşü]*|(?<![\p{L}])diğerler[a-zçğıöşü]*/giu))
    add({ kind: 'others', letters: [], start: m.index!, end: m.index! + m[0].length, text: m[0] });
  return found.sort((a, b) => a.start - b.start);
}

/** "Birinci ifade", "II. öncül", "III numaralı yargı", "birinci ve ikinci ifadeler": numbered statements (I, II, III…). */
const PREMISE_NUMBER_SRC = String.raw`(?:[Bb]irinci|[İi]kinci|[Üü]çüncü|[Dd]ördüncü|[Bb]eşinci|IV|V|I{1,3}|[1-5](?=\s*\.))(?:\s*\.|\s+numaralı|\s+nolu|\s+no['’]lu)?`;
/** What a numbered item is called: "birinci ifade", "ikinci isim", "III. eser", "I numaralı ayet". */
const PREMISE_NOUN_SRC = ['ifade', 'madde', 'öncül', 'bilgi', 'cümle', 'yargı', 'görüş', 'önerme', 'isim', 'kişi', 'şahsiyet', 'âlim', 'alim',
  'eser', 'kitap', 'kavram', 'terim', 'örnek', 'durum', 'olay', 'öğe', 'unsur', 'özellik', 'uygulama', 'ayet', 'âyet', 'hadis', 'açıklama',
  'tanım', 'kelime', 'sözcük', 'söz', 'ibare', 'davranış', 'tutum', 'ilke', 'kural', 'tespit', 'değerlendirme', 'yorum', 'çıkarım'].join('|');
const PREMISE_MENTION = new RegExp(String.raw`(?<![\p{L}\p{N}])(${PREMISE_NUMBER_SRC}(?:${JOIN_SRC}${PREMISE_NUMBER_SRC})*)\s+(?:${PREMISE_NOUN_SRC})\p{L}*`, 'gu');
const PREMISE_NUMBERS: Record<string, number> = { birinci: 1, ikinci: 2, üçüncü: 3, dördüncü: 4, beşinci: 5, i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

function findPremiseMentions(sentence: string): Array<{ numbers: number[]; start: number; end: number; text: string }> {
  return Array.from(sentence.matchAll(PREMISE_MENTION), m => ({
    numbers: [...new Set(Array.from(m[1].matchAll(new RegExp(PREMISE_NUMBER_SRC, 'gu')), x => {
      const word = x[0].replace(/\s*(?:\.|numaralı|nolu|no['’]lu)$/u, '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
      return PREMISE_NUMBERS[word] ?? Number(word);
    }).filter(n => n >= 1 && n <= 5))],
    start: m.index!, end: m.index! + m[0].length, text: m[0],
  })).filter(m => m.numbers.length);
}

/** Whether a statement is said to be true (✓) or false (✗): "doğrudur", "söylenebilir" / "yanlıştır", "söylenemez". */
function premiseTruth(segment: string): { mark: 'tick' | 'cross'; index: number; text: string } | null {
  const said = truthIn(segment);
  const other = [
    { mark: 'cross' as const, match: segment.match(/(?<!\p{L})(?:söylenemez|ulaşılamaz|çıkarılamaz|geçerli\s+değil|çelişir|çelişmektedir|çelişkilidir)/iu) },
    { mark: 'tick' as const, match: segment.match(/(?<!\p{L})(?:söylenebilir|ulaşılabilir|çıkarılabilir|geçerlidir|çelişmez|çelişmemektedir)/iu) },
  ].filter(s => s.match).sort((a, b) => a.match!.index! - b.match!.index!)[0];
  // truthIn reads "doğru" as the stance of a "hangisi yanlıştır" option: "rejected" is a true statement.
  const truth = said ? { mark: said.stance === 'rejected' ? 'tick' as const : 'cross' as const, index: said.index, text: said.text } : null;
  const listed = other ? { mark: other.mark, index: other.match!.index!, text: other.match![0] } : null;
  return truth && listed ? (truth.index <= listed.index ? truth : listed) : truth || listed;
}

function answerMentionNegated(sentence: string, mention: OptionMention) {
  return /^\s*[a-zçğıöşü'’]*\s*(?:değil|olamaz|olmaz)/i.test(sentence.slice(mention.end, mention.end + 30));
}

function pushOptionEvent(
  events: SemanticParsedEvent[],
  counter: { value: number },
  option: OptionLetter,
  actionType: SemanticParsedEvent['actionType'],
  trigger: string,
  sentence: string,
  offsets?: { sourceStart: number; sourceEnd: number }
) {
  events.push({
    id: `event-${counter.value++}`,
    targetRegionId: `option-${option.toLowerCase()}`,
    actionType,
    semanticTriggerPhrase: trigger,
    sentenceText: sentence,
    targetOptionLetter: option,
    order: events.length + 1,
    ...offsets,
  });
}

/**
 * "A şıkkına bakalım … A şıkkı elenir": the option is still framed, so naming it
 * again adds no new mark. A frame ends when its option is judged or another is framed.
 */
function refocused(events: SemanticParsedEvent[]): Set<SemanticParsedEvent> {
  const repeat = new Set<SemanticParsedEvent>();
  let framed: string | undefined;
  for (const event of [...events].sort((a, b) => (a.sourceStart ?? 0) - (b.sourceStart ?? 0) || a.order - b.order)) {
    if (!event.targetOptionLetter) continue;
    if (event.actionType === 'focus') {
      if (framed === event.targetRegionId) repeat.add(event);
      framed = event.targetRegionId;
    } else if (['reject', 'correct', 'tick', 'cross'].includes(event.actionType) && framed === event.targetRegionId) {
      framed = undefined;
    }
  }
  return repeat;
}

/**
 * Local deterministic parser for the common language teachers naturally use
 * while solving YDT questions. It deliberately follows the most recently
 * mentioned option so a two-sentence explanation such as
 * "A seçeneğine bakalım. Bu yapı burada kullanılamaz, eliyoruz." still creates
 * the expected focus + reject animation sequence.
 */
export function parseSolutionSemantics(
  solutionText: string,
  availableRegions: AnnotationRegion[],
  arabicMatches: ArabicMatchResult[] = [],
  declaredCorrectAnswer?: OptionLetter
): SolutionParseResult {
  const events: SemanticParsedEvent[] = [];
  const optionStances: Record<OptionLetter, 'rejected' | 'correct' | 'neutral'> = {
    A: 'neutral',
    B: 'neutral',
    C: 'neutral',
    D: 'neutral',
    E: 'neutral',
  };

  let deducedCorrectAnswer: OptionLetter | undefined;
  let activeLetters: OptionLetter[] = [];
  const declared = declaredCorrectAnswer && LETTERS.includes(declaredCorrectAnswer) ? declaredCorrectAnswer : undefined;
  const counter = { value: 1 };
  const forFalse = asksForFalse(solutionText);
  const validRegionIds = new Set(availableRegions.map((r) => r.id));

  const sentences: Array<{ text: string; start: number; end: number }> = [];
  // "I. öncül", "2. madde": the dot of a numbered statement does not end the sentence.
  const boundary = /(?:\r?\n)+|(?<=[.!?;])(?<!(?<![\p{L}\p{N}])(?:I{1,3}|IV|V|[1-5])\.)\s+/gu;
  let cursor = 0;
  const addSentence = (end: number) => {
    const raw = solutionText.slice(cursor, end);
    const text = raw.trim();
    if (text) {
      const start = cursor + raw.indexOf(text);
      sentences.push({ text, start, end: start + text.length });
    }
  };
  for (const match of solutionText.matchAll(boundary)) {
    addSentence(match.index!);
    cursor = match.index! + match[0].length;
  }
  addSentence(solutionText.length);
  // The last spoken, non-negated "doğru cevap X" is the text's answer, even when "diğer şıklar" comes first.
  let textAnswer: OptionLetter | undefined;
  for (const sentence of sentences) for (const mention of findOptionMentions(sentence.text))
    if (mention.kind === 'answer' && !answerMentionNegated(sentence.text, mention)) textAnswer = mention.letters[0];

  // Last sentence of each option's own explanation: where an unjudged option is crossed.
  const lastSentenceFor: Partial<Record<OptionLetter, number>> = {};
  const inferred = new Set<OptionLetter>();
  // Numbered statement being discussed, and those already called true or false.
  let activePremises: number[] = [];
  const premiseJudged = new Set<number>();
  // Each place on the question is underlined once, at its first reading; later mentions only talk about it.
  const underlined = new Set<string>();
  const passages = arabicMatches.filter(am => am.sourceStart !== undefined && am.passageEnd !== undefined)
    .map(am => ({ start: am.sourceStart!, end: am.passageEnd! }));
  const pendingWeak: Partial<Record<OptionLetter, { trigger: string; sentence: string; sourceStart: number; sourceEnd: number; sentenceStart: number; sentenceEnd: number }>> = {};
  for (const [sentenceIndex, sentenceSpan] of sentences.entries()) {
    const sentence = sentenceSpan.text;
    const eventStart = events.length;
    const attachOffsets = () => {
      for (const event of events.slice(eventStart)) {
        const localStart = sentence.toLocaleLowerCase('tr-TR').indexOf(event.semanticTriggerPhrase.toLocaleLowerCase('tr-TR'));
        event.sourceStart ??= sentenceSpan.start + Math.max(0, localStart);
        event.sourceEnd ??= Math.min(sentenceSpan.end, event.sourceStart + event.semanticTriggerPhrase.length);
        event.sentenceStart = sentenceSpan.start;
        event.sentenceEnd = sentenceSpan.end;
        event.sourceText = solutionText;
      }
    };
    // A passage read in full: each printed line is underlined as its words are read.
    for (const am of arabicMatches) {
      if (am.sourceStart === undefined || am.sourceStart < sentenceSpan.start || am.sourceStart >= sentenceSpan.end) continue;
      if (!validRegionIds.has(am.region.id) || underlined.has(am.region.id)) continue;
      underlined.add(am.region.id);
      events.push({
        id: `event-${counter.value++}`, targetRegionId: am.region.id, actionType: 'underline',
        semanticTriggerPhrase: am.phrase, sentenceText: sentence,
        sourceStart: am.sourceStart, sourceEnd: am.sourceEnd ?? am.sourceStart + am.phrase.length,
        order: events.length + 1,
      });
    }
    // Choose the longest phrase at EACH spoken occurrence. A later single-word
    // explanation must not also light up inside the earlier full sentence.
    const candidates = arabicMatches.flatMap(am => {
      if (!validRegionIds.has(am.region.id) || am.sourceStart !== undefined) return [];
      const cx = am.region.x + am.region.width / 2, cy = am.region.y + am.region.height / 2;
      if (availableRegions.some(r => r.type.startsWith('option') && cx >= r.x && cx <= r.x+r.width && cy >= r.y && cy <= r.y+r.height)) return [];
      const escaped = am.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return Array.from(sentence.matchAll(new RegExp(escaped, 'g'))).flatMap(m => {
        const start = m.index!, end = start + m[0].length;
        if (/[\u0621-\u065F]/.test(sentence[start-1] || '') || /[\u0621-\u065F]/.test(sentence[end] || '')) return [];
        // Inside a passage being read, its lines are underlined already.
        if (passages.some(p => sentenceSpan.start + start >= p.start && sentenceSpan.start + start < p.end)) return [];
        return [{ am, start, end }];
      });
    });
    for (const {am, start, end} of candidates.filter(c => !candidates.some(other =>
      other.start <= c.start && other.end >= c.end && other.end-other.start > c.end-c.start))) {
        if (underlined.has(am.region.id)) continue;
        underlined.add(am.region.id);
        events.push({
          id: `event-${counter.value++}`,
          targetRegionId: am.region.id,
          actionType: 'underline',
          semanticTriggerPhrase: am.phrase,
          sentenceText: sentence,
          sourceStart: sentenceSpan.start + start,
          sourceEnd: sentenceSpan.start + end,
          order: events.length + 1,
        });
    }

    const mentions = findOptionMentions(sentence);
    const at = (local: number, text: string) => ({ sourceStart: sentenceSpan.start + local, sourceEnd: sentenceSpan.start + local + text.length });

    // Numbered statements (I, II, III): framed while they are discussed, then ticked or crossed
    // when called true or false. Their truth is never turned around, whatever the question asks.
    const premiseMentions = findPremiseMentions(sentence).filter(m => !mentions.some(o => o.start < m.end && m.start < o.end));
    const pushPremise = (n: number, actionType: 'focus' | 'tick' | 'cross', trigger: string, local: number) => events.push({
      id: `event-${counter.value++}`, targetRegionId: `premise-${n}`, actionType, semanticTriggerPhrase: trigger,
      sentenceText: sentence, order: events.length + 1, ...at(local, trigger) });
    const judgePremises = (numbers: number[], segment: string, offset: number) => {
      const truth = premiseTruth(segment);
      if (truth) for (const n of numbers) if (!premiseJudged.has(n)) { premiseJudged.add(n); pushPremise(n, truth.mark, truth.text, offset + truth.index); }
    };
    const firstOption = mentions[0]?.start ?? sentence.length;
    premiseMentions.forEach((mention, index) => {
      const numbers = mention.numbers.filter(n => validRegionIds.has(`premise-${n}`) && !premiseJudged.has(n));
      for (const n of numbers) if (!activePremises.includes(n)) pushPremise(n, 'focus', mention.text, mention.start);
      if (numbers.length) activePremises = numbers;
      const tailEnd = Math.min(premiseMentions[index + 1]?.start ?? sentence.length, ...mentions.filter(o => o.start >= mention.end).map(o => o.start));
      judgePremises(numbers, sentence.slice(mention.end, tailEnd), mention.end);
    });
    // "Bu ifade yanlış olduğundan …": a later sentence judges the statement being discussed.
    if (!premiseMentions.length && activePremises.length) judgePremises(activePremises, sentence.slice(0, firstOption), 0);
    // A sentence about a statement does not judge the option named before it; naming an option ends the statement.
    if (premiseMentions.length) activeLetters = [];
    if (mentions.length) activePremises = [];
    const hasRegion = (letter: OptionLetter) => validRegionIds.has(`option-${letter.toLowerCase()}`);
    const judge = (letter: OptionLetter, stance: 'rejected' | 'correct', trigger: string, local: number, weak = false) => {
      if (!hasRegion(letter) || optionStances[letter] !== 'neutral') return;
      if (weak) {
        pendingWeak[letter] ??= { trigger, sentence, ...at(local, trigger), sentenceStart: sentenceSpan.start, sentenceEnd: sentenceSpan.end };
        return;
      }
      // The spoken answer is never crossed out; a known answer blocks praise of another option.
      if (stance === 'rejected' && (letter === textAnswer || (!textAnswer && letter === declared))) return;
      if (stance === 'correct' && textAnswer && letter !== textAnswer) return;
      optionStances[letter] = stance;
      if (stance === 'correct') deducedCorrectAnswer = letter;
      pushOptionEvent(events, counter, letter, stance === 'correct' ? 'correct' : 'reject', trigger, sentence, at(local, trigger));
    };
    const currentAnswer = () => textAnswer
      || LETTERS.find(letter => optionStances[letter] === 'correct')
      || (declared && optionStances[declared] !== 'rejected' ? declared : undefined);

    mentions.forEach((mention, index) => {
      const tailEnd = mentions[index + 1]?.start ?? sentence.length;
      const tail = sentence.slice(mention.end, tailEnd);
      const headStart = index ? mentions[index - 1].end : 0;
      if (mention.kind === 'answer') {
        const letter = mention.letters[0];
        activeLetters = [letter];
        if (answerMentionNegated(sentence, mention)) { judge(letter, 'rejected', mention.text, mention.start); return; }
        if (!hasRegion(letter)) return;
        // Repeating the answer re-lights the marked option; the check itself is drawn once.
        if (optionStances[letter] === 'correct') { pushOptionEvent(events, counter, letter, 'focus', mention.text, sentence, at(mention.start, mention.text)); return; }
        pushOptionEvent(events, counter, letter, 'focus', mention.text, sentence, at(mention.start, mention.text));
        judge(letter, 'correct', mention.text, mention.start);
        return;
      }
      const tailStance = stanceIn(tail, true, forFalse);
      const headStance = !tailStance && index === 0 ? stanceIn(sentence.slice(headStart, mention.start), true, forFalse) : null;
      const stance = tailStance
        ? { ...tailStance, local: mention.end + tailStance.index }
        : headStance ? { ...headStance, local: headStart + headStance.index } : null;
      if (mention.kind === 'others') {
        activeLetters = [];
        const answer = currentAnswer();
        if (!stance || stance.stance !== 'rejected' || !answer) return;
        for (const letter of LETTERS) if (letter !== answer) judge(letter, 'rejected', stance.text, stance.local, 'weak' in stance);
        return;
      }
      // A missing visual target must not leave the previous option active.
      activeLetters = mention.letters;
      for (const letter of mention.letters) if (hasRegion(letter) && optionStances[letter] === 'neutral') {
        pushOptionEvent(events, counter, letter, 'focus', mention.text, sentence, at(mention.start, mention.text));
      }
      if (stance) for (const letter of mention.letters) judge(letter, stance.stance, stance.text, stance.local, 'weak' in stance);
    });

    // "A seçeneğine bakalım. Bu yapı burada kullanılamaz, eliyoruz." judges the option named before.
    if (!mentions.length && activeLetters.length) {
      const stance = stanceIn(sentence, false, forFalse);
      if (stance) for (const letter of activeLetters) judge(letter, stance.stance, stance.text, stance.index, 'weak' in stance);
    }
    for (const letter of activeLetters) lastSentenceFor[letter] = sentenceIndex;
    for (const mention of mentions) if (mention.kind === 'option') for (const letter of mention.letters) lastSentenceFor[letter] = sentenceIndex;
    attachOffsets();
  }

  // Descriptive verdicts count where the explanation gave no explicit one; never on the known answer.
  const knownAnswer = textAnswer || deducedCorrectAnswer || (declared && optionStances[declared] !== 'rejected' ? declared : undefined);
  for (const letter of LETTERS) {
    const pending = pendingWeak[letter];
    if (!pending || letter === knownAnswer || optionStances[letter] !== 'neutral') continue;
    optionStances[letter] = 'rejected';
    const { trigger, sentence, ...offsets } = pending;
    pushOptionEvent(events, counter, letter, 'reject', trigger, sentence, offsets);
    Object.assign(events[events.length - 1], { sourceText: solutionText });
  }

  // Declared/eliminated answer still gets its check when the script never says "doğru cevap".
  const finalAnswer = deducedCorrectAnswer
    || (declared && optionStances[declared] !== 'rejected' ? declared : undefined)
    || (() => {
      const open = LETTERS.filter(letter => validRegionIds.has(`option-${letter.toLowerCase()}`) && optionStances[letter] === 'neutral');
      return open.length === 1 && LETTERS.some(letter => optionStances[letter] === 'rejected') ? open[0] : undefined;
    })();
  if (finalAnswer && !LETTERS.some(letter => optionStances[letter] === 'correct') && validRegionIds.has(`option-${finalAnswer.toLowerCase()}`)) {
    let anchor: { sentence: typeof sentences[number]; mention?: OptionMention } | undefined;
    for (const sentence of sentences) {
      const mention = findOptionMentions(sentence.text).filter(m => m.letters.includes(finalAnswer)).pop();
      if (mention) anchor = { sentence, mention };
    }
    anchor ??= sentences.length ? { sentence: sentences[sentences.length - 1] } : undefined;
    if (anchor) {
      // Without a spoken mention, the check lands on the closing word rather than over the last explanation.
      const local = anchor.mention?.start ?? anchor.sentence.text.search(/\S+$/);
      const trigger = anchor.mention?.text || anchor.sentence.text.slice(local);
      const offsets = { sourceStart: anchor.sentence.start + local, sourceEnd: anchor.sentence.start + local + trigger.length,
        sentenceStart: anchor.sentence.start, sentenceEnd: anchor.sentence.end, sourceText: solutionText };
      optionStances[finalAnswer] = 'correct';
      pushOptionEvent(events, counter, finalAnswer, 'focus', trigger, anchor.sentence.text, offsets);
      pushOptionEvent(events, counter, finalAnswer, 'correct', trigger, anchor.sentence.text, offsets);
    }
  }

  // An option that was discussed but never judged is not the answer, so it is eliminated
  // however the teacher phrased it ("ilgisi yoktur", "buraya oturmaz" …): the cross lands
  // on the last word of that option's explanation.
  const answer = LETTERS.find(letter => optionStances[letter] === 'correct');
  if (answer) for (const letter of LETTERS) {
    const index = lastSentenceFor[letter];
    if (letter === answer || index === undefined || optionStances[letter] !== 'neutral' || !validRegionIds.has(`option-${letter.toLowerCase()}`)) continue;
    const span = sentences[index];
    const local = span.text.search(/\S+$/);
    const trigger = span.text.slice(local);
    optionStances[letter] = 'rejected';
    inferred.add(letter);
    pushOptionEvent(events, counter, letter, 'reject', trigger, span.text, { sourceStart: span.start + local, sourceEnd: span.start + local + trigger.length });
    Object.assign(events[events.length - 1], { sentenceStart: span.start, sentenceEnd: span.end, sourceText: solutionText });
  }

  // "Hangisi yanlıştır?": an eliminated option is a true statement, so it gets a green ✓ instead of a red
  // ✗; the answer is the false statement, so it gets a red ✗ beside its "doğru cevap" mark. With numbered
  // statements the options only list them ("I ve II"), so they keep their usual marks.
  if (forFalse && !events.some(event => event.targetRegionId.startsWith('premise-'))) {
    for (const event of events) if (event.targetOptionLetter && event.actionType === 'reject') event.actionType = 'tick';
    const answerMark = events.find(event => event.targetOptionLetter && event.actionType === 'correct');
    if (answerMark) events.push({ ...answerMark, id: `event-${counter.value++}`, actionType: 'cross', order: events.length + 1 });
  }

  // Root introduction was emitted before the sentence loop.
  for (const event of events) if (event.sourceStart === undefined) {
    event.sourceStart = solutionText.indexOf(event.semanticTriggerPhrase);
    event.sourceEnd = event.sourceStart + event.semanticTriggerPhrase.length;
    event.sentenceStart = 0;
    event.sentenceEnd = sentences[0]?.end ?? 0;
    event.sourceText = solutionText;
  }

  // Deduplicate accidental identical events while preserving order.
  const unique = events.filter((event, index, arr) => {
    const firstIndex = arr.findIndex(
      (other) =>
        other.targetRegionId === event.targetRegionId &&
        other.actionType === event.actionType &&
        other.sourceStart === event.sourceStart &&
        other.semanticTriggerPhrase === event.semanticTriggerPhrase
    );
    return firstIndex === index;
  });
  const repeats = refocused(unique);
  const deduped = unique.filter(event => !repeats.has(event));

  const verdicts: SolutionParseResult['verdicts'] = {};
  for (const event of deduped) {
    const letter = event.targetOptionLetter;
    if (!letter || verdicts[letter] || !['reject', 'correct', 'tick'].includes(event.actionType)) continue;
    verdicts[letter] = { stance: event.actionType === 'correct' ? 'correct' : 'rejected', trigger: event.semanticTriggerPhrase, inferred: inferred.has(letter) };
  }

  return {
    events: deduped.map((event, index) => ({ ...event, order: index + 1 })),
    deducedCorrectAnswer,
    optionStances,
    verdicts,
  };
}
