/**
 * Pairing bot replies with the commands they answer. Generic: which commands can produce
 * a reply comes from the bot's dialect, as the `allowed` set of each match. Pure logic,
 * no Node APIs.
 */
import { windowsDateSeconds } from '#src/lib/dates.ts';
import { type ChatMessage, firstWord } from './commands.ts';
import { senderIdentity } from './senders.ts';

/** How a bot reply was paired with the command it answers (see CommandMatcher). */
export type MatchKind = 'dm' | 'reply' | 'user' | 'single';

/** A command message as the matcher keeps it. */
export type Command = ChatMessage & { ts: number | null; answered: boolean };

const idKey = (chat: string | null | undefined, id: number | null | undefined): string =>
  JSON.stringify([chat ?? null, id ?? null]);

/**
 * Pairs each bot reply with the user command it answers.
 *
 * In the DM with the bot the conversation is strictly sequential: the reply
 * answers the latest command. In a group, ordinary chat and other players'
 * commands interleave, so a reply is matched, in order of reliability, to:
 *   reply   the command it quotes ("In reply to")
 *   user    the oldest unanswered command, within `groupWindow`, from the display
 *           name known to be the @username the bot addresses
 *   single  the only unanswered command in the window from a display name not
 *           mapped to anyone
 * and is left unmatched otherwise: it still feeds the wiki, but no player state.
 * Only commands that can produce that kind of reply are considered (`allowed`, from
 * BotDialect.compatibleCommands). The display name -> @username map is fixed beforehand
 * by learnDisplayNames(); senders are senderIdentity()s.
 */
export class CommandMatcher {
  /** sender (senderIdentity: display name or opaque key) -> @username */
  readonly senderUser: Map<string | null, string>;
  /** chat -> latest command message in a DM */
  readonly lastDm = new Map<string | null, Command>();
  /** chat -> unanswered group commands */
  readonly pending = new Map<string | null, Command[]>();
  /** (chat, id) -> command message */
  readonly byId = new Map<string, Command>();
  /** Seconds, BotDialect.groupWindow. */
  readonly groupWindow: number;

  constructor(senderUser: ReadonlyMap<string | null, string>, groupWindow: number) {
    this.senderUser = new Map(senderUser);
    this.groupWindow = groupWindow;
  }

  command(msg: ChatMessage): void {
    const m: Command = { ...msg, ts: windowsDateSeconds(msg.date), answered: false };
    this.byId.set(idKey(m.chat, m.id), m);
    if (m.dm) this.lastDm.set(m.chat, m);
    else this.pendingOf(m.chat).push(m);
  }

  match(
    m: ChatMessage,
    player: string | null,
    allowed: ReadonlySet<string> | null = null
  ): [Command | null, MatchKind | null] {
    if (m.dm) return [this.lastDm.get(m.chat) ?? null, 'dm'];
    const quoted = this.byId.get(idKey(m.chat, m.reply_to));
    if (quoted !== undefined) return [this.take(quoted), 'reply'];
    const ts = windowsDateSeconds(m.date);
    let live = this.pendingOf(m.chat).filter(
      (c) =>
        !c.answered &&
        ts !== null &&
        c.ts !== null &&
        0 <= ts - c.ts &&
        ts - c.ts <= this.groupWindow &&
        (allowed === null || allowed.has(firstWord(c.text)))
    );
    if (player) {
      const mine = live.find((c) => this.senderUser.get(senderIdentity(c)) === player);
      if (mine) return [this.take(mine), 'user'];
      // The player's own commands are known, and none fits.
      if ([...this.senderUser.values()].includes(player)) return [null, null];
      live = live.filter((c) => !this.senderUser.has(senderIdentity(c)));
    }
    if (live.length === 1) return [this.take(live[0] as Command), 'single'];
    return [null, null];
  }

  private pendingOf(chat: string | null): Command[] {
    let p = this.pending.get(chat);
    if (p === undefined) this.pending.set(chat, (p = []));
    return p;
  }

  private take(c: Command): Command {
    c.answered = true;
    return c;
  }
}
