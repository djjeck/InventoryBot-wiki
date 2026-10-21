# InventoryBot Wiki

Ricostruisce ricette, oggetti e luoghi di [@InventoryBot](https://t.me/InventoryBot) a partire
dall'export della propria chat Telegram, e li mostra in una piccola webapp statica.

**Usala qui: <https://djjeck.github.io/InventoryBot-wiki/>.**

## Come si usa

1. In **Telegram Desktop** apri la chat con il bot (o un gruppo in cui si gioca), menu **⋮** →
   **Esporta cronologia chat**, formato **HTML**; foto e altri allegati non servono.
2. Apri la pagina, premi **Aggiungi esportazione** in alto a destra e scegli la cartella creata
   dall'esportazione (o una cartella che ne contiene più d'una).

Tutto avviene nel tuo browser: le esportazioni non vengono inviate da nessuna parte. \
Cosa resta salvato: le esportazioni già elaborate (i messaggi del bot e i comandi che gli hai dato,
non il resto delle chat) e la wiki, solo in questo browser, finché non togli un'esportazione o premi
«Cancella i miei dati». Così, quando torni, ritrovi la tua wiki senza scegliere di nuovo le
cartelle.

## A che serve

Il gioco dimentica le ricette già eseguite e non dice cosa producono: qui ogni osservazione fatta in
passato resta, così si può vedere a colpo d'occhio cosa produce una ricetta, quali ricette si
contendono lo stesso ingrediente e quali catene portano agli oggetti di livello alto.

## Limiti

- Si vede solo ciò che il bot ti ha mostrato: una ricetta compare solo quando possiedi metà degli
  ingredienti, e cosa produce solo dopo averla eseguita.
- L'inventario è una stima: il bot tronca gli inventari lunghi, e quello che fai fuori dalle chat
  esportate non si vede.
- Si leggono solo le esportazioni HTML di Telegram Desktop.

## No spoiler!!

InventoryBot si scopre giocando:

- **Solo le tue scoperte.** La pagina mostra soltanto ciò che hai già visto nelle tue chat: ognuno
  si crea la propria wiki, che resta nel suo browser. Non esiste una wiki pubblica, e non ce ne sarà
  una.
- **Solo lettura.** Il programma legge le esportazioni di Telegram e non parla mai con il bot: non
  invia messaggi e non automatizza il gioco. Le avventure si fanno a mano, come sempre.
- **Niente spoiler nel codice.** Gli esempi della documentazione e dei test usano oggetti, ricette e
  luoghi inventati, mai quelli veri.

Questo progetto non è affiliato a InventoryBot né al suo autore, che ha l'ultima parola.
