/* First-party visit statistics, relayed to Amplitude (EU) via /api/e/.
 * No cookies, no localStorage: the visit ID lives in sessionStorage and dies with the tab.
 * Events: page_view, engaged (>=10s visible + an interaction), page_leave (cumulative,
 * re-sent on every hide; take the highest seq per page_id), form_submit, outbound_click,
 * contact_click, widget_click, cta_click. Shared file: keep identical across the EMD sites. */
(function () {
  var me = document.currentScript;
  var site = (me && me.getAttribute('data-site')) || location.hostname.replace(/^www\./, '');
  var EP = '/api/e/';
  var nav = navigator;

  function rid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function cut(v, n) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n); }

  var dev = sget('_v_d') || rid(); sset('_v_d', dev);
  var sid = +sget('_v_s') || Date.now(); sset('_v_s', String(sid));
  var views = (+sget('_v_n') || 0) + 1; sset('_v_n', String(views));
  var pageId = rid();

  function send(events, beacon) {
    var body = JSON.stringify({ d: dev, s: sid, e: events });
    try {
      if (beacon && nav.sendBeacon && nav.sendBeacon(EP, new Blob([body], { type: 'text/plain' }))) return;
      fetch(EP, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  }
  function track(type, props, beacon) {
    var p = { site: site, path: location.pathname, page_id: pageId };
    for (var k in props) p[k] = props[k];
    send([{ t: type, ts: Date.now(), i: rid(), p: p }], beacon);
  }

  /* ---------- page_view ---------- */
  var q = new URLSearchParams(location.search);
  var ref = document.referrer || '';
  var refHost = '';
  try { refHost = ref ? new URL(ref).hostname : ''; } catch (e) {}
  var navType = '';
  try { navType = performance.getEntriesByType('navigation')[0].type; } catch (e) {}
  var conn = nav.connection || {};
  var ua = nav.userAgent || '';
  var pv = {
    title: cut(document.title, 120),
    referrer: cut(ref, 300),
    referrer_host: refHost,
    internal: refHost === location.hostname,
    view_in_session: views,
    nav_type: navType,
    lang: nav.language || '',
    languages: (nav.languages || []).length,
    tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })(),
    tz_offset: -new Date().getTimezoneOffset(),
    screen: screen.width + 'x' + screen.height,
    viewport: innerWidth + 'x' + innerHeight,
    dpr: devicePixelRatio || 1,
    touch_points: nav.maxTouchPoints || 0,
    cores: nav.hardwareConcurrency || 0,
    memory_gb: nav.deviceMemory || 0,
    connection: conn.effectiveType || '',
    save_data: !!conn.saveData,
    webdriver: !!nav.webdriver,
    headless_ua: /Headless|PhantomJS|Lighthouse|bot|crawl|spider/i.test(ua),
    plugins: nav.plugins ? nav.plugins.length : -1,
    cookies_enabled: !!nav.cookieEnabled,
    in_app: /Twitter|FBAN|FBAV|Instagram|; wv\)|Line\/|TikTok/i.test(ua),
    hidden_at_load: document.visibilityState !== 'visible'
  };
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
    if (q.get(k)) pv[k] = cut(q.get(k), 100);
  });
  ['gclid', 'fbclid', 'twclid', 'msclkid', 'ttclid'].forEach(function (k) { if (q.get(k)) pv[k] = true; });
  track('page_view', pv);

  /* ---------- attention ---------- */
  var t0 = Date.now();
  var visMs = 0;
  var visSince = document.visibilityState === 'visible' ? t0 : 0;
  var maxScroll = 0, clicks = 0, keys = 0, firstAct = -1, moved = false, seq = 0, engagedSent = false;

  function activeMs() { return visMs + (visSince ? Date.now() - visSince : 0); }
  function act() {
    if (firstAct < 0) firstAct = Date.now() - t0;
    maybeEngaged();
  }
  function maybeEngaged() {
    if (engagedSent || firstAct < 0 || activeMs() < 10000) return;
    engagedSent = true;
    track('engaged', { active_s: Math.round(activeMs() / 1000), max_scroll: maxScroll });
  }
  function scrollPct() {
    var h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    return h > 0 ? Math.min(100, Math.round((scrollY + innerHeight) / h * 100)) : 0;
  }
  var startScroll = scrollPct();
  maxScroll = startScroll;
  addEventListener('scroll', function () {
    var p = scrollPct();
    if (p > maxScroll) maxScroll = p;
    if (!moved && p > startScroll) { moved = true; act(); }
  }, { passive: true });
  addEventListener('pointerdown', function () { clicks++; act(); }, { passive: true, capture: true });
  addEventListener('keydown', function () { keys++; act(); }, { passive: true, capture: true });
  addEventListener('mousemove', function once() { removeEventListener('mousemove', once); act(); }, { passive: true });
  var poll = setInterval(function () { maybeEngaged(); if (engagedSent) clearInterval(poll); }, 2000);

  function leave(final) {
    seq++;
    track('page_leave', {
      seq: seq,
      final: final,
      active_s: Math.round(activeMs() / 100) / 10,
      total_s: Math.round((Date.now() - t0) / 100) / 10,
      max_scroll: maxScroll,
      scrolled: moved,
      clicks: clicks,
      keys: keys,
      first_interaction_ms: firstAct,
      engaged: engagedSent
    }, true);
  }
  var gone = false; // pagehide already reported; the hidden event that follows it is the same exit
  document.addEventListener('visibilitychange', function () {
    if (gone) return;
    if (document.visibilityState === 'hidden') {
      if (visSince) { visMs += Date.now() - visSince; visSince = 0; }
      leave(false);
    } else if (!visSince) {
      visSince = Date.now();
    }
  });
  addEventListener('pagehide', function () {
    if (gone) return;
    gone = true;
    if (visSince) { visMs += Date.now() - visSince; visSince = 0; }
    leave(true);
  });
  addEventListener('pageshow', function (e) {
    if (!e.persisted) return; // restored from the back/forward cache: the visit continues
    gone = false;
    visSince = Date.now();
  });

  /* ---------- conversions ---------- */
  document.addEventListener('submit', function (e) {
    var f = e.target;
    track('form_submit', { form: cut(f.id || f.getAttribute('name') || f.getAttribute('action') || 'form', 60) }, true);
  }, true);

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a,button,[role=button]') : null;
    if (!el) return;
    var text = cut(el.getAttribute('aria-label') || el.textContent, 60);
    var href = el.getAttribute('href') || '';
    var widget = el.closest('#daisycon-slot,.dc-tool,[class*="dc-energy-tool"]');
    if (widget) {
      var wh = '';
      try { wh = href ? new URL(href, location.href).hostname : ''; } catch (err) {}
      track('widget_click', { text: text, host: wh }, true);
      return;
    }
    if (/^(tel|mailto):/i.test(href)) {
      track('contact_click', { kind: href.slice(0, href.indexOf(':')).toLowerCase(), text: text }, true);
      return;
    }
    if (href && !/^#/.test(href)) {
      var u;
      try { u = new URL(href, location.href); } catch (err) { return; }
      if (/^https?:$/.test(u.protocol) && u.hostname !== location.hostname) {
        track('outbound_click', { host: u.hostname, url: cut(u.origin + u.pathname, 200), text: text }, true);
        return;
      }
    }
    if (el.tagName === 'BUTTON' || /\bbtn\b/.test(el.className || '')) {
      track('cta_click', { text: text, target: cut(href || el.id || el.type || '', 80) });
    }
  }, true);
})();
