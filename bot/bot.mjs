/* Eagles Bot — amministratore automatico del gruppo EaglesT (GitHub Action del repository dati).
 *
 * A ogni issue aperta decifra l'invio e lo applica con le regole di lib/group.js:
 *   - partita (cifrata con la parola del gruppo, segreto GROUP_KEY, o con la chiave da amministratore):
 *     entra nello storico di gruppo data/storico.enc;
 *   - rubrica (solo se cifrata con la chiave da amministratore, segreto ADMIN_KEY): nuova versione di
 *     data/rubrica.enc.
 * I file pubblicati sono cifrati con la parola del gruppo, così ogni membro li legge. L'esito va in outcome.txt;
 * pubblicare e chiudere l'issue lo fa il workflow. Il contenuto dell'issue arriva da una variabile d'ambiente,
 * mai dentro uno script: un invio non può eseguire comandi.
 *
 * Prova in locale: GROUP_KEY=... ADMIN_KEY=... ISSUE_BODY="$(cat invio.txt)" ISSUE_AT=2026-11-25T10:00:00Z node bot/bot.mjs
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
const RUBRICA = path.join(ROOT, 'data', 'rubrica.enc');
const OUTCOME = path.join(ROOT, 'outcome.txt');

/** Invio decifrato e se arriva da un amministratore; null se non è cifrato con nessuna delle due chiavi. */
async function open(body, key, adminKey) {
    try { return { payload: await crypt.decrypt(body, key), admin: false }; } catch { /* prova la chiave da amministratore */ }
    if (adminKey) {
        try { return { payload: await crypt.decrypt(body, adminKey), admin: true }; } catch { /* nessuna delle due */ }
    }
    return null;
}

async function readEnc(file, key, empty) {
    return fs.existsSync(file) ? crypt.decrypt(fs.readFileSync(file, 'utf8'), key) : empty;
}

async function writeEnc(file, data, key) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await crypt.encrypt(data, key));
}

async function main() {
    const key = process.env.GROUP_KEY, adminKey = process.env.ADMIN_KEY;
    if (!key) throw new Error('segreto GROUP_KEY mancante');
    const at = process.env.ISSUE_AT || new Date().toISOString();
    const opened = await open(process.env.ISSUE_BODY || '', key, adminKey);
    if (!opened) return 'scartato: non cifrato con la parola del gruppo';
    const { payload, admin } = opened;

    if (payload && payload.type === 'rubrica') {
        if (!admin) return 'scartato: solo un amministratore può cambiare la rubrica';
        const res = group.mergeRubrica(await readEnc(RUBRICA, key, null), payload, at);
        if (res.error) return `scartato: ${res.error}`;
        await writeEnc(RUBRICA, res.rubrica, key);
        return `ok: rubrica versione ${res.rubrica.version} (${res.rubrica.players.length} giocatori)`;
    }

    const res = group.mergeSubmission(await readEnc(STORE, key, { v: 1, rounds: {} }), payload, at);
    if (res.error) return `scartato: ${res.error}`;
    await writeEnc(STORE, res.store, key);
    const n = Object.keys(res.store.rounds).length;
    return res.replaced.length ? `ok: partita sostituita (${n} nello storico)` : `ok: partita aggiunta (${n} nello storico)`;
}

main()
    .then(msg => { fs.writeFileSync(OUTCOME, msg); console.log(msg); })
    .catch(err => { fs.writeFileSync(OUTCOME, 'errore del bot'); console.error(err.message); process.exitCode = 1; });
