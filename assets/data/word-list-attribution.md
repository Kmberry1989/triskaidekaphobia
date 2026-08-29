# Word list attribution

The playable word bank is derived from [`@skedwards88/word_lists`](https://github.com/skedwards88/word_lists), using its `compiled/commonWords.json` and `compiled/uncommonWords.json` exports.

Words are normalized to uppercase, deduplicated, and limited to 2–13 letters so they fit the elevator floors. The resulting bank is used for both valid guesses and deterministic target selection; the existing themed entries in `dictionary.json` retain their individual clues when selected.

The source project documents the compiled data as **CC-BY-NC**. Review that license before distributing Triskaidekaphobia commercially. Source package version referenced during this import: `3.0.20`.
