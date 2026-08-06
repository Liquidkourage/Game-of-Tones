'use strict';

/**
 * Regression tests for YouTube title → display title/artist parse.
 * Run: node server/youtubeTrackDisplayParse.test.js
 */

const { parseYoutubeVideoTitleForDisplay } = require('./youtubeTrackDisplayParse');

/** @type {{ input: string; title: string; artist: string; note?: string }[]} */
const cases = [
  {
    note: 'Jacob #5 — bare YTM title must not invent artist from "You Need"',
    input: 'You Need To Calm Down',
    title: 'You Need To Calm Down',
    artist: '',
  },
  {
    note: 'Dash form still splits correctly',
    input: 'Taylor Swift - You Need To Calm Down',
    title: 'You Need To Calm Down',
    artist: 'Taylor Swift',
  },
  {
    note: 'Jacob #19 — franchise paren stays on title; channel can supply artist',
    input: "I Don't Wanna Live Forever (Fifty Shades Darker)",
    title: "I Don't Wanna Live Forever (Fifty Shades Darker)",
    artist: '',
  },
  {
    note: 'Soundtrack keyword paren stays on title',
    input: 'Shallow (A Star Is Born Soundtrack)',
    title: 'Shallow (A Star Is Born Soundtrack)',
    artist: '',
  },
  {
    note: 'Two-word performer in parens still becomes artist',
    input: 'Bad Girls (Donna Summer)',
    title: 'Bad Girls',
    artist: 'Donna Summer',
  },
  {
    note: 'Leading two-word person + long single-token title still works',
    input: 'Stevie Wonder Superstition',
    title: 'Superstition',
    artist: 'Stevie Wonder',
  },
];

let failed = 0;
for (const c of cases) {
  const got = parseYoutubeVideoTitleForDisplay(c.input);
  const ok = got.title === c.title && got.artist === c.artist;
  if (!ok) {
    failed += 1;
    console.error('FAIL', c.note || c.input);
    console.error('  input :', c.input);
    console.error('  expect:', { title: c.title, artist: c.artist });
    console.error('  got   :', got);
  } else {
    console.log('ok', c.note || c.input);
  }
}

if (failed) {
  console.error(`\n${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} passed`);
