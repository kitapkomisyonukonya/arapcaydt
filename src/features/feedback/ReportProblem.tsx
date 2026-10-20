import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CheckCircle, ImageSquare, Lifebuoy, WarningCircle, X } from '@phosphor-icons/react';
import { canCaptureScreen, captureScreen, collectContext, currentSnapshot, MAX_SCREENSHOTS, REPORT_REASONS, screenshotFromFile, sendFeedback,
  type FeedbackContext, type SendResult } from './feedback';

/**
 * "Sorun bildir": one click opens a short form; the page, the open question and
 * the latest error messages are attached automatically.
 */
export function ReportProblem({ variant = 'link', sender }: { variant?: 'link' | 'compact' | 'button'; sender?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [context, setContext] = useState<FeedbackContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  /** The form is hidden while the screen's picture is taken. */
  const [capturing, setCapturing] = useState(false);
  const [pictureNote, setPictureNote] = useState('');
  const addPictures = async (files: Blob[]) => {
    setPictureNote('');
    const room = MAX_SCREENSHOTS - screenshots.length;
    if (room <= 0) return setPictureNote(`En çok ${MAX_SCREENSHOTS} görüntü eklenebilir.`);
    const added: string[] = [];
    for (const file of files.filter(f => f.type.startsWith('image/')).slice(0, room)) {
      try { added.push(await screenshotFromFile(file)); } catch { setPictureNote('Bu resim açılamadı.'); }
    }
    setScreenshots(list => [...list, ...added].slice(0, MAX_SCREENSHOTS));
  };
  const takePicture = async () => {
    setPictureNote(''); setCapturing(true);
    const picture = await captureScreen().catch(() => null);
    setCapturing(false);
    if (picture) setScreenshots(list => [...list, picture].slice(0, MAX_SCREENSHOTS));
  };

  const start = () => { setContext(collectContext()); setResult(null); setOpen(true); };
  const close = () => { setOpen(false); if (result?.sent) { setMessage(''); setReason(''); setScreenshots([]); setPictureNote(''); } };
  // In a question the teacher first picks what went wrong; elsewhere they write it.
  const inQuestion = !!context?.projectId;
  useEffect(() => { if (open && !inQuestion) field.current?.focus(); }, [open, inQuestion]);
  // The box grows downwards with the text (the form scrolls once it fills the screen).
  useEffect(() => {
    const box = field.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + 2}px`;
  }, [message, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!context) return;
    setBusy(true);
    const diagnostics = inQuestion ? currentSnapshot() : undefined;
    setResult(await sendFeedback(message, { ...context, reason: reason || undefined }, sender, diagnostics, screenshots));
    setBusy(false);
  };

  const trigger = variant === 'compact'
    ? 'flex items-center gap-1.5 text-xs font-semibold text-[#55544F] hover:text-[#8B1E2D] px-2.5 py-1.5 rounded hover:bg-[#F7EEEE] transition-colors'
    : variant === 'button'
      ? 'studio-secondary inline-flex items-center gap-1.5'
      : 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#55544F] hover:bg-[#F0EFEA] hover:text-[#8B1E2D] transition-colors';

  return (
    <>
      <button type="button" className={trigger} onClick={start}>
        <Lifebuoy size={variant === 'link' ? 18 : 16} /> Sorun bildir
      </button>
      {/* Rendered on <body>: inside the editor's header it would sit under the video's play button. */}
      {open && context && createPortal(
        <div className={`fixed inset-0 z-[100] bg-black/30 flex items-center justify-center p-4 ${capturing ? 'invisible' : ''}`} onClick={close}>
          <form role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submit} onClick={e => e.stopPropagation()}
            onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); void addPictures(files); } }}
            className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto bg-white rounded-xl border border-[#E5E4DC] shadow-xl p-5 space-y-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="report-title" className="text-base font-bold text-[#1C1917]">Sorun bildir</h2>
                <p className="text-xs text-[#787670] mt-0.5">Bildiriminiz stüdyo yöneticisine iletilir.</p>
              </div>
              <button type="button" onClick={close} className="p-1 rounded hover:bg-[#F0EFEA] text-[#787670]" aria-label="Kapat"><X size={16} /></button>
            </div>
            {result?.sent ? (
              <div className="space-y-4">
                <p role="status" className="flex items-center gap-2 text-sm text-[#1E562A]"><CheckCircle size={18} weight="fill" /> Teşekkürler, bildiriminiz iletildi.</p>
                <button type="button" className="studio-primary w-full" onClick={close}>Tamam</button>
              </div>
            ) : (
              <>
                {inQuestion && (
                  <fieldset>
                    <legend className="text-sm font-medium text-[#33322E] mb-2">Ne oldu? Birini seçin.</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {REPORT_REASONS.map(r => (
                        <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(reason === r ? '' : r)}
                          className={`rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${reason === r
                            ? 'border-[#8B1E2D] bg-[#F7EEEE] text-[#8B1E2D]' : 'border-[#D5D4CC] text-[#33322E] hover:bg-[#FAF9F5]'}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
                <label className="block text-sm font-medium text-[#33322E]">
                  {inQuestion ? 'İsterseniz kısaca yazın' : 'Ne oldu?'} <span className="font-normal text-[#787670]">(isteğe bağlı)</span>
                  <textarea ref={field} value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={inQuestion ? 2 : 4}
                    placeholder={inQuestion ? 'Örnek: 3. satırın altını çizmedi.' : 'Örnek: Ses üret düğmesine bastım, uzun süre bekledi ve hata verdi.'}
                    className="mt-1.5 block w-full rounded-lg border border-[#D5D4CC] p-3 text-sm outline-none focus:border-[#8B1E2D] resize-none overflow-hidden" />
                </label>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[#33322E]">Ekran görüntüsü <span className="font-normal text-[#787670]">(isteğe bağlı, en çok {MAX_SCREENSHOTS})</span></p>
                  {screenshots.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {screenshots.map((src, i) => (
                        <li key={i} className="relative">
                          <img src={src} alt={`Ekran görüntüsü ${i + 1}`} className="h-20 rounded-md border border-[#D5D4CC] object-cover" />
                          <button type="button" aria-label="Görüntüyü kaldır" title="Kaldır" onClick={() => setScreenshots(list => list.filter((_, j) => j !== i))}
                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#1C1917] text-white flex items-center justify-center"><X size={11} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {screenshots.length < MAX_SCREENSHOTS && (
                    <div className="flex flex-wrap items-center gap-2">
                      {canCaptureScreen() && (
                        <button type="button" className="studio-secondary inline-flex items-center gap-1.5" onClick={() => void takePicture()}
                          title="Tarayıcı hangi sekmenin paylaşılacağını sorar: bu sekmeyi seçin. Yalnız bir kare alınır, paylaşım hemen kapanır.">
                          <Camera size={16} /> Ekranın görüntüsünü al
                        </button>
                      )}
                      <button type="button" className="studio-secondary inline-flex items-center gap-1.5" onClick={() => picker.current?.click()}>
                        <ImageSquare size={16} /> Resim ekle
                      </button>
                      <input ref={picker} type="file" accept="image/*" multiple hidden
                        onChange={e => { void addPictures(Array.from(e.target.files || [])); e.target.value = ''; }} />
                      <span className="text-xs text-[#787670]">ya da kopyaladığınız görüntüyü buraya yapıştırın (Ctrl+V)</span>
                    </div>
                  )}
                  {pictureNote && <p className="text-xs text-[#8B1E2D]">{pictureNote}</p>}
                </div>
                <div className="rounded-lg bg-[#FAF9F5] border border-[#E5E4DC] p-3 text-xs text-[#55544F] space-y-1">
                  <p className="font-semibold text-[#33322E]">Otomatik eklenecek bilgiler</p>
                  {context.page && <p>Sayfa: {context.page}</p>}
                  {context.projectTitle && <p>Soru: {context.projectTitle}{context.step ? ` · ${context.step} adımı` : ''}</p>}
                  {inQuestion && <p>Sorunun işaretleri, zamanlaması ve görselde okunan yazı (dosya indirmeniz gerekmez)</p>}
                  <p>{context.shownErrors.length ? `Ekrandaki uyarı: ${context.shownErrors[0]}` : 'Ekranda uyarı yok'}{context.recentErrors.length ? ` · son ${context.recentErrors.length} hata kaydı` : ''}</p>
                  <p>Tarayıcı ve ekran boyutu</p>
                </div>
                {result && !result.sent && (
                  <p role="alert" className="flex items-start gap-2 text-sm text-[#8B1E2D]">
                    <WarningCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
                    <span>{result.reason} <a href={result.mailto} className="underline font-semibold">E-postayla gönderin</a>; bilgiler hazır olarak açılır.</span>
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" className="studio-secondary" onClick={close}>Vazgeç</button>
                  <button className="studio-primary" disabled={busy || (inQuestion && !reason && !message.trim())}
                    title={inQuestion && !reason && !message.trim() ? 'Önce ne olduğunu seçin' : undefined}>{busy ? 'Gönderiliyor…' : 'Gönder'}</button>
                </div>
              </>
            )}
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
