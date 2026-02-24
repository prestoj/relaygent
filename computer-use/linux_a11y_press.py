"""Accessibility element search + press for Linux (AT-SPI2).

Extracted from linux_a11y.py — find_elements / click_element handlers.
"""
from __future__ import annotations

import linux_a11y as _a11y


def _search_press(obj, depth, target, state):
    if obj is None or depth > 8 or state["count"] >= _a11y.MAX_NODES:
        return None
    state["count"] += 1
    role = _a11y._role(obj)
    name = _a11y._attr(obj, "name", "")
    desc = _a11y._attr(obj, "description", "")
    rs = _a11y._axrole(role)
    match_r = not target["role"] or rs == target["role"]
    match_t = not target["title"] or (
        target["title"] in name.lower() or target["title"] in desc.lower())
    if match_r and match_t and (target["role"] or target["title"]):
        state["mi"] += 1
        if state["mi"] == target["index"]:
            title = name or desc
            try:
                ai = obj.queryAction()
                for ta in _a11y.TRY_ACTIONS:
                    for i in range(ai.nActions):
                        if ai.getName(i) == ta:
                            ai.doAction(i)
                            return {"pressed": True, "action": ta,
                                    "title": title, "role": rs}
                return {"pressed": False, "title": title, "role": rs,
                        "error": "no supported action"}
            except (RuntimeError, AttributeError, NotImplementedError):
                return {"pressed": False, "title": title, "role": rs,
                        "error": "no action interface"}
    try:
        for i in range(obj.childCount):
            r = _search_press(obj.getChildAtIndex(i), depth + 1, target, state)
            if r:
                return r
    except (RuntimeError, AttributeError):
        pass
    return None


def ax_press(params):
    app, err = _a11y._get_app(params.get("app"))
    if err:
        return {"error": err}, 404
    target = {"title": (params.get("title") or "").lower(),
              "role": params.get("role", ""),
              "index": params.get("index", 0)}
    state = {"count": 0, "mi": -1}
    result = _search_press(app, 0, target, state)
    if result:
        return result, 200
    return {"error": "element not found", "searched": state["count"]}, 404
