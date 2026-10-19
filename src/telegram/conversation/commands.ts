/**
 * Commands as the conversation phase sees them. Generic: the bot is a parameter, never a
 * constant here. Pure functions, no Node APIs.
 */
import { splitWords, WORD_CLASS } from '#src/lib/text.ts';
import { type Message } from '#src/telegram/messages.ts';

/**
 * A message as phase 2 reads it: a `/cmd@Bot` command with `@Bot` removed
 * (resolveCommand), flagged `other_bot` when Bot is not the bot of the run.
 */
export type ChatMessage = Message & { other_bot?: boolean };

const COMMAND = new RegExp(`^(/${WORD_CLASS}+)@(${WORD_CLASS}+)`, 'u');

/**
 * In groups commands may be addressed to a bot: "/cmd@BotName args" is read as
 * "/cmd args". Commands for other bots (BotName is not `botName`, case-insensitive) are
 * flagged `other_bot`, so that the conversation phase drops them. Returns `m` itself when
 * it has no `@BotName`, otherwise a copy.
 */
export function resolveCommand<T extends { text: string }>(
  m: T,
  botName: string
): T & { other_bot?: boolean } {
  const mm = COMMAND.exec(m.text);
  if (!mm) return m;
  return {
    ...m,
    text: (mm[1] as string) + m.text.slice(mm[0].length),
    other_bot: (mm[2] as string).toLowerCase() !== botName.toLowerCase(),
  };
}

/** A message that is a command for the bot of the run (`/cmd@OtherBot` is flagged `other_bot` by resolveCommand). */
export const isBotCommand = (m: Pick<ChatMessage, 'text' | 'other_bot'>): boolean =>
  m.text.startsWith('/') && !m.other_bot;

/** The command word of a command text, lower case (`/Start x` -> `/start`). */
export const firstWord = (text: string): string => (splitWords(text)[0] as string).toLowerCase();
