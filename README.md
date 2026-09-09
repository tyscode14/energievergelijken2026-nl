# energievergelijken2026.nl

Statische one-page energievergelijker voor huishoudens (Nederland), zustersite van zakelijkenergievergelijken.io. Geen build-stap.

- `index.html` – landingspagina (formulier, energiebelasting 2026, netbeheerkosten, contractvormen, leveranciers, FAQ, JSON-LD)
- `privacy/`, `contact/` – ondersteunende pagina's
- `fonts/` – zelf-gehoste woff2-fonts (Schibsted Grotesk, Public Sans)
- `vercel.json` – redirects, security headers, caching

De Daisycon Energievergelijker laadt pas na cookietoestemming: vul `window.loadDaisycon(container, input)` in `index.html` met de embedcode uit de codegenerator.
