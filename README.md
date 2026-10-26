# InventoryBot Wiki

Ricostruisce ricette, oggetti e luoghi di [@InventoryBot](https://t.me/InventoryBot) a partire
dall'export della propria chat Telegram, e li mostra in una piccola webapp statica.

**Usala qui: <https://djjeck.github.io/InventoryBot-wiki/>.**

## Come si usa

Per vedere com'è prima di esportare qualcosa, premi **Prova con un esempio** nella pagina ancora
vuota: la pagina mostra la chat con il bot di un giocatore inventato, appena arrivato, e ne ricava
la wiki. Oggetti, ricette e luoghi sono quelli del gioco, limitati ai primi passi. L'esempio
sparisce appena aggiungi una tua esportazione.

1. In **Telegram Desktop** apri la chat con il bot, menu **⋮** → **Esporta cronologia chat**,
   formato **HTML**; foto e altri allegati non servono.
2. Apri la pagina, premi **Importa** in alto a destra, poi **Aggiungi esportazione**, e scegli la
   cartella creata dall'esportazione (o una cartella che ne contiene più d'una).
3. Facoltativo: esporta allo stesso modo i tre canali enciclopedici che il bot indica in `/gruppi`
   (**La Cittadella dei Demiurghi**, **Il Grimorio del Golem**, **L'Atlante di Barbabeige**) e
   aggiungili: la wiki ne prende ricette, oggetti e luoghi. Le loro schede sono per lo più del 2017,
   e ciò che il bot ti ha mostrato dopo ha la precedenza; la pagina dice da quale scheda viene ogni
   dato.

Tutto avviene nel tuo browser: le esportazioni non vengono inviate da nessuna parte. \
Cosa resta salvato: le esportazioni già elaborate (i messaggi del bot e i comandi che gli hai dato,
non il resto delle chat) e la wiki, solo in questo browser, finché non togli un'esportazione o premi
«Cancella i miei dati». Così, quando torni, ritrovi la tua wiki senza scegliere di nuovo le
cartelle.

## A che serve

Il gioco dimentica le ricette già eseguite e non dice cosa producono: qui ogni osservazione fatta in
passato resta, così si può vedere a colpo d'occhio cosa produce una ricetta, quali ricette si
contendono lo stesso ingrediente e, per un oggetto di livello alto, l'albero delle ricette che
portano fin lì, con quante volte va craftato o trovato ogni oggetto.

## Limiti

- Dalle tue chat si vede solo ciò che il bot ti ha mostrato: una ricetta compare solo quando
  possiedi metà degli ingredienti, e cosa produce solo dopo averla eseguita. I canali colmano molti
  vuoti, ma si fermano per lo più al 2017.
- L'inventario è una stima: il bot tronca gli inventari lunghi, e quello che fai fuori dalle chat
  esportate non si vede. La pagina dice quante volte la stima ha dato gli stessi ingredienti
  mancanti che il bot indicava in `/ricetta`: se non è il 100%, qualcosa è successo fuori dalle chat
  aggiunte.
- Si leggono solo le esportazioni HTML di Telegram Desktop.

## No spoiler!!

InventoryBot si scopre giocando:

- **Solo ciò che hai già davanti.** La pagina mostra soltanto ciò che c'è nelle chat che aggiungi:
  le tue partite e, se vuoi, i canali che il bot stesso consiglia. Ognuno si crea la propria wiki,
  che resta nel suo browser. Non esiste una wiki pubblica, e non ce ne sarà una.
- **Solo lettura.** Il programma legge le esportazioni di Telegram e non parla mai con il bot: non
  invia messaggi e non automatizza il gioco. Le avventure si fanno a mano, come sempre.
- **Niente spoiler nel codice.** Gli esempi della documentazione e dei test usano oggetti, ricette e
  luoghi inventati, mai quelli veri.

Questo progetto non è affiliato a InventoryBot né al suo autore, che ha l'ultima parola.
