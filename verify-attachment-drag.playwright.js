async page => {
  const same = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  };
  const names = () => page.locator('#attachments .attachment-name').allTextContents();
  const waitNames = async expected => {
    await page.waitForFunction(expectedNames => JSON.stringify([...document.querySelectorAll('#attachments .attachment-name')].map(node => node.textContent)) === JSON.stringify(expectedNames), expected);
  };
  const drag = async (source, target) => {
    const first = await source.boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(520);
    const destination = await target();
    await page.mouse.move(destination.x, destination.y, { steps: 8 });
    await page.mouse.up();
  };
  await page.locator('#add-section').click();
  await page.locator('#section-name').fill('数学');
  await page.locator('#save-section').click();
  await page.locator('#sections [data-section]').click();
  await page.locator('#add-record').click();
  await page.locator('#record-title').fill('图片');
  await page.locator('.attachment-dock summary').click();
  await page.locator('#image-file').setInputFiles(['dist/icon-192.png', 'dist/icon-512.png']);
  await page.locator('#attachments [data-attachment]').nth(1).waitFor();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  same(await names(), ['icon-192.png', 'icon-512.png'], 'Initial attachments');
  await drag(page.locator('#attachments [data-attachment]').first(), async () => {
    const rect = await page.locator('#attachments [data-attachment]').last().boundingBox();
    return { x: rect.x + rect.width * .8, y: rect.y + rect.height / 2 };
  });
  await waitNames(['icon-512.png', 'icon-192.png']);
  same(await names(), ['icon-512.png', 'icon-192.png'], 'Attachment order');
  await drag(page.locator('#attachments [data-attachment]').first(), async () => {
    const rect = await page.locator('#drag-trash').boundingBox();
    if (!rect) throw new Error('Delete zone missing');
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await waitNames(['icon-192.png']);
  same(await names(), ['icon-192.png'], 'Attachment delete');
  await page.locator('#undo-delete').click();
  await waitNames(['icon-512.png', 'icon-192.png']);
  same(await names(), ['icon-512.png', 'icon-192.png'], 'Attachment undo');
  await page.reload();
  await page.locator('#sections [data-section]').click();
  await page.locator('#records [data-record]').click();
  await page.locator('.attachment-dock summary').click();
  await page.locator('#attachments [data-attachment]').nth(1).waitFor();
  same(await names(), ['icon-512.png', 'icon-192.png'], 'Attachment persistence');
}
