"""Relaygent Notifications — configuration and app setup."""

import logging
import os

from flask import Flask

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

# Werkzeug logs every HTTP request at INFO. The relay polls
# /notifications/pending several times per second, which floods the access log
# (hundreds of MB over a few days of uptime). Keep werkzeug's warnings/errors
# but drop the per-request access lines; the app's own loggers stay at INFO.
logging.getLogger("werkzeug").setLevel(logging.WARNING)

app = Flask(__name__)

_REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("RELAYGENT_DATA_DIR", os.path.join(_REPO_DIR, "data"))
DB_PATH = os.path.join(DATA_DIR, "reminders.db")

try:
    from croniter import croniter  # noqa: F401
    CRONITER_AVAILABLE = True
except ImportError:
    CRONITER_AVAILABLE = False
