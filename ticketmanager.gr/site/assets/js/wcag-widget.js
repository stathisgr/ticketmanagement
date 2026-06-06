/*!
 * WCAG Accessibility Widget  v1.0.0
 * Standalone WCAG 2.2 Accessibility Toolbar
 * Δεν απαιτεί εξωτερικές βιβλιοθήκες
 *
 * Χρήση:
 *   <script src="a11y-widget.js"></script>
 *
 * Προαιρετική ρύθμιση (πριν το script):
 *   <script>
 *     window.WAG_CONFIG = {
 *       position:     'bottom-right',  // ή 'bottom-left'
 *       primaryColor: '#1a56db',       // κύριο χρώμα θέματος
 *       lang:         'el'             // 'el' ή 'en'
 *     };
 *   </script>
 *
 * © 2024 — MIT License
 */
(function (w, d) {
  'use strict';

  /* ── Αποτροπή διπλής αρχικοποίησης ── */
  if (d.getElementById('a11y-widget-root')) return;

  /* ════════════════════════════════════════
   *  ΡΥΘΜΙΣΕΙΣ
   * ════════════════════════════════════════ */
  var C = Object.assign(
    { position: 'bottom-right', primaryColor: '#1a56db', lang: 'el' },
    w.WAG_CONFIG || {}
  );

  /* ════════════════════════════════════════
   *  ΜΕΤΑΦΡΑΣΕΙΣ
   * ════════════════════════════════════════ */
  var i18n = {
    el: {
      open:       'Εργαλεία Προσβασιμότητας',
      close:      'Κλείσιμο',
      reset:      'Επαναφορά',
      title:      'Προσβασιμότητα',
      langBtn:    'EN',
      tSize:      'Μέγεθος Κειμένου',
      sN:         'Κανονικό',
      sL:         'Μεγάλο',
      sXL:        'Μεγάλο+',
      tContrast:  'Αντίθεση Χρωμάτων',
      cN:         'Κανονικό',
      cH:         'Υψηλή',
      cI:         'Αντεστραμμένο',
      cG:         'Γκρίζο',
      tTypo:      'Τυπογραφία',
      dyslexia:   'Γραμματοσειρά Δυσλεξίας',
      letterSp:   'Αραίωση Γραμμάτων',
      lineH:      'Ύψος Γραμμής',
      tNav:       'Πλοήγηση',
      links:      'Επισήμανση Συνδέσμων',
      focusV:     'Εμφάνιση Εστίασης',
      guide:      'Οδηγός Ανάγνωσης',
      skip:       'Μετάβαση στο Κύριο Περιεχόμενο',
      wcag:       'WCAG 2.2 Συμβατό'
    },
    en: {
      open:       'Accessibility Tools',
      close:      'Close',
      reset:      'Reset All',
      title:      'Accessibility',
      langBtn:    'ΕΛ',
      tSize:      'Text Size',
      sN:         'Normal',
      sL:         'Large',
      sXL:        'X-Large',
      tContrast:  'Color Contrast',
      cN:         'Default',
      cH:         'High',
      cI:         'Inverted',
      cG:         'Grayscale',
      tTypo:      'Typography',
      dyslexia:   'Dyslexia Font',
      letterSp:   'Letter Spacing',
      lineH:      'Line Height',
      tNav:       'Navigation',
      links:      'Highlight Links',
      focusV:     'Show Focus',
      guide:      'Reading Guide',
      skip:       'Skip to Main Content',
      wcag:       'WCAG 2.2 Compatible'
    }
  };

  /* ════════════════════════════════════════
   *  ΚΑΤΑΣΤΑΣΗ
   * ════════════════════════════════════════ */
  var S = {
    open:      false,
    lang:      C.lang,
    fs:        0,        // 0 = κανονικό, 1 = μεγάλο, 2 = πολύ μεγάλο
    contrast:  'none',   // none | high | invert | gray
    dyslexia:  false,
    letterSp:  false,
    lineH:     false,
    links:     false,
    focusV:    false,
    guide:     false
  };

  function t(k) { return (i18n[S.lang] || i18n.el)[k] || k; }

  /* ════════════════════════════════════════
   *  ΑΠΟΘΗΚΕΥΣΗ / ΦΟΡΤΩΣΗ
   * ════════════════════════════════════════ */
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem('a11y-v1') || 'null');
      if (v) { Object.assign(S, v); S.open = false; }
    } catch (e) {}
  }
  function save() {
    try {
      var v = Object.assign({}, S);
      delete v.open;
      localStorage.setItem('a11y-v1', JSON.stringify(v));
    } catch (e) {}
  }

  /* ════════════════════════════════════════
   *  CSS INJECTION
   * ════════════════════════════════════════ */
  function injectCSS() {
    var pc  = C.primaryColor;
    var pos = C.position === 'bottom-left' ? 'left:16px' : 'right:16px';
    var pnl = C.position === 'bottom-left' ? 'left:0'   : 'right:0';

    var css = [
      /* ── Skip link ── */
      '#a11y-skip{position:fixed;top:-300px;left:0;z-index:1000001;background:' + pc + ';color:#fff;',
      'padding:12px 20px;font-weight:700;font-size:15px;text-decoration:none;border-radius:0 0 10px 0;',
      'transition:top .2s;outline:none;font-family:inherit}',
      '#a11y-skip:focus{top:0}',
      '#a11y-skip:focus-visible{outline:3px solid #ffbf47;outline-offset:3px}',

      /* ── Root container ── */
      '#a11y-widget-root{position:fixed;' + pos + ';bottom:16px;z-index:999990;',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;',
      'line-height:1.5;font-size:14px}',
      '#a11y-widget-root *{box-sizing:border-box;font-family:inherit!important}',

      /* ── Κουμπί ανοίγματος ── */
      '#a11y-btn{width:54px;height:54px;border-radius:50%;background:' + pc + ';color:#fff;',
      'border:3px solid rgba(255,255,255,.8);cursor:pointer;display:flex;align-items:center;',
      'justify-content:center;box-shadow:0 4px 18px rgba(0,0,0,.32);padding:0;outline:none;',
      'transition:filter .2s,transform .2s}',
      '#a11y-btn:hover{filter:brightness(1.12);transform:scale(1.07)}',
      '#a11y-btn:focus-visible{outline:3px solid #ffbf47;outline-offset:4px}',
      '#a11y-btn svg{width:28px;height:28px;fill:#fff;pointer-events:none;flex-shrink:0}',

      /* ── Panel ── */
      '#a11y-panel{position:absolute;' + pnl + ';bottom:62px;width:292px;max-height:84vh;',
      'overflow-y:auto;background:#fff;border-radius:14px;',
      'box-shadow:0 8px 36px rgba(0,0,0,.22);border:1px solid #dde0e8;',
      'color:#1c1c1e;display:none;flex-direction:column;scroll-behavior:smooth}',
      '#a11y-panel.open{display:flex;animation:a11yin .22s ease}',
      '@keyframes a11yin{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
      '#a11y-panel:focus{outline:none}',

      /* ── Panel header ── */
      '#a11y-ph{display:flex;align-items:center;gap:8px;padding:13px 14px;',
      'background:' + pc + ';border-radius:14px 14px 0 0;color:#fff;flex-shrink:0}',
      '#a11y-ph h2{margin:0;padding:0;flex:1;font-size:15px;font-weight:700;color:#fff;',
      'display:flex;align-items:center;gap:7px;border:none;background:none}',
      '#a11y-ph h2 svg{width:17px;height:17px;fill:#fff;flex-shrink:0}',
      '.a11y-hb{background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.45);color:#fff;',
      'border-radius:6px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;',
      'white-space:nowrap;font-family:inherit;transition:background .15s}',
      '.a11y-hb:hover{background:rgba(255,255,255,.38)}',
      '.a11y-hb:focus-visible{outline:2px solid #ffbf47;outline-offset:2px}',

      /* ── Panel body ── */
      '#a11y-pb{padding:13px 14px;display:flex;flex-direction:column;gap:13px}',

      /* ── Section ── */
      '.a11y-s{display:flex;flex-direction:column;gap:8px}',
      '.a11y-sh{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;',
      'color:#999;margin:0;padding-bottom:5px;border-bottom:1px solid #f0f0f0}',

      /* ── Font size buttons ── */
      '.a11y-szw{display:flex;gap:5px}',
      '.a11y-sz{flex:1;padding:9px 3px;border:2px solid #e4e4e7;background:#fafafa;border-radius:9px;',
      'cursor:pointer;text-align:center;font-weight:600;color:#52525b;transition:all .15s;',
      'font-size:10px;line-height:1.3;font-family:inherit}',
      '.a11y-sz em{font-style:normal;font-weight:800;color:' + pc + ';display:block;margin-bottom:1px}',
      '.a11y-sz:hover{border-color:' + pc + ';background:#eff6ff}',
      '.a11y-sz.on{border-color:' + pc + ';background:#eff6ff;color:' + pc + '}',
      '.a11y-sz:focus-visible{outline:2px solid ' + pc + ';outline-offset:2px}',

      /* ── Contrast grid ── */
      '.a11y-cg{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}',
      '.a11y-cb{padding:8px 3px;border:2px solid #e4e4e7;background:#fafafa;border-radius:8px;',
      'cursor:pointer;font-size:9.5px;font-weight:600;color:#52525b;text-align:center;',
      'display:flex;flex-direction:column;align-items:center;gap:3px;transition:all .15s;font-family:inherit}',
      '.a11y-cb .cp{width:26px;height:14px;border-radius:3px;border:1px solid #d4d4d8;flex-shrink:0}',
      '.a11y-cb:hover{border-color:' + pc + '}',
      '.a11y-cb.on{border-color:' + pc + ';background:#eff6ff;color:' + pc + '}',
      '.a11y-cb:focus-visible{outline:2px solid ' + pc + ';outline-offset:2px}',

      /* ── Toggle rows ── */
      '.a11y-tr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0;',
      'cursor:pointer}',
      '.a11y-tl{font-size:13px;font-weight:500;color:#3f3f46;user-select:none;flex:1}',

      /* ── Switch ── */
      '.a11y-sw{position:relative;width:42px;height:24px;flex-shrink:0;display:inline-flex}',
      '.a11y-sw input{opacity:0;width:0;height:0;position:absolute}',
      '.a11y-sw span{position:absolute;inset:0;background:#d4d4d8;border-radius:24px;',
      'cursor:pointer;transition:background .18s}',
      '.a11y-sw span::after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;',
      'background:#fff;border-radius:50%;transition:transform .18s;box-shadow:0 1px 3px rgba(0,0,0,.25)}',
      '.a11y-sw input:checked+span{background:' + pc + '}',
      '.a11y-sw input:checked+span::after{transform:translateX(18px)}',
      '.a11y-sw input:focus-visible+span{outline:2px solid #ffbf47;outline-offset:2px}',

      /* ── Footer ── */
      '#a11y-pf{padding:10px 14px 13px;border-top:1px solid #f4f4f5;flex-shrink:0}',
      '#a11y-rst{width:100%;padding:9px;background:#f4f4f5;border:1px solid #e4e4e7;',
      'border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:#71717a;',
      'margin-bottom:8px;transition:background .15s;font-family:inherit}',
      '#a11y-rst:hover{background:#e4e4e7}',
      '#a11y-rst:focus-visible{outline:2px solid ' + pc + ';outline-offset:2px}',
      '.a11y-badge{display:flex;align-items:center;justify-content:center;gap:5px;',
      'font-size:10.5px;color:#a1a1aa;font-weight:500}',
      '.a11y-badge svg{width:13px;height:13px;fill:#a1a1aa}',

      /* ── Reading guide ── */
      '#a11y-rg{display:none;position:fixed;left:0;right:0;height:32px;',
      'background:rgba(255,248,0,.2);border-top:2px solid rgba(200,180,0,.45);',
      'border-bottom:2px solid rgba(200,180,0,.45);pointer-events:none;z-index:999988;',
      'transform:translateY(-50%);top:0;transition:top .05s linear}',
      '#a11y-rg.on{display:block}',

      /* ════════════════════════════════════════
       *  GLOBAL ACCESSIBILITY OVERRIDES
       * ════════════════════════════════════════ */

      /* Μέγεθος κειμένου */
      'html.a11y-fs1{font-size:115%!important}',
      'html.a11y-fs2{font-size:130%!important}',

      /* Υψηλή αντίθεση */
      'html.a11y-ch body{background-color:#000!important;color:#fff!important}',
      'html.a11y-ch a:not([aria-hidden]){color:#ffff00!important;text-decoration:underline!important}',
      'html.a11y-ch button,html.a11y-ch input,html.a11y-ch textarea,html.a11y-ch select{',
      'background:#0a0a0a!important;color:#fff!important;border-color:#666!important}',
      'html.a11y-ch img:not(#a11y-widget-root img){filter:contrast(1.1) brightness(.85)}',
      'html.a11y-ch header,html.a11y-ch nav,html.a11y-ch footer,html.a11y-ch section{',
      'background-color:#111!important;border-color:#444!important}',

      /* Αντεστραμμένα χρώματα */
      'html.a11y-ci{filter:invert(100%) hue-rotate(180deg)}',
      'html.a11y-ci img:not(#a11y-widget-root img),html.a11y-ci video{filter:invert(100%) hue-rotate(180deg)}',
      'html.a11y-ci #a11y-widget-root{filter:invert(100%) hue-rotate(180deg)}',

      /* Κλίμακα γκρι */
      'html.a11y-cg{filter:grayscale(100%)}',
      'html.a11y-cg #a11y-widget-root{filter:none}',

      /* Γραμματοσειρά δυσλεξίας */
      'html.a11y-dy *:not(#a11y-widget-root):not(#a11y-widget-root *){',
      'font-family:"OpenDyslexic","Comic Sans MS",cursive,Arial,sans-serif!important}',

      /* Αραίωση γραμμάτων */
      'html.a11y-ls *:not(#a11y-widget-root):not(#a11y-widget-root *){',
      'letter-spacing:.14em!important;word-spacing:.22em!important}',

      /* Ύψος γραμμής */
      'html.a11y-lh *:not(#a11y-widget-root):not(#a11y-widget-root *){line-height:1.9!important}',

      /* Επισήμανση συνδέσμων */
      'html.a11y-hl a:not(#a11y-widget-root a){',
      'background-color:#ffff00!important;color:#000!important;',
      'text-decoration:underline!important;text-underline-offset:2px!important;',
      'padding:1px 3px!important;border-radius:2px!important;',
      'box-shadow:0 0 0 2px #ff8800!important}',

      /* Εμφάνιση εστίασης */
      'html.a11y-fo *:focus-visible{',
      'outline:3px solid #0060df!important;outline-offset:3px!important;',
      'box-shadow:0 0 0 6px rgba(0,96,223,.18)!important}',

      /* Responsive */
      '@media(max-width:340px){#a11y-panel{width:calc(100vw - 20px);' + pnl + '}}',

      /* Print: απόκρυψη widget */
      '@media print{#a11y-widget-root,#a11y-skip,#a11y-rg{display:none!important}}'
    ].join('');

    var el = d.createElement('style');
    el.id = 'a11y-css';
    el.textContent = css;
    d.head.appendChild(el);
  }

  /* ════════════════════════════════════════
   *  SVG ΕΙΚΟΝΙΔΙΑ
   * ════════════════════════════════════════ */
  var ICO_A11Y = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<circle cx="12" cy="4" r="2"/>'
    + '<path d="M20 7H4a1 1 0 0 0 0 2h4.18l-1.7 5.1a1 1 0 0 0 .52 1.22L10 16.62V22a1 1 0 0 0 2 0v-4h1v4a1 1 0 0 0 2 0v-5.38l2.98-1.3a1 1 0 0 0 .54-1.22L16.82 9H20a1 1 0 0 0 0-2z"/>'
    + '</svg>';

  var ICO_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.5 5.5-4 5a.75.75 0 0 1-1.16.04l-2-2.5a.75.75 0 1 1 1.16-.95l1.43 1.79 3.42-4.27a.75.75 0 0 1 1.15.89z"/>'
    + '</svg>';

  /* ════════════════════════════════════════
   *  ΒΟΗΘΗΤΙΚΗ: Toggle row HTML
   * ════════════════════════════════════════ */
  function row(id, labelKey) {
    return '<label class="a11y-tr" for="' + id + '">'
      + '<span class="a11y-tl" data-t="' + labelKey + '">' + t(labelKey) + '</span>'
      + '<span class="a11y-sw">'
      + '<input type="checkbox" id="' + id + '" role="switch" aria-checked="false">'
      + '<span aria-hidden="true"></span>'
      + '</span></label>';
  }

  /* ════════════════════════════════════════
   *  ΚΑΤΑΣΚΕΥΗ HTML
   * ════════════════════════════════════════ */
  function buildHTML() {
    /* Skip link */
    var skip = d.createElement('a');
    skip.id = 'a11y-skip';
    skip.setAttribute('data-t', 'skip');
    skip.textContent = t('skip');
    var main = d.getElementById('main-content')
      || d.getElementById('content')
      || d.querySelector('main')
      || d.querySelector('[role="main"]');
    if (main) {
      if (!main.id) main.id = 'a11y-main';
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      skip.href = '#' + main.id;
    } else {
      skip.href = '#';
    }
    d.body.insertBefore(skip, d.body.firstChild);

    /* Reading guide overlay */
    var rg = d.createElement('div');
    rg.id = 'a11y-rg';
    rg.setAttribute('aria-hidden', 'true');
    rg.setAttribute('role', 'presentation');
    d.body.appendChild(rg);

    /* Root */
    var root = d.createElement('div');
    root.id = 'a11y-widget-root';

    /* ── Panel ── */
    var panel = d.createElement('div');
    panel.id = 'a11y-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', t('title'));

    panel.innerHTML =
      /* Header */
      '<div id="a11y-ph">'
      + '<h2 aria-level="2">' + ICO_A11Y
      + '<span data-t="title">' + t('title') + '</span></h2>'
      + '<button class="a11y-hb" id="a11y-lang" aria-label="Switch language" data-t="langBtn">' + t('langBtn') + '</button>'
      + '<button class="a11y-hb" id="a11y-close" aria-label="' + t('close') + '" data-t-aria-close="close">&#x2715;</button>'
      + '</div>'

      /* Body */
      + '<div id="a11y-pb">'

      /* Section 1: Text Size */
      + '<div class="a11y-s">'
      + '<p id="a11y-s1" class="a11y-sh" data-t="tSize">' + t('tSize') + '</p>'
      + '<div class="a11y-szw" role="group" aria-labelledby="a11y-s1">'
      + '<button class="a11y-sz on" id="a11y-sz0" aria-pressed="true">'
      + '<em style="font-size:13px">A</em><span data-t="sN">' + t('sN') + '</span></button>'
      + '<button class="a11y-sz" id="a11y-sz1" aria-pressed="false">'
      + '<em style="font-size:16px">A</em><span data-t="sL">' + t('sL') + '</span></button>'
      + '<button class="a11y-sz" id="a11y-sz2" aria-pressed="false">'
      + '<em style="font-size:19px">A</em><span data-t="sXL">' + t('sXL') + '</span></button>'
      + '</div></div>'

      /* Section 2: Contrast */
      + '<div class="a11y-s">'
      + '<p id="a11y-s2" class="a11y-sh" data-t="tContrast">' + t('tContrast') + '</p>'
      + '<div class="a11y-cg" role="group" aria-labelledby="a11y-s2">'
      + '<button class="a11y-cb on" id="a11y-cn" aria-pressed="true">'
      + '<span class="cp" style="background:linear-gradient(90deg,#f5f5f5 50%,#222 50%)" aria-hidden="true"></span>'
      + '<span data-t="cN">' + t('cN') + '</span></button>'
      + '<button class="a11y-cb" id="a11y-ch" aria-pressed="false">'
      + '<span class="cp" style="background:#000;border-color:#000" aria-hidden="true"></span>'
      + '<span data-t="cH">' + t('cH') + '</span></button>'
      + '<button class="a11y-cb" id="a11y-ci" aria-pressed="false">'
      + '<span class="cp" style="background:linear-gradient(90deg,#222 50%,#f0f0f0 50%)" aria-hidden="true"></span>'
      + '<span data-t="cI">' + t('cI') + '</span></button>'
      + '<button class="a11y-cb" id="a11y-cg" aria-pressed="false">'
      + '<span class="cp" style="background:linear-gradient(90deg,#bbb 50%,#555 50%)" aria-hidden="true"></span>'
      + '<span data-t="cG">' + t('cG') + '</span></button>'
      + '</div></div>'

      /* Section 3: Typography */
      + '<div class="a11y-s">'
      + '<p id="a11y-s3" class="a11y-sh" data-t="tTypo">' + t('tTypo') + '</p>'
      + row('a11y-dy',  'dyslexia')
      + row('a11y-ls',  'letterSp')
      + row('a11y-lh',  'lineH')
      + '</div>'

      /* Section 4: Navigation */
      + '<div class="a11y-s">'
      + '<p id="a11y-s4" class="a11y-sh" data-t="tNav">' + t('tNav') + '</p>'
      + row('a11y-lk',  'links')
      + row('a11y-fo',  'focusV')
      + row('a11y-rg2', 'guide')
      + '</div>'

      + '</div>'

      /* Footer */
      + '<div id="a11y-pf">'
      + '<button id="a11y-rst" data-t="reset">' + t('reset') + '</button>'
      + '<div class="a11y-badge">' + ICO_CHECK
      + '<span data-t="wcag">' + t('wcag') + '</span></div>'
      + '</div>';

    root.appendChild(panel);

    /* ── Toggle button ── */
    var btn = d.createElement('button');
    btn.id = 'a11y-btn';
    btn.setAttribute('aria-label', t('open'));
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'a11y-panel');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('data-t-aria-open', 'open');
    btn.innerHTML = ICO_A11Y;
    root.appendChild(btn);

    d.body.appendChild(root);
  }

  /* ════════════════════════════════════════
   *  ΕΦΑΡΜΟΓΗ ΚΑΤASTΑΣΗΣ στο DOM
   * ════════════════════════════════════════ */
  var html = d.documentElement;

  function applyClasses() {
    /* Font size */
    html.classList.toggle('a11y-fs1', S.fs === 1);
    html.classList.toggle('a11y-fs2', S.fs === 2);

    /* Contrast */
    html.classList.toggle('a11y-ch',  S.contrast === 'high');
    html.classList.toggle('a11y-ci',  S.contrast === 'invert');
    html.classList.toggle('a11y-cg',  S.contrast === 'gray');

    /* Typography */
    html.classList.toggle('a11y-dy',  S.dyslexia);
    html.classList.toggle('a11y-ls',  S.letterSp);
    html.classList.toggle('a11y-lh',  S.lineH);

    /* Navigation */
    html.classList.toggle('a11y-hl',  S.links);
    html.classList.toggle('a11y-fo',  S.focusV);

    /* Reading guide */
    var rg = d.getElementById('a11y-rg');
    if (rg) rg.classList.toggle('on', S.guide);

    /* Load OpenDyslexic font on demand */
    if (S.dyslexia && !d.getElementById('a11y-dyfont')) {
      var lnk = d.createElement('link');
      lnk.id   = 'a11y-dyfont';
      lnk.rel  = 'stylesheet';
      lnk.href = 'https://fonts.cdnfonts.com/css/open-dyslexic';
      d.head.appendChild(lnk);
    }
  }

  /* ════════════════════════════════════════
   *  ΣΥΓΧΡΟΝΙΣΜΟΣ UI με κατάσταση
   * ════════════════════════════════════════ */
  function syncUI() {
    /* Size */
    [0, 1, 2].forEach(function (i) {
      var el = d.getElementById('a11y-sz' + i);
      if (!el) return;
      el.classList.toggle('on', S.fs === i);
      el.setAttribute('aria-pressed', S.fs === i ? 'true' : 'false');
    });

    /* Contrast */
    var cmap = { cn: 'none', ch: 'high', ci: 'invert', cg: 'gray' };
    Object.keys(cmap).forEach(function (id) {
      var el = d.getElementById('a11y-' + id);
      if (!el) return;
      var active = S.contrast === cmap[id];
      el.classList.toggle('on', active);
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    /* Checkboxes */
    var chkMap = { 'a11y-dy': 'dyslexia', 'a11y-ls': 'letterSp', 'a11y-lh': 'lineH',
                   'a11y-lk': 'links',    'a11y-fo': 'focusV',    'a11y-rg2': 'guide' };
    Object.keys(chkMap).forEach(function (id) {
      var el = d.getElementById(id);
      if (!el) return;
      el.checked = !!S[chkMap[id]];
      el.setAttribute('aria-checked', el.checked ? 'true' : 'false');
    });

    /* Translated text (data-t elements) */
    [].forEach.call(d.querySelectorAll('#a11y-widget-root [data-t], #a11y-skip[data-t]'),
      function (el) { el.textContent = t(el.getAttribute('data-t')); }
    );

    /* aria-label updates */
    var closeBtn = d.getElementById('a11y-close');
    if (closeBtn) closeBtn.setAttribute('aria-label', t('close'));
    var openBtn = d.getElementById('a11y-btn');
    if (openBtn) openBtn.setAttribute('aria-label', t('open'));
    var panel = d.getElementById('a11y-panel');
    if (panel) panel.setAttribute('aria-label', t('title'));
  }

  /* ════════════════════════════════════════
   *  PANEL TOGGLE
   * ════════════════════════════════════════ */
  function togglePanel(forceOpen) {
    S.open = (forceOpen !== undefined) ? forceOpen : !S.open;
    var panel = d.getElementById('a11y-panel');
    var btn   = d.getElementById('a11y-btn');
    if (!panel || !btn) return;
    panel.classList.toggle('open', S.open);
    btn.setAttribute('aria-expanded', S.open ? 'true' : 'false');
    if (S.open) {
      /* Focus first interactive element in panel */
      var firstFocusable = panel.querySelector('button, input, [tabindex]');
      if (firstFocusable) firstFocusable.focus();
    }
  }

  /* ════════════════════════════════════════
   *  EVENT LISTENERS
   * ════════════════════════════════════════ */
  function bindEvents() {
    /* Toggle button */
    var btn = d.getElementById('a11y-btn');
    if (btn) btn.addEventListener('click', function () { togglePanel(); });

    /* Close button */
    var closeBtn = d.getElementById('a11y-close');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      togglePanel(false);
      var b = d.getElementById('a11y-btn');
      if (b) b.focus();
    });

    /* Escape key */
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.open) {
        togglePanel(false);
        var b = d.getElementById('a11y-btn');
        if (b) b.focus();
      }
    });

    /* Click outside → close */
    d.addEventListener('mousedown', function (e) {
      var root = d.getElementById('a11y-widget-root');
      if (S.open && root && !root.contains(e.target)) togglePanel(false);
    });

    /* ── Font size ── */
    [0, 1, 2].forEach(function (i) {
      var el = d.getElementById('a11y-sz' + i);
      if (el) el.addEventListener('click', function () {
        S.fs = i; applyClasses(); syncUI(); save();
      });
    });

    /* ── Contrast ── */
    var cmodes = { cn: 'none', ch: 'high', ci: 'invert', cg: 'gray' };
    Object.keys(cmodes).forEach(function (id) {
      var el = d.getElementById('a11y-' + id);
      if (el) el.addEventListener('click', function () {
        S.contrast = cmodes[id]; applyClasses(); syncUI(); save();
      });
    });

    /* ── Checkboxes ── */
    var chkMap = { 'a11y-dy': 'dyslexia', 'a11y-ls': 'letterSp', 'a11y-lh': 'lineH',
                   'a11y-lk': 'links',    'a11y-fo': 'focusV',    'a11y-rg2': 'guide' };
    Object.keys(chkMap).forEach(function (id) {
      var el = d.getElementById(id);
      if (el) el.addEventListener('change', function () {
        S[chkMap[id]] = this.checked;
        this.setAttribute('aria-checked', this.checked ? 'true' : 'false');
        applyClasses(); save();
      });
    });

    /* ── Reset ── */
    var rst = d.getElementById('a11y-rst');
    if (rst) rst.addEventListener('click', function () {
      S.fs = 0; S.contrast = 'none';
      S.dyslexia = false; S.letterSp = false; S.lineH = false;
      S.links = false; S.focusV = false; S.guide = false;
      applyClasses(); syncUI(); save();
    });

    /* ── Language switch ── */
    var langBtn = d.getElementById('a11y-lang');
    if (langBtn) langBtn.addEventListener('click', function () {
      S.lang = S.lang === 'el' ? 'en' : 'el';
      syncUI();
      save();
    });

    /* ── Reading guide mouse tracking ── */
    d.addEventListener('mousemove', function (e) {
      if (!S.guide) return;
      var rg = d.getElementById('a11y-rg');
      if (rg) rg.style.top = e.clientY + 'px';
    });

    /* Trap focus inside panel (Tab key) */
    d.addEventListener('keydown', function (e) {
      if (!S.open || e.key !== 'Tab') return;
      var panel = d.getElementById('a11y-panel');
      if (!panel) return;
      var focusable = panel.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      var first = focusable[0];
      var last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (d.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (d.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  /* ════════════════════════════════════════
   *  ΑΡΧΙΚΟΠΟΙΗΣΗ
   * ════════════════════════════════════════ */
  function init() {
    load();
    injectCSS();
    buildHTML();
    applyClasses();
    syncUI();
    bindEvents();
  }

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}(window, document));
