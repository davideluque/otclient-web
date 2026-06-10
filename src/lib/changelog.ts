/**
 * The in-game changelog data. One line per user-visible change merged to
 * main, newest first — written for the player ("what should I test?"),
 * not for developers (that's git log).
 *
 * PROCESS: every PR that merges a user-visible change appends its line
 * here in the same PR. Dates are merge dates.
 */

export interface ChangelogEntry {
  /** ISO date (YYYY-MM-DD) the change landed on main. */
  date: string;
  text: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  { date: '2026-06-10', text: 'Walking flows through network hiccups (no more stutter every few tiles) and the black edge behind you while moving is gone.' },
  { date: '2026-06-10', text: 'Continuous walking: steps now glide at your real walking rhythm — no more micro-pause between tiles.' },
  { date: '2026-06-10', text: 'Walking is smooth now: the camera and creatures glide between tiles instead of snapping.' },
  { date: '2026-06-10', text: 'The screen no longer dims/sleeps while playing (wake lock, like the offline map).' },
  { date: '2026-06-10', text: 'Tap-to-walk is back: tap a tile and the player paths to it (long-press still looks, double-tap still uses).' },
  { date: '2026-06-10', text: 'The inventory now shows real item graphics instead of numbers.' },
  { date: '2026-06-10', text: 'New look: the purple is gone — the UI is now blacks, grays, and whites.' },
  { date: '2026-06-10', text: 'Settings → Show metrics: on-screen FPS, walk latency, and repaint cost for the lag hunt (?metrics=1 works too).' },
  { date: '2026-06-10', text: 'Added Settings to the menu — auto-attack toggle, synced with the ⚔ circle.' },
  { date: '2026-06-10', text: 'Fixed monsters not visibly walking (their steps were being dropped).' },
  { date: '2026-06-10', text: 'Rats now spawn just east of the D\'aracia depot for combat testing.' },
  { date: '2026-06-10', text: 'Added this changelog to the menu — check here to see what to test.' },
  { date: '2026-06-10', text: 'Fixed stairs/ladders putting you in the wrong place with black areas around you.' },
  { date: '2026-06-10', text: 'Fixed your name vanishing after going down a floor.' },
  { date: '2026-06-10', text: 'Chat is now a fixed small panel with a ✕ to close it; switching channels no longer resizes or breaks it.' },
  { date: '2026-06-10', text: 'Fixed the player (and creatures) always facing the same way while walking.' },
  { date: '2026-06-10', text: 'Dev builds auto-login on reload (add ?autologin=0 to use the form).' },
  { date: '2026-06-10', text: 'The game now fills the whole phone screen in both orientations — no more purple bars.' },
  { date: '2026-06-10', text: 'Fixed iOS staying zoomed-in after the first login (input focus auto-zoom).' },
  { date: '2026-06-10', text: 'Added the combat bar: spell circles (exura, vita, lux) and a ⚔ auto-attack toggle that sticks to its target.' },
  { date: '2026-06-10', text: 'Added speech bubbles above creatures when they talk.' },
  { date: '2026-06-10', text: 'Added look (long-press / right-click), use (double-tap — ladders, sewers, doors), and Log out in the menu.' },
  { date: '2026-06-10', text: 'Added the inventory pane — live equipment, toggled from the menu.' },
  { date: '2026-06-09', text: 'Walk animation: creatures cycle walk poses on confirmed steps.' },
  { date: '2026-06-09', text: 'Landing page at / — Play online or Browse the map.' },
  { date: '2026-06-09', text: 'Fixed citizen outfit colors to match the real server defaults.' },
];
