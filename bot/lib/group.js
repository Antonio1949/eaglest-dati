/* EaglesT — gruppo con Eagles Bot (logica pura: la usano l'app e il bot).
 * L'invito porta repository dati, chiave GitHub (solo issue) e parola d'ordine del gruppo.
 * Le partite viaggiano cifrate come issue; il bot le unisce nello storico di gruppo:
 * stessa partita, o stessa giornata + campo + giocatori (doppione da due telefoni) → vince l'ultima arrivata. */
(function (root) {
    const INVITE_KEY = 'invito=';
    const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

    const toB64Url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fromB64Url = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

    function buildInvite(baseUrl, { repo, token, key }) {
        return `${baseUrl}#${INVITE_KEY}${toB64Url(JSON.stringify({ v: 1, repo, token, key }))}`;
    }

    /** null se l'hash non è un invito; { error } se è rovinato; altrimenti { repo, token, key }. */
    function parseInvite(hash) {
        const raw = String(hash || '').replace(/^#/, '');
        if (!raw.startsWith(INVITE_KEY)) return null;
        let d;
        try { d = JSON.parse(fromB64Url(raw.slice(INVITE_KEY.length))); } catch { return { error: 'Invito rovinato o incompleto.' }; }
        if (!d || d.v !== 1 || !REPO_RE.test(d.repo || '') || typeof d.token !== 'string' || d.token.length < 20
            || typeof d.key !== 'string' || d.key.length < 16) return { error: 'Invito non valido.' };
        return { repo: d.repo, token: d.token, key: d.key };
    }

    /** Giocatori della partita come insieme di nomi: riconosce la stessa partita registrata da due telefoni. */
    const signature = r => [r.date.slice(0, 10), r.courseId, r.holesType,
        r.players.map(p => p.name.trim().toLowerCase()).sort().join('|')].join('#');

    const SAME_ROUND_MS = 3 * 3600 * 1000;   // stessa partita: iniziata a meno di 3 ore (9 buche al mattino e 9 al pomeriggio restano due)

    /** Stessa partita registrata da due telefoni: stessa giornata, campo, tipo di giro e giocatori, iniziate a meno di 3 ore. */
    const sameRound = (a, b) => signature(a) === signature(b) && Math.abs(Date.parse(a.date) - Date.parse(b.date)) < SAME_ROUND_MS;

    function validRound(r) {
        return r && typeof r.id === 'string' && r.id.length <= 40 && !Number.isNaN(Date.parse(r.date))
            && typeof r.courseId === 'string' && ['18', '9_out', '9_in'].includes(r.holesType)
            && Array.isArray(r.players) && r.players.length >= 1 && r.players.length <= 4
            && r.players.every(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim())
            && r.scores && typeof r.scores === 'object';
    }

    /**
     * Eagles Bot: unisce un invio allo storico di gruppo. store = { rounds: { id: { round, device, at } } }.
     * Restituisce { store, replaced: [id sostituiti] } o { error } se l'invio non è una partita valida.
     */
    function mergeSubmission(store, payload, at) {
        if (!payload || payload.type !== 'round' || !validRound(payload.round)) return { error: 'invio non valido' };
        const round = { ...payload.round, closed: true };
        const rounds = { ...(store.rounds || {}) };
        const replaced = Object.keys(rounds).filter(id => id === round.id || sameRound(rounds[id].round, round));
        replaced.forEach(id => delete rounds[id]);
        rounds[round.id] = { round, device: String(payload.device || '').slice(0, 40), at };
        return { store: { v: 1, updated: at, rounds }, replaced };
    }

    /**
     * Storico del telefono + storico di gruppo: le partite del gruppo in cui c'è il proprietario (per codice o,
     * finché la rubrica non è unica, per nome) entrano con il suo codice; stessa partita → vince quella del gruppo.
     * Le partite tolte dal gruppo come doppioni spariscono anche dal telefono, se ci erano arrivate dal gruppo.
     */
    function mergeHistory(history, store, me) {
        const group = Object.values(store.rounds || {}).map(x => x.round);
        const groupIds = new Set(group.map(r => r.id));
        const name = me.name.trim().toLowerCase();
        const mine = group.map(r => {
            if (r.players.some(p => p.id === me.id)) return r;
            const idx = r.players.findIndex(p => p.name.trim().toLowerCase() === name);
            if (idx < 0) return null;
            const oldId = r.players[idx].id;
            const swap = pid => (pid === oldId ? me.id : pid);
            return {
                ...r, players: r.players.map(p => ({ ...p, id: swap(p.id) })),
                scores: Object.fromEntries(Object.entries(r.scores).map(([n, row]) => [n, Object.fromEntries(Object.entries(row).map(([pid, v]) => [swap(pid), v]))])),
            };
        }).filter(Boolean);
        // fuori: le partite che il gruppo ha (stesso codice o doppione) e quelle arrivate dal gruppo e poi tolte
        const kept = history.filter(r => !r.fromGroup && !groupIds.has(r.id) && !group.some(g => sameRound(g, r)));
        return [...kept, ...mine.map(r => ({ ...r, fromGroup: true }))]
            .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    }

    const api = { INVITE_KEY, buildInvite, parseInvite, mergeSubmission, mergeHistory, validRound };
    root.EaglesT = Object.assign(root.EaglesT || {}, { group: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
