/** Phases 2 and 3 joined with InventoryBot's dialect (pipeline.ts). */
import { describe, expect, it } from 'vitest';
import { BOT, Chat } from '#test/helpers.ts';
import { buildWiki, conversationReport, converse, interpret } from './pipeline.ts';

const SALT = 'test-salt';

/** The owner's DM and a group with another player. */
function messages() {
  const dm = new Chat(BOT, 100);
  dm.user('Daniele', '/inventario', 0);
  dm.bot('@djjeck, possiedi:\n- un sasso [C] x1', 1);
  const g = new Chat('Gruppo Avventurieri', 500);
  g.user('Luigi Verdi', '/inventario', 10);
  g.bot('@luigi, possiedi:\n- un sasso [C] x1', 11);
  return [...dm.clean(), ...g.clean()];
}

describe('converse', () => {
  it('owner_from_the_dm_kept_and_the_others_anonymised', () => {
    const c = converse(messages(), { player: null, salt: SALT });
    expect(c.owner).toBe('djjeck');
    expect(c.ownerMissing).toBe(false);
    const [mine, theirs] = c.conversation.replies.map((r) => r.context);
    expect(mine?.player).toBe('djjeck');
    expect(theirs?.player).not.toBe('luigi');
    expect(theirs?.chat).toBe(c.chatTitle('Gruppo Avventurieri'));
    expect(theirs?.chat).toMatch(/^Gruppo [A-Z][a-z]+[A-Z][a-z]+$/u);
    expect(JSON.stringify(c.conversation)).not.toMatch(/luigi|avventurieri|daniele/iu);
  });

  it('a_given_username_wins_over_the_dm', () => {
    const c = converse(messages(), { player: 'luigi', salt: SALT });
    expect(c.owner).toBe('luigi');
    expect(c.conversation.replies.map((r) => r.context.player)).toContain('luigi');
    expect(c.conversation.replies.map((r) => r.context.player)).not.toContain('djjeck');
  });

  it('without_a_dm_the_username_must_be_given', () => {
    const groupOnly = messages().filter((m) => !m.dm);
    expect(converse(groupOnly, { player: null, salt: SALT }).ownerMissing).toBe(true);
    expect(converse(groupOnly, { player: 'luigi', salt: SALT }).ownerMissing).toBe(false);
  });

  it('report_lines', () => {
    const c = converse(messages(), { player: null, salt: SALT });
    const group = c.chatTitle('Gruppo Avventurieri');
    expect(conversationReport(c)).toStrictEqual([
      'giocatore: @djjeck',
      'risposte del bot: 2',
      `  ${BOT}: risposte del bot abbinate a un comando: dm=1`,
      `  ${group}: risposte del bot abbinate a un comando: single=1`,
      'nomi visualizzati abbinati a un giocatore: 1; titoli dei giocatori riconosciuti: 0',
    ]);
    const unknown = converse(
      messages().filter((m) => !m.dm),
      { player: null, salt: SALT }
    );
    expect(conversationReport(unknown)[0]).toBe('giocatore: sconosciuto');
  });

  it('phases_4_and_5_after_the_conversation', () => {
    const c = converse(messages(), { player: null, salt: SALT });
    const { events, report } = interpret(c);
    expect(report).toStrictEqual([
      'eventi: inventory=2',
      '  coppie nei gruppi verificate dalla risposta: confermate=1, sciolte=0',
    ]);
    const before = JSON.stringify(events);
    const built = buildWiki(events, c.owner);
    // build() annotates its input: phase 4's events are left as they were.
    expect(JSON.stringify(events)).toBe(before);
    expect(Object.keys(built.wiki.items)).toStrictEqual(['un sasso']);
    expect(built.player.inventory['un sasso']?.qty).toBe(1);
    expect(built.report[0]).toBe(
      'oggetti: 1; ricette: 0 (con tutti gli ingredienti: 0, con il risultato noto: 0); luoghi: 0'
    );
  });
});
