# Session Handout — Playback, Grading Display, and Dependencies

**Date:** 15–16 September 2026
**Scope:** made "click a cell, hear that reading" actually work; aligned the graded grid with the printed PDF; audited dependencies.

---

## 1. Summary

| # | Work | Outcome |
|---|---|---|
| 1 | Read the whole codebase | Findings in §11 |
| 2 | Diagnosed `GET /api/style-sets` → 500 | Empty `.env`; not a code fault |
| 3 | Dependency audit → `requirements.txt` | Found 3 undeclared packages, one load-bearing |
| 4 | Playback bug 1 — headerless VBR MP3 | Seek error 750 s → **0.1 s** |
| 5 | Playback bug 2 — seek before metadata | Silent no-op; played from the top |
| 6 | Playback bug 3 — matcher anchoring | Readings located 29/71 → **60/71** |
| 7 | Playback enhancement — match on the spoken value | Readings located → **68/71** |
| 8 | Graded grid now matches the PDF | One number per cell, not two |
| 9 | Audio stops when the cell editor closes | Cancel, Escape, Stage, and cell-switch |

**Tests:** 310 → **323** Python, 30 → **35** frontend. `ruff` unchanged at the 12 errors that already existed on `7d02a8f`.

---

## 2. Where the work lives

| Commit | Contents |
|---|---|
| `7d02a8f` | *(pre-session)* the playback feature as the interrupted session left it |
| `122be14` | requirements files, `playback.py` matcher rewrite, `app.py` audio endpoint, `test_playback.py` |
| `513b948` | `AuditSheet.tsx` grid convention + seek fix, `styles.css`, `AuditSheet.test.tsx` |
| *uncommitted* | `AuditSheet.tsx` + `AuditSheet.test.tsx` — stop-audio-on-close (§8) |

> `122be14` also swept ~75 files of `data/` into the repo. See §11.1 — this is the highest-priority open item.

---

## 3. Diagnosis: `/api/style-sets` returned 500

Not a code fault. `.env` existed but was **0 bytes**, so `OPENAI_API_KEY` was unset.

```
GET /api/style-sets → SettingsDep → settings_dependency() (app.py:65)
                    → Settings.load() → no key → ConfigError
                    → HTTPException(500)
```

The response body already carried the reason; the uvicorn access log just does not show bodies:

```json
{"detail": "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in."}
```

No restart needed after filling it in — `lru_cache` does not cache exceptions, so the next request re-runs `load_env_file()`.

**Note:** this endpoint does not actually need the key (`list_style_numbers` is a pure filesystem read), but every route shares one `SettingsDep`, so a missing key takes the style dropdown down with it. Left as-is; flagged in §11.

---

## 4. Dependency audit

Created **`requirements.txt`** and **`requirements-dev.txt`** (the latter pulls the former in via `-r`). Every third-party import across `src/` and `tests/` was mechanically mapped to a distribution; the only unmatched hits were prose inside docstrings.

Three packages were imported but **not declared** in `pyproject.toml`:

| Package | Why it matters |
|---|---|
| **`httpx`** | Listed under `dev` only, but `services/timing.py` imports it at module level and `api/app.py` imports that module. A clean `pip install -e .` therefore **cannot import the app**. |
| **`pydantic`** | `api/app.py` does `from pydantic import BaseModel` directly. Arriving via FastAPI is luck, not a contract. |
| **`pillow`** | `style_set/artwork.py` needs it to lift the sketch and eagle out of a style set. Without it a broad `except` swallows the failure and **every report silently ships without the client's artwork**. |

`pyproject.toml` was left untouched — the `httpx` misplacement is still there.

---

## 5. Playback: "every cell plays the same snippet"

### 5.1 How the feature works

Deepgram **does not split anything**. It returns a flat list of words with timestamps — 1616 words over 18:42 for the reference recording. All segmentation is `services/playback.py`.

```
recording ──▶ Deepgram nova-3 (language=multi) ──▶ [(word, start, end) × 1616]
                                                     │  cached as
                                                     │  data/transcripts/<stem>.words.json
                                                     ▼
        cues()  for each reading, in dictation order:
                  slide a 6-second window forward from the pointer
                  score the reading's NAME words and its VALUE words against it
                  anchor = first wanted word in the winning window
                  window runs to the next reading, clamped 14–45 s
                                                     │
                                                     ▼
                  {"11": {start: 529.4, end: 543.4, exact: true}, ...}
                                                     │
   <audio> seeks to start, timeupdate pauses at end  ◀── the "split" is virtual
```

The clip is never cut server-side. The browser fetches only the seconds it plays, via HTTP Range. Slicing would mean writing and cleaning up a temp file per cell, per click, for no gain.

**The Deepgram boundary, verified:** its word text is read at exactly one line — in `playback.py`, inside the matcher. Nothing in `pipeline/` or `csv_filler/` imports `timing` or `playback`. The report is still built from the two `gpt-transcribe` passes. An absent `DEEPGRAM_API_KEY` yields **409, not 500**, and costs only playback.

### 5.2 Bug 1 — headerless VBR MP3

`rec_2463.mp3` is variable bitrate (frames from 32 to 224 kbps) with **no Xing/Info/VBRI seek table**. The browser reads frame one, sees 32 kbps, and assumes it holds for all 13.5 MB:

| | |
|---|---|
| True duration | **1122.1 s** |
| Browser's computed duration | `13482456 × 8 ÷ 32000` = **3370 s** |
| Resulting seek mapping | `currentTime = T` → byte `T×4000` → real time **T ÷ 3** |

Every cue landed at a third of its position — rows 11/12/13 (534.5 / 536.7 / 537.6 s) all landed **within one second of each other**. That is the "same bit" symptom.

**Fix:** `/audio` now serves a cached, seekable re-encode instead of the upload.

- `services/playback.py` → `playable_copy()`, cached at `data/transcripts/<stem>.play.mp3`, reusing the existing `compress_for_upload`.
- Falls back to the original on any ffmpeg failure — approximate seeking beats a dead player.
- The timeline is unchanged, so the existing `.words.json` stays valid. **No re-indexing, no extra Deepgram spend.**

Measured on the reference recording:

| | Before | After |
|---|---|---|
| Browser-computed duration | 3370 s | **1122.2 s** |
| Seek error | ~750 s | **0.1 s** |
| Build | — | 1.9 s, 13.5 → 6.7 MB, cached |
| Format | VBR, no header | CBR 48 kbps, MPEG-2 16 kHz, Info header |

This also fixes browser-recorded `.webm` uploads, which carry neither a Cues element nor a duration and were equally unseekable.

### 5.3 Bug 2 — seeking before the timeline is known

`<audio preload="none">` plus an immediate `currentTime` assignment is silently dropped: with `readyState === HAVE_NOTHING` the element has loaded nothing to seek within. Playback then starts from the top — indistinguishable from a wrong cue.

**Fix** (`AuditSheet.tsx`): `preload="metadata"`, and the seek waits for `loadedmetadata` when the element is not ready. `preload="metadata"` also starts the server building its seekable copy while the reviewer is still reading the grid.

### 5.4 Bug 3 — the matcher anchored on the wrong thing

Two defects, both found by instrumenting the loop:

1. **The anchor was the window's first word, not the phrase.** The window is 6 s wide and the phrase can sit anywhere in it, so playback opened up to 6 s early — mid-way through the *previous* reading.
2. **The pointer advanced one word past where the window opened** (`pointer = best_at + 1`), so the next reading re-matched the same utterance. Rows 11/12/13 anchored at words 708/709/711 — adjacent words.

Padded to the 14-second minimum window, all three played identical audio.

**The trigger:** Deepgram transcribed *"waistband"* as **"we spend"**. Reading 11's own utterance therefore scored 50 %, the matcher walked on, and took the 100 % match belonging to reading 12. Because the pointer only moves forward, that single theft dragged every later reading along with it.

**Fixes:**

- Anchor on the **first word actually asked for**, not the window's opening word.
- Advance the pointer **past the whole matched phrase**.
- **`MAX_JUMP_SECONDS = 30`** — disbelieve a match too far ahead of the previous reading, since that is the same POM being read again for the next size. Exempt at a genuine size change (the inspector works one size at a time, so a new block legitimately starts minutes later), and widened for each reading the index missed.

The cap was tuned empirically: anything from **15 s to 30 s scores identically**, so 30 sits on a wide flat plateau rather than a peak. A flat 45 s scored marginally better in isolation but broke two existing tests that encode legitimate behaviour — size-boundary jumps and single skipped readings.

### 5.5 Enhancement — corroborate with the spoken value

The point-of-measure name is weak evidence: the sheet repeats every name once per size, and the one that matters most is often the one speech recognition mangled. **The value does not repeat that way** — "twenty six three quarter" occurs once in the whole recording.

`_value_tokens()` converts a `Fraction` into what people actually say:

| Value | Tokens | Heard in the index as |
|---|---|---|
| `1 1/4` | `one, quarter` | "one and a quarter" |
| `1 3/8` | `one, three, eight` | "one three by eight" |
| `26 3/4` | `twenty, six, three, quarter` | "twenty six three quarter" |
| `39` | `thirty, nine` | "thirty nine" |
| `40 1/2` | `forty, half` | "forty and a half" |

`by` is deliberately excluded — every fraction on the sheet is spoken with it, so it appears in nearly every window and would inflate all scores equally.

**The rule is "first agreement", not "best match".** Scan forward and take the *first* window where the name clears `MATCH_FLOOR` **and** at least `VALUE_FLOOR` (half) of the number's words are present. Taking the *best* match was the trap — the best is usually a later size block, where the same POM is read again with a different value. Two earlier attempts failed for instructive reasons:

- Blending name and value into one score, then applying `MATCH_FLOOR` to the blend: name-only matches fell below the floor. Coverage dropped to 48/71.
- Separating ranking from the floor but still picking the global best: the global best sits in a later block, so `MAX_JUMP_SECONDS` rejected it and the cascade resumed. 47/71.

`MATCH_FLOOR` now gates on the **name alone**, so a mangled number costs corroboration, never the cue. If the value never corroborates, the matcher falls back to the best the name can do by itself.

### 5.6 Measured effect

Reference recording, style 2463, 71 readings:

| | HEAD (`7d02a8f`) | after §5.4 | after §5.5 |
|---|---|---|---|
| readings **actually located** | 29 / 71 | 60 / 71 | **68 / 71** |
| interpolated guesses | 42 | 11 | **3** |
| cues offered | 71 | 71 | 71 |
| median gap between cues | **0.0 s** | 4.9 s | **5.1 s** |
| cues under 4 s apart | 57 | 20 | 21 |

Ground-truth spot check — all six size-XS readings now land on their own utterance, in order, each containing its own number. `Waistband height` moved **7 seconds earlier onto its real reading** despite "waistband" being transcribed "we spend", because `1 1/4` is spoken there and `1 3/8` is spoken in the utterance it used to steal.

The 3 still interpolated are marked `exact: false`; the editor already says *"Placed between its neighbours, so this is approximate."* Neither their name nor their number survived transcription — there is nothing in the index to find.

---

## 6. Graded grid now speaks the same language as the PDF

**The question:** each cell showed two numbers, identical on most rows. Were there two competing measurements?

**No.** There are four numbers in the system and the grid was showing two of them:

| Number | Source | Shown where |
|---|---|---|
| **spec** | the style-set PDF | grid, PDF headline |
| **deviation** | called aloud by the inspector | grid, PDF |
| **measured** | computed: `spec + deviation` | grid (formerly) — never typed, never spoken |
| **read aloud** | the absolute the inspector said | cell editor only — never the grid |

The stacked pair was *measured over spec*. On every `ok` row the deviation is zero, so the two were **identical** — which read as duplication. Worse, the screen led with `measured` while `graded_report.py` leads with `spec`, breaking the project's own design principle 3 (*"Screen and paper speak one language"*).

**Option A chosen:** the grid now shows the spec as the single headline number with the deviation beneath, exactly as the PDF prints it.

```
before:  28 1/4 · 28 3/4 · 100% · -1/2 · ✓
after:   28 3/4 · 100% · -1/2 · ✓

ok row:  1 1/4 · 1 1/4 · 100% · ok · ✓   →   1 1/4 · 100% · ok · ✓
```

The computed measurement is not lost — it remains one click away in the cell editor under **Measured · spec + deviation**, read-only, so a typed measurement can never become a second source for a number that must have exactly one.

Dead `td.cell .from` CSS rule removed.

**Confirmed intact:** the PDF spec is the only source of the number, the recording contributes only the deviation, and the spoken absolute never reaches the grid or the report — it exists solely for the `≠` dispute check and size attribution.

---

## 7. A real finding surfaced on the way

`4.04A WAIST RELAXED @ TOP EDGE`, size M: the inspector read **33 1/4** aloud, but the sheet specs **30 3/4** and the called deviation of −1/2 makes it **30 1/4**. The two spoken numbers cannot both be right. The cell is flagged `disputed` (`≠`) at 90 % confidence and wants listening back to.

---

## 8. Audio stops when the cell editor closes

Keyed on the open cell rather than the Cancel button, because Cancel is one of four ways out:

| Way out | Before | Now |
|---|---|---|
| Cancel | kept playing | stops |
| Escape key | kept playing | stops |
| Stage this change | kept playing | stops |
| Opening a different cell | kept playing | stops |

```tsx
const silence = useCallback(() => {
  stopAt.current = 0;        // or the end-of-cue handler fires on a stale boundary
  audio.current?.pause();
}, []);

useEffect(() => { silence(); }, [open, silence]);
```

Clearing `stopAt` matters as much as the pause: left set, the `timeupdate` handler would pause the *next* reading the moment it crossed the old cue's end. Leaving the sheet entirely already stopped playback — removing a media element from the document pauses it per spec.

---

## 9. Files changed

| File | Change |
|---|---|
| `requirements.txt` | **new** — runtime dependencies |
| `requirements-dev.txt` | **new** — `-r requirements.txt` plus pytest, ruff, xlwt |
| `src/services/playback.py` | `playable_copy()`, `playable_path_for()`, `_value_tokens()`, `_spoken_number()`, `MAX_JUMP_SECONDS`, `VALUE_FLOOR`; matcher rewritten |
| `src/api/app.py` | `/audio` serves the seekable copy; `content_disposition_type="inline"` + explicit media type |
| `src/frontend/src/components/AuditSheet.tsx` | cell shows spec not measured; `preload="metadata"`; seek waits for metadata; `silence()` on close |
| `src/frontend/src/styles.css` | removed dead `td.cell .from` |
| `tests/test_playback.py` | +13 tests |
| `src/frontend/src/components/AuditSheet.test.tsx` | **new** — 5 tests (first coverage this component has had) |

---

## 10. Verification

| Check | Result |
|---|---|
| `pytest` | **323 passed** |
| `npm test` | **35 passed** |
| `eslint` / `vite build` | clean |
| `ruff check src tests` | 12 errors — **identical to `7d02a8f`**, none added |

**Mutation-checked** (each guard confirmed to fail when its logic is reverted, so no test passes for the wrong reason):

- Grid convention → revert cell to `measured`: 2 of 3 fail
- Value corroboration → `VALUE_FLOOR = 2.0`: rescue test fails
- Stop-on-close → disable the effect: 2 of 2 fail

---

## 11. Open items

### 11.1 `data/` is committed to git — highest priority

`README.md` states: *"`data/` is gitignored and must stay that way. It holds client audio and AEO spec sheets marked proprietary and confidential."*

It is **not** gitignored. `.gitignore` carries the comment but no `data/` rule. Currently tracked: **697+ files, ~1.3 GB** — 8 StyleSets PDFs, 66 recordings, 109 transcripts, 511 outputs. The graded PDF footer stamps these *"Subject to Legal Action if Disclosed Without Authorization from AEO."* Commit `122be14` added ~75 more.

Needs a decision on history rewriting, not just a `.gitignore` line.

### 11.2 Smaller items

| Item | Detail |
|---|---|
| `httpx` in `pyproject.toml` | Still under `dev`; must move to runtime (§4) |
| `DEEPGRAM_API_KEY` undocumented | Absent from `.env.example`, `README.md`, `pyproject.toml` |
| 12 pre-existing lint errors | CI (`ruff check .`) is already red on `main`; 5 auto-fixable |
| 3 readings still interpolated | Name and number both lost in transcription |
| `/api/style-sets` needs no key | But shares `SettingsDep`, so it 500s without one |
| `src/api/index.html` | 1319-line vanilla-JS parallel implementation; has no audit sheet, so a fallback user loses the settle workflow entirely |
| `POST /api/transcript-jobs` | Built and reachable, called by nothing |
| `CellEdit.measured` in `types.ts` | Dead, and its doc-comment is wrong — `audit.ACCEPTED` would reject it |
| `README.md` drift | Names `pipeline/measurements.py` (it is `services/`); omits `audit.py`, `style_set/`, `timing.py`, `playback.py`; endpoint table missing 5 routes; test counts stale |

---

## 12. Running it

```powershell
# install
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# .env needs both keys
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...        # playback only; absent = 409, nothing else breaks

# rebuild the UI after any frontend change, then restart the server
cd src\frontend; npm run build; cd ..\..
python src\main.py serve

# checks
.\venv\Scripts\python.exe -m pytest
cd src\frontend; npm test; npm run lint; npm run build
```

The first open of a graded sheet spends ~2 s building the seekable copy, then it is cached. Cues are computed per request, so there is no cue cache to clear after a matcher change — but `.words.json` is cached per recording and survives, since re-encoding does not move the timeline.
