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

As a web app — upload a recording in the browser, download the report:

```powershell
python src\main.py serve            # http://127.0.0.1:8000
python src\main.py serve --port 9000 --host 0.0.0.0 --reload
```

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
    app.py                         FastAPI routes: upload, poll, download
    jobs.py                        background job store and runner
    index.html                     the single-page front end
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
  transcripts/                     saved transcripts
  references/                      client documents: report PDFs, graded spec sheets
  output/                          generated csv, pdf and json
```

Each stage is callable on its own, so a rerun skips the expensive parts: an existing
transcript is reused, and `rerender` rebuilds both outputs from the saved JSON without
touching the API.

## Web endpoints

| Method | Path | What |
| --- | --- | --- |
| `GET` | `/` | Upload page, polls for job status |
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
pytest
ruff check .
ruff format .
```

## Notes

Measurements are exact `fractions.Fraction` values end to end. Floats are never used —
the job turns on eighths of an inch and rounding drift would be silent and wrong.

Recordings are capped at 25 MB by the transcription API. The reference recording is
18 MB, so longer sessions will need re-encoding or chunking before upload.

Validation against the graded spec sheet (`pipeline/measurements.py`) is built and tested
but not yet wired into the pipeline — it lands with the spec-sheet loader, which turns
the `field` column into real POM codes and adds a pass/fail verdict per measurement.
