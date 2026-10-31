# Analytics dashboard

`/dashboard/` on hectorgarciaquiros.com: Google Analytics for every website Hector built and
YouTube numbers for content clients, read live from Google in the browser.

- **Private by design.** No numbers are stored in this repo or on a server. After a Google
  sign-in (read-only scopes), the page calls Google's APIs directly; the token stays in the
  tab's memory for about an hour. Google only returns properties and channels the signed-in
  account can see. The page is `noindex`, not linked, and carries no Google Analytics tag.
- **Honest numbers.** Only what the APIs returned. Each period is compared with the period
  right before it. A change on a base under 100 also shows the raw counts. Errors show as
  errors, never as zeros, and a failed site is left out of the totals (the hero says how
  many sites it adds up).
- **Coverage.** Every site in `config.js` is matched to a GA property by measurement ID (or
  domain). A site with no property is flagged "Not in Google Analytics yet"; a property in
  the account but not in the list is shown too.

## Setup (once)

The setup screen walks through it: a Google Cloud project with the Analytics Admin,
Analytics Data, YouTube Data v3 and YouTube Analytics APIs; Google Auth Platform → Branding,
Audience (External, Testing, your account as test user), Clients → Web application with the
origin `https://hectorgarciaquiros.com`. Paste the client ID on the setup screen (kept in
that browser), or put it in `config.js` (`OAUTH_CLIENT_ID`; it isn't a secret).

## Adding a site or a content client

Edit `config.js`. Sites need a name, domain and `G-` measurement ID; YouTube clients need
the channel handle. Keep it in step with `ops/sites.md` in hex-os.

## Files

`index.html` (shell and Content Security Policy) · `app.js` (sign-in, Google API calls,
screens) · `charts.js` (SVG/HTML charts, each with a table view) · `dashboard.css` ·
`theme.js` (light/dark before first paint) · `config.js` (sites and channels).

Local preview: `python3 -m http.server 8000` from the repo root, then add
`http://localhost:8000` as an Authorized JavaScript origin on the OAuth client.
