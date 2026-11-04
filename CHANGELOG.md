# Changelog

## Non ancora rilasciata

- **Esportazioni raggruppate per chat.** Nel pannello Importa ogni chat ha una sola scheda, con una
  riga per esportazione: prima la chat con il bot, poi le altre in ordine alfabetico, con righe più
  compatte.

## 0.9.4 (2026-11-03)

- **Aggiunto il livello ai luoghi.** Ogni luogo mostra accanto al nome il livello più basso da cui
  ci si può arrivare. Il livello viene dagli oggetti che servono per entrarci o per vederlo tra le
  destinazioni, e dai luoghi da cui si passa per arrivarci; la pagina del luogo dice da cosa.
- **Cosa serve per arrivare in un luogo.** La pagina di un luogo dove non puoi ancora andare mostra
  l'albero delle ricette che mancano per arrivarci.
- **Gli alberi delle ricette tengono conto dei luoghi bloccati.** Se un ingrediente si trova solo in
  un luogo dove non puoi ancora arrivare, compare il luogo nell'albero delle ricette con l'oggetto
  che lo sblocca.
- **Un luogo può richiudersi.** Se non hai più l'oggetto che ti faceva entrare (per esempio perché
  l'hai dato via), «Ti manca» considera il luogo di nuovo chiuso, anche se ci sei già stato.

## 0.9.3 (2026-10-27)

- **Alberi delle ricette più completi.** Se un ingrediente si ottiene solo usando un altro oggetto
  (per esempio aprendo un baule con la sua chiave), l'albero ora prosegue fino agli oggetti da
  trovare, invece di fermarsi lì. Quando un uso dà l'oggetto solo a volte, la linea è tratteggiata e
  accanto trovi una stima («≈N») di quante volte serve usarlo in media, calcolata da quello che hai
  visto finora.
- **Cose plasmabili:** Un oggetto a cui dai una forma (`modellato a forma di …`) resta un solo
  oggetto, qualunque forma abbia, sia nella wiki sia nella stima del tuo inventario, e ogni volta
  che lo modelli conta come un suo uso. La sua scheda ricorda le forme che gli hai dato,
  dall'ultima.
- **La rarità M ha un nome.** Secondo la legenda dell'Atlante è «mega raro», sopra il super raro.

## 0.9.2 (2026-10-26)

- **Lettura di `/esporta`.** Il file che il bot manda in risposta a `/esporta` elenca tutto quello
  che possiedi, e ora la stima dell'inventario riparte esatta da lì. Perché l'esportazione contenga
  il file, seleziona **File** quando esporti la chat: la pagina e il README ora lo spiegano.
- **Pure altri formati:** `/collezioni` e le pagine di `/inv2` aggiornano la stima dell'inventario,
  come `/inventario`, e ogni quantità dice quale di questi comandi l'ha confermata per ultimo.

## 0.9.1 (2026-10-26)

- **Supporto Pakkomon.** Mostra Pakkomon a parte, non più come oggetti.
- **Supporto roba Pakkomon.** Gli oggetti dicono a cosa servono per i Pakkomon (equipaggiamento,
  cura, potenziamento, strumento) e quale combattimento contro un Pakkomon del bot o un boss li fa
  vincere. Un nuovo filtro della lista degli oggetti li mostra tutti.
- I nomi utente nelle risposte sui Pakkomon e dopo il `#` di `/usa` sono anonimizzati come tutti gli
  altri.
- Quando la pagina si aggiorna a una nuova versione, la wiki salvata viene ricostruita, invece di
  mostrare i risultati della versione precedente.
- La pagina di github.io si aggiorna solo quando esce una nuova versione taggata.

## 0.9.0 (2026-10-26)

Prima versione.
