"""Tests for linux_a11y.py — accessibility tree, element_at, ax_press."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import linux_a11y as a11y


# ---------------------------------------------------------------------------
# Pure helpers (no pyatspi needed)
# ---------------------------------------------------------------------------

class TestAxrole:
    def test_empty_string(self):
        assert a11y._axrole("") == ""

    def test_single_word(self):
        assert a11y._axrole("button") == "AXbutton"

    def test_multi_word(self):
        assert a11y._axrole("push button") == "AXpushbutton"

    def test_none_like_falsy(self):
        assert a11y._axrole(None) == ""


class TestAttr:
    def test_returns_attr(self):
        obj = MagicMock(); obj.name = "hello"
        assert a11y._attr(obj, "name", "") == "hello"

    def test_returns_default_on_missing(self):
        obj = MagicMock(spec=[])
        assert a11y._attr(obj, "name", "def") == "def"

    def test_returns_default_on_falsy_value(self):
        obj = MagicMock(); obj.name = ""
        assert a11y._attr(obj, "name", "def") == "def"

    def test_returns_default_on_runtime_error(self):
        obj = MagicMock()
        type(obj).name = property(lambda self: (_ for _ in ()).throw(RuntimeError))
        assert a11y._attr(obj, "name", "fallback") == "fallback"


class TestRole:
    def test_returns_role_name(self):
        obj = MagicMock(); obj.getRoleName.return_value = "button"
        assert a11y._role(obj) == "button"

    def test_returns_empty_on_error(self):
        obj = MagicMock(); obj.getRoleName.side_effect = RuntimeError
        assert a11y._role(obj) == ""


# ---------------------------------------------------------------------------
# element_at — validation paths (no pyatspi)
# ---------------------------------------------------------------------------

class TestElementAt:
    def test_missing_x_returns_400(self):
        body, code = a11y.element_at({"y": 100})
        assert code == 400
        assert "x,y" in body["error"]

    def test_missing_y_returns_400(self):
        body, code = a11y.element_at({"x": 50})
        assert code == 400

    def test_missing_both_returns_400(self):
        body, code = a11y.element_at({})
        assert code == 400

    def test_no_atspi_returns_500(self):
        with patch.object(a11y, "HAS_ATSPI", False):
            body, code = a11y.element_at({"x": 10, "y": 20})
        assert code == 500
        assert "pyatspi2" in body["error"]


# ---------------------------------------------------------------------------
# _get_app — no-atspi path
# ---------------------------------------------------------------------------

class TestGetApp:
    def test_no_atspi_returns_error(self):
        with patch.object(a11y, "HAS_ATSPI", False):
            app, err = a11y._get_app("anything")
        assert app is None
        assert "pyatspi2" in err


# ---------------------------------------------------------------------------
# accessibility_tree — error propagation
# ---------------------------------------------------------------------------

class TestAccessibilityTree:
    def test_no_atspi_returns_404(self):
        with patch.object(a11y, "HAS_ATSPI", False):
            body, code = a11y.accessibility_tree({})
        assert code == 404
        assert "error" in body

    def test_app_not_found_returns_404(self):
        with patch.object(a11y, "_get_app", return_value=(None, "app 'x' not found")):
            body, code = a11y.accessibility_tree({"app": "x"})
        assert code == 404
        assert "not found" in body["error"]


# ---------------------------------------------------------------------------
# ax_press — error propagation
# ---------------------------------------------------------------------------

class TestAxPress:
    def test_no_atspi_returns_404(self):
        with patch.object(a11y, "HAS_ATSPI", False):
            body, code = a11y.ax_press({"app": "foo"})
        assert code == 404

    def test_app_not_found_returns_404(self):
        with patch.object(a11y, "_get_app", return_value=(None, "app 'foo' not found")):
            body, code = a11y.ax_press({"app": "foo"})
        assert code == 404


# ---------------------------------------------------------------------------
# _build_tree — with mock objects
# ---------------------------------------------------------------------------

class TestBuildTree:
    def _leaf(self, role="button", name="OK", childCount=0):
        obj = MagicMock()
        obj.getRoleName.return_value = role
        obj.name = name
        obj.description = ""
        obj.childCount = childCount
        obj.queryValue.side_effect = NotImplementedError
        obj.queryComponent.side_effect = NotImplementedError
        return obj

    def test_builds_basic_node(self):
        obj = self._leaf(role="button", name="OK")
        node = a11y._build_tree(obj, 0, 4, {"count": 0})
        assert node["role"] == "AXbutton"
        assert node["title"] == "OK"

    def test_none_obj_returns_none(self):
        assert a11y._build_tree(None, 0, 4, {"count": 0}) is None

    def test_depth_exceeded_returns_none(self):
        obj = self._leaf()
        assert a11y._build_tree(obj, 5, 4, {"count": 0}) is None

    def test_node_limit_returns_none(self):
        obj = self._leaf()
        assert a11y._build_tree(obj, 0, 4, {"count": a11y.MAX_NODES}) is None

    def test_skip_roles_with_no_name(self):
        obj = self._leaf(role="panel", name="")
        node = a11y._build_tree(obj, 0, 4, {"count": 0})
        assert node is None

    def test_skip_role_kept_when_has_name(self):
        obj = self._leaf(role="panel", name="sidebar")
        node = a11y._build_tree(obj, 0, 4, {"count": 0})
        assert node is not None
        assert node["title"] == "sidebar"

    def test_children_included(self):
        parent = self._leaf(role="group", name="", childCount=1)
        child = self._leaf(role="button", name="Click")
        parent.getChildAtIndex.return_value = child
        node = a11y._build_tree(parent, 0, 4, {"count": 0})
        assert "children" in node
        assert node["children"][0]["title"] == "Click"

    def test_increments_count(self):
        obj = self._leaf()
        state = {"count": 0}
        a11y._build_tree(obj, 0, 4, state)
        assert state["count"] == 1
