import { useState } from 'react';
import { FileXls } from '@phosphor-icons/react';
import { saveFile } from '../../services/narration/browserMedia';
import { clock } from '../lessons/lessonPlan';
import type { LessonStat } from '../../../server/lessonStats';
import { SectionTitle, card, dateTime } from './adminShared';

const status = (l: LessonStat) => !l.slides ? 'Slayt yok' : l.voiced < l.slides ? `Ses ${l.voiced}/${l.slides}` : 'Video hazır';

/** Every teacher's Konu Anlatımları next to their questions: by teacher, how far, as an Excel list too. */
export function LessonsSection({ lessons, who }: { lessons: LessonStat[] | null | undefined; who: (id: string) => string }) {
  const [owner, setOwner] = useState('');
  if (lessons === undefined) return null;
  const owners = [...new Set((lessons || []).map(l => l.ownerId))].sort((a, b) => who(a).localeCompare(who(b), 'tr'));
  const rows = (lessons || []).filter(l => !owner || l.ownerId === owner);
  const ready = rows.filter(l => l.slides && l.voiced === l.slides).length;
  const minutes = Math.round(rows.reduce((s, l) => s + l.duration, 0) / 60);
  const download = () => {
    const cell = (v: string) => /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = rows.map(l => [who(l.ownerId), l.title, String(l.slides), `${l.voiced}/${l.slides}`, clock(l.duration), status(l), new Date(l.updatedAt).toLocaleDateString('tr')].map(cell).join(';'));
    saveFile(new Blob(['﻿' + [['Öğretmen', 'Konu', 'Slayt', 'Sesli slayt', 'Süre', 'Durum', 'Son değişiklik'].join(';'), ...lines].join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }), 'konu-anlatimlari.csv');
  };
  return (
    <section className={card}>
      <SectionTitle title="Konu anlatımları" note="Bütün öğretmenlerin konu anlatımları, son değişiklik en üstte. Çöp kutusundakiler sayılmaz."
        action={<button type="button" className="studio-secondary !min-h-0 !py-2" disabled={!rows.length} onClick={download}><FileXls size={16} /> Excel olarak indir</button>} />
      {lessons === null ? <p className="text-sm text-[#8B1E2D]">Konu anlatımları okunamadı.</p> : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
            <select aria-label="Öğretmen" value={owner} onChange={e => setOwner(e.target.value)} className="border rounded-lg px-2 py-2 text-sm bg-white">
              <option value="">Bütün öğretmenler</option>
              {owners.map(id => <option key={id} value={id}>{who(id)} ({lessons.filter(l => l.ownerId === id).length})</option>)}
            </select>
            <span className="text-[#55544F]"><strong>{rows.length}</strong> konu anlatımı · <strong>{ready}</strong> video hazır · toplam <strong>{minutes}</strong> dakika ses</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-[#666560]">
                <tr>{['Konu', 'Öğretmen', 'Slayt', 'Süre', 'Durum', 'Son değişiklik'].map(t => <th key={t} className="px-2 py-2 font-semibold whitespace-nowrap">{t}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[#EFEFEA]">
                {rows.map(l => (
                  <tr key={l.id}>
                    <td className="px-2 py-2 font-semibold">{l.title}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{who(l.ownerId)}</td>
                    <td className="px-2 py-2 tabular-nums">{l.slides}</td>
                    <td className="px-2 py-2 tabular-nums">{clock(l.duration)}</td>
                    <td className={`px-2 py-2 whitespace-nowrap ${l.slides && l.voiced === l.slides ? 'text-[#166534] font-semibold' : ''}`}>{status(l)}</td>
                    <td className="px-2 py-2 text-xs text-[#787670] whitespace-nowrap">{dateTime(l.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="text-sm text-[#787670] py-3">Henüz konu anlatımı yok.</p>}
          </div>
        </>
      )}
    </section>
  );
}
