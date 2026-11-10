import { ArrowCounterClockwise, ArrowsClockwise } from '@phosphor-icons/react';
import type { SentenceRow } from './slideRevoice';

/**
 * "Yalnız bir cümle hatalı": each sentence of the slide's voice can be voiced again on its own; the
 * rest of the voice and the teacher's marks stay (marks after it move with the voice).
 */
export function SlideSentenceFix({ rows, disabled, onFix, onUndo }: {
  rows: SentenceRow[];
  disabled?: boolean;
  onFix: (index: number) => void;
  /** Takes back the last sentence fix on this slide. */
  onUndo?: () => void;
}) {
  const changed = rows.some(r => r.changed);
  return (
    <details className="rounded-md border border-[#E5E4DC] bg-white" open={changed || !!onUndo}>
      <summary className="cursor-pointer select-none px-2.5 py-1.5 text-sm font-semibold text-[#1C1917]">
        Yalnız bir cümle mi hatalı?
      </summary>
      <div className="px-2.5 pb-2.5 space-y-2">
        <p className="text-xs text-[#55544F]">
          Hatalı cümlenin yanındaki düğmeye basın. Yalnız o cümle yeniden okunup sesteki yerine konur; sesin geri kalanı ve işaretleriniz korunur. 1 ses hakkı kullanır.
          {changed && ' Metinde değiştirdiğiniz cümle yeni hâliyle okunur.'}
        </p>
        {onUndo && (
          <button type="button" onClick={onUndo} disabled={disabled} className="flex items-center gap-1.5 text-sm text-[#55544F] hover:text-[#8B1E2D] disabled:opacity-50">
            <ArrowCounterClockwise size={14} /> Olmadı, geri al
          </button>
        )}
        <ol className="space-y-1.5">
          {rows.map((row, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="w-5 shrink-0 text-right tabular-nums text-[#787670]">{i + 1}.</span>
              <span dir="auto" className="flex-1 min-w-0 leading-snug text-[#33322E]">
                {row.now}
                {row.changed && <span className="ml-1.5 rounded bg-amber-100 px-1 text-xs font-semibold text-[#7C4A03]">değişti</span>}
              </span>
              <button type="button" onClick={() => onFix(i)} disabled={disabled}
                className="shrink-0 flex items-center gap-1 rounded-md border border-[#D5D4CC] bg-white px-2 py-1 text-xs font-semibold text-[#33322E] hover:border-[#8B1E2D] hover:text-[#8B1E2D] disabled:opacity-50"
                title="Yalnız bu cümle yeniden seslendirilir">
                <ArrowsClockwise size={13} /> Yeniden oku
              </button>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
