/* carte.js — kit-carte: la carta da mazzo francese, riutilizzabile.
   Estratta da scalaquaranta (js/sq-card.js), ripulita da ogni regola di gioco.

   USO MINIMO
     <link rel="stylesheet" href="carte.css">
     <script src="carte.js"></script>
     var el = Carte.el({ rango: 1, seme: 'P' });          // asso di picche
     var el = Carte.el({ jolly: true });                  // jolly
     var el = Carte.el({ rango: 12, seme: 'C' }, { scelta: true });
     var el = Carte.dorso();                              // carta coperta (tallone, pile)

   LA TAGLIA
     Una sola leva: la custom property --carta-w. Tutto il resto (bordo, raggio,
     corpo, tipografia, ombre) e' calcolato da li'.
       .mia-mano  { --carta-w: 56px }   -- in mano
       .mie-pile  { --carta-w: 44px }   -- sulle pile
       .mie-scale { --carta-w: 33px }   -- combinazioni lunghe
     Nessuna misura fissa: la stessa carta regge 33px e 90px senza cambiare regole.

   PERCHE' E' FATTA COSI' (le proprieta' che non vanno perse)
     1. Mazzo a 4 COLORI (picche navy, cuori rosa-rosso, quadri arancione,
        fiori verde-teal). A carta coperta all'80% il colore da solo dice il seme.
     2. La STRISCIA SINISTRA e' sacra: banda piena del colore del seme, a piena
        altezza, con rango bianco grande. E' l'unica cosa su cui contiamo sotto
        occlusione: misurata, una scala monoseme da 11 carte scende a ~12px
        visibili per carta e rango + seme restano entrambi leggibili.
     3. Il corpo (la faccia) e' DECORAZIONE SACRIFICABILE, ma quando la carta e'
        scoperta deve sembrare una carta da gioco e non una cella di tabella:
        pip nella disposizione classica, ornamento sulle figure, medaglione
        sull'asso. Tutto SVG: nessuna immagine, nessun font esterno.
     4. Niente figure umane: nel corpo restano ~24px di larghezza disegnabile e a
        quella taglia una persona diventa una macchia a forma di vaso. Legge
        invece un ORNAMENTO con silhouette riconoscibile: corona spigolosa (re),
        diadema forato con perla (regina), berretto con piuma asimmetrica (fante).
     5. Il jolly non porta MAI la lettera J (si confondeva col fante): viola a
        righe diagonali + stella.
     6. Lo stato "scelta" parla solo con segnali di CONTORNO (bordo, anello,
        alone, sottolineatura), cosi' si vede anche se della carta e' visibile
        solo la striscia sinistra.

   ADATTARE IL MAZZO (mazzi non francesi, altre lingue, altri colori)
     Carte.configura({
       semi: {
         P: { nome: 'spade', simbolo: '♠', colore: '#1d3faa', striscia: '#17318a',
              sagoma: '<path d="..."/>' }        // riquadro 0..100
       },
       etichette: { 1: 'A', 8: 'F', 9: 'C', 10: 'R' },   // rango -> etichetta
       figure:    { F: 'fante', C: 'regina', R: 're' },  // etichetta -> ornamento
       alte:      ['A', 'F', 'C', 'R'],                  // chi porta la banda d'oro
       coperta:   { colore: '#8d161d', colore2: '#c0262f' }
     });
   Ogni chiave e' opzionale e si fonde con la precedente. I colori finiscono in
   custom property (--seme-P ...), quindi si possono anche solo scrivere in CSS.
*/
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var SPRITE_ID = 'kit-carte-sagome';
  var PREFISSO = 'kcs-';           /* prefisso degli <symbol> nello sprite */

  /* ------------------------------------------------------------------ sagome */
  /* I semi sono PATH, non glifi di font: a 33px un glifo di sistema si sfarina e
     cambia da macchina a macchina, un path no. Riquadro 0..100. */
  var SAGOMA = {
    P: '<path d="M50 5C44 21 22 35 14 47c-8 12-6 26 6 31 10 4 20-1 25-9-1 10-5 18-13 24h36c-8-6-12-14-13-24 5 8 15 13 25 9 12-5 14-19 6-31C78 35 56 21 50 5Z"/>',
    C: '<path d="M50 93C26 75 8 59 8 39 8 23 20 12 32 12c9 0 15 5 18 12 3-7 9-12 18-12 12 0 24 11 24 27 0 20-18 36-42 54Z"/>',
    Q: '<path d="M50 4 88 50 50 96 12 50Z"/>',
    F: '<circle cx="50" cy="26" r="19"/><circle cx="24" cy="61" r="19"/><circle cx="76" cy="61" r="19"/>' +
       '<path d="M46 54c0 18-4 32-14 41h36c-10-9-14-23-14-41Z"/>',
    /* stella a 5 punte: il jolly non ha seme, ha la stella (mai la lettera J) */
    J: '<path d="M50 4 61.2 34.6 93.8 35.8 68.1 55.9 77 87.2 50 69 23 87.2 31.9 55.9 6.2 35.8 38.8 34.6Z"/>'
  };

  /* ------------------------------------------------- disposizione dei pip */
  /* colonne sinistra / centro / destra dentro il riquadro faccia 40 x 100 */
  var XL = 11.5, XC = 20, XR = 28.5;

  var SCHEMI = {
    2:  { d: 15,   p: [[XC, 20], [XC, 80]] },
    3:  { d: 15,   p: [[XC, 17], [XC, 50], [XC, 83]] },
    4:  { d: 14.5, p: [[XL, 20], [XR, 20], [XL, 80], [XR, 80]] },
    5:  { d: 14.5, p: [[XL, 20], [XR, 20], [XC, 50], [XL, 80], [XR, 80]] },
    6:  { d: 13,   p: [[XL, 17], [XR, 17], [XL, 50], [XR, 50], [XL, 83], [XR, 83]] },
    7:  { d: 13,   p: [[XL, 15], [XR, 15], [XC, 32.5], [XL, 50], [XR, 50], [XL, 85], [XR, 85]] },
    8:  { d: 13,   p: [[XL, 15], [XR, 15], [XC, 32.5], [XL, 50], [XR, 50], [XC, 67.5], [XL, 85], [XR, 85]] },
    9:  { d: 11.5, p: [[XL, 14], [XR, 14], [XL, 38], [XR, 38], [XC, 50], [XL, 62], [XR, 62], [XL, 86], [XR, 86]] },
    10: { d: 11.5, p: [[XL, 13], [XR, 13], [XC, 26], [XL, 39], [XR, 39], [XL, 61], [XR, 61], [XC, 74], [XL, 87], [XR, 87]] }
  };

  /* ------------------------------------------------------------- ornamenti */
  /* Mezzo ornamento, riquadro 40 x 50: la carta lo ripete ruotato di 180 gradi,
     come le figure a due teste dei mazzi veri.
     La fascia sotto e' comune a tutti e tre: e' quella che dice "carta di figura"
     anche quando il resto e' coperto. Quello che li distingue e' la SILHOUETTE:
       re     = spigoloso (punte + perle)
       regina = tondo e forato al centro (arco, non cupola piena)
       fante  = asimmetrico (la piuma sfonda a destra) */
  var FASCIA = '<path d="M8.2 28.4H31.8V33.4H8.2Z"/>';

  var ORNAMENTO = {
    /* re: corona a cinque punte con tre perle */
    re: FASCIA +
        '<path d="M8.2 28.4V9.2L14.1 18.4L20 6.4L25.9 18.4L31.8 9.2V28.4Z"/>' +
        '<circle cx="8.6" cy="7.6" r="2"/>' +
        '<circle cx="20" cy="4.6" r="2.4"/>' +
        '<circle cx="31.4" cy="7.6" r="2"/>',

    /* regina: diadema ad arco BUCATO (e' il buco che lo distingue dalla corona)
       piu' la perla sospesa sopra */
    regina: FASCIA +
        '<path fill-rule="evenodd" d="' +
          'M8.2 28.4C8.2 15.4 13.4 9.4 20 9.4C26.6 9.4 31.8 15.4 31.8 28.4Z' +
          'M13.6 28.4C13.6 19.4 16.4 15.2 20 15.2C23.6 15.2 26.4 19.4 26.4 28.4Z' +
        '"/>' +
        '<circle cx="20" cy="4.8" r="2.9"/>',

    /* fante: berretto morbido con la piuma che esce dal riquadro a destra */
    fante: FASCIA +
        '<path d="M8.2 28.4C8.2 17.6 12.6 12.2 20 12.2C26.1 12.2 29.9 15.9 29.9 21.6V28.4Z"/>' +
        '<path d="M28.6 22.2C32.4 14.6 34.9 10.6 38.6 7.2C37.8 14.4 34.8 20.1 30.9 24.2Z"/>'
  };

  /* ------------------------------------------------------ configurazione */
  var CFG;

  function difetto() {
    return {
      ordine: ['P', 'C', 'Q', 'F'],
      semi: {
        /* striscia = variante del colore che regge il testo bianco sopra.
           Quadri e jolly vanno approfonditi, altrimenti a 33px il bianco
           sopra l'arancione non tiene. */
        P: { nome: 'picche', simbolo: '♠', colore: '#1d3faa', striscia: null, sagoma: SAGOMA.P },
        C: { nome: 'cuori',  simbolo: '♥', colore: '#e11d48', striscia: null, sagoma: SAGOMA.C },
        Q: { nome: 'quadri', simbolo: '♦', colore: '#ea580c', striscia: '#d24a06', sagoma: SAGOMA.Q },
        F: { nome: 'fiori',  simbolo: '♣', colore: '#0d7d6e', striscia: null, sagoma: SAGOMA.F },
        J: { nome: 'jolly',  simbolo: '★', colore: '#8b5cf6', striscia: '#7c3aed', sagoma: SAGOMA.J }
      },
      etichette: { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' },
      figure: { J: 'fante', Q: 'regina', K: 're' },
      alte: ['A', 'J', 'Q', 'K'],
      coperta: { colore: '#8d161d', colore2: '#c0262f', filetto: 'rgba(255,255,255,.62)' }
    };
  }

  function mappa(lista) {
    var m = {}, i;
    for (i = 0; i < lista.length; i++) m[lista[i]] = 1;
    return m;
  }

  function radice() {
    return document.documentElement;
  }

  /* I colori vivono in custom property, e la precedenza e':
        default della libreria  <  CSS dell'app  <  Carte.configura()
     Percio' i default NON vengono scritti su :root all'avvio (finirebbero in
     style inline, che batte qualunque foglio di stile dell'app e renderebbe
     impossibile cambiare i colori dal CSS). Restano dove devono stare: nel
     fallback di var(). Su :root finisce solo cio' che e' stato chiesto a mano. */
  function applicaSeme(k) {
    var r = radice(), s = CFG.semi[k];
    if (!r || !s) return;
    r.style.setProperty('--seme-' + k, s.colore);
    r.style.setProperty('--seme-' + k + '-str', s.striscia || s.colore);
  }

  function scordaColori(chiavi) {
    var r = radice(), i;
    if (!r) return;
    for (i = 0; i < chiavi.length; i++) {
      r.style.removeProperty('--seme-' + chiavi[i]);
      r.style.removeProperty('--seme-' + chiavi[i] + '-str');
    }
    r.style.removeProperty('--dorso-a');
    r.style.removeProperty('--dorso-b');
    r.style.removeProperty('--dorso-filetto');
  }

  function chiavi(o) {
    var a = [], k;
    for (k in o) a.push(k);
    return a;
  }

  /* --------------------------------------------------------------- sprite */
  /* un solo esemplare di ogni sagoma nel documento, poi <use> in ogni carta:
     40 carte a schermo non sono 400 path. */
  function sprite(rifai) {
    var s = document.getElementById(SPRITE_ID);
    if (s && !rifai) return;

    if (!s) {
      s = document.createElementNS(NS, 'svg');
      s.id = SPRITE_ID;
      s.setAttribute('aria-hidden', 'true');
      s.setAttribute('focusable', 'false');
      s.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      (document.body || document.documentElement).appendChild(s);
    }

    /* I simboli si SOSTITUISCONO uno per uno, non si rifa' lo sprite da capo:
       un <use> punta a un id, e buttare via lo sprite intero svuoterebbe le
       carte gia' disegnate che usano un seme non piu' in configurazione
       (succede a ogni Carte.reimposta() dopo un mazzo adattato). */
    var tmp = document.createElementNS(NS, 'svg');
    var m = '', k;
    for (k in CFG.semi) {
      if (!CFG.semi[k].sagoma) continue;
      m += '<symbol id="' + PREFISSO + k + '" viewBox="0 0 100 100">' + CFG.semi[k].sagoma + '</symbol>';
    }
    tmp.innerHTML = m;
    while (tmp.firstChild) {
      var nuovo = tmp.firstChild;
      var vecchio = document.getElementById(nuovo.id);
      if (vecchio && vecchio.parentNode === s) s.replaceChild(nuovo, vecchio);
      else s.appendChild(nuovo);
    }
  }

  function usa(seme, cx, cy, d, giu) {
    var h = d / 2;
    return '<use href="#' + PREFISSO + seme + '" x="' + (cx - h) + '" y="' + (cy - h) +
           '" width="' + d + '" height="' + d + '"' +
           (giu ? ' transform="rotate(180 ' + cx + ' ' + cy + ')"' : '') + '/>';
  }

  /* ---------------------------------------------------------- la faccia */
  /* riquadro 40 x 100, cioe' esattamente il rapporto del corpo della carta:
     le sagome non si deformano mai e tutto scala da --carta-w e basta. */
  function faccia(seme, et, jolly, rango) {
    var g = '';

    if (jolly) {
      g = usa('J', 20, 50, 25) + usa('J', 20, 18, 13) + usa('J', 20, 82, 13);

    } else if (CFG.figure[et]) {
      /* ornamento in testa e in coda come le figure a due teste dei mazzi veri,
         piu' il pip del seme al centro: e' quello che lega le figure alle carte
         numeriche e restituisce la "carta-ita'" anche a 33px.
         translate(0,5): la banda d'oro delle carte alte mangia la primissima
         striscia del corpo, e senza questo rientro le perle in cima al re e alla
         regina finiscono tagliate. */
      var orn = '<g transform="translate(0 5)">' +
                (ORNAMENTO[CFG.figure[et]] || CFG.figure[et]) + '</g>';
      g = orn + '<g transform="rotate(180 20 50)">' + orn + '</g>' + usa(seme, 20, 50, 19);

    } else if (rango === 1) {
      /* asso: medaglione, come sull'asso di picche dei mazzi veri */
      g = '<circle cx="20" cy="50" r="16.4" fill="none" stroke="currentColor" ' +
          'stroke-width="1" stroke-opacity=".3"/>' +
          '<circle cx="20" cy="50" r="13.6" fill="none" stroke="currentColor" ' +
          'stroke-width=".6" stroke-opacity=".22"/>' +
          usa(seme, 20, 50, 21);

    } else {
      var s = SCHEMI[rango];
      if (!s) return '';                       /* rango fuori scala: corpo nudo */
      for (var i = 0; i < s.p.length; i++) {
        g += usa(seme, s.p[i][0], s.p[i][1], s.d, s.p[i][1] > 50);
      }
    }

    return '<svg class="carta__faccia" viewBox="0 0 40 100" preserveAspectRatio="xMidYMid meet" ' +
           'aria-hidden="true" focusable="false">' + g + '</svg>';
  }

  /* ------------------------------------------------------------- utilita' */
  function span(cls, testo) {
    var s = document.createElement('span');
    s.className = cls;
    if (testo != null) s.textContent = testo;
    return s;
  }

  function etichetta(rango) {
    return CFG.etichette[rango] != null ? String(CFG.etichette[rango]) : String(rango);
  }

  function taglia(d, opz) {
    if (opz.w) d.style.setProperty('--carta-w', typeof opz.w === 'number' ? opz.w + 'px' : opz.w);
    if (opz.classe) d.className += ' ' + opz.classe;
    if (opz.id != null) d.dataset.id = opz.id;
  }

  /* -------------------------------------------------------------- LA CARTA */
  function el(carta, opz) {
    opz = opz || {};
    carta = carta || {};
    sprite();

    var jolly  = !!carta.jolly;
    var seme   = jolly ? 'J' : carta.seme;
    var info   = CFG.semi[seme] || CFG.semi[CFG.ordine[0]];
    var rango  = jolly ? 0 : Number(carta.rango);
    var et     = jolly ? '★' : etichetta(rango);
    var scelta = !!(opz.scelta || opz.selezionata);

    var d = document.createElement('div');
    var cls = 'carta';
    if (jolly) cls += ' carta--jolly';
    else {
      if (CFG._alte[et]) cls += ' carta--alta';
      if (CFG.figure[et]) cls += ' carta--figura';
      if (et.length > 1) cls += ' carta--lungo';   /* "10" e simili: rango stretto */
    }
    if (scelta) cls += ' is-scelta';
    if (opz.spenta) cls += ' is-spenta';
    d.className = cls;

    if (carta.id != null) d.dataset.id = carta.id;
    d.dataset.seme = seme;
    d.dataset.rango = jolly ? 'JLY' : et;

    /* Il colore del seme lo lega la carta, non il foglio di stile: carte.css sa
       solo dei quattro semi francesi, e un mazzo adattato (bastoni, denari...)
       resterebbe grigio. Il valore passa comunque da --seme-<K>, quindi
       riscrivere quella custom property in CSS continua a comandare. */
    /* La catena e' a tre livelli e l'ordine conta:
         --seme-K-str  (l'app ha chiesto proprio la striscia)
         --seme-K      (l'app ha cambiato il colore: la striscia lo segue)
         default       (nessuno ha chiesto niente: qui vive l'approfondimento
                        di quadri e jolly, dove il bianco sopra non terrebbe)
       Senza il livello di mezzo, cambiare --seme-P dal CSS tingeva i pip ma
       lasciava la striscia del colore di fabbrica. */
    d.style.setProperty('--col-seme', 'var(--seme-' + seme + ', ' + info.colore + ')');
    d.style.setProperty('--col-str', 'var(--seme-' + seme + '-str, var(--seme-' + seme +
      ', ' + (info.striscia || info.colore) + '))');

    /* banda d'oro: sempre nel DOM, mostrata dal CSS solo sulle carte alte */
    d.appendChild(span('carta__banda'));

    var testa = span('carta__testa');
    testa.appendChild(span('carta__rango', et));
    if (!jolly) testa.appendChild(span('carta__seme', info.simbolo));
    d.appendChild(testa);

    var corpo = span('carta__corpo');
    corpo.innerHTML = faccia(seme, et, jolly, rango);
    d.appendChild(corpo);

    d.setAttribute('aria-label', opz.aria || (jolly ? 'jolly' : et + ' di ' + info.nome) +
      (scelta ? ', scelta' : ''));

    taglia(d, opz);
    return d;
  }

  /* -------------------------------------------------------------- IL DORSO */
  /* La carta coperta: talloni, pile coperte, mani avversarie. Stesso box della
     carta scoperta (stesse misure, stesso bordo, stessa ombra, stesso
     isolation), quindi si impila e si sovrappone insieme alle altre. */
  function dorso(opz) {
    opz = opz || {};
    var d = document.createElement('div');
    d.className = 'carta carta--dorso' + (opz.spenta ? ' is-spenta' : '') +
                  (opz.scelta ? ' is-scelta' : '');
    d.dataset.rango = 'DORSO';
    /* di norma il dorso prende --dorso-a/-b (da CSS o da Carte.configura), ma
       si puo' anche chiedere un dorso diverso qui e ora: serve quando in scena
       ci sono due mazzi distinti (il tuo e quello dell'avversario). */
    if (opz.colore)  d.style.setProperty('--dorso-a', opz.colore);
    if (opz.colore2) d.style.setProperty('--dorso-b', opz.colore2);
    if (opz.filetto) d.style.setProperty('--dorso-filetto', opz.filetto);
    d.appendChild(span('carta__retro'));
    d.setAttribute('aria-label', opz.aria || 'carta coperta');
    taglia(d, opz);
    return d;
  }

  /* ------------------------------------------------------------ CONFIGURA */
  function configura(opz) {
    opz = opz || {};
    var k;

    if (opz.semi) {
      for (k in opz.semi) {
        if (!CFG.semi[k]) CFG.semi[k] = { nome: k, simbolo: '', colore: '#444', sagoma: '' };
        var src = opz.semi[k], dst = CFG.semi[k], p;
        for (p in src) dst[p] = src[p];
        /* su :root va solo il colore chiesto qui, non tutta la tavolozza */
        if (src.colore || src.striscia) applicaSeme(k);
      }
    }
    if (opz.ordine)    CFG.ordine = opz.ordine.slice();
    if (opz.etichette) CFG.etichette = opz.etichette;
    if (opz.figure)    CFG.figure = opz.figure;
    if (opz.alte)      CFG.alte = opz.alte.slice();

    if (opz.coperta) {
      var r = radice();
      for (k in opz.coperta) CFG.coperta[k] = opz.coperta[k];
      if (r) {
        if (opz.coperta.colore)  r.style.setProperty('--dorso-a', opz.coperta.colore);
        if (opz.coperta.colore2) r.style.setProperty('--dorso-b', opz.coperta.colore2);
        if (opz.coperta.filetto) r.style.setProperty('--dorso-filetto', opz.coperta.filetto);
      }
    }

    CFG._alte = mappa(CFG.alte);
    sprite(true);
    return CFG;
  }

  function reimposta() {
    if (CFG) scordaColori(chiavi(CFG.semi));   /* :root torna al CSS dell'app */
    CFG = difetto();
    CFG._alte = mappa(CFG.alte);
    if (document.getElementById(SPRITE_ID)) sprite(true);
    return CFG;
  }

  /* -------------------------------------------------------------- IL MAZZO */
  /* comodita': un mazzo di dati puri, senza DOM e senza regole.
     Carte.mazzo()                       -> 52 carte francesi
     Carte.mazzo({ mazzi: 2, jolly: 4 }) -> mazzo di scala quaranta
     Carte.mazzo({ ranghi: 10 })         -> mazzo da 40 (scopa, briscola) */
  function mazzo(opz) {
    opz = opz || {};
    var ranghi = opz.ranghi || 13;
    var semi   = opz.semi || CFG.ordine;
    var mazzi  = opz.mazzi || 1;
    var jolly  = opz.jolly || 0;
    var out = [], m, s, r, n = 0;
    for (m = 0; m < mazzi; m++) {
      for (s = 0; s < semi.length; s++) {
        for (r = 1; r <= ranghi; r++) out.push({ id: 'c' + (n++), rango: r, seme: semi[s] });
      }
    }
    for (r = 0; r < jolly; r++) out.push({ id: 'c' + (n++), jolly: true });
    return out;
  }

  function scelta(nodo, on) {
    if (!nodo) return nodo;
    nodo.classList.toggle('is-scelta', on !== false);
    return nodo;
  }

  reimposta();

  global.Carte = {
    el: el,
    dorso: dorso,
    configura: configura,
    reimposta: reimposta,
    etichetta: etichetta,
    mazzo: mazzo,
    scelta: scelta,
    ORNAMENTO: ORNAMENTO,
    opzioni: function () { return CFG; }
  };
  if (typeof module === 'object' && module.exports) module.exports = global.Carte;
})(typeof window !== 'undefined' ? window : this);
