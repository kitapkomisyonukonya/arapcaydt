import { ArrowCounterClockwise, PencilSimple } from '@phosphor-icons/react';
import type { LessonSlide } from './lessonPlan';
import { markable, slideMarks, type DeckWords, type SlideBlock } from './slideMarks';

/** A part of the slide as a choice: its text (shortened), or "Arapça satır n". */
const partLabel = (b: SlideBlock, parts: SlideBlock[]) => {
  if (b.rtl) return `Arapça satır ${parts.filter(p => p.rtl).indexOf(b) + 1}`;
  const text = b.text.replace(/^[\s•●▪■◆✓✔--]+/, '');
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
};

const BOX = 'rounded-lg border border-[#E5E4DC] bg-white p-3 space-y-2';
const EDIT = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#8B1E2D]/40 bg-white text-sm font-semibold text-[#8B1E2D] hover:bg-[#F8EEEE] disabled:opacity-50 disabled:pointer-events-none';

/**
 * "Slayttaki işaretler": each sentence of the slide's text and the part of the slide it highlights
 * while it is spoken. The studio picks; the teacher can change a pick or take it away, or open
 * "İşaretleri düzenle" (the question editor's marks screen; then those are the slide's marks).
 */
export function SlideMarksPanel({ slide, deck, disabled, onFix, onHover, onEdit, onAuto }: {
  slide: LessonSlide;
  deck: DeckWords;
  disabled?: boolean;
  /** `part` -1: no mark; undefined: back to the studio's pick. */
  onFix: (sentence: string, part: number | undefined) => void;
  onHover: (block: SlideBlock | null) => void;
  /** Opens "İşaretleri düzenle" (needs the slide's voice). */
  onEdit: () => void;
  /** Drops the marks placed while listening: back to the studio's own. */
  onAuto: () => void;
}) {
  const edit = (
    <button type="button" onClick={onEdit} disabled={disabled || !slide.audio}
      title={slide.audio ? 'Sesi dinleyerek işaretlerin yerini ve zamanını düzeltin' : 'Önce slaytın sesini oluşturun'} className={EDIT}>
      <PencilSimple size={15} /> İşaretleri düzenle
    </button>
  );
  if (slide.scene) {
    return (
      <div className={BOX}>
        <p className="text-sm font-semibold text-[#1C1917]">Slayttaki işaretler</p>
        <p className="text-xs text-[#55544F]">Bu slaytın işaretlerini siz düzenlediniz ({slide.scene.actions.length} işaret). Videoda bunlar kullanılır.</p>
        <div className="flex flex-wrap items-center gap-2">
          {edit}
          <button type="button" onClick={onAuto} disabled={disabled} className="flex items-center gap-1.5 text-sm text-[#55544F] hover:text-[#8B1E2D] disabled:opacity-50"
            title="Elle yaptığınız değişiklikler silinir, stüdyonun kendi işaretleri gelir"><ArrowCounterClockwise size={14} /> Otomatik işaretlere dön</button>
        </div>
      </div>
    );
  }
  if (!slide.lines?.length) {
    return (
      <div className={BOX}>
        <p className="text-sm text-[#55544F]">
          Bu slaytın yazılarının yeri bilinmiyor (slayt resim olarak eklendi), bu yüzden kendiliğinden işaret konmaz.
          <strong> İşaretleri düzenle</strong> ile işaretlenecek yeri kendiniz çizebilir ya da <strong>Resmi değiştir</strong> ile sunumun PDF’ini seçebilirsiniz.
        </p>
        {edit}
      </div>
    );
  }
  const { blocks, marks } = slideMarks(slide.text, slide.lines, slide.markFixes, deck);
  const parts = markable(blocks);
  if (!marks.length) return slide.audio ? <div className={BOX}><p className="text-sm font-semibold text-[#1C1917]">Slayttaki işaretler</p>{edit}</div> : null;
  return (
    <div className={BOX}>
      <div>
        <p className="text-sm font-semibold text-[#1C1917]">Slayttaki işaretler</p>
        <p className="text-xs text-[#787670]">Her cümle okunurken slaytta boyanacak yer. Yanlışsa değiştirin; işaretsiz cümlede aynı paragraftaki önceki işaret sürer. Zamanı ya da yeri tutmuyorsa sesi dinleyerek düzenleyin.</p>
      </div>
      {edit}
      <ol className="space-y-2.5">
        {marks.map((m, i) => (
          <li key={`${i}-${m.sentence}`} className="space-y-1"
            onMouseEnter={() => onHover(parts[m.part] ?? null)} onMouseLeave={() => onHover(null)}>
            <p className="text-[13px] leading-snug text-[#33322E] line-clamp-2" dir="auto" title={m.sentence}>{i + 1}. {m.sentence}</p>
            <div className="flex items-center gap-1.5">
              <select
                value={m.part}
                disabled={disabled}
                onFocus={() => onHover(parts[m.part] ?? null)} onBlur={() => onHover(null)}
                onChange={e => onFix(m.sentence, Number(e.target.value))}
                aria-label={`${i + 1}. cümlenin işareti`}
                className={`flex-1 min-w-0 rounded-md border px-1.5 py-1 text-xs bg-white ${m.fixed ? 'border-[#8B1E2D]' : 'border-[#D5D4CC]'} ${m.part < 0 ? 'text-[#8C8A82]' : 'text-[#1C1917]'}`}>
                <option value={-1}>İşaret yok</option>
                {parts.map((b, k) => <option key={k} value={k}>{partLabel(b, parts)}</option>)}
              </select>
              {m.fixed && (
                <button type="button" onClick={() => onFix(m.sentence, undefined)} disabled={disabled} title="Otomatik seçime dön"
                  aria-label={`${i + 1}. cümle: otomatik seçime dön`} className="p-1 rounded text-[#787670] hover:text-[#8B1E2D]"><ArrowCounterClockwise size={14} /></button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
