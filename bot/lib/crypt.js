/* EaglesT — cifratura dei dati del gruppo (stesso codice nel browser e in Eagles Bot su Node).
 * AES-GCM 256 con chiave derivata dalla parola d'ordine del gruppo (PBKDF2-SHA256): chi non la conosce
 * vede solo caratteri senza senso. Il testo cifrato porta sale e vettore iniziale, quindi ogni cifratura è diversa. */
(function (root) {
    const subtle = (root.crypto || globalThis.crypto).subtle;
    const ITERATIONS = 200000;
    const enc = new TextEncoder(), dec = new TextDecoder();

    const toB64 = bytes => {
        let s = '';
        bytes.forEach(b => { s += String.fromCharCode(b); });
        return btoa(s);
    };
    const fromB64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

    async function keyFor(password, salt) {
        const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
        return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    /** Oggetto → testo cifrato (JSON con v, s, i, c in base64). */
    async function encrypt(obj, password) {
        const salt = (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(16));
        const iv = (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(12));
        const data = await subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(password, salt), enc.encode(JSON.stringify(obj)));
        return JSON.stringify({ v: 1, s: toB64(salt), i: toB64(iv), c: toB64(new Uint8Array(data)) });
    }

    /** Testo cifrato → oggetto; errore se la parola d'ordine è sbagliata o il testo è stato alterato. */
    async function decrypt(text, password) {
        const box = JSON.parse(text);
        if (box.v !== 1) throw new Error('formato cifrato sconosciuto');
        const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.i) }, await keyFor(password, fromB64(box.s)), fromB64(box.c));
        return JSON.parse(dec.decode(plain));
    }

    const api = { encrypt, decrypt };
    root.EaglesT = Object.assign(root.EaglesT || {}, { crypt: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
