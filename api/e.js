// Vercel function: first-party relay for /v.js visit statistics to Amplitude (EU data center).
// Adds the visitor IP (Amplitude derives country/city from it) and a parsed browser/OS; stores nothing.
// Env: AMPLITUDE_API_KEY. Shared file: keep identical across the EMD sites.
const ENDPOINT = 'https://api.eu.amplitude.com/2/httpapi';
const TYPES = new Set(['page_view', 'engaged', 'page_leave', 'form_submit', 'outbound_click', 'contact_click', 'widget_click', 'cta_click']);
const MAX_EVENTS = 10;

const str = (v, n) => String(v ?? '').slice(0, n);

function props(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  for (const [k, v] of Object.entries(p).slice(0, 40)) {
    if (!/^[a-z_]{1,30}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 300);
  }
  return out;
}

function parseUa(ua) {
  const hit = (re) => (ua.match(re) || [])[1] || '';
  let browser = 'Other', version = '';
  for (const [name, re] of [
    ['Edge', /Edg(?:A|iOS)?\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/],
  ]) {
    const v = hit(re);
    if (v) { browser = name; version = v; break; }
  }
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const device = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet' : /Mobi|iPhone/.test(ua) ? 'mobile' : 'desktop';
  return { browser, version, os, osVersion: hit(/Android (\d+)/) || hit(/OS (\d+)_/) || '', device };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const key = process.env.AMPLITUDE_API_KEY;
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  }
  const device = str(body?.d, 64);
  const session = Number(body?.s);
  if (!key || device.length < 8 || !Number.isFinite(session) || !Array.isArray(body?.e)) return res.status(204).end();

  const h = req.headers;
  const ua = str(h['user-agent'], 400);
  const u = parseUa(ua);
  const ip = str(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim(), 64);
  const edge = {
    edge_country: str(h['x-vercel-ip-country'], 4),
    edge_region: str(h['x-vercel-ip-country-region'], 8),
    edge_city: str(decodeURIComponent(h['x-vercel-ip-city'] || ''), 60),
    browser: u.browser,
    os: u.os,
    device_class: u.device,
    ua,
  };
  const now = Date.now();
  const events = body.e.slice(0, MAX_EVENTS).filter((e) => TYPES.has(e?.t)).map((e) => {
    const ts = Number(e.ts);
    return {
      event_type: e.t,
      device_id: device,
      session_id: session,
      // client clocks drift; only trust them within a day
      time: Number.isFinite(ts) && Math.abs(ts - now) < 864e5 ? ts : now,
      insert_id: str(e.i, 64) || undefined,
      platform: 'Web',
      os_name: u.browser,
      os_version: u.version,
      device_model: u.os,
      language: str(e.p?.lang, 20) || undefined,
      ip: ip || '$remote',
      event_properties: { ...props(e.p), ...edge },
    };
  });
  if (!events.length) return res.status(204).end();

  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, events, options: { min_id_length: 8 } }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) console.error('amplitude', r.status, (await r.text()).slice(0, 300));
  } catch (err) {
    console.error('amplitude relay failed', err.message);
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(204).end();
}
