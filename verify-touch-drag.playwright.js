async page => {
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
  const mobile = await context.newPage();
  try {
    await mobile.goto('http://127.0.0.1:4180/');
    for (const title of ['A', 'B', 'C']) {
      await mobile.locator('#add-section').click();
      await mobile.locator('#section-name').fill(title);
      await mobile.locator('#save-section').click();
    }
    const first = await mobile.locator('#sections [data-section]').first().boundingBox();
    const third = await mobile.locator('#sections [data-section]').last().boundingBox();
    const from = { x: first.x + first.width / 2, y: first.y + first.height / 2 };
    const to = { x: third.x + third.width * .8, y: third.y + third.height / 2 };
    const cdp = await context.newCDPSession(mobile);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await mobile.waitForTimeout(520);
    if (!(await mobile.locator('#drag-trash').isVisible())) throw new Error('Touch long press did not start dragging');
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const names = (await mobile.locator('#sections [data-section] strong').allTextContents()).map(text => text.trim());
    if (JSON.stringify(names) !== JSON.stringify(['B', 'C', 'A'])) throw new Error(`Mobile drag order: ${names.join(',')}`);
    const next = await mobile.locator('#sections [data-section]').first().boundingBox();
    const secondStart = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [secondStart] });
    await mobile.waitForTimeout(520);
    const trash = await mobile.locator('#drag-trash').boundingBox();
    if (!trash) throw new Error('Touch delete zone did not appear');
    const trashPoint = { x: trash.x + trash.width / 2, y: trash.y + trash.height / 2 };
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: secondStart.x + (trashPoint.x - secondStart.x) * step / 8, y: secondStart.y + (trashPoint.y - secondStart.y) * step / 8 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterTrash = (await mobile.locator('#sections [data-section] strong').allTextContents()).map(text => text.trim());
    if (JSON.stringify(afterTrash) !== JSON.stringify(['C', 'A'])) throw new Error(`Mobile trash: ${afterTrash.join(',')}`);
    await mobile.locator('#undo-delete').click();
    await mobile.reload();
    const persisted = (await mobile.locator('#sections [data-section] strong').allTextContents()).map(text => text.trim());
    if (JSON.stringify(persisted) !== JSON.stringify(['B', 'C', 'A'])) throw new Error(`Mobile drag not persisted: ${persisted.join(',')}`);
  } finally {
    await context.close();
  }
}
