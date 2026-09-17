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

> Superseded by **§21**, which carries the current state of every row below.

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

---

# Session Handout — Scanned Sheets, Snippet Accuracy, and the Audit Screen

**Date:** 16–17 September 2026
**Scope:** stopped `data/` growing in git; declared the missing dependencies; taught the pipeline to read flattened spec sheets; made playback snippets land on the reading they belong to; tightened the audit screen.

Continues the numbering above. Where this contradicts §11, this part is current.

---

## 13. Summary

| # | Work | Outcome |
|---|---|---|
| 1 | `data/` excluded from git | **775** files untracked; 9 left, the StyleSets only |
| 2 | `httpx`, `pillow`, `pydantic` declared | all three were imported but undeclared |
| 3 | OCR for scanned/flattened spec sheets | style 7122 now grades from an image: 92 readings, 92 judged, PASS |
| 4 | Snippet ran into the reading below it | **91/99 → 0/99** overruns on `7122(4)` |
| 5 | Collided snippets demoted | a cue too short to hold a reading is no longer offered as certain |
| 6 | Snippets now open 3 s before the anchor | full run-up on 74/100, zero bleed backwards |
| 7 | Deepgram output written up | `deepgram_transcript_example.md` |
| 8 | LLM snippet mapping measured | **5/5** on the case the heuristic gets wrong |
| 9 | Audit screen tightened | explanation folded behind ⓘ, sidebar −20 %, Stop button |

**Tests:** 323 → **341** Python, **35** frontend (unchanged).

---

## 14. `data/` is no longer tracked — §11.1 partly closed

```
data/*
!data/StyleSets/
```

`data/*` rather than `data/`: **git will not re-include a path whose parent directory is excluded**, so the obvious `data/` + `!data/StyleSets/` silently does nothing. That is the one thing to know if this rule is ever edited.

Then `git rm -r --cached` on everything else. Commit `3c0b0a2` untracks **775** files under `data/` (788 changed in total, 178,903 deletions). Tracked under `data/` now: **9** — the eight StyleSets PDFs plus `style_7122.ocr.json`, which is tracked **on purpose** (see §16).

**Still open:** the ~1.3 GB of recordings, transcripts and graded PDFs remains in *history*. Anyone who clones the repo still gets it. That needs a history rewrite (`git filter-repo`) and a force-push, which is a decision, not a task.

---

## 15. Dependencies — §11.2 first row closed

| Package | Why it had to be declared |
|---|---|
| `httpx` | `services/timing.py` imports it at module level. It does **not** arrive transitively: the OpenAI SDK depends on `httpx2`, a separate distribution, and FastAPI only pulls `httpx` under its `standard` extra. |
| `pillow` | `pypdfium2`'s `.to_pil()` is how a page becomes an image. Without it, scanned sheets cannot be read at all. |
| `pydantic` | `api/app.py` imports `BaseModel` directly. FastAPI does require it, but a direct import is a direct dependency. |

All three are in `[project] dependencies`. `dev` is now `pytest`, `ruff`, `xlwt`.

---

## 16. Scanned and flattened spec sheets

Two of the eight sheets on hand carry no text layer. The parser refused them, and that refusal was right: every measurement on a report is rebuilt as `spec + deviation`, so one misread spec makes every row wrong at once, quietly, in a document that goes to a vendor.

`src/services/style_set/scanned.py` is the last resort, reached only when there is no text to read. It is built to be checked rather than trusted:

| Guard | What it does |
|---|---|
| **Text always beats a scan** | `library.py` does two passes over the candidates — text-only first, scanning only if that finds nothing. A sheet that has *both* is never read by eye. |
| **The sheet checks itself** | A graded sheet is graded: values hold constant or climb across sizes. A row that wanders is a misread digit. `suspect_rows()` reports them; it never corrects them. `0` is treated as blank, not as a drop — reference rows carry a value in the base size only. |
| **Anything read this way is marked** | `StyleSet.from_scan` follows the sheet into the report, so a vendor-facing document never hides where its numbers came from. |
| **The read is cached beside the PDF, and committed** | `<stem>.ocr.json`. Vision output is not deterministic, so two machines re-reading the same scan could grade the same style differently. One cached read is one answer — which is why `style_7122.ocr.json` is tracked. |

Rendering at **3×**: at 2× the fraction strokes close up and `3/8` reads as `9/8`; past 3× the pages get large without reading any better.

Ten header fields are read as well as the table (`style_no`, `description`, `season`, `division`, `company`, `status`, `base_size`, `tolerance_model`, `pom_descr`, `modified_by`). Leaving them out left blank fields on a vendor-facing document.

**Result on style 7122** (no text layer): 92 readings, 92 judged, verdict PASS — the same answer a hand-built one-off produced earlier in the project.

---

## 17. Snippet accuracy

> *"this should be 100% accurate cause missing any of the snippet will cost the company millions"*

Three fixes landed. One known defect is diagnosed but **not** fixed.

### 17.1 The window ran past the next reading

`MIN_WINDOW_SECONDS` (14 s) was applied even when the next reading's anchor was already known — a guess overriding evidence. Readings on these recordings sit a median 7.7 s apart.

On `7122(4)`: **91 of 99 cues ran into the next reading**, 37 ran through the one after that. That is the symptom reported as *"some cells are playing the audio of the measurements below them."*

The floor now applies only to the **last** reading, which has nothing after it to run into. After: **0 of 99**.

### 17.2 Collided readings are demoted, not hidden

Consecutive points of measure share their wording — 7122 has five in a row (ACROSS SHOULDER / FRONT POSITION / FRONT SEAM / BACK POSITION / BACK SEAM), and *"across back seam to seam relaxed"* scores 80 % against *"across front seam to seam relaxed."* Two readings then anchor inside one utterance.

Which of the two is misplaced is not knowable from the index, so it cannot be repaired here. It **can** be refused: a window shorter than `MIN_PLAUSIBLE_SECONDS` (4 s) is not a short reading, it is a collision, and the cue is marked inexact. An operator who plays the wrong reading confirms a deviation against the wrong point of measure and never finds out.

### 17.3 Snippets now start 3 s early

The anchor lands on the first word *matched*, which is rarely the first word *said* — "across shoulder seam to seam" anchors on "shoulder" when "across" came back mangled, and the reading is already under way when the operator hears it.

The run-up is **clamped to half the gap back to the previous anchor**, never taken flat: readings 2 s apart are ordinary here, and a flat 3 s would open inside the previous reading — the same wrong-cell playback arriving from the other side.

`Cue` now carries `anchor` (where the reading was found) separately from `start` (where playback opens). Both the plausibility check and the no-overrun invariant measure the reading, not the run-up; otherwise a lead-in would pad a collided pair out to a plausible-looking 4 s and silence the very warning §17.2 exists to raise.

Measured on cached indexes and real alignments:

| Inspection | Cues | Full 3 s run-up | Min lead | Ends inside next | Opens inside previous |
|---|---|---|---|---|---|
| `7122(4)` | 100 | 74 | 0.92 s | 0 | 0 |
| `rec 2365(4)` | 39 | 34 | 2.21 s | 0 | 0 |

### 17.4 Known defect — the pointer over-advances

After a hit the pointer moves past the **last wanted word in the window**. When two consecutive readings share a word, the second reading's own utterance has already been consumed, and it is skipped entirely. Diagnosed, reproduced, **not fixed** — the fix interacts with the collision guard in §17.2 and wants measuring, not guessing.

---

## 18. LLM snippet mapping — measured, not built

`deepgram_transcript_example.md` (new) shows the raw Deepgram response, the processed `WordIndex`, and a real excerpt, so the shape is on paper before anything is built on it.

The question was whether the model that already reads these transcripts can place the readings better than the word-matching heuristic. Tested on the stretch of `7122(4)` the heuristic gets wrong — 478–516 s, five confusable readings at size M — under a strict schema returning **word indices, never timestamps**, so every answer is checkable against the index:

```json
{"pom": "1.23A", "found": true, "first_word": 822, "last_word": 829, "why": "..."}
```

**5 of 5 correct.** Including `1.23A`, where ACROSS FRONT SEAM TO SEAM was **never spoken** and the model found it by its value alone: *"Name omitted; 'eleven five by eight minus one by eight' gives the 11 5/8 measurement and deviation."* The heuristic placed that one at 499.0 s — a different reading's audio.

**Not built yet.** Before it ships it needs: a full-job measurement rather than one window, index validation in code (in range, monotonic, non-overlapping), per-recording caching so a job is not re-billed, and the existing guards kept as a floor under it. Script and result are in the session scratchpad (`map_test.py`, `map_result.json`).

---

## 19. Audit screen

| Change | Where |
|---|---|
| Sidebar narrowed 300 px → 240 px | `styles.css` `.shell` |
| Header explanation folded behind an ⓘ | `AuditSheet.tsx`, native `<details>` — open, close and the keyboard come free |
| ⓘ carries the shaky count | a sheet with 2 low-confidence readings must not look identical to a clean one when the note is closed |
| New `--z-pop: 15` | the note was tying with the grid's sticky header on `--z-sticky`, so size and tolerance columns read through it |
| Play button says **■ Stop** while playing | the flag comes off the `<audio>` element's own `play`/`pause`/`ended` events — the cue stops itself at the end of a reading, so a hand-set flag would lie |

`src/api/index.html` (the dead parallel UI) was deliberately **not** kept in sync.

---

## 20. Files changed

| File | Change |
|---|---|
| `.gitignore` | `data/*` + `!data/StyleSets/` |
| `pyproject.toml` | `httpx`, `pillow`, `pydantic` to runtime; `dev` trimmed |
| `src/services/style_set/scanned.py` | **new** — vision OCR, self-check, caching |
| `src/services/style_set/spec_sheet.py` | `StyleSet.from_scan`, `scan_warnings`, scan fallback in `read_style_set` |
| `src/services/style_set/library.py` | two-pass lookup so text always beats a scan |
| `src/services/playback.py` | window fix, `MIN_PLAUSIBLE_SECONDS`, `LEAD_SECONDS`, `Cue.anchor` |
| `src/frontend/src/components/AuditSheet.tsx` | ⓘ popover, Stop button |
| `src/frontend/src/styles.css` | sidebar width, header padding, popover, `--z-pop` |
| `tests/test_scanned_sheet.py` | **new** |
| `tests/test_playback.py` | +2 run-up tests; placement assertions re-pointed at `Cue.anchor` |
| `deepgram_transcript_example.md` | **new** |

**Verification:** `pytest` 341 passed; `npm test` 35 passed; `tsc --noEmit` clean; `ruff` unchanged at the 12 pre-existing errors.

---

## 21. Open items — current

| Item | State |
|---|---|
| `data/` in git **history** | **Open, highest priority.** `.gitignore` stopped the growth; ~1.3 GB of proprietary audio and stamped PDFs is still in history and still ships with a clone. Needs a rewrite decision. |
| Pointer over-advance (§17.4) | **Open.** Diagnosed, reproducible, unfixed. |
| LLM snippet mapping (§18) | **Proven on one window, not built.** |
| End-to-end rehearsal | **Never run since playback landed.** Worth doing before the next demo. |
| `httpx` in `pyproject` | **Done** (§15) |
| `data/` gitignored | **Done going forward** (§14) |
| `DEEPGRAM_API_KEY` undocumented | Open — absent from `.env.example` and `README.md` |
| 12 pre-existing lint errors | Open — CI is already red on `main`; 5 auto-fixable |
| `src/api/index.html` | Open — 1319-line parallel UI, now further behind |
| `POST /api/transcript-jobs` | Open — reachable, called by nothing |
| `CellEdit.measured` in `types.ts` | Open — dead field |
| `README.md` drift | Open — and now also missing `scanned.py` |
