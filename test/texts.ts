/** Builders for synthetic InventoryBot reply texts (real formats, invented content). */

/** `[name, rarity, qty]` or `[name, rarity, qty, usable]`. */
export type ItemSpec = readonly [
  name: string,
  rarity: string | null,
  qty: number,
  usable?: boolean,
];

/** `- name [R] [usabile] xN` lines. */
export function lines(items: readonly ItemSpec[]): string {
  return items
    .map(
      ([name, rarity, qty, usable]) =>
        `- ${name}` + (rarity ? ` [${rarity}]` : '') + (usable ? ' [usabile]' : '') + ` x${qty}`
    )
    .join('\n');
}

export interface InfoOptions {
  count?: number | null;
  user?: string;
  usable?: boolean;
  usedIn?: string | null;
  /** "adventure", "special" or a recipe name. */
  source?: string | null;
}

export function info(name: string, rarity: string, o: InfoOptions = {}): string {
  const { count = null, user = 'djjeck', usable = false, usedIn = null, source = null } = o;
  let head = `@${user} ${name} [${rarity}]` + (usable ? ' [usabile]' : '') + ' al momento ';
  head += usedIn ? `ti serve nelle ricette: ${usedIn}.` : 'non ti serve in nessuna ricetta.';
  const rest: string[] = [];
  if (count !== null) rest.push(count ? `Ne hai ${count}.` : 'Non ne hai neanche uno.');
  if (source === 'adventure') rest.push("E' un oggetto trovabile in avventura.");
  else if (source === 'special') rest.push("E' un oggetto speciale.");
  else if (source) rest.push(`E' un oggetto che si ottiene con la ricetta "${source}".`);
  return [head, ...rest].join('\n');
}

export function inventory(items: readonly ItemSpec[], user = 'djjeck', truncated = false): string {
  const t = `@${user}, possiedi:\n` + lines(items);
  return t + (truncated ? '\ne altre robe che non ci stanno..' : '');
}

/** A /collezioni reply: the inventory by quantity. */
export function inventoryByQuantity(
  items: readonly ItemSpec[],
  user = 'djjeck',
  truncated = false
): string {
  const t = `@${user}, ecco i tuoi oggetti in ordine di quantità:\n` + lines(items);
  return t + (truncated ? '\ne altre robe che non ci stanno..' : '');
}

/** A page of an /inv2 reply. */
export function inventoryPage(
  items: readonly ItemSpec[],
  page: number,
  of: number,
  user = 'djjeck'
): string {
  return (
    `@${user}, possiedi (pg ${page}/${of}):\n` +
    lines(items) +
    '\n(non esagerare con i tasti o il bot va in antispam)'
  );
}

export function detail(
  recipe: string,
  missing: readonly ItemSpec[],
  have: readonly ItemSpec[],
  user = 'djjeck',
  esamina = false
): string {
  let t = `@${user}, per fare ${esamina ? 'la ricetta ' : ''}${recipe} ti manca:\n`;
  t += lines(missing) + (missing.length ? '\n' : '');
  return t + "Mentre hai gia':\n" + lines(have);
}

export function craft(
  ingredients: readonly ItemSpec[],
  output: string,
  user = 'djjeck',
  levelUp: readonly [number, string] | null = null
): string {
  let t = `@${user}, prendi in mano:\n` + lines(ingredients) + '\ne mescoli tutto con cura...\n';
  t += `Ottieni: ${output}!`;
  if (levelUp) t += `\nHai raggiunto il livello ${levelUp[0]}! ${levelUp[1]}`;
  return t;
}

/** `[name, level, missing]` with missing 0 = ready. */
export function recipeList(
  recipes: readonly (readonly [string, number, number])[],
  user = 'djjeck'
): string {
  const body = recipes.map(([n, l, m]) => `- ${n} L${l} [${m ? `manca ${m}` : '*'}]`).join('\n');
  return `@${user}, ecco le ricette a tua disposizione:\n${body}\nScrivi /ricetta <nome ricetta> per vedere...`;
}

export function drop(
  narrative: string,
  rarity: string,
  user = 'djjeck',
  usable = false,
  bang = true
): string {
  return `@${user}, ${narrative} [${rarity}]` + (usable ? ' [usabile]' : '') + (bang ? '!' : '');
}

export function travel(
  location: string,
  exits: readonly string[],
  user = 'djjeck',
  narrative: string | null = null
): string {
  const head = narrative
    ? `@${user}, ${narrative} arrivi: ${location}`
    : `@${user}, ti metti in cammino e dopo un lunghissimo viaggio arrivi ${location}`;
  return head + '\n\nPuoi andare verso:\n' + exits.map((x) => ` - ${x}`).join('\n');
}

export function where(location: string, exits: readonly string[], user = 'djjeck'): string {
  return (
    `@${user}, ti trovi: ${location}\nPuoi andare verso:\n` + exits.map((x) => ` - ${x}`).join('\n')
  );
}

export function blocked(location: string, user = 'djjeck'): string {
  return `@${user} non puoi andare: ${location}.. Forse ti manca qualcosa!`;
}

export function give(qty: number, item: string, to: string, user = 'djjeck'): string {
  return `@${user}, dai ${qty}x ${item} a @${to}`;
}

export function gift(qty: number, item: string, frm: string): string {
  return `[N] @${frm} ti ha dato ${qty}x ${item}`;
}

export function show(qty: number, item: string, rarity: string, user = 'djjeck'): string {
  return `@${user}, mostri orgogliosamente di possedere ${qty}x ${item} [${rarity}]`;
}

export const FAQ =
  'Ciao, sono InventoryBot! Ti aiuto a collezionare oggetti.\n\nLegenda oggetti\n' +
  'C = comune, N = non comune, R = raro, S = super raro, U = unico (ne esiste uno solo), ' +
  'Ln = ottenibile da ricette. X = oggetti speciali :)\n\nLivelli\n\n' +
  'Ogni ricetta di livello N richiede il livello N.\n\nBuon divertimento!';
