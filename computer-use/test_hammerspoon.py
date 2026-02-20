"""Integration tests for the macOS Hammerspoon HTTP server.

These tests require:
- macOS (skip on Linux)
- Hammerspoon running with the relaygent config
- Port 8097 accessible (default RELAYGENT_HAMMERSPOON_PORT)

Run: pytest computer-use/test_hammerspoon.py -v
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

import pytest

HAMMERSPOON_PORT = int(os.environ.get("RELAYGENT_HAMMERSPOON_PORT", 8097))
BASE_URL = f"http://localhost:{HAMMERSPOON_PORT}"


def _get(path: str) -> tuple[dict, int]:
    """GET request, returns (json_body, status_code)."""
    try:
        with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=3) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


def _post(path: str, body: dict | None = None) -> tuple[dict, int]:
    """POST request with optional JSON body."""
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


def _server_available() -> bool:
    try:
        _get("/health")
        return True
    except Exception:
        return False


requires_hammerspoon = pytest.mark.skipif(
    sys.platform != "darwin" or not _server_available(),
    reason="Requires macOS + Hammerspoon server on port 8097",
)


# ── Health ────────────────────────────────────────────────────────────────────

@requires_hammerspoon
class TestHealth:
    def test_returns_ok(self):
        body, code = _get("/health")
        assert code == 200
        assert body.get("status") == "ok"

    def test_has_screen_count(self):
        body, _ = _get("/health")
        assert isinstance(body.get("screens"), int)
        assert body["screens"] >= 1


# ── Screenshot ────────────────────────────────────────────────────────────────

@requires_hammerspoon
class TestScreenshot:
    def test_full_screenshot(self, tmp_path):
        p = str(tmp_path / "test.png")
        body, code = _post("/screenshot", {"path": p})
        assert code == 200
        assert body.get("path") == p
        assert body.get("width", 0) > 0
        assert body.get("height", 0) > 0

    def test_screenshot_writes_file(self, tmp_path):
        p = str(tmp_path / "screen.png")
        _post("/screenshot", {"path": p})
        assert os.path.exists(p)
        assert os.path.getsize(p) > 1000  # real PNG

    def test_cropped_screenshot(self, tmp_path):
        p = str(tmp_path / "crop.png")
        body, code = _post("/screenshot", {"path": p, "x": 0, "y": 0, "w": 100, "h": 100})
        assert code == 200
        assert body.get("width") == 100
        assert body.get("height") == 100


# ── Windows & Apps ────────────────────────────────────────────────────────────

@requires_hammerspoon
class TestWindowsAndApps:
    def test_windows_returns_list(self):
        body, code = _get("/windows")
        assert code == 200
        assert "windows" in body
        assert isinstance(body["windows"], list)

    def test_window_fields(self):
        body, _ = _get("/windows")
        if body["windows"]:
            w = body["windows"][0]
            assert "id" in w
            assert "title" in w
            assert "app" in w
            assert "frame" in w
            f = w["frame"]
            for k in ("x", "y", "w", "h"):
                assert k in f

    def test_apps_returns_list(self):
        body, code = _get("/apps")
        assert code == 200
        assert "apps" in body
        assert isinstance(body["apps"], list)

    def test_app_fields(self):
        body, _ = _get("/apps")
        if body["apps"]:
            a = body["apps"][0]
            assert "name" in a
            assert "pid" in a


# ── Click / Type ──────────────────────────────────────────────────────────────

@requires_hammerspoon
class TestClickType:
    def test_click_requires_coords(self):
        body, code = _post("/click", {})
        assert code == 400

    def test_click_valid_coords(self):
        # Click at 1,1 — safe offscreen-ish spot, just verifies no crash
        body, code = _post("/click", {"x": 1, "y": 1})
        assert code == 200

    def test_type_empty_string(self):
        body, code = _post("/type", {"text": ""})
        assert code == 200


# ── Element at / Focus ────────────────────────────────────────────────────────

@requires_hammerspoon
class TestElementAt:
    def test_missing_coords_returns_400(self):
        body, code = _post("/element_at", {})
        assert code == 400
        assert "error" in body

    def test_focus_missing_app_returns_400(self):
        body, code = _post("/focus", {})
        assert code == 400

    def test_focus_nonexistent_app_returns_404(self):
        body, code = _post("/focus", {"app": "this_app_does_not_exist_xyz"})
        assert code == 404


# ── Unknown route ─────────────────────────────────────────────────────────────

@requires_hammerspoon
class TestErrors:
    def test_unknown_route_returns_404(self):
        body, code = _post("/nonexistent_route_xyz", {})
        assert code == 404
        assert "error" in body
