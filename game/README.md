# Web Shooter

Open `game/index.html` in a modern browser. Press **Start**, then **Go**. Move the mouse to aim; left-click or Space fires. Escape pauses, C recentres aim, and the Controller settings provide wrist axes, inversion, sensitivity, and a visible Center Aim action.

The arena is fixed: `bavkghround.webp` is cover-cropped at a 72% vertical focal point. The villain sprite grows rapidly as it approaches and makes a sudden, screen-filling lunge at contact; the background and camera stay still. Green Goblin (100 HP / 8 s), Rhino (140 HP / 6.5 s), and Venom (180 HP / 5.5 s) must be defeated before they reach the player. Reaching the player causes an immediate loss. Only the villain has a health bar. Each highlighted weak-spot hit deals 20 damage. The outside menu uses `assets/menu-background.png`.

## Tests

From the repository root:

```sh
node --test game/tests/*.test.cjs
```

## Wrist controller

Flash `web_shooter/web_shooter.ino` to the ESP32. Wire **SDA to GPIO33** and **SCL to GPIO22**. Keep the sensor still during calibration, open Settings, select Wrist, choose axes/inversion, Center Aim, then sweep and flick. Disconnecting it keeps mouse aiming available. See `../web_shooter/BUILD.md` for the physical checklist.
