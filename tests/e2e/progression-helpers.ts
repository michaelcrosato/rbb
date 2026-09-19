import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {
  BuildingKind,
  Inventory,
  RecipeId,
  RecipeDefinition,
  ItemId,
} from '../../src/shared/content';
import { RECIPES } from '../../src/shared/content';
import type { Building } from '../../src/shared/state';
import { aimAt, diagnostics } from './helpers';
import { encodeSave } from '../../src/shared/save';
import type { GameState } from '../../src/shared/state';

/** Public save import seeds advanced scenarios; gameplay still uses real controls. */
export async function importExpedition(page: Page, state: GameState, touch = false): Promise<void> {
  const activate = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true });
    if (touch) await button.tap();
    else await button.click();
  };
  if (touch) await activate('Pause');
  else await page.keyboard.press('Escape');
  await activate('Field guide');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import solo save', exact: false }).click();
  await (
    await chooser
  ).setFiles({
    name: 'playtest.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeSave(state, 'local')),
  });
  await expect.poll(async () => (await diagnostics(page)).panel).toBe(null);
  await expect
    .poll(async () => (await diagnostics(page)).player.inventory)
    .toEqual(state.players.local.inventory);
}

export function observeProgressionErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /GL_INVALID|WebGL:/.test(message.text()))
      errors.push(message.text());
  });
  return errors;
}
export async function inspector(page: Page): Promise<void> {
  if ((await diagnostics(page)).panel !== 'developer') await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
}
/** Visible developer controls seed advanced playtests; no writable page hooks. */
export async function travel(page: Page, x: number, z: number): Promise<void> {
  await inspector(page);
  await page.locator('#dev-x').fill(String(x));
  await page.locator('#dev-z').fill(String(z));
  await page.getByRole('button', { name: 'Teleport', exact: true }).click();
  await expect
    .poll(async () =>
      Math.hypot(
        (await diagnostics(page)).player.position.x - x,
        (await diagnostics(page)).player.position.z - z,
      ),
    )
    .toBeLessThan(0.1);
  await page.getByRole('button', { name: 'Close panel' }).click();
}
export async function grantMaterials(page: Page, inventory: Inventory): Promise<void> {
  await inspector(page);
  for (const [item, quantity] of Object.entries(inventory)) {
    let remaining = quantity;
    while (remaining > 0) {
      const count = Math.min(100, remaining),
        before = (await diagnostics(page)).player.inventory[item as ItemId] ?? 0;
      await page.locator('#dev-item').selectOption(item);
      await page.locator('#dev-amount').fill(String(count));
      await page.getByRole('button', { name: 'Grant item', exact: true }).click();
      await expect
        .poll(async () => (await diagnostics(page)).player.inventory[item as ItemId])
        .toBe(before + count);
      remaining -= count;
    }
  }
  await page.getByRole('button', { name: 'Close panel' }).click();
}
export async function placePiece(
  page: Page,
  kind: BuildingKind,
  x: number,
  z: number,
  rotation = 0,
): Promise<Building> {
  const before = (await diagnostics(page)).buildings.map((b) => b.id);
  await page.keyboard.press('KeyB');
  await page.locator(`[data-action="select-build"][data-value="${kind}"]`).click();
  const p = (await diagnostics(page)).player;
  await aimAt(page, x, p.position.y + 1.65, z);
  for (let i = 0; i < rotation; i++) await page.keyboard.press('KeyR');
  await expect(page.locator('#build-hint')).not.toHaveClass(/invalid/);
  await expect.poll(async () => (await diagnostics(page)).player.cooldown).toBe(0);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).buildings.length).toBe(before.length + 1);
  await page.keyboard.press('KeyB');
  return (await diagnostics(page)).buildings.find((b) => !before.includes(b.id))!;
}
export async function inspectPiece(page: Page, b: Building): Promise<void> {
  await aimAt(
    page,
    b.x,
    b.y +
      (b.kind === 'door'
        ? 1.1
        : b.kind === 'doorway' || b.kind === 'wall' || b.kind === 'window'
          ? 2.7
          : 0.5),
    b.z,
  );
  await expect.poll(async () => (await diagnostics(page)).target).toBe(b.id);
  await expect.poll(async () => (await diagnostics(page)).player.cooldown).toBe(0);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).panel).toBe('structure');
}
export async function craftRecipe(page: Page, id: RecipeId, count = 1): Promise<void> {
  if ((await diagnostics(page)).panel !== 'inventory') await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const recipe: RecipeDefinition = RECIPES[id];
  const output = Object.keys(recipe.output)[0] as ItemId;
  const before = (await diagnostics(page)).player.inventory[output] ?? 0;
  await page.locator(`#craft-count-${id}`).fill(String(count));
  await page.locator(`[data-action="craft"][data-value="${id}"]`).click();
  await expect
    .poll(async () => (await diagnostics(page)).player.inventory[output])
    .toBe(before + recipe.output[output]! * count);
}
