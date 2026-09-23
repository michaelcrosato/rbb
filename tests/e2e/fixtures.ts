import { test as base, expect } from '@playwright/test';
import type { BrowserContext, BrowserContextOptions } from '@playwright/test';

function observeContext(context: BrowserContext, errors: string[]): void {
  context.on('weberror', (event) => errors.push(event.error().message));
  context.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /GL_INVALID|WebGL:|cannot be cloned|Feedback loop/i.test(message.text())
    )
      errors.push(message.text());
  });
}

/** Chromium on Windows implements pointer lock with the global Win32 ClipCursor over the
 * page's on-screen rectangle. A headless page still sits near screen (0,0), so a granted lock
 * traps the developer's real mouse cursor in an invisible box until focus changes. Windows runs
 * refuse the lock as a declining browser would; the game falls back to drag-to-look and aimAt()
 * to clamped right-drags. Never fake a granted lock: aimAt() would then send unclamped moves
 * past the viewport edge, which never reach the page. Linux/CI keep real pointer lock. */
async function refusePointerLockOnWindows(context: BrowserContext): Promise<void> {
  if (process.platform !== 'win32') return;
  await context.addInitScript(() => {
    Element.prototype.requestPointerLock = function () {
      queueMicrotask(() => document.dispatchEvent(new Event('pointerlockerror')));
      return Promise.reject(
        new DOMException('Pointer lock is disabled in Windows e2e runs', 'NotSupportedError'),
      );
    };
  });
}

/** Covers every page, including reloads, popups and separately created survivors.
 * Multiplayer tests use newContext so closed contexts retain their error evidence. */
export const test = base.extend<{
  browserErrors: string[];
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}>({
  context: async ({ context }, use) => {
    await refusePointerLockOnWindows(context);
    await use(context);
  },
  browserErrors: [
    async ({ context }, use, testInfo) => {
      const errors: string[] = [];
      observeContext(context, errors);
      await use(errors);
      if (errors.length)
        await testInfo.attach('browser-errors', {
          body: errors.join('\n'),
          contentType: 'text/plain',
        });
      expect(errors, 'Browser exceptions, console errors and WebGL validation messages').toEqual(
        [],
      );
    },
    { auto: true },
  ],
  newContext: async ({ browser, browserErrors }, use) => {
    await use(async (options) => {
      const context = await browser.newContext(options);
      await refusePointerLockOnWindows(context);
      observeContext(context, browserErrors);
      return context;
    });
  },
});
export { expect } from '@playwright/test';
