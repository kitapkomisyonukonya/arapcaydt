import { createWorker, Worker, PSM } from 'tesseract.js';
import { prepareForReading } from './prepareImage';
import { groupOcrWordsIntoLines } from './arabicMatcher';
import { OCRWord, OCRLine, OCRResult, OCRProgress } from './ocrTypes';
import { emptyOptionCrops, missingMarkerCrops } from './markerRecovery';
import { detectYdtQuestionRegions } from './ydtQuestionDetector';
import { readWithVision } from './cloudOcr';
import { OWN_ARABIC, STOCK_ARABIC, arabicConfidence, preferStockArabic } from './modelChoice';

const OCR_MODEL_PATH = '/tessdata';
const OCR_MODEL_CACHE = 'tessdata-2026-10-02';

class LocalOcrService {
  private static instance: LocalOcrService;
  private worker: Worker | null = null;
  /** Stock Arabic model, read alongside ours (see modelChoice); null if it could not load. */
  private stockWorker?: Promise<Worker | null>;
  private isInitializing = false;

  public static getInstance(): LocalOcrService {
    if (!LocalOcrService.instance) {
      LocalOcrService.instance = new LocalOcrService();
    }
    return LocalOcrService.instance;
  }

  /**
   * Initializes or returns the cached Tesseract worker configured for Arabic,
   * Turkish, and English. The worker is reused between questions so the large
   * language models are not downloaded/initialized on every video.
   */
  /** Current caller's progress sink; the worker logger outlives any single call (e.g. a background warm-up). */
  private progressListener?: (progress: OCRProgress) => void;

  /**
   * Starts downloading/initialising the OCR models in the background so the
   * teacher's first "İşaretleri hazırla" does not wait for them. Safe to call often.
   */
  public warmUp(): void {
    void this.getWorker().catch(() => { /* the real scan reports errors */ });
    void this.getStockWorker();
  }

  private async getWorker(onProgress?: (progress: OCRProgress) => void): Promise<Worker> {
    if (onProgress) this.progressListener = onProgress;
    if (this.worker) {
      return this.worker;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.worker) return this.worker;
    }

    this.isInitializing = true;
    try {
      onProgress?.({
        status: 'initializing',
        progress: 10,
        message: 'Yerel OCR motoru başlatılıyor (Arapça + Türkçe)...',
      });

      const worker = await createWorker([OWN_ARABIC, 'tur', 'eng'], 1, {
        // Our own Arabic model (trained on teachers' question pictures) is served with the site;
        // Turkish and English are the stock ones. A new cache name keeps browsers from reusing
        // the stock Arabic model they cached before.
        langPath: OCR_MODEL_PATH,
        cachePath: OCR_MODEL_CACHE,
        logger: (m) => {
          const onProgress = this.progressListener;
          if (m.status === 'loading tesseract core' || m.status === 'initializing tesseract') {
            onProgress?.({
              status: 'loading_model',
              progress: 20 + Math.round((m.progress || 0) * 20),
              message: 'Tesseract OCR motoru hazırlanıyor...',
            });
          } else if (m.status === 'loading language traineddata') {
            onProgress?.({
              status: 'loading_model',
              progress: 40 + Math.round((m.progress || 0) * 30),
              message: 'Dil modelleri yükleniyor (ara+tur+eng)...',
            });
          } else if (m.status === 'recognizing text') {
            onProgress?.({
              status: 'recognizing',
              progress: 70 + Math.round((m.progress || 0) * 28),
              message: `Soru metni taranıyor (%${Math.round((m.progress || 0) * 100)})...`,
            });
          }
        },
      });

      this.worker = worker;
      return worker;
    } finally {
      this.isInitializing = false;
    }
  }

  private getStockWorker(): Promise<Worker | null> {
    // Same files and cache as ours; the stock Arabic model is served as "araeski". Loading quietly:
    // progress messages come from our own worker.
    this.stockWorker ??= createWorker([STOCK_ARABIC, 'tur', 'eng'], 1, { langPath: OCR_MODEL_PATH, cachePath: OCR_MODEL_CACHE })
      .catch(() => null);
    return this.stockWorker;
  }

  private async getImageDimensions(imageUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        resolve({
          width: img.naturalWidth || img.width || 1000,
          height: img.naturalHeight || img.height || 1000,
        });
      };
      img.onerror = () => resolve({ width: 1000, height: 1000 });
      img.src = imageUrl;
    });
  }

  private toOcrWord(rawWord: any, imgWidth: number, imgHeight: number, scale = 1): OCRWord | null {
    const text = String(rawWord?.text || '').trim();
    if (!text) return null;

    const bbox = unscale(rawWord?.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 }, scale);
    const px = Math.max(0, Number(bbox.x0) || 0);
    const py = Math.max(0, Number(bbox.y0) || 0);
    const pw = Math.max(1, (Number(bbox.x1) || px + 1) - px);
    const ph = Math.max(1, (Number(bbox.y1) || py + 1) - py);

    return {
      text,
      confidence: Number(rawWord?.confidence ?? 80),
      x: Math.max(0, Math.min(1, px / imgWidth)),
      y: Math.max(0, Math.min(1, py / imgHeight)),
      width: Math.max(0.0001, Math.min(1, pw / imgWidth)),
      height: Math.max(0.0001, Math.min(1, ph / imgHeight)),
      pixelX: px,
      pixelY: py,
      pixelWidth: pw,
      pixelHeight: ph,
    };
  }

  private toOcrLine(rawLine: any, imgWidth: number, imgHeight: number, scale = 1): OCRLine | null {
    const text = String(rawLine?.text || '').trim();
    const rawWords = Array.isArray(rawLine?.words) ? rawLine.words : [];
    const lineWords = rawWords
      .map((w: any) => this.toOcrWord(w, imgWidth, imgHeight, scale))
      .filter(Boolean) as OCRWord[];

    if (!text && lineWords.length === 0) return null;

    const bbox = rawLine?.bbox ? unscale(rawLine.bbox, scale) : (() => {
      if (lineWords.length === 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
      return {
        x0: Math.min(...lineWords.map((w) => w.pixelX)),
        y0: Math.min(...lineWords.map((w) => w.pixelY)),
        x1: Math.max(...lineWords.map((w) => w.pixelX + w.pixelWidth)),
        y1: Math.max(...lineWords.map((w) => w.pixelY + w.pixelHeight)),
      };
    })();

    const px = Math.max(0, Number(bbox.x0) || 0);
    const py = Math.max(0, Number(bbox.y0) || 0);
    const pw = Math.max(1, (Number(bbox.x1) || px + 1) - px);
    const ph = Math.max(1, (Number(bbox.y1) || py + 1) - py);

    return {
      text: text || lineWords.map((w) => w.text).join(' '),
      confidence: Number(rawLine?.confidence ?? 80),
      x: Math.max(0, Math.min(1, px / imgWidth)),
      y: Math.max(0, Math.min(1, py / imgHeight)),
      width: Math.max(0.0001, Math.min(1, pw / imgWidth)),
      height: Math.max(0.0001, Math.min(1, ph / imgHeight)),
      words: lineWords,
    };
  }

  /**
   * Tesseract.js v6+ disables granular output by default. Requesting
   * `{ blocks: true }` is essential: otherwise only `data.text` is returned
   * and the video pipeline has no word coordinates, which means no A-E regions
   * and therefore no animation targets.
   */
  public async recognize(
    imageUrl: string,
    onProgress?: (progress: OCRProgress) => void,
    /** Google Vision's earlier reading of this question, used again if the picture is the same. */
    saved?: OCRResult['visionReading'],
  ): Promise<OCRResult> {
    if (!imageUrl) {
      throw new Error('Geçerli bir soru görseli bulunamadı.');
    }

    // Google Vision (on the server) reads printed Arabic best; the in-browser reader is the fallback.
    const cloud = await readWithVision(imageUrl, onProgress, saved);
    if ('result' in cloud) return cloud.result;

    const { width: imgWidth, height: imgHeight } = await this.getImageDimensions(imageUrl);

    onProgress?.({
      status: 'initializing',
      progress: 5,
      message: 'Görsel boyutları doğrulandı, OCR başlatılıyor...',
    });

    const [ownWorker, stockWorker] = await Promise.all([this.getWorker(onProgress), this.getStockWorker()]);

    onProgress?.({
      status: 'recognizing',
      progress: 70,
      message: 'Soru ve şıklar taranıyor...',
    });

    // Read a cleaned, enlarged copy (see prepareImage); boxes are scaled back below.
    const prepared = await prepareForReading(imageUrl, imgWidth, imgHeight);
    const scale = prepared?.scale ?? 1;
    // Tesseract v6/v7: text is on by default, blocks must be explicitly enabled.
    const image = prepared?.image ?? imageUrl;
    const [ownResult, stockResult] = await Promise.all([
      ownWorker.recognize(image, {}, { text: true, blocks: true }),
      stockWorker?.recognize(image, {}, { text: true, blocks: true }).catch(() => null),
    ]);
    // Keep whichever Arabic model read this picture more confidently; the follow-up passes use it too.
    const useStock = !!stockWorker && !!stockResult && preferStockArabic(arabicConfidence(ownResult.data), arabicConfidence(stockResult.data));
    const worker = useStock ? stockWorker : ownWorker;
    const arabic = useStock ? STOCK_ARABIC : OWN_ARABIC;
    const result = useStock ? stockResult : ownResult;
    const data = result.data as any;

    const words: OCRWord[] = [];
    const lines: OCRLine[] = [];

    // Preferred v6/v7 structure: blocks -> paragraphs -> lines -> words.
    if (Array.isArray(data.blocks)) {
      for (const block of data.blocks) {
        for (const paragraph of block?.paragraphs || []) {
          for (const rawLine of paragraph?.lines || []) {
            const line = this.toOcrLine(rawLine, imgWidth, imgHeight, scale);
            if (!line) continue;
            lines.push(line);
            words.push(...line.words);
          }
        }
      }
    }

    // Backward-compatible fallback for older Tesseract output shapes.
    if (words.length === 0 && Array.isArray(data.words)) {
      for (const rawWord of data.words) {
        const word = this.toOcrWord(rawWord, imgWidth, imgHeight, scale);
        if (word) words.push(word);
      }
    }

    if (lines.length === 0 && Array.isArray(data.lines)) {
      for (const rawLine of data.lines) {
        const line = this.toOcrLine(rawLine, imgWidth, imgHeight, scale);
        if (line) lines.push(line);
      }
    }

    // Stable visual ordering improves deterministic option/phrase detection.
    lines.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const orderedWords = groupOcrWordsIntoLines(words).flat();
    words.splice(0, words.length, ...orderedWords);

    if (words.length === 0) {
      throw new Error(
        'Soru görselindeki metin bölgeleri algılanamadı. Daha net veya daha yüksek çözünürlüklü bir görsel deneyin.'
      );
    }

    onProgress?.({
      status: 'completed',
      progress: 100,
      message: `${words.length} metin parçası ve ${lines.length} satır tespit edildi.`,
    });

    const output: OCRResult = {
      engine: 'tesseract',
      cloudIssue: cloud.issue,
      text: data.text || lines.map((l) => l.text).join('\n'),
      imageWidth: imgWidth,
      imageHeight: imgHeight,
      words,
      lines,
    };
    {
      // Latin labels and Arabic text need different recognition contexts.
      // Always cross-check labels: five detections can still contain a bad box.
      onProgress?.({ status: 'recognizing', progress: 98, message: 'Şık harfleri ayrı bir taramayla kontrol ediliyor...' });
      try {
        await worker.reinitialize('eng');
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const labels = await worker.recognize(imageUrl, {}, { text: true, blocks: true });
        const markers: OCRWord[] = [];
        for (const block of labels.data.blocks || []) for (const paragraph of block.paragraphs || [])
          for (const line of paragraph.lines || []) for (const raw of line.words || []) {
            const word = this.toOcrWord(raw, imgWidth, imgHeight);
            if (word && word.confidence >= 55 && /^[([]?[A-E][)\].:]$/.test(word.text.trim())) markers.push(word);
          }
        for(const crop of missingMarkerCrops(markers,imgWidth,imgHeight)){
          await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
          const retry=await worker.recognize(imageUrl,{rectangle:crop.rectangle},{text:true,blocks:true});
          for(const block of retry.data.blocks||[]) for(const paragraph of block.paragraphs||[])
            for(const line of paragraph.lines||[]) for(const raw of line.words||[]){
              const word=this.toOcrWord(raw,imgWidth,imgHeight);
              if(word&&word.confidence>=65&&new RegExp(`^${crop.letter}[)\\].:]$`).test(word.text.trim()))markers.push(word);
            }
        }
        output.optionMarkers = markers;
        // Turkish/English models sometimes read Arabic words as Latin gibberish.
        // Re-read just the stem in Arabic, keeping the option geometry unchanged.
        const root = detectYdtQuestionRegions(output).questionPromptRegion;
        if (root) {
          await worker.reinitialize(arabic);
          const stemLines = groupOcrWordsIntoLines(output.words.filter(w =>
            w.x+w.width/2 >= root.x && w.x+w.width/2 <= root.x+root.width &&
            w.y+w.height/2 >= root.y && w.y+w.height/2 <= root.y+root.height));
          await worker.setParameters({tessedit_pageseg_mode: stemLines.length === 1 ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK});
          const left = Math.max(0, Math.floor(root.x * imgWidth)-10);
          const top = Math.max(0, Math.floor(root.y * imgHeight)-8);
          const rectangle = {left, top,
            width: Math.min(imgWidth-left, Math.ceil(root.width*imgWidth)+20),
            height: Math.min(imgHeight-top, Math.ceil(root.height*imgHeight)+16)};
          const retry = await worker.recognize(imageUrl, {rectangle}, {text:true, blocks:true});
          const stemWords: OCRWord[] = [];
          for (const block of retry.data.blocks || []) for (const paragraph of block.paragraphs || [])
            for (const line of paragraph.lines || []) for (const raw of line.words || []) {
              const word = this.toOcrWord(raw,imgWidth,imgHeight);
              if (word && word.confidence >= 45 && /[\u0621-\u064A]/.test(word.text)) stemWords.push(word);
            }
          output.arabicStemWords = stemWords;
        }
        // A short option the page reading skipped is read again beside its label, by itself.
        const crops = emptyOptionCrops(detectYdtQuestionRegions(output).regions, imgWidth, imgHeight);
        if (crops.length) {
          if (!root) await worker.reinitialize(arabic);
          for (const crop of crops) {
            // Read as one line; when that gives up on a strip of mostly white paper, as sparse text.
            for (const mode of [PSM.SINGLE_LINE, PSM.SPARSE_TEXT]) {
              await worker.setParameters({ tessedit_pageseg_mode: mode });
              const retry = await worker.recognize(imageUrl, { rectangle: crop.rectangle }, { text: true, blocks: true });
              const found: OCRWord[] = [];
              for (const block of retry.data.blocks || []) for (const paragraph of block.paragraphs || [])
                for (const line of paragraph.lines || []) for (const raw of line.words || []) {
                  const word = this.toOcrWord(raw, imgWidth, imgHeight);
                  // Only the option is in the strip, so a low-confidence reading still marks where its text is.
                  if (word && word.confidence >= 40 && /[\u0621-\u064A]/.test(word.text)) found.push(word);
                }
              output.words.push(...found);
              if (found.length) break;
            }
          }
          output.words.splice(0, output.words.length, ...groupOcrWordsIntoLines(output.words).flat());
        }
      } finally {
        await worker.reinitialize(`${arabic}+tur+eng`);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      }
    }
    return output;
  }

  public async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    const stock = await this.stockWorker;
    this.stockWorker = undefined;
    await stock?.terminate();
  }
}

function unscale(bbox: any, scale: number) {
  if (scale === 1) return bbox;
  return { x0: bbox.x0 / scale, y0: bbox.y0 / scale, x1: bbox.x1 / scale, y1: bbox.y1 / scale };
}

export const localOcrService = LocalOcrService.getInstance();
