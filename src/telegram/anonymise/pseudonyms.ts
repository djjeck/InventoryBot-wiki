/**
 * Pseudonyms for phase 3 (anonymise.ts): compound Italian names "AnimaleAggettivo"
 * (`VolpeVeloce`, `GufoGentile`), one per person or group of a run. Generic: nothing
 * here depends on which bot. Pure functions, no Node APIs.
 *
 * A name's pseudonym comes from a hash of the name with a secret salt, so the same person
 * keeps the same pseudonym from run to run (with the same salt) while nobody without the
 * salt can recompute who a pseudonym is: a hash of the name alone could be undone by
 * hashing every username one suspects. The salt is the caller's: random, kept private
 * (the web app keeps one per browser), never written to any output.
 *
 * The adjectives end in -e, which in Italian does not change with the gender of the
 * noun (la volpe veloce, il gufo veloce), so a pair always agrees. Every word is ASCII
 * letters only, so a pseudonym is a valid Telegram username and reads as one word to any
 * pattern that reads a username.
 */

/** Animal nouns, capitalised, ASCII, all different. */
export const ANIMALS: readonly string[] = [
  'Volpe', 'Gufo', 'Tasso', 'Lupo', 'Orso', 'Cervo', 'Lince', 'Lepre', 'Riccio',
  'Scoiattolo', 'Castoro', 'Lontra', 'Falco', 'Aquila', 'Corvo', 'Passero', 'Merlo',
  'Pettirosso', 'Airone', 'Cigno', 'Gabbiano', 'Pellicano', 'Fenicottero', 'Pinguino',
  'Delfino', 'Balena', 'Foca', 'Tricheco', 'Polpo', 'Granchio', 'Tartaruga', 'Rana',
  'Rospo', 'Salamandra', 'Geco', 'Camaleonte', 'Iguana', 'Ape', 'Formica', 'Farfalla',
  'Libellula', 'Coccinella', 'Cavallo', 'Asino', 'Mulo', 'Zebra', 'Giraffa', 'Elefante',
  'Leone', 'Tigre', 'Leopardo', 'Ghepardo', 'Pantera', 'Giaguaro', 'Puma', 'Ippopotamo',
  'Rinoceronte', 'Bisonte', 'Alce', 'Renna', 'Camoscio', 'Stambecco', 'Capriolo', 'Daino',
  'Cinghiale', 'Marmotta', 'Ermellino', 'Donnola', 'Faina', 'Criceto', 'Coniglio', 'Ghiro',
  'Pipistrello', 'Koala', 'Canguro', 'Panda', 'Lemure', 'Gorilla', 'Bradipo', 'Armadillo',
  'Formichiere', 'Tapiro', 'Lama', 'Alpaca', 'Cammello', 'Dromedario', 'Bufalo',
  'Gazzella', 'Antilope', 'Suricato', 'Mangusta', 'Procione', 'Furetto', 'Visone',
  'Struzzo', 'Pavone', 'Fagiano', 'Quaglia', 'Tucano', 'Pappagallo', 'Cacatua', 'Picchio',
  'Upupa', 'Rondine', 'Allodola', 'Usignolo', 'Cardellino', 'Fringuello', 'Cinciallegra',
  'Gru', 'Cicogna', 'Ibis', 'Condor', 'Avvoltoio', 'Nibbio', 'Poiana', 'Civetta',
  'Barbagianni', 'Storione', 'Salmone', 'Trota', 'Luccio', 'Tonno', 'Sgombro', 'Merluzzo',
  'Squalo', 'Sardina', 'Medusa', 'Anguilla', 'Lumaca', 'Chiocciola', 'Cavalluccio',
]; // prettier-ignore

/** Adjectives ending in -e (the same for both genders), capitalised, ASCII, all different. */
export const ADJECTIVES: readonly string[] = [
  'Veloce', 'Gentile', 'Felice', 'Agile', 'Abile', 'Affabile', 'Amabile', 'Audace',
  'Brillante', 'Capace', 'Celere', 'Cortese', 'Costante', 'Dolce', 'Docile', 'Elegante',
  'Fedele', 'Fiorente', 'Forte', 'Geniale', 'Gioviale', 'Grande', 'Leale', 'Lucente',
  'Mite', 'Nobile', 'Paziente', 'Possente', 'Potente', 'Prudente', 'Raggiante', 'Ribelle',
  'Sagace', 'Sapiente', 'Sensibile', 'Socievole', 'Solare', 'Splendente', 'Stabile',
  'Tenace', 'Vivace', 'Volante', 'Vigile', 'Cordiale', 'Speciale', 'Eccellente',
  'Imponente', 'Indomabile', 'Instancabile', 'Intelligente', 'Loquace', 'Notevole',
  'Piacevole', 'Ruggente', 'Saltellante', 'Scattante', 'Silente', 'Sorridente',
  'Squillante', 'Valente', 'Fulgente', 'Ardente', 'Errante', 'Galante', 'Lieve',
  'Pimpante', 'Prestante', 'Puntuale', 'Rampante', 'Trionfante', 'Vincente', 'Danzante',
  'Fiammante', 'Frizzante', 'Rilucente', 'Esuberante', 'Festevole',
]; // prettier-ignore

/**
 * The `i`-th pseudonym (from 0), the same for the same `i` on every run. The first
 * `animals.length * adjectives.length` are all different and each pair is used once;
 * consecutive ones change both words (`VolpeVeloce`, `GufoGentile`, `TassoFelice`, ...).
 * After all pairs, the sequence starts again with a number: `VolpeVeloce2`, then
 * `VolpeVeloce3` after the next round.
 */
export function pseudonym(
  i: number,
  animals: readonly string[] = ANIMALS,
  adjectives: readonly string[] = ADJECTIVES
): string {
  const pairs = animals.length * adjectives.length;
  const round = Math.floor(i / pairs);
  const k = i % pairs;
  const a = k % animals.length;
  const q = Math.floor(k / animals.length);
  const base = `${animals[a] as string}${adjectives[(a + q) % adjectives.length] as string}`;
  return round === 0 ? base : `${base}${round + 1}`;
}

/** 32-bit FNV-1a hash of a string's UTF-16 code units: small, fast and well spread. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The pseudonyms of one run. A name takes the pseudonym its salted hash points to; when
 * that one is taken, by a real username of the run (`taken`, ignoring case) or by a name
 * served before, the next ones in the sequence of `pseudonym()` are tried in turn, so
 * only collisions depend on the order names are asked in. Memoized: each name is hashed
 * once, and asking again gives the same pseudonym.
 */
export class PseudonymSource {
  private readonly salt: string;
  private readonly taken: Set<string>;
  private readonly animals: readonly string[];
  private readonly adjectives: readonly string[];
  private readonly served = new Map<string, string>();

  constructor(
    salt: string,
    taken: ReadonlySet<string>,
    animals: readonly string[] = ANIMALS,
    adjectives: readonly string[] = ADJECTIVES
  ) {
    this.salt = salt;
    this.taken = new Set(taken);
    this.animals = animals;
    this.adjectives = adjectives;
  }

  /** The pseudonym of `name` (any string that identifies one person or group in the run). */
  for(name: string): string {
    const known = this.served.get(name);
    if (known !== undefined) return known;
    let i = fnv1a(`${this.salt}\u0000${name}`) % (this.animals.length * this.adjectives.length);
    let p = pseudonym(i, this.animals, this.adjectives);
    while (this.taken.has(p.toLowerCase())) p = pseudonym(++i, this.animals, this.adjectives);
    this.taken.add(p.toLowerCase());
    this.served.set(name, p);
    return p;
  }
}
