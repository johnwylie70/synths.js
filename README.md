# synths.js

[![MIT licence](https://img.shields.io/badge/licence-MIT-green)](LICENSE)

synths.js is for making sounds and music in plain JavaScript, and for enjoying it: game sounds in one line, notes and tunes, synths you shape yourself, recorded samples and effects. It is for any age and any level. You type a line and hear something. It is the sound sibling of [pictures.js](https://github.com/johnwylie70/pictures.js), designed for projects made in [Circuitry Studio](https://www.circuitry.dev), and it runs anywhere a browser does. There is nothing else to install: no other library is needed.

Prefer Python? [synths](https://github.com/johnwylie70/synths-py) is the same library for Python. The sound engine itself is [synths-core](https://github.com/johnwylie70/synths-core).

## Start with four small programs

Each one is a whole program. [How to run one](#run-it) is just below.

**1. A sound.**

```js
import { playSound } from "./synths.js"

playSound("coin")
```

There are fourteen ready-made game sounds: `coin`, `jump`, `laser`, `shoot`, `explosion`, `hit`, `powerup`, `blip`, `click`, `zap`, `bounce`, `pop`, `win` and `lose`. In a game it is one line where the thing happens:

```js
if (star.touches(basket)) playSound("coin")
```

**2. A note, and a tune.**

```js
import { playNote, playNotes } from "./synths.js"

playNote("C4")                              // middle C, for half a second
playNotes("E4 G4 C5 - G4 C5:2", 0.25, { after: 1 })
```

A note is a letter and a number: `"C4"` is middle C, `"A4"` is the A above it, `"F#3"` is F sharp and `"Bb5"` is B flat. `playNotes` plays a tune a step at a time, here a step every quarter of a second: `-` is a rest and `:2` makes a note last two steps. `{ after: 1 }` starts it a second from now.

**3. A synth of your own.**

```js
import { makeSynth } from "./synths.js"

const lead = makeSynth({ wave: "saw", cutoff: 1200, attack: 0.01, release: 0.3 })

lead.play("E4", 0.5)                 // a note, for half a second
lead.play(["C4", "E4", "G4"], 1)     // three notes at once: a chord
lead.cutoff = 800                    // every setting is a plain property
lead.echo = 0.4
```

`wave` is the raw sound (`"sine"`, `"triangle"`, `"saw"`, `"square"`), `cutoff` is how bright it is, `attack` is how quickly a note begins and `release` is how long it takes to die away. Change the numbers and run it again. Or start from a ready-made synth: `makeSynth("bass")`.

**4. A beat that keeps going.**

```js
import { makeSynth } from "./synths.js"

makeSynth("kick").playNotes("C2 - - - C2 - - - ", 0.125, { repeat: true })
makeSynth("hat").playNotes("C4 C4", 0.125, { repeat: true, volume: 0.4 })
makeSynth("bass").playNotes("C2 - C2 C3 - C2 - Eb2", 0.125, { repeat: true })
```

`{ repeat: true }` plays a tune round and round. The parts stay together, however busy the page is, because the sound engine keeps the time and not your program.

These and more are in the [examples](examples) folder: open `examples/index.html` and press one.

## Run it

Put `synths.js`, `synths_core.wasm` and `synths-worklet.js` in a folder of your site (they are the whole library), and import what you use in a module script:

```html
<button id="go">Play</button>
<script type="module">
  import { playSound } from "./synths/synths.js"
  document.getElementById("go").onclick = () => playSound("powerup")
</script>
```

The page has to come from a web server (`npx serve`, or any other), because browsers do not let a page opened straight from disk import a module. (synths.js is not published to npm yet; when it is, `npm install synths.js` and `import { playSound } from "synths.js"` will do the same.)

### The first tap

Browsers keep a page silent until the person using it has clicked, tapped or pressed a key. synths.js takes care of it: the first touch turns the sound on. Until then a tune you started waits, and begins at that touch; a single note or sound effect from long before it is let go, because played late it would be wrong. The console says once that sound is waiting for a tap. So start your music whenever you like, and expect to hear it from the first click.

## Notes

A note is a name (`"C4"`, `"F#3"`, `"Bb5"`) or a number, where 60 is middle C and each whole number is one key of a piano (61 is C sharp, 72 is the C above). A number with a fraction is between two keys. `noteNumber("A4")` gives 69.

```js
playNote("C4")                       // half a second
playNote("C4", 2)                    // two seconds
playNote("C4", 2, 0.3)               // and quiet: loudness goes from 0 to 1
playNote(["C4", "E4", "G4"])         // a chord
playNote("Cm7")                      // a chord by name: C minor seventh
playNote("C4", { length: 2, volume: 0.3, pan: -1, after: 0.5 })   // the same things by name; pan -1 is left, 1 is right
```

### Chords by name

A chord is a note and a kind: `"C"`+`"m7"` is `"Cm7"`. The kinds are `major` (or `maj`), `minor` (or `m`), `dim`, `aug`, `sus2`, `sus4`, `5`, `6`, `m6`, `7`, `maj7`, `m7`, `dim7`, `m7b5`, `add9`, `9`, `maj9`, `m9` and `octave`. Wherever a note is played, a chord's name plays all its notes: `lead.play("Fmaj7", 1)`, `playNotes("Am F C G", 0.5)`. `chordNotes("Cm7")` gives the notes as numbers.

A letter followed by a number is always a note, so `"C7"` is the note C in octave 7. For the seventh chord write `"Cdom7"`. For a chord in another octave put the octave after the letter: `"C3m7"`.

## Tunes

```js
const tune = playNotes("C4 E4 G4 - C5:2 G4+B4+D5", 0.25, { repeat: true })
tune.stop()
```

The notes are text with spaces between, or a list: `["C4", null, ["C4", "E4"]]`, where `null` is a rest and a list inside is a chord. In text a chord is joined with `+`. The second thing is the seconds in a step; leave it out and a step is half a beat (see [When things start](#when-things-start)). Options: `repeat` (`true`, or how many times), `volume`, `hold` (how much of its step a note sounds for, 0.9 unless you say), and `after`, `at` or `beat`.

Every synth has `playNotes` too: `makeSynth("bass").playNotes("C2 C2 G2 C2", 0.25)`.

## Arpeggios

An arpeggio is a chord played one note at a time, very fast, on a single voice: the shimmering chords of a Commodore 64 tune, which had only three voices to spend.

```js
playArp("Cm7")                             // half a second of C minor seventh
playArp("C4", "minor", 2)                  // a note and a kind, for two seconds
playArp(["C4", "E4", "G4", "C5"], 1, { speed: 12, order: "up-down" })

const chord = startArp("Am")               // one that stays
chord.change("F")                          // another chord: the note carries on, it does not start again
chord.stop()
```

`speed` is steps a second: 50 unless you say, which is the speed chip music was written at; at 12 you can hear each step. `order` is `"up"`, `"down"`, `"up-down"`, `"as written"` or `"random"`. A chord has room for eight notes. Every synth has `arp` and `startArp` too (`lead.arp("Cm7")`); with no synth they play on a plain square wave. An arpeggio takes `volume`, `pan`, `after`, `at` and `beat` like any note, and `chord.change("F", { after: 2 })` changes it later.

## Synths

```js
const bass = makeSynth("bass")                       // a ready-made synth
const soft = makeSynth("lead", { cutoff: 900 })      // a ready-made one, changed
const mine = makeSynth({ wave: "square", attack: 0.2 })   // one from nothing
```

The ready-made synths: `keys` (what `playNote` uses), `bass`, `lead`, `pad`, `pluck`, `organ`, `strings`, `bell`, `flute`; the chip sounds `chip`, `chipLead`, `chipBass`, `chipNoise`, `chipKick`, `chipSnare` and `chipHat`; and the drums `kick`, `snare` and `hat`. All of them are settings of the same engine, not recordings, so every one can be changed.

What a synth does:

| | |
|---|---|
| `lead.play("E4", 0.5)` | a note for half a second. A list of notes is a chord. No note at all plays the synth's own (a drum's). |
| `lead.play("E4", 0.5, 0.8)`, `lead.play("E4", { length, volume, pan, after })` | how loud, where, when |
| `const note = lead.start("E4")` | a note that stays until `note.stop()`. While it sounds: `note.slideTo("G4", 0.5)`, `note.pitch = "A4"`, `note.volume = 0.5`, `note.pan = -1` |
| `lead.stop()`, `lead.stop("E4")` | let go of every note of the synth, or of one |
| `lead.playNotes("C4 E4 G4", 0.25)` | a tune on this synth |
| `lead.cutoff = 800` | change a setting; notes already sounding change too |
| `lead.set({ cutoff: 4000 }, { glide: 2 })` | change several, or slide there over two seconds |
| `lead.arp("Cm7")`, `lead.startArp("Am")` | a chord as an [arpeggio](#arpeggios) |
| `lead.macro = [...]` | a [step macro](#step-macros) |
| `lead.remove()` | finished with it |

### Settings

Every setting is a plain property, and reads back what you set: `lead.cutoff = 800`, `console.log(lead.cutoff)`.

| Setting | What it is |
|---|---|
| `wave` | the raw sound: `"sine"` (pure), `"triangle"` (soft), `"saw"` (bright), `"square"` (hollow), `"pulse"` (with `width`, 0.02 to 0.98) |
| `volume`, `pan` | how loud the synth is (1 is normal), and left (-1) to right (1) |
| `attack`, `decay`, `sustain`, `release` | the shape of a note's loudness: seconds to reach full, seconds to fall to the `sustain` level (0 to 1), which holds while the note lasts, and seconds to die away afterwards. A `sustain` of 0 makes a pluck or a drum |
| `cutoff`, `resonance` | the filter: `cutoff` is how bright (20 to 20000), `resonance` adds a whistle at the cutoff (0 to 1) |
| `filter` | `"lowpass"` (takes away the top; what `cutoff` does unless you say), `"highpass"`, `"bandpass"`, `"notch"`, `"off"` |
| `sweep`, `sweepAttack`, `sweepDecay`, `sweepSustain` | each note opens the filter by `sweep` semitones and lets it close again: the "wow" of a synth bass |
| `octave`, `pitch`, `tune` | move every note by octaves, by semitones, or by hundredths of a semitone |
| `glide` | seconds to slide from one note to the next |
| `mode` | `"poly"` (many notes at once), `"mono"` (one at a time), `"legato"` |
| `voices`, `detune`, `spread` | several copies of each note, a little out of tune and spread left to right: a thick sound |
| `wave2`, `level2`, `pitch2`, `detune2` | a second wave mixed in, at its own pitch |
| `sub`, `noise` | a wave an octave below, and hiss (each 0 to 1) |
| `vibrato`, `vibratoRate`, `vibratoDelay` | a wobble of pitch: how far (semitones), how fast, how long before it begins |
| `tremolo`, `wobble`, `wobbleRate` | a wobble of loudness, and of the filter |
| `pitchSweep`, `pitchSweepDecay` | each note begins that many semitones off and falls into place: a drum's thump, a laser |
| `echo`, `reverb`, `chorus` | how much of the synth goes to each effect (0 to 1) |
| `distortion`, `crush` | grit (0 to 1), and the bits each sample keeps (16 is clean, 4 is an old games console) |

There are more: `settingNames()` lists every one, and each also answers to the engine's own name for it, written any way you like (`filterCutoff`, `filter_cutoff`, `"filter.cutoff"`).

### Step macros

A macro is a short list of steps that every note of a synth plays through, 50 a second, each step changing the wave, the pitch, the pulse width, the cutoff or the volume. It is how a sound chip made a drum from one voice: a burst of noise, then a tone, then noise again.

```js
const snare = makeSynth("chip", { decay: 0.16, sustain: 0, macro: [
  { wave: "noise", pitch: 24 },            // noise, tuned high
  { wave: "square" },                      // then the note itself
  { pitch: -5, volume: 0.9 },              // five semitones lower
  { wave: "noise", pitch: 18, volume: 0.6 },
] })
snare.play("A3")
```

A step is `{ wave, pitch, width, cutoff, volume }` with any of them left out: `wave` is `"sine"`, `"triangle"`, `"saw"`, `"pulse"`, `"square"` or `"noise"`; `pitch` and `cutoff` are semitones from the note; `width` is the pulse width; `volume` is 0 to 1. The last step holds. For more, give `{ steps: [...], loop: true }` (the steps go round while the note is held; `loop: [2, 6]` for some of them), `slide: true` (width, cutoff and volume move smoothly between steps) and `release: 4` (the step to jump to when the note is let go). The setting `macroRate` is the steps a second. `lead.macro = null` takes a macro away. `chipKick`, `chipSnare`, `chipHat` and `chipBass` are made this way.

## Dials, keyboards and scopes

Every synth can be tied to the controls of [dials.js](https://github.com/johnwylie70/dials.js), with nothing in between:

```js
const lead = makeSynth("lead")

dial("cutoff", lead, "cutoff")       // the dial takes its range from the synth, and turning it sets it
scope(lead)                          // the wave it is making
meter(lead)                          // how loud it is
keyboard(lead)                       // piano keys that play it, and light up as it plays
```

[`examples/synth_panel.js`](examples/synth_panel.js) is a whole one. What the controls use is there for your own drawing too: `lead.samples()` is the wave the synth is making now (numbers from -1 to 1), `lead.level()` is how loud it is (`[left, right]`, 0 to 1) and `lead.notes()` is the notes it is sounding. `lead.noteOn("C4")` and `lead.noteOff("C4")` press and let go of a key; `lead.set("cutoff", 800)`, `lead.get("cutoff")` and `lead.describe("cutoff")` (its range, unit and kind) work by name. `soundOutput()` has the same for all the sound together, and `mainSynth()` is the synth that `playNote` plays.

## Effects

A synth sends some of its sound to an effect with one word: `lead.echo = 0.4`, `lead.reverb = 0.3`, `lead.chorus = 0.5`. `distortion` and `crush` belong to the synth alone. The echo, the reverb and the chorus are shared by every synth, and are shaped with `setEffects`:

```js
setEffects({ echoTime: 0.3, echoFeedback: 0.5, echoBounce: true, reverbSize: 0.8 })
```

| | |
|---|---|
| `echoTime`, `echoFeedback`, `echoTone`, `echoBounce` | seconds between echoes, how much each feeds the next (0 to 0.95), how much treble survives, and whether they bounce left and right |
| `reverbSize`, `reverbDamping` | how big the room is, and how soon its treble dies |
| `chorusRate`, `chorusDepth` | how fast and how far the chorus wobbles |

## Samples

A sample is a recorded sound in a file beside your page: a `.wav`, or anything else your browser can read (`.mp3`, `.ogg`).

```js
const kick = loadSample("kick.wav")
kick.play()                       // as it was recorded
kick.play("E4")                   // higher: a sample is a synth, and "C4" is its own pitch
kick.reverb = 0.3

const hum = loadSample("hum.wav", { loop: true, note: "A3" })   // goes round for as long as a note lasts; A3 is the note it was recorded at
hum.play("E4", 2)
```

There is nothing to wait for: play it straight away, and it sounds as soon as the file has arrived.

## When things start

Everything that makes a sound takes one of these:

```js
playSound("coin", { after: 0.5 })          // half a second from now
playNote("C4", 1, { at: soundTime() + 2 }) // at a time on the sound clock, which soundTime() reads
lead.play("E4", beats(1), { beat: 8 })     // on beat 8
```

Beats are counted from `setTempo(120)` (beats a minute; beat 0 is the moment you call it). `beats(2)` is how many seconds two beats last, and `beat()` is which beat it is now.

Sounds are placed on the exact sample they were asked for. That is why a tune you schedule with `{ after }` or `{ beat }`, or play with `playNotes`, stays in time even when your program is busy drawing. Everything is played 0.04 seconds after it is asked for, so that this works; you will not notice it.

## Volume, mute and stop

```js
setVolume(0.5)      // everything half as loud. 1 is normal
muteSound()         // silence, and unmuteSound() to bring it back
stopSound()         // stop everything that is sounding or waiting to sound
```

## Songs

A song is a whole piece of music in one file, played by the sound engine itself: a tracker's `.mod` or `.xm` file, or a song in synths' own format, which is text you can read and change.

```js
const song = playSong("tune.mod")          // it goes round and round until it is stopped

song.pause()
song.resume()
song.volume = 0.5
song.seek(2)                               // jump to the third part of the song (and seek(2, 16): its row 16)
song.stop()
```

`playSong("tune.xm", { repeat: false })` plays it once, and `{ volume: 0.6 }` starts it quieter. One song plays at a time, and your own notes and game sounds play over it. `song.position` says where it is, for drawing: `{ state, order, pattern, row, tick, speed, tempo, rows, orders }`, where `state` is `"playing"`, `"paused"`, `"stopped"` or `"none"`.

In a song of synths' own, an instrument can be a synth instead of a recording, called by a name. A name that is a ready-made synth's (`"bass"`, `"chipKick"`) plays as that; any other name is told what it is:

```js
playSong("songs/night_drive.json", { patches: { tune: "bell", wobble: { preset: "bass", cutoff: 300, wobble: 12 } } })
```

A `.mod` or `.xm` sounds as its tracker made it sound, rough edges included; `{ raw: false }` smooths the samples and `{ raw: true }` leaves any song rough. `await packSong(bytes)` turns a song file of any kind into the engine's small packed form, which `playSong` plays (an editor keeps that after importing a module).

[`examples/songs/night_drive.json`](examples/songs/night_drive.json) is a short song written this way, and the format is described in [synths-core](https://github.com/johnwylie70/synths-core/blob/main/docs/song-format.md).

## With pictures.js

Until sound is built into pictures.js, a scene fetches the sound functions in its first line and then uses them like the drawing ones:

```js
const { playSound, playNotes } = await use("synths/synths.js")

function update(dt) {
  if (star.touches(basket)) playSound("coin")
}
```

[`examples/catch_game.js`](examples/catch_game.js) is a whole game written this way.

## The Python spellings

Every function has its Python spelling too, so a program comes across from one language to the other with little more than its syntax changed: `play_sound`, `play_note`, `play_notes`, `play_arp`, `start_arp`, `make_synth`, `load_sample`, `play_song`, `stop_sound`, `set_volume`, `mute_sound`, `set_effects`, `set_tempo`, `sound_time`. Settings too: `lead.vibrato_rate = 6`.

## Mistakes

A mistake is said in plain words, with what was probably meant:

```
playSound("lazer"): there is no sound called "lazer". Did you mean "laser"? The sounds are: coin, jump, laser, …
makeSynth(): there is no setting called "cutof". Did you mean "cutoff"?
"H4" is not a note. Write a note as a name like "C4", "F#3" or "Bb5", or as a number, where 60 is middle C
```

Things that are not your mistake do not stop your program. They are said once in the console and the rest carries on: sound that is waiting for a tap, a sample whose file is missing, more synths than there is room for (32 at once; `remove()` gives a place back), more notes than there are voices (64; the oldest note makes way).

## For apps that show scenes

synths.js is built in three layers so that the sound can be made somewhere other than where the program runs: in another frame, from a worker, or from Python.

1. **The functions only write commands**: plain data such as `{ op: "note", id: "s1", note: [60], len: 0.5, t: 12.25 }`, with every id chosen by the sender, so no call waits for an answer.
2. **A transport** carries them, a batch at a time.
3. **A player** owns the sound card and the engine, and carries the commands out.

[docs/commands.md](docs/commands.md) is the command format, written as the contract for another language or another player.

```js
import { createSound, createPlayer, createOfflinePlayer, renderSound } from "./synths.js"

// A scene's functions, with the commands sent to you instead of played here.
const sound = createSound({ sound: { send(batch) { port.postMessage(batch) } } })
sound.playSound("coin")

// Somewhere that may make sound: a player for those batches.
const player = createPlayer()
port.onmessage = (m) => player.send(m.data)
```

- **`sound`** is shaped like pictures.js's `storage` option: an object with `send(batch)`. Without it the library plays on the page itself. `configure({ sound })` does the same for the plain functions.
- **No network needed.** `createPlayer({ wasm: bytes })` takes the engine as bytes, and the worklet's module is made from text inside `synths.js` (a Blob), so a page that may fetch nothing still has sound. `worklet: "file"` loads `synths-worklet.js` instead, for a page whose policy refuses Blobs; `"auto"`, the default, tries the Blob and then the file.
- **The engine runs on the audio thread**, in an AudioWorklet. Where there is none (a page not served over https or from localhost has none), the same engine runs on the page's thread through a ScriptProcessorNode: the same sound, which may crackle when the page is busy. The console says so once. `fallback: false` refuses it.
- **Offline.** `createOfflinePlayer()` is the same player with no sound card: send it the same batches and `render(seconds)` gives the samples, and `wav()` a WAV file. It works in node too. `renderSound((s) => { s.playNote("C4") }, { seconds: 1 })` does it in one line. This is how a recorded video gets its soundtrack, and how the tests listen.
- **Reading back.** `player.read(id)` gives what a synth is doing now, `{ samples, level, notes }` (no id: all the sound), for scopes, meters and lit keys. It never waits: the audio thread posts it about 40 times a second while something is reading. A `sound` transport may have a `read(id)` of its own, and a synth's `samples()`, `level()` and `notes()` use it.
- **Several scenes on a page** share one player and one sound card without being told to: every `createSound()` that is not given a `sound` joins it, in a scope of its own, so each still stops, mutes and pauses alone.
- **Pausing.** `sound.pause()` and `sound.resume()` on what `createSound` gave, for a scene that is paused or out of view, and `sound.close()` when it is over. (`player.pause()` silences everyone who shares the player.) `player.state` is `"loading"`, `"waiting"` (for a tap), `"on"` or `"failed"`.

## Tests

```bash
node scripts/test-node.mjs
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/test-browser.mjs
```

The first needs only node: it renders commands with the real engine and measures the sound. The second drives Chromium and WebKit with [Playwright](https://playwright.dev) and listens to what the audio worklet puts out.

The engine is built in [synths-core](https://github.com/johnwylie70/synths-core) and copied here by `node scripts/sync-engine.mjs`, which also writes the files made from it. The built engine is part of this repository, so nothing here needs Rust.

## Licence

MIT. See [LICENSE](LICENSE). The engine, `synths_core.wasm`, is synths-core, by the same author under the same licence.
