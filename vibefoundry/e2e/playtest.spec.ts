import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'docs/screenshots';

async function frames(page: Page, n = 30) {
  await page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise(requestAnimationFrame);
  }, n);
}

async function shot(page: Page, name: string) {
  await frames(page, 20);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('autoplay: first 20 minutes, milestones and screenshots', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__vf?.ready);
  await shot(page, '00-main-menu');
  // start a new game through the UI
  await page.getByRole('button', { name: 'Новая игра' }).click();
  const seedInput = page.locator('input.mono').first();
  await seedInput.fill('20260926');
  await page.getByRole('button', { name: 'Высадиться на остров' }).click();
  await page.waitForFunction(() => !(window as any).__vf.game.ui.mainMenu);
  await page.evaluate(() => {
    const v = (window as any).__vf;
    v.sim.settings.hallucinations = false;
    v.setTime(0.3);
  });
  await shot(page, '01-start');

  // play 20 game minutes with the bot, checking milestones on the way
  const milestones: Record<number, string[]> = {};
  for (let m = 2; m <= 20; m += 2) {
    const r = await page.evaluate(() => (window as any).__vf.bot(120));
    milestones[m] = r.quests;
  }
  const final = await page.evaluate(() => {
    const v = (window as any).__vf;
    return { ...v.state(), log: v.bot(0).log };
  });
  console.log('BOT LOG\n' + final.log.join('\n'));
  console.log('MILESTONES', JSON.stringify(milestones));
  for (const q of ['q_drill', 'q_belt', 'q_smelt', 'q_copper', 'q_gears', 'q_power', 'q_vibe', 'q_lab', 'q_research']) expect(final.quests).toContain(q);
  expect(final.research.length).toBeGreaterThanOrEqual(3);
  expect(final.commits).toBeGreaterThanOrEqual(2);

  // factory by day and by night
  await page.evaluate(() => {
    const v = (window as any).__vf;
    const b = v.base();
    v.setTime(0.35);
    v.camera(b.x - 14, b.y - 3, 1.05);
    v.game.ui.toasts = [];
    v.game.emit();
  });
  await shot(page, '02-factory-day');
  await page.evaluate(() => (window as any).__vf.setTime(0.84));
  await shot(page, '03-factory-night');
  await page.evaluate(() => {
    const v = (window as any).__vf;
    v.setTime(0.4);
    v.panel('map');
  });
  await shot(page, '04-strategic-map');
  // vibe panel with a fresh proposal for the reference request
  await page.evaluate(() => {
    const v = (window as any).__vf;
    v.panel(null);
    v.sim.ai.tokens += 500;
    v.game.ui.panel = 'vibe';
    v.game.emit();
  });
  const box = page.locator('.composer textarea');
  await box.fill('Сделай так, чтобы медная руда автоматически доставлялась на переработку, приоритет отдавался аккумуляторам, а если энергии не хватает — временно отключай производство микросхем.');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.evaluate(() => (window as any).__vf.run(6));
  await expect(page.locator('.code').first()).toContainText('class CopperRouter(Agent):');
  await shot(page, '05-vibe-panel');
  await page.getByRole('button', { name: 'Принять' }).click();
  await expect(page.locator('.gitrow').first()).toContainText('v1.2');
  await page.evaluate(() => (window as any).__vf.run(2));

  // demo scenario: the rest of the key screens
  await page.evaluate(() => (window as any).__vf.demo());
  await page.evaluate(() => {
    const v = (window as any).__vf;
    v.game.ui.toasts = [];
    v.setTime(0.45);
    v.game.emit();
  });
  await shot(page, '06-demo-day');
  await page.evaluate(() => (window as any).__vf.panel('vibe'));
  await page.locator('.gitrow', { hasText: 'v1.3' }).click();
  await shot(page, '07-git-catastrophe');
  await page.evaluate(() => (window as any).__vf.panel('agents'));
  await shot(page, '08-agents');
  await page.evaluate(() => (window as any).__vf.panel('research'));
  await shot(page, '09-research-tree');
  await page.evaluate(() => {
    const v = (window as any).__vf;
    v.panel(null);
    v.setTime(0.82);
  });
  await shot(page, '10-demo-night');
  await page.evaluate(() => {
    const v = (window as any).__vf;
    v.setTime(0.4);
    v.panel('build');
  });
  await shot(page, '11-build-menu');
  await page.evaluate(() => (window as any).__vf.panel('stats'));
  await shot(page, '12-stats');
  // Debugger finds the planted bug within a few seconds of demo time
  await page.evaluate(() => {
    const v = (window as any).__vf;
    v.panel(null);
    v.run(12);
  });
  const found = await page.evaluate(() => (window as any).__vf.sim.flags.bugs.some((b: any) => b.found));
  expect(found).toBe(true);
  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
