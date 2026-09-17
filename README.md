# Web Shooter

A fixed-screen Spider-Man-inspired weak-spot shooter with mouse or ESP32 wrist controls. The browser game is in [`game/`](game/), and the controller firmware is in [`web_shooter/`](web_shooter/).

Open `game/index.html` in a modern browser to play. See [game/README.md](game/README.md) for controls and [web_shooter/BUILD.md](web_shooter/BUILD.md) for wiring and flashing instructions.

Run the automated tests from the project root with:

```sh
node --test game/tests/*.test.cjs
```
