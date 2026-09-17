/**
 * Build-time date stamp.
 *
 * Runs on Vercel via `buildCommand`. Copies the site into dist/ and rewrites the
 * "last touched" dates to the build date, in Europe/Amsterdam (Vercel builds in UTC,
 * which would roll the date a day early every evening).
 *
 * IN SCOPE - these describe when the page itself was last published:
 *   1. Bijgewerkt / Laatst bijgewerkt <time datetime="...">...</time>
 *   2. schema.org "dateModified"
 *   3. sitemap.xml <lastmod>
 *   4. the "Welkomstcadeaus <maand> <jaar>" eyebrow, which labels the live widget output
 *
 * DELIBERATELY OUT OF SCOPE - these are claims about when a FACT was checked, and
 * auto-bumping them would assert verification that never happened:
 *   - "Gecontroleerd op <date>"        (tariff/bonus spot checks)
 *   - "Dit is de stand op <date>"      (policy status)
 *   - "In augustus 2026 lagen ..."     (cited source data)
 *   - schema.org "datePublished"       (first publication, by definition fixed)
 *   - any <time> for a statutory date (1 januari 2027, Prinsjesdag, ...)
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.cwd();
const OUT = path.join(SRC, 'dist');
const SKIP = new Set([
  'dist', 'stamp-date.mjs', 'vercel.json', '.git', '.vercel',
  'node_modules', '.gitignore', 'README.md', 'api', 'package.json',
]);

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

// en-CA renders as YYYY-MM-DD; the timeZone is what actually matters here.
const iso = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const [y, m, d] = iso.split('-').map(Number);
const nlDate = `${d} ${MONTHS[m - 1]} ${y}`;
const nlMonth = `${MONTHS[m - 1]} ${y}`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const entry of fs.readdirSync(SRC)) {
  if (SKIP.has(entry)) continue;
  fs.cpSync(path.join(SRC, entry), path.join(OUT, entry), { recursive: true });
}

const log = [];

function edit(rel, rules) {
  const p = path.join(OUT, rel);
  if (!fs.existsSync(p)) return;
  const before = fs.readFileSync(p, 'utf8');
  let after = before;
  for (const [label, re, to] of rules) {
    let n = 0;
    after = after.replace(re, (...a) => { n++; return typeof to === 'function' ? to(...a) : to; });
    if (n) log.push(`  ${rel}: ${label} x${n}`);
  }
  if (after !== before) fs.writeFileSync(p, after, 'utf8');
}

edit('index.html', [
  // 1. visible stamp - requires the literal word "bijgewerkt" immediately before <time>,
  //    so "Gecontroleerd op <time>" and statutory <time> elements are never matched.
  ['zichtbare datum',
    /([Bb]ijgewerkt\s*<time datetime=")\d{4}-\d{2}-\d{2}("\s*>)[^<]*(<\/time>)/g,
    (_, a, b, c) => `${a}${iso}${b}${nlDate}${c}`],
  // 2. dateModified only - datePublished is matched by neither branch
  ['schema dateModified',
    /("dateModified"\s*:\s*")\d{4}-\d{2}-\d{2}(")/g,
    (_, a, b) => `${a}${iso}${b}`],
  // 4. month-year label on the live offer set
  ['eyebrow maand',
    /(Welkomstcadeaus\s+)(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+\d{4}/g,
    (_, a) => `${a}${nlMonth}`],
]);

edit('sitemap.xml', [
  ['sitemap lastmod', /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, `<lastmod>${iso}</lastmod>`],
]);

console.log(`[stamp-date] ${iso} (${nlDate}, Europe/Amsterdam)`);
console.log(log.length ? log.join('\n') : '  no date patterns matched');
