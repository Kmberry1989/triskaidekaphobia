# Triskaidekaphobia: no-code customization catalog

Checked September 21, 2026. This is the inventory of files and settings you can change **without editing the game code**. Keep the same path and filename when replacing an active file; the game will pick up the replacement on the next refresh.

For copy-ready, editable image-generator prompts and one-click copy buttons for every active visual slot, open [asset-prompt-board.html](./asset-prompt-board.html).

## Safe replacement rules

- Preserve an active file's exact filename, extension, and folder. Replacing `assets/audio/door-open.ogg` in place is safe; renaming it is not.
- Use ordinary RGB/RGBA PNG, JPG/JPEG, SVG, or OGG files. Avoid animated image formats: the interface supplies its own motion.
- Keep a copy of any original before overwriting it. The current source files are the fallback.
- Test from a web server or the deployed site after changing JSON or audio. Some browsers restrict `fetch()` when an HTML file is opened directly from disk.
- Files marked **unused** are safely replaceable but will not appear or play until a later code change wires them in.

## Theme and lobby customization

Edit [`assets/data/theme.json`](./assets/data/theme.json) as plain JSON, then refresh the served game. The committed **Building 13 — Default Copper** preset matches the built-in appearance, so it is a safe starting point and a known-good rollback. Its `_preset` block is documentation only; the loader ignores it. You can omit individual properties and unknown properties are ignored. A missing file, malformed JSON, invalid section, or invalid individual value keeps the corresponding built-in default without interrupting boot. The loader does not emit warnings for these expected fallback paths; browser developer tools may still report an ordinary failed network request if the file itself is missing.

Recommended workflow: copy the preset before editing, change one section at a time, keep JSON keys and punctuation intact, then test the lobby and one floor transition at desktop and phone widths. To restore the shipped look, restore the committed preset or remove your custom properties.

| JSON section | Editable fields | Accepted values |
| --- | --- | --- |
| `colors` | `background`, `panel`, `line`, `muted`, `text`, `accent`, `danger`, `correct`, `present`, `absent`, `safe` | Six-digit hex colors such as `#d29252`. These drive the existing CSS color roles. |
| `lobby` | `topline`, `eyebrow`, `title`, `subtitle` | Visible, nonempty plain text, up to 100 characters. HTML markup and control characters are rejected. Short copy fits mobile screens best. |
| `keyboard` | `border`, `faceLight`, `faceMid`, `faceDark`, `label`, `pressedLight`, `pressedMid`, `pressedDark`, `pressedLabel`, `radius` | Colors use six-digit hex. `radius` is `circle` or `rounded`. The first colors set idle buttons; `pressed*` sets the illuminated press. Correct/present/absent key states use the matching `colors` roles. |
| `timings.transition` | `boarding`, `closing`, `traveling`, `arrival`, `opening` | Whole milliseconds from 0 through 10000. These control floor-to-floor sequence stages. |
| `timings.suspense` | `regular`, `late`, `final`, `story`, `finale` | Whole milliseconds from 0 through 10000. These control the checking hold, late-floor story, and finale holds. |

Only listed fields are read. Timing edits apply to the game logic; reduced-motion users still get immediate transitions and holds. Keep `text`/`label` legible against their backgrounds and test both lobby and gameplay after color edits. The JSON is fetched from the same site as the game; use a web server rather than opening `index.html` directly from disk. Because fallback is intentionally quiet, validate JSON with a formatter or `node -e "JSON.parse(require('fs').readFileSync('assets/data/theme.json'))"` before publishing if a change does not appear.

## Artwork

| File | Current status | What it controls | Replacement guidance |
| --- | --- | --- | --- |
| `assets/art/elevator-interior.png` | **Active** | The full-screen elevator-car background behind the puzzle board. This is the only layer that shifts with device motion. | Landscape; current file is 1672 x 941. Use a complete interior with visual room around the edges, because it is slightly enlarged for parallax. |
| `assets/art/outside-parallax.png` | **Active** | The distant sky/city shown through the elevator window, including travel and door-transition atmosphere. | Landscape; current file is 1672 x 941. Dark, low-detail imagery works best because CSS adds haze and movement. |
| `assets/art/glass-reflection-overlay.png` | **Active** | Subtle reflections over the window. | Landscape transparent PNG; current file is 1672 x 941. Mostly transparent with faint highlights. |
| `assets/art/elevator-doors.jpeg` | **Active** | Both sliding elevator doors during a floor-to-floor transition. | Landscape; current file is 2752 x 1536. Make it a symmetrical, front-on pair of doors; the game crops the left and right halves itself. |
| `assets/art/elevator-control-panel.png` | **Active** | Decorative control-panel image on the boarding screen and the browser tab icon. | Portrait or tall image; current file is 1086 x 1448. Keep important details away from edges because it is cropped decoratively. |
| `assets/art/menu/main-menu-background.png` | **Active** | The full-screen main-menu background. | Portrait 3:4 or taller; current file is 1536 x 2048. No baked-in title, menu labels, or instructions. See `assets/art/menu/README.md`. |
| `assets/art/menu/menu-options-underlay.svg` | **Active** | The decorative art beneath the four main-menu choices. Pointer-inert, so it cannot block a button. | Transparent SVG with `viewBox="0 0 640 480"`; do not bake button text into it. |
| `assets/art/menu/menu-title-mark.svg` | **Active** | Small decorative title mark behind the main-menu heading. Pointer-inert. | Transparent SVG with `viewBox="0 0 360 180"`; keep the central title area readable. |
| `assets/art/menu/main-menu-background.svg` | **Unused source/template** | Source artwork used to make the active PNG above. | You may edit or replace it as an archival/template file, but the game reads the PNG, not this SVG. Export a new `main-menu-background.png` after changing it. |
| `assets/art/ChatGPT Image Aug 29, 2026, 12_22_08 AM.png` | **Unused supplied art** | Not currently loaded by the game. | Current size: 1774 x 887. Keep as a concept/reference image or use it as the basis for one of the active slots. |
| `assets/art/Gemini_Generated_Image_668k1l668k1l668k.jpeg` | **Unused supplied art** | Not currently loaded. | Current size: 2752 x 1536. |
| `assets/art/Gemini_Generated_Image_ca8z60ca8z60ca8z.jpeg` | **Unused supplied art** | Not currently loaded. | Current size: 2752 x 1536. |
| `assets/art/Gemini_Generated_Image_ulx82julx82julx8.jpeg` | **Unused supplied art** | Not currently loaded. | Current size: 2752 x 1536. |
| `assets/art/Gemini_Generated_Image_w5h5ldw5h5ldw5h5.jpeg` | **Unused supplied art** | Not currently loaded. | Current size: 2752 x 1536. |
| `assets/art/Gemini_Generated_Image_xp28mzxp28mzxp28.jpeg` | **Unused supplied art** | Not currently loaded. | Current size: 2752 x 1536. |
| `assets/art/IMG_7252.JPG` | **Unused supplied art** | Not currently loaded. | Current size: 250 x 201. |
| `assets/art/updown.JPG` | **Unused supplied art** | Not currently loaded. | Current size: 114 x 219. |
| `assets/797187942_1305870571483276_3291324451521898941_n.jpg` | **Unused supplied art** | Not currently loaded. | It is safe to retain as a reference image; it has no game effect today. |

`assets/.DS_Store`, `assets/art/.DS_Store`, and the root `.DS_Store` are macOS metadata, not game assets. Do not use them as replacement slots.

## Audio

All active audio is OGG. The app gracefully continues if a sound cannot play, but the intended experience needs these files. “Fallback” means the gameplay event works now but shares another sound until you supply a dedicated replacement.

| File | Current duration | Status and gameplay role | Replacement direction |
| --- | ---: | --- | --- |
| `assets/audio/Relay Shaft Ritual.ogg` | 227.13 s | **Active:** looping score/music bed. | 2–4 minute seamless dark elevator score; no abrupt ending. |
| `assets/audio/mainloop-tri.ogg` | 88.76 s | **Active:** low ambient loop. Also a **fallback** for the long checking hold. | 20–90 s seamless shaft air, hum, cable, or fluorescent-bed loop; restrained enough to sit under play. |
| `assets/audio/push-elevator-panel-button.ogg` | 0.67 s | **Active:** submit/confirm button press. | 0.35–0.70 s deliberate mechanical panel press. |
| `assets/audio/boarding-confirmation.ogg` | 0.40 s | **Active:** player starts/boards a run. | 0.25–0.55 s confirmation relay or lock click. |
| `assets/audio/door-close.ogg` | 0.83 s | **Active:** doors close before ascent. | 0.70–1.20 s heavy metal slide and latch. |
| `assets/audio/door-open.ogg` | 0.73 s | **Active:** doors open after arrival. | 0.60–1.10 s metal slide, softer than the close. |
| `assets/audio/elevator-up.ogg` | 4.24 s | **Active:** ascent. Also a **fallback** for suspense rise while a guess is judged. | 3–6 s upward motor/cable pull. It should feel like upward drag, not a generic whoosh. |
| `assets/audio/step-inside.ogg` | 1.73 s | **Active:** entry/step into the car. | 0.8–1.8 s floorboard/metal footstep and car resonance. |
| `assets/audio/floor-arrival.ogg` | 0.74 s | **Active:** arrival. Also a **fallback** for the braking thump. | 0.45–0.90 s elevator stop plus a small service-bell ding. |
| `assets/audio/letter-input.ogg` | 0.38 s | **Active:** letter-button press. Played slower for delete. Also a **fallback** for the floor display tick. | 0.10–0.25 s crisp circular illuminated-button click; it should sound good in rapid repeats. |
| `assets/audio/present-letter.ogg` | 0.31 s | **Active:** a correct letter in the wrong position. | 0.20–0.45 s small electrical acknowledgement, not a win sound. |
| `assets/audio/invalid-word.ogg` | 1.19 s | **Active:** an invalid submitted word. Also layered with the malfunction effect after a wrong valid guess. | 0.65–1.20 s terse reject/buzzer. |
| `assets/audio/failure.ogg` | 0.71 s | **Active:** the escalating wrong-guess malfunction layer and failed run. | 0.70–1.40 s cable strain, relay chatter, mechanical fault, or weakening cable. Make it non-musical and leave room for escalation through repeated playback. |
| `assets/audio/correct.ogg` | 3.17 s | **Active:** correct answer. Also a **fallback** for late-floor cinematic sting. | 1.5–3.5 s warm elevator/service-bell ding with restrained success lift. |
| `assets/audio/reveal.ogg` | 0.48 s | **Active:** Intercom emergency-kit effect (reveals one correct letter). | 0.35–0.75 s intercom click/line-open plus a brief reveal tone. |
| `assets/audio/fifty-fifty.ogg` | 0.57 s | **Active:** both Battery Backup (extra attempt) and Emergency Stop (removes half of impossible keys). | 0.45–0.80 s utility-system confirm. It is shared by two items, so it should be neutral; dedicated versions require a code change. |
| `assets/audio/pass-handoff.ogg` | 0.52 s | **Active:** pass-and-play handoff. | 0.35–0.70 s soft device/pass relay. |
| `assets/audio/run-clear.ogg` | 1.28 s | **Active:** completed ascent/run clear. | 0.9–1.8 s final bell or resolving mechanical release. |
| `assets/audio/floor-log.ogg` | 0.38 s | **Unused** | Safe to keep or replace as a future stats/history log sound; it has no effect today. |

### Dedicated sound slots that do not exist as files yet

These events already have a working fallback. Adding a new filename alone will not activate it; retain the fallback until a code update points the event to the new file.

| Suggested future filename | Current fallback | Desired length and character |
| --- | --- | --- |
| `assets/audio/floor-display-tick.ogg` | `letter-input.ogg` | 0.10–0.20 s dry relay tick for each floor indicator change. |
| `assets/audio/suspense-rise.ogg` | `elevator-up.ogg` | 0.8–1.2 s short tension swell when the answer is checked. |
| `assets/audio/suspense-hold.ogg` | `mainloop-tri.ogg` | 1.0–1.7 s looping electrical tension/fluorescent pulse. |
| `assets/audio/brake-thump.ogg` | `floor-arrival.ogg` | 0.35–0.65 s car settle and brake thump. |
| `assets/audio/cinematic-sting.ogg` | `correct.ogg` | 1.5–2.5 s sparse late-floor story sting. |
| `assets/audio/battery-backup-confirm.ogg` | `fifty-fifty.ogg` | 0.45–0.80 s battery relay, charge-up, or reserve-power confirmation. |

## Word and puzzle content

| File | Current status | What you may safely change |
| --- | --- | --- |
| `assets/data/curated-answers.json` | **Active** | The candidate answers for each floor length (keys `2_letters` through `13_letters`). Add/remove uppercase A–Z words only. Every answer must have exactly the number of letters named by its key, also appear in `accepted-words.json`, and have a matching entry in `dictionary.json` if you want a custom hint. |
| `assets/data/dictionary.json` | **Active** | The themed word metadata and clues. It uses the same `2_letters`–`13_letters` keys. Each entry must be an object with `word`, `pos`, and `hint`; use uppercase A–Z words of the exact key length. Existing words without an entry still receive a generic fallback clue. |
| `assets/data/accepted-words.json` | **Active** | The complete list of valid guess words. It is a JSON array of uppercase words; any curated target must also be included here. The current bank has 185,362 entries. |
| `assets/data/word-list-attribution.md` | **Reference/legal** | Attribution and licensing note for the current word source. Update it if you replace the word bank or redistribute under a different license. It does not affect play. |

Before publishing word edits, validate the three files together: no duplicate concern is required, but malformed JSON, a wrong-length target, or a curated word missing from the accepted list stops the game from loading that floor.

## App identity and connected-service settings

These are editable files rather than media. They are not required for a visual/audio reskin, but they are the remaining no-code configuration surfaces.

| File | Current status | Safe changes | Important boundary |
| --- | --- | --- | --- |
| `manifest.json` | **Active** | App name, short name, launch URL, browser/PWA theme color, and background color. | The manifest currently has no separate app-icon slot; the browser tab icon comes from `elevator-control-panel.png`. Adding an install icon entry would require a small manifest edit, but no game-code edit. |
| `firebase-config.js` | **Active when Online Room is used** | Firebase project configuration, whether online play is enabled, and STUN/TURN server list for voice. | This is operational configuration, not a cosmetic setting. Use your own Firebase project and a real TURN service before changing it; a browser-delivered Firebase web key is not a secret. |
| `firebase.json` | **Deployment configuration** | The Firestore rules-file path. | Does not alter the player experience by itself. |
| `firestore.rules` | **Active after Firebase deployment** | Online-room, chat, presence, results, and challenge permissions. | This is security-sensitive logic. Treat changes as a deployment/security review, not a cosmetic replacement. |

## What is not externally replaceable today

Other interface copy and labels, menu choices, fonts and layout, floor count, shaking, light flicker, vibration patterns, door-motion keyframes, emergency-kit mechanics, and local history/save behavior still live in `index.html`, `style.css`, or `game.js`. The theme file changes the listed surface values; it does not change game rules or puzzle content.
