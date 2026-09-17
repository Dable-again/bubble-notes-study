/* Offline question boundary detection and lossless PDF cropping. */
(() => {
  let cachedSource = null;
  let ocrWorker = null;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  async function openPdf(file) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs.worker.min.js';
    const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
    return { task, document: await task.promise };
  }

  function whitespaceGaps(canvas) {
    const { width, height } = canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const gaps = [];
    let begin = -1;
    for (let y = 0; y <= height; y++) {
      let dark = 0;
      if (y < height) for (let x = Math.floor(width * .06); x < width * .95; x += 4) {
        const at = (y * width + x) * 4;
        if (pixels[at] + pixels[at + 1] + pixels[at + 2] < 540) dark++;
        if (dark > 2) break;
      }
      if (dark <= 2 && y < height) { if (begin < 0) begin = y; }
      else if (begin >= 0) {
        if (y - begin >= 4) gaps.push({ y: (begin + y) / (2 * height), length: (y - begin) / height });
        begin = -1;
      }
    }
    return gaps;
  }

  function snapToGap(y, gaps) {
    const nearby = gaps.filter(gap => Math.abs(gap.y - y) < .025 && gap.length < .05).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y));
    return nearby[0]?.y ?? y;
  }

  async function recognizePage(page, onProgress = () => {}) {
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1700 / unit.height, 1500 / unit.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const text = await page.getTextContent();
    const textMarkers = [];
    for (const item of text.items || []) {
      const match = /^\s*(\d{1,3})[.．、:：]\s*/.exec(item.str || '');
      if (!match) continue;
      const x = item.transform[4] / unit.width;
      const y = 1 - item.transform[5] / unit.height;
      if (x < .35 && y > .06 && y < .94) textMarkers.push({ number: Number(match[1]), y: clamp(y - .012, 0, 1), source: 'text' });
    }
    const gaps = whitespaceGaps(canvas);
    if (textMarkers.length >= 2) return { markers: textMarkers.map(marker => ({ ...marker, y: snapToGap(marker.y, gaps) })), gaps, width: canvas.width, height: canvas.height, method: 'text' };
    if (!window.Tesseract) throw new Error('离线识别组件缺失');
    const worker = ocrWorker ||= await Tesseract.createWorker('eng', 1, {
      workerPath: './vendor/ocr/worker.min.js',
      corePath: './vendor/ocr/core/',
      langPath: './vendor/ocr/',
      gzip: false,
      logger: event => { if (event.status === 'recognizing text') onProgress(event.progress); }
    });
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
      const result = await worker.recognize(canvas, {}, { blocks: true });
      const lines = (result.data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []));
      const markers = [];
      for (const line of lines) {
        const match = /^\s*(\d{1,3})[.．、:：]/.exec(line.text || '');
        const box = line.bbox;
        if (!match || !box || box.x0 > canvas.width * .29 || box.y0 < canvas.height * .055 || box.y0 > canvas.height * .94) continue;
        markers.push({ number: Number(match[1]), y: clamp((box.y0 - 8) / canvas.height, 0, 1), source: 'ocr' });
      }
      markers.sort((a, b) => a.y - b.y);
      return { markers: markers.filter((marker, index) => !index || marker.y - markers[index - 1].y > .014).map(marker => ({ ...marker, y: snapToGap(marker.y, gaps) })), gaps, width: canvas.width, height: canvas.height, method: 'ocr' };
  }

  async function stopOcr() {
    const worker = ocrWorker;
    ocrWorker = null;
    if (worker) await worker.terminate();
  }

  function repairSequence(pages) {
    let expected = null;
    for (const page of pages) {
      for (const marker of page.markers) {
        if (expected !== null && marker.number === 1 && expected > 1) {
          marker.number = expected;
          marker.inferred = true;
        }
        expected = marker.number + 1;
      }
      for (let index = page.markers.length - 2; index >= 0; index--) {
        const first = page.markers[index], next = page.markers[index + 1];
        const gap = next.number - first.number;
        if (gap < 2 || gap > 3 || next.y - first.y < gap * .022) continue;
        for (let missing = gap - 1; missing >= 1; missing--) {
          page.markers.splice(index + 1, 0, { number: first.number + missing, y: snapToGap(first.y + (next.y - first.y) * missing / gap - .008, page.gaps || []), source: 'sequence', inferred: true });
        }
      }
    }
    return pages;
  }

  async function cropPdf(block, getFile) {
    if (!window.PDFLib) throw new Error('PDF 工具不可用');
    const source = await getFile(block.fileId);
    if (!source) throw new Error('题库文件缺失');
    if (!cachedSource || cachedSource.id !== block.fileId || cachedSource.size !== source.size) {
      cachedSource = { id: block.fileId, size: source.size, document: await PDFLib.PDFDocument.load(await source.arrayBuffer()) };
    }
    const page = cachedSource.document.getPage(Number(block.page) - 1);
    if (!page) throw new Error('题目页码无效');
    const width = page.getWidth(), height = page.getHeight();
    const crop = block.crop || { x0: .06, x1: .94, y0: 0, y1: 1 };
    const box = {
      left: clamp(crop.x0, 0, 1) * width,
      right: clamp(crop.x1, 0, 1) * width,
      bottom: (1 - clamp(crop.y1, 0, 1)) * height,
      top: (1 - clamp(crop.y0, 0, 1)) * height
    };
    if (box.right - box.left < 20 || box.top - box.bottom < 20) throw new Error('题目范围过小');
    const output = await PDFLib.PDFDocument.create();
    const embedded = await output.embedPage(page, box);
    const target = output.addPage([box.right - box.left, box.top - box.bottom]);
    target.drawPage(embedded, { x: 0, y: 0, width: box.right - box.left, height: box.top - box.bottom });
    return new Blob([await output.save()], { type: 'application/pdf' });
  }

  window.BubbleQuestionBank = { openPdf, recognizePage, repairSequence, cropPdf, stopOcr };
})();
