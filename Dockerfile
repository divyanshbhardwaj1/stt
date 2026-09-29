# Two toolchains, one image. The React app is built with Node and then served
# by FastAPI out of `src/frontend/dist`, so Node is needed to *build* and not to
# run — which is the whole argument for a multi-stage build here rather than a
# nixpacks config: the runtime image carries no Node at all.

# ---------------------------------------------------------------- the front end
FROM node:22-slim AS frontend
WORKDIR /app/src/frontend

# The lockfile alone first, so `npm ci` is cached and only re-runs when a
# dependency actually changes rather than on every source edit.
COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm ci

COPY src/frontend/ ./
# tsc -b then vite build. A type error fails the image rather than shipping a
# bundle nobody type-checked.
RUN npm run build

# ------------------------------------------------------------------ the runtime
FROM python:3.12-slim

# ffmpeg arrives as a pip wheel (imageio-ffmpeg), so there is nothing to apt
# install for audio. `libpq` is not needed either: psycopg[binary] ships its own.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies before source, same caching argument as the lockfile above.
# `.[postgres]` because psycopg is an optional extra — kept out of the default
# install so the test suite and a local run need no Postgres, and therefore
# named explicitly by anything that does.
COPY pyproject.toml README.md ./
COPY src/ ./src/
RUN pip install --no-cache-dir -e ".[postgres]"

COPY migrations/ ./migrations/
COPY alembic.ini ./

# The built SPA, into the exact path `api/app.py` mounts from.
COPY --from=frontend /app/src/frontend/dist ./src/frontend/dist

# Where the pipeline works. Ephemeral on Railway and that is fine by design:
# recordings, outputs and the client's documents all live in the bucket, and
# `lifespan` pulls back what this container is missing. Attach a volume here
# only if you want the working copies to survive a redeploy.
RUN mkdir -p data/recordings data/transcripts data/output data/StyleSets data/references

# Railway injects PORT. Bound to 0.0.0.0 because the process has to be
# reachable from outside its own container, which 127.0.0.1 is not.
ENV PORT=8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn api.app:app --app-dir src --host 0.0.0.0 --port ${PORT}"]
