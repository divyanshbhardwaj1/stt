"""Entry point. Parses arguments, picks a recording, and calls the pipeline.

python src/main.py run                  pick a recording, run every stage
python src/main.py run rec.m4a          run every stage on one recording
python src/main.py transcribe           stage 1 only
python src/main.py extract Recording_20 stages 2-3 on an existing transcript
python src/main.py rerender Recording_20  rebuild csv and pdf, no API call
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pipeline
from services.auth import AuthError
from services.config import ConfigError, Settings
from services.csv_filler import ExtractionError, TemplateError
from services.measurements import format_measurement as fmt
from services.transcript import (
    TranscriptionError,
    find_recordings,
    resolve_transcript,
    transcript_path_for,
)

log = logging.getLogger(__name__)
MAX_FLAGGED_SHOWN = 10


class NoRecordingsFound(RuntimeError):
    """The recordings directory holds nothing we can transcribe."""


def choose_recording(named: str | None, settings: Settings) -> Path | None:
    """The recording named on the command line, or one picked from a numbered menu.

    Returns None when the user quits the menu. Raises NoRecordingsFound when there
    was nothing to offer in the first place — quitting is success, an empty folder
    is not.
    """
    if named:
        recording = Path(named)
        if not recording.is_file():
            raise FileNotFoundError(recording)
        return recording

    recordings = find_recordings(settings.recordings_dir)
    if not recordings:
        raise NoRecordingsFound(f"no recordings in {settings.recordings_dir}")

    for index, recording in enumerate(recordings, 1):
        done = "  (done)" if transcript_path_for(recording, settings).exists() else ""
        print(f"{index:>3}. {recording.name}{done}")
    while True:
        choice = input("\npick a number (blank to quit): ").strip()
        if not choice:
            return None
        if choice.isdigit() and 1 <= int(choice) <= len(recordings):
            return recordings[int(choice) - 1]
        print("no such number")


def report_result(result: pipeline.PipelineResult) -> None:
    """Print what the run produced and what still needs a human."""
    sheet = result.sheet
    flagged = sheet.flagged()
    filled = sum(1 for value in sheet.form.values() if value)
    print(f"\n{sheet.headline() or 'no header stated'}")
    print(
        f"form: {filled}/{len(sheet.form)} fields · {len(sheet.accessories)} accessories · "
        f"{len(sheet.comments)} comments"
    )
    print(f"detail: {len(sheet.rows)} rows · sizes {', '.join(sheet.sizes()) or 'none'}")
    print(f"{len(flagged)} need review" + (":" if flagged else ""))
    for number, row in flagged[:MAX_FLAGGED_SHOWN]:
        where = f"{row.size} " if row.size else ""
        stated = f"{row.value or '?'} ({row.confidence:.2f})"
        line = f"  #{number:<3} {where}{row.field}: {stated} {row.note}"
        print(line.rstrip())
    if len(flagged) > MAX_FLAGGED_SHOWN:
        print(f"  ... and {len(flagged) - MAX_FLAGGED_SHOWN} more, see the CSV")
    report_verdicts(result)
    print(f"\n-> {result.form_csv_path}\n-> {result.measurements_csv_path}\n-> {result.pdf_path}")
    graded = result.graded_paths
    if graded:
        print(f"-> {graded[0]}\n-> {graded[1]}")


def report_verdicts(result: pipeline.PipelineResult) -> None:
    """Print the tolerance check, when a style set was available to check against."""
    alignment = result.alignment
    if alignment is None:
        print("\nno style set matched, so nothing was checked against spec")
        return

    print(
        f"\nchecked against style {alignment.style_no}: {len(alignment.judged)} of "
        f"{len(alignment.rows)} measurements judged, {len(alignment.unmatched)} unmatched"
    )
    print(f"measurement result: {alignment.verdict or 'not determined'}")

    open_questions = alignment.unconfirmed
    if open_questions:
        print()
        print(
            f"{len(open_questions)} point(s) of measure have NO captured verdict. "
            "These are not passes - listen back and fill them in:"
        )
        for row in open_questions[:MAX_FLAGGED_SHOWN]:
            spec = fmt(row.spec) if row.spec is not None else "?"
            print(f"  {row.pom:<9}{row.size:>3}  {row.description[:42]:<42} spec {spec}")
        if len(open_questions) > MAX_FLAGGED_SHOWN:
            print(f"  ... and {len(open_questions) - MAX_FLAGGED_SHOWN} more, see the graded CSV")

    failures = alignment.failures
    if not failures:
        return
    print(f"{len(failures)} out of tolerance:")
    for row in failures[:MAX_FLAGGED_SHOWN]:
        print(
            f"  {row.pom:<7} {row.size:>3}  {row.description[:36]:<36} "
            f"{fmt(row.measured):>8} vs {fmt(row.spec):>8}  {fmt(row.deviation, signed=True)}"
        )
    if len(failures) > MAX_FLAGGED_SHOWN:
        print(f"  ... and {len(failures) - MAX_FLAGGED_SHOWN} more, see the graded CSV")


def announce(message: str) -> None:
    print(f"\n--- {message}\n")


def stream(delta: str) -> None:
    print(delta, end="", flush=True)


def command_run(args: argparse.Namespace, settings: Settings) -> int:
    """Recording -> transcript -> LLM -> CSV and PDF."""
    recording = choose_recording(args.recording, settings)
    if recording is None:
        return 0
    result = pipeline.run(
        recording,
        settings,
        retranscribe=args.retranscribe,
        on_delta=stream,
        announce=announce,
    )
    report_result(result)
    return 0


def command_transcribe(args: argparse.Namespace, settings: Settings) -> int:
    """Recording -> transcript only."""
    recording = choose_recording(args.recording, settings)
    if recording is None:
        return 0
    announce(f"transcribing {recording.name}")
    print(f"\n\n-> {pipeline.transcribe_stage(recording, settings, on_delta=stream)}")
    return 0


def command_extract(args: argparse.Namespace, settings: Settings) -> int:
    """Existing transcript -> CSV and PDF."""
    transcript = resolve_transcript(args.transcript, settings)
    template = pipeline.load_form_template(settings)
    announce(f"extracting {transcript.name} with {settings.extract_model}")
    sheet = pipeline.extract_stage(transcript, settings, template)
    validated = pipeline.validate_stage(sheet, settings)
    name = pipeline.resolve_output_name(transcript.stem, settings)
    written = pipeline.write_stage(sheet, name, settings, template, validated)
    alignment, style = validated if validated else (None, None)
    report_result(
        pipeline.PipelineResult(name, transcript, sheet, *written, alignment=alignment, style=style)
    )
    return 0


def command_rerender(args: argparse.Namespace, settings: Settings) -> int:
    """Rebuild CSV and PDF from a saved extraction. No API call."""
    report_result(pipeline.rerender(args.name, settings, new_version=args.new, style_no=args.style))
    return 0


def command_serve(args: argparse.Namespace, settings: Settings) -> int:
    """Run the web app: upload a recording in the browser, download the report."""
    import uvicorn

    # Loading settings here means a missing API key fails now, with the usual
    # message, rather than on the first upload.
    del settings
    print(f"\n--- http://{args.host}:{args.port}\n")
    uvicorn.run("api.app:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def _users_ready() -> None:
    """Fail with something actionable when there is no database to talk to."""
    from services.db import enabled

    if not enabled():
        raise ConfigError(
            "DATABASE_URL is not set, so there is nowhere to keep users. "
            "Put it in .env and run `alembic upgrade head` first."
        )


def _ask_password(confirm: bool = True) -> str:
    """Read a password without echoing it, and without it reaching the shell.

    Not an argument, deliberately. A password on a command line lands in the
    shell history, in `ps` output for every other user on the box, and in any
    recording of the terminal.
    """
    import getpass

    password = getpass.getpass("password: ")
    if confirm and password != getpass.getpass("again: "):
        raise ConfigError("Those did not match.")
    return password


def _parse_roles(pairs: list[str]) -> dict[str, str]:
    """`--role sizeset:reviewer --role final:approver` -> {stage: role}."""
    roles: dict[str, str] = {}
    for pair in pairs or []:
        stage, separator, role = pair.partition(":")
        if not separator:
            raise ConfigError(f"--role wants stage:role, not {pair!r}")
        roles[stage.strip()] = role.strip()
    return roles


def _by_email(db, email: str):
    """One user, by the address they sign in with."""
    from sqlalchemy import select

    from services import auth
    from services.db.models import User

    return db.scalar(select(User).where(User.email == auth.normalise_email(email)))


def command_user_add(args: argparse.Namespace, settings: Settings) -> int:
    """Create a user. This is how the first administrator exists."""
    del settings
    _users_ready()
    from services import auth
    from services.db import session

    password = _ask_password()
    with session() as db:
        user = auth.create_user(
            db,
            args.email,
            args.name,
            password=password,
            roles=_parse_roles(args.role),
            is_admin=args.admin,
        )
        held = "every stage" if user.is_admin else ", ".join(
            f"{m.stage}:{m.role}" for m in sorted(user.memberships, key=lambda m: m.stage)
        )
        print(f"{user.email} ({user.name}): {user.state}, {held}")
    return 0


def command_user_list(args: argparse.Namespace, settings: Settings) -> int:
    """Everyone on the roster, and what they hold."""
    del args, settings
    _users_ready()
    from sqlalchemy import select

    from services import auth
    from services.db import session
    from services.db.models import User

    with session() as db:
        people = db.scalars(select(User).order_by(User.name)).all()
        if not people:
            print("no users yet - `user add <email> --name ... --admin` makes the first")
            return 0
        for person in people:
            held = (
                "every stage"
                if person.is_admin
                else ", ".join(f"{m.stage}:{m.role}" for m in person.memberships) or "no stage"
            )
            flag = auth.ROLE_LABELS.get(auth.role_on(person) or "", "no role")
            print(f"{person.email:<32} {person.state:<9} {flag:<14} {held}")
    return 0


def command_user_password(args: argparse.Namespace, settings: Settings) -> int:
    """Set somebody's password, activating an invited user."""
    del settings
    _users_ready()
    from services import auth
    from services.db import session
    from services.db.models import UserState

    with session() as db:
        person = _by_email(db, args.email)
        if person is None:
            raise ConfigError(f"no user {args.email!r}")
        person.password_hash = auth.hash_password(_ask_password())
        person.state = UserState.active.value
        ended = auth.sign_out_everywhere(db, person.id)
        print(f"{person.email}: password set, {ended} session(s) ended")
    return 0


def command_user_disable(args: argparse.Namespace, settings: Settings) -> int:
    """Lock somebody out now, keeping the user the audit trail points at."""
    del settings
    _users_ready()
    from services import auth
    from services.db import session
    from services.db.models import UserState

    with session() as db:
        person = _by_email(db, args.email)
        if person is None:
            raise ConfigError(f"no user {args.email!r}")
        if auth.last_admin(db, person.id):
            raise ConfigError(
                "That is the last administrator. Promote somebody else first, or "
                "nobody can manage the roster."
            )
        person.state = UserState.disabled.value
        ended = auth.sign_out_everywhere(db, person.id)
        print(f"{person.email}: disabled, {ended} session(s) ended")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sizeset", description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true", help="log progress to stderr")
    sub = parser.add_subparsers(dest="command", required=True)

    run_cmd = sub.add_parser("run", help="recording -> transcript -> csv and pdf")
    run_cmd.add_argument("recording", nargs="?", help="path to a recording (default: menu)")
    run_cmd.add_argument(
        "--retranscribe", action="store_true", help="ignore an existing transcript"
    )
    run_cmd.set_defaults(handler=command_run)

    transcribe_cmd = sub.add_parser("transcribe", help="recording -> transcript")
    transcribe_cmd.add_argument("recording", nargs="?", help="path to a recording (default: menu)")
    transcribe_cmd.set_defaults(handler=command_transcribe)

    extract_cmd = sub.add_parser("extract", help="transcript -> csv and pdf")
    extract_cmd.add_argument("transcript", help="transcript path, or its name without .txt")
    extract_cmd.set_defaults(handler=command_extract)

    rerender_cmd = sub.add_parser("rerender", help="rebuild csv and pdf from a saved extraction")
    rerender_cmd.add_argument("name", help="extraction name, without .json")
    rerender_cmd.add_argument(
        "--new",
        action="store_true",
        help="write the next version instead of overwriting the existing files",
    )
    rerender_cmd.add_argument(
        "--style", default="", help="style set to check against, overriding the recording"
    )
    rerender_cmd.set_defaults(handler=command_rerender)

    # Users. Here rather than only in the web app because the first
    # administrator has to exist before anybody can sign in to create one, and
    # because locking somebody out should not require a working browser.
    user_cmd = sub.add_parser("user", help="users and roles")
    users = user_cmd.add_subparsers(dest="user_command", required=True)

    add_cmd = users.add_parser("add", help="create a user")
    add_cmd.add_argument("email", help="what they sign in with")
    add_cmd.add_argument("--name", required=True, help="what the audit trail records")
    add_cmd.add_argument("--admin", action="store_true", help="holds every stage")
    add_cmd.add_argument(
        "--role",
        action="append",
        default=[],
        metavar="STAGE:ROLE",
        help="e.g. sizeset:reviewer. Repeatable. Ignored for --admin",
    )
    add_cmd.set_defaults(handler=command_user_add)

    list_cmd = users.add_parser("list", help="show the roster")
    list_cmd.set_defaults(handler=command_user_list)

    password_cmd = users.add_parser("password", help="set a password")
    password_cmd.add_argument("email")
    password_cmd.set_defaults(handler=command_user_password)

    disable_cmd = users.add_parser("disable", help="lock a user out")
    disable_cmd.add_argument("email")
    disable_cmd.set_defaults(handler=command_user_disable)

    serve_cmd = sub.add_parser("serve", help="run the web app")
    serve_cmd.add_argument("--host", default="127.0.0.1", help="default: 127.0.0.1")
    serve_cmd.add_argument("--port", type=int, default=8000, help="default: 8000")
    serve_cmd.add_argument("--reload", action="store_true", help="reload on code changes")
    serve_cmd.set_defaults(handler=command_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    try:
        return args.handler(args, Settings.load())
    except (
        AuthError,
        ConfigError,
        TranscriptionError,
        ExtractionError,
        TemplateError,
        NoRecordingsFound,
    ) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except FileNotFoundError as exc:
        print(f"error: not found: {exc}", file=sys.stderr)
        return 2
    except PermissionError as exc:
        # Excel holds an exclusive lock on an open CSV. The extraction is already
        # saved as JSON by this point, so `rerender` finishes without paying again.
        print(
            f"error: {exc.filename} is locked, probably open in Excel.\n"
            "Close it, then rebuild the outputs for free with: "
            "python src/main.py rerender <name>",
            file=sys.stderr,
        )
        return 2
    except (KeyboardInterrupt, EOFError):
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
