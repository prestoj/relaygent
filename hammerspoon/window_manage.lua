-- Window management handler: maximize, minimize, restore, resize, move, fullscreen
local json = hs.json

return function(params)
    local action = params.action
    if not action then return json.encode({error="action required"}), 400 end

    -- Find target window by app name or use focused window
    local win
    if params.app then
        local app = hs.application.find(params.app)
        if not app then return json.encode({error="app not found: " .. params.app}), 404 end
        win = app:mainWindow()
    else
        win = hs.window.focusedWindow()
    end
    if not win then return json.encode({error="no window found"}), 404 end

    local appName = win:application() and win:application():name() or "?"
    local f = win:frame()

    if action == "maximize" then
        win:maximize()
        f = win:frame()
        return json.encode({ok=true, action="maximize", app=appName,
            frame={x=f.x,y=f.y,w=f.w,h=f.h}}), 200
    elseif action == "minimize" then
        win:minimize()
        return json.encode({ok=true, action="minimize", app=appName}), 200
    elseif action == "restore" then
        win:unminimize()
        f = win:frame()
        return json.encode({ok=true, action="restore", app=appName,
            frame={x=f.x,y=f.y,w=f.w,h=f.h}}), 200
    elseif action == "resize" then
        if not params.w or not params.h then
            return json.encode({error="w and h required for resize"}), 400
        end
        f.w = params.w; f.h = params.h
        win:setFrame(f)
        f = win:frame()
        return json.encode({ok=true, action="resize", app=appName,
            frame={x=f.x,y=f.y,w=f.w,h=f.h}}), 200
    elseif action == "move" then
        if not params.x or not params.y then
            return json.encode({error="x and y required for move"}), 400
        end
        f.x = params.x; f.y = params.y
        win:setFrame(f)
        f = win:frame()
        return json.encode({ok=true, action="move", app=appName,
            frame={x=f.x,y=f.y,w=f.w,h=f.h}}), 200
    elseif action == "fullscreen" then
        win:setFullScreen(not win:isFullScreen())
        return json.encode({ok=true, action="fullscreen", app=appName,
            fullscreen=win:isFullScreen()}), 200
    else
        return json.encode({error="unknown action: " .. action}), 400
    end
end
