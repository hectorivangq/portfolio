// Analytics dashboard settings.
//
// Everything in this file is already public: the site names and domains are on
// hectorgarciaquiros.com, and a GA4 measurement ID is in the source of every page that
// carries it. No analytics numbers are stored here or anywhere in this repo. They load
// live in your browser after you sign in with Google, and Google only returns properties
// and channels your account has access to.

// The OAuth "Web application" client ID from Google Cloud (it ends in
// .apps.googleusercontent.com). It isn't a secret. Leave it empty to paste it on the
// dashboard's setup screen instead, which keeps it in that browser only.
export const OAUTH_CLIENT_ID = '';

// Every website, in the order the dashboard lists them. A site is matched to its Google
// Analytics property by measurement ID, or by domain when the ID is still null, so a new
// property shows up here as soon as it exists in your account.
// When a new site launches: add it here (and in hex-os ops/sites.md).
export const SITES = [
  { key: 'hectorgarciaquiros', name: 'Hector Garcia Quiros', domain: 'hectorgarciaquiros.com', measurementId: 'G-4Q5M6KR9Y5', kind: 'Your site' },
  { key: 'sharpline', name: 'Sharpline Elite Services', domain: 'sharplineconsulting.net', measurementId: 'G-B60DBP0RWJ', kind: 'Client site' },
  { key: 'exklusive-rentals', name: 'Exklusive Rentals', domain: 'exklusiverentalsllc.com', measurementId: 'G-7905401H0F', kind: 'Client site' },
  { key: 'college-conversations', name: 'College Conversations', domain: 'collegeconversations.org', measurementId: 'G-QCYZHY7LDJ', kind: 'Client site' },
  { key: 'living-heat', name: 'Living Heat Consulting', domain: 'livingheatfunding.com', measurementId: 'G-RPCBZQ64B6', kind: 'Client site' },
  { key: 'platinum-shine', name: 'Platinum Shine', domain: 'platinumshine.net', measurementId: 'G-QS4QCFX0X1', kind: 'Client site' },
  { key: 'stathesis', name: 'STATHESIS', domain: 'stathesis.com', measurementId: 'G-16YY1DPBME', kind: 'Client site' },
  // No Google Analytics yet (checked 2026-10-31: no tag on the live site, and its privacy
  // policy says it uses no analytics). Put the G- ID here once the property exists.
  { key: 'the-binky-burrow', name: 'The Binky Burrow', domain: 'thebinkyburrow.org', measurementId: null, kind: 'Client site' },
];

// Content clients. YouTube is the platform with an API the browser can read.
export const CONTENT = [
  {
    key: 'college-conversations-youtube',
    name: 'College Conversations with Dr. Fedor',
    platform: 'youtube',
    handle: '@collegeconversations',
    work: 'Every episode edited, motion graphics, thumbnails',
  },
];
