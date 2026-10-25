/** The example (demo.ts): what the pipeline makes of it, and how the worker keeps it. */
import { describe, expect, it } from 'vitest';
import { runPipeline } from '#src/pipeline.ts';
import { fileLike } from '#test/browser-picks.ts';
import { BOT, Chat, pageHtml } from '#test/helpers.ts';
import { startHarness, WORKER_OPTIONS, WORKER_SALT } from '#test/web-worker.ts';
import { DEMO_FOLDER, DEMO_PLAYER, demoFiles, demoMessages, demoPage } from './demo.ts';
import { readPicks } from './run.ts';

async function demoRun() {
  const { paths } = await readPicks([demoFiles()]);
  const run = await runPipeline(paths, { ...WORKER_OPTIONS, salt: WORKER_SALT });
  if (run.status !== 'done') throw new Error(run.status);
  return run;
}

describe('the example', () => {
  it('is_the_same_export_at_every_call', () => {
    expect(demoPage()).toBe(demoPage());
    expect(demoFiles().map((f) => f.webkitRelativePath)).toStrictEqual([
      `${DEMO_FOLDER}/messages.html`,
    ]);
  });

  it('keeps_the_adventure_cooldown', () => {
    const seconds = (time: string): number =>
      time.split(':').reduce((n, part) => n * 60 + Number(part), 0);
    const adventures = demoMessages()
      .filter((m) => m.text === '/avventura')
      .map((m) => seconds(m.time));
    for (let i = 1; i < adventures.length; i++)
      expect((adventures[i] ?? 0) - (adventures[i - 1] ?? 0)).toBeGreaterThanOrEqual(15 * 60);
  });

  it('is_read_whole_as_the_private_chat_of_its_player', async () => {
    const run = await demoRun();
    expect(run.conversed.owner).toBe(DEMO_PLAYER);
    // Every reply of the bot answers a command and is understood.
    const fromBot = demoMessages().filter((m) => m.fromBot).length;
    expect(run.conversed.conversation.replies).toHaveLength(fromBot);
    expect(run.events).toHaveLength(fromBot);
    expect(run.events.filter((e) => ['unknown', 'miss'].includes(e.type))).toStrictEqual([]);
  });

  it('is_a_new_player_on_a_short_road', async () => {
    const { wiki, player } = await demoRun();
    const visited = Object.values(wiki.locations).filter((p) => player.locations[p.name]?.visited);
    // The village, a road and the plain.
    expect(visited).toHaveLength(3);
    // Nothing tells which item opens a place.
    expect(Object.values(wiki.locations).flatMap((p) => p.required_items)).toStrictEqual([]);
    // One each of a few common items; every recipe seen, one ready, none made.
    expect(Object.values(wiki.items).every((i) => i.rarity === 'C')).toBe(true);
    expect(Object.values(player.inventory).every((h) => h.qty === 1)).toBe(true);
    expect(Object.keys(wiki.recipes)).toHaveLength(4);
    expect(
      Object.values(player.recipe_list?.recipes ?? {}).filter((s) => s === 'pronta')
    ).toHaveLength(1);
    expect(Object.values(player.recipes).filter((r) => r.crafted > 0)).toStrictEqual([]);
    // The inventory estimate agrees with every recipe the bot listed.
    expect(player.inventory_check.compared).toBe(4);
    expect(player.inventory_check.agreed).toBe(4);
  });
});

describe('the example in the worker', () => {
  it('builds_the_wiki_of_its_player', async () => {
    const h = await startHarness();
    await h.send({ type: 'demo' });
    expect(h.exports().map((e) => [e.folder, e.status])).toStrictEqual([[DEMO_FOLDER, 'ready']]);
    expect(h.last().owner).toBe(DEMO_PLAYER);
  });

  it('makes_way_for_the_players_own_export', async () => {
    const h = await startHarness();
    await h.send({ type: 'demo' });
    const own = new Chat(BOT);
    own.user('Mario', '/avventura', 0);
    own.bot('@mario_r, nel bosco trovi un sasso [C]!', 1);
    await h.add([fileLike('ChatExport/messages.html', pageHtml(BOT, own.messages))]);
    expect(h.exports().map((e) => e.folder)).toStrictEqual(['ChatExport']);
    expect(h.last().owner).toBe('mario_r');
    expect(h.last().folders).toStrictEqual(['ChatExport']);
  });

  it('makes_way_without_storage_too', async () => {
    const h = await startHarness(null);
    await h.send({ type: 'demo' });
    const own = new Chat(BOT);
    own.user('Mario', '/avventura', 0);
    own.bot('@mario_r, nel bosco trovi un sasso [C]!', 1);
    await h.add([fileLike('ChatExport/messages.html', pageHtml(BOT, own.messages))]);
    expect(h.exports().map((e) => e.folder)).toStrictEqual(['ChatExport']);
    expect(h.last().owner).toBe('mario_r');
  });

  it('added_again_changes_nothing', async () => {
    const h = await startHarness();
    await h.send({ type: 'demo' });
    const builds = h.results().length;
    await h.send({ type: 'demo' });
    expect(h.exports()).toHaveLength(1);
    expect(h.results()).toHaveLength(builds);
  });
});
