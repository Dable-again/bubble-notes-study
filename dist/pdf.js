/* Self-contained offline A4 PDF export. Each page is rendered as a JPEG to
   preserve Chinese text, pictures and handwriting without network fonts. */
(() => {
  const W = 1240, H = 1754, M = 100, RIGHT = W - M, BOTTOM = H - M;
  const encoder = new TextEncoder();
  const bytes = value => typeof value === 'string' ? encoder.encode(value) : value;
  const join = arrays => {
    const output = new Uint8Array(arrays.reduce((size, item) => size + item.length, 0));
    let offset = 0;
    arrays.forEach(item => { output.set(item, offset); offset += item.length; });
    return output;
  };

  async function exportPdf(title, sections, getFile) {
    const pages = [];
    let canvas, context, y;
    const newPage = async () => {
      if (canvas) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .84));
        pages.push(new Uint8Array(await blob.arrayBuffer()));
      }
      canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff'; context.fillRect(0, 0, W, H);
      context.fillStyle = '#9baacf'; context.font = '22px sans-serif';
      context.fillText('泡泡笔记', M, 58);
      y = 118;
    };
    const space = async height => { if (y + height > BOTTOM) await newPage(); };
    const paragraph = async (text, size = 30, color = '#33415e', gap = 12) => {
      context.font = `${size}px sans-serif`;
      const lineHeight = Math.round(size * 1.65);
      for (const rawLine of String(text || '').split('\n')) {
        let line = '';
        for (const char of [...rawLine]) {
          context.font = `${size}px sans-serif`;
          if (line && context.measureText(line + char).width > RIGHT - M) {
            await space(lineHeight);
            context.fillStyle = color; context.font = `${size}px sans-serif`;
            context.fillText(line, M, y); y += lineHeight;
            line = '';
          }
          line += char;
        }
        await space(lineHeight);
        context.fillStyle = color; context.font = `${size}px sans-serif`;
        context.fillText(line, M, y); y += lineHeight;
      }
      y += gap;
    };
    const picture = async fileId => {
      const blob = await getFile(fileId);
      if (!blob) return paragraph('（图片缺失）', 25, '#a36d78');
      let bitmap;
      try { bitmap = await createImageBitmap(blob); }
      catch { return paragraph('（图片无法读取）', 25, '#a36d78'); }
      const width = Math.min(RIGHT - M, bitmap.width * 2);
      const height = Math.min(1050, width * bitmap.height / bitmap.width);
      await space(height + 28);
      context.drawImage(bitmap, M, y, width, height);
      bitmap.close?.();
      y += height + 28;
    };
    const questionPage = async block => {
      const blob = await window.BubblePdfAnnotation.buildAnnotated(block, getFile);
      pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs.worker.min.js';
      const task = pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
      try {
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const unit = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min((RIGHT - M) / unit.width, 1300 / unit.height) });
        const rendered = document.createElement('canvas');
        rendered.width = Math.ceil(viewport.width); rendered.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: rendered.getContext('2d'), viewport }).promise;
        await space(rendered.height + 28);
        context.drawImage(rendered, M, y);
        y += rendered.height + 28;
      } finally { await task.destroy(); }
    };
    const handwriting = async strokes => {
      const width = RIGHT - M, height = Math.round(width * .625);
      await space(height + 28);
      context.fillStyle = '#fff';
      context.fillRect(M, y, width, height);
      const colors = { black: '#263351', red: '#dc5766', blue: '#4275cf' };
      const pencilColors = { black: '#687185', red: '#e4929c', blue: '#8da9e0' };
      for (const stroke of strokes || []) {
        context.strokeStyle = stroke.brush === 'pencil' ? (pencilColors[stroke.color] || pencilColors.black) : (colors[stroke.color] || colors.black);
        context.globalAlpha = stroke.brush === 'marker' ? .34 : 1;
        context.lineCap = 'round'; context.lineJoin = 'round';
        const points = stroke.points || [];
        for (let index = 0; index < points.length; index++) {
          const first = points[Math.max(0, index - 1)], second = points[index];
          const pressure = (first.p + second.p) / 2;
          const size = Math.max(1, Math.min(24, Number(stroke.size) || 8));
          const sensitivity = Math.max(0, Math.min(100, Number(stroke.sensitivity ?? 65))) / 100;
          context.lineWidth = size * Math.max(.2, 1 + (pressure - .5) * 2 * sensitivity)
            * (stroke.brush === 'marker' ? 1.8 : stroke.brush === 'pencil' ? .72 : 1) * width / 1000;
          context.beginPath();
          context.moveTo(M + first.x * width, y + first.y * height);
          context.lineTo(M + (second.x + (index ? 0 : .0001)) * width, y + second.y * height);
          context.stroke();
        }
        context.globalAlpha = 1;
      }
      y += height + 28;
    };

    await newPage();
    await paragraph(title || '未命名记录', 48, '#263451', 35);
    for (const section of sections) {
      if (section.title) {
        await space(75);
        await paragraph(section.title, 36, '#566caf', 16);
      }
      for (const block of section.blocks || []) {
        if (block.type === 'text') await paragraph(block.text, 29);
        else if (block.type === 'ink') await handwriting(block.strokes);
        else if (block.type === 'question') await questionPage(block);
        else if (block.fileId) await picture(block.fileId);
      }
      y += 25;
    }
    await newPage(); // Finalizes the last content page and creates a disposable canvas.
    if (!pages.length) throw new Error('没有可导出的内容');

    const objects = [];
    const add = value => { objects.push(bytes(value)); return objects.length; };
    const catalog = add('');
    const pageTree = add('');
    const pageIds = [];
    for (const jpeg of pages) {
      const image = add(join([bytes(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, bytes('\nendstream')]));
      const command = bytes('q 595 0 0 842 0 0 cm /Im0 Do Q');
      const content = add(join([bytes(`<< /Length ${command.length} >>\nstream\n`), command, bytes('\nendstream')]));
      pageIds.push(add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objects[catalog - 1] = bytes(`<< /Type /Catalog /Pages ${pageTree} 0 R >>`);
    objects[pageTree - 1] = bytes(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    const parts = [bytes('%PDF-1.4\n')];
    const offsets = [0];
    let length = parts[0].length;
    objects.forEach((object, index) => {
      offsets.push(length);
      const item = join([bytes(`${index + 1} 0 obj\n`), object, bytes('\nendobj\n')]);
      parts.push(item); length += item.length;
    });
    const xref = length;
    const table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    parts.push(bytes(table));
    const pdf = new Blob(parts, { type: 'application/pdf' });
    const filename = `${String(title || '泡泡笔记').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.pdf`;
    if (window.BubbleNative && window.BubbleSaveBlob) await window.BubbleSaveBlob(pdf, filename);
    else {
      const url = URL.createObjectURL(pdf);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return pages.length;
  }
  window.BubblePdf = { exportPdf };
})();
