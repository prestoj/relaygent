-- Dismiss macOS dialogs (TCC, Chrome permission prompts, system alerts)
-- Searches known dialog-hosting apps for a button matching the target text.

local json = hs.json
local DIALOG_APPS = {"UserNotificationCenter","SecurityAgent","System Preferences","System Settings","Google Chrome"}

local function findBtn(el, target, depth)
    if not el or depth > 6 then return false end
    for _, c in ipairs(el:attributeValue("AXChildren") or {}) do
        local role = c:attributeValue("AXRole") or ""
        local title = c:attributeValue("AXTitle") or ""
        if role == "AXButton" and title == target then
            c:performAction("AXPress"); return true
        end
        if findBtn(c, target, depth + 1) then return true end
    end
    return false
end

return function(params)
    local target = params.button or "Don't Allow"
    for _, appName in ipairs(DIALOG_APPS) do
        local app = hs.application.find(appName)
        if app then
            local elem = hs.axuielement.applicationElement(app)
            for _, w in ipairs(elem:attributeValue("AXChildren") or {}) do
                if w:attributeValue("AXRole") == "AXWindow" and findBtn(w, target, 0) then
                    return json.encode({dismissed=true, app=appName, button=target}), 200
                end
            end
        end
    end
    return json.encode({dismissed=false, error="no dialog found"}), 404
end
