# EaglesT — dati del gruppo

Archivio dati del gruppo EaglesT, gestito da **Eagles Bot** (`.github/workflows/eagles-bot.yml`).

- Le app del gruppo mandano le partite come issue **cifrate**; il bot le unisce allo storico e chiude l'issue.
- `data/storico.enc` è lo storico di gruppo, **cifrato** con la parola d'ordine del gruppo (segreto `GROUP_KEY`).
- Il codice del bot e le librerie (`bot/`) si aggiornano da EaglesT con `node tools/bot_deploy.js`.

**Guida del proprietario e degli amministratori** (rinnovo della chiave, inviti, controllo del bot): `EAGLES_BOT.md` nella cartella del progetto EaglesT del proprietario. Non è pubblicata qui; nessun segreto sta in questo archivio, a parte il segreto `GROUP_KEY` nelle impostazioni.
