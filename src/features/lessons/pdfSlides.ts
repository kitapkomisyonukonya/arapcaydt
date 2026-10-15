/// <reference types="vite/client" />
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { readCompressedImage } from '../../services/narration/browserMedia';
import { naturalOrder } from './lessonPlan';
import { textLines, textRuns, type SlideLine } from './slideMarks';

/** A slide picture made in the browser, before it is stored; a PDF page also brings its text lines. */
export interface SlidePicture { url: string; width: number; height: number; name: string; lines?: SlideLine[] }

/** Slides are drawn this wide (the video is 1920 wide); very tall pages stay within MAX_SIDE. */
const SLIDE_WIDTH = 1920;
const MAX_SIDE = 2400;
export const MAX_SLIDES = 80;

export const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
export const isPowerPoint = (file: File) => /\.(pptx?|ppsx?|key|odp)$/i.test(file.name);

// The PDF reader (about 2 MB) loads only when a teacher adds slides.
const loadPdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs');

async function openPdf(file: File) {
  const pdfjs = await loadPdfjs();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (error) {
    if ((error as Error)?.name === 'PasswordException') throw new Error(`“${file.name}” parolalı. Parolasız olarak yeniden kaydedip yükleyin.`);
    throw new Error(`“${file.name}” açılamadı. Dosyayı PowerPoint’te yeniden PDF olarak kaydedip deneyin.`);
  }
}

async function canvasBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.92));
  const png = blob && blob.type === 'image/webp' ? blob : await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('Slayt resmi oluşturulamadı.');
  return URL.createObjectURL(png);
}

/** One page of a PDF as a picture; pages are counted from 1. */
async function renderPage(pdf: Awaited<ReturnType<typeof openPdf>>, number: number, name: string): Promise<SlidePicture> {
  const page = await pdf.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(SLIDE_WIDTH / base.width, MAX_SIDE / base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Slayt çizilemedi.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  // Where each line of text is, for the marks; a page without a text layer (a scanned picture) has none.
  let lines: SlideLine[] | undefined;
  try {
    const { Util } = await loadPdfjs();
    const content = await page.getTextContent();
    lines = textLines(textRuns(content.items as Array<{ str?: string; transform?: number[]; width?: number }>,
      t => Util.transform(viewport.transform, t), scale, canvas.width, canvas.height), canvas.height / canvas.width);
  } catch {
    lines = undefined;
  }
  page.cleanup();
  return { url: await canvasBlobUrl(canvas), width: canvas.width, height: canvas.height, name: `${name} · sayfa ${number}`, ...(lines?.length ? { lines } : {}) };
}

async function readPicture(file: File): Promise<SlidePicture> {
  const url = await readCompressedImage(file);
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`“${file.name}” resmi açılamadı.`));
    img.src = url;
  });
  return { url, ...size, name: file.name };
}

/**
 * Slide pictures from the chosen files, in order: each PDF page by page, pictures by the number
 * in their names ("Slayt2" before "Slayt10"). `onProgress` gets how many are ready.
 */
export async function readSlides(files: File[], onProgress: (done: number, total: number) => void): Promise<SlidePicture[]> {
  const ordered = naturalOrder(files);
  const pdfs = new Map<File, Awaited<ReturnType<typeof openPdf>>>();
  let total = 0;
  for (const file of ordered) {
    if (isPdf(file)) { const pdf = await openPdf(file); pdfs.set(file, pdf); total += pdf.numPages; } else total++;
  }
  if (total > MAX_SLIDES) throw new Error(`En fazla ${MAX_SLIDES} slayt eklenebilir; seçtikleriniz ${total} slayt.`);
  const out: SlidePicture[] = [];
  onProgress(0, total);
  for (const file of ordered) {
    const pdf = pdfs.get(file);
    if (pdf) {
      for (let n = 1; n <= pdf.numPages; n++) { out.push(await renderPage(pdf, n, file.name)); onProgress(out.length, total); }
      await pdf.destroy();
    } else {
      out.push(await readPicture(file));
      onProgress(out.length, total);
    }
  }
  return out;
}

/**
 * A new picture for one slide: a picture file, or the same page number of a PDF (the whole
 * presentation saved again after a fix); a one-page PDF gives its only page.
 */
export async function readReplacement(file: File, slideNumber: number): Promise<SlidePicture> {
  if (!isPdf(file)) return readPicture(file);
  const pdf = await openPdf(file);
  try {
    if (pdf.numPages > 1 && pdf.numPages < slideNumber) throw new Error(`Bu PDF’te ${slideNumber}. sayfa yok. Sunumun tamamını ya da yalnız bu slaytı PDF olarak seçin.`);
    return await renderPage(pdf, pdf.numPages === 1 ? 1 : slideNumber, file.name);
  } finally {
    await pdf.destroy();
  }
}
