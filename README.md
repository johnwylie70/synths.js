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

Put `synths.js`, `synths_core.wasm`, `synths-worklet.js` and `synths-midi.js` in a folder of your site (they are the whole library; the last is fetched only by a program that uses MIDI), and import what you use in a module script:

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

## Lengths

Wherever a length is wanted there are two ways to say it, and they are never mixed up:

- **A number is seconds.** `playNote("C4", 0.5)` lasts half a second, whatever the tempo.
- **A name is a note length**, measured against the tempo: `playNote("C4", "quarter")`. At `setTempo(120)` a quarter note is half a second; at 60 it is a whole one.

| | | |
|---|---|---|
| `"whole"` | `"1/1"`, `"w"` | 4 beats |
| `"half"` | `"1/2"`, `"h"` | 2 beats |
| `"quarter"` | `"1/4"`, `"q"` | 1 beat |
| `"eighth"` | `"1/8"`, `"e"` | half a beat |
| `"sixteenth"` | `"1/16"`, `"s"` | a quarter of a beat |

A dot makes one half as long again (`"quarter."`, `"q."`), and a triplet fits three where two were (`"eighth triplet"`, `"e3"`). Names work for the length of a note, a chord, an arpeggio or a sound (`playSound("win", { length: "half" })` cuts a sound short there, or holds its last note until then), for the step of a tune, and for `{ after: "half" }`. `setTempo(140)` sets the beats in a minute (120 until you say), and `beats(3)` is how many seconds three beats last.

## A tune, one note a line

`playNote` plays a note **now**. `note` plays the **next** note of a tune: each one begins where the one before it ended, so a tune is written as ordinary lines of code, with loops and ifs, and no arithmetic.

```js
setTempo(100)

note("E4", "quarter")
note("G4", "quarter")
rest("quarter")
note("C5", "half")
chord("Cm", "whole")

for (const name of ["C4", "D4", "E4"]) note(name, "eighth")
```

The same tune as text, for comparison: `playNotes("E4:q G4:q -:q C5:h Cm:w C4:e D4:e E4:e")`.

In a line, a length is a name, or a number of **beats** (`note("C4", 2)` is a half note); with nothing said it is a quarter. `note`, `chord` and `rest` write on the synth `playNote` uses, and every synth has its own line: `lead.note("C4", "eighth")`.

- **Two lines together.** Lines written in the same go begin together, however much code is between them: write the whole melody, then the whole bass, and they start on the same instant.

  ```js
  for (const n of ["E4", "G4", "C5", "G4"]) lead.note(n, "quarter")
  bass.note("C2", "half")
  bass.note("G2", "half")
  ```

- **A section that repeats.** A `for` loop writes a section several times. `loopNotes` has it go round for ever, kept in time by the sound engine, and it follows `setTempo` as it plays:

  ```js
  const beat = loopNotes(() => {
    kick.note("C3", "quarter")
    snare.note("A3", "quarter")
  })
  beat.stop()
  ```

  `loopNotes(4, () => { … })` goes round four times, and the lines carry on after it.

- **Starting over.** A line carries on from where it ended; if it ended a while ago, the next note begins now. `startLines()` begins every line again from now, `startLines({ after: "whole" })` a bar from now, and `lead.startLine()` begins one.

Everything a line plays is placed on its exact sample when it is written, so a tune written this way keeps time however busy the page is. [`examples/melody.js`](examples/melody.js) is a whole one.

## Tunes

```js
const tune = playNotes("C4 E4 G4 - C5:2 G4+B4+D5", 0.25, { repeat: true })
tune.stop()
```

The notes are text with spaces between, or a list: `["C4", null, ["C4", "E4"]]`, where `null` is a rest and a list inside is a chord. In text a chord is joined with `+`, or named (`Am`). The second thing is how long a step is: a number is seconds, a name is a note length (`playNotes("C4 E4 G4", "eighth")`), and with nothing said it is an eighth. After a colon a note says how long it is itself: `:2` is two steps, and `:q`, `:h`, `:e`, `:s`, `:w` (or `:quarter`, `:1/4`) are note lengths, as in `"C4:q E4:e G4:e C5:h"`. A tune whose step is a name or left out is in beats: it changes speed when `setTempo` is called, even while it repeats. A tune whose step is seconds does not. Options: `repeat` (`true`, or how many times), `volume`, `hold` (how much of its step a note sounds for, 0.9 unless you say), and `after`, `at` or `beat`.

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
| `lead.set({ cutoff: 4000 }, { glide: 2 })` | change several, or slide there over two seconds. The word is `glide` in JavaScript and in Python (`slide` is understood too) |
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
| `pwm`, `pwmRate` | the pulse wave's width moving in and out (0 to 1: how far) and how fast, in Hz: the thick, shifting sound of a `"pulse"` or `"square"` wave. It does nothing to the other waves. `pwmRate` and `wobbleRate` are one speed under two names: the slow wobbler does both, and `autopan` too, so the vibrato keeps its own speed |
| `pitchSweep`, `pitchSweepDecay` | each note begins that many semitones off and falls into place: a drum's thump, a laser |
| `echo`, `reverb`, `chorus` | how much of the synth goes to each effect (0 to 1) |
| `reverbType`, `reverbSize`, `reverbDecay` | what kind of space the reverb is (`"room"`, `"hall"`, `"plate"`, `"cathedral"`, `"spring"`), how big, and how many seconds it rings. Every synth shares them: see [Effects](#effects) |
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

[`examples/synth_panel.js`](examples/synth_panel.js) is a whole one. What the controls use is there for your own drawing too: `lead.samples()` is the wave the synth is making now (numbers from -1 to 1), `lead.level()` is how loud it is (`[left, right]`, 0 to 1) and `lead.notes()` is the notes it is sounding. `lead.noteOn("C4")` and `lead.noteOff("C4")` press and let go of a key; `lead.set("cutoff", 800)`, `lead.get("cutoff")` and `lead.describe("cutoff")` (its range, unit and kind) work by name. A setting that is a choice (`wave`, `reverbType`, and `voice`) may be set by its name or by its place in `describe(name).choices`, which is what a select or a rotary switch gives. Where a value means something other than its number, `describe` says so in `labels`, and a dial shows the word: `lead.describe("reverbDecay").labels` is `{ 0: "auto" }` (the reverb type's own decay), and the microphone's `gate` at -100 is `"off"`. `soundOutput()` has the same for all the sound together, and `mainSynth()` is the synth that `playNote` plays.

## MIDI

MIDI is how music keyboards, drum pads, boxes of knobs and synths talk to each other and to a computer. Plug a MIDI keyboard into your computer and one line makes it play a synth:

```js
const lead = makeSynth("lead")

lead.playFromMidi()
```

It follows the notes, how hard you hit each key, the pitch wheel, the modulation wheel and the sustain pedal. The first time a program uses MIDI the browser asks whether the page may use your MIDI devices: say yes. `lead.playFromMidi({ channel: 2 })` listens to one channel alone (`{ channel: "all" }` to every one again), and `lead.playFromMidi(false)` stops.

MIDI works in Chrome, Edge and Firefox on a computer. Safari, iPhones and iPads have no MIDI for web pages. Where there is none your program still runs: the console says so once, and everything else carries on.

### Hearing notes and knobs

Your own functions can be called with what arrives, for a picture that dances or a game played from a keyboard:

```js
onMidiNote((note, velocity, channel) => {
  if (velocity > 0) playSound("blip", { pitch: note - 60 })
})

onMidiControl((number, value, channel) => {
  lead.reverb = value                    // a knob's value goes from 0 to 1
})
```

`note` is a number, where 60 is middle C, and `velocity` is how hard the key was hit, from 0 to 1. A key coming up calls `onMidiNote` with velocity 0, unless you give `onMidiNoteOff((note, channel) => { ... })`, which is called then instead. `number` is which knob, slider or pedal it was; every one has a number from 0 to 127 (the sustain pedal is 64). `onMidi((message) => { ... })` is given everything, as `{ type, channel, note, velocity, control, value, bend, program, data, time, device }`: `type` is `"noteOn"`, `"noteOff"`, `"control"`, `"bend"`, `"program"` and so on, `time` is when it happened on the clock that `soundTime()` reads, `device` is the name of what sent it and `data` is the bytes themselves.

### A knob turns a setting

```js
lead.learn("cutoff")                     // the next knob you turn is the cutoff from now on
lead.mapMidi(74, "cutoff")               // or say which knob, by its number
```

The knob goes through the setting's whole range, from its least to its most, so nothing has to be worked out. `lead.cutoff` reads back what the knob has set. A function is called with each new value, which is how a dial on the screen turns with the knob: `lead.learn("cutoff", (value) => { cutoffDial.value = value })`. `{ min: 200, max: 4000 }` narrows the range, and `lead.unmapMidi("cutoff")` lets it go. [`examples/midi_dials.js`](examples/midi_dials.js) is a whole synth panel worked by a controller, with the device and the channel chosen on the screen.

### Sending

A program can play a synth on your desk, a drum machine, or music software on the same computer:

```js
sendMidiNote("C4")                                      // a note, let go half a second later
sendMidiNote("C4", 0.8, { length: 0.5, channel: 1 })    // how hard, how long (seconds, or "quarter"), which channel (1 to 16)
sendMidiNote(["C4", "E4", "G4"], { beat: 4 })           // a chord, on beat 4
sendMidiControl(74, 0.5)                                // turn knob 74 on the other device to half way
sendMidi([0x90, 60, 100])                               // any message at all, as its bytes
```

Everything that is sent takes `{ after, at, beat }` like a sound ([When things start](#when-things-start)) and leaves at exactly that time, so a sequence you write with beats is in time however busy the page is. There are also `sendMidiNoteOff("C4")` (for a note sent with `length: null`, which is held), `sendMidiBend(0.5)` and `sendMidiProgram(5)`, which chooses a sound by its number. `stopSound()` lets go of every note that has been sent and takes back the ones still to come.

`lead.sendToMidi()` sends what a synth plays, tunes and all, out as MIDI too: `makeSynth("bass").sendToMidi().playNotes("C2 C2 G2 C2", 0.25, { repeat: true })`. `{ channel: 10 }` chooses the channel (10 is where drum machines listen).

`sendMidiClock()` sends the beat, so that another device's own sequencer keeps time with `setTempo`, and `sendMidiClock(false)` stops it. A clock that another device sends is measured for you: `onMidi((message) => { if (message.type === "tempo") setTempo(message.bpm) })`.

### Which device

```js
onMidiDevices((devices) => {
  console.log(devices.inputs, devices.outputs)          // their names
})
useMidiInput("Keystation 49")           // listen to this one alone (otherwise: all of them)
useMidiOutput("Minilogue")              // send to this one (otherwise: the first)
```

`midiDevices()` gives the same `{ inputs, outputs, available }` at any time; it is empty until the browser has answered, which is why `onMidiDevices` is there. `available` is `false` when there is no MIDI. A device that is not plugged in is waited for: until it appears every input is listened to (or the first output is sent to), and the console says so once. `stopMidi()` forgets every function you gave and stops everything MIDI is doing.

### Choosing the device and channel on screen

`midiInput()` is the input your program listens to, as something the controls of [dials.js](https://github.com/johnwylie70/dials.js) can be tied to, the way a dial is tied to a synth:

```js
const midiIn = midiInput()

select("midi in", midiIn, "device")      // "all", then every device that is plugged in
select("channel", midiIn, "channel")     // "all", or 1 to 16
meter(midiIn)                            // a light that flashes when a key is hit
```

What is chosen is what plays your synths, what `learn` listens for and what `onMidiNote` and the others hear, from that moment. The choices follow the devices: one that is plugged in later is among them, with nothing plugged in the one choice is `"no devices"`, and where there is no MIDI it is `"no MIDI here"`. If the chosen device is pulled out the choice goes back to `"all"` (the console says so once), and it is chosen again when it comes back. The device chosen on the screen is remembered for the next time the page is opened, where the page may remember things.

The choice works in code too, and is the same choice: `midiIn.device = "Keystation 49"` is `useMidiInput("Keystation 49")`, `midiIn.channel = 2`, and `midiIn.device` and `midiIn.channel` read them back. `midiIn.level()` is how hard the last key was hit, fading away, `midiIn.notes()` is the keys held down, and `midiIn.onChange((name) => { ... })` is called when the choices or the choice change.

Every synth has one of its own, `lead.midiInput()`, for the keys that play it. That is how one keyboard is split between two synths, or two keyboards play one each:

```js
const lead = makeSynth("lead").playFromMidi({ channel: 1 })
const bass = makeSynth("bass").playFromMidi({ channel: 2 })

select("bass channel", bass.midiInput(), "channel")     // it shows 2, and changes it
```

A synth's own choice is made from what the program's lets through. `midiOutput()` and `lead.midiOutput()` are the same for what is sent: `"device"` is one of the outputs (the first, until you choose) and `"channel"` is the channel that `sendMidiNote` and `lead.sendToMidi()` use when they are not given one.

The four MIDI examples are [a keyboard](examples/midi_keyboard.js), [a scene](examples/midi_scene.js), [a sequencer](examples/midi_sequencer.js) and [dials](examples/midi_dials.js). Each still plays with nothing plugged in.

## Effects

A synth sends some of its sound to an effect with one word: `lead.echo = 0.4`, `lead.reverb = 0.3`, `lead.chorus = 0.5`. `distortion` and `crush` belong to the synth alone. The echo, the reverb and the chorus are shared by every synth, and are shaped with `setEffects`:

```js
setEffects({ echoTime: 0.3, echoFeedback: 0.5, echoBounce: true, reverbType: "hall", reverbSize: 0.8 })
```

| | |
|---|---|
| `echoTime`, `echoFeedback`, `echoTone`, `echoBounce` | seconds between echoes, how much each feeds the next (0 to 0.95), how much treble survives, and whether they bounce left and right |
| `reverbType` | what kind of space the reverb is: one of the five below |
| `reverbSize`, `reverbDamping` | how big the space is (0 to 1; bigger also rings longer), and how soon its treble dies |
| `reverbDecay`, `reverbPredelay` | how many seconds the tail takes to die away (0 leaves it to the type and the size), and a gap before the reverb begins (up to 0.2 seconds), which keeps a sound clear of its own reverb |
| `reverbLowCut` | for fine tuning: bass below this many Hz is kept out of the reverb, so that it does not turn to mud (120 to begin with) |
| `chorusRate`, `chorusDepth` | how fast and how far the chorus wobbles |

The reverb is one room that every synth sends into, so its type and shape are one setting for everything: `lead.reverbType = "hall"` and `setEffects({ reverbType: "hall" })` do the same thing, and every synth reads the same value back. A synth's own part is how much it sends, `lead.reverb`.

| `reverbType` | |
|---|---|
| `"room"` | a small room: a short, soft tail of about a second. The one to begin with |
| `"hall"` | a concert hall: big, smooth and warm, about two and a half seconds. Good for pads, strings and bells |
| `"plate"` | a big sheet of metal, as recording studios used: bright, and thick from the first moment. Good on drums and voices |
| `"cathedral"` | enormous: it swells slowly and goes on and on, six seconds and more |
| `"spring"` | the spring in a guitar amp: it twangs, and boings on anything sudden |

No ready-made synth changes the type, because it would change it for all the others: the pad, the strings and the bell send to whatever room there is, and sound grander when you choose `"hall"`. With dials.js the type is a control like any other, `select("reverb", lead, "reverbType")`: `lead.describe("reverbType").choices` is the five names.

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

Any synth can have a sample for its wave, and then the recording goes through that synth's filter, envelope and effects:

```js
const lead = makeSynth("pad")
lead.sample = loadSample("piano.wav")                     // its wave is now "sample"; lead.wave = "saw" goes back
const keys = makeSynth({ sample: "piano.wav", note: "C4", cutoff: 1800, release: 0.6 })   // or all in one line: note is the note the recording is at
```

`sample` takes a sample from `loadSample`, a recording (`recordSound`), or the name of a sound file. The wave `"sample"` is only for a synth that has one: on a synth with none it is not among the choices a `select("wave", lead, "wave")` offers, and `lead.wave = "sample"` says how to give it one and leaves the wave as it was.

`saveSound(kick, "kick.wav")` saves a sample, or a recording of your own, as a WAV file.

## Your voice

The microphone is a synth whose sound comes in instead of being made. Ask for it, give it a voice, and listen:

```js
const mic = useMicrophone()       // the browser asks whether the page may use the microphone
mic.voice = "robot"               // robot, chipmunk, monster, cave, telephone, alien, whisper, or "none"
mic.listen()                      // now you hear yourself, as a robot. mic.mute() stops it
```

**Wear headphones when you listen.** Through loudspeakers the microphone hears itself, and the sound goes round and round until it howls. That is why nothing is heard until you say `listen()`. Recording does not need it.

| voice | |
|---|---|
| `robot` | a machine, ringing in a metal pipe |
| `chipmunk` | small and squeaky: seven semitones higher |
| `monster` | huge and deep: seven semitones lower, with a growl |
| `cave` | far inside a cave: long echoes in an enormous, dark space (it makes the shared reverb a cathedral while it is worn) |
| `telephone` | down an old phone line |
| `alien` | not from here: higher, with a slow metallic sweep |
| `whisper` | hoarse and breathy, with no pitch at all |

A voice is only a handful of settings, and you can turn them yourself once it is on. A microphone has every setting a synth has, and a few words of its own:

```js
mic.pitch = 7                     // semitones up or down, -12 to 12, without getting faster or slower
mic.echo = 0.4                    // and reverb, chorus, distortion, crush, cutoff, pan, volume, as on a synth
mic.ring = 1                      // multiply the voice by a wave: mic.ringSpeed = 50 is how fast (the robot)
mic.comb = 0.5                    // ring like a pipe at one note: mic.combTone = 110. mic.flanger sweeps it
mic.gain = 2                      // turn a quiet microphone up
mic.gate = -40                    // quieter than this (in dB) counts as silence. It starts at -50; "off" for none
```

Choosing another voice first puts back what the last one changed, so pick the voice and then turn the dials. What you set before choosing any voice stays under all of them.

The microphone is a synth to [dials.js](https://github.com/johnwylie70/dials.js) too: `select("voice", mic, "voice")`, `dial("pitch", mic, "pitch")`, `toggle("listen", mic, "listening")`, `scope(mic)`, `meter(mic)`. The scope and the meter show your voice even while it is muted.

### Recording

```js
const take = recordSound(3)       // three seconds of the microphone, starting now
take.onDone(() => take.play())    // when it is over, play it back
```

`recordSound` gives you the recording at once and does not wait: your program carries on, and the take fills up behind it. A take is a sample, so everything a sample does it does, even while it is still recording:

```js
take.play()                       // as you said it
take.play("E4")                   // higher and faster: middle C is its own pitch
take.reverse = true               // backwards
take.loop = true                  // round and round while its note is held
take.voice = "monster"            // any voice, afterwards
take.done, take.seconds           // is it over, and how long it is
await take.whenDone()             // or wait for it, in a program that can wait
```

- What is recorded is **your plain voice**, whether or not you are listening. The take is then given the voice the microphone has, so it plays back the way the microphone sounds, and you can change your mind afterwards: `take.voice = "none"` is you, and `take.soundLike(mic)` is the microphone as it is set now.
- `startRecording()` records until `stopRecording()`. It stops by itself after 30 seconds; `startRecording({ max: 60 })` gives it longer, up to 120.
- One recording is made at a time: starting another ends the one before, which keeps what it had.
- `recordSound(3, { effects: true })` records the voice after its effects instead of before. That only works while you are listening.

### Recording what you play

```js
const tune = recordOutput(10)     // everything that is played for the next ten seconds, in stereo
playNotes("C4 E4 G4 C5", 0.25)
saveSound(tune, "my-tune.wav")    // saved as soon as it is over
```

`lead.record(4)` records one synth alone. `saveSound` gives a WAV file: in a browser it is downloaded. It also gives a promise of the file's bytes, and `saveSound(take, { download: false })` gives the bytes alone.

### With no microphone

A computer with no microphone, a person who says no, a page that is not allowed to ask: none of these stops your program. Every function still works, the console says once why there is no microphone and what to do about it, and a recording is simply empty and done straight away (`take.seconds` is 0). `mic.state` is `"on"`, or says why not: `"refused"`, `"none"`, `"busy"` or `"unavailable"`. `await mic.whenReady()` is `true` or `false`.

A page has to be served over `https` or from `localhost` to be given a microphone, and a page inside a frame needs `allow="microphone"` on the frame.

### The voice effects on a synth

The pitch shifter, the ring modulator and the comb are not only for voices. Every synth has them, under names that do not clash with its own `pitch` and `ring`:

```js
lead.pitchShift = 12              // an octave up, with the same length
lead.ringMod = 0.6                // bell-like and strange: lead.ringSpeed = 300
lead.comb = 0.5                   // a metal pipe: lead.combTone, lead.combFeedback
lead.flanger = 0.6                // the comb, sweeping: lead.flangerRate
lead.voice = "robot"              // or a whole voice at once
```

Eight synths can use the pitch shifter or the comb at once.

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

`playSong("tune.xm", { repeat: false })` plays it once, and `{ volume: 0.6 }` starts it quieter. One song plays at a time, and your own notes and game sounds play over it. `song.channel(0).level()` (and `.samples()`, `.notes()`) reads one channel for a meter of its own. `song.position` says where it is, for drawing: `{ state, order, pattern, row, tick, speed, tempo, rows, orders }`, where `state` is `"playing"`, `"paused"`, `"stopped"` or `"none"`.

A song is made of channels, counted from 0, and of patterns played in an order:

```js
song.mute(2)                               // silence the third channel; song.mute(2, false) brings it back, song.unmute() all of them
song.solo(0)                               // hear only the first; song.solo("all", false) to hear the rest again
song.loopPattern()                         // stay on the pattern that is playing, round and round; loopPattern(false) carries on
song.replace(edited)                       // an edited song in its place, as it plays (for an editor)
```

`replace` takes the song's bytes, its JSON as text, or the song itself as an object. When the edited song has the same shape (as many channels, no fewer instruments and samples) nothing stops: it keeps its place and plays the new notes from the next row.

In a song of synths' own, an instrument can be a synth instead of a recording, called by a name. A song can say itself what the synth is, on the instrument, and then nothing more is needed: `"synth": { "preset": "chip", "set": { "decay": 0.16 }, "macro": [{ "wave": "noise", "pitch": 24 }, { "wave": "pulse" }] }` is a ready-made synth to start from, the settings changed from it and a step macro, each of which may be left out. It is what `makeSynth("chip", { decay: 0.16, macro: [...] })` would be given. A name that is a ready-made synth's (`"bass"`, `"chipKick"`) plays as that; any other name is told what it is, and what you say here comes before what the song says:

```js
playSong("songs/night_drive.json", { patches: { tune: "bell", wobble: { preset: "bass", cutoff: 300, wobble: 12 } } })
```

A `.mod` or `.xm` sounds as its tracker made it sound, rough edges included; `{ raw: false }` smooths the samples and `{ raw: true }` leaves any song rough. `await packSong(bytes)` turns a song file of any kind into the engine's small packed form, which `playSong` plays (an editor keeps that after importing a module).

A song of synths' own can carry its recordings inside itself (`"data"`, a WAV file as base64 text), so that it is one file with nothing beside it.

[`examples/songs/night_drive.json`](examples/songs/night_drive.json) is a short song written this way, and the format is described in [synths-core](https://github.com/johnwylie70/synths-core/blob/main/docs/song-format.md).

## With pictures.js

In a [pictures.js](https://github.com/johnwylie70/pictures.js) scene the sound functions are already there, beside the drawing ones, with nothing to import:

```js
function update(dt) {
  if (star.touches(basket)) playSound("coin")
}
```

A scene run with a copy of this repository instead (as the examples here are) fetches them in its first line, by the path from the scene to `synths.js`:

```js
const { playSound, playNotes } = await use("../synths.js")
```

[`examples/catch_game.js`](examples/catch_game.js) is a whole game written this way.

## The Python spellings

Every function has its Python spelling too, so a program comes across from one language to the other with little more than its syntax changed: `play_sound`, `play_note`, `play_notes`, `play_arp`, `start_arp`, `make_synth`, `load_sample`, `play_song`, `stop_sound`, `set_volume`, `mute_sound`, `set_effects`, `set_tempo`, `sound_time`, `on_midi_note`, `on_midi_control`, `send_midi_note`, `midi_devices`, `lead.play_from_midi()`, `use_microphone`, `record_sound`, `start_recording`, `record_output`, `save_sound`, `take.on_done(...)`, `take.sound_like(mic)`. Settings too: `lead.vibrato_rate = 6`.

## Mistakes

A mistake is said in plain words, with what was probably meant:

```
playSound("lazer"): there is no sound called "lazer". Did you mean "laser"? The sounds are: coin, jump, laser, …
makeSynth(): there is no setting called "cutof". Did you mean "cutoff"?
"H4" is not a note. Write a note as a name like "C4", "F#3" or "Bb5", or as a number, where 60 is middle C
"robt" is not a voice. Did you mean "robot"? The voices are: robot, chipmunk, monster, cave, telephone, alien, whisper, and "none"
```

Things that are not your mistake do not stop your program. They are said once in the console and the rest carries on: sound that is waiting for a tap, a sample whose file is missing, more synths than there is room for (32 at once; `remove()` gives a place back), more notes than there are voices (64; the oldest note makes way), a browser with no MIDI, no microphone.

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
- **The engine runs on the audio thread**, in an AudioWorklet. `fallback: false` refuses anything else.
- **The fallback.** A page that is not served over https or from localhost has no AudioWorklet (a development build opened on a phone or an iPad by the computer's address is one), and there the same engine runs on the page's thread through a ScriptProcessorNode. It is the same sound with two costs. It is later: sound is made 2048 frames at a time (about 43 ms) and everything is scheduled two buffers ahead, so a key is heard about 95 ms after it is pressed where the worklet takes 40; times between notes stay exact. And it clicks when the page is busy for longer than a buffer lasts, because the page's thread is also drawing the scene. `fallbackBuffer` is the frames made at a time, a power of two: `4096` rides over a page busy for 60 ms and is heard about 190 ms late, `1024` is heard after 50 and clicks at 30. The default, `"auto"`, starts at 2048 and doubles it once if the page keeps being too busy (four times in ten seconds), and never makes it smaller again. `player.fallback` is `{ buffer, underruns, reason }`: the frames now, how many times a buffer came too late (each is a click), and `"insecure"` or `"worklet"` for why. The console says all of it once. An https address has the worklet, and neither cost.
- **Setting the buffer in a program's own code.** On a slow device that clicks, go larger; where a keyboard feels late, go smaller:

  ```js
  setSoundBuffer("large")              // "small" (1024 frames), "medium" (2048), "large" (4096), "auto", or a number of frames
  const now = soundBuffer()            // { frames: 4096, delay: 179, thread: "page", underruns: 0, setting: 4096 }
  if (now.thread === "page") drawText(`sound is ${now.delay} ms late, ${now.underruns} clicks so far`, 10, 20)
  ```

  It may be called before the first sound (it is then how the sound starts) and at any time after, and it wins over a host's option. `delay` is the milliseconds from a key to its note, and `thread` is `"page"` on the fallback, `"audio"` on the worklet, and `null` before the first sound. On the fallback it changes the buffer itself, with the sound faded out and in again around the change (about a tenth of a second, and what was scheduled is that much later), and a size set by hand is left alone however busy the page is, until `setSoundBuffer("auto")`. On the worklet the engine always makes 128 frames at a time, which nothing can change, so the same call sets how far ahead everything is scheduled instead (that many frames: 4096 is 85 ms at 48 kHz, `"auto"` the usual 40), and the console says once that this is what it did. A number that is not a power of two from 256 to 16384 is taken as the nearest, with one message. Python: `set_sound_buffer("large")`, `sound_buffer()`.
- **Offline.** `createOfflinePlayer()` is the same player with no sound card: send it the same batches and `render(seconds)` gives the samples, and `wav()` a WAV file. It works in node too. `renderSound((s) => { s.playNote("C4") }, { seconds: 1 })` does it in one line. This is how a recorded video gets its soundtrack, and how the tests listen.
- **Reading back.** `player.read(id)` gives what a synth is doing now, `{ samples, level, notes }` (no id: all the sound), for scopes, meters and lit keys. It never waits: the audio thread posts it about 40 times a second while something is reading. A `sound` transport may have a `read(id)` of its own, and a synth's `samples()`, `level()` and `notes()` use it.
- **Several scenes on a page** share one player and one sound card without being told to: every `createSound()` that is not given a `sound` joins it, in a scope of its own, so each still stops, mutes and pauses alone.
- **MIDI** goes the same way. Its functions write a `midi` command into the same batches; a desk beside the player carries it out, plays a synth from a keyboard without the program in between, and hands back what was received as plain data: `player.onMidi((events) => port.postMessage({ midi: events }))` on the page and `sound.receiveMidi(events)` where the program is. A `midi` option, shaped like `sound`, is the devices themselves for an app whose browser has no MIDI (an iPad app, with CoreMIDI behind it). The code is `synths-midi.js`, fetched the first time MIDI is used. [docs/midi.md](docs/midi.md) is the contract.
- **The microphone** is the player's, and is asked for when the first `mic` command arrives. What the player says back (the microphone is on or is not, a recording is over, a file is saved) is plain data: `player.onSoundEvents((events) => port.postMessage({ sound: events }), scope)` and `sound.receiveSoundEvents(events)`. A `microphone` option gives the player a stream, or frames pushed by the app, where the page cannot ask the browser (a sandboxed frame, a native app that owns the audio session), and `save` takes the files `saveSound` makes. `createOfflinePlayer({ microphone: samples })` takes sound in a microphone's place, which is how the tests listen. [docs/microphone.md](docs/microphone.md) is the contract.
- **Pausing.** `sound.pause()` and `sound.resume()` on what `createSound` gave, for a scene that is paused or out of view, and `sound.close()` when it is over. (`player.pause()` silences everyone who shares the player.) `player.state` is `"loading"`, `"waiting"` (for a tap), `"on"` or `"failed"`.

## Tests

```bash
node scripts/test-node.mjs
node scripts/test-midi.mjs
node scripts/test-voice.mjs
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/test-browser.mjs
```

The first needs only node: it renders commands with the real engine and measures the sound. The second is MIDI, with a pretend device: the bytes, and the whole path to the engine and back. The third is the microphone, recording and the voices, with sound given in a microphone's place. The fourth drives Chromium and WebKit with [Playwright](https://playwright.dev) and listens to what the audio worklet puts out.

The engine is built in [synths-core](https://github.com/johnwylie70/synths-core) and copied here by `node scripts/sync-engine.mjs`, which also writes the files made from it. The built engine is part of this repository, so nothing here needs Rust.

## Licence

MIT. See [LICENSE](LICENSE). The engine, `synths_core.wasm`, is synths-core, by the same author under the same licence.
