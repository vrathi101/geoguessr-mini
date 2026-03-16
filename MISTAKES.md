# GeoGuessr Mini — Bug Log & Lessons Learned

Running log of bugs caught across audit/debug cycles. Add every new bug here to avoid repeat mistakes.

---

## BUG-01 · Timer + Manual Guess Race Condition
**Symptom:** If timer fires at exact moment player clicks GUESS, both `autoSubmitRound()` and `submitGuess()` run, pushing two entries into `roundScores` / `_allGuesses`, breaking the 5-round invariant.
**Fix:** Added `roundSubmitted` boolean flag. Both functions check-and-set atomically; second caller returns immediately.
**Lesson:** Any async path that modifies shared game arrays needs a mutex-style guard.

---

## BUG-02 · `Promise.all` fail-fast kills all location fetches
**Symptom:** If one of 5 concurrent `getRandomValidLocation()` calls exhausts MAX_RETRIES and throws, `Promise.all` immediately rejects. The other 4 in-flight calls keep running in the background consuming API quota with no way to cancel them.
**Fix:** Game shows alert + returns to home (existing catch block). Zombie promises are unavoidable without an AbortController, but they're harmless to UX. Documented as known behavior.
**Lesson:** `Promise.all` is fail-fast. For truly independent work where partial results are acceptable, use `Promise.allSettled` + filter.

---

## BUG-03 · NMPZ pano_changed Race — Locks to Wrong Panorama
**Symptom:** `_nmpzPanoId = null` is set at start of `loadRound`, then `setPosition` is called. A stale `pano_changed` event from the prior round fires in the same microtask tick (before the new position loads), and the listener sets `_nmpzPanoId` to the *old* round's pano ID. New round gets snapped back to old location on every movement.
**Fix:** Added `_nmpzAccepting` flag. Set `false` at start of `loadRound`, re-enabled via `setTimeout(0)` after current sync work drains. Listener ignores events while `!_nmpzAccepting`.
**Lesson:** Google Maps `pano_changed` can fire with stale data during panorama transitions. Always drain the event queue with `setTimeout(0)` before accepting new events.

---

## BUG-04 · Double-Click "Next Round" Skips a Round
**Symptom:** Rapid double-click on "Next Round" increments `roundIndex` twice before screen transition. Round N is silently skipped; final score is under-counted.
**Fix:** Disable the button at the start of `nextRound()`. Re-enable it at the start of `showRoundResult()`.
**Lesson:** Any button that mutates game state should be disabled immediately on click and re-enabled only when the next valid state is reached.

---

## BUG-05 · Concurrent `startNewGame` Calls (Rapid Play Again)
**Symptom:** Double-clicking "Play Again" calls `startNewGame()` twice. Both reset shared state and spawn two `Promise.all` chains writing to the same `locations` array. The second `loadRound(0)` call resets the Street View mid-game.
**Fix:** Added `_gameLoading` boolean guard. `startNewGame` returns immediately if already loading.
**Lesson:** Entry-point async functions that mutate global state need re-entrancy guards.

---

## BUG-06 · XSS via `display_name` / `avatar_url` in Leaderboard innerHTML
**Symptom:** Leaderboard rows built with template literals directly interpolating `row.display_name` and `row.avatar_url` from the database. A malicious value like `"><img src=x onerror=alert(1)>` executes JavaScript for all viewers.
**Fix:** Added `escapeHtml()` utility (replaces `&`, `<`, `>`, `"`, `'`). Applied to all user-controlled strings before inserting into innerHTML.
**Lesson:** NEVER interpolate external/user data directly into innerHTML. Always escape. Use `textContent` for plain text; use escaping for attributes.

---

## BUG-07 · `localStorage` Config Type Coercion
**Symptom:** `loadConfig()` used `Object.assign({}, defaults, parsed)` without type checking. If localStorage contains `{timer: "sixty"}` (e.g. from browser extension or manual edit), `startTimer("sixty")` runs — `setInterval` receives a string, `timerRemaining--` produces `NaN`, timer displays "NaN:NaN" and never auto-submits.
**Fix:** Explicit type validation per key: `typeof parsed.timer === 'number'`, `typeof parsed.difficulty === 'string'`, `typeof parsed.noMove === 'boolean'`.
**Lesson:** Always validate types when reading from localStorage, not just handle JSON parse errors.

---

## BUG-08 · Save Score Button Permanently Disabled on Failure
**Symptom:** `handleSaveScore()` disabled the button before attempting save. On failure, the button stayed disabled, giving the user no way to retry without refreshing.
**Fix:** Re-enable the button and show "Failed to save. Try again." on error.
**Lesson:** Disable buttons during async operations, but always restore them on failure. Only keep disabled on success to prevent duplicates.

---

## BUG-09 · Timer Displaying Negative Values
**Symptom:** `timerRemaining` could theoretically go below 0 if `setInterval` fires slightly after the `<= 0` check, displaying negative time.
**Fix:** Added `Math.max(0, seconds)` clamp in `formatTime()`.
**Lesson:** Display functions should clamp values to valid display ranges.

---

## BUG-10 · `StreetViewSource` / `StreetViewPreference` Undefined Without `streetView` Library
**Symptom:** Google Maps JS API loaded without `streetView` in the `libraries` param. Accessing `googleMaps.StreetViewPreference.NEAREST` threw `TypeError`, silently caught by the retry loop — all 30 retries failed.
**Fix:** Added `streetView` to `&libraries=geometry,marker,streetView`. Added optional chaining: `StreetViewPreference?.NEAREST ?? 'nearest'`.
**Lesson:** Always explicitly load required Google Maps sub-libraries. Enum namespaces are not guaranteed without explicit loading.

---

## BUG-11 · `supabase` Variable Name Conflict with CDN Global
**Symptom:** Supabase CDN declares `var supabase` globally. Local `let supabase = ...` threw `SyntaxError: Identifier 'supabase' has already been declared`.
**Fix:** Renamed local variable to `sb`.
**Lesson:** Check CDN library global namespace pollution before naming local variables. Use short prefixed names for library clients.

---

## BUG-12 · `.env` Serveable as Static File
**Symptom:** `server.js` served any file under ROOT directory. `GET /.env` returned the API key file contents.
**Fix:** Added explicit block: if `basename === ".env" || basename.startsWith(".env.")` → 403 Forbidden.
**Lesson:** Dev servers must explicitly block sensitive files (`.env`, `*.key`, credentials) before filesystem lookup.

---

## BUG-13 · Score Emoji Thresholds Mismatched with Score Color Classes
**Symptom:** `scoreEmoji()` used thresholds 4000/2000/1000. `scoreClass()` used 4500/2500/1000. A score of 4200 showed 🟩 (green emoji) but displayed in gold CSS class — visually inconsistent.
**Fix:** Unified `scoreEmoji()` to use 4500/2500/1000.
**Lesson:** When two systems classify the same values, use a single source-of-truth constant.

---

## BUG-14 · Dead Code Aliases (`COVERAGE_ZONES`, `ZONE_WEIGHTS`)
**Symptom:** Two unused alias variables pointed to `WORLD_ZONES` / `WORLD_WEIGHTS`. No code referenced them.
**Fix:** Removed both lines.
**Lesson:** Remove dead aliases immediately when refactoring. They mislead future readers about what's actually used.

---

## PATTERN · `calculateScore` Return Value Change
**Note (2026-03-15):** `calculateScore(distanceMeters)` signature changed to return `{base, multiplier, final}` object (to support streak multipliers). Any future caller must destructure: `const { final: score } = calculateScore(d)`.

---

## PATTERN · Seeded RNG
**Note (2026-03-15):** `rng` module-level variable holds the current game's seeded LCG. `null` = use `Math.random`. Always pass `rng || Math.random` to `getRandomValidLocation()` and `pickZoneFromList()`. Reset `gameSeed = 0; rng = null` between games.
