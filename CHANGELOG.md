# Changes

## Unreleased

The first version.

### New

- `playSound("coin")`: fourteen ready-made game sounds (coin, jump, laser, shoot, explosion, hit, powerup, blip, click, zap, bounce, pop, win, lose), each with `{ volume, pitch, pan }`.
- `playNote("C4")`, `playNote(["C4", "E4", "G4"], 1, 0.5)`: notes and chords by name or number, with a length and a loudness.
- `playNotes("C4 E4 G4 - C5:2", 0.25, { repeat: true })`: a tune, kept in time by the sound engine itself.
- `makeSynth("bass")`, `makeSynth({ wave: "saw", cutoff: 1200 })`: nineteen ready-made synths and drums, and synths made from settings. Every setting is a plain property (`lead.cutoff = 800`), under a friendly name or the engine's own.
- Chords by name wherever a note is played: `lead.play("Cm7")`, `playNotes("Am F C G", 0.5)`, `chordNotes("Fmaj7")`.
- Arpeggios, the fast chords of a C64 tune, from one voice: `playArp("Cm7")`, `lead.arp("C4", "minor", 2, { speed: 50, order: "up-down" })`, and `startArp("Am")` for one that stays and changes chord with `chord.change("F")` without starting again.
- Step macros for chip sounds: `makeSynth("chip", { macro: [{ wave: "noise", pitch: 24 }, { wave: "square" }] })`, `lead.macro = [...]`. The chip drums, the chip bass and the sounds hit, shoot and powerup are made of them.
- A synth is something [controls.js](https://github.com/johnwylie70/controls.js) can be tied to as it is: `dial("cutoff", lead, "cutoff")`, `scope(lead)`, `meter(lead)`, `keyboard(lead)`. For your own drawing: `lead.samples()`, `lead.level()`, `lead.notes()`, and `soundOutput()` for all the sound.
- `lead.start("C4")` gives a note that stays, and can be slid, turned down and stopped.
- Effects in one word: `lead.echo`, `lead.reverb`, `lead.chorus`, `lead.distortion`, `lead.crush`, and `setEffects({ echoTime: 0.3 })` for the ones every synth shares.
- `loadSample("kick.wav")`: a recorded sound, played like any synth.
- `{ after }`, `{ at }` and `{ beat }` on everything that makes a sound, with `setTempo`, `beats` and `soundTime`. Sounds land on the exact sample.
- `setVolume`, `muteSound`, `unmuteSound`, `stopSound`.
- `playSong("tune.mod")` is there to be written for, and says that tracker songs are not ready yet.
- Every function in its Python spelling too (`play_sound`, `make_synth`).
- Mistakes said in plain words, with "Did you mean".
- Sound waits for the browser's first tap by itself, and says once that it is waiting.
- For apps: the functions write commands ([docs/commands.md](docs/commands.md)) that a `sound` option can take and a player elsewhere can play; the engine as bytes and the worklet from a Blob, for a page that may fetch nothing; an offline player that renders the same commands to samples or a WAV file, in a browser or in node; and a fallback for a browser with no audio worklet.
