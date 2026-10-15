# Album Ambient Progress Bar · Card Layout Handoff

## Change

- Reused the album-derived bright color field, flowing stars, glass leading edge, and seek press/drag speed response in the standard player progress row.
- Kept the progress row as a separate capsule above the controls in wide cards. In compact and long cards it stays centered between shuffle and volume, with elapsed and total time inside the capsule; the lower controls remain in place.
- Applied matching markup to `ui/index.html` and `ui/standalone.html`.
- Refined the capsule to a slim 14px visual height while keeping its layout row and time labels centered; removed the pink focus outline around the row.

## Files

- `ui/index.html`, `ui/standalone.html` — shared progress capsule structure.
- `ui/style.css` — capsule layers, album color aliases, responsive layout, and animation states.
- `ui/app.js` — shared ambient star field, progress fill/time state, visibility, and seek interaction response.
- `ui/_build.json` — build number updated after implementation.

## Handoff

- Implementation is ready for Hana-side review. No Hana message was sent, per user instruction.
- Not deployed and app was not reloaded. User will relay this handoff; deployment/reload remains pending.
- No tests were run in this pass.
