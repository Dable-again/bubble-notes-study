async page => {
  const names = async selector => (await page.locator(selector).allTextContents()).map(text => text.trim().split(/\s/)[0]);
  const same = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  };
  const holdAndDrop = async (source, destination) => {
    const from = await source.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    if (await source.getAttribute('data-record')) await page.mouse.move(from.x + from.width / 2 + 16, from.y + from.height / 2, { steps: 3 });
    const to = await destination();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  const onRight = async locator => {
    const rect = await locator.boundingBox();
    return { x: rect.x + rect.width * .78, y: rect.y + rect.height / 2 };
  };
  const toTrash = async () => {
    const rect = await page.locator('#drag-trash').boundingBox();
    if (!rect) throw new Error('Delete zone did not appear on long press');
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };

  for (const title of ['A', 'B', 'C']) {
    await page.locator('#add-section').click();
    await page.locator('#section-name').fill(title);
    await page.locator('#save-section').click();
  }
  same(await names('#sections [data-section] strong'), ['A', 'B', 'C'], 'Initial sections');
  await holdAndDrop(page.locator('#sections [data-section]').first(), () => onRight(page.locator('#sections [data-section]').last()));
  same(await names('#sections [data-section] strong'), ['B', 'C', 'A'], 'Section drag');
  await page.locator('#sections [data-section]').first().click();

  for (const title of ['R1', 'R2']) {
    await page.locator('#add-record').click();
    await page.locator('#record-title').fill(title);
    await page.locator('#back-zone').click();
  }
  same(await names('#records .record-name'), ['R1', 'R2'], 'Initial records');
  await holdAndDrop(page.locator('#records [data-record]').first(), () => onRight(page.locator('#records [data-record]').last()));
  same(await names('#records .record-name'), ['R2', 'R1'], 'Record drag');
  await page.locator('#records [data-record]').first().click();

  for (const title of ['T1', 'T2']) {
    await page.locator('#add-tip').click();
    await page.locator('#tip-title').fill(title);
    await page.locator('#save-tip').click();
  }
  const tipNames = async () => (await page.locator('#tips [data-tip]').all()).map(async tile => tile.getAttribute('aria-label'));
  const tipLabels = async () => Promise.all(await tipNames());
  same((await tipLabels()).map(label => label.split('：')[1]), ['T1', 'T2'], 'Initial tips');
  await holdAndDrop(page.locator('#tips [data-tip]').first(), () => onRight(page.locator('#tips [data-tip]').last()));
  same((await tipLabels()).map(label => label.split('：')[1]), ['T2', 'T1'], 'Tip drag');
  await holdAndDrop(page.locator('#tips [data-tip]').first(), toTrash);
  same((await tipLabels()).map(label => label.split('：')[1]), ['T1'], 'Tip trash');
  await page.locator('#undo-delete').click();
  same((await tipLabels()).map(label => label.split('：')[1]), ['T2', 'T1'], 'Undo delete');

  await page.locator('#back-zone').click();
  await holdAndDrop(page.locator('#records [data-record]').last(), toTrash);
  same(await names('#records .record-name'), ['R2'], 'Record trash');
  await page.locator('#undo-delete').click();
  same(await names('#records .record-name'), ['R2', 'R1'], 'Undo record delete');
  await page.locator('#back-home').click();
  await holdAndDrop(page.locator('#sections [data-section]').nth(1), toTrash);
  same(await names('#sections [data-section] strong'), ['B', 'A'], 'Section trash');
  await page.locator('#undo-delete').click();
  same(await names('#sections [data-section] strong'), ['B', 'C', 'A'], 'Undo section delete');

  await page.reload();
  same(await names('#sections [data-section] strong'), ['B', 'C', 'A'], 'Persisted sections');
  await page.locator('#sections [data-section]').first().click();
  same(await names('#records .record-name'), ['R2', 'R1'], 'Persisted records');
  await page.locator('#records [data-record]').first().click();
  same((await tipLabels()).map(label => label.split('：')[1]), ['T2', 'T1'], 'Persisted tips');
  console.log('Long press drag, trash, undo, and persistence passed for sections, records, and tips.');
}
