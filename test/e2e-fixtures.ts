/**
 * The synthetic inbox of the end-to-end and repeatability tests, also used by
 * test/synthetic-exports.ts. The group export is a folder (zip input is not read). No
 * vitest imports here.
 */
import * as path from 'node:path';
import { BOT, Chat, writeExport } from './helpers.ts';
import * as T from './texts.ts';

export const BOSCO = 'nel bosco nebbioso di Valtorbo 🌲';
export const PIANURA = 'nella valle ventosa 🏞';
export const MONTE = 'ai piedi del monte Grevolo ⛰';
export const FONDALE = 'sul banco corallino 🐠';
export const GROUP = 'Gruppo Avventurieri';

export function dmChat(): Chat {
  const dm = new Chat(BOT, 341000);
  const me = 'Daniele';
  const steps: [number, string, string][] = [
    [0, '/faq', T.FAQ],
    [10, '/viaggio', T.where(BOSCO, [PIANURA])],
    [
      20,
      '/inventario',
      T.inventory([
        ['un sasso', 'C', 1],
        ['una trave', 'N', 1],
        ['un nastro da pacchi', 'C', 1],
      ]),
    ],
    [30, '/avventura', T.drop('nel bosco trovi un sasso', 'C')],
    [40, '/avventura', T.drop("nel bosco trovi una ghianda d'oro", 'C+')],
    [
      50,
      '/ricetta',
      T.recipeList([
        ['Torre', 1, 0],
        ['Pratica cestina', 2, 1],
      ]),
    ],
    [
      60,
      '/ricetta cestina',
      T.detail(
        'Pratica cestina',
        [['un paio di mollette', 'N', 1]],
        [['un nastro da pacchi', 'C', 1]]
      ),
    ],
    [
      70,
      '/ricetta torre',
      T.craft(
        [
          ['un sasso', 'C', 2],
          ['una trave', 'N', 1],
        ],
        'una torre'
      ),
    ],
    [80, '/viaggio valle', T.travel(PIANURA, [BOSCO, MONTE])],
    [90, '/esamina torre', T.info('una torre', 'L1', { count: 1, source: 'Torre' })],
  ];
  for (const [t, cmd, reply] of steps) {
    dm.user(me, cmd, t);
    dm.bot(reply, t + 1);
  }
  dm.bot(T.gift(1, 'un bottone', 'luigi'), 92); // joined to the previous bot message, first on page 2
  return dm;
}

export function groupChat(): Chat {
  const g = new Chat(GROUP, 88000);
  g.user('Mario', 'ciao a tutti', 200);
  g.user('Mario', '/start@AltroBot', 201);
  g.user('Luigi', '/avventura', 210);
  g.bot(T.drop('nel bosco trovi un sasso', 'C', 'luigi'), 212);
  g.user('Luigi', '/viaggio monte', 220);
  g.bot(T.travel(MONTE, [PIANURA, FONDALE], 'luigi'), 222);
  g.user('Luigi', '/viaggio banco', 230);
  g.bot(T.blocked(FONDALE, 'luigi'), 232);
  g.user('Daniele', '/dai@InventoryBot 1 bottone @luigi', 240);
  g.bot(T.give(1, 'un bottone', 'luigi'), 242);
  g.user('Luigi', '/dai 2 sasso @djjeck', 250);
  g.bot(T.give(2, 'un sasso', 'djjeck', 'luigi'), 252);
  g.bot('[W] ' + T.drop('nel bosco trovi un fungo', 'C', 'luigi'), 260);
  g.forward('Mario', BOT, T.inventory([['un diamante', 'S', 1]], 'mario'), 265);
  const cmd = g.user('Daniele', '/avventura', 270);
  g.user('Mario', '/avventura', 271);
  g.bot(T.drop('nel bosco trovi un fiore di pianura', 'N+'), 280, { reply_to: cmd.id });
  return g;
}

/** The DM export (two pages, the second starting with a joined message) and the group export. */
export function writeInbox(root: string): string {
  const dm = dmChat();
  writeExport(
    path.join(root, 'ChatExport_2026-10-17'),
    BOT,
    [dm.messages.slice(0, -1), dm.messages.slice(-1)],
    new Set([2])
  );
  writeExport(path.join(root, 'gruppo-amici', 'ChatExport_2026-10-20'), GROUP, [
    groupChat().messages,
  ]);
  return root;
}

/** The group export folder inside writeInbox()'s root. */
export const GROUP_EXPORT = 'gruppo-amici';

export const EXPECTED_INVENTORY = {
  'un nastro da pacchi': 1,
  "una ghianda d'oro": 1,
  'una torre': 1,
  'un sasso': 2,
  'un fiore di pianura': 1,
};
