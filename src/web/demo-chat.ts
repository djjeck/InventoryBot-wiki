/**
 * The example's chat (demo.ts): the private chat with the bot of a player who has just
 * started, one exchange per entry: when they sent the command (1 October 2026, Italy's
 * time), the command, and the bot's reply two seconds later.
 *
 * The player walks from the village to the plain, finds one each of four common items on
 * the way, looks around, then lists their items and recipes and examines each of them:
 * every recipe is listed, one is ready, none is made, so no output is known.
 *
 * Real game content, the one exception to the rule of no spoilers in the repository
 * (CLAUDE.md): a few level-1 recipes of common items that drop everywhere, and the places
 * a new player's /viaggio lists on that road (no secret place). The player and the texts
 * of the adventures are invented.
 */
export const DEMO_CHAT: readonly (readonly [time: string, command: string, reply: string])[] = [
  [
    '18:00:00',
    '/viaggio',
    '@esempio, ti trovi: nel villaggio di Phar Thenza 🏡\nPuoi andare verso:\n - sul lungo Viale Imperiale 🎍\n - nel magnifico Castello Reale di msx80 🏰\n - nella Cattedrale di Urungheth ⛪️\n - sulla spiaggia sabbiosa 🏖',
  ],
  [
    '18:01:02',
    '/avventura',
    "@esempio, passeggiando lungo un sentiero di campagna noti qualcosa tra l'erba: e' il tubo di cartone di una carta igienica consumata [C]!",
  ],
  [
    '18:01:44',
    '/viaggio lungo Viale Imperiale',
    '@esempio, ti metti in cammino e dopo un lunghissimo viaggio arrivi sul lungo Viale Imperiale 🎍\n\nPuoi andare verso:\n - nel villaggio di Phar Thenza 🏡\n - nella Biblioteca Imperiale 📚\n - nella pianura sterminata 🏞',
  ],
  [
    '18:23:23',
    '/avventura',
    '@esempio, frughi in un vecchio carretto abbandonato e ne tiri fuori la cornetta di un citofono [C]!',
  ],
  [
    '18:24:05',
    '/viaggio pianura sterminata',
    '@esempio, ti metti in cammino e dopo un lunghissimo viaggio arrivi nella pianura sterminata 🏞\n\nPuoi andare verso:\n - negli orti del villaggio ⛳\n - ai piedi del monte Nuberath ⛰\n - nel bosco oscuro di Buruthen 🌲\n - sul lungo Viale Imperiale 🎍',
  ],
  [
    '18:52:21',
    '/avventura',
    '@esempio, aiuti un contadino a raccogliere il fieno e per ringraziarti ti regala un rotolo di carta igienica [C]!',
  ],
  [
    '19:27:14',
    '/avventura',
    '@esempio, ti fermi a riposare sotto una quercia e ai tuoi piedi trovi una confezione di Crodino [C]!',
  ],
  [
    '19:27:56',
    '/viaggio',
    '@esempio, ti trovi: nella pianura sterminata 🏞\nPuoi andare verso:\n - negli orti del villaggio ⛳\n - ai piedi del monte Nuberath ⛰\n - nel bosco oscuro di Buruthen 🌲\n - sul lungo Viale Imperiale 🎍',
  ],
  [
    '19:32:58',
    '/inventario',
    '@esempio, possiedi:\n- il tubo di cartone di una carta igienica consumata [C] x1\n- la cornetta di un citofono [C] x1\n- un rotolo di carta igienica [C] x1\n- una confezione di Crodino [C] x1',
  ],
  [
    '19:33:40',
    '/ricetta',
    '@esempio, ecco le ricette a tua disposizione:\n- Bisogno impellente L1 [*]\n- Binocolo di cartone L1 [manca 1]\n- Crodini in sconto L1 [manca 1]\n- Pizza a domicilio L1 [manca 1]\nScrivi /ricetta <nome ricetta> per vedere quali oggetti ti mancano per una certa ricetta!',
  ],
  [
    '19:34:22',
    '/esamina Bisogno impellente',
    "@esempio, per fare la ricetta Bisogno impellente ti manca:\nMentre hai gia':\n- un rotolo di carta igienica [C] x1",
  ],
  [
    '19:35:04',
    '/esamina Binocolo di cartone',
    "@esempio, per fare la ricetta Binocolo di cartone ti manca:\n- il tubo di cartone di una carta igienica consumata [C] x1\nMentre hai gia':\n- il tubo di cartone di una carta igienica consumata [C] x1",
  ],
  [
    '19:35:46',
    '/esamina Crodini in sconto',
    "@esempio, per fare la ricetta Crodini in sconto ti manca:\n- un cavatappi arrugginito [C] x1\nMentre hai gia':\n- una confezione di Crodino [C] x1",
  ],
  [
    '19:36:28',
    '/esamina Pizza a domicilio',
    "@esempio, per fare la ricetta Pizza a domicilio ti manca:\n- il volantino di una pizzeria da asporto [C] x1\nMentre hai gia':\n- la cornetta di un citofono [C] x1",
  ],
  [
    '19:37:10',
    '/esamina tubo di cartone di una carta igienica consumata',
    "@esempio il tubo di cartone di una carta igienica consumata [C] al momento ti serve nelle ricette: Binocolo di cartone.\nNe hai 1.\nE' un oggetto trovabile in avventura.",
  ],
  [
    '19:37:52',
    '/esamina cornetta di un citofono',
    "@esempio la cornetta di un citofono [C] al momento ti serve nelle ricette: Pizza a domicilio.\nNe hai 1.\nE' un oggetto trovabile in avventura.",
  ],
  [
    '19:38:34',
    '/esamina rotolo di carta igienica',
    "@esempio un rotolo di carta igienica [C] al momento ti serve nelle ricette: Bisogno impellente.\nNe hai 1.\nE' un oggetto trovabile in avventura.",
  ],
  [
    '19:39:16',
    '/esamina confezione di Crodino',
    "@esempio una confezione di Crodino [C] al momento ti serve nelle ricette: Crodini in sconto.\nNe hai 1.\nE' un oggetto trovabile in avventura.",
  ],
];
