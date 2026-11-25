/* Eagles Bot — amministratore automatico del gruppo EaglesT (GitHub Action del repository dati).
 *
 * A ogni issue aperta: decifra l'invio con la parola d'ordine del gruppo (segreto GROUP_KEY), lo unisce allo
 * storico di gruppo (data/storico.enc, cifrato) con le regole di lib/group.js e scrive l'esito in outcome.txt.
 * Pubblicare il file e chiudere l'issue lo fa il workflow. Il contenuto dell'issue arriva da una variabile
 * d'ambiente, mai dentro uno script: un invio non può eseguire comandi.
 *
 * Prova in locale: GROUP_KEY=... ISSUE_BODY="$(cat invio.txt)" ISSUE_AT=2026-11-25T10:00:00Z node bot/bot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const crypt = require('./lib/crypt.js');
const group = require('./lib/group.js');

const ROOT = process.env.DATA_ROOT || path.join(here, '..');
const STORE = path.join(ROOT, 'data', 'storico.enc');
const OUTCOME = path.join(ROOT, 'outcome.txt');

async function main() {
    const key = process.env.GROUP_KEY;
    if (!key) throw new Error('segreto GROUP_KEY mancante');
    let payload;
    try {
        payload = await crypt.decrypt(process.env.ISSUE_BODY || '', key);
    } catch {
        return 'scartato: non cifrato con la parola del gruppo';
    }
    const store = fs.existsSync(STORE) ? await crypt.decrypt(fs.readFileSync(STORE, 'utf8'), key) : { v: 1, rounds: {} };
    const res = group.mergeSubmission(store, payload, process.env.ISSUE_AT || new Date().toISOString());
    if (res.error) return `scartato: ${res.error}`;
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, await crypt.encrypt(res.store, key));
    const n = Object.keys(res.store.rounds).length;
    return res.replaced.length ? `ok: partita sostituita (${n} nello storico)` : `ok: partita aggiunta (${n} nello storico)`;
}

main()
    .then(msg => { fs.writeFileSync(OUTCOME, msg); console.log(msg); })
    .catch(err => { fs.writeFileSync(OUTCOME, 'errore del bot'); console.error(err.message); process.exitCode = 1; });
