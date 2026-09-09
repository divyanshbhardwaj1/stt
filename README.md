# sizeset

Turns a recorded garment size-set inspection into a filled Size Set Inspection Report.

An inspector walks the graded spec sheet aloud, point of measure by point of measure,
size by size, calling out each measured deviation. Today someone replays that recording
and fills the report by hand. This automates it, leaving a human to review only the
values the pipeline is unsure about.

## Flow

```
recording  ──▶  transcript  ──▶  LLM  ──▶  CSV + PDF
                    │             │
              saved to file   filled sheet
```

## Run it

As a web app — record or upload an inspection in the browser, download the report:

```powershell
cd src\frontend; npm install; npm run build; cd ..\..    # once, and after UI changes
python src\main.py serve                                 # http://127.0.0.1:8000
python src\main.py serve --port 9000 --host 0.0.0.0 --reload
```

The front end is a React app in `src/frontend`. `serve` prefers its build at
`src/frontend/dist`; if that has never been built it falls back to the legacy single-file
page at `src/api/index.html`, so the app still runs with a Python-only toolchain.

While working on the UI, run both halves and let each reload on its own:

```powershell
python src\main.py serve             # API on 8000
cd src\frontend; npm run dev         # UI on 5173, proxies /api to 8000
```

**Recording in the browser** uses `MediaRecorder`, so there is nothing to install:
press *Record now*, run the inspection, press stop, play it back to confirm the mic
caught it, then process it exactly like an uploaded file. It saves to
`data/recordings/` as `inspection-<timestamp>.webm` (`.mp4` on Safari) and from there
the pipeline is identical.

While recording, a **live transcript** fills the work pane, one line per utterance: the
line grows while someone is talking and a new one starts when they pause, each stamped
with its position in the recording so an open question can be scrubbed straight to.

It is a monitor: it shows that the inspector's numbers and point-of-measure names are
reaching the microphone while there is still time to repeat one. It is not what the
report is built from — the uploaded file is transcribed again afterwards, twice, which
is more thorough. The monitor's text is saved to `data/transcripts/<name>.live.txt`
(one timestamped line per utterance) for audit, and no stage of the pipeline reads it.

It works by minting a short-lived credential server-side (`POST /api/realtime-token`)
and streaming the microphone from the browser straight to the transcription API over
WebRTC, so the account key stays on the server and a half-hour of audio never passes
through it. The session is seeded with the same prompt, keywords and languages as the
batch pass. Set `SIZESET_REALTIME_MODEL=` (empty) to turn it off; recording and the
report are unaffected either way.

Microphone access needs a secure context. `http://127.0.0.1` counts; a plain-http LAN
address does not, so a tablet reaching `serve --host 0.0.0.0` over `http://192.168.x.x`
gets the upload button and a disabled record button explaining why. Put the app behind
https (or a local tunnel) to record from another device.

Or from the command line:

```powershell
python src\main.py run                      # pick a recording, run every stage
python src\main.py run data\recordings\x.m4a
python src\main.py transcribe               # stage 1 only
python src\main.py extract Recording_20     # stages 2-3 on an existing transcript
python src\main.py rerender Recording_20    # rebuild csv and pdf, no API call
```

Both drive the same pipeline and write to the same `data/output/`.

`run` reuses a transcript that already exists; pass `--retranscribe` to redo it.
`-v` logs progress to stderr.

## Layout

```
src/
  main.py                          entry point: arguments, menu, printing, serve
  api/
    app.py                         FastAPI routes: upload, poll, download, static build
    jobs.py                        background job store and runner
    index.html                     legacy no-build front end, served if dist is absent
  frontend/                        React app (Vite + TypeScript)
    src/
      App.tsx                      layout and selection
      api.ts                       fetch and XHR upload against /api
      types.ts                     the job payload, mirroring jobs.py
      hooks/useJobs.ts             adaptive polling
      hooks/useRecorder.ts         MediaRecorder + AnalyserNode state machine
      hooks/useLiveTranscript.ts   WebRTC monitor: live words, never the report
      components/Intake.tsx        recorder: record, pause, done, discard
      components/Waveform.tsx      live level meter on a canvas
      components/LiveTranscript.tsx  the live transcript feed in the work pane
      components/JobDetail.tsx     the report, ordered like the workflow
      styles.css                   OKLCH tokens, light and dark
  pipeline/
    inspection_pipeline.py         the three stages, and run() over all of them
    measurements.py                fractional-inch parsing and tolerance checks
  services/
    config/
      settings.py                  environment and configuration, resolved once
    transcript/
      transcription_service.py     audio to text, with a garment-vocabulary prompt
      recording_library.py         finding recordings, placing transcripts
    csv_filler/
      inspection_record.py         the row and sheet shape, shared by every writer
      inspection_extractor.py      transcript to filled sheet, one LLM call
      csv_writer.py                sheet to .csv and .json
      pdf_writer.py                sheet to .pdf
tests/                             pytest suite, no network or API key needed
data/
  recordings/                      inspection audio
  transcripts/                     saved transcripts (.txt, .pass2.txt, .live.txt)
  references/                      client documents: report PDFs, graded spec sheets
  output/                          generated csv, pdf and json
```

Each stage is callable on its own, so a rerun skips the expensive parts: an existing
transcript is reused, and `rerender` rebuilds both outputs from the saved JSON without
touching the API.

## Web endpoints

| Method | Path | What |
| --- | --- | --- |
| `GET` | `/` | App shell: the React build, or the legacy page if it is unbuilt |
| `GET` | `/assets/*` | Hashed JS and CSS from the React build, when present |
| `GET` | `/api/style-sets` | Style numbers with a spec sheet on disk |
| `POST` | `/api/realtime-token` | Short-lived credential for the live monitor |
| `POST` | `/api/jobs` | Upload a recording, returns a job to poll (202) |
| `GET` | `/api/jobs` | All jobs, newest first |
| `GET` | `/api/jobs/{id}` | One job's status |
| `GET` | `/api/jobs/{id}/download/{kind}` | `report`, `form`, `measurements` or `data` |
| `GET` | `/api/docs` | Generated API documentation |

Transcription takes minutes, so an upload returns straight away and the work runs on a
background thread. Jobs live in memory and are lost on restart; the generated files in
`data/output/` are not.

## Setup

```powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install -e ".[dev]"
copy .env.example .env      # then fill in OPENAI_API_KEY
```

## Review workflow

Every extracted row carries a confidence score. Rows below `REVIEW_THRESHOLD` (0.85) are
marked `needs_review` in the CSV and printed in red in the PDF. On the reference
recording that is 12 rows out of 105 — mid-sentence corrections, crosstalk, and point-of-
measure names the model could not place. Those are the only rows a human has to check.

## Data handling

`data/` is gitignored and must stay that way. It holds client audio and AEO spec sheets
marked proprietary and confidential; none of it belongs in this repository.

## Development

```powershell
pytest                    # 273 backend tests
ruff check .
ruff format .

cd src\frontend
npm test                  # 26 tests: recorder, live monitor, pane hand-off
npm run lint
npm run build             # tsc -b, then vite build
```

## Notes

Measurements are exact `fractions.Fraction` values end to end. Floats are never used —
the job turns on eighths of an inch and rounding drift would be silent and wrong.

Recordings are capped at 25 MB by the transcription API. The reference recording is
18 MB, so longer sessions will need re-encoding or chunking before upload.

Validation against the graded spec sheet (`pipeline/measurements.py`) is built and tested
but not yet wired into the pipeline — it lands with the spec-sheet loader, which turns
the `field` column into real POM codes and adds a pass/fail verdict per measurement.
