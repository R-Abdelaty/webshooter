# assets

Both files here are **optional** — the menu runs without either of them.

## `theme.mp3` — background music

The menu ships with an original heroic theme that the browser synthesises live
(see `js/audio.js`). No file, no download, no wait.

To use your own music instead, drop an audio file here named exactly:

```
theme.mp3
```

`menu.js` checks for it on startup. If it loads, it plays on loop and the synth
never starts; if it is missing, the synth takes over. The settings panel tells
you which one you are hearing.

Any format your browser plays works — rename a `.m4a` or `.ogg` to `.mp3` and it
will still play, since browsers sniff the actual contents rather than trusting
the extension.

**A note on which file you use:** the real Spider-Man theme is copyrighted, so
it is not included here and cannot be generated. Anything you own or that is
licensed for reuse is fine to drop in for your own private build — just do not
ship it publicly. Good sources for free, licence-clear heroic music: the
Free Music Archive, Incompetech, or Pixabay Music.

## `web-bg.png` — background artwork

By default the spider web is drawn as SVG at runtime, which keeps it sharp at
any resolution and lets the same code stamp small webs when your wrist unit
fires.

To use a picture instead, drop it here named exactly:

```
web-bg.png
```

It is stretched to cover the viewport (`object-fit: cover`), so use something
roughly 16:9 and at least 1600px wide. If the file is missing the drawn web is
used automatically — that is what the "probe" image in `js/web-bg.js` is doing.
