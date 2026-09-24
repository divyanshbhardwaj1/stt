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

---

# Session Handout — The Undeclared Dependency, Lint, and Crash-Durable Recording

**Date:** 18–21 September 2026
**Scope:** found and fixed the dependency that made the scanned-sheet path dead on any clean install; cleared the lint backlog CI has been red on since `7d02a8f`; made a recording survive the tab that captured it.

Continues the numbering above. Where this contradicts §21, this part is current.

---

## 22. Summary

| # | Work | Outcome |
|---|---|---|
| 1 | Read the whole codebase | Findings in §28 |
| 2 | `pypdfium2` was never declared | 5 failing tests → **0**; scanned sheets worked only by luck |
| 3 | `ruff check` backlog cleared | **12 → 0** errors, untouched since `7d02a8f` |
| 4 | Recordings written to IndexedDB as they are captured | a killed tab no longer costs the inspection |
| 5 | Recovery in the intake pane | rebuild a stored take, or delete it |
| 6 | Upload is no longer the only copy | the stored take is dropped on 202, not before |
| 7 | A read-modify-write race, caught while building | a recovered take claimed a duration of `0` |

**Tests:** 341 Python (5 were failing, see §23), 35 → **42** frontend.

---

## 23. `pypdfium2` was imported but never declared

`style_set/scanned.py` renders each page of a scanned sheet with `pypdfium2`. It is in neither `pyproject.toml` nor `requirements.txt`, and never has been.

This is the same class of bug as §15, one layer down — and §15 is how it hid. That audit declared **`pillow`** with the note *"`pypdfium2`'s `.to_pil()` is how a page becomes an image"*: the dependency's dependency was declared and the dependency itself was not. `pillow` also arrives for `artwork.py`, so nothing pointed at the gap.

What it cost on any environment that had not happened to install it:

```
read_style_set → no text layer → _read_scan → ScanError:
  "reading a scanned sheet needs pypdfium2: No module named 'pypdfium2'"
```

`find_style_set` catches `SpecSheetError` and moves on to the next candidate, so **every scanned style set was silently unavailable** — the failure a clean `pip install -e ".[dev]"` produces, not a loud one. Two of the eight sheets on hand carry no text layer. §16's whole feature was reachable only on a machine where the package had arrived by accident.

Declared in both files. `pytest` goes from `5 failed, 335 passed, 1 skipped` to **341 passed**; `tests/test_scanned_sheet.py` alone is 12/12.

---

## 24. Lint — `ruff check` is clean, and what remains is the formatter

`ruff check .` had been red at 12 errors since `7d02a8f`, so the `ci` job has been failing on `main` this whole time.

| Rule | Count | Fix |
|---|---|---|
| `I001` unsorted imports | 4 | `--fix` |
| `UP017` `datetime.timezone.utc` | 1 | `--fix` → `datetime.UTC` |
| `E501` line too long | 6 | by hand |
| `B905` `zip()` without `strict=` | 1 | by hand |

Two of the hand fixes were more than reflow:

- **`alignment.py`** — the 118-character parameter type on `align_size` became a named `SpokenRow` alias with a comment naming the tuple's fields. The docstring already described the shape; now the signature does too.
- **`test_playback.py`** — `zip(ordered, ordered[1:])` became `itertools.pairwise(ordered)`. `strict=` is the literal fix the rule asks for and is the wrong one here: the two arguments differ in length by one **by construction**, so `strict=True` fails and `strict=False` only silences the check. It is pairwise iteration, and the stdlib says so in one word.

**`ruff format --check` is still red, and was before this session.** It reported **11** files at `HEAD`; the hand fixes happened to settle `alignment.py` and `timing.py`, so it now reports **9**. This is *not* worth closing with a blanket `ruff format .`: most of the remaining diff is deliberately hand-aligned data — `HEADER_FIELDS` in `scanned.py`, the index tables throughout `test_playback.py`, the row dicts in `test_scanned_sheet.py` — which the formatter would explode to one item per line. The repo already uses `# fmt: skip` for exactly this (`KEYWORDS`, `SPOKEN_DIGITS`, `ONES`), so the fix is extending those markers block by block and then formatting the rest. A judgement call per block, not a command.

---

## 25. A recording now survives the tab that captured it

### 25.1 The premise was wrong, and it matters

The ask was "keep recording when the internet drops". Recording already does that: `MediaRecorder`, `getUserMedia` and the `AnalyserNode` are local, and the only casualty of losing the network is the live monitor's WebRTC session — which `useLiveTranscript.ts` already handles and already says *"the recording is unaffected"*.

The real exposure was never the network:

1. **The upload fails at the end**, and the take existed only in `chunks.current` plus React state.
2. **The tab dying takes the inspection with it** — a crash, or an OOM kill on a backgrounded tablet, against 10–20 MB of webm/opus held in a JS array. `Intake.tsx`'s `beforeunload` guard catches deliberate navigation and nothing else.

Half an hour of a factory floor's time, and unrepeatable: the garments are back on the line. One mechanism fixes both.

### 25.2 IndexedDB, and no dependency

`localStorage` fails three independent ways here: it is **synchronous**, so it would stutter the `requestAnimationFrame` loop `Waveform` runs; it stores **strings**, so a `Blob` would travel as base64 at +33 %; and its **~5 MB cap** is a fraction of one inspection.

Raw IndexedDB, not `idb` or `dexie`. This is "put a blob in a store, read them back in order" — about 200 lines including the comments, against a `package.json` whose runtime dependencies are `react` and `react-dom` and nothing else.

### 25.3 The design

`machine.start(1000)` was **already** emitting a chunk per second into an in-memory array. The whole feature is writing each one as it arrives, in a handler that already existed:

```ts
machine.ondataavailable = (event) => {
  if (!event.data.size) return;
  chunks.current.push(event.data);
  void appendChunk(session.current.id, seq.current++, event.data);
};
```

Not awaited: a slow write must never hold up capture, and a dropped chunk costs one second.

Two stores — `sessions` keyed by id, `chunks` keyed by the compound `["session", "seq"]` so a key range returns one recording's chunks already in order. A session is deleted **only** once the server returns 202, so anything left on load is either a recording whose tab died (`status: "recording"`) or a take that was never uploaded (`status: "ready"`). Both surface in the intake pane with **Recover** and **Delete**.

The backend needed **nothing**. A recovered take is a `File` and rides the identical `POST /api/jobs`.

### 25.4 The gotcha that decides whether any of this works

**MediaRecorder chunks are not independently valid.** Only chunk 0 carries the container header — the WebM EBML header, or the MP4 init segment on Safari — and every later chunk is raw cluster data.

- In order → a playable file. This is what the in-memory path always did.
- Reordered → corrupt.
- **Missing chunk 0 → no header, and nothing will ever open it.**

So the sequence number is not bookkeeping, it is the correctness requirement, and `assembleChunks` refuses a set whose first chunk is absent rather than returning a file that looks fine until someone tries to play it. An interior gap is *not* refused: the audio either side is still worth having, and the intake already tells the operator to play a take back before processing it.

It also means **a crashed recording cannot be resumed into the same file** — a fresh `MediaRecorder` emits a fresh header. The honest scope is "recover everything captured up to the crash, then start a new take", which for this product is still the whole win.

A recovered WebM has no duration and no Cues element, so the browser cannot seek it — but `playable_copy()` already re-encodes to CBR server-side for exactly that reason (§5.2), so recovery needed to solve nothing there.

### 25.5 Two things the build changed

**No `online` auto-retry, though it was in the plan.** The style set is chosen at upload time and a recovered recording carries none, so an automatic upload would quietly fall back to whatever style the recording announces — the wrong sheet, judged silently. Recovery routes back through the ordinary intake instead, where the operator picks the style and presses Process. Less code and more correct.

**A read-modify-write race, found while wiring it.** `onstop` wrote `{ms}` and `Intake.accept` wrote `{liveTranscript}` back to back. Both are read-then-write and both read before either wrote, so the duration was being overwritten with `0` — a recovered take would have claimed it held no audio. Now `accept` makes **one** write carrying both fields, and `finishSession`'s docstring says why it must stay one call.

---

## 26. Files changed

| File | Change |
|---|---|
| `pyproject.toml` | `pypdfium2>=4.30` in `[project] dependencies` |
| `requirements.txt` | the same, beside `pypdf` / `pillow` |
| `src/frontend/src/recordingStore.ts` | **new** — raw IndexedDB, fail-soft, `assembleChunks` |
| `src/frontend/src/hooks/useRecorder.ts` | session per recording; chunk written on arrival; `Take.sessionId`; filename minted at start |
| `src/frontend/src/components/Intake.tsx` | recovery banner, `finishSession`, drop-on-202 |
| `src/frontend/src/styles.css` | `.msg.recover`, on the existing `--open` token |
| `src/frontend/src/recordingStore.test.ts` | **new** — 7 tests |
| `src/services/style_set/alignment.py` | `SpokenRow` alias; ternary reflow |
| `src/services/timing.py` | signature and message reflow |
| `src/api/app.py`, `src/services/audit.py`, `src/pipeline/__init__.py`, `src/services/csv_filler/__init__.py` | import order; `datetime.UTC` |
| `tests/test_playback.py` | `itertools.pairwise`; one reflow |

---

## 27. Verification

```
pytest                341 passed          (was 5 failed, 335 passed, 1 skipped)
ruff check .          All checks passed!  (was 12 errors)
ruff format --check   9 files             (was 11 — pre-existing, see §24)

tsc -b                clean
eslint .              clean
npm test              42 passed           (was 35)
npm run build         clean
```

The 7 new frontend tests cover `assembleChunks` — in-order join, shuffled input re-sorted, **missing chunk 0 refused**, empty set refused, interior gap still rebuilt, Safari's `audio/mp4` not relabelled — plus the fail-soft path.

**The IndexedDB plumbing itself is only exercised implicitly.** jsdom ships no `indexedDB`, which is also what private browsing and blocked site data look like from inside the module, so every existing recorder test now runs the whole absent-storage path; one test asserts directly that those calls resolve rather than throw. What this does **not** cover is a real browser actually writing, surviving a kill, and reading back. See §28.

---

## 28. Open items — current

> Superseded by **§33**, which carries the current state of every row below.

| Item | State |
|---|---|
| **Recording recovery never exercised in a real browser** | **Open, and it gates the feature.** The logic is tested; the round trip — record, kill the tab, reload, Recover, Process — is not. Do this before it is relied on. |
| `data/` in git **history** | **Open, highest priority.** Unchanged since §14: `.gitignore` stopped the growth, ~1.3 GB of proprietary audio and stamped PDFs still ships with a clone. Needs a rewrite decision. |
| Abandoned recordings have no TTL | **Open — a decision.** Client audio now persists on the operator's device until it uploads or is deleted by hand. A sweep dropping anything unuploaded after N days is ~10 lines; N is the question. |
| Browser storage is per-origin | **Open — document it.** A recording saved on `127.0.0.1:8000` is invisible from a LAN address or a tunnel. Worth a line in the README before a tablet moves between them. |
| Pointer over-advance (§17.4) | **Open.** Diagnosed, reproducible, unfixed. |
| LLM snippet mapping (§18) | **Proven on one window, not built.** |
| End-to-end rehearsal | **Never run since playback landed**, and now also since recovery landed. |
| `ruff format --check` | Open — 9 files, pre-existing; wants `# fmt: skip` per block, not a blanket format (§24) |
| `DEEPGRAM_API_KEY` undocumented | Open — absent from `.env.example` and `README.md`; playback is silently off without it |
| `src/api/index.html` | Open — 1319-line parallel UI, and it has no recovery UI at all, so a fallback checkout can still lose a recording |
| `POST /api/transcript-jobs` | Open — reachable, called by nothing |
| `CellEdit.measured` in `types.ts` | Open — dead field |
| `README.md` drift | Open — `pipeline/measurements.py` is `services/`; `scanned.py`, `audit.py`, `playback.py`, `timing.py`, `style_set/` and now `recordingStore.ts` are all absent |
| Crash mid-recording loses the live transcript | Open, low — written once at stop. It is a monitor; no stage of the pipeline reads it |
| No service worker / Background Sync | Open, deferred — the Retry path covers the tab-open case; this is for uploads completing with the tab closed |
| No resumable upload | Open, deferred — `POST /api/jobs` takes one multipart body, so a 20 MB upload on a bad line restarts from zero. Backend work; do it if on-site retries actually fail |
| 12 pre-existing lint errors | **Done** (§24) |
| `pypdfium2` undeclared | **Done** (§23) |

---

# Session Handout — The Clay Prototype, and the First Real Schema

**Date:** 21–23 September 2026
**Scope:** built a full frontend prototype of the product redesigned on the Clay
design system, including a stage/team model the real app does not have yet;
then started making it real — Postgres, Alembic, and jobs that survive a
restart.

Continues the numbering above. Where this contradicts §28, this part is
current.

---

## 29. Summary

| # | Work | Outcome |
|---|---|---|
| 1 | `demo/` — a standalone Clay prototype | 16 screens, no build step, nothing in the real app touched |
| 2 | Stages modelled as **teams** | Size set · PPM · Interim · Final, each with its own workspace |
| 3 | Auth and per-stage RBAC in the prototype | 4 roles, 8 capabilities, enforced across every screen |
| 4 | **Phase 1** of the real implementation | Postgres schema, Alembic, jobs survive a restart |
| 5 | Verified against real Postgres 18.3 | not just SQLite — it caught a test-isolation bug |

**Tests:** 341 → **354** Python. `ruff check src tests migrations` clean.

---

## 30. The prototype — `demo/`

Open `demo/index.html` in a browser. No server, no build, no install. Nothing
in `demo/` is imported by anything outside it, and no file under `src/` was
modified for it.

`demo/clay/` is the Clay design system copied in verbatim (tokens only — its
component primitives are React and this is plain HTML). `demo/app.css` is the
product layer built on those tokens. `demo/README.md` is the full write-up:
what was carried over unchanged, three flagged deviations, and the gaps
inherited from the system itself.

### 30.1 Sign in

| id | password | reaches |
|---|---|---|
| **`admin`** | **`admin123`** | every stage, every feature |
| `d.bhardwaj` | `demo123` | every stage (second administrator) |
| `a.bhatt` | `demo123` | Size set, PPM |
| `s.iqbal` | `demo123` | Size set, Interim, Final |
| `p.grewal` | `demo123` | Size set, PPM, Final |
| `r.menon` | `demo123` | Size set, Interim |
| `k.tanaka` | — | invited only; cannot sign in |

Passwords are checked, so a wrong one fails. The accounts are listed as chips
under the form; clicking one fills both fields.

### 30.2 The screens

| File | |
|---|---|
| `index.html` | Inspections — the register, filterable, rows open a report |
| `report.html?id=` | One inspection, with **Report** and **Stats** tabs |
| `transcript.html?id=` | The transcript, with where the two passes disagreed |
| `audit.html` | The graded sheet — 133 cells, click to correct, playback per reading |
| `record.html` | Recording, live transcript, crash-recovery banner |
| `library.html` | Style sets, PDF-only upload |
| `logs.html` | Activity — one log per stage |
| `teams.html` | Stages, your role on each |
| `members.html` | Admin — add, edit, change role, remove |
| `account.html` | Your id and stages, password change, preferences |
| `dashboard.html` | Size set — role-aware hero, queue and counts |
| `ppm.html` · `interim.html` · `final.html` | The other three stages' workspaces |
| `signin.html` · `processing.html` | |

### 30.3 The model worth arguing with

**A team is a stage, and features belong to the stage.** Switching stage in the
rail switches the whole workspace — nav, screens, and the role under your name.
Opening a size-set screen while standing in Final is not a permission error, it
is the wrong stage, and gets its own panel with a way back.

**Roles are held per stage, not per person.** `s.iqbal` is a QA reviewer on
size set and interim but only an inspector on final. A stage you hold no role
on does not open. Administrators are the exception and hold every stage by a
flag rather than by being listed four times — a list of four goes stale the
first time a fifth stage exists.

**Separation of duties is the load-bearing rule.** An approver cannot edit the
sheet they sign off. If one account could both alter a measurement and release
the document, a wrong reading and its sign-off would leave no trace of
disagreement. Recording, correcting and releasing sit in three different hands.

**Release was removed from Size set entirely** on the last pass: an approver
signs the graded sheet off, and the shipment is released at Final.

### 30.4 Things the prototype gets right that are easy to lose

- Blocked controls stay on the page, dead, with the reason on hover. Only the
  admin nav link disappears. A control that vanishes teaches nobody why.
- Filter tabs are built from the data, so a state nobody is in never gets a tab
  that returns nothing.
- The graded sheet shows confidence on **every** reading, not only the shaky
  ones, and bands cells below 100% in blue with a stronger band below 85%.
  Blue is deliberately **not** a Clay colour — the six brand fills were all
  spoken for and lavender already means "no verdict".
- A zero deviation renders as **OK**, not `0`. It is a pass, and "okay" is the
  word on the tape.
- Every number on the Stats tab reconciles with the report above it: the
  confidence buckets sum to *judged*, the by-size rows sum to *rows*.

---

## 31. Phase 1 — the database

### 31.1 What landed

| File | |
|---|---|
| `src/services/db/models/` | one table per file: `base.py`, `enums.py`, `inspection.py`, `reading.py` |
| `src/services/db/session.py` | engine, session, the optional-database switch |
| `src/services/db/store.py` | `DatabaseJobStore`, measurement conversion, `rebuild_readings` |
| `migrations/` + `alembic.ini` | Alembic; first revision `32907614bd3c` |
| `tests/test_db.py` | 13 tests |
| `tests/conftest.py` | clears `DATABASE_URL` before any test module loads |
| `src/api/jobs.py` | persists at each announced stage, not only at the end |
| `src/api/app.py` | picks the store based on `DATABASE_URL` |

### 31.2 The three decisions

**`inspections.extraction` is the source of truth; `readings` is derived.**
Settle and regrade already work by editing that JSON document and re-rendering
every output from it. `readings` exists so the register and the statistics are
SQL questions rather than several hundred parsed blobs, and it is rebuilt
wholesale — never merged, never edited directly. Two editable copies of the
same truth eventually disagree.

**No floats anywhere.** Every measurement is stored twice: `spec_text` =
`"21 1/2"` for reading back, `spec_sixteenths` = `344` for sorting and
aggregation. Exact both ways, because every value on these sheets is a binary
fraction. A value finer than a sixteenth is rounded **half away from zero** and
logged — Python's `round()` is banker's rounding and would have put a
thirty-second at zero. A test catches this.

**The database is optional, and that is scaffolding.** `DATABASE_URL` unset
keeps the in-memory store, so the pipeline and every existing test still run
without Postgres. `session.py` says when that should stop being true: once
members and the audit trail live there too, there is nothing useful to do
without it and it should become a hard failure at startup.

### 31.3 Verified against real Postgres

Local PostgreSQL **18.3**, database `triburg`, port 5432. `DATABASE_URL` lives
in `.env`; Alembic reads that file itself, so the password never goes into a
shell command or a terminal history.

| Check | Result |
|---|---|
| `alembic upgrade head` | applied, transactional DDL |
| Column types | `jsonb` ×4, `timestamp with time zone` ×3 |
| Indexes | 3 on `inspections`, 3 on `readings` including the unique cell |
| Foreign key | `ON DELETE CASCADE`, enforced by the server |
| `downgrade base` → `upgrade head` | clean both ways |
| `alembic check` | *No new upgrade operations detected* |
| Restart survival | finished job intact; interrupted job returns **failed** |
| Measurements | `21 1/2` + `-1/8` = `21 3/8`; `344 + -2 = 342` |
| JSONB queryable | `extraction->>'style_no'` works |

**An interrupted job comes back as failed, not running**, and is written back
that way so the next restart cannot resurrect it. An operator watching a
progress line that will never move is worse than being told to re-run.

### 31.4 The bug the Postgres run flushed out

`tests/test_api.py` imports `api.app`, and `api.app` now opens a job store at
import. With `DATABASE_URL` in `.env`, **the test suite was connecting to the
real `triburg` database.** Nothing wrote to it, but it was one `store.create()`
away from doing so. Fixed in `tests/conftest.py`, which clears the variable
before any test module is imported. Tests that want a database build their own
per test in `tmp_path`.

This is the whole argument for running a migration against the real server
early: SQLite would never have shown it.

---

## 32. The road to a functional product

Phases 1, 2 and 4 are done (§31, §35, §36). The rest, in the order I would build it:

| Phase | What | Why there |
|---|---|---|
| 2 | S3 for recordings and outputs, presigned range playback | **Done — §35** |
| 3 | Queue + worker, idempotency by content hash | **Deferred — §36.7.** Nothing loses jobs at one operator |
| 4 | Accounts, sessions, RBAC on every endpoint | **Done — §36** |
| 5 | Audit log, and the members screen | Memberships landed with §36; who-did-what did not |
| 6 | Style set library in the database, upload flow | Removes the last local-disk dependency |
| 7 | PPM / Interim / Final pipelines | Genuinely new products |

Notes carried forward for phase 2:

- **Keep `playable_copy`.** VBR MP3 with no Xing header seeks wrong by 3×
  (§5.2). S3 does not fix it — re-encode once on upload and store both objects.
- **Presign GETs.** Presigned URLs support `Range` natively, so playback
  snippets work without proxying audio through FastAPI. Short TTL.
- **SSE-KMS, public access blocked, versioning on.** These documents carry
  *"Subject to Legal Action if Disclosed Without Authorization from AEO."*
- The capability names in `demo/auth.js` are the ones to port verbatim in
  phase 4: `record`, `audit.view`, `audit.edit`, `download.working`,
  `download.vendor`, `release`, `manage.styles`, `manage.people`.

---

## 33. Open items — current

> Phase 2 added its own in **§35.6** (bucket versioning above all), phase 4 in **§36.8**
> (no sign-in rate limit above all).

| Item | State |
|---|---|
| **A live OpenAI API key was pasted into a session transcript** | **Open, urgent.** Rotate it at platform.openai.com and move secrets to Secrets Manager or SSM. |
| `data/` in git **history** | **Open, still.** ~1.3 GB of proprietary audio and stamped PDFs; every clone gets it. `.gitignore` stopped the growth in September. Needs a rewrite decision and it gets harder every commit. |
| Recording recovery never exercised in a real browser | **Open, and it gates the feature** (§28). Record, kill the tab, reload, Recover, Process. |
| Pointer over-advance (§17.4) | **Open.** Diagnosed, reproducible, unfixed. |
| LLM snippet mapping (§18) | **Proven on one window, not built.** |
| No backfill of `data/` into the new tables | **Open by design.** ~500 existing outputs stay on disk; reading them in has to settle what to do with inspections whose style set has since changed. Its own migration, its own decision. |
| End-to-end rehearsal | **Never run** since playback, recovery or the database landed. |
| `ruff format --check` | Open — 9 files, pre-existing; wants `# fmt: skip` per block, not a blanket format (§24) |
| `DEEPGRAM_API_KEY` undocumented | Open — absent from `README.md` |
| `src/api/index.html` | Open — 1319-line parallel UI, now far behind |
| `POST /api/transcript-jobs` | Open — reachable, called by nothing |
| `README.md` drift | Open — and now also missing `services/db/`, `migrations/`, `services/storage.py` and `demo/` |
| `pypdfium2` undeclared · 12 lint errors | **Done** (§23, §24) |

---

## 34. Running it

```powershell
# install
.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\venv\Scripts\python.exe -m pip install "psycopg[binary]"   # only with Postgres

# .env
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...          # playback only; absent = 409, nothing else breaks
DATABASE_URL=postgresql+psycopg://postgres:PASS@localhost:5432/triburg
#   unset      -> jobs kept in memory, lost on restart (the old behaviour)
#   sqlite:/// -> fine for a local run
S3_BUCKET=...                 # unset = disk only, one server (the old behaviour)
S3_ENDPOINT_URL=...           # Railway, MinIO, R2; omit for AWS
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

# schema
.\venv\Scripts\python.exe -m alembic upgrade head

# the first administrator, before anyone can sign in
python src\main.py user add <email> --name "Their Name" --admin

# the app
cd src\frontend; npm run build; cd ..\..
python src\main.py serve

# checks
.\venv\Scripts\python.exe -m pytest                     # 420
.\venv\Scripts\python.exe -m ruff check src tests migrations
.\venv\Scripts\python.exe -m alembic check              # models vs schema
.\venv\Scripts\python.exe src\services\storage.py      # round-trips the real bucket
cd src\frontend; npm test; npm run lint; npm run build  # 57

# the prototype — no build, no server
start demo\index.html
```

Alembic reads `.env`, so `alembic upgrade head` needs no arguments and the
connection string stays out of the shell history. `storage.py` reads it the
same way, for the same reason.

---

## 35. Phase 2 — the bucket

**Date:** 23 September 2026. Continues §31. Where this contradicts §32 or §34,
this is current.

Recordings and finished reports now live in object storage. Before this, a
report existed on exactly one filesystem: one server, no redeploy that replaces
a container, and one disk failure away from losing documents the client cannot
reproduce.

### 35.1 What landed

| File | |
|---|---|
| `src/services/storage.py` | the whole of it — keys, upload, fetch, signed links, the round-trip check |
| `src/api/jobs.py` | `_archive_recording` before the pipeline, `_archive_outputs` from `apply_result` |
| `src/api/app.py` | `_local_recording`, `_seekable`, signed redirects on `/audio` and `/download` |
| `tests/test_storage.py` | 20 tests against a stub bucket |
| `tests/conftest.py` | clears the bucket variables, and now holds the shared web fixtures |
| `.env.example` · `pyproject.toml` · `requirements.txt` | `boto3>=1.34`, and the five settings |

**Tests:** 354 → **374**. `ruff check src tests migrations` clean.

### 35.2 The shape of it

**Local disk is the working copy; the bucket is the durable one.** ffmpeg wants
a file, pypdf wants a file, and rewriting eight pipeline stages to stream from
a bucket would have bought nothing but a longer diff. So everything is still
written to disk, mirrored up after, and pulled back down on a machine that does
not have it. `ensure_local` is the whole multi-server story: a container that
has never seen an inspection answers for it anyway, once.

**Signed links, not proxied bytes.** `/audio` and `/download/{kind}` now answer
307 to a presigned URL and S3 serves the file. A half-hour recording is tens of
megabytes and an operator working through a sheet seeks it dozens of times;
there is no reason for an app worker to sit in the middle of that. Both call
sites in the frontend are plain URLs — `<audio src>` and an anchor — so no CORS
is involved. With no bucket configured both fall back to `FileResponse` exactly
as before.

**A mirror failure is not a run failure.** The report is on disk the moment it
is written. Losing the copy costs durability, not work, and a transcription
that took eight minutes must not be discarded because a bucket blipped.
Fetching is the other way round: a file that is not here and cannot be pulled
is a real error and the caller hears about it. Same argument as `_persist` in
§31.

**The recording goes up before transcription, not after.** Eight minutes is a
long time to be holding the only copy of the one artefact that cannot be
produced again. Its SHA-256 goes with it, which finally feeds the
`content_sha256` column and index that §31 built and nothing used — phase 3
recognises a re-upload by it instead of transcribing it again at full price.

**Outputs are archived from `apply_result`, not from the end of a run.**
Settling a cell and regrading a size both rewrite those same files. A bucket
left holding the version from before a correction is worse than one holding
nothing: it is a document someone could be served that a person has already
ruled wrong. One hook, three callers, no way to add a fourth that forgets.

### 35.3 Keys

```
recordings/<filename>          as captured on the floor
playback/<stem>.mp3            the seekable re-encode — a second object, not a replacement
outputs/<name>/<filename>      one folder per inspection, so a report expires as a unit
```

The playable copy is still built on first ask (§5.2, and it is still needed —
S3 does not fix a VBR MP3 with no Xing header), but now it is built once
*anywhere*: the second machine asked fetches the re-encode instead of running
ffmpeg again.

### 35.4 Two bugs the tests caught

**`mimetypes` reads the Windows registry.** `.csv` came back
`application/vnd.ms-excel` and `.webm` came back `video/webm`. An object is
stamped with its content type once, at upload, and served that way for its
life — so the same report would have arrived as a spreadsheet or as text
depending on which machine happened to process it. Content types are now a
stated table, and `mimetypes` is only the fallback for something unrecognised.

**The test suite could have written to the client's bucket.** Exactly the
`DATABASE_URL` bug of §31.4, one layer up: `tests/conftest.py` now clears the
bucket variables too, before any test module is imported.

### 35.5 Verified against the real bucket

Railway object storage, backed by Tigris — `t3.storageapi.dev`, path-style
addressing. 19 checks in round one, 17 in round two.

| Check | Result |
|---|---|
| put · head · get · presign · delete | all ok |
| Content type survives the round trip | `audio/mpeg`, `application/pdf` |
| **Unsigned GET** | **403 Forbidden** — the behaviour, not a config flag |
| Signed GET | 200, bytes identical to what went up |
| **Range request** | **206, `bytes 1000-1099/5000`, correct slice** |
| Altered signature · expired link | 403, 403 |
| `Content-Disposition` | `inline` for playback, `attachment` with the filename for downloads |
| An overwrite replaces the object | corrected report served, not the old one |
| **Multipart upload, 24 MB** | 12.6s — this is the seam most S3-compatible endpoints fail |
| Range across a part boundary | 206, exact bytes at offset 17 MB |
| Fetch back | 2.8s, byte-identical, no `.part` left behind |
| `_archive_recording` / `_archive_outputs` | run against real boto3, not the stub |
| `ensure_local` on a machine without the file | pulled it |
| Bucket after clean-up | 0 objects |

`python src/services/storage.py` runs the first of these on demand. It is the
only check that can catch a wrong region, the wrong addressing style, or a
read-only key — all three pass every mock.

### 35.6 Left open

**Versioning is not enabled on the bucket.** It reads back as `not enabled`,
and it matters here more than usual: settle and regrade overwrite an object in
place, so without versioning a bad correction has no previous copy to go back
to. Enabling it is a deliberate act — it can afterwards be suspended but never
removed, and every retained version is billed — so it is the operator's call,
not a thing the code should do on its own.

`get_public_access_block` returns `{}` on Tigris rather than AWS's structure,
so that flag cannot be read the AWS way. The unsigned 403 above is the stronger
answer regardless: it is the behaviour rather than the setting.

**Encryption at rest** is whatever Railway's default is; not confirmed. These
documents carry *"Subject to Legal Action if Disclosed Without Authorization
from AEO."*

**Nothing has been backfilled.** The ~500 existing outputs under `data/` are
still only on disk, which is the same decision as §33 and for the same reason.

**No lifecycle rule.** Recordings are kept forever today. Nothing decides when
an inspection's audio stops being worth storing.

---

## 36. Phase 4 — accounts, sessions and permissions

> **Partly superseded by §38.** Accounts are `users`, keyed by uuid and
> signed in by email. The argument below for keying on the login name is
> the one §38.1 reverses, and the reasoning there is the record.

**Date:** 23 September 2026. Continues §35. Phase 3 was skipped deliberately —
see §36.7.

Until now every endpoint was open. Anyone who could reach the port could
upload an inspection, settle a reading, or download a vendor document stamped
*"Subject to Legal Action if Disclosed Without Authorization from AEO."* The
prototype's permission model was real design work that only ever ran in a
browser; it is now enforced on the server, where access control has to live.

### 36.1 What landed

| File | |
|---|---|
| `src/services/auth.py` | the rules: hashing, the capability matrix, sessions, the roster |
| `src/api/security.py` | the FastAPI end: cookie in, account out, 401 or 403 |
| `src/services/db/models/account.py` · `membership.py` · `session.py` | three tables, one file each |
| `src/services/db/models/enums.py` | `Role`, `AccountState` |
| `migrations/versions/…f30dfefbe725…` | the schema |
| `src/main.py` | `account add` · `list` · `password` · `disable` |
| `src/api/app.py` | every endpoint gated; sign in, sign out, `/api/me`, the roster |
| `src/frontend/src/session.ts` · `SessionProvider.tsx` · `components/SignIn.tsx` | the browser end |
| `tests/test_auth.py` | 38 tests |

**Tests:** 374 → **413** Python, 42 → **44** frontend. `ruff` and `eslint`
clean. `alembic check` clean.

### 36.2 The model

**A role is a role *in* a stage.** The same person is routinely a reviewer on
size set and an approver on final. One global role per person is what makes a
factory keep two logins for somebody, and two logins is how an audit trail
stops being able to answer who did what. So `memberships` is its own table,
one row per person per stage, unique on the pair.

**An administrator is a flag, not four rows.** They hold every stage,
including ones that do not exist yet. Four rows go stale the first time a fifth
stage is added, and a floor with an administrator who cannot see a stage is a
floor with a stage nobody can fix.

**The separation of duties is the load-bearing rule**, and it is the one worth
re-reading:

| | record | audit.view | audit.edit | download.working | download.vendor | release | manage.styles | manage.people |
|---|---|---|---|---|---|---|---|---|
| Inspector | ● | ● | | | | | | |
| QA reviewer | ● | ● | ● | ● | | | | |
| Approver | | ● | | ● | ● | ● | | |
| Administrator | ● | ● | ● | ● | ● | ● | ● | ● |

An approver has no `audit.edit`. That is not an omission. If one account could
alter a measurement *and* sign the document off, a wrong reading and its
approval would leave no trace of disagreement anywhere. A test asserts it in
both directions, and a second test reads the capability names back out of
`demo/auth.js` and fails if the two ever drift.

### 36.3 The security decisions

**Passwords: `hashlib.scrypt`, no new dependency.** Salted per account,
~16 MB of memory per hash, compared with `hmac.compare_digest`. The parameters
travel inside the stored string, so raising them later does not strand every
existing account. A hash in any other format is refused rather than checked
leniently.

**Sessions: opaque tokens in a table, and only their hashes.** Not signed
tokens carrying claims — the whole reason is revocation. An administrator
disabling somebody at 14:00 means they are out at 14:00, not whenever the token
they are holding runs out. That was proved against a running server: the
session died mid-flight. Only `sha256(token)` is stored, so a database dump, or
a backup on somebody's laptop, cannot be replayed as a session.

**One message for every sign-in failure.** Unknown id and wrong password
return the same 401 with the same wording, because the ids here are people's
names and an anonymous caller must not be able to learn which of your
colleagues have accounts. That includes the clock: an unknown id is checked
against a cached hash of a random string, so both paths cost exactly one scrypt
verification. A test counts the calls rather than timing them.

**The cookie is httpOnly, SameSite=Lax, and `Secure` only over https.**
httpOnly is the difference between an XSS bug that defaces a page and one that
walks off with a session. Lax is CSRF protection without a token round trip.
Following the scheme means a local http run works and a TLS deployment does not
send the session in the clear — a hardcoded `True` breaks localhost, and a
hardcoded `False` is a deployment nobody notices.

**Narrowing somebody's access ends their sessions now.** Changing a role,
resetting a password, or disabling an account signs that person out
everywhere. A permission change that waits for a token to expire has not
actually taken anything away.

### 36.4 The database is no longer optional

`services/db/session.py` said this would eventually be right, and phase 4 is
when it became true: **the web app now refuses to start without
`DATABASE_URL`.** Accounts, sessions and permissions live there, and an app
that cannot authenticate anybody must not fall back to serving everybody.

The CLI pipeline is untouched — `python src/main.py run` needs no database and
never did.

### 36.5 Bootstrapping

Nothing is seeded. A default account with a known password shipped in a
migration is a door that stays open on every deployment that forgets to close
it. The first administrator is made by hand:

```powershell
python src\main.py account add <id> --name "Their Name" --admin
python src\main.py account add r.menon --name "R. Menon" --role sizeset:inspector --invite
python src\main.py account password r.menon
python src\main.py account list
python src\main.py account disable <id>
```

The password is prompted for, never an argument: an argument lands in the shell
history, in `ps` output for every other user on the box, and in any recording
of the terminal. `--invite` creates an account that holds roles and cannot sign
in until somebody sets a password on it.

### 36.6 Verified against a running server

The suite uses `TestClient`, which never crosses a socket. These ran against
uvicorn with a real cookie jar:

| Check | Result |
|---|---|
| `/api/me`, `/api/jobs`, `/api/members`, `/api/realtime-token` anonymous | 401 ×4 |
| The app shell | 200 — it has to load to draw the sign-in screen |
| Wrong password vs unknown id | same 401, same wording |
| Cookie | httpOnly ✓, SameSite=Lax ✓, not `Secure` over http ✓ |
| Inspector: list inspections / reach the roster / settle a sheet | 200 / 403 / 403 |
| **Approver settling a sheet** | **403**, with the reason |
| **Disabling somebody mid-session** | **401 on their very next request** |
| Adding a member, protecting the last administrator | 201 / 409 |
| Sign out | 200, and the cookie is dead |

A separate test walks the app's own routing table and asserts every `/api`
route refuses an anonymous caller. Listed by hand it would not grow when
somebody adds an endpoint in a hurry — and the endpoint added in a hurry is the
one that ships unprotected.

### 36.7 Why phase 3 was skipped

A queue and a worker buy jobs surviving a deploy, and more than one worker.
Neither shows up in a size-set demo with one operator at a time, `BackgroundTasks`
already runs on Starlette's threadpool, and §31 made an interrupted job come
back as **failed** with a message rather than stuck at 40% forever. Phase 3
moves to whenever there is more than one person uploading, or a deploy cadence
that interrupts jobs.

The cheap half of it is still worth taking early: dedupe by `content_sha256`,
so re-uploading the same recording is recognised rather than transcribed again
at full price. ~20 lines, and the column and its index already exist. One
wrinkle: the hash is computed inside `_archive_recording`, so today it only
lands when a bucket is configured.

### 36.8 Left open

| Item | State |
|---|---|
| ~~No members screen in the real app~~ | **Done — §37.** The roster has a screen now. |
| Password rules are length only | Eight characters, no dictionary check, no breach list, no rate limit on sign-in attempts. **A rate limit is the gap that matters** — scrypt makes each guess expensive, but nothing stops a caller trying all night. |
| No audit trail | Who settled which cell is still not recorded. That is phase 5, and it is the reason accounts are keyed by login name rather than a surrogate id. |
| Sessions are absolute, not sliding | Twelve hours from sign-in. Long enough for a shift; somebody signed in at the start of a double will be asked again. |
| `manage.styles` and `release` are enforced but unused | Nothing calls them yet — the style set library and release flow are phases 6 and 5. They are in the matrix so the roles are complete rather than growing later. |
| The stage is assumed | Every inspection is size set, so a permission question that needs a stage asks about that one (`auth.DEFAULT_STAGE`). Phase 7 gives jobs their own stage and that constant goes. |
| Three accounts exist in `triburg` | `triburg.admin`, `r.menon`, `p.grewal`, all **invited** — they hold roles and cannot sign in until `account password <id>` is run. Remove any you do not want with `DELETE /api/members/<id>`. |
| The suite is slower | 47s → 86s. scrypt is memory-hard on purpose, and every test that signs in pays for it. Worth it; noted so nobody goes looking for a regression. |

---

## 37. The real app, on Clay

> **Superseded by §38.** This describes a Clay-flavoured interpretation of
> the prototype, written before `demo/app.css` was used directly. It is
> kept for the design reasoning, not as a description of the code.

**Date:** 23 September 2026. Continues §36.

The prototype in `demo/` was a design argument. This is the app taking it —
the same design language, the same rail, the same screens, but only the ones
with a real endpoint behind them.

**Tests:** 44 → **56** frontend, 413 Python unchanged. `eslint`, `tsc` and the
build all clean.

### 37.1 What the app looks like now

| | |
|---|---|
| `src/frontend/src/styles.css` | rethemed on Clay's tokens, values inlined from `demo/clay/tokens/` |
| `src/frontend/src/router.ts` | hash routing, hand-rolled |
| `components/Rail.tsx` | the nav rail — cream, collapsible, account at the foot |
| `components/Inspections.tsx` | the register |
| `components/Members.tsx` | the roster: add, re-role, disable, remove |
| `components/Account.tsx` | who you are, what you may do, change your password |
| `components/StyleSets.tsx` | the library, read-only |
| `components/Stages.tsx` | the four stages and your role on each |
| `screens.test.tsx` | every screen, two roles |
| `components/Sidebar.tsx` | **gone** — the rail replaced it |

### 37.2 What Clay got, and the one thing it did not

Carried over: the cream canvas (#fffaf0) on **every** surface including the
rail, the near-black CTA, 12px radius, 1px hairlines instead of shadows, pill
badges and pill tabs, Inter 500 with negative tracking for display type and
Inter 400/600 for body.

The rail used to be ink. Clay has no dark chrome anywhere in the system and a
dark rail is the commonest way a product breaks it, so it is cream now. One
dark surface survives — **the running recorder** — for two reasons that are not
cosmetic: a waveform needs a ground dark enough to be legible, and a recording
in progress has to be unmistakable from across a room. It is built from Clay's
own published dark-surface tokens rather than a palette invented beside them.

**The four state hues did not change, and will not.** Fail orange, no-verdict
violet, low-confidence blue and pass green are keyed to `graded_report.py`,
which prints those same four states into the PDF. Screen and paper have to say
the same thing in the same colour or a reviewer relearns the language halfway
through the job. The prototype flagged this as its own third deviation —
semantic colour doing real work in the grid — and it is the one place the
system yields to the document.

Two smaller deviations, both the prototype's and both kept: section rhythm is
40px rather than Clay's 96px, because at 96px an inspection report is four
screens of scrolling to answer *did it pass?*; and there is one scrim and one
soft shadow, for the member dialog, because a dialog over a data table has to
detach from it or the table reads as still-editable behind it.

The tokens are **inlined**, not `@import`ed from `demo/clay/`. The prototype is
a separate artefact that can be deleted, and a build that breaks when it is
would be a poor trade for four files of custom properties. Each token carries
its Clay name in a comment so the two can be diffed by eye.

### 37.3 Screens, and what is deliberately absent

The prototype has sixteen screens. Seven are here, because seven have a server
behind them:

| Prototype | Here | |
|---|---|---|
| `signin.html` | Sign in | Clay card on the cream canvas |
| `index.html` | Inspections | filter tabs built from the data |
| `record.html` · `processing.html` | Record | the existing recorder, its own screen now |
| `report.html` (Report tab) | Inspection → Report | |
| `audit.html` | Inspection → Graded sheet | a tab, not a separate screen |
| `library.html` | Style sets | **read-only** |
| `members.html` | Members | full CRUD |
| `account.html` | Account | plus the capability list |
| `teams.html` | Stages | your role on each of the four |

Absent, and each for a reason rather than an oversight:

- **Dashboard** — no statistics endpoint. Everything on the prototype's version
  was invented.
- **Activity log** — there is no audit trail yet. That is phase 5, and inventing
  one in the browser would be worse than not having it.
- **Transcript screen** — no endpoint serves a transcript.
- **The Stats tab** — it wanted who, where and how long, and the server records
  none of those.
- **PPM / Interim / Final workspaces** — one pipeline exists. The Stages screen
  lists all four and says plainly which are not built, because the roles are
  already real: an account can hold approver on final today.
- **Style set upload** — `GET /api/style-sets` lists the library and nothing
  adds to it; sheets are read from `data/StyleSets/` on disk. The screen says
  so rather than offering a button that would 404. `manage.styles` is enforced
  and has nothing to guard yet — that is phase 6.

### 37.4 Routing

Hash routes, hand-rolled, about sixty lines. react-router is 20 kB to answer a
question this app asks eight times, and hashes mean the server needs no
catch-all route: it serves one shell at `/` and nothing else has to know the
screen names.

An unknown hash lands on the register rather than a blank pane — somebody
arriving from a stale bookmark should see the list, not nothing.

### 37.5 Permissions, in the browser this time

The rail hides the **Members** link from anyone without `manage.people`. That
is the one control that disappears; everywhere else a blocked control stays on
the page and goes dead with its reason, because a control that vanishes
teaches nobody why — but an empty admin screen teaches nothing either.

Worked through:

- the **Save** button on the graded sheet stays visible for an approver and is
  disabled, with the separation-of-duties sentence on it;
- the **downloads** row filters by document: working files need
  `download.working`, the vendor PDFs need `download.vendor`, and an account
  with neither is told the report is ready and that releasing it is an
  approver's job;
- the **Graded sheet** tab is dead rather than absent when an inspection was
  never checked against a spec sheet.

None of this is security. Every one of these is checked again on the way into
the endpoint — §36 — and the browser's copy only decides what to draw.

### 37.6 Verified

56 frontend tests, including a sweep of every screen as an administrator and as
an inspector. What that sweep catches is the class of failure that is invisible
until somebody clicks: a screen that throws on an empty list, a capability read
off an account that does not hold it, a route that renders nothing.

Then the built bundle, through a real uvicorn:

| Check | Result |
|---|---|
| Shell served, built React app | 200, `/assets/index-*.js` |
| Bundle · stylesheet | 260 kB · 33 kB |
| Cream canvas · near-black primary | `#fffaf0` · `#0a0a0a` |
| Radii | `--r-panel: 12px`, `--r-chip: 9999px`, `--r-card: 16px` |
| Inter loaded | ✓ |
| No dark rail | ✓ |
| Rail collapses | `.shell.tight` present |
| The four document hues | all four still there |
| Admin: `/api/jobs` · `/api/style-sets` · `/api/members` | 200 · 200 · 200 |
| Inspector: `/api/members` | **403**, and the rail does not offer it |

### 37.7 Left open

| Item | State |
|---|---|
| **Nobody has looked at it** | The strongest check here is a jsdom sweep, which cannot tell you the rail is the wrong cream or that a table is cramped. It needs eyes on a real browser before anyone else sees it. |
| Inter is loaded from Google | With a full system fallback, so a floor tablet with no route out looks ordinary rather than broken. Self-hosting the font is the fix if that matters. |
| The dark theme is inferred | Built from Clay's two published dark-surface tokens, because the system specifies no dark theme at all. It is a reasonable reading, not a documented one. |
| `src/api/index.html` | Still there, still the legacy single-file UI, now further behind than ever. It is what a checkout that has never run `npm run build` still serves. |
| No members screen equivalent for stages | Stages is read-only. Assigning somebody to a stage is done on the Members screen, which is right, but the Stages screen looks editable and is not. |

---

## 38. Users, and the prototype as the product

**Date:** 23 September 2026. Continues §37, and **supersedes it** — §37 described
a Clay-flavoured interpretation of the prototype. This replaces it with the
prototype itself.

**Tests:** 419 Python, 44 → **57** frontend. `ruff`, `eslint`, `tsc` and
`alembic check` clean.

### 38.1 Accounts became users, keyed by uuid, signed in by email

`accounts` → **`users`** throughout: table, model, API (`/api/users`), CLI
(`user add`), UI, and the variable names. Mixed vocabulary for one entity is
what bites six months later.

**The primary key is a uuid and the credential is an email, and those are two
separate facts.** §36 argued the opposite — that the login name should be the
key because the audit trail records it. That was backwards, and it is worth
writing down why:

> A credential is exactly the thing that changes. People marry, a domain gets
> bought, somebody is entered wrong on their first day. A key that changes has
> to be chased through every row that points at it; a surrogate key never
> changes, so the audit trail keeps pointing at the same person no matter what
> they are called this year. The name to print is looked up, not stored in the
> pointer.

There is a test for exactly that: correct somebody's address through
`PATCH /api/users/{id}` and their id does not move.

Emails are stored lower case and uniquely indexed — `S.Iqbal@…` and `s.iqbal@…`
as two rows is a split audit trail nobody notices for months. The pattern is
deliberately permissive (`[^@\s]+@[^@\s]+\.[^@\s]{2,}`): a strict email regex is
a famous way to reject somebody's real address, and the only check that proves
an address works is sending to it.

The phase-4 migration was **rewritten in place** rather than followed by a
rename migration. It was untracked, never committed, and had only ever been
applied to one development database. A rename migration for a schema that never
shipped is archaeology nobody will thank us for. Current head:
`b08425f66127`.

Verified against the running server: capitalised sign-in works, wrong password
and unknown address return the identical 401, an address correction keeps the
id, a duplicate address is refused with 400, and a malformed uuid in the URL is
404 rather than 500.

### 38.2 `api/app.py` now reads `.env` itself

`uvicorn api.app:app` failed at startup with "DATABASE_URL is not set" while
`python src/main.py serve` worked. The CLI happened to call `Settings.load()`
first, which loads `.env` into the process, and uvicorn inherited it — so the
app depended on an implicit side effect of one of its two entry points.

`app.py` now calls `load_env_file()` at import, the same way `migrations/env.py`
already did. A module that needs configuration should fetch it rather than hope.
Safe everywhere: `load_env_file` uses `setdefault`, so a real environment
variable always wins, and it is why the test-isolation guard still holds —
`conftest.py` blanks `DATABASE_URL` to `""` rather than deleting it, precisely
so `setdefault` cannot put the live one back.

### 38.3 The prototype is the product now

`demo/app.css` and `demo/clay/` are **copied whole** into
`src/frontend/src/ui/`. Not a reinterpretation, not a retheme — the files. Every
screen below is the prototype's markup, its class names and its copy, wired to
real endpoints:

| Prototype | Component |
|---|---|
| `app.js` `rail()` | `Rail.tsx` — stage tile, stage switcher, that stage's nav, hairline, Members / account / Log out |
| `teams.js` | `stages.ts` — four stages, each with nav, tag, fill, blurb |
| `signin.html` | `SignIn.tsx` — `.topbar`, `.auth-split`, the AEO confidentiality panel |
| `dashboard.html` | `Dashboard.tsx` — hero verdict, `.readout`, needs-attention, recent |
| `index.html` | `Inspections.tsx` — eight columns, state pills, tabs built from the data |
| `record.html` | `Intake.tsx` — the teal `.recorder`, `.recdot`, `.clock`, `.wave`, `.transcript` |
| `report.html` | `JobDetail.tsx` + `Stats.tsx` — both panels |
| `audit.html` | `AuditSheet.tsx` — `.audit-head/scroll/foot`, `.grid`, `.gridkey`, the cell dialog |
| `library.html` | `StyleSets.tsx` |
| `teams.html` | `Stages.tsx` — `.stageflow` with arrows, `.teamcard` grid |
| `members.html` | `Users.tsx` — `.teamchips`, the `.scrim`/`.dialog` editor |
| `account.html` | `Account.tsx` — `.kv`, stages table, password form |
| `logs.html` | `Activity.tsx` |

Nav icons are the prototype's SVG paths, copied rather than redrawn. The rail's
open/closed state is on `<html data-rail>` set before first paint, exactly as
every prototype page does it — otherwise the rail flashes open and snaps shut.

`ui/extra.css` is the only stylesheet of our own, and it holds three kinds of
thing: components the prototype never modelled (the live transcription monitor,
playing a reading back, the settle dialog), a handful of aliases so carried-over
rules keep working, and the grid deviations in §38.5. If `app.css` styles it, it
does not belong there — a second opinion about `.btn` is how two design systems
start.

### 38.4 What is deliberately not the prototype

- **No account list on the sign-in screen.** The prototype lists every id and
  password as clickable chips. Shipping that enumerates who has an account,
  which is the precise thing `auth.sign_in` goes to trouble to hide. There is a
  test asserting no address appears on that screen.
- **Activity says it is empty.** The prototype's log is invented events. There
  is no audit trail yet, and a fabricated audit log is worse than an honest
  empty one, because that screen is what people reach for when they need to
  know what actually happened.
- **No Sign it off button.** `release` is enforced and has no endpoint behind it.
- **Four provenance facts on the Stats tab** — who took it, which bench, the
  season, the transcript — say they are not recorded rather than showing a
  plausible name.
- **"Written to device" is gone from the recorder.** The prototype shows `462`;
  the recorder exposes no chunk count, and a made-up number on a reliability
  stat is worse than one fewer stat.

### 38.5 The graded sheet, after looking at it

Three things only visible on a real sheet:

**The colours were missing entirely.** The component emitted `uncertain`,
`shaky` and `mark-glyph`; `app.css` styles `conf-mid`, `conf-low` and `.mark`.
Nothing matched, so the confidence washes and **every state glyph** rendered
uncoloured. Renamed in the component.

**One blue, not two.** The prototype grades confidence in two bands, 10% under
100% and 20% under 85%. On a real sheet that is a distinction without a
difference: 99% and 68% both mean *the model was not certain, listen before you
release it*, and the reviewer's next action is identical. Two shades invited
somebody to treat the paler one as good enough, which is the one reading that
gets a wrong number onto a vendor document. One fill now, at .36.

**One weight for all three states.** `app.css` fills out-of-tolerance at 7% and
no-verdict at 22% against the confidence blue's 36%, so the eye ranked cells by
strength rather than by hue — and the faintest was the most serious. All three
now carry the same weight, with lavender at **.62** because a pale hue needs
more of itself to read as loudly. The three fills are tokens
(`--cell-uncertain`, `--cell-fail`, `--cell-open`) read by both the cell rules
and the key under the grid, so a key cannot drift from the cells it explains.

Hover no longer repaints the cell. `app.css` washes the hovered button with
`surface-soft`, erasing the state colour underneath — and the hovered cell is
exactly the one whose colour is being read. The affordance is an inset outline
instead.

### 38.6 The Stats tab, which nearly did not happen

It was dropped in §37 on the grounds that it wanted who, where and how long.
That was true of its **provenance** half only. The analysis half is entirely
computable from the graded sheet the server already returns, and it is the half
with the substance — median confidence, the five confidence buckets, deviation
sizes bucketed on absolute value, and a by-size table. Every figure is counted
cell by cell from `/api/jobs/{id}/sheet`.

Worth remembering as a pattern: "the server does not have the data" was true of
a part and got applied to the whole.

### 38.7 Left open

| Item | State |
|---|---|
| **Nobody has reviewed this on a real screen but the author of the prototype** | Several defects in §38.5 were invisible to 57 passing tests, and both bugs in §39 were invisible to all 476. jsdom cannot tell you a colour is missing, and no test in the suite simulates a process that has already been running. |
| No audit trail | Activity, the Stats provenance card and "who settled this cell" all wait on it. Phase 5. |
| No release endpoint | `release` is enforced, guards nothing. |
| No style set upload | `manage.styles` likewise. The Upload button is present and dead, with the reason on it. |
| Three stages have no pipeline | PPM, Interim and Final carry nav and roles; standing in one shows an honest panel rather than an empty dashboard. |
| `src/api/index.html` | The legacy single-file UI, now very far behind. It is still what a checkout that has never run `npm run build` serves. |
| The bucket and the database hold demo data | `triburg` has five users; the Railway bucket has whatever has been uploaded since §35. |

---

## 39. Two bugs a restart found

**Date:** 24 September 2026. Continues §38.

**Tests:** 419 → **420** Python, 57 frontend. `ruff` and `alembic check` clean.
Head is now `09662e9820c9`.

Both of these had been in the code since phase 1 and neither could be seen
until a running server was killed and started again — which happened by
accident, when the machine ran low on memory.

### 39.1 The output name was never persisted

**Symptom.** After the restart, opening the graded sheet answered
`410 {"detail": ".json is no longer on disk"}`. The server log gave it away
exactly: `could not fetch outputs//.json` — the double slash is an empty name.

**Cause.** `Job.name` is the output base name: every file an inspection
produces is called `<name>.pdf`, `<name>.json` and so on, and `_graded_sheet`
finds the saved extraction by looking up `<name>.json`. The `inspections` table
had **no column for it**. `_apply` never wrote it and `_revive` never restored
it, so a job that came back from the database had `name == ""` and went looking
for a file called `.json`.

It worked perfectly until the first restart. Everything the operator needed was
on disk the whole time.

**Fix.** `inspections.name`, written on save and restored on revive, plus
migration `09662e9820c9`. The migration **backfills** rather than leaving old
rows blank: `outputs` already holds the full path of every file the inspection
wrote, so the name is the stem of any one of them.

Worth recording what the backfill turned up on the one real row:

```
name     = 'rec_2463(20)'
filename = 'rec_2463(16).mp3'
```

They are not the same, and they are not meant to be — the pipeline versions a
name that is already taken. So deriving the name from the recording's filename,
which is the obvious shortcut, would have been quietly wrong. `outputs` was the
only honest source.

`test_a_finished_job_is_still_there_after_a_restart` now asserts `back.name`.

### 39.2 A failure outlived its cause, in the browser

**Symptom.** The fix above was verified from the server — 200, 27 rows — while
the browser went on showing the same 410. Two more restarts did not shift it.

**Cause.** **410 Gone is a cacheable response by default**, and so is 404. The
browser had stored the failure and was entitled to keep serving it without
asking again. Nothing under `/api` set any cache policy at all; only the HTML
shell did, because a stale shell had bitten us before (§index).

The diagnosis that settled it: the page worked on `127.0.0.1:8100` and failed
on `localhost:8100`. Same server, same data — separate browser origins, and the
bad response was stored under only one of them.

**Fix.** One middleware: everything under `/api` sends
`Cache-Control: no-store, must-revalidate`. Every answer there is about state
that changes — a job's progress, a graded sheet, who is signed in — and none of
it is worth caching while some of it is actively harmful to cache.
`test_api_answers_are_never_cached` pins it, including on a 404.

**The part worth keeping.** A transient server fault became a permanent client
fault, with nothing on screen able to say the cause had already gone. That is a
worse failure than the original bug, because it defeats the ordinary way of
checking whether a fix worked: try it again.

### 39.3 Two notes for whoever runs this next

- `localhost` and `127.0.0.1` are **different origins**. Separate caches and
  separate cookies, so signing in on one does not sign you in on the other. A
  surprise trip to the sign-in screen is usually this.
- These were both found by restarting, not by testing. 57 frontend and 419
  Python tests were green throughout §39.1, because nothing in the suite
  simulated a process that had already been running.
