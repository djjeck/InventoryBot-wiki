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

/**
 * A chat's group commands, in message order. Those before `start` can no longer answer a
 * reply that is not earlier than `latest`, the latest reply date seen: answered, undated,
 * or older than the window. Messages come sorted by date, so a reply is almost never
 * earlier than `latest`; when one is, the whole list is searched.
 */
type Pending = { commands: Command[]; start: number; latest: number };

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
  /** chat -> its group commands */
  private readonly pending = new Map<string | null, Pending>();
  /** (chat, id) -> command message */
  readonly byId = new Map<string, Command>();
  /** Seconds, BotDialect.groupWindow. */
  readonly groupWindow: number;
  /** The @usernames of senderUser. */
  private readonly mapped: ReadonlySet<string>;

  constructor(senderUser: ReadonlyMap<string | null, string>, groupWindow: number) {
    this.senderUser = new Map(senderUser);
    this.groupWindow = groupWindow;
    this.mapped = new Set(senderUser.values());
  }

  command(msg: ChatMessage): void {
    const m: Command = { ...msg, ts: windowsDateSeconds(msg.date), answered: false };
    this.byId.set(idKey(m.chat, m.id), m);
    if (m.dm) this.lastDm.set(m.chat, m);
    else this.pendingOf(m.chat).commands.push(m);
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
    if (ts === null) return this.choose([], player);
    const live: Command[] = [];
    const p = this.pendingOf(m.chat);
    for (let i = ts < p.latest ? 0 : this.advance(p, ts); i < p.commands.length; i++) {
      const c = p.commands[i] as Command;
      if (
        !c.answered &&
        c.ts !== null &&
        0 <= ts - c.ts &&
        ts - c.ts <= this.groupWindow &&
        (allowed === null || allowed.has(firstWord(c.text)))
      )
        live.push(c);
    }
    return this.choose(live, player);
  }

  /** The match among the live commands of a group reply to `player`. */
  private choose(candidates: Command[], player: string | null): [Command | null, MatchKind | null] {
    let live = candidates;
    if (player) {
      const mine = live.find((c) => this.senderUser.get(senderIdentity(c)) === player);
      if (mine) return [this.take(mine), 'user'];
      // The player's own commands are known, and none fits.
      if (this.mapped.has(player)) return [null, null];
      live = live.filter((c) => !this.senderUser.has(senderIdentity(c)));
    }
    if (live.length === 1) return [this.take(live[0] as Command), 'single'];
    return [null, null];
  }

  /** Moves `start` past the commands that cannot answer a reply at `ts` or later. */
  private advance(p: Pending, ts: number): number {
    p.latest = ts;
    for (; p.start < p.commands.length; p.start++) {
      const c = p.commands[p.start] as Command;
      if (!c.answered && c.ts !== null && ts - c.ts <= this.groupWindow) break;
    }
    return p.start;
  }

  private pendingOf(chat: string | null): Pending {
    let p = this.pending.get(chat);
    if (p === undefined)
      this.pending.set(chat, (p = { commands: [], start: 0, latest: -Infinity }));
    return p;
  }

  private take(c: Command): Command {
    c.answered = true;
    return c;
  }
}
