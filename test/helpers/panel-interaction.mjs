export function inspectPanelHandles() {
  return [...document.querySelectorAll('.pc-ru-resize-handle')].flatMap(handle => {
    const rect = handle.getBoundingClientRect();
    if (handle.hidden || rect.height <= 40 || rect.width <= 0) return [];
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(rect.height / 2, 200);
    const hit = document.elementFromPoint(x, y);
    return [{ kind: handle.getAttribute('data-pc-ru-for'), x, y,
      reachable: getComputedStyle(handle).pointerEvents !== 'none' && (hit === handle || handle.contains(hit)) }];
  });
}

export async function reachablePanelHandleCount(page) {
  return (await page.evaluate(inspectPanelHandles)).filter(handle => handle.reachable).length;
}

export async function tryOpenRightPanel(page, names) {
  for (const name of names) {
    const loc = page.getByRole('button', { name }).first();
    if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(450);
    if (await reachablePanelHandleCount(page) > 0) return true;
    // A background panel can finish mounting while New task opens a modal.
    // Its fixed handle has geometry but inherits the modal's pointer-events
    // block. Dismiss this unsuccessful probe before using any underlying panel.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== 'none', null, { timeout: 4000 });
    if (await reachablePanelHandleCount(page) > 0) return true;
  }
  return false;
}
