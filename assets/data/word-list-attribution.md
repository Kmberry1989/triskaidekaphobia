# Word list attribution

The playable word bank is derived from [`@skedwards88/word_lists`](https://github.com/skedwards88/word_lists), using its `compiled/commonWords.json` and `compiled/uncommonWords.json` exports.

Words are normalized to uppercase, deduplicated, and limited to 2–13 letters so they fit the elevator floors. The resulting bank is used for both valid guesses and deterministic target selection; the existing themed entries in `dictionary.json` retain their individual clues when selected.

The source project documents the compiled data as **CC-BY-NC**. Review that license before distributing Triskaidekaphobia commercially. Source package version referenced during this import: `3.0.20`.

The curated target catalog in [`curated-answers.json`](./curated-answers.json) includes every common-word target available at each floor length. Floor 02 uses the 36 common two-letter entries available in the source package; floors 03–13 range from 535 to 5,008 common targets. Themed entries in `dictionary.json` retain their custom clues whenever they overlap this common catalog.
