-- Screenshot handler for Relaygent computer-use
local json = hs.json

local function annotateWithIndicator(img, ix, iy)
    local sz = img:size()
    local s = (hs.screen.mainScreen():currentMode() or {}).scale or 1
    ix = ix * s; iy = iy * s
    local r = 18 * s; local d = 3 * s
    local c = hs.canvas.new(hs.geometry.rect(0, 0, sz.w, sz.h))
    c:appendElements(
        {type="image", image=img, frame={x=0,y=0,w=sz.w,h=sz.h}},
        {type="oval", frame={x=ix-r, y=iy-r, w=r*2, h=r*2},
         strokeColor={red=1,green=0,blue=0,alpha=0.9}, strokeWidth=3*s, action="stroke"},
        {type="oval", frame={x=ix-d, y=iy-d, w=d*2, h=d*2},
         fillColor={red=1,green=0,blue=0,alpha=0.9}, action="fill"}
    )
    local result = c:imageFromCanvas()
    c:delete()
    return result
end

local function screenshot(params)
    local p = params.path or "/tmp/claude-screenshot.png"
    local scr = hs.screen.mainScreen()
    if not scr then return json.encode({error="no screen"}), 500 end
    local ix, iy = params.indicator_x, params.indicator_y
    if params.x and params.y and params.w and params.h then
        local img = scr:snapshot(hs.geometry.rect(params.x, params.y, params.w, params.h))
        if img and ix and iy then img = annotateWithIndicator(img, ix - params.x, iy - params.y) end
        local sz = img and img:size() or {w=params.w, h=params.h}
        if img then img:saveToFile(p) end
        img = nil; collectgarbage("collect")
        return json.encode({path=p, width=params.w, height=params.h,
            pixelWidth=sz.w, pixelHeight=sz.h, crop={x=params.x,y=params.y,w=params.w,h=params.h}}), 200
    end
    local img = scr:snapshot()
    if img and ix and iy then img = annotateWithIndicator(img, ix, iy) end
    if img then img:saveToFile(p) end
    local sf = scr:fullFrame()
    local sz = img and img:size() or sf
    img = nil; collectgarbage("collect")
    return json.encode({path=p, width=sf.w, height=sf.h,
        pixelWidth=sz.w, pixelHeight=sz.h}), 200
end

return screenshot
