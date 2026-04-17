"""Auto-discover and load notification collectors.

Built-in: any `*_collector.py` in this directory exporting a `collect(list)`.
External: any `*_collector.py` in `~/.relaygent/collectors/` (agent-configurable).

Each collector module may declare:
    NAME = "slack"          # optional, default = filename minus "_collector"
    FAST = False            # optional, default False (skipped in ?fast=1 mode)
    ENABLED = True          # optional, default True (set False to disable)

Disable via ~/.relaygent/config.json:
    { "notifications": { "collectors": { "slack": { "enabled": false } } } }
"""
from __future__ import annotations

import importlib
import importlib.util
import json
import logging
import os
import sys
from pathlib import Path
from typing import Callable, NamedTuple

logger = logging.getLogger(__name__)

EXTERNAL_DIR = Path(os.path.expanduser("~/.relaygent/collectors"))
_BUILTIN_DIR = Path(__file__).parent
_SKIP_BUILTIN = {"tasks_collector"}  # called directly in routes.py as fast


class Collector(NamedTuple):
    name: str
    fast: bool
    fn: Callable[[list], None]
    source: str  # "builtin" or external dir path


def _config_overrides() -> dict:
    """Load per-collector config from ~/.relaygent/config.json."""
    try:
        with open(os.path.expanduser("~/.relaygent/config.json")) as f:
            return json.load(f).get("notifications", {}).get("collectors", {})
    except (OSError, json.JSONDecodeError, KeyError):
        return {}


def _load_builtin(name: str):
    """Use importlib.import_module so Flask routes register only once."""
    try:
        return importlib.import_module(name)
    except Exception:
        logger.exception("Failed to import builtin collector: %s", name)
        return None


def _load_external(path: Path):
    """Load file from external dir under a unique synthetic module name."""
    mod_name = f"_external_{path.stem}"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    spec = importlib.util.spec_from_file_location(mod_name, path)
    if not spec or not spec.loader:
        return None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    try:
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        sys.modules.pop(mod_name, None)
        logger.exception("Failed to load external collector: %s", path)
        return None


def _collect_from_dir(dir_path: Path, source_label: str) -> list[Collector]:
    if not dir_path.is_dir():
        return []
    overrides = _config_overrides()
    found = []
    is_builtin = source_label == "builtin"
    for path in sorted(dir_path.glob("*_collector.py")):
        if is_builtin and path.stem in _SKIP_BUILTIN:
            continue
        mod = _load_builtin(path.stem) if is_builtin else _load_external(path)
        if not mod or not callable(getattr(mod, "collect", None)):
            continue
        name = getattr(mod, "NAME", path.stem.removesuffix("_collector"))
        fast = bool(getattr(mod, "FAST", False))
        enabled = bool(getattr(mod, "ENABLED", True))
        if not overrides.get(name, {}).get("enabled", enabled):
            logger.info("Collector %s disabled via config", name)
            continue
        found.append(Collector(name=name, fast=fast, fn=mod.collect, source=source_label))
    return found


def discover() -> list[Collector]:
    """Return all enabled collectors from built-in + external directories."""
    return _collect_from_dir(_BUILTIN_DIR, "builtin") + _collect_from_dir(EXTERNAL_DIR, str(EXTERNAL_DIR))
