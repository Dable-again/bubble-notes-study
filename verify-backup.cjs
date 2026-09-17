const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('dist/app.js', 'utf8').replace(/\nstart\(\);\s*$/, '');
const context = vm.createContext({
  crypto: require('node:crypto').webcrypto,
  Blob,
  atob,
  Date,
  document: {},
  window: {},
});
vm.runInContext(source, context);

const base = version => ({
  format: 'bubble-notes-backup', version,
  sections: [{ name: '数学', color: 'blue', shape: 'square', records: [{
    title: '错题集', body: '记录', level: 'red', attachments: [],
    tips: [{ title: '公式', body: '旧正文', level: 'yellow' }]
  }] }]
});
const legacy = context.normalizeBackup(base(1));
assert.equal(legacy.sections[0].records[0].tips[0].body, '旧正文');
assert.equal(legacy.files.length, 0);

const v2 = base(2);
v2.sections[0].records[0].attachments.push({ id: 'old-file', name: '图.png', kind: 'image' });
v2.files = [{ id: 'old-file', type: 'image/png', data: 'AA==' }];
const oldImage = context.normalizeBackup(v2);
assert.equal(oldImage.files.length, 1);
assert.notEqual(oldImage.sections[0].records[0].attachments[0].id, 'old-file');

const v3 = base(3);
v3.sections[0].records[0].tips[0].blocks = [
  { type: 'text', text: '新正文' },
  { type: 'drawing', fileId: 'stroke', strokes: [{ points: [{ x: .5, y: .5, p: .7 }] }] },
  { type: 'image', fileId: 'photo' }
];
v3.files = [
  { id: 'stroke', type: 'image/png', data: 'AA==' },
  { id: 'photo', type: 'image/png', data: 'AQ==' }
];
const imported = context.normalizeBackup(v3);
const blocks = imported.sections[0].records[0].tips[0].blocks;
assert.equal(blocks.length, 3);
assert.equal(imported.files.length, 2);
assert.ok(blocks[1].fileId !== 'stroke' && blocks[2].fileId !== 'photo');
assert.equal(blocks[1].strokes[0].points[0].p, .7);
const v4 = base(4);
v4.files = [];
v4.sections[0].records[0].tips[0].blocks = [{ type: 'ink', strokes: [{ color: 'red', points: [{ x: .25, y: .8, p: .6 }] }] }];
const ink = context.normalizeBackup(v4).sections[0].records[0].tips[0].blocks[0];
assert.equal(ink.type, 'ink');
assert.equal(ink.strokes[0].color, 'red');
assert.equal(ink.strokes[0].points[0].p, .6);
const withFile = base(4);
withFile.files = [{ id: 'book', type: 'application/pdf', data: 'JVBERg==' }];
withFile.sections[0].records[0].tips[0].blocks = [{ type: 'file', fileId: 'book', fileName: '习题.pdf' }];
const restoredFile = context.normalizeBackup(withFile);
assert.equal(restoredFile.sections[0].records[0].tips[0].blocks[0].fileName, '习题.pdf');
assert.equal(restoredFile.files[0].blob.type, 'application/pdf');
const v5 = base(5);
v5.files = [{ id: 'pdf', type: 'application/pdf', data: 'JVBERg==' }];
v5.sections[0].records[0].tips[0].blocks = [{ type: 'pdf', fileId: 'pdf', fileName: '练习.pdf', annotations: { 2: { strokes: [{ color: 'blue', brush: 'pencil', size: 14, sensitivity: 80, points: [{ x: .2, y: .3, p: .7 }] }] } } }];
const restoredPdf = context.normalizeBackup(v5).sections[0].records[0].tips[0].blocks[0];
assert.equal(restoredPdf.type, 'pdf');
assert.equal(restoredPdf.annotations[2].strokes[0].brush, 'pencil');
assert.equal(restoredPdf.annotations[2].strokes[0].size, 14);
assert.equal(restoredPdf.annotations[2].strokes[0].sensitivity, 80);
const v6 = base(6);
v6.files = [{ id: 'source', type: 'application/pdf', data: 'JVBERg==' }];
v6.sections[0].records[0].tips = [1, 2].map(number => ({
  title: `第 ${number} 题`, body: '', level: 'none', sourceHash: 'sample',
  blocks: [{ type: 'question', fileId: 'source', fileName: '习题.pdf', page: 1,
    crop: { x0: .06, x1: .95, y0: number / 10, y1: (number + 1) / 10 }, annotations: {} }]
}));
const restoredQuestions = context.normalizeBackup(v6);
assert.equal(restoredQuestions.files.length, 1);
assert.equal(restoredQuestions.sections[0].records[0].tips.length, 2);
assert.equal(restoredQuestions.sections[0].records[0].tips[0].blocks[0].fileId,
  restoredQuestions.sections[0].records[0].tips[1].blocks[0].fileId);
console.log('v1–v6 backups accepted; shared question source, crops and PDF annotations preserved.');
