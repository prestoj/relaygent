-- Held input handlers: key_down, key_up, mouse_down, mouse_up, release_all
-- Enables sustained key/button holds for gaming and real-time input scenarios

local json = hs.json
local M = {}

-- Track held state for safety release
_G.__heldKeys = _G.__heldKeys or {}
_G.__heldMouseButtons = _G.__heldMouseButtons or {}

function M.key_down(params)
    if not params.key then return json.encode({error="key required"}), 400 end
    local k = params.keycode or params.key
    local mods = params.modifiers or {}
    if #mods > 0 then
        for _, m in ipairs(mods) do hs.eventtap.event.newKeyEvent(m, true):post() end
    end
    hs.eventtap.event.newKeyEvent(mods, k, true):post()
    local label = (#mods > 0 and table.concat(mods, "+") .. "+" or "") .. params.key
    _G.__heldKeys[label] = {key=k, mods=mods}
    return json.encode({held=label, total=0+#{next(_G.__heldKeys) and 1 or nil}}), 200
end

function M.key_up(params)
    if not params.key then return json.encode({error="key required"}), 400 end
    local k = params.keycode or params.key
    local mods = params.modifiers or {}
    hs.eventtap.event.newKeyEvent(mods, k, false):post()
    if #mods > 0 then
        for _, m in ipairs(mods) do hs.eventtap.event.newKeyEvent(m, false):post() end
    end
    local label = (#mods > 0 and table.concat(mods, "+") .. "+" or "") .. params.key
    _G.__heldKeys[label] = nil
    return json.encode({released=label}), 200
end

function M.mouse_down(params)
    local btn = params.button or 1
    local types = hs.eventtap.event.types
    local x = params.x or hs.mouse.absolutePosition().x
    local y = params.y or hs.mouse.absolutePosition().y
    local pt = hs.geometry.point(x, y)
    if params.x and params.y then hs.mouse.absolutePosition(pt) end
    local evType = (btn == 2) and types.rightMouseDown or types.leftMouseDown
    hs.eventtap.event.newMouseEvent(evType, pt):post()
    _G.__heldMouseButtons[btn] = {x=x, y=y}
    return json.encode({held="mouse" .. btn, x=x, y=y}), 200
end

function M.mouse_up(params)
    local btn = params.button or 1
    local types = hs.eventtap.event.types
    local x = params.x or hs.mouse.absolutePosition().x
    local y = params.y or hs.mouse.absolutePosition().y
    local pt = hs.geometry.point(x, y)
    local evType = (btn == 2) and types.rightMouseUp or types.leftMouseUp
    hs.eventtap.event.newMouseEvent(evType, pt):post()
    _G.__heldMouseButtons[btn] = nil
    return json.encode({released="mouse" .. btn, x=x, y=y}), 200
end

function M.release_all(_params)
    local released = {}
    for label, info in pairs(_G.__heldKeys) do
        hs.eventtap.event.newKeyEvent(info.mods, info.key, false):post()
        if info.mods then
            for _, m in ipairs(info.mods) do hs.eventtap.event.newKeyEvent(m, false):post() end
        end
        table.insert(released, label)
    end
    _G.__heldKeys = {}
    local types = hs.eventtap.event.types
    for btn, info in pairs(_G.__heldMouseButtons) do
        local pt = hs.geometry.point(info.x, info.y)
        local evType = (btn == 2) and types.rightMouseUp or types.leftMouseUp
        hs.eventtap.event.newMouseEvent(evType, pt):post()
        table.insert(released, "mouse" .. btn)
    end
    _G.__heldMouseButtons = {}
    return json.encode({released=released, count=#released}), 200
end

-- Execute a timed sequence of input actions in one call.
-- Each action: {action="key_down"|"key_up"|"key_press"|"release_all", key=..., delay=ms}
-- Delays are relative to start of sequence (not to previous action).
function M.input_sequence(params)
    local actions = params.actions
    if not actions or #actions == 0 then
        return json.encode({error="actions array required"}), 400
    end
    local function doAction(a)
        if a.action == "key_down" then M.key_down(a)
        elseif a.action == "key_up" then M.key_up(a)
        elseif a.action == "key_press" then
            M.key_down(a); M.key_up(a)
        elseif a.action == "mouse_down" then M.mouse_down(a)
        elseif a.action == "mouse_up" then M.mouse_up(a)
        elseif a.action == "release_all" then M.release_all({})
        end
    end
    local total_ms = 0
    for _, a in ipairs(actions) do
        local delay = (a.delay or 0) / 1000.0
        if delay > 0 then
            hs.timer.doAfter(delay, function() doAction(a) end)
        else
            doAction(a)
        end
        if (a.delay or 0) > total_ms then total_ms = a.delay end
    end
    return json.encode({queued=#actions, duration_ms=total_ms}), 200
end

return M
