-- Hammerspoon config for Relaygent computer-use
-- HTTP API on configurable port for screen capture, accessibility tree, and input

local f = io.open("/tmp/hs_init_ran", "w"); if f then f:write(os.date()); f:close() end

hs.allowAppleScript(true)
hs.autoLaunch(true)
hs.consoleOnTop(false)
hs.openConsoleOnDockClick(false)
pcall(function() hs.console.hswindow():close() end)
local json = hs.json
local PORT = tonumber(os.getenv("HAMMERSPOON_PORT")) or 8097
local MEM_LIMIT_MB = tonumber(os.getenv("HAMMERSPOON_MEM_LIMIT_MB")) or 500
local input = dofile(hs.configdir .. "/input_handlers.lua")
local held = dofile(hs.configdir .. "/held_input.lua")
local ax_handler = dofile(hs.configdir .. "/ax_handler.lua")
local ax_press = dofile(hs.configdir .. "/ax_press.lua")
local window_manage = dofile(hs.configdir .. "/window_manage.lua")
local dismiss_dialog = dofile(hs.configdir .. "/dismiss_dialog.lua")
local drag = dofile(hs.configdir .. "/drag_handler.lua")
local screenshot = dofile(hs.configdir .. "/screenshot_handler.lua")

-- Get Hammerspoon RSS in MB (returns nil on error)
local function getRSSMB()
    local pid = hs.processInfo.processID
    local h = io.popen(string.format("ps -o rss= -p %d 2>/dev/null", pid))
    if not h then return nil end
    local out = h:read("*a"); h:close()
    local kb = tonumber(out)
    return kb and math.floor(kb / 1024) or nil
end

-- Memory watchdog: check RSS every 60s, reload if over limit
_G.__claude_mem_watchdog = hs.timer.doEvery(60, function()
    local mb = getRSSMB()
    if mb and mb > MEM_LIMIT_MB then
        hs.printf("Memory watchdog: RSS %dMB exceeds %dMB limit — reloading", mb, MEM_LIMIT_MB)
        hs.reload()
    end
end)

local function handleRequest(method, path, headers, body)
    local params = {}
    if body and #body > 0 then
        local ok, p = pcall(json.decode, body)
        if ok then params = p end
    end
    local key = method .. " " .. path
    local ok, rb, code = pcall(function()
        if key == "GET /health" then
            return json.encode({status="ok", screens=#hs.screen.allScreens(), rss_mb=getRSSMB()}), 200
        elseif key == "POST /reload" then
            hs.timer.doAfter(0.1, hs.reload)
            return json.encode({status="reloading"}), 200
        elseif key == "POST /screenshot" then
            return screenshot(params)
        elseif key == "POST /click" then
            return input.click(params)
        elseif key == "POST /type" then
            return input.type_input(params)
        elseif key == "POST /drag" then
            return drag.drag(params)
        elseif key == "POST /scroll" then
            return input.scroll(params)
        elseif key == "POST /key_down" then return held.key_down(params)
        elseif key == "POST /key_up" then return held.key_up(params)
        elseif key == "POST /mouse_down" then return held.mouse_down(params)
        elseif key == "POST /mouse_up" then return held.mouse_up(params)
        elseif key == "POST /mouse_move" then return held.mouse_move(params)
        elseif key == "POST /release_all" then return held.release_all(params)
        elseif key == "POST /input_sequence" then return held.input_sequence(params)
        elseif key == "GET /windows" then
            local wins = {}
            for _, w in ipairs(hs.window.allWindows()) do
                local wf = w:frame(); local a = w:application()
                table.insert(wins, {id=w:id(), title=w:title(), app=a and a:name() or "?",
                    frame={x=wf.x,y=wf.y,w=wf.w,h=wf.h}, focused=(w==hs.window.focusedWindow())})
            end
            return json.encode({windows=wins}), 200
        elseif key == "GET /apps" then
            local apps = {}
            for _, a in ipairs(hs.application.runningApplications()) do
                if a:mainWindow() then
                    table.insert(apps, {name=a:name(), bundleID=a:bundleID(), pid=a:pid()})
                end
            end
            return json.encode({apps=apps}), 200
        elseif key == "POST /focus" then
            if not params.app then return json.encode({error="app required"}), 400 end
            local a = hs.application.find(params.app)
            if a then a:activate(); return json.encode({focused=params.app}), 200 end
            return json.encode({error="not found"}), 404
        elseif key == "POST /launch" then
            if not params.app then return json.encode({error="app required"}), 400 end
            hs.application.launchOrFocus(params.app)
            local function tryFocus() local a = hs.application.find(params.app); if a then a:activate(true) end end
            hs.timer.doAfter(0.3, tryFocus); hs.timer.doAfter(1.0, tryFocus)
            return json.encode({launched=params.app}), 200
        elseif key == "POST /window_manage" then return window_manage(params)
        elseif key == "POST /type_from_file" then
            return input.type_from_file(params)
        elseif key == "POST /element_at" then
            if not params.x or not params.y then return json.encode({error="x,y needed"}), 400 end
            local el = hs.axuielement.systemElementAtPosition(hs.geometry.point(params.x, params.y))
            if not el then return json.encode({error="no element"}), 404 end
            local fr = el:attributeValue("AXFrame")
            return json.encode({role=el:attributeValue("AXRole") or "",
                title=el:attributeValue("AXTitle") or "",
                value=tostring(el:attributeValue("AXValue") or ""),
                frame=fr and {x=math.floor(fr.x),y=math.floor(fr.y),
                    w=math.floor(fr.w),h=math.floor(fr.h)} or nil}), 200
        elseif key == "POST /accessibility" then
            return ax_handler(params)
        elseif key == "POST /ax_press" then
            return ax_press(params)
        elseif key == "GET /clipboard" then
            return json.encode({text=hs.pasteboard.getContents() or ""}), 200
        elseif key == "POST /clipboard" then
            if not params.text then return json.encode({error="text required"}), 400 end
            hs.pasteboard.setContents(params.text)
            return json.encode({ok=true, length=#params.text}), 200
        elseif key == "POST /dismiss_dialog" then return dismiss_dialog(params)
        end
        return json.encode({error="not found", path=path}), 404
    end)
    if ok then
        return rb, code, {["Content-Type"]="application/json"}
    else
        return json.encode({error=tostring(rb)}), 500, {["Content-Type"]="application/json"}
    end
end

_G.__claude_server = hs.httpserver.new(false, false)
_G.__claude_server:setPort(PORT)
_G.__claude_server:setInterface("localhost")
_G.__claude_server:setCallback(handleRequest)
_G.__claude_server:maxBodySize(1048576)
_G.__claude_server:start()
hs.printf("Relaygent computer-use API on localhost:%d", PORT)
