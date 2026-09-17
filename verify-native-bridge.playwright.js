async page => {
  const context = await page.context().browser().newContext({ viewport: { width: 393, height: 852 } });
  await context.addInitScript(() => {
    window.__nativeSaves = [];
    window.BubbleNative = { saveFile: (name, type, data) => {
      window.__nativeSaves.push({ name, type, prefix: atob(data).slice(0, 16) });
    } };
  });
  const mobile = await context.newPage();
  try {
    await mobile.goto('http://127.0.0.1:4187/');
    await mobile.locator('#add-section').click();
    await mobile.locator('#section-name').fill('数学');
    await mobile.locator('#save-section').click();
    await mobile.locator('#sections [data-section]').click();
    await mobile.locator('#add-record').click();
    await mobile.locator('#record-title').fill('测试');
    await mobile.locator('#record-body').fill('离线记录');
    await mobile.locator('#export-record-pdf').click();
    await mobile.waitForFunction(() => window.__nativeSaves.length === 1);
    const pdf = await mobile.evaluate(() => window.__nativeSaves[0]);
    if (pdf.type !== 'application/pdf' || !pdf.prefix.startsWith('%PDF-')) throw new Error('Native PDF export failed');
    await mobile.locator('#open-backup').click();
    await mobile.locator('#export-backup').click();
    await mobile.waitForFunction(() => window.__nativeSaves.length === 2);
    const backup = await mobile.evaluate(() => window.__nativeSaves[1]);
    if (backup.type !== 'application/json' || !backup.prefix.startsWith('{"format"')) throw new Error('Native backup export failed');
    const back = await mobile.evaluate(() => window.BubbleBack());
    if (!back || !(await mobile.locator('#backup-modal').isHidden())) throw new Error('Native back button failed');
  } finally { await context.close(); }
}
