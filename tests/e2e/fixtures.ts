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

/** Covers every page, including reloads, popups and separately created survivors.
 * Multiplayer tests use newContext so closed contexts retain their error evidence. */
export const test = base.extend<{
  browserErrors: string[];
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}>({
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
      observeContext(context, browserErrors);
      return context;
    });
  },
});
export { expect } from '@playwright/test';
