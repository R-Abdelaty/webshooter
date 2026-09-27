# Web Shooter

A Spider-Man-inspired first-person web shooter, played with the mouse or with an ESP32 wrist shooter: you look and aim by turning your wrist, and fire a web by flicking it. The browser game is in [`game/`](game/), and the controller firmware is in [`web_shooter/`](web_shooter/).

**START** puts you on a rooftop in a 3D city with traffic and people in the streets. You fight three villains there, each an animated 3D model, all at one HARD level and with no clock - a fight ends when he goes down or you do: the Green Goblin hunting you across the rooftops on his glider with pumpkin bombs and glider guns, the Rhino charging along an avenue below, and Venom leaping through a construction site's steel frame. A cyan HUD shows your health and the villain's, and the objective, with a minimap that turns with you. **TRAINING** is target practice on a rooftop, and **CLASSIC** is the original fixed-screen 2D weak-spot game.

Open `game/index.html` in a modern browser to play (straight from disk is fine; nothing is downloaded). See [game/README.md](game/README.md) for the controls, the fights and the settings, and [web_shooter/BUILD.md](web_shooter/BUILD.md) for wiring and flashing the shooter. The plans behind the 3D game are in [docs/3D_PLAN.md](docs/3D_PLAN.md) and [docs/CHARACTERS_PLAN.md](docs/CHARACTERS_PLAN.md).

Run the automated tests from the project root with:

```sh
node --test game/tests/*.test.cjs
```

The character models are game rips kept for personal use; don't publish or redistribute them (see `docs/CHARACTERS_PLAN.md`).
