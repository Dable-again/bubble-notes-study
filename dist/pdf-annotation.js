/* Add local pen strokes to the original PDF pages without flattening the text. */
(() => {
  const colors = {
    black: [0.15, 0.20, 0.32],
    red: [0.86, 0.34, 0.40],
    blue: [0.26, 0.46, 0.81]
  };
  const pencilColors = {
    black: [0.41, 0.44, 0.52],
    red: [0.89, 0.57, 0.61],
    blue: [0.55, 0.66, 0.88]
  };

  async function buildAnnotated(block, getFile) {
    if (!window.PDFLib || !window.pdfjsLib) throw new Error('PDF 工具不可用');
    const source = block.type === 'question' ? await window.BubbleQuestionBank.cropPdf(block, getFile) : await getFile(block.fileId);
    if (!source) throw new Error('PDF 文件缺失');
    const bytes = await source.arrayBuffer();
    const output = await PDFLib.PDFDocument.load(bytes.slice(0));
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs.worker.min.js';
    const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)), useSystemFonts: true });
    try {
      const reader = await task.promise;
      const pages = output.getPages();
      for (const [key, annotation] of Object.entries(block.annotations || {})) {
        const number = Number(key);
        if (!Number.isInteger(number) || number < 1 || number > pages.length) continue;
        const sourcePage = await reader.getPage(number);
        const viewport = sourcePage.getViewport({ scale: 1 });
        const page = pages[number - 1];
        for (const stroke of annotation?.strokes || []) {
          const points = stroke.points || [];
          if (!points.length) continue;
          const palette = stroke.brush === 'pencil' ? pencilColors : colors;
          const color = PDFLib.rgb(...(palette[stroke.color] || palette.black));
          const opacity = stroke.brush === 'marker' ? .35 : 1;
          const size = Math.max(1, Math.min(24, Number(stroke.size) || 8));
          const sensitivity = Math.max(0, Math.min(100, Number(stroke.sensitivity ?? 65))) / 100;
          const width = pressure => size * Math.max(.2, 1 + ((pressure || .5) - .5) * 2 * sensitivity)
            * (stroke.brush === 'marker' ? 1.8 : stroke.brush === 'pencil' ? .72 : 1) * viewport.width / 1000;
          const position = point => {
            const [x, y] = viewport.convertToPdfPoint(point.x * viewport.width, point.y * viewport.height);
            return { x, y };
          };
          if (points.length === 1) {
            const at = position(points[0]);
            page.drawCircle({ ...at, size: width(points[0].p) / 2, color, opacity });
          } else {
            for (let index = 1; index < points.length; index++) {
              page.drawLine({ start: position(points[index - 1]), end: position(points[index]), thickness: width((points[index - 1].p + points[index].p) / 2), color, opacity });
            }
          }
        }
      }
      return new Blob([await output.save()], { type: 'application/pdf' });
    } finally { await task.destroy(); }
  }

  async function exportAnnotated(block, getFile) {
      const result = await buildAnnotated(block, getFile);
      const filename = `${String(block.fileName || '习题').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 55)}-批注.pdf`;
      if (window.BubbleNative && window.BubbleSaveBlob) await window.BubbleSaveBlob(result, filename);
      else {
        const url = URL.createObjectURL(result);
        const link = document.createElement('a');
        link.href = url; link.download = filename;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      return result;
  }

  window.BubblePdfAnnotation = { exportAnnotated, buildAnnotated };
})();
