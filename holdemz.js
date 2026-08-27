/******************************************************************
 * Holdemz — logica di gioco
 *
 * Texas hold'em a cinque posti: tu piu' quattro avversari che
 * prendono il nome dal loro colore e hanno ognuno un carattere fisso.
 *
 *  - 20 monete a testa, bui 1 e 2, il bottone del banco scorre di un
 *    posto in senso orario a ogni mano.
 *  - due carte coperte a testa, poi flop, turn e river, con un giro di
 *    puntate per ognuno: passo, vedo, rilancio o vado all-in.
 *  - vince il piatto la migliore mano di cinque fra le due in mano e
 *    le cinque sul tavolo. A parita' il piatto si divide.
 *  - chi finisce le monete e' fuori. Chi resta solo ha vinto.
 *
 * Il giro attorno al tavolo E' l'ordine di gioco: i posti stanno su
 * un'ellisse e l'indice cresce in senso orario partendo dal tuo, in
 * basso. Per questo la disposizione circolare non e' decorazione.
 *
 * Rispetto alla versione del 2025 il motore e' riscritto come un ciclo
 * asincrono invece che a catena di setTimeout, e i side pot adesso
 * comprendono anche le monete di chi ha lasciato la mano: prima
 * restavano fuori da ogni piatto e sparivano dal tavolo.
 ******************************************************************/

'use strict';

/* ============================================================
 * 1. COSTANTI
 * ============================================================ */

const SUITS = ['P', 'C', 'Q', 'F'];          // picche, cuori, quadri, fiori
const SUIT_RANK = { P: 4, C: 3, F: 2, Q: 1 };

const START_COINS = 20;
const SMALL_BLIND = 1;
const BIG_BLIND = 2;

const HAND_NAMES = ['', 'High Card', 'Pair', 'Two Pair', 'Three of a Kind',
    'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
const HAND_SHORT = ['', 'High', 'Pair', '2 Pair', 'Trips',
    'Straight', 'Flush', 'Full', 'Quads', 'Str Flush'];

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const STREET_NAME = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

/* I posti sull'ellisse, in gradi: 90 e' in basso e si gira in senso
 * orario. L'indice 0 sei tu; 1, 2, 3, 4 sono i turni successivi. */
const SEAT_ANGLE = [90, 160, 215, 325, 20];

/* Gli avversari prendono nome e carattere dal colore che gli tocca.
 * Le soglie sono quelle del 2025, riportate parola per parola; il `vizio`
 * e' la novita' del 2026 — vedi la sezione dei tell. */
const CAST = [
    { hex: '#6d28d9', name: 'Purple',   tag: 'The Calculator', fold: .35, raise: .70, bluff: .05, loose: .30, vizio: 'maiPrimo' },
    { hex: '#b91c1c', name: 'Crimson',  tag: 'The Warrior',    fold: .20, raise: .45, bluff: .25, loose: .70, vizio: 'sempreAlFlop' },
    { hex: '#2563eb', name: 'Blue',     tag: 'The Purist',     fold: .40, raise: .75, bluff: .03, loose: .25, vizio: 'soloCoppieGrosse' },
    { hex: '#15803d', name: 'Green',    tag: 'The Trickster',  fold: .25, raise: .40, bluff: .45, loose: .60, vizio: 'trappolaAlFlop' },
    { hex: '#a21caf', name: 'Magenta',  tag: 'The Gambler',    fold: .15, raise: .35, bluff: .35, loose: .80, vizio: 'shoveAlRiver' },
    { hex: '#a16207', name: 'Gold',     tag: 'The Shark',      fold: .22, raise: .48, bluff: .20, loose: .65, vizio: 'misuraDelPiatto' },
    { hex: '#4338ca', name: 'Indigo',   tag: 'The Wildcard',   fold: .30, raise: .55, bluff: .30, loose: .50, vizio: 'testaOCroce' },
    { hex: '#4d7c0f', name: 'Olive',    tag: 'The Grinder',    fold: .38, raise: .72, bluff: .08, loose: .28, vizio: 'maiPrimaDelRiver' },
    { hex: '#9f1239', name: 'Burgundy', tag: 'The Rock',       fold: .42, raise: .78, bluff: .02, loose: .20, vizio: 'cedeAlRilancio' },
    { hex: '#0e7490', name: 'Sage',     tag: 'The Fox',        fold: .28, raise: .42, bluff: .40, loose: .55, vizio: 'turnDopoIlCheck' },
    { hex: '#7c4a1e', name: 'Brown',    tag: 'The Maniac',     fold: .18, raise: .38, bluff: .38, loose: .75, vizio: 'apreSempre' },
    { hex: '#c2410c', name: 'Peru',     tag: 'The Joker',      fold: .32, raise: .50, bluff: .28, loose: .45, vizio: 'paganoccia' }
];

const THEMES = ['felt', 'midnight', 'ivory', 'neon'];
const STORE = 'holdemz.prefs.v1';

const TELL_P = .8;           // quanto spesso il vizio prende il sopravvento

const ACT_MS = 620;          // pausa dopo la mossa di un avversario
const STREET_MS = 800;       // pausa fra una fase e l'altra

/* ============================================================
 * 2. STATO
 * ============================================================ */

const state = {
    players: [],
    deck: [],
    board: [],           // le cinque carte comuni, gia' estratte
    shown: 0,            // quante se ne vedono
    street: 'preflop',
    dealer: 0,
    pot: 0,
    currentBet: 0,
    minRaise: BIG_BLIND,
    toAct: -1,
    acted: null,
    flopChecked: false,
    hand: 0,
    phase: 'idle',       // 'idle' | 'playing' | 'over' | 'gameover'
    busy: false,
    fast: false,
    theme: 'felt'
};

const els = {};
const seatEls = [];
let resolveHuman = null;     // la promessa in attesa della tua mossa

/* ============================================================
 * 3. CARTE E MANI (puro)
 * ============================================================ */

function makeDeck() {
    const d = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s });
    return d;
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Valuta esattamente cinque carte. */
function evalFive(cards) {
    const counts = {};
    for (const c of cards) counts[c.r] = (counts[c.r] || 0) + 1;
    const groups = Object.keys(counts)
        .map(r => ({ r: +r, n: counts[r] }))
        .sort((a, b) => b.n - a.n || b.r - a.r);
    const sizes = groups.map(g => g.n);
    let kickers = groups.map(g => g.r);

    const flush = cards.every(c => c.s === cards[0].s);

    let straight = false;
    if (groups.length === 5) {
        const u = groups.map(g => g.r).sort((a, b) => b - a);
        if (u[0] - u[4] === 4) { straight = true; kickers = [u[0]]; }
        else if (u[0] === 14 && u[1] === 5) { straight = true; kickers = [5]; }  // la ruota
    }

    let score;
    if (straight && flush) score = 9;
    else if (sizes[0] === 4) score = 8;
    else if (sizes[0] === 3 && sizes[1] === 2) score = 7;
    else if (flush) score = 6;
    else if (straight) score = 5;
    else if (sizes[0] === 3) score = 4;
    else if (sizes[0] === 2 && sizes[1] === 2) score = 3;
    else if (sizes[0] === 2) score = 2;
    else score = 1;

    return { score, name: HAND_NAMES[score], kickers };
}

function cmpHands(a, b) {
    if (a.score !== b.score) return a.score - b.score;
    const n = Math.min(a.kickers.length, b.kickers.length);
    for (let i = 0; i < n; i++) {
        if (a.kickers[i] !== b.kickers[i]) return a.kickers[i] - b.kickers[i];
    }
    return 0;
}

/* le 21 cinquine di sette carte, calcolate una volta sola */
const PICK5 = (() => {
    const out = [];
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++)
        for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++)
            for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]);
    return out;
})();

/** La migliore mano di cinque fra le due coperte e le cinque comuni. */
function bestHand(hole, board) {
    const all = hole.concat(board);
    if (all.length < 5) return evalFive(all.concat(all).slice(0, 5));
    let best = null, bestCards = null;
    const idx = all.length === 7 ? PICK5 : combos(all.length, 5);
    for (const pick of idx) {
        const five = pick.map(i => all[i]);
        const h = evalFive(five);
        if (!best || cmpHands(h, best) > 0) { best = h; bestCards = five; }
    }
    best.cards = bestCards;
    return best;
}

function combos(n, k) {
    const out = [], cur = [];
    (function go(start) {
        if (cur.length === k) { out.push(cur.slice()); return; }
        for (let i = start; i < n; i++) { cur.push(i); go(i + 1); cur.pop(); }
    })(0);
    return out;
}

/* ============================================================
 * 4. GIOCATORI E POSTI
 * ============================================================ */

function newPlayers() {
    const picks = shuffle([...CAST]).slice(0, 5);
    const mine = picks.pop();
    const mk = (c, human) => ({
        name: human ? 'You' : c.name,
        tag: human ? '' : c.tag,
        vizio: human ? null : c.vizio,
        hex: c.hex,
        quirks: { fold: c.fold, raise: c.raise, bluff: c.bluff, loose: c.loose },
        coins: START_COINS,
        cards: [],
        isHuman: !!human,
        out: false, folded: false, allIn: false, spoke: false,
        bet: 0, total: 0, hand: null, verdict: null, won: 0
    });
    return [mk(mine, true), ...picks.map(c => mk(c, false))];
}

const seated = () => state.players.filter(p => !p.out);
const inHand = () => state.players.filter(p => !p.out && !p.folded);
const canAct = () => inHand().filter(p => !p.allIn && p.coins > 0);

/** Il posto successivo che e' ancora al tavolo. */
function nextSeat(i) {
    for (let k = 1; k <= 5; k++) {
        const j = (i + k) % 5;
        if (!state.players[j].out) return j;
    }
    return i;
}

/** Il posto successivo che puo' ancora agire in questa mano. */
function nextLive(i) {
    for (let k = 1; k <= 5; k++) {
        const j = (i + k) % 5;
        const p = state.players[j];
        if (!p.out && !p.folded && !p.allIn && p.coins > 0) return j;
    }
    return -1;
}

/* ============================================================
 * 5. IL CARATTERE DEGLI AVVERSARI
 *
 * Riportato dal gioco del 2025: soglia di abbandono, soglia di
 * rilancio, quanto bluffa e quanto e' largo di manica nel vedere.
 * ============================================================ */

/* Quanto vale ogni tipo di mano, da 0 a 1. NON e' `punteggio/9`, che era
 * il righello del 2025 e non funzionava: al flop una coppia capita il 42%
 * delle volte ma valeva 0,22, cioe' sotto la soglia di abbandono di dieci
 * avversari su dodici. Risultato, dopo il flop restava in mano l'8% delle
 * mani e chi puntava per primo si prendeva il piatto senza mostrare niente.
 * Con questi valori la forza media al flop passa da 0,18 a 0,36, cioe' in
 * mezzo alla fascia delle soglie — che cosi' tornano a discriminare.
 * Le dodici personalita' non sono state toccate: cambia solo il righello. */
const MADE = [0, .14, .45, .66, .80, .88, .92, .96, .99, 1];

/** Quanto vale la mano, da 0 a 1, con le carte che si vedono adesso. */
function handStrength(p) {
    const board = state.board.slice(0, state.shown);
    if (board.length === 0) {
        const [a, b] = p.cards;
        const pair = a.r === b.r;
        const high = Math.max(a.r, b.r);
        const suited = a.s === b.s;
        if (pair && high >= 10) return .8;
        if (pair) return .6;
        if (high >= 12 && suited) return .5;
        if (high >= 12) return .4;
        return .2;
    }

    const best = bestHand(p.cards, board);
    let s = MADE[best.score] + (best.kickers[0] - 2) / 12 * .06;
    // se la cinquina migliore non usa nessuna delle tue due carte stai
    // giocando il tavolo: vale per tutti, quindi non vale niente
    if (best.cards && !best.cards.some(c => p.cards.indexOf(c) >= 0)) s *= .55;
    return Math.min(1, s);
}


/* ============================================================
 * 4-bis. I VIZI
 *
 * Le soglie da sole non bastano a dare un carattere riconoscibile: su
 * 66 coppie di avversari, 12 differiscono di meno di 12 punti su 100 e
 * la coppia mediana richiede 18 mani per essere distinta — piu' di una
 * partita intera. Una soglia si legge in diciotto mani, una regola in
 * una: da qui i vizi.
 *
 * Ognuno scatta 4 volte su 5. Al 100% diventerebbero serrature: la
 * lettura sarebbe gratis e non ci sarebbe piu' niente da indovinare.
 * ============================================================ */

/** Il contesto che serve ai vizi, tutto gia' presente nello stato. */
function contesto(p) {
    const call = Math.max(0, state.currentBet - p.bet);
    const acted = state.acted || new Set();
    return {
        call,
        street: state.street,
        primo: call === 0 && acted.size === 0,            // parla per primo, nessuno ha puntato
        puoRilanciare: p.coins > call,
        primaMossa: !p.spoke,                              // prima mossa sua in questa mano
        flopPassato: state.flopChecked
    };
}

/** La mossa dettata dal vizio, oppure null per lasciar decidere le soglie. */
function tellMove(p, forza) {
    if (!p.vizio || Math.random() > TELL_P) return null;
    const c = contesto(p);
    const rilancia = () => c.puoRilanciare ? raiseDecision(p, forza) : null;
    const shove = () => c.puoRilanciare ? { type: 'raise', to: p.bet + p.coins } : null;

    switch (p.vizio) {
        // non apre mai le danze: se punta lui, ce l'ha
        case 'maiPrimo':
            return c.primo ? { type: 'check' } : null;

        // entrato nel piatto, al flop punta comunque
        case 'sempreAlFlop':
            return c.street === 'flop' && c.call === 0 ? rilancia() : null;

        // preflop non paga un rilancio senza una coppia grossa
        case 'soloCoppieGrosse': {
            if (c.street !== 'preflop' || c.call <= BIG_BLIND) return null;
            const [a, b] = p.cards;
            const coppiaGrossa = a.r === b.r && a.r >= 10;
            return coppiaGrossa ? null : { type: 'fold' };
        }

        // con la mano forte passa al flop e punta al turn: sempre la stessa trappola
        case 'trappolaAlFlop':
            if (c.street === 'flop' && c.call === 0 && forza > .6) return { type: 'check' };
            if (c.street === 'turn' && c.call === 0 && forza > .5) return rilancia();
            return null;

        // al river spinge tutto se il piatto vale piu' delle sue monete
        case 'shoveAlRiver':
            return c.street === 'river' && state.pot > p.coins ? shove() : null;

        // quando rilancia, rilancia della misura del piatto
        case 'misuraDelPiatto': {
            if (!c.puoRilanciare || forza < p.quirks.raise) return null;
            const to = Math.min(p.bet + p.coins,
                                Math.max(state.currentBet + state.minRaise, state.pot));
            return to > state.currentBet ? { type: 'raise', to } : null;
        }

        // la sua prima mossa di ogni mano e' a sorte, carte a parte
        case 'testaOCroce': {
            if (!c.primaMossa) return null;
            const r = Math.random();
            if (c.call === 0) return r < .5 ? { type: 'check' } : (rilancia() || { type: 'check' });
            if (r < .34) return { type: 'fold' };
            if (r < .74) return { type: 'call' };
            return rilancia() || { type: 'call' };
        }

        // non rilancia mai prima del river
        case 'maiPrimaDelRiver':
            return null;      // gestito a valle: il rilancio viene declassato

        // lascia a qualunque rilancio se non ha almeno doppia coppia
        case 'cedeAlRilancio':
            return c.call > 0 && forza < .64 ? { type: 'fold' } : null;

        // se al flop passano tutti, al turn punta lui, con qualunque cosa
        case 'turnDopoIlCheck':
            return c.street === 'turn' && c.flopPassato && c.call === 0 ? rilancia() : null;

        // apre sempre il primo giro di ogni mano che gioca
        case 'apreSempre':
            return c.street === 'preflop' && c.primaMossa ? rilancia() : null;

        // non lascia mai quando pagare costa una o due monete
        case 'paganoccia':
            return c.call > 0 && c.call <= 2 ? { type: 'call' } : null;
    }
    return null;
}

function npcDecision(p) {
    const q = p.quirks;
    const call = Math.max(0, state.currentBet - p.bet);
    const strength = handStrength(p);

    // il vizio, quando scatta, viene prima di tutto il resto
    const vizio = tellMove(p, strength);
    if (vizio) return frenaGrinder(p, vizio);

    // niente da pagare: si passa, salvo chi ha il vizio di aprire
    if (call === 0) {
        if (strength > q.raise && Math.random() < q.bluff * 1.5) {
            return frenaGrinder(p, raiseDecision(p, strength));
        }
        return { type: 'check' };
    }

    const actualCall = Math.min(call, p.coins);
    const callPct = p.coins > 0 ? actualCall / p.coins : 1;
    const wouldBeAllIn = call > p.coins;

    /* Il bluff vero si fa con le mani che altrimenti si butterebbero, quindi
     * va provato PRIMA di lasciare. Nella versione del 2025 stava dopo, e
     * siccome al flop la forza e' quasi sempre o carta alta (~0,20) o coppia
     * (~0,48), fra le due soglie non c'era quasi niente: chi aveva la soglia
     * di abbandono sopra 0,22 non bluffava mai, per quanto alto avesse il
     * tratto. The Trickster, il bluffatore per definizione, non bluffava. */
    if (strength < q.fold && !wouldBeAllIn &&
        callPct <= q.bluff * .8 + .08 && Math.random() < q.bluff * .45) {
        return frenaGrinder(p, raiseDecision(p, strength));
    }

    if (strength < q.fold) {
        if (wouldBeAllIn && strength > q.fold - .15 && Math.random() < q.loose * .5) return { type: 'call' };
        return { type: 'fold' };
    }

    /* Rilancio di valore. Il tetto di costo era `larghezza x 0,5`: per i
     * quattro caratteri stretti vale 0,1, cioe' meno di una puntata di 4 su
     * 20 monete — e non rilanciavano MAI, nemmeno col poker servito. Il
     * minimo di 0,25 glielo permette; a tenerli stretti resta la soglia
     * sulla forza della mano, che per loro e' altissima. */
    if (!wouldBeAllIn && strength > q.raise && callPct <= Math.max(q.loose * .5, .25)) {
        return Math.random() < .5 ? frenaGrinder(p, raiseDecision(p, strength)) : { type: 'call' };
    }

    /* Il bluff. Il tetto di costo era anche qui legato alla larghezza di
     * manica, cioe' al tratto sbagliato: The Trickster, che ha il valore di
     * bluff piu' alto del gioco, non bluffava mai con una puntata normale,
     * mentre The Maniac lo faceva. Adesso e' il bluff stesso a decidere
     * fin dove ci si spinge. */
    if (!wouldBeAllIn && Math.random() < q.bluff && callPct <= q.bluff * .8 + .08) {
        return Math.random() < .6 ? frenaGrinder(p, raiseDecision(p, strength)) : { type: 'call' };
    }

    if (wouldBeAllIn) {
        const allinThreshold = q.fold + .25 * (1 - q.loose);
        if (strength > allinThreshold) return { type: 'call' };
        if (strength > q.fold + .05 && Math.random() < q.loose * .6) return { type: 'call' };
    } else {
        const adjusted = q.loose * (1 + strength * .5);
        if (strength > q.fold + .1 && callPct <= adjusted) return { type: 'call' };
    }

    return { type: 'fold' };
}

/** Il vizio del Grinder non e' una mossa ma un divieto: qualunque rilancio
 *  prima del river gli viene declassato a vedere o passare. */
function frenaGrinder(p, move) {
    if (p.vizio !== 'maiPrimaDelRiver' || state.street === 'river') return move;
    if (move.type !== 'raise' || Math.random() > TELL_P) return move;
    return state.currentBet - p.bet > 0 ? { type: 'call' } : { type: 'check' };
}

function raiseDecision(p, strength) {
    const q = p.quirks;
    const minTo = Math.max(state.currentBet + state.minRaise, state.currentBet + 1);
    const maxTo = p.bet + p.coins;
    if (maxTo <= state.currentBet) return { type: 'call' };
    if (minTo >= maxTo) return { type: 'raise', to: maxTo };

    const range = maxTo - minTo;
    const shy = p.coins < 5 && strength < .7;      // non si butta a caso col poco che ha
    let to = minTo;

    if (strength < q.raise && Math.random() < q.bluff) {
        to += Math.floor(Math.random() * Math.min(range * .3, 5));
    } else {
        const mult = Math.min(strength * 1.5, 1.2);
        to += Math.floor(Math.random() * Math.min(range * q.loose, 10) * mult);
    }
    if (shy && to >= maxTo - 2) to = Math.max(minTo, maxTo - 3);

    return { type: 'raise', to: Math.min(to, maxTo) };
}

/* ============================================================
 * 6. LA MANO
 * ============================================================ */

/* `fast` serve al banco di prova: azzera le pause e fa girare
 * centinaia di mani in pochi secondi. */
const wait = ms => new Promise(r => setTimeout(r, state.fast ? 0 : ms));

function startHand() {
    state.hand++;
    state.deck = shuffle(makeDeck());
    state.deck.pop();                        // la carta bruciata, come al tavolo vero
    state.board = state.deck.splice(0, 5);
    state.shown = 0;
    state.pot = 0;
    state.currentBet = 0;
    state.minRaise = BIG_BLIND;
    state.street = 'preflop';
    state.phase = 'playing';

    state.flopChecked = false;
    for (const p of state.players) {
        p.folded = p.out;
        p.allIn = false;
        p.spoke = false;
        p.bet = 0;
        p.total = 0;
        p.hand = null;
        p.verdict = null;
        p.won = 0;
        p.cards = p.out ? [] : state.deck.splice(0, 2);
    }

    // il bottone del banco scorre di un posto
    state.dealer = nextSeat(state.dealer);

    const sb = nextSeat(state.dealer);
    const bb = nextSeat(sb);
    postBlind(sb, SMALL_BLIND);
    postBlind(bb, BIG_BLIND);
    state.currentBet = BIG_BLIND;
    state.minRaise = BIG_BLIND;

    return { sb, bb };
}

function postBlind(i, amount) {
    const p = state.players[i];
    const pay = Math.min(amount, p.coins);
    p.coins -= pay;
    p.bet += pay;
    p.total += pay;
    state.pot += pay;
    if (p.coins === 0) p.allIn = true;
}

async function playHand() {
    const { bb } = startHand();
    state.busy = true;
    els.btnDeal.hidden = true;
    render({ deal: true });
    say(`Blinds are in. ${state.players[state.dealer].isHuman ? 'You are' : state.players[state.dealer].name + ' is'} on the button.`);
    await wait(STREET_MS);

    for (let s = 0; s < STREETS.length; s++) {
        state.street = STREETS[s];
        state.shown = s === 0 ? 0 : s + 2;      // 0, 3, 4, 5

        if (s > 0) {
            for (const p of state.players) p.bet = 0;
            state.currentBet = 0;
            state.minRaise = BIG_BLIND;
            render({ turned: true });
            say(STREET_NAME[state.street] + '.');
            await wait(STREET_MS);
        }

        if (inHand().length <= 1) break;
        if (canAct().length >= 2 || (canAct().length === 1 && needsToCall())) {
            const first = s === 0 ? nextSeat(bb) : nextSeat(state.dealer);
            await bettingRound(first);
        }
        if (state.street === 'flop' && state.currentBet === 0) state.flopChecked = true;
        if (inHand().length <= 1) break;
    }

    state.toAct = -1;
    state.shown = 5;
    await showdown();
}

/** Vero se qualcuno deve ancora pareggiare la puntata. */
function needsToCall() {
    return inHand().some(p => !p.allIn && p.bet < state.currentBet);
}

function bettingDone() {
    if (inHand().length <= 1) return true;
    const live = canAct();
    if (live.length === 0) return true;
    if (live.length === 1 && !needsToCall()) return true;
    return live.every(p => state.acted.has(p) && p.bet === state.currentBet);
}

async function bettingRound(first) {
    state.acted = new Set();
    let i = state.players[first].folded || state.players[first].out ||
            state.players[first].allIn ? nextLive(first) : first;
    let guard = 0;

    while (i >= 0 && guard++ < 80) {
        if (bettingDone()) break;
        const p = state.players[i];
        if (p.out || p.folded || p.allIn || p.coins === 0) { i = nextLive(i); continue; }

        state.toAct = i;
        render();
        const move = p.isHuman ? await humanTurn(p) : await npcTurn(p);
        applyMove(p, move);
        state.acted.add(p);
        state.toAct = -1;
        render();
        await wait(p.isHuman ? 220 : ACT_MS);

        if (inHand().length <= 1) break;
        i = nextLive(i);
    }
    state.toAct = -1;
}

async function npcTurn(p) {
    await wait(340 + Math.random() * 380);
    return npcDecision(p);
}

function applyMove(p, move) {
    p.spoke = true;
    const call = Math.max(0, state.currentBet - p.bet);

    if (move.type === 'fold') {
        p.folded = true;
        p.verdict = 'fold';
        say(`${who(p)} folded.`);
        return;
    }
    if (move.type === 'check') { say(`${who(p)} checked.`); return; }

    if (move.type === 'call') {
        const pay = Math.min(call, p.coins);
        if (pay > 0) bet(p, pay);
        if (p.coins === 0) { p.allIn = true; say(`${who(p)} called all-in for ${pay}.`); }
        else say(`${who(p)} called ${pay}.`);
        return;
    }

    // rilancio (all-in compreso)
    const to = Math.min(move.to, p.bet + p.coins);
    const pay = to - p.bet;
    bet(p, pay);
    state.minRaise = Math.max(BIG_BLIND, to - state.currentBet);
    state.currentBet = to;
    state.acted = new Set([p]);          // dopo un rilancio devono riparlare tutti
    if (p.coins === 0) { p.allIn = true; say(`${who(p)} shoved to ${to}.`); }
    else say(`${who(p)} raised to ${to}.`);
}

function bet(p, amount) {
    p.coins -= amount;
    p.bet += amount;
    p.total += amount;
    state.pot += amount;
}

const who = p => p.isHuman ? 'You' : p.name;

/* --- il tuo turno --- */

function humanTurn(p) {
    return new Promise(resolve => {
        resolveHuman = resolve;
        showActions(p);
    });
}

function answer(move) {
    if (!resolveHuman) return;
    const r = resolveHuman;
    resolveHuman = null;
    els.actions.hidden = true;
    r(move);
}

function showActions(p) {
    const call = Math.max(0, state.currentBet - p.bet);
    const maxTo = p.bet + p.coins;
    const minTo = Math.min(Math.max(state.currentBet + state.minRaise, state.currentBet + 1), maxTo);
    const canRaise = maxTo > state.currentBet && p.coins > call;

    els.btnCall.textContent = call === 0 ? 'Check' : `Call ${Math.min(call, p.coins)}`;
    els.btnFold.disabled = false;
    els.btnCall.disabled = false;
    els.btnRaise.disabled = !canRaise;
    els.raiseDown.disabled = !canRaise;
    els.raiseUp.disabled = !canRaise;

    state.raiseTo = canRaise ? minTo : maxTo;
    state.raiseMin = minTo;
    state.raiseMax = maxTo;
    els.raiseVal.textContent = state.raiseTo;
    els.btnRaise.textContent = canRaise ? `Raise ${state.raiseTo}` : 'Raise';

    els.actions.hidden = false;
    say(call === 0 ? 'Your move — you can check.' : `Your move — ${call} to call.`, true);
}

function nudgeRaise(d) {
    state.raiseTo = Math.max(state.raiseMin, Math.min(state.raiseMax, state.raiseTo + d));
    els.raiseVal.textContent = state.raiseTo;
    els.btnRaise.textContent = `Raise ${state.raiseTo}`;
}

/* ============================================================
 * 7. PIATTI E RESA DEI CONTI
 * ============================================================ */

/** I piatti, laterali compresi. Le monete di chi ha lasciato la mano
 *  restano dentro: e' il piatto principale che se le prende. */
function buildPots() {
    const levels = [...new Set(state.players.filter(p => p.total > 0).map(p => p.total))]
        .sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lvl of levels) {
        let amount = 0;
        for (const p of state.players) amount += Math.max(0, Math.min(p.total, lvl) - prev);
        const eligible = state.players.filter(p => !p.folded && p.total >= lvl);
        if (amount > 0) pots.push({ amount, eligible });
        prev = lvl;
    }
    return pots;
}

async function showdown() {
    const alive = inHand();
    state.phase = 'over';

    if (alive.length === 1) {
        // tutti gli altri hanno lasciato: il piatto e' suo, carte coperte
        const w = alive[0];
        const pot = state.pot;
        w.coins += pot;
        w.won = pot;
        w.verdict = 'won';
        state.pot = 0;
        render();
        markWin(w, pot);
        say(w.isHuman ? `Everyone folded — you take ${pot}.`
                      : `Everyone folded — ${w.name} takes ${pot}.`, true);
    } else {
        for (const p of alive) p.hand = bestHand(p.cards, state.board);
        render({ turned: true });
        await wait(700);

        const pots = buildPots();
        const takings = new Map();
        for (const pot of pots) {
            const runners = pot.eligible.filter(p => !p.folded);
            if (!runners.length) continue;
            let best = runners[0].hand;
            for (const p of runners) if (cmpHands(p.hand, best) > 0) best = p.hand;
            const winners = runners.filter(p => cmpHands(p.hand, best) === 0);
            const share = Math.floor(pot.amount / winners.length);
            let rest = pot.amount - share * winners.length;
            for (const w of winners) {
                let take = share;
                if (rest > 0) { take++; rest--; }      // i resti al primo dopo il banco
                takings.set(w, (takings.get(w) || 0) + take);
            }
        }

        // prima si mostra chi aveva cosa, dal peggiore al migliore
        const order = [...alive].sort((a, b) => cmpHands(a.hand, b.hand));
        for (const p of order) {
            p.verdict = 'show';
            render();
            await wait(360);
        }

        for (const [p, amount] of takings) {
            p.coins += amount;
            p.won = amount;
            p.verdict = 'won';
        }
        state.pot = 0;
        render();

        const winners = [...takings.keys()];
        for (const w of winners) markWin(w, takings.get(w));
        const best = winners[0];
        if (winners.length > 1) {
            say(`Split pot — ${winners.map(who).join(' and ')} with ${best.hand.name}.`, true);
        } else if (best) {
            say(best.isHuman ? `You take ${best.won} with ${best.hand.name}.`
                             : `${best.name} takes ${best.won} with ${best.hand.name}.`, true);
        }
    }

    await wait(500);
    endHand();
}

function markWin(p, amount) {
    const i = state.players.indexOf(p);
    const seat = seatEls[i];
    if (!seat) return;
    seat.root.classList.add('won');
    const v = document.createElement('div');
    v.className = 'verdict win';
    v.textContent = '+' + amount;
    seat.root.appendChild(v);
}

function endHand() {
    const justOut = [];
    for (const p of state.players) {
        if (!p.out && p.coins === 0) { p.out = true; justOut.push(p); }
    }

    const me = state.players[0];
    const left = seated();

    render();
    savePrefs();

    if (me.out) {
        state.phase = 'gameover';
        say(`Busted after ${state.hand} hand${state.hand > 1 ? 's' : ''}.`, true);
        els.btnDeal.textContent = 'New game';
    } else if (left.length === 1) {
        state.phase = 'gameover';
        say('You took the whole table.', true);
        els.btnDeal.textContent = 'New game';
    } else {
        els.btnDeal.textContent = 'Next hand';
    }
    els.btnDeal.hidden = false;
    els.btnDeal.disabled = false;
    state.busy = false;

    reward(me.won > 0, justOut, left.length === 1);
}

/* ============================================================
 * 8. DISEGNO
 * ============================================================ */

const toKit = c => ({ rango: c.r === 14 ? 1 : c.r, seme: c.s });

function buildSeats() {
    els.seats.innerHTML = '';
    els.bets.innerHTML = '';
    seatEls.length = 0;
    for (let i = 0; i < 5; i++) {
        const seat = document.createElement('div');
        seat.className = 'seat' + (i === 0 ? ' mine' : '');
        seat.innerHTML =
            '<div class="seat-top">' +
              '<i class="dot"></i><span class="badges"></span><span class="seat-name"></span>' +
            '</div>' +
            '<div class="seat-sub">' +
              '<span class="seat-tag"></span>' +
              '<span class="seat-coins"><i class="chip"></i><b class="n">0</b></span>' +
            '</div>' +
            '<div class="seat-cards"></div>';
        els.seats.appendChild(seat);

        const bet = document.createElement('div');
        bet.className = 'bet';
        bet.hidden = true;
        bet.innerHTML = '<i class="chip"></i><span class="n">0</span>';
        els.bets.appendChild(bet);

        seatEls.push({
            root: seat,
            badges: seat.querySelector('.badges'),
            dot: seat.querySelector('.dot'),
            name: seat.querySelector('.seat-name'),
            coins: seat.querySelector('.seat-coins .n'),
            tag: seat.querySelector('.seat-tag'),
            cards: seat.querySelector('.seat-cards'),
            bet: bet,
            betN: bet.querySelector('.n')
        });
    }
}

/** Mette i posti sull'ellisse e sceglie le misure delle carte.
 *
 *  Due cose che vanno calcolate e non indovinate: l'altezza vera dei
 *  pod (dipende dal carattere di sistema, che sul telefono e' al 130%)
 *  e la fascia libera che resta in mezzo fra la coppia in alto e quella
 *  in basso — le carte comuni devono starci dentro, o finiscono sopra
 *  i posti laterali. */
function layout() {
    const W = els.felt.clientWidth, H = els.felt.clientHeight;
    if (W < 40 || H < 40) return;

    const podW = Math.round(Math.min(126, W * .34));
    const mineW = Math.round(Math.min(172, W * .46));
    const podCard = Math.max(20, Math.min(32, Math.round((podW - 16) / 2)));
    const mineCard = Math.max(30, Math.min(50, Math.round((mineW - 22) / 2)));

    const root = els.felt.style;
    root.setProperty('--pod-w', podW + 'px');
    root.setProperty('--mine-w', mineW + 'px');
    root.setProperty('--pod-card', podCard + 'px');
    root.setProperty('--mine-card', mineCard + 'px');

    // misura vera, non stima
    const podH = seatEls[1].root.offsetHeight || 92;
    const mineH = seatEls[0].root.offsetHeight || 112;

    const tableH = Math.min(H, W * 1.45);
    const cx = W / 2, cy = H / 2;
    const rx = (W - podW) / 2 - 2;
    const ry = Math.max(60, (tableH - Math.max(podH, mineH)) / 2 - 2);

    const SIN = SEAT_ANGLE.map(a => Math.sin(a * Math.PI / 180));
    const COS = SEAT_ANGLE.map(a => Math.cos(a * Math.PI / 180));

    // la fascia libera fra la coppia alta e quella bassa
    const bandTop = cy + ry * SIN[2] + podH / 2;
    const bandBot = cy + ry * SIN[1] - podH / 2;
    const band = Math.max(40, bandBot - bandTop);
    const byBand = Math.floor((band - 32) * 0.69);      // 32 = il piatto e l'aria
    const boardCard = Math.max(22, Math.min(42, Math.floor((W * .62 - 16) / 5), byBand));
    root.setProperty('--board-card', boardCard + 'px');
    // il centro va messo in mezzo alla FASCIA, non in mezzo al tavolo:
    // la fascia non e' simmetrica rispetto al centro dell'ellisse
    root.setProperty('--mid-y', Math.round((bandTop + bandBot) / 2) + 'px');

    for (let i = 0; i < 5; i++) {
        seatEls[i].root.style.left = (cx + rx * COS[i]) + 'px';
        seatEls[i].root.style.top = (cy + ry * SIN[i]) + 'px';
        // la puntata si spinge verso il centro, ma di lato: in mezzo ci
        // stanno il piatto e le carte comuni
        seatEls[i].bet.style.left = (cx + rx * .78 * COS[i]) + 'px';
        seatEls[i].bet.style.top = (cy + ry * .70 * SIN[i]) + 'px';
    }

    root.setProperty('--rail-x', Math.max(2, Math.round(cx - rx - podW * .28)) + 'px');
    root.setProperty('--rail-y', Math.max(2, Math.round(cy - ry - podH * .30)) + 'px');
}

function drawCards(box, cards, opts) {
    box.innerHTML = '';
    cards.forEach((card, i) => {
        const el = card ? Carte.el(toKit(card)) : Carte.dorso();
        if (opts && opts.anim) {
            el.classList.add(opts.anim);
            el.style.animationDelay = (i * 70) + 'ms';
        }
        box.appendChild(el);
    });
}

function render(opts) {
    for (let i = 0; i < 5; i++) {
        const p = state.players[i], s = seatEls[i];
        s.dot.style.background = p.hex;
        s.name.textContent = p.name;
        s.coins.textContent = p.coins;
        if (s.tag) s.tag.textContent = p.tag;

        s.root.classList.toggle('out', p.out);
        s.root.classList.toggle('folded', !p.out && p.folded);
        s.root.classList.toggle('live', state.toAct === i);

        // badge del banco e dei bui
        s.badges.innerHTML = '';
        if (!p.out && state.phase !== 'idle') {
            const sb = nextSeat(state.dealer), bb = nextSeat(sb);
            if (i === state.dealer) s.badges.innerHTML += '<span class="badge badge-d">D</span>';
            if (i === sb) s.badges.innerHTML += '<span class="badge badge-sb">SB</span>';
            if (i === bb) s.badges.innerHTML += '<span class="badge badge-bb">BB</span>';
        }

        // le carte: le tue sempre scoperte, quelle degli altri al confronto
        const reveal = p.isHuman || (state.phase === 'over' && !p.folded && p.hand);
        if (p.out || !p.cards.length) s.cards.innerHTML = '';
        else drawCards(s.cards, reveal ? p.cards : [null, null],
            opts && opts.deal ? { anim: 'dealt' } : null);

        // la puntata spinta al centro
        const show = p.bet > 0 && !p.out;
        s.bet.hidden = !show;
        if (show) s.betN.textContent = p.bet;
    }

    // carte comuni
    const board = state.board.slice(0, state.shown);
    drawCards(els.community, board, opts && opts.turned ? { anim: 'turned' } : null);

    els.pot.hidden = state.pot === 0;
    els.potAmount.textContent = state.pot;
    els.handPill.hidden = state.hand === 0;
    els.handNo.textContent = state.hand;
    els.phase.textContent = state.phase === 'playing' ? ' · ' + (STREET_NAME[state.street] || '') : '';

    layout();
}

function clearVerdicts() {
    document.querySelectorAll('.verdict').forEach(v => v.remove());
    seatEls.forEach(s => s.root.classList.remove('won'));
}

function say(text, big) {
    els.status.textContent = text;
    els.status.classList.toggle('big', !!big);
}

/* ============================================================
 * 9. PARTITA
 * ============================================================ */

function newGame() {
    state.players = newPlayers();
    state.hand = 0;
    state.dealer = Math.floor(Math.random() * 5);
    state.phase = 'idle';
    state.pot = 0;
    state.street = 'preflop';
    state.shown = 0;
    state.busy = false;
    resolveHuman = null;
    clearVerdicts();
    clearSeatGifs();
    els.actions.hidden = true;
    els.btnDeal.hidden = false;
    els.btnDeal.disabled = false;
    els.btnDeal.textContent = 'Deal';
    say("Texas hold'em. Blinds 1 and 2. Last one standing takes it.");
    fillWhosWho();
    render();
    savePrefs();
}

function onDeal() {
    if (state.busy) return;
    if (state.phase === 'gameover') { newGame(); return; }
    clearVerdicts();
    playHand();
}

/* ============================================================
 * 10. TEMI E PREFERENZE
 * ============================================================ */

function applyTheme(name, remember = true) {
    const real = name === 'random'
        ? THEMES[Math.floor(Math.random() * THEMES.length)]
        : name;
    document.documentElement.dataset.theme = real;
    if (remember) state.theme = name;

    requestAnimationFrame(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        if (bg) els.themeColor.setAttribute('content', bg);
        layout();
    });

    els.themeButtons.querySelectorAll('.opt').forEach(b =>
        b.classList.toggle('on', b.dataset.theme === state.theme));
    if (remember) savePrefs();
}

function savePrefs() {
    try { localStorage.setItem(STORE, JSON.stringify({ theme: state.theme })); }
    catch (_) { /* modalita' privata: pazienza */ }
}

function loadPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(STORE) || '{}');
        if (p.theme) state.theme = p.theme;
    } catch (_) { /* niente */ }
}

function fillWhosWho() {
    els.whosWho.innerHTML = state.players.slice(1).map(p =>
        `<li><i class="dot" style="background:${p.hex}"></i><b>${p.name}</b><span>${p.tag}</span></li>`
    ).join('');
}

/* ============================================================
 * 11. EASTER EGG: le GIF
 *
 * Tre tocchi sul titolo aprono il selettore. Lo zip carica in
 * sottofondo senza fermare la mano. Ogni avversario si prende
 * un'immagine come sfondo del suo posto — ferma, un fotogramma solo.
 * Quando vinci un piatto, chi ci aveva messo monete te la mostra
 * animata: tre secondi per moneta versata, piu' quindici se e' finito
 * fuori. Vinto il tavolo, girano tutte per due minuti.
 * ============================================================ */

let pool = [];
let seatGif = [null, null, null, null];
let loading = false, loadToken = 0, loadTotal = 0;
let tapCount = 0, tapTimer = null;

const IMAGE_RE = /\.(gif|jpe?g|png|webp|avif|bmp)$/i;
const MIME = {
    gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp'
};

function onTitleTap() {
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 520);
    if (tapCount >= 3) { tapCount = 0; clearTimeout(tapTimer); els.fileInput.click(); }
}

async function handleFiles(files) {
    if (!files.length) return;
    const zips = files.filter(f => /\.zip$/i.test(f.name) || f.type === 'application/zip');
    const imgs = files.filter(f => IMAGE_RE.test(f.name) || /^image\//.test(f.type));
    if (!zips.length && !imgs.length) { toast('No images found'); return; }

    const token = ++loadToken;
    loading = true;
    loadTotal = 0;
    setProgress(0, 1);
    for (const it of pool) URL.revokeObjectURL(it.url);
    pool = [];
    updatePoolInfo();

    const queue = imgs.map(f => ({ name: f.name, blob: f }));
    for (const z of zips) {
        if (typeof JSZip === 'undefined') { toast('Zip support missing'); break; }
        try {
            const zip = await new JSZip().loadAsync(z);
            if (token !== loadToken) return;
            Object.values(zip.files)
                .filter(f => !f.dir && IMAGE_RE.test(f.name))
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(e => queue.push({ name: e.name, entry: e }));
        } catch (err) { toast('Could not read the zip'); }
    }
    if (token !== loadToken) return;
    if (!queue.length) { endLoad(token); toast('No images found'); return; }

    loadTotal = queue.length;
    toast(`${queue.length} images · keep playing while they load`);

    for (let i = 0; i < queue.length; i++) {
        if (token !== loadToken) return;
        const it = queue[i];
        let blob = it.blob;
        if (!blob) {
            blob = await it.entry.async('blob');
            if (token !== loadToken) return;
            if (!blob.type) {
                const ext = it.name.split('.').pop().toLowerCase();
                blob = new Blob([blob], { type: MIME[ext] || 'image/gif' });
            }
        }
        pool.push({ name: it.name, url: URL.createObjectURL(blob) });
        setProgress(pool.length, queue.length);
        updatePoolInfo();
        if (pool.length === 4) dressSeats();
        if (i % 4 === 3) await wait(0);
    }

    endLoad(token);
    if (pool.length >= 4) dressSeats();
    toast(`${pool.length} image${pool.length > 1 ? 's' : ''} ready`);
}

function endLoad(token) {
    if (token !== loadToken) return;
    loading = false;
    loadTotal = 0;
    setProgress(0, 0);
    updatePoolInfo();
}

function setProgress(done, total) {
    if (!total) { els.progress.hidden = true; return; }
    els.progress.hidden = false;
    els.progressFill.style.width = Math.round((done / total) * 100) + '%';
}

function updatePoolInfo() {
    els.poolInfo.textContent = loading
        ? (loadTotal ? `${pool.length} of ${loadTotal} loaded` : 'opening the zip…')
        : (pool.length ? `${pool.length} images loaded` : '');
}

async function dressSeats() {
    if (pool.length < 4) return;
    const pick = shuffle([...pool.keys()]).slice(0, 4);
    seatGif = pick.slice();
    for (let i = 0; i < 4; i++) {
        const url = await stillFrame(pool[pick[i]].url);
        const seat = seatEls[i + 1].root;
        let bg = seat.querySelector('.seat-gif');
        if (!bg) { bg = document.createElement('div'); bg.className = 'seat-gif'; seat.appendChild(bg); }
        bg.style.backgroundImage = `url(${url})`;
        seat.classList.add('has-gif');
    }
}

/** Un fotogramma solo: quattro GIF animate attorno al tavolo lo
 *  renderebbero illeggibile. */
function stillFrame(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement('canvas');
                const k = Math.min(1, 420 / Math.max(img.width, img.height));
                c.width = Math.max(1, Math.round(img.width * k));
                c.height = Math.max(1, Math.round(img.height * k));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                resolve(c.toDataURL('image/jpeg', .82));
            } catch (_) { resolve(url); }
        };
        img.onerror = () => resolve(url);
        img.src = url;
    });
}

function clearSeatGifs() {
    for (const s of seatEls) {
        s.root.classList.remove('has-gif');
        const bg = s.root.querySelector('.seat-gif');
        if (bg) bg.remove();
    }
    if (pool.length >= 4) dressSeats();
}

/* --- il premio --- */

let prizeTimer = null, prizeTick = null, prizeQueue = [];

function reward(humanWon, justOut, tableCleared) {
    if (pool.length < 4) return;
    const takers = [];

    if (humanWon) {
        // chi ha messo monete in quel piatto, dal piu' esposto al meno
        for (let i = 1; i < 5; i++) {
            const p = state.players[i];
            if (p.total > 0 && seatGif[i - 1] != null) {
                takers.push({ i, chips: p.total, out: p.out });
            }
        }
    } else {
        for (const p of justOut) {
            const i = state.players.indexOf(p);
            if (i > 0 && p.total > 0 && seatGif[i - 1] != null) {
                takers.push({ i, chips: p.total, out: true });
            }
        }
    }
    if (!takers.length) return;
    takers.sort((a, b) => b.chips - a.chips);

    if (tableCleared) {
        // tavolo ripulito: girano tutte per due minuti, quindici secondi l'una
        prizeQueue = [];
        for (let k = 0; k < 8; k++) {
            const t = takers[k % takers.length];
            prizeQueue.push({ url: pool[seatGif[t.i - 1]].url, secs: 15 });
        }
    } else {
        prizeQueue = takers.map(t => ({
            url: pool[seatGif[t.i - 1]].url,
            secs: t.chips * 3 + (t.out ? 15 : 0)
        }));
    }
    setTimeout(nextPrize, 1100);
}

function nextPrize() {
    if (!prizeQueue.length) { hidePrize(); return; }
    const { url, secs } = prizeQueue.shift();
    els.prizeImg.src = url;
    els.prizeOverlay.hidden = false;

    let left = secs;
    els.prizeCount.textContent = left + 's';
    clearInterval(prizeTick);
    prizeTick = setInterval(() => {
        left--;
        els.prizeCount.textContent = Math.max(0, left) + 's';
    }, 1000);

    clearTimeout(prizeTimer);
    prizeTimer = setTimeout(nextPrize, secs * 1000);
}

function hidePrize() {
    clearTimeout(prizeTimer);
    clearInterval(prizeTick);
    prizeQueue = [];
    els.prizeOverlay.hidden = true;
    els.prizeImg.src = '';
}

/* ============================================================
 * 12. VARIE
 * ============================================================ */

let toastTimer = null;
function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
}

function openMenu() {
    els.menu.hidden = false;
    els.scrim.hidden = false;
    els.menuToggle.setAttribute('aria-expanded', 'true');
    updatePoolInfo();
}
function closeMenu() {
    els.menu.hidden = true;
    els.scrim.hidden = true;
    els.menuToggle.setAttribute('aria-expanded', 'false');
}

function isCapacitorNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
              window.Capacitor.isNativePlatform());
}

/* ============================================================
 * 13. AVVIO
 * ============================================================ */

function init() {
    const id = s => document.getElementById(s);
    Object.assign(els, {
        felt: id('felt'), seats: id('seats'), bets: id('bets'),
        community: id('community'), pot: id('pot'), potAmount: id('potAmount'),
        phase: id('phase'), foot: id('foot'),
        title: id('title'), themeColor: id('themeColor'),
        handPill: id('handPill'), handNo: id('handNo'),
        status: id('status'), actions: id('actions'),
        btnFold: id('btnFold'), btnCall: id('btnCall'), btnRaise: id('btnRaise'),
        btnAllIn: id('btnAllIn'), raiseUp: id('raiseUp'), raiseDown: id('raiseDown'),
        raiseVal: id('raiseVal'), btnDeal: id('btnDeal'),
        menu: id('menu'), scrim: id('scrim'), menuToggle: id('menuToggle'),
        themeButtons: id('themeButtons'), newGameBtn: id('newGame'),
        whosWho: id('whosWho'), poolInfo: id('poolInfo'), fileInput: id('fileInput'),
        progress: id('progress'), progressFill: id('progressFill'),
        prizeOverlay: id('prizeOverlay'), prizeImg: id('prizeImg'),
        prizeCount: id('prizeCount'), toast: id('toast')
    });

    if (isCapacitorNative()) document.body.classList.add('capacitor');

    loadPrefs();
    buildSeats();
    applyTheme(state.theme, false);
    newGame();

    els.btnDeal.addEventListener('click', onDeal);
    els.newGameBtn.addEventListener('click', () => { closeMenu(); newGame(); });

    els.btnFold.addEventListener('click', () => answer({ type: 'fold' }));
    els.btnCall.addEventListener('click', () => {
        const p = state.players[0];
        answer({ type: state.currentBet - p.bet <= 0 ? 'check' : 'call' });
    });
    els.btnRaise.addEventListener('click', () => answer({ type: 'raise', to: state.raiseTo }));
    els.btnAllIn.addEventListener('click', () => {
        const p = state.players[0];
        const to = p.bet + p.coins;
        answer(to <= state.currentBet ? { type: 'call' } : { type: 'raise', to });
    });
    els.raiseUp.addEventListener('click', () => nudgeRaise(1));
    els.raiseDown.addEventListener('click', () => nudgeRaise(-1));

    els.menuToggle.addEventListener('click', openMenu);
    els.scrim.addEventListener('click', closeMenu);
    els.themeButtons.addEventListener('click', e => {
        const b = e.target.closest('.opt');
        if (b) applyTheme(b.dataset.theme);
    });

    els.title.addEventListener('click', onTitleTap);
    els.fileInput.addEventListener('change', e => {
        const picked = Array.from(e.target.files || []);
        e.target.value = '';        // azzerare qui svuoterebbe la FileList viva
        handleFiles(picked);
    });
    els.prizeOverlay.addEventListener('click', nextPrize);

    if (window.ResizeObserver) {
        new ResizeObserver(() => layout()).observe(els.felt);
        new ResizeObserver(() => layout()).observe(els.foot);
    }
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 90); });
    window.addEventListener('orientationchange', () => setTimeout(layout, 200));

    requestAnimationFrame(layout);
    updatePoolInfo();
}

document.addEventListener('DOMContentLoaded', init);

/* gancio per il collaudo automatico */
window.__holdemz = {
    state, evalFive, bestHand, cmpHands, buildPots, makeDeck, shuffle,
    npcDecision, handStrength, newGame, onDeal, CAST,
    answer: m => answer(m),
    waitingForYou: () => !!resolveHuman
};
