import type { MarkerPen } from '../../types';
import { PEN_COLORS, penOf } from '../video/engine/renderer';

const KINDS: Array<[MarkerPen['kind'], string]> = [['highlight', 'Fosforlu kalem'], ['underline', 'Alt çizgi']];
const SIZES: Array<[MarkerPen['size'], string]> = [['thin', 'İnce'], ['medium', 'Orta'], ['thick', 'Kalın']];
const CHIP = 'px-2.5 py-1 rounded-md border text-sm disabled:opacity-50';
const chip = (on: boolean) => `${CHIP} ${on ? 'border-[#8B1E2D] bg-[#F8EEEE] text-[#8B1E2D] font-semibold' : 'border-[#E5E4DC] bg-white text-[#33322E] hover:border-[#8B1E2D]/50'}`;

/** "Vurgu kalemi": how the spoken line is marked in this whole lesson (preview, editor and MP4). */
export function PenPicker({ pen, disabled, onChange }: { pen?: MarkerPen; disabled?: boolean; onChange: (pen: MarkerPen) => void }) {
  const p = penOf(pen);
  const set = (part: Partial<MarkerPen>) => onChange({ ...p, ...part });
  const color = PEN_COLORS[p.color];
  const band = { thin: '45%', medium: '70%', thick: '96%' }[p.size], line = { thin: 3, medium: 5, thick: 8 }[p.size];
  return (
    <div className="rounded-lg border border-[#E5E4DC] bg-white p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#1C1917]">Vurgu kalemi</p>
        {/* A sample word marked as the video will mark it. */}
        <span className="relative inline-block px-1 text-[15px] text-[#1C1917]" aria-hidden="true">
          <span className="absolute left-0 right-0 bottom-0 rounded" style={p.kind === 'highlight'
            ? { height: band, background: color.fill, mixBlendMode: 'multiply' }
            : { height: line, bottom: -line - 1, background: color.line }} />
          <span className="relative">Örnek satır</span>
        </span>
      </div>
      <p className="text-xs text-[#787670]">Bütün slaytlarda anlatılan yer böyle işaretlenir.</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kalem">
        {KINDS.map(([kind, label]) => <button key={kind} type="button" disabled={disabled} onClick={() => set({ kind })} className={chip(p.kind === kind)} aria-pressed={p.kind === kind}>{label}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Renk">
        {(Object.keys(PEN_COLORS) as Array<MarkerPen['color']>).map(c => (
          <button key={c} type="button" disabled={disabled} onClick={() => set({ color: c })} aria-pressed={p.color === c} title={PEN_COLORS[c].label}
            className={`w-7 h-7 rounded-full border-2 disabled:opacity-50 ${p.color === c ? 'border-[#1C1917]' : 'border-white ring-1 ring-[#E5E4DC]'}`}
            style={{ background: p.kind === 'highlight' ? PEN_COLORS[c].fill : PEN_COLORS[c].line }}>
            <span className="sr-only">{PEN_COLORS[c].label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kalınlık">
        {SIZES.map(([size, label]) => <button key={size} type="button" disabled={disabled} onClick={() => set({ size })} className={chip(p.size === size)} aria-pressed={p.size === size}>{label}</button>)}
      </div>
    </div>
  );
}
