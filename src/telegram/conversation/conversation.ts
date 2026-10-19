/**
 * Phase 2: messages -> the bot's replies, each with the command it answers and the
 * player it concerns. Generic: the bot's name is a parameter and its wording comes from
 * its BotDialect. Pure logic, no Node APIs.
 *
 * Steps, in order: `/cmd@Bot` commands are resolved (resolveCommand); sender keys are
 * shared (shareSenderKeys); the owner's DM pair seeds the display name -> @username map;
 * reply texts are normalised by the dialect; the map is learned by voting
 * (learnDisplayNames); then, in message order, commands for the bot are queued and each
 * bot reply is paired with one (CommandMatcher), unless it is forwarded or a broadcast.
 * Everything else (ordinary chat, commands for other bots, forwarded commands) is dropped:
 * only the replies leave this phase.
 */
import { increment, mostCommon } from '#src/lib/counts.ts';
import { stripWs } from '#src/lib/text.ts';
import { type Message } from '#src/telegram/messages.ts';
import { type ChatMessage, isBotCommand, resolveCommand } from './commands.ts';
import { type BotDialect } from './dialect.ts';
import { type Command, CommandMatcher, type MatchKind } from './matcher.ts';
import { learnDisplayNames, senderIdentity, shareSenderKeys, unmappableNames } from './senders.ts';

/** Where and to what a bot reply answers; the same fields, in this order, close every event. */
export interface ReplyContext {
  chat: string | null;
  dm: boolean;
  /** Message id of the bot reply. */
  msg: number;
  date: string | null;
  /** The @username (without `@`) the reply concerns, if known. */
  player: string | null;
  /** The matched command, stripped (e.g. `/start now`); null when unmatched. */
  query: string | null;
  match: MatchKind | null;
  /** The reply was forwarded into the chat. */
  forwarded: boolean;
  /** A group broadcast (BotDialect.broadcast). */
  broadcast: boolean;
}

/** One bot message of the input, in message order. */
export interface BotReply {
  /** The reply as the dialect normalised it (and, for a broadcast, as BotDialect.broadcast returned it). */
  text: string;
  context: ReplyContext;
}

/** What phase 2 returns. */
export interface Conversation {
  /** Every bot message, in message order: what the next phases read. */
  replies: BotReply[];
  /**
   * Sender (senderIdentity) -> @username, the owner's DM pair included. For the report
   * only (its size).
   */
  senders: ReadonlyMap<string | null, string>;
}

/**
 * The owner's DM pair: the human side of the DM (the most frequent sender there) is the
 * @username the bot addresses most there. Read on the raw reply texts.
 */
function dmSeed(input: readonly ChatMessage[], dialect: BotDialect): Map<string | null, string> {
  const dmSender = new Map<string | null, number>();
  const dmPlayer = new Map<string, number>();
  for (const m of input) {
    if (!m.dm) continue;
    if (!m.from_bot) increment(dmSender, senderIdentity(m));
    else {
      const p = dialect.addressee(m.text);
      if (p) increment(dmPlayer, p);
    }
  }
  const seed = new Map<string | null, string>();
  if (dmSender.size > 0 && dmPlayer.size > 0) {
    seed.set(
      (mostCommon(dmSender)[0] as [string | null, number])[0],
      (mostCommon(dmPlayer)[0] as [string, number])[0]
    );
  }
  return seed;
}

/** Phase 2 on the messages of phase 1; `botName` is the bot of the run (BotIdentity.name). */
export function readConversation(
  messages: readonly Message[],
  botName: string,
  dialect: BotDialect
): Conversation {
  const commands = messages.map((m): ChatMessage => (m.from_bot ? m : resolveCommand(m, botName)));
  const input = shareSenderKeys(commands, unmappableNames(dialect));
  const seed = dmSeed(input, dialect);
  const msgs = input.map((m) => (m.from_bot ? { ...m, text: dialect.normalizeReply(m.text) } : m));
  const matcher = new CommandMatcher(learnDisplayNames(msgs, seed, dialect), dialect.groupWindow);

  const replies: BotReply[] = [];
  for (let m of msgs) {
    if (!m.from_bot) {
      // Keep only commands meant for this bot; ordinary chat is dropped here.
      if (isBotCommand(m) && !m.forwarded_from) matcher.command(m);
      continue;
    }
    // Posted in a group by the bot on its own, not an answer to a command there.
    const broadcast = m.dm ? null : dialect.broadcast(m.text);
    if (broadcast !== null && broadcast !== m.text) m = { ...m, text: broadcast };
    let player = dialect.addressee(m.text);
    let cmd: Command | null = null;
    let how: MatchKind | null = null;
    if (!(m.forwarded_from || broadcast !== null)) {
      // Not forwarded and not a broadcast: it happened here and now.
      [cmd, how] = matcher.match(m, player, dialect.compatibleCommands(m.text));
    }
    // An anonymous reply has no player, even when its command's sender is known.
    if (player === null && cmd !== null && !dialect.isAnonymous(m.text))
      player = matcher.senderUser.get(senderIdentity(cmd)) ?? null;
    replies.push({
      text: m.text,
      context: {
        chat: m.chat ?? null,
        dm: m.dm ?? false,
        msg: m.id,
        date: m.date,
        player,
        query: cmd ? stripWs(cmd.text) : null,
        match: how,
        forwarded: Boolean(m.forwarded_from),
        broadcast: broadcast !== null,
      },
    });
  }
  return { replies, senders: matcher.senderUser };
}

/**
 * The report lines on pairing: one per chat, how its replies (forwards and broadcasts
 * excluded) were paired, `unmatched` included, by count; chats and methods in first-seen
 * order. Read from the replies' contexts only.
 */
export function matchReportLines(replies: readonly BotReply[]): string[] {
  const matches = new Map<string | null, Map<MatchKind | 'unmatched', number>>();
  for (const { context } of replies) {
    if (context.forwarded || context.broadcast) continue;
    let c = matches.get(context.chat);
    if (c === undefined) matches.set(context.chat, (c = new Map()));
    increment(c, context.match ?? 'unmatched');
  }
  const out: string[] = [];
  for (const [chat, counts] of matches) {
    out.push(
      `  ${chat ?? '?'}: risposte del bot abbinate a un comando: ` +
        mostCommon(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
    );
  }
  return out;
}
