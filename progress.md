Original prompt: PLEASE IMPLEMENT THIS PLAN: Triskaidekaphobia Daily Elevator Arcade + Social Competition.

## Current implementation

- Rebuilt the single-page experience around a local-first lobby, deterministic daily/challenge seeds, pass-and-play, resume, stats/history, and shareable challenge URLs.
- Updated the ascent model so operators board on floor 1, solve a two-letter puzzle on floor 2, and progress one letter per floor through a thirteen-letter floor 13 puzzle.
- Added a parallax glass-window scene with moving clouds, skyline silhouettes, reflections, window mullions, and floor-linked motion behind the board.
- Integrated the supplied PNG art: `elevator-interior.png` is the base car scene, `outside-parallax.png` drives the depth layers, `glass-reflection-overlay.png` adds the window texture, and `elevator-control-panel.png` decorates the boarding state without replacing semantic controls.
- Forced every guess row into a single non-wrapping horizontal strip; tile widths and letter size now shrink with the active floor length so floor 13 remains readable on narrow screens.
- Added explicit run/result state, local storage, accepted-word validation, duplicate-aware scoring, keyboard states, in-page clues, improved lifelines, result summaries, and accessibility semantics.
- Added responsive viewport constraints plus atmospheric elevator motion and a sound-ready Web Audio layer with mute persistence. The game container now clips focus-driven scroll movement as well as touch/page overflow.
- Added an opt-in Firebase adapter for anonymous auth, result publishing, challenge persistence, and leaderboard sorting, while retaining local storage when no Firebase web config is present.
- Expanded the target catalog across floors 2–13 and added a 209-word accepted-guess list including the two-letter floor.
- Replaced the small guess list with the normalized 2–13-letter union of `@skedwards88/word_lists` common and uncommon exports: 185,362 playable words. Every imported word can now be selected as a deterministic target; the original themed catalog supplies richer clues when one of those entries is chosen.
- Added `assets/data/word-list-attribution.md` documenting the source, filtering, package version, and CC-BY-NC licensing constraint.

## Verification TODOs

- Syntax and JSON checks passed; `game.js` parses cleanly and the accepted-word data is valid.
- Browser QA passed at default desktop, 390x844 portrait, and 844x390 landscape. The boarding state, floor-two board, lifelines, and keyboard fit with no document overflow or focus-driven scroll.
- Repaired the published `accepted-words.json` blob after a truncated upload caused `Unexpected token 'Y'` during boot. The current deployment loads the full word list, reaches the lobby and boarding state, and no longer reports the floor-map JSON error. Added the existing control-panel PNG as the favicon to remove the remaining browser-console 404.
- Verified daily start, physical keyboard entry, on-screen keyboard entry, invalid-word rejection, duplicate-aware evaluation path, reveal, clue panel, 50:50, floor 3-to-4 transition, pass-and-play handoff, challenge URL generation, resume, stats/history, audio toggle, failed result, and full 3-to-13-floor victory.
- The browser smoke client produced a screenshot and `render_game_to_text` state with no console error artifact; final victory browser capture also had no warning/error logs.
- The new seeded victory path reached floor 13 from the floor-one boarding state with 12 solved puzzles, 12 guesses, and an `ASCENT COMPLETE` modal; separate tabs produced the same floor-two and floor-three revealed letters for seed `123456`, and the browser reported no warning/error logs.
- Row-fit regression passed at 390x844: floor 13 produced thirteen 24.61px tiles in one row, row scroll width matched row width, all tile text fit, and document height matched the viewport.
- Supplied-art browser QA passed at 390x844 and 844x390; all four image URLs resolved, floor-two controls remained reachable, document height matched the viewport, and no warning/error logs were recorded.
- Added a layered ascent pass: the far skyline scrolls 18px with 1.35px blur, the nearer city layer scrolls 34px with lighter blur, the horizon moves 9px, and the glass reflection briefly brightens and drifts. Mid-transition computed-style QA confirmed the transforms/filters and landing returned to floor 03 with no overflow.
- Imported and normalized the full `@skedwards88/word_lists` common + uncommon corpus for playable lengths 2–13: 185,362 unique words. The browser smoke pass booted the larger bank, preserved the floor-one boarding screen, and advanced from a seed-selected imported target (`EX`) to floor 3 with no console errors.
- Daily mode now preserves the shared daily seed for the first ascent, then changes its lobby card to `FRESH ASCENT` after a clear. Fresh ascents use a new per-run random seed, and success-screen retry follows the same behavior so each player can continue climbing without replaying the daily puzzle.
- Daily replay QA passed: a completed current-day result changed the lobby card to `FRESH ASCENT`; two consecutive starts entered `FREEPLAY` at floor 1 with different seeds (`3221842000` and `2269510090`) and no console errors.
- Added explicit `isValidGuess` checking for every full-length submission and a themed `ACCESS DENIED` state for unknown words. Invalid guesses retain their letters, do not increment `run.attempts`, mark the active row with a red pulse, announce `NO ATTEMPT USED`, and clear on edit. Added the state to `render_game_to_text` for browser verification.
- Invalid-entry browser QA passed in the default viewport plus 390x844 portrait and 844x390 landscape: `ZZ` stayed in the active row, the floor remained 02 with no attempt consumed, the warning and `NO ATTEMPT USED` cue stayed visible without covering controls, editing cleared the warning, and `AT` consumed one normal attempt. No console warnings or errors were recorded; `node --check game.js` and JSON parsing passed.
- Curated target validation now uses only the 68 themed entries from `dictionary.json`, while the 185,362-word accepted list remains available for guesses. Boot rejects missing or malformed target metadata instead of falling back to an arbitrary answer; all floors 2–13 have a part of speech and clue.
- Curated-target browser QA passed: the Floor Log showed the selected floor-two clue and part of speech, using the clue did not consume an attempt, `GHI` remained a valid three-letter guess but was not an answer candidate, and closing the spent clue lifeline returned focus to the board without console errors.

## Sound wishlist

- Door open/close: heavy, damped metal movement with a soft hydraulic hiss and a clean arrival chime.
- Floor select/boarding: tactile copper relay click, followed by a small confirmation ping.
- Elevator movement: low sub-bass motor hum that rises gently, with cable resonance kept felt rather than loud.
- Letter input: dry, intimate button click with a short mechanical tail.
- Correct guess: restrained three-note glass-and-metal chord, warm rather than celebratory.
- Present letter: muted amber ping with a slightly detuned second tone.
- Invalid word: brief relay buzz and a soft warning-light tick; never an aggressive error beep.
- Reveal: narrow radio sweep resolving into a bright pinpoint tone.
- 50:50: two quick electrical pops, then a small air-release sound as the wrong keys go dark.
- Floor arrival: brake thump, cable settle, door chime, and a half-second shaft ambience.
- Pass-and-play handoff: hush the motor, latch click, then a clear spoken-free handoff pulse.
- Run clear: ascending harmonic bed, gentle bell, and room tone opening into space.
- Failure: strained cable groan, power dip, hard brake stop, and a red warning pulse.
- Firebase hosting is not enabled until a project web config is supplied in `firebase-config.js`; offline play and local history remain the default.
- PNG asset generation is pending: the key is configured, but all four image requests returned `429 credit_balance_exhausted`, so no fake art was added. Intended outputs remain elevator interior/car, layered outside parallax, and elevator control buttons.
