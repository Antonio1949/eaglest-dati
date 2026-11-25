/* EaglesT — gruppo con Eagles Bot (logica pura: la usano l'app e il bot).
 * L'invito porta repository dati, chiave GitHub (solo issue) e parola d'ordine del gruppo; l'invito da
 * amministratore anche la chiave da amministratore, l'unica con cui il bot accetta modifiche alla rubrica.
 * Le partite viaggiano cifrate come issue; il bot le unisce nello storico di gruppo:
 * stessa partita, o stessa giornata + campo + giocatori (doppione da due telefoni) → vince l'ultima arrivata. */
(function (root) {
    const INVITE_KEY = 'invito=';
    const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

    const toB64Url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fromB64Url = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

    function buildInvite(baseUrl, { repo, token, key, admin }) {
        const d = { v: 1, repo, token, key };
        if (admin) d.admin = admin;
        return `${baseUrl}#${INVITE_KEY}${toB64Url(JSON.stringify(d))}`;
    }

    /** null se l'hash non è un invito; { error } se è rovinato; altrimenti { repo, token, key[, admin] }. */
    function parseInvite(hash) {
        const raw = String(hash || '').replace(/^#/, '');
        if (!raw.startsWith(INVITE_KEY)) return null;
        let d;
        try { d = JSON.parse(fromB64Url(raw.slice(INVITE_KEY.length))); } catch { return { error: 'Invito rovinato o incompleto.' }; }
        if (!d || d.v !== 1 || !REPO_RE.test(d.repo || '') || typeof d.token !== 'string' || d.token.length < 20
            || typeof d.key !== 'string' || d.key.length < 16
            || (d.admin !== undefined && (typeof d.admin !== 'string' || d.admin.length < 16))) return { error: 'Invito non valido.' };
        return { repo: d.repo, token: d.token, key: d.key, ...(d.admin ? { admin: d.admin } : {}) };
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

    /* ---------- Rubrica ufficiale (la modificano solo gli amministratori) ---------- */

    const HI_MIN = -10, HI_MAX = 54;
    const str = (v, max) => String(v ?? '').trim().slice(0, max);

    /** Giocatore della rubrica ufficiale: null se mancano codice o nome o l'handicap non è valido. */
    function cleanPlayer(p) {
        if (!p || typeof p !== 'object') return null;
        const id = str(p.id, 40), name = str(p.name, 60);
        const hcp = typeof p.hcp === 'number' ? p.hcp : parseFloat(String(p.hcp ?? '').replace(',', '.'));
        if (!id || !name || !Number.isFinite(hcp) || hcp < HI_MIN || hcp > HI_MAX) return null;
        return { id, name, hcp, sex: ['M', 'F'].includes(p.sex) ? p.sex : '', email: str(p.email, 100), tee: str(p.tee, 12), photo: str(p.photo, 500) };
    }

    /**
     * Eagles Bot: nuova versione della rubrica ufficiale (l'invio è intero; vince l'ultimo arrivato, la storia la tiene git).
     * Restituisce { rubrica } o { error }.
     */
    function mergeRubrica(current, payload, at) {
        if (!payload || payload.type !== 'rubrica' || !payload.rubrica || !Array.isArray(payload.rubrica.players)) return { error: 'invio non valido' };
        const players = payload.rubrica.players.map(cleanPlayer);
        if (!players.length || players.some(p => !p)) return { error: 'rubrica non valida: giocatori senza codice, nome o handicap' };
        const ids = new Set(players.map(p => p.id)), names = new Set(players.map(p => p.name.toLowerCase()));
        if (ids.size !== players.length || names.size !== players.length) return { error: 'rubrica non valida: codici o nomi doppi' };
        const admins = (payload.rubrica.admins || []).filter(id => ids.has(id));
        return { rubrica: { v: 1, version: ((current && current.version) || 0) + 1, updated: at, players, admins } };
    }

    /**
     * Rubrica del telefono → rubrica ufficiale. Le persone del telefono con lo stesso nome di un giocatore ufficiale
     * prendono il suo codice (idMap: vecchio codice → nuovo); foto e data dell'invito restano quelle del telefono.
     */
    function rosterFromGroup(localRoster, rubrica) {
        const key = s => s.trim().toLowerCase();
        const idMap = {};
        localRoster.forEach(f => {
            const g = rubrica.players.find(p => p.id === f.id) || rubrica.players.find(p => key(p.name) === key(f.name));
            if (g && g.id !== f.id) idMap[f.id] = g.id;
        });
        const roster = rubrica.players.map(p => {
            const local = localRoster.find(f => (idMap[f.id] || f.id) === p.id) || {};
            return { ...p, photo: p.photo || local.photo || '', ...(local.invitedAt ? { invitedAt: local.invitedAt } : {}) };
        });
        return { roster, idMap };
    }

    /** Partite del telefono con i codici dei giocatori aggiornati (giocatori e colpi). */
    function remapRounds(history, idMap) {
        if (!Object.keys(idMap).length) return history;
        const swap = pid => idMap[pid] || pid;
        return history.map(r => ({
            ...r, players: r.players.map(p => ({ ...p, id: swap(p.id) })),
            scores: Object.fromEntries(Object.entries(r.scores || {}).map(([n, row]) => [n, Object.fromEntries(Object.entries(row).map(([pid, v]) => [swap(pid), v]))])),
        }));
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

    const api = { INVITE_KEY, buildInvite, parseInvite, mergeSubmission, mergeHistory, validRound, cleanPlayer, mergeRubrica, rosterFromGroup, remapRounds };
    root.EaglesT = Object.assign(root.EaglesT || {}, { group: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
