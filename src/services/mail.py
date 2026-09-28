"""Sending an alert out by email.

`smtplib` and nothing else. A provider SDK would be a dependency to keep
current in exchange for a feature this application uses once a day, and every
host that sends mail speaks SMTP.

Unconfigured is the normal state, not a fault: the settings page asks this
module whether email is possible and says so plainly rather than offering a
switch that does nothing.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

log = logging.getLogger(__name__)

# Seconds. A mail server that has not answered by now is not going to, and the
# sweep that is waiting on it has a page to render.
TIMEOUT = 10


def _setting(name: str, fallback: str = "") -> str:
    return (os.getenv(name) or fallback).strip()


def enabled() -> bool:
    """Whether there is anywhere to send to."""
    return bool(_setting("SMTP_HOST") and sender())


def sender() -> str:
    """The From address. Falls back to the user, which most hosts require."""
    return _setting("SMTP_FROM") or _setting("SMTP_USER")


def send(to: list[str], subject: str, body: str) -> bool:
    """One message to several people. Never raises.

    An alert that could not be emailed is still in the list, and a mail server
    having a bad morning must not take the sweep - or the page waiting on it -
    down with it.
    """
    addresses = sorted({address.strip() for address in to if address and "@" in address})
    if not addresses or not enabled():
        return False

    note = EmailMessage()
    note["From"] = sender()
    note["To"] = ", ".join(addresses)
    note["Subject"] = subject
    note.set_content(body)

    host = _setting("SMTP_HOST")
    port = int(_setting("SMTP_PORT", "587") or 587)
    user = _setting("SMTP_USER")
    password = _setting("SMTP_PASSWORD")
    try:
        # 465 is implicit TLS; everything else starts in the clear and is
        # upgraded. Both are attempted with a timeout, because a hung socket
        # here is a hung request on the floor.
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=TIMEOUT) as server:
                if user:
                    server.login(user, password)
                server.send_message(note)
        else:
            with smtplib.SMTP(host, port, timeout=TIMEOUT) as server:
                server.starttls()
                if user:
                    server.login(user, password)
                server.send_message(note)
    except Exception:  # noqa: BLE001 - the alert is already raised; this is extra
        log.warning("could not email %d recipient(s): %s", len(addresses), subject)
        return False
    log.info("emailed %d recipient(s): %s", len(addresses), subject)
    return True
