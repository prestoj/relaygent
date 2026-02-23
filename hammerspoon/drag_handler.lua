-- Drag handler for click-drag operations
local json = hs.json
local M = {}

function M.drag(params)
    if not params.startX or not params.startY or not params.endX or not params.endY then
        return json.encode({error="startX, startY, endX, endY required"}), 400
    end
    local types = hs.eventtap.event.types
    local sx, sy = params.startX, params.startY
    local ex, ey = params.endX, params.endY
    local steps = params.steps or 10
    local duration = params.duration or 0.3
    local stepDelay = duration / steps
    hs.mouse.absolutePosition(hs.geometry.point(sx, sy))
    hs.timer.doAfter(0.05, function()
        hs.eventtap.event.newMouseEvent(types.leftMouseDown, hs.geometry.point(sx, sy)):post()
        local function doStep(i)
            local t = i / steps
            local cx = sx + (ex - sx) * t
            local cy = sy + (ey - sy) * t
            hs.mouse.absolutePosition(hs.geometry.point(cx, cy))
            hs.eventtap.event.newMouseEvent(types.leftMouseDragged, hs.geometry.point(cx, cy)):post()
            if i < steps then
                hs.timer.doAfter(stepDelay, function() doStep(i + 1) end)
            else
                hs.timer.doAfter(0.02, function()
                    hs.eventtap.event.newMouseEvent(types.leftMouseUp, hs.geometry.point(ex, ey)):post()
                end)
            end
        end
        hs.timer.doAfter(stepDelay, function() doStep(1) end)
    end)
    return json.encode({dragged={from={x=sx,y=sy}, to={x=ex,y=ey}, steps=steps}}), 200
end

return M
