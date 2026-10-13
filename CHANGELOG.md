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
- A synth is something [dials.js](https://github.com/johnwylie70/dials.js) can be tied to as it is: `dial("cutoff", lead, "cutoff")`, `scope(lead)`, `meter(lead)`, `keyboard(lead)`. For your own drawing: `lead.samples()`, `lead.level()`, `lead.notes()`, and `soundOutput()` for all the sound.
- Note lengths by name, measured against `setTempo`: `playNote("C4", "quarter")`, `"eighth."`, `"1/16"`, `playSound("win", { length: "half" })`. A number is still seconds.
- A tune as ordinary code, one note a line, each beginning where the last ended: `note("E4", "quarter")`, `rest("eighth")`, `chord("Cm", "whole")`, on any synth (`lead.note`), lines written together start together, `loopNotes(() => { … })` has a section go round, `startLines()` begins again.
- In `playNotes`, lengths on notes (`"C4:q E4:e G4:h"`) and a step by name (`"eighth"`); a tune in beats changes speed when `setTempo` is called.
- `lead.start("C4")` gives a note that stays, and can be slid, turned down and stopped.
- Effects in one word: `lead.echo`, `lead.reverb`, `lead.chorus`, `lead.distortion`, `lead.crush`, and `setEffects({ echoTime: 0.3 })` for the ones every synth shares.
- `loadSample("kick.wav")`: a recorded sound, played like any synth.
- `{ after }`, `{ at }` and `{ beat }` on everything that makes a sound, with `setTempo`, `beats` and `soundTime`. Sounds land on the exact sample.
- `setVolume`, `muteSound`, `unmuteSound`, `stopSound`.
- `playSong("tune.mod")`: tracker songs (`.mod`, `.xm`) and songs in synths' own readable format, played by the engine itself, with `pause`, `resume`, `seek`, `volume`, `stop` and `position`, and `{ patches }` to say what a song's named synths are.
- Several scenes on one page share one sound card: each `createSound()` stops, mutes and pauses alone.
- MIDI. `lead.playFromMidi()`: a MIDI keyboard plays a synth, with how hard each key is hit, the pitch and modulation wheels and the sustain pedal. `onMidiNote`, `onMidiNoteOff`, `onMidiControl` and `onMidi` call your functions with what arrives. `sendMidiNote("C4", 0.8, { length: 0.5, channel: 1 })`, `sendMidiControl`, `sendMidiBend`, `sendMidiProgram` and `sendMidi(bytes)` send, at the exact time `{ after, at, beat }` asks for; `lead.sendToMidi()` sends what a synth plays; `sendMidiClock()` sends the beat. `lead.learn("cutoff")` and `lead.mapMidi(74, "cutoff")` tie a knob to a setting through the setting's own range. `midiDevices`, `onMidiDevices`, `useMidiInput`, `useMidiOutput`, `stopMidi`. It is in a file of its own, `synths-midi.js`, fetched only when MIDI is used, which is also when the browser asks its permission. Where a browser has no MIDI (Safari, iPhones, iPads) everything still runs and the console says so once.
- For apps, MIDI travels as the sound does: a `midi` command in the same batches ([docs/midi.md](docs/midi.md)), carried out beside the player, with what is received handed back as plain data (`player.onMidi`, `sound.receiveMidi`, `sound.useMidiHooks(scene)`), and a `midi` option for an app that reaches the devices its own way.
- Every function in its Python spelling too (`play_sound`, `make_synth`).
- Mistakes said in plain words, with "Did you mean".
- Sound waits for the browser's first tap by itself, and says once that it is waiting.
- For apps: the functions write commands ([docs/commands.md](docs/commands.md)) that a `sound` option can take and a player elsewhere can play; the engine as bytes and the worklet from a Blob, for a page that may fetch nothing; an offline player that renders the same commands to samples or a WAV file, in a browser or in node; and a fallback for a browser with no audio worklet.
