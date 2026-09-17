const $ = id => document.getElementById(id);
if (!window.structuredClone) window.structuredClone = value => JSON.parse(JSON.stringify(value));
const levels = [
  { id: 'none', label: '无' },
  { id: 'red', label: '红' },
  { id: 'yellow', label: '黄' },
  { id: 'green', label: '绿' },
  { id: 'blue', label: '蓝' }
];
const sectionColors = [
  { id: 'blue', value: '#dce9ff', label: '浅蓝' },
  { id: 'peach', value: '#ffe8e1', label: '浅粉' },
  { id: 'mint', value: '#dff3eb', label: '浅绿' },
  { id: 'lilac', value: '#eae6fb', label: '浅紫' },
  { id: 'lemon', value: '#fbf1d4', label: '浅黄' }
];

let database;
let state = { sections: [] };
let sectionId = null;
let recordId = null;
let tipId = null;
let sectionColor = 'blue';
let sectionShape = 'square';
let editingSectionId = null;
let tipLevel = 'none';
let pendingSave = null;
let saving = false;
let messageTimer;
let revealed = null;
let pendingImport = null;
let attachmentUrls = [];
let attachmentRenderId = 0;
let drawingAttachmentId = null;
let drawingStrokes = [];
let activeStroke = null;
let drawingPointerId = null;
let tipDraft = null;
let tipDraftNewFiles = [];
let tipRenderUrls = [];
let tipRenderId = 0;
let pdfTasks = [];
let inkTool = 'black';
let inkBrush = 'pen';
let inkSize = 7;
let inkSensitivity = 65;
let dragState = null;
let suppressDragClickUntil = 0;
let suppressDragTarget = null;
let pendingDeletion = null;

const tileSelector = '.section[data-section], .record-card[data-record], .tip-tile[data-tip], .attachment-card[data-attachment]';

const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const currentSection = () => state.sections.find(item => item.id === sectionId);
const currentRecord = () => currentSection()?.records.find(item => item.id === recordId);
const currentTip = () => currentRecord()?.tips.find(item => item.id === tipId);

function setStatus(text, error = false) {
  $('save-status').textContent = text;
  $('save-status').classList.toggle('error', error);
}

function message(text) {
  $('message').textContent = text;
  $('message').hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { $('message').hidden = true; }, 3200);
}

function fitTextarea(element) {
  element.style.height = 'auto';
  element.style.height = `${Math.max(element === $('record-body') ? 74 : 48, element.scrollHeight)}px`;
}

async function saveBlobNative(blob, name) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  window.BubbleNative.saveFile(name, blob.type || 'application/octet-stream', String(dataUrl).split(',')[1]);
}
window.BubbleSaveBlob = saveBlobNative;

function showImageOverlay(url) {
  const overlay = document.createElement('div');
  overlay.className = 'image-overlay';
  overlay.innerHTML = `<button aria-label="关闭图片">×</button><img src="${url}" alt="图片预览">`;
  overlay.querySelector('button').onclick = () => overlay.remove();
  overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
  document.body.append(overlay);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bubble-notes', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('app')) request.result.createObjectStore('app');
      if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function fileTransaction(mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('files', mode);
    const request = action(transaction.objectStore('files'));
    let result;
    if (request) request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const putFile = (id, blob) => fileTransaction('readwrite', store => store.put(blob, id));
const getFile = id => fileTransaction('readonly', store => store.get(id));
const removeFile = id => fileTransaction('readwrite', store => store.delete(id));

function readState() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('app', 'readonly');
    const request = transaction.objectStore('app').get('state');
    request.onsuccess = () => resolve(request.result || { sections: [] });
    request.onerror = () => reject(request.error);
  });
}

function writeState(snapshot) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('app', 'readwrite');
    transaction.objectStore('app').put(snapshot, 'state');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function save() {
  pendingSave = structuredClone(state);
  setStatus('保存中…');
  if (!saving) drainSaves();
}

async function drainSaves() {
  saving = true;
  while (pendingSave) {
    const snapshot = pendingSave;
    pendingSave = null;
    try {
      await writeState(snapshot);
    } catch (error) {
      pendingSave = snapshot;
      setStatus('保存失败，请重试', true);
      saving = false;
      return;
    }
  }
  saving = false;
  setStatus('已保存');
}

function show(page) {
  hideReveal();
  if (page !== 'record') clearAttachmentUrls();
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === page));
  window.scrollTo(0, 0);
}

function clearAttachmentUrls() {
  attachmentUrls.forEach(url => URL.revokeObjectURL(url));
  attachmentUrls = [];
}

function clearTipUrls() {
  tipRenderUrls.forEach(url => URL.revokeObjectURL(url));
  tipRenderUrls = [];
}

function hideReveal() {
  revealed = null;
  $('reveal').hidden = true;
  document.querySelectorAll('.record-card[aria-expanded="true"], .tip-tile[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function revealItem(kind, id, element, title, body, open) {
  if (revealed?.kind === kind && revealed.id === id) {
    hideReveal();
    open();
    return;
  }
  revealed = { kind, id };
  $('reveal-title').textContent = title || (kind === 'tip' ? '未命名 tip' : '未命名记录');
  $('reveal-body').textContent = body || '暂无内容';
  const bubble = $('reveal');
  bubble.hidden = false;
  const box = element.getBoundingClientRect();
  const bubbleWidth = Math.min(260, window.innerWidth - 28);
  const left = Math.min(window.innerWidth - bubbleWidth - 14, Math.max(14, box.left + box.width / 2 - bubbleWidth / 2));
  bubble.style.width = `${bubbleWidth}px`;
  bubble.style.left = `${left}px`;
  bubble.style.top = `${Math.min(window.innerHeight - bubble.offsetHeight - 14, box.bottom + 10)}px`;
  if (box.bottom + bubble.offsetHeight + 14 > window.innerHeight && box.top > bubble.offsetHeight + 14) {
    bubble.style.top = `${box.top - bubble.offsetHeight - 10}px`;
  }
}

function dot(level) {
  return level === 'none' ? '' : `<span class="level-dot ${level}" aria-hidden="true"></span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderSections() {
  $('sections').innerHTML = state.sections.length ? state.sections.map(section => `
    <button class="section ${section.color} ${section.shape === 'round' ? 'round' : ''}" data-section="${section.id}">
      <strong>${escapeHtml(section.name)}</strong><span>${section.records.length} 条记录</span>
    </button>`).join('') : '<div class="empty">还没有分区</div>';
  $('sections').querySelectorAll('[data-section]').forEach(button => {
    button.addEventListener('click', () => openSection(button.dataset.section));
  });
}

function openSection(id) {
  sectionId = id;
  renderRecords();
  show('zone');
}

function renderRecords() {
  hideReveal();
  const section = currentSection();
  if (!section) return show('home');
  $('zone-title').textContent = section.name;
  $('records').innerHTML = section.records.length ? section.records.map(record => `
    <button class="record-card level-${record.level || 'none'}" data-record="${record.id}" aria-label="打开记录：${escapeHtml(record.title || '未命名记录')}">
      <span class="record-name">${escapeHtml(record.title || '未命名记录')}</span>
    </button>`).join('') : '<div class="empty">还没有记录</div>';
  $('records').querySelectorAll('[data-record]').forEach(button => {
    button.addEventListener('click', () => openRecord(button.dataset.record));
    button.addEventListener('contextmenu', event => { event.preventDefault(); openRecordColor(button.dataset.record); });
  });
}

function openRecordColor(id) {
  const record = currentSection()?.records.find(item => item.id === id);
  if (!record) return;
  renderLevels('record-color-picks', record.level || 'none', level => {
    record.level = level;
    record.updatedAt = Date.now();
    save();
    $('record-color-modal').hidden = true;
    renderRecords();
  });
  $('record-color-modal').hidden = false;
}

function addRecord() {
  const section = currentSection();
  if (!section) return;
  const record = { id: uid(), title: '', body: '', level: 'none', tips: [], updatedAt: Date.now() };
  section.records.push(record);
  save();
  renderRecords();
  openRecord(record.id);
  $('record-title').focus();
}

function openRecord(id) {
  recordId = id;
  const record = currentRecord();
  if (!record) return;
  $('record-zone-name').textContent = currentSection().name;
  $('record-title').value = record.title;
  $('record-body').value = record.body;
  fitTextarea($('record-body'));
  document.querySelector('.attachment-dock').open = false;
  renderTips();
  show('record');
  renderAttachments();
}

function renderLevels(containerId, selected, onSelect) {
  const container = $(containerId);
  container.innerHTML = levels.map(level => `
    <button class="level-pick ${level.id === selected ? 'selected' : ''}" data-level="${level.id}" aria-label="${level.id === 'none' ? '不标记' : level.label}" title="${level.id === 'none' ? '不标记' : level.label}" aria-pressed="${level.id === selected}">
      ${dot(level.id) || '<span class="none-dot" aria-hidden="true"></span>'}
    </button>`).join('');
  container.querySelectorAll('[data-level]').forEach(button => {
    button.addEventListener('click', () => onSelect(button.dataset.level));
  });
}

function renderTips() {
  hideReveal();
  const tips = currentRecord()?.tips || [];
  $('tip-count').textContent = tips.length ? `(${tips.length})` : '';
  $('tips').innerHTML = tips.length ? tips.map((tip, index) => `
    <button class="tip-tile level-${tip.level || 'none'}" data-tip="${tip.id}" aria-label="第 ${index + 1} 个 tip：${escapeHtml(tip.title || '未命名')}" aria-haspopup="true" aria-expanded="false"></button>`).join('') : '<div class="tip-empty">还没有 tip</div>';
  $('tips').querySelectorAll('[data-tip]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const tip = tips.find(item => item.id === button.dataset.tip);
      if (!tip) return;
      const wasRevealed = revealed?.kind === 'tip' && revealed.id === tip.id;
      const preview = (tip.blocks || []).find(block => block.type === 'text' && block.text?.trim())?.text || tip.body || ((tip.blocks || []).length ? '图片 / 手写' : '暂无内容');
      revealItem('tip', tip.id, button, tip.title, preview, () => openTip(tip.id));
      $('tips').querySelectorAll('[data-tip]').forEach(tile => tile.setAttribute('aria-expanded', String(!wasRevealed && tile === button)));
    });
  });
}

function dragCollection(kind) {
  if (kind === 'section') return { items: state.sections, render: renderSections };
  if (kind === 'record') return { items: currentSection()?.records, render: renderRecords };
  if (kind === 'tip') return { items: currentRecord()?.tips, render: renderTips };
  return { items: currentRecord()?.attachments, render: renderAttachments };
}

function tileKind(tile) {
  if (tile.dataset.section) return { kind: 'section', id: tile.dataset.section, selector: '[data-section]' };
  if (tile.dataset.record) return { kind: 'record', id: tile.dataset.record, selector: '[data-record]' };
  if (tile.dataset.tip) return { kind: 'tip', id: tile.dataset.tip, selector: '[data-tip]' };
  return { kind: 'attachment', id: tile.dataset.attachment, selector: '[data-attachment]' };
}

function beginTileDrag() {
  const drag = dragState;
  if (!drag || !drag.tile.isConnected) return;
  drag.active = true;
  hideReveal();
  drag.tile.classList.remove('is-pressed');
  drag.tile.classList.add('drag-origin');
  const rect = drag.tile.getBoundingClientRect();
  const ghost = drag.tile.cloneNode(true);
  ghost.classList.remove('drag-origin', 'is-pressed');
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  drag.ghost = ghost;
  drag.offsetX = rect.width / 2;
  drag.offsetY = rect.height / 2;
  document.body.append(ghost);
  $('drag-trash').hidden = false;
  moveTileDrag(drag.x, drag.y);
  try { drag.tile.setPointerCapture(drag.pointerId); } catch { /* The pointer may already have ended. */ }
  if (drag.pointerType === 'touch') navigator.vibrate?.(25);
}

function clearTileDrag() {
  if (!dragState) return;
  clearTimeout(dragState.timer);
  dragState.tile.classList.remove('drag-origin');
  dragState.ghost?.remove();
  document.querySelectorAll('.drag-target').forEach(tile => tile.classList.remove('drag-target'));
  $('drag-trash').hidden = true;
  $('drag-trash').classList.remove('over');
  dragState = null;
}

function moveTileDrag(x, y) {
  const drag = dragState;
  if (!drag?.active) return;
  drag.x = x;
  drag.y = y;
  drag.ghost.style.left = `${x - drag.offsetX}px`;
  drag.ghost.style.top = `${y - drag.offsetY}px`;
  const trash = $('drag-trash');
  const rect = trash.getBoundingClientRect();
  const overTrash = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  trash.classList.toggle('over', overTrash);
  document.querySelectorAll('.drag-target').forEach(tile => tile.classList.remove('drag-target'));
  const underPointer = document.elementFromPoint(x, y);
  const candidate = underPointer?.closest(drag.selector);
  drag.target = !overTrash && candidate?.isConnected ? candidate : null;
  drag.target?.classList.add('drag-target');
  drag.overTrash = overTrash;
  drag.append = !overTrash && !drag.target && underPointer?.closest(`#${drag.kind === 'section' ? 'sections' : drag.kind === 'record' ? 'records' : drag.kind === 'tip' ? 'tips' : 'attachments'}`);
}

function tileFileIds(kind, item) {
  if (kind === 'attachment') return [item.id];
  const records = kind === 'section' ? item.records : kind === 'record' ? [item] : [];
  if (kind === 'tip') return (item.blocks || []).filter(block => block.fileId).map(block => block.fileId);
  return records.flatMap(record => [
    ...(record.attachments || []).map(attachment => attachment.id),
    ...(record.tips || []).flatMap(tip => (tip.blocks || []).filter(block => block.fileId).map(block => block.fileId))
  ]);
}

function finalizePendingDeletion() {
  if (!pendingDeletion) return;
  clearTimeout(pendingDeletion.timer);
  Promise.allSettled(pendingDeletion.fileIds.map(removeFile));
  pendingDeletion = null;
  $('undo-toast').hidden = true;
}

function deleteDraggedTile(kind, id) {
  const { items, render } = dragCollection(kind);
  const index = items?.findIndex(item => item.id === id) ?? -1;
  if (index < 0) return;
  finalizePendingDeletion();
  const [item] = items.splice(index, 1);
  save();
  render();
  if (kind === 'record') renderSections();
  const label = kind === 'section' ? '分区' : kind === 'record' ? '记录' : kind === 'tip' ? '小 tip' : '附件';
  $('undo-label').textContent = `已删除${label}`;
  $('undo-toast').hidden = false;
  pendingDeletion = { items, index, item, render, kind, fileIds: tileFileIds(kind, item), timer: setTimeout(finalizePendingDeletion, 7000) };
}

function undoDraggedDelete() {
  if (!pendingDeletion) return;
  const { items, index, item, render, kind, timer } = pendingDeletion;
  clearTimeout(timer);
  pendingDeletion = null;
  items.splice(Math.min(index, items.length), 0, item);
  save();
  render();
  if (kind === 'record') renderSections();
  $('undo-toast').hidden = true;
}

function dropTileDrag() {
  const drag = dragState;
  if (!drag?.active) return clearTileDrag();
  suppressDragClickUntil = Date.now() + 450;
  suppressDragTarget = drag.tile;
  const { kind, id, target, overTrash, append } = drag;
  const targetId = target?.dataset[kind];
  const after = target ? drag.x > target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2 : false;
  clearTileDrag();
  if (overTrash) return deleteDraggedTile(kind, id);
  if (!targetId && !append || targetId === id) return;
  const { items, render } = dragCollection(kind);
  const from = items?.findIndex(item => item.id === id) ?? -1;
  const to = append ? items.length : items?.findIndex(item => item.id === targetId) ?? -1;
  if (from < 0 || to < 0) return;
  let destination = to + Number(after);
  if (from < destination) destination--;
  if (destination === from) return;
  const [item] = items.splice(from, 1);
  items.splice(destination, 0, item);
  save();
  render();
}

async function renderAttachments() {
  const renderId = ++attachmentRenderId;
  const record = currentRecord();
  const renderedRecordId = record?.id;
  clearAttachmentUrls();
  const container = $('attachments');
  const attachments = record?.attachments || [];
  $('attachment-count').textContent = attachments.length ? `· ${attachments.length}` : '';
  if (!attachments.length) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="tip-empty">加载中…</div>';
  const cards = await Promise.all(attachments.map(async attachment => {
    try {
      const blob = await getFile(attachment.id);
      return { attachment, url: blob ? URL.createObjectURL(blob) : null };
    } catch {
      return { attachment, url: null };
    }
  }));
  if (currentRecord()?.id !== renderedRecordId || renderId !== attachmentRenderId) {
    cards.forEach(card => { if (card.url) URL.revokeObjectURL(card.url); });
    return;
  }
  attachmentUrls = cards.filter(card => card.url).map(card => card.url);
  container.innerHTML = cards.map(({ attachment, url }) => {
    const name = escapeHtml(attachment.name || '未命名文件');
    const preview = url && attachment.kind !== 'file'
      ? `<img class="attachment-thumb" src="${url}" alt="">`
      : '<span class="attachment-symbol">▤</span>';
    const content = `${preview}<span class="attachment-name">${name}</span>`;
    const open = !url
      ? `<div class="attachment-open">${content}</div>`
      : attachment.kind === 'drawing'
        ? `<button class="attachment-open" data-drawing="${attachment.id}" aria-label="编辑手写：${name}">${content}</button>`
        : `<a class="attachment-open" href="${url}" ${attachment.kind === 'file' ? `download="${name}"` : 'target="_blank" rel="noopener"'} aria-label="打开：${name}">${content}</a>`;
    return `<div class="attachment-card" data-attachment="${attachment.id}">${open}<button class="attachment-remove" data-remove-attachment="${attachment.id}" aria-label="删除：${name}">×</button></div>`;
  }).join('');
  container.querySelectorAll('[data-remove-attachment]').forEach(button => button.onclick = () => deleteAttachment(button.dataset.removeAttachment));
  container.querySelectorAll('[data-drawing]').forEach(button => button.onclick = () => openDrawing(button.dataset.drawing));
}

async function addFiles(event, kind) {
  const files = [...(event.target.files || [])];
  event.target.value = '';
  const record = currentRecord();
  if (!record || !files.length) return;
  record.attachments ||= [];
  let added = 0;
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) { message(`${file.name} 超过 20 MB`); continue; }
    if (kind === 'image' && !file.type.startsWith('image/')) { message(`${file.name} 不是图片`); continue; }
    const id = uid();
    try {
      await putFile(id, file);
      record.attachments.push({ id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, kind });
      added++;
    } catch { message(`${file.name} 保存失败`); }
  }
  if (added) {
    record.updatedAt = Date.now();
    save();
    if (currentRecord()?.id === record.id) renderAttachments();
  }
}

async function deleteAttachment(id) {
  const record = currentRecord();
  if (!record || !confirm('删除这个附件？')) return;
  record.attachments = (record.attachments || []).filter(item => item.id !== id);
  save();
  renderAttachments();
  try { await removeFile(id); } catch { message('附件清理失败'); }
}

function drawingPoint(event) {
  const rect = $('drawing-canvas').getBoundingClientRect();
  const pressure = event.pressure > 0 ? event.pressure : 0.5;
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    p: Math.max(0.1, Math.min(1, pressure))
  };
}

function drawSegment(first, second) {
  const canvas = $('drawing-canvas');
  const context = canvas.getContext('2d');
  context.strokeStyle = '#31446d';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 2 + 13 * ((first.p + second.p) / 2);
  context.beginPath();
  context.moveTo(first.x * canvas.width, first.y * canvas.height);
  context.lineTo(second.x * canvas.width, second.y * canvas.height);
  context.stroke();
}

function redrawDrawing() {
  const canvas = $('drawing-canvas');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawingStrokes.forEach(stroke => {
    const points = stroke.points || [];
    if (points.length === 1) drawSegment(points[0], { ...points[0], x: points[0].x + 0.0001 });
    for (let index = 1; index < points.length; index++) drawSegment(points[index - 1], points[index]);
  });
}

function openDrawing(id = null) {
  drawingAttachmentId = id;
  const drawing = (currentRecord()?.attachments || []).find(item => item.id === id);
  drawingStrokes = structuredClone(drawing?.strokes || []);
  const canvas = $('drawing-canvas');
  canvas.width = 1000;
  canvas.height = 625;
  $('drawing-modal').hidden = false;
  redrawDrawing();
}

function handleDrawingStart(event) {
  if (drawingPointerId !== null) return;
  event.preventDefault();
  drawingPointerId = event.pointerId;
  $('drawing-canvas').setPointerCapture(event.pointerId);
  activeStroke = { points: [drawingPoint(event)] };
  drawSegment(activeStroke.points[0], { ...activeStroke.points[0], x: activeStroke.points[0].x + 0.0001 });
}

function handleDrawingMove(event) {
  if (event.pointerId !== drawingPointerId || !activeStroke) return;
  event.preventDefault();
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) {
    const next = drawingPoint(sample);
    const previous = activeStroke.points.at(-1);
    if (next.x === previous.x && next.y === previous.y) continue;
    activeStroke.points.push(next);
    drawSegment(previous, next);
  }
}

function handleDrawingEnd(event) {
  if (event.pointerId !== drawingPointerId) return;
  if (activeStroke) drawingStrokes.push(activeStroke);
  activeStroke = null;
  drawingPointerId = null;
}

async function saveDrawing() {
  const record = currentRecord();
  if (!record || !drawingStrokes.length) return message('请先写一点内容');
  const blob = await new Promise(resolve => $('drawing-canvas').toBlob(resolve, 'image/png'));
  if (!blob) return message('手写保存失败');
  const id = drawingAttachmentId || uid();
  try {
    await putFile(id, blob);
    record.attachments ||= [];
    const existing = record.attachments.find(item => item.id === id);
    const metadata = { id, name: existing?.name || `手写 ${new Date().toLocaleDateString('zh-CN')}`, type: 'image/png', size: blob.size, kind: 'drawing', strokes: structuredClone(drawingStrokes) };
    if (existing) Object.assign(existing, metadata);
    else record.attachments.push(metadata);
    record.updatedAt = Date.now();
    save();
    $('drawing-modal').hidden = true;
    renderAttachments();
  } catch { message('手写保存失败'); }
}

function openTip(id = null) {
  hideReveal();
  tipId = id;
  const tip = id ? currentTip() : null;
  $('tip-dialog-title').textContent = tip ? '编辑 tip' : '新建 tip';
  $('tip-title').value = tip?.title || '';
  const sourceBlocks = structuredClone(tip?.blocks || (tip?.body ? [{ id: uid(), type: 'text', text: tip.body }] : [{ id: uid(), type: 'ink', strokes: [] }]));
  tipDraft = { blocks: sourceBlocks.map(block => block.type === 'drawing' && block.strokes?.length
    ? { id: block.id, type: 'ink', strokes: block.strokes }
    : block.type === 'file' && /\.pdf$/i.test(block.fileName || '')
      ? { ...block, type: 'pdf', annotations: block.annotations || {} }
      : block) };
  tipDraftNewFiles = [];
  inkTool = 'black';
  inkBrush = 'pen';
  tipLevel = tip?.level || 'none';
  $('tip-color-popover').hidden = true;
  $('tip-color-button').setAttribute('aria-expanded', 'false');
  $('delete-tip').hidden = !tip;
  $('export-tip-pdf').hidden = !tip;
  renderTipLevels();
  $('tip-modal').hidden = false;
  renderTipDocument();
}

function inkToolbarHtml() {
  return `<div class="ink-tools" role="toolbar" aria-label="手写工具">
    <button class="ink-color black" data-ink-tool="black" aria-label="黑色笔" aria-pressed="${inkTool === 'black'}"></button>
    <button class="ink-color red" data-ink-tool="red" aria-label="红色笔" aria-pressed="${inkTool === 'red'}"></button>
    <button class="ink-color blue" data-ink-tool="blue" aria-label="蓝色笔" aria-pressed="${inkTool === 'blue'}"></button>
    <button class="ink-eraser" data-ink-tool="erase" aria-label="橡皮擦" aria-pressed="${inkTool === 'erase'}">⌫</button>
    <button class="ink-pan" data-ink-tool="pan" aria-label="移动页面" title="移动页面" aria-pressed="${inkTool === 'pan'}">✋</button>
    <details class="brush-settings"><summary aria-label="笔刷设置" title="笔刷设置">✎</summary><div class="brush-panel">
      <label>笔刷<select data-brush><option value="pen" ${inkBrush === 'pen' ? 'selected' : ''}>圆笔</option><option value="pencil" ${inkBrush === 'pencil' ? 'selected' : ''}>铅笔</option><option value="marker" ${inkBrush === 'marker' ? 'selected' : ''}>荧光笔</option></select></label>
      <label>粗细 <output data-size-value>${inkSize}</output><input data-ink-size type="range" min="1" max="24" value="${inkSize}"></label>
      <label>压感 <output data-pressure-value>${inkSensitivity}%</output><input data-ink-pressure type="range" min="0" max="100" value="${inkSensitivity}"></label>
    </div></details><button class="ink-undo" aria-label="撤销上一笔">↶</button>
  </div>`;
}

function bindInkToolbar(element, block, canvas) {
  element.querySelectorAll('[data-ink-tool]').forEach(button => button.onclick = () => {
    inkTool = button.dataset.inkTool;
    document.querySelectorAll('[data-ink-tool]').forEach(option => option.setAttribute('aria-pressed', String(option.dataset.inkTool === inkTool)));
    document.querySelectorAll('.tip-ink').forEach(ink => ink.classList.toggle('is-pan', inkTool === 'pan'));
  });
  element.querySelector('[data-brush]').onchange = event => { inkBrush = event.target.value; };
  element.querySelector('[data-ink-size]').oninput = event => { inkSize = Number(event.target.value); element.querySelector('[data-size-value]').textContent = inkSize; };
  element.querySelector('[data-ink-pressure]').oninput = event => { inkSensitivity = Number(event.target.value); element.querySelector('[data-pressure-value]').textContent = `${inkSensitivity}%`; };
  element.querySelector('.ink-undo').onclick = () => { block.strokes.pop(); redrawTipInk(block, canvas); };
}

async function renderTipDocument() {
  if (!tipDraft) return;
  const renderId = ++tipRenderId;
  pdfTasks.forEach(task => task.destroy().catch(() => {}));
  pdfTasks = [];
  clearTipUrls();
  const container = $('tip-document');
  container.innerHTML = tipDraft.blocks.map((block, index) => `<div class="tip-block" data-block="${block.id}">
    <div class="tip-block-tools"><span>${index + 1}</span><button data-move="up" aria-label="上移内容" ${index === 0 ? 'disabled' : ''}>↑</button><button data-move="down" aria-label="下移内容" ${index === tipDraft.blocks.length - 1 ? 'disabled' : ''}>↓</button><button data-remove-block aria-label="删除这块内容">×</button></div>
    ${block.type === 'text' ? `<textarea class="tip-text" rows="2" aria-label="第 ${index + 1} 段文字" placeholder="写在这里…">${escapeHtml(block.text || '')}</textarea>` : block.type === 'ink' ? `<div class="ink-sheet">${inkToolbarHtml()}<canvas class="tip-ink" width="1000" height="625" aria-label="直接在小 tip 中手写"></canvas></div>` : block.type === 'pdf' ? `<div class="pdf-sheet">${inkToolbarHtml()}<div class="pdf-stage"><canvas class="pdf-page" aria-label="PDF 页面"></canvas><canvas class="tip-ink pdf-ink" data-overlay="true" aria-label="在 PDF 上手写"></canvas></div><div class="pdf-pagebar"><button data-pdf-prev aria-label="上一页">←</button><span data-pdf-status>加载 PDF…</span><button data-pdf-next aria-label="下一页">→</button><button data-pdf-export aria-label="导出批注 PDF" title="导出批注 PDF">↓ PDF</button></div></div>` : block.type === 'file' ? `<a class="tip-file-block" aria-label="打开文件：${escapeHtml(block.fileName || '文件')}" target="_blank" rel="noopener">▤ <span>${escapeHtml(block.fileName || '文件')}</span></a>` : `<button class="tip-image-block" aria-label="查看图片"><span>加载中…</span></button>`}
  </div>`).join('');
  container.querySelectorAll('[data-block]').forEach(element => {
    const block = tipDraft.blocks.find(item => item.id === element.dataset.block);
    const textArea = element.querySelector('.tip-text');
    if (textArea) { fitTextarea(textArea); textArea.addEventListener('input', event => { block.text = event.target.value; fitTextarea(textArea); }); }
    element.querySelector('[data-remove-block]').onclick = () => { tipDraft.blocks = tipDraft.blocks.filter(item => item !== block); renderTipDocument(); };
    element.querySelectorAll('[data-move]').forEach(button => button.onclick = () => {
      const index = tipDraft.blocks.indexOf(block);
      const next = index + (button.dataset.move === 'up' ? -1 : 1);
      [tipDraft.blocks[index], tipDraft.blocks[next]] = [tipDraft.blocks[next], tipDraft.blocks[index]];
      renderTipDocument();
    });
    const imageButton = element.querySelector('.tip-image-block');
    if (imageButton) imageButton.onclick = () => openTipImage(block.fileId);
    const inkCanvas = element.querySelector('.tip-ink');
    if (inkCanvas) {
      if (block.type === 'ink') { setupTipInk(block, inkCanvas); bindInkToolbar(element, block, inkCanvas); }
      else renderPdfBlock(block, element, renderId);
    }
  });
  for (const block of tipDraft.blocks.filter(item => ['image', 'drawing', 'file'].includes(item.type))) {
    try {
      const blob = await getFile(block.fileId);
      if (renderId !== tipRenderId || !tipDraft?.blocks.includes(block)) return;
      const button = [...container.querySelectorAll('.tip-block')].find(item => item.dataset.block === block.id)?.querySelector('.tip-image-block');
      const fileLink = [...container.querySelectorAll('.tip-block')].find(item => item.dataset.block === block.id)?.querySelector('.tip-file-block');
      if (!button && !fileLink) continue;
      if (!blob) { if (button) button.textContent = '图片缺失'; if (fileLink) fileLink.removeAttribute('href'); continue; }
      const url = URL.createObjectURL(blob);
      tipRenderUrls.push(url);
      if (fileLink) { fileLink.href = url; if (blob.type !== 'application/pdf') fileLink.download = block.fileName || '文件'; }
      else button.innerHTML = `<img src="${url}" alt="${block.type === 'drawing' ? '手写内容' : '插入的图片'}">`;
    } catch { /* A missing image remains visible as a placeholder. */ }
  }
}

async function renderPdfBlock(block, element, renderId) {
  const status = element.querySelector('[data-pdf-status]');
  if (!window.pdfjsLib) { status.textContent = 'PDF 阅读器不可用'; return; }
  try {
    const blob = await getFile(block.fileId);
    if (!blob) throw new Error('PDF 文件缺失');
    if (renderId !== tipRenderId || !element.isConnected) return;
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs.worker.min.js';
    const task = window.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
    pdfTasks.push(task);
    const documentPdf = await task.promise;
    if (renderId !== tipRenderId || !element.isConnected) return;
    const pageCanvas = element.querySelector('.pdf-page');
    const inkCanvas = element.querySelector('.pdf-ink');
    const prev = element.querySelector('[data-pdf-prev]');
    const next = element.querySelector('[data-pdf-next]');
    let pageNumber = Math.max(1, Math.min(documentPdf.numPages, Number(block.viewPage) || 1));
    let busy = false;
    const showPage = async () => {
      if (busy) return;
      busy = true;
      prev.disabled = next.disabled = true;
      try {
        const page = await documentPdf.getPage(pageNumber);
        const unit = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(1000 / unit.width, 1700 / unit.height) });
        pageCanvas.width = inkCanvas.width = Math.ceil(viewport.width);
        pageCanvas.height = inkCanvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: pageCanvas.getContext('2d'), viewport }).promise;
        if (renderId !== tipRenderId || !element.isConnected) return;
        block.viewPage = pageNumber;
        block.annotations ||= {};
        const pageInk = block.annotations[pageNumber] ||= { strokes: [] };
        setupTipInk(pageInk, inkCanvas);
        bindInkToolbar(element, pageInk, inkCanvas);
        status.textContent = `${pageNumber} / ${documentPdf.numPages}`;
      } catch { status.textContent = 'PDF 页面无法显示'; }
      finally { busy = false; prev.disabled = pageNumber === 1; next.disabled = pageNumber === documentPdf.numPages; }
    };
    prev.onclick = () => { if (busy || pageNumber <= 1) return; pageNumber--; showPage(); };
    next.onclick = () => { if (busy || pageNumber >= documentPdf.numPages) return; pageNumber++; showPage(); };
    element.querySelector('[data-pdf-export]').onclick = async () => {
      try { await window.BubblePdfAnnotation.exportAnnotated(block, getFile); message('批注 PDF 已导出'); }
      catch (error) { message(error.message || 'PDF 导出失败'); }
    };
    await showPage();
  } catch { if (renderId === tipRenderId) status.textContent = 'PDF 无法打开'; }
}

async function openTipImage(id) {
  const blob = await getFile(id);
  if (!blob) return message('图片缺失');
  const url = URL.createObjectURL(blob);
  if (window.BubbleNative) {
    showImageOverlay(url);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const inkColors = { black: '#263351', red: '#dc5766', blue: '#4275cf' };
const pencilColors = { black: '#687185', red: '#e4929c', blue: '#8da9e0' };

function inkWidth(stroke, pressure, canvasWidth = 1000) {
  const size = Math.max(1, Math.min(24, Number(stroke.size) || 8));
  const sensitivity = Math.max(0, Math.min(100, Number(stroke.sensitivity ?? 65))) / 100;
  const factor = Math.max(.2, 1 + ((pressure || .5) - .5) * 2 * sensitivity);
  return size * factor * (stroke.brush === 'marker' ? 1.8 : stroke.brush === 'pencil' ? .72 : 1) * canvasWidth / 1000;
}

function drawTipInkSegment(context, canvas, stroke, first, second, dot = false) {
  context.strokeStyle = stroke.brush === 'pencil' ? (pencilColors[stroke.color] || pencilColors.black) : (inkColors[stroke.color] || inkColors.black);
  context.globalAlpha = stroke.brush === 'marker' ? .34 : 1;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = inkWidth(stroke, (first.p + second.p) / 2, canvas.width);
  context.beginPath();
  context.moveTo(first.x * canvas.width, first.y * canvas.height);
  context.lineTo((second.x + (dot ? .0001 : 0)) * canvas.width, second.y * canvas.height);
  context.stroke();
  context.globalAlpha = 1;
}

function redrawTipInk(block, canvas) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!canvas.dataset.overlay) { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  for (const stroke of block.strokes || []) {
    const points = stroke.points || [];
    for (let index = 0; index < points.length; index++) {
      const first = points[Math.max(0, index - 1)];
      const second = points[index];
      drawTipInkSegment(context, canvas, stroke, first, second, index === 0);
    }
  }
}

function setupTipInk(block, canvas) {
  block.strokes ||= [];
  redrawTipInk(block, canvas);
  canvas.classList.toggle('is-pan', inkTool === 'pan');
  let pointerId = null;
  let active = null;
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      p: Math.max(.1, Math.min(1, event.pressure || .5))
    };
  };
  const erase = target => {
    const before = block.strokes.length;
    block.strokes = block.strokes.filter(stroke => !(stroke.points || []).some(item => Math.hypot((item.x - target.x) * 1.6, item.y - target.y) < Math.max(.018, inkSize / 450)));
    if (before !== block.strokes.length) redrawTipInk(block, canvas);
  };
  canvas.onpointerdown = event => {
    if (inkTool === 'pan') return;
    event.preventDefault();
    pointerId = event.pointerId;
    canvas.setPointerCapture(pointerId);
    const first = point(event);
    if (inkTool === 'erase') erase(first);
    else {
      active = { color: inkTool, brush: inkBrush, size: inkSize, sensitivity: inkSensitivity, points: [first] };
      drawTipInkSegment(canvas.getContext('2d'), canvas, active, first, first, true);
    }
  };
  canvas.onpointermove = event => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) {
      const next = point(sample);
      if (inkTool === 'erase') erase(next);
      else if (active) {
        const previous = active.points.at(-1);
        if (next.x !== previous.x || next.y !== previous.y) {
          active.points.push(next);
          drawTipInkSegment(canvas.getContext('2d'), canvas, active, previous, next);
        }
      }
    }
  };
  const end = event => {
    if (event.pointerId !== pointerId) return;
    if (active) block.strokes.push(active);
    active = null;
    pointerId = null;
  };
  canvas.onpointerup = end;
  canvas.onpointercancel = end;
}

function cancelDrawing() { $('drawing-modal').hidden = true; }

async function addTipImages(event) {
  const files = [...(event.target.files || [])];
  event.target.value = '';
  const draft = tipDraft;
  if (!draft) return;
  for (const file of files) {
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) { message('请选择 20 MB 以内的图片'); continue; }
    const id = uid();
    try {
      await putFile(id, file);
      if (draft !== tipDraft) { await removeFile(id); continue; }
      tipDraftNewFiles.push(id);
      draft.blocks.push({ id: uid(), type: 'image', fileId: id });
    } catch { message('图片保存失败'); }
  }
  if (draft === tipDraft) renderTipDocument();
}

async function addTipFiles(event) {
  const files = [...(event.target.files || [])];
  event.target.value = '';
  const draft = tipDraft;
  if (!draft) return;
  for (const file of files) {
    if (file.size > 40 * 1024 * 1024) { message('文件需小于 40 MB'); continue; }
    const id = uid();
    try {
      await putFile(id, file);
      if (draft !== tipDraft) { await removeFile(id); continue; }
      tipDraftNewFiles.push(id);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (isPdf && draft.blocks.length === 1 && draft.blocks[0].type === 'ink' && !draft.blocks[0].strokes?.length) draft.blocks = [];
      draft.blocks.push({ id: uid(), type: isPdf ? 'pdf' : 'file', fileId: id, fileName: file.name.slice(0, 255), ...(isPdf ? { annotations: {} } : {}) });
    } catch { message('文件保存失败'); }
  }
  if (draft === tipDraft) renderTipDocument();
}

async function exportTipPdf() {
  if (!tipDraft) return;
  const title = $('tip-title').value.trim() || '小 tip';
  try {
    const pdfBlocks = tipDraft.blocks.filter(block => block.type === 'pdf');
    if (pdfBlocks.length) {
      if (pdfBlocks.length !== 1 || tipDraft.blocks.some(block => block.type !== 'pdf' && (block.type !== 'ink' || block.strokes?.length))) {
        return message('请在 PDF 页面下方单独导出批注 PDF');
      }
      await window.BubblePdfAnnotation.exportAnnotated(pdfBlocks[0], getFile);
      return message('批注 PDF 已导出');
    }
    await window.BubblePdf.exportPdf(title, [{ title: '', blocks: tipDraft.blocks.map(block => block.type === 'file' ? { type: 'text', text: `文件：${block.fileName || '文件'}` } : block) }], getFile);
    message('PDF 已导出');
  } catch (error) { message(error.message || 'PDF 导出失败'); }
}

async function exportRecordPdf() {
  const record = currentRecord();
  if (!record) return;
  const sections = [];
  if (record.body?.trim() || record.attachments?.length) {
    sections.push({ title: '记录', blocks: [
      ...(record.body?.trim() ? [{ type: 'text', text: record.body }] : []),
      ...(record.attachments || []).map(item => item.kind === 'file' ? { type: 'text', text: `附件：${item.name}` } : { type: 'image', fileId: item.id })
    ] });
  }
  for (const tip of record.tips) sections.push({ title: tip.title || '小 tip', blocks: (tip.blocks || (tip.body ? [{ type: 'text', text: tip.body }] : [])).map(block => block.type === 'file' ? { type: 'text', text: `文件：${block.fileName || '文件'}` } : block) });
  try {
    await window.BubblePdf.exportPdf(record.title || '记录', sections, getFile);
    message('PDF 已导出');
  } catch (error) { message(error.message || 'PDF 导出失败'); }
}

function renderTipLevels() {
  $('tip-color-button').className = `tip-top-button level-${tipLevel}`;
  renderLevels('tip-levels', tipLevel, level => {
    tipLevel = level;
    renderTipLevels();
    $('tip-color-popover').hidden = true;
    $('tip-color-button').setAttribute('aria-expanded', 'false');
  });
}

function closeTip() {
  $('tip-modal').hidden = true;
  $('tip-color-popover').hidden = true;
  ++tipRenderId;
  pdfTasks.forEach(task => task.destroy().catch(() => {}));
  pdfTasks = [];
  clearTipUrls();
  Promise.allSettled(tipDraftNewFiles.map(removeFile));
  tipDraftNewFiles = [];
  tipDraft = null;
}

function saveTip() {
  const record = currentRecord();
  if (!record || !tipDraft) return;
  const title = $('tip-title').value.trim();
  const blocks = tipDraft.blocks.filter(block => block.type === 'text' ? block.text.trim() : block.type === 'ink' ? block.strokes?.length : block.fileId);
  if (!title && !blocks.length) { $('tip-title').focus(); return message('请填写标题或内容'); }
  const tip = tipId ? currentTip() : null;
  const oldFiles = (tip?.blocks || []).filter(block => block.fileId).map(block => block.fileId);
  if (tip) Object.assign(tip, { title, body: '', blocks, level: tipLevel });
  else record.tips.push({ id: uid(), title, body: '', blocks, level: tipLevel, createdAt: Date.now() });
  const keptFiles = blocks.filter(block => block.fileId).map(block => block.fileId);
  Promise.allSettled([...oldFiles, ...tipDraftNewFiles].filter(id => !keptFiles.includes(id)).map(removeFile));
  tipDraftNewFiles = [];
  record.updatedAt = Date.now();
  save();
  renderTips();
  closeTip();
}

function deleteTip() {
  const record = currentRecord();
  if (!record || !tipId || !confirm('删除这个 tip？')) return;
  const fileIds = (currentTip()?.blocks || []).filter(block => block.fileId).map(block => block.fileId);
  record.tips = record.tips.filter(item => item.id !== tipId);
  save();
  renderTips();
  closeTip();
  Promise.allSettled(fileIds.map(removeFile));
}

function openSectionDialog(editing = false) {
  const section = editing ? currentSection() : null;
  editingSectionId = section?.id || null;
  $('section-dialog-title').textContent = section ? '编辑分区' : '新建分区';
  $('delete-section').hidden = !section;
  $('section-name').value = section?.name || '';
  sectionColor = section?.color || 'blue';
  sectionShape = section?.shape || 'square';
  renderSectionColors();
  renderSectionShapes();
  $('section-modal').hidden = false;
  $('section-name').focus();
}

function renderSectionShapes() {
  $('section-shapes').innerHTML = [['square', '方块'], ['round', '气泡']].map(([shape, label]) => `
    <button class="shape-pick ${sectionShape === shape ? 'selected' : ''}" data-shape="${shape}" aria-pressed="${sectionShape === shape}">${label}</button>`).join('');
  $('section-shapes').querySelectorAll('[data-shape]').forEach(button => {
    button.addEventListener('click', () => { sectionShape = button.dataset.shape; renderSectionShapes(); });
  });
}

function renderSectionColors() {
  $('section-colors').innerHTML = sectionColors.map(color => `
    <button class="swatch ${sectionColor === color.id ? 'selected' : ''}" style="background:${color.value}" data-color="${color.id}" aria-label="${color.label}" aria-pressed="${sectionColor === color.id}"></button>`).join('');
  $('section-colors').querySelectorAll('[data-color]').forEach(button => {
    button.addEventListener('click', () => { sectionColor = button.dataset.color; renderSectionColors(); });
  });
}

function saveSection() {
  const name = $('section-name').value.trim();
  if (!name) { $('section-name').focus(); return message('请填写分区名称'); }
  if (editingSectionId) {
    const section = state.sections.find(item => item.id === editingSectionId);
    if (!section) return;
    Object.assign(section, { name, color: sectionColor, shape: sectionShape });
    renderRecords();
  } else {
    state.sections.push({ id: uid(), name, color: sectionColor, shape: sectionShape, records: [] });
  }
  save();
  renderSections();
  $('section-modal').hidden = true;
}

function deleteSection() {
  const section = currentSection();
  if (!section || !confirm(`删除「${section.name}」及其中 ${section.records.length} 条记录？`)) return;
  const fileIds = section.records.flatMap(record => [...(record.attachments || []).map(item => item.id), ...record.tips.flatMap(tip => (tip.blocks || []).filter(block => block.fileId).map(block => block.fileId))]);
  state.sections = state.sections.filter(item => item.id !== section.id);
  sectionId = null;
  recordId = null;
  save();
  renderSections();
  $('section-modal').hidden = true;
  show('home');
  Promise.allSettled(fileIds.map(removeFile));
}

function deleteRecord() {
  const section = currentSection();
  if (!section || !confirm('删除这条记录及其中的 tip？')) return;
  const fileIds = [...(currentRecord()?.attachments || []).map(item => item.id), ...(currentRecord()?.tips || []).flatMap(tip => (tip.blocks || []).filter(block => block.fileId).map(block => block.fileId))];
  section.records = section.records.filter(item => item.id !== recordId);
  recordId = null;
  save();
  renderRecords();
  renderSections();
  show('zone');
  Promise.allSettled(fileIds.map(removeFile));
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  }
  return btoa(binary);
}

function base64ToBlob(value, type) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function exportBackup() {
  const button = $('export-backup');
  button.disabled = true;
  button.textContent = '准备中…';
  try {
    const ids = [...new Set(state.sections.flatMap(section => section.records.flatMap(record => [...(record.attachments || []).map(item => item.id), ...record.tips.flatMap(tip => (tip.blocks || []).filter(block => block.fileId).map(block => block.fileId))])))];
    const files = [];
    for (const id of ids) {
      const blob = await getFile(id);
      if (!blob) throw new Error('附件数据缺失，无法完整备份');
      files.push({ id, type: blob.type, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
    }
    const data = JSON.stringify({ format: 'bubble-notes-backup', version: 5, exportedAt: new Date().toISOString(), sections: state.sections, files });
    const blob = new Blob([data], { type: 'application/json' });
    const name = `泡泡笔记备份-${new Date().toISOString().slice(0, 10)}.json`;
    if (window.BubbleNative) await saveBlobNative(blob, name);
    else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    message('备份已导出');
  } catch (error) {
    message(error.message || '导出失败，请重试');
  } finally {
    button.disabled = false;
    button.textContent = '↓ 导出备份';
  }
}

function normalizeBackup(data) {
  if (!data || data.format !== 'bubble-notes-backup' || ![1, 2, 3, 4, 5].includes(data.version) || !Array.isArray(data.sections) || data.sections.length > 10000) {
    throw new Error('备份格式不正确');
  }
  if (data.version >= 2 && !Array.isArray(data.files)) throw new Error('附件数据不完整');
  const filesById = new Map((data.files || []).map(file => [file.id, file]));
  const importedFiles = [];
  let recordCount = 0;
  let tipCount = 0;
  let attachmentCount = 0;
  const validLevel = value => levels.some(level => level.id === value) ? value : 'none';
  const normalizeStrokes = raw => (Array.isArray(raw) ? raw : []).slice(0, 10000).map(stroke => ({
    color: ['black', 'red', 'blue'].includes(stroke?.color) ? stroke.color : 'black',
    brush: ['pen', 'pencil', 'marker'].includes(stroke?.brush) ? stroke.brush : 'pen',
    size: Math.max(1, Math.min(24, Number(stroke?.size) || 8)),
    sensitivity: Math.max(0, Math.min(100, Number(stroke?.sensitivity ?? 65))),
    points: (Array.isArray(stroke?.points) ? stroke.points : []).slice(0, 10000).map(point => ({
      x: Math.max(0, Math.min(1, Number(point?.x) || 0)),
      y: Math.max(0, Math.min(1, Number(point?.y) || 0)),
      p: Math.max(.1, Math.min(1, Number(point?.p) || .5))
    }))
  }));
  const sections = data.sections.map(section => {
    if (!section || typeof section.name !== 'string' || !Array.isArray(section.records) || section.records.length > 10000) throw new Error('分区数据不完整');
    const records = section.records.map(record => {
      if (!record || typeof record.title !== 'string' || typeof record.body !== 'string' || !Array.isArray(record.tips) || record.tips.length > 100000) throw new Error('记录数据不完整');
      recordCount++;
      const tips = record.tips.map(tip => {
        if (!tip || typeof tip.title !== 'string' || typeof tip.body !== 'string') throw new Error('tip 数据不完整');
        tipCount++;
        if (tip.blocks != null && !Array.isArray(tip.blocks)) throw new Error('tip 内容不完整');
        const blocks = (tip.blocks || []).map(block => {
          if (block?.type === 'text' && typeof block.text === 'string') return { id: uid(), type: 'text', text: block.text };
          if (block?.type === 'ink' && Array.isArray(block.strokes)) {
            return { id: uid(), type: 'ink', strokes: normalizeStrokes(block.strokes) };
          }
          if (!['image', 'drawing', 'file', 'pdf'].includes(block?.type) || typeof block.fileId !== 'string') throw new Error('tip 内容不完整');
          const file = filesById.get(block.fileId);
          if (!file || typeof file.data !== 'string' || typeof file.type !== 'string') throw new Error('tip 图片数据不完整');
          const blob = base64ToBlob(file.data, file.type);
          const id = uid();
          attachmentCount++;
          importedFiles.push({ id, blob });
          const annotations = {};
          if (block.type === 'pdf' && block.annotations && typeof block.annotations === 'object') {
            for (const page of Object.keys(block.annotations).slice(0, 10000)) {
              if (/^[1-9]\d*$/.test(page)) annotations[page] = { strokes: normalizeStrokes(block.annotations[page]?.strokes) };
            }
          }
          return { id: uid(), type: block.type, fileId: id, fileName: ['file', 'pdf'].includes(block.type) ? String(block.fileName || '文件').slice(0, 255) : undefined, strokes: Array.isArray(block.strokes) ? block.strokes : undefined, ...(block.type === 'pdf' ? { annotations } : {}) };
        });
        return { id: uid(), title: tip.title.slice(0, 80), body: tip.body, blocks, level: validLevel(tip.level), createdAt: Number(tip.createdAt) || Date.now() };
      });
      const attachments = (record.attachments || []).map(attachment => {
        if (!attachment || typeof attachment.id !== 'string' || typeof attachment.name !== 'string') throw new Error('附件信息不完整');
        const file = filesById.get(attachment.id);
        if (!file || typeof file.data !== 'string' || typeof file.type !== 'string') throw new Error('附件数据不完整');
        const blob = base64ToBlob(file.data, file.type);
        const id = uid();
        attachmentCount++;
        importedFiles.push({ id, blob });
        return { id, name: attachment.name.slice(0, 255), type: blob.type, size: blob.size, kind: ['image', 'drawing', 'file'].includes(attachment.kind) ? attachment.kind : 'file', strokes: Array.isArray(attachment.strokes) ? attachment.strokes : undefined };
      });
      return { id: uid(), title: record.title.slice(0, 80), body: record.body, level: validLevel(record.level), tips, attachments, updatedAt: Number(record.updatedAt) || Date.now() };
    });
    return { id: uid(), name: section.name.slice(0, 24) || '未命名分区', color: sectionColors.some(color => color.id === section.color) ? section.color : 'blue', shape: section.shape === 'round' ? 'round' : 'square', records };
  });
  return { sections, recordCount, tipCount, attachmentCount, files: importedFiles };
}

async function chooseBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 200 * 1024 * 1024) return message('备份文件超过 200 MB');
  try {
    pendingImport = normalizeBackup(JSON.parse(await file.text()));
    $('import-summary').textContent = `将添加 ${pendingImport.sections.length} 个分区、${pendingImport.recordCount} 条记录、${pendingImport.tipCount} 个 tip、${pendingImport.attachmentCount} 个附件。现有内容会保留。`;
    $('import-summary').hidden = false;
    $('confirm-import').hidden = false;
  } catch (error) {
    pendingImport = null;
    $('import-summary').hidden = true;
    $('confirm-import').hidden = true;
    message(error.message || '无法读取备份');
  }
}

async function importBackup() {
  if (!pendingImport) return;
  const imported = pendingImport;
  $('confirm-import').disabled = true;
  try {
    for (const file of imported.files) await putFile(file.id, file.blob);
    state.sections.push(...imported.sections);
    pendingImport = null;
    save();
    renderSections();
    $('backup-modal').hidden = true;
    show('home');
    message('已导入备份');
  } catch {
    message('导入失败，原有内容未改变');
  } finally {
    $('confirm-import').disabled = false;
  }
}

function openBackup() {
  pendingImport = null;
  $('import-summary').hidden = true;
  $('confirm-import').hidden = true;
  $('backup-modal').hidden = false;
}

function bindEvents() {
  window.BubbleBack = () => {
    if (!$('tip-modal').hidden) { closeTip(); return true; }
    if (!$('drawing-modal').hidden) { cancelDrawing(); return true; }
    for (const id of ['record-color-modal', 'section-modal', 'backup-modal']) {
      if (!$(id).hidden) { $(id).hidden = true; return true; }
    }
    if ($('record').classList.contains('active')) { renderRecords(); show('zone'); return true; }
    if ($('zone').classList.contains('active')) { renderSections(); show('home'); return true; }
    return false;
  };
  document.addEventListener('click', async event => {
    if (!window.BubbleNative) return;
    const link = event.target.closest('.attachment-open[href^="blob:"], .tip-file-block[href^="blob:"]');
    if (!link) return;
    event.preventDefault();
    const blob = await fetch(link.href).then(response => response.blob());
    if (blob.type.startsWith('image/')) return showImageOverlay(link.href);
    const name = link.closest('[data-attachment]')
      ? (currentRecord()?.attachments || []).find(item => item.id === link.closest('[data-attachment]').dataset.attachment)?.name
      : link.querySelector('span')?.textContent;
    try { await saveBlobNative(blob, name || '文件'); } catch { message('文件保存失败'); }
  }, true);
  document.addEventListener('dragstart', event => {
    if (event.target.closest(tileSelector)) event.preventDefault();
  });
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || dragState) return;
    if (event.target.closest('[data-remove-attachment]')) return;
    const tile = event.target.closest(tileSelector);
    if (!tile) return;
    dragState = { ...tileKind(tile), tile, pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, active: false };
    dragState.timer = setTimeout(() => {
      if (dragState?.kind !== 'record') return beginTileDrag();
      dragState.ready = true;
      dragState.timer = setTimeout(() => {
        const held = dragState;
        if (!held || held.active) return;
        suppressDragClickUntil = Date.now() + 500;
        suppressDragTarget = held.tile;
        clearTileDrag();
        openRecordColor(held.id);
        if (held.pointerType === 'touch') navigator.vibrate?.(30);
      }, 180);
    }, 430);
  }, true);
  document.addEventListener('pointermove', event => {
    const drag = dragState;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 10) {
        if (drag.kind === 'record' && drag.ready) {
          clearTimeout(drag.timer);
          beginTileDrag();
          moveTileDrag(event.clientX, event.clientY);
        } else clearTileDrag();
      }
      return;
    }
    event.preventDefault();
    moveTileDrag(event.clientX, event.clientY);
  }, { capture: true, passive: false });
  document.addEventListener('pointerup', event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.active) moveTileDrag(event.clientX, event.clientY);
    dropTileDrag();
  }, true);
  document.addEventListener('pointercancel', event => {
    if (dragState?.pointerId === event.pointerId) clearTileDrag();
  }, true);
  document.addEventListener('touchmove', event => { if (dragState?.active) event.preventDefault(); }, { passive: false });
  document.addEventListener('click', event => {
    if (Date.now() > suppressDragClickUntil || !suppressDragTarget?.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('blur', clearTileDrag);
  $('undo-delete').onclick = undoDraggedDelete;
  const pressedButtons = new Map();
  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('button:not(:disabled)');
    if (!button) return;
    button.style.setProperty('--press-scale', String(Math.max(0.84, 1 - 0.16 * (event.pressure || 0.5))));
    button.classList.add('is-pressed');
    pressedButtons.set(event.pointerId, button);
    if (event.pointerType === 'touch') navigator.vibrate?.(12);
  });
  document.addEventListener('pointermove', event => {
    const button = pressedButtons.get(event.pointerId);
    if (button && event.pointerType === 'pen') button.style.setProperty('--press-scale', String(Math.max(0.84, 1 - 0.16 * (event.pressure || 0.5))));
  });
  const releasePress = event => {
    const button = pressedButtons.get(event.pointerId);
    if (!button) return;
    pressedButtons.delete(event.pointerId);
    button.classList.remove('is-pressed');
    if (button.isConnected && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      button.animate([{ transform: 'scale(.88)' }, { transform: 'scale(1.07)' }, { transform: 'scale(.98)' }, { transform: 'scale(1)' }], { duration: 410, easing: 'cubic-bezier(.2,.75,.3,1)' });
    }
  };
  document.addEventListener('pointerup', releasePress);
  document.addEventListener('pointercancel', releasePress);
  $('open-backup').onclick = openBackup;
  $('cancel-backup').onclick = () => { $('backup-modal').hidden = true; };
  $('export-backup').onclick = exportBackup;
  $('choose-backup').onclick = () => $('backup-file').click();
  $('backup-file').onchange = chooseBackup;
  $('confirm-import').onclick = importBackup;
  document.addEventListener('click', event => {
    if (!event.target.closest('.record-card, .tip-tile')) hideReveal();
  });
  window.addEventListener('scroll', hideReveal, { passive: true });
  $('add-section').onclick = () => openSectionDialog(false);
  $('edit-section').onclick = () => openSectionDialog(true);
  $('cancel-section').onclick = () => { $('section-modal').hidden = true; };
  $('save-section').onclick = saveSection;
  $('delete-section').onclick = deleteSection;
  $('section-name').onkeydown = event => { if (event.key === 'Enter') saveSection(); };
  $('back-home').onclick = () => { renderSections(); show('home'); };
  $('add-record').onclick = addRecord;
  $('close-record-color').onclick = () => { $('record-color-modal').hidden = true; };
  $('back-zone').onclick = () => { renderRecords(); show('zone'); };
  $('record-title').oninput = event => {
    const record = currentRecord();
    if (!record) return;
    record.title = event.target.value;
    record.updatedAt = Date.now();
    save();
  };
  $('record-body').oninput = event => {
    const record = currentRecord();
    if (!record) return;
    record.body = event.target.value;
    record.updatedAt = Date.now();
    fitTextarea(event.target);
    save();
  };
  $('add-image').onclick = () => $('image-file').click();
  $('add-file').onclick = () => $('other-file').click();
  $('image-file').onchange = event => addFiles(event, 'image');
  $('other-file').onchange = event => addFiles(event, 'file');
  $('add-drawing').onclick = () => openDrawing();
  $('drawing-cancel').onclick = cancelDrawing;
  $('drawing-undo').onclick = () => { drawingStrokes.pop(); redrawDrawing(); };
  $('drawing-clear').onclick = () => { drawingStrokes = []; redrawDrawing(); };
  $('drawing-save').onclick = saveDrawing;
  $('drawing-canvas').addEventListener('pointerdown', handleDrawingStart);
  $('drawing-canvas').addEventListener('pointermove', handleDrawingMove);
  $('drawing-canvas').addEventListener('pointerup', handleDrawingEnd);
  $('drawing-canvas').addEventListener('pointercancel', handleDrawingEnd);
  $('add-tip').onclick = () => openTip();
  $('export-record-pdf').onclick = exportRecordPdf;
  $('export-tip-pdf').onclick = exportTipPdf;
  $('tip-add-text').onclick = () => { tipDraft.blocks.push({ id: uid(), type: 'text', text: '' }); renderTipDocument(); $('tip-document').querySelector('.tip-block:last-child textarea')?.focus(); };
  $('tip-add-image').onclick = () => $('tip-image-file').click();
  $('tip-image-file').onchange = addTipImages;
  $('tip-add-file').onclick = () => $('tip-other-file').click();
  $('tip-other-file').onchange = addTipFiles;
  $('tip-add-drawing').onclick = () => { tipDraft.blocks.push({ id: uid(), type: 'ink', strokes: [] }); renderTipDocument(); $('tip-document').querySelector('.tip-block:last-child canvas')?.scrollIntoView({ block: 'nearest' }); };
  $('tip-color-button').onclick = () => { const panel = $('tip-color-popover'); panel.hidden = !panel.hidden; $('tip-color-button').setAttribute('aria-expanded', String(!panel.hidden)); };
  $('cancel-tip').onclick = closeTip;
  $('save-tip').onclick = saveTip;
  $('delete-tip').onclick = deleteTip;
  $('delete-record').onclick = deleteRecord;
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      if (modal.id === 'tip-modal') closeTip();
      else if (modal.id === 'drawing-modal') cancelDrawing();
      else modal.hidden = true;
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (dragState?.active) return clearTileDrag();
      if (!$('drawing-modal').hidden) cancelDrawing();
      else if (!$('tip-modal').hidden) closeTip();
      else document.querySelectorAll('.modal').forEach(modal => { modal.hidden = true; });
    }
  });
}

async function start() {
  try {
    database = await openDatabase();
    state = await readState();
    if (!Array.isArray(state.sections)) throw new Error('Invalid saved data');
    bindEvents();
    renderSections();
    setStatus('已保存');
    if (!window.BubbleNative && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => message('离线功能暂不可用'));
  } catch (error) {
    setStatus('数据加载失败', true);
    message('无法读取本机数据，请检查浏览器存储设置后刷新');
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  }
}

start();
