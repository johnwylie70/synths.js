# The commands

This is the contract between anything that asks for sound and anything that makes it. The functions of synths.js
write these commands and nothing else; a player carries them out. A binding in another language (Python), a scene
in a sandboxed frame and a worker all send exactly this, and a player in another place (an editor's own page, a
native app) plays it. It describes command format **1**.

- [The shape of it](#the-shape-of-it)
- [A batch](#a-batch)
- [Time](#time)
- [Ids](#ids)
- [Notes and settings](#notes-and-settings)
- [The commands](#the-commands-1)
- [What a player promises](#what-a-player-promises)
- [Sound that is not on yet](#sound-that-is-not-on-yet)
- [Writing a sender](#writing-a-sender)
- [Being a host](#being-a-host)
- [MIDI](#midi)
- [The microphone, recording and saving](#the-microphone-recording-and-saving)
- [What is not here yet](#what-is-not-here-yet)

## The shape of it

```
your program ── functions ──▶ commands ── transport ──▶ player ──▶ engine (audio thread) ──▶ sound
               (createSound)   (plain data)  (send)     (createPlayer, createOfflinePlayer)
```

- Every command is plain data: objects, lists, numbers, text, `true`, `false` and `null`. It survives
  `JSON.stringify`, `postMessage` and a WebSocket. (One exception, bytes, is described under [`sample`](#sample).)
- **Nothing is ever answered.** The sender chooses every id, so the next line of a program never waits for the
  player. A sender can be written in a language with no access to the page at all.
- A player ignores a command whose `op` it does not know, a setting it does not know and a field it does not know.
  A newer sender still works with an older player, apart from the new thing.

## A batch

Commands travel in batches. A transport is one function, `send(batch)`:

```js
{
  synths: 1,          // the command format
  now: 12.3041,       // the sender's clock when the batch was sent, in seconds
  cmds: [
    { op: "synth", id: "s1", preset: "lead", set: { cutoff: 1200 }, t: 12.2874 },
    { op: "note", id: "s1", note: [64], len: 0.5, t: 12.2875 },
  ],
}
```

`scope`, optional, is text that names the sender when several share one player (the scenes on one page, say:
`{ synths: 1, scope: "scene2", now, cmds }`). A scope has its own ids, so two senders may both have an `"s1"`; its
own volume, mute and pause; and `stop` with no id stops only what is its own. With no `scope` a sender is the
player itself: its volume is the volume of everything. The effects every synth shares, and the one song, are
shared by every scope.

A batch is carried out in order. Send one as often as suits: synths.js sends one at the end of each turn of the
page's event loop; a Python scene sends one per frame.

## Time

Sound has to be placed more exactly than messages arrive. So nothing is played "when it arrives":

- **`t`**, on every command, is when it should happen, in seconds on **the sender's own clock**. Any clock will
  do, starting anywhere, as long as it runs at the speed of real time (`performance.now() / 1000`,
  Python's `time.perf_counter()`). A command with no `t` happens at the batch's `now`.
- **`now`**, on the batch, is the same clock read at the moment of sending.
- "Play this now" is `t` = the clock when the function was called. "In half a second" is that plus 0.5. A beat is
  the sender's business: it converts beats to seconds on its clock before sending.

The real-time player lines the sender's clock up with the sound card's from the `now` of the batches it receives
(the shortest journey it has seen is taken as the true difference), and then plays every command at
`t + difference + latency`, on the exact sample. `latency` is 0.04 seconds unless the host changes it. The effect:
a batch that arrives 30 ms late, or commands that were called at uneven moments within a frame and sent together,
still come out with exactly the spacing their `t`s have. A sender in a slow place (a frame's commands that are
sent only when the frame ends, a round trip to another computer) should ask its host for a larger `latency`, or
schedule a little ahead itself.

Two senders with different clocks may share one player: each puts a name of its own in `clock` on its batches
(`{ synths: 1, clock: "py", now, cmds }`), and the player lines each name up separately. A batch with no `clock`
is on the one clock that has no name.

A single note or sound effect that is more than 0.25 seconds overdue when it arrives is dropped, not played late.

The offline player has no sound card to line up with: the sample at the start of its output is the sender's time
`start` (0 unless given), and a command happens at `t - start` seconds exactly.

## Ids

The sender names things. An id is text or a number, and is the sender's to choose; synths.js uses `"s1"`,
`"s2"`, … for synths, `"w1"` for samples, `"t1"` for tunes and `"g1"` for songs, all from one counter. Two senders
that share a player must not share ids: give each a prefix (`createSound({ ids: "a:" })`). Ids beginning
`sound:` are the player's own.

- A **synth** id names an instrument. The player gives it one of the engine's parts (there are 32 for synths)
  when it is first used.
  Sending `synth` again with the same id replaces its settings.
- A **sample** id names a recording. It may be used in a synth's settings before the recording has arrived.
- A **note handle** `h` is a whole number from 1 to 2147483647 that names one sounding note of one synth, for
  changing or stopping it later. Handles belong to their synth: 5 on one synth and 5 on another are different
  notes. A note sent without `h` cannot be addressed afterwards and ends by its `len`.
- A **tune** id names a playing sequence, for stopping it.

## Notes and settings

A **note** is a number, where 60 is middle C and 69 is the A above it (440 Hz), and may have a fraction; or a
name: a letter, any `#` or `b`, and an octave (`"C4"` is 60, `"F#3"`, `"Bb5"`, `"C-1"` is 0; no octave means 4).
A player accepts both; synths.js sends numbers.

**Settings** are an object of names and values, exactly as a person writes them: `{ wave: "saw", cutoff: 1200,
vibrato_rate: 6 }`. A name is matched without regard to capitals, `_` or `.`, so `filterCutoff`, `filter_cutoff`
and `"filter.cutoff"` are one setting. It is either one of the engine's own parameter names
(`synths-core/docs/engine-api.md`) or a friendly name for one (`cutoff` for `filter.cutoff`). A value is a number; for
a choice it may be the choice's name (`"saw"`, and `"square"` for a pulse wave of even width); for a switch it may
be `true` or `false`. For the setting `sample` the value is a sample id.

**`synths-names.json`**, shipped beside the library, has all of it as data so a sender can check a name and say
"did you mean" without the engine: `settings` (id, name, kind, min, max, default, choices, and `scope`: `synth`
or `all`), `names` (each friendly name, the setting it stands for and its `scale`: `octave` is `transpose` times
12), `choiceWords`, `plain` (what every synth starts from), `synths` (the ready-made synths, and the `note` each
plays when none is given, and its `macro` if it has one), `sounds` (the ready-made game sounds), `chords` (each
kind of chord as semitones above its root), `orders`, `macroWaves` and `midi` (see [midi.md](midi.md)). `describe()` returns the same.

A sender should check names and values and report mistakes where the program is, in its own language. A player
does not report them: it passes over what it cannot use.

## The commands

Every command also takes `t` (see [Time](#time)).

### `synth`

Make a synth, or replace the settings of one that exists.

```js
{ op: "synth", id: "s1", preset: "bass", set: { cutoff: 500, echo: 0.3 } }
```

| field | |
|---|---|
| `id` | the synth |
| `preset` | optional: the ready-made synth to start from (`keys`, `bass`, `lead`, `pad`, `pluck`, `organ`, `strings`, `bell`, `flute`, `chip`, `chipLead`, `chipBass`, `chipNoise`, `chipKick`, `chipSnare`, `chipHat`, `kick`, `snare`, `hat`, `sample`). Without it the synth starts plain. |
| `set` | optional: settings on top of that |
| `macro` | optional: a [step macro](#macro), or `null` for none. Missing: the preset's, if it has one |

The patch is: the engine's defaults, then `plain`, then the preset, then `set`. A `note`, `set` or `tune` for an
id that was never made makes it, as `keys`.

### `set`

Change settings. Notes already sounding change too.

```js
{ op: "set", id: "s1", set: { cutoff: 4000 }, glide: 2 }
```

`glide`, optional, is the seconds a number takes to slide to its new value. A setting whose scope is `all`
(the shared effects) may be given here or in `master`; it changes for every synth.

`voice`, optional, puts a voice changer on the synth before `set` is applied: `{ op: "set", id: "s1", voice:
"robot" }`. The voices are in `synths-names.json` under `voices`, each a list of settings, and `"none"` takes one
off. The rule, which a sender that mirrors settings must follow too: the first voice put on a synth remembers
what every setting named by any voice was; each voice after that puts those back and then applies its own; and
`"none"` puts them back and forgets them. A setting of the whole engine (the echo's time, the reverb's size) is
touched only if this voice or the one before names it. `synth` takes `voice` as well.

### `macro`

Give a synth a step macro: a list of steps that each of its notes plays through, `macro.rate` (the setting
`macroRate`, 50) steps a second, inside the engine.

```js
{ op: "macro", id: "s1", macro: [{ wave: "noise", pitch: 24 }, { wave: "square" }, { pitch: -5, volume: 0.9 }] }
{ op: "macro", id: "s1", macro: { steps: [{ width: 0.1 }, { width: 0.9 }], loop: true, slide: true, release: 1 } }
{ op: "macro", id: "s1", macro: null }
```

A macro is a list of steps, or an object with `steps` and any of `loop` (`true`, or `[first step, step after
the last]`: those steps go round while the note is held), `slide` (width, cutoff and volume move in a straight
line between steps) and `release` (the step to jump to when the note is let go). There is room for 64 steps. A
step is an object with any of `wave` (`"sine"`, `"triangle"`, `"saw"`, `"pulse"`, `"square"`, `"noise"`, or the
engine's number), `pitch` (semitones), `width` (0 to 1), `cutoff` (semitones) and `volume` (0 to 1); or those five
as a list. What is left out is left as the synth has it.

### `note`

Start a note, or several at once.

```js
{ op: "note", id: "s1", note: [60, 64, 67], len: 0.5, vel: 0.8, pan: -0.5, h: 12 }
```

| field | |
|---|---|
| `id` | the synth |
| `note` | a note or a list of notes. `null` or missing: the synth's own note (a drum's; 60 otherwise) |
| `len` | seconds until it is let go. `null` or missing: it is held until an `off` |
| `vel` | loudness, 0 to 1 (0.8) |
| `pan` | optional, -1 to 1, for this note alone |
| `h` | optional: a handle for `off` and `voice` |
| `arp` | optional: an [arpeggio](#an-arpeggio) for this note |

Every note in a list shares the handle and is let go together.

#### An arpeggio

`arp` turns a note into a chord from one voice: the engine steps its pitch through a few offsets, on the exact
frame of each step.

```js
{ op: "note", id: "s1", note: [60], len: 0.5, h: 7, arp: { offsets: [0, 3, 7, 10], rate: 50, order: "up" } }
```

| field | |
|---|---|
| `offsets` | up to 8 whole numbers of semitones, each added in turn to the note (-128 to 127). The sender works a chord's name out into these |
| `rate` | steps a second, 0.1 to 1000 (50) |
| `order` | `"up"`, `"down"`, `"updown"`, `"written"` or `"random"` (spaces, `-` and `_` do not matter), or the engine's number 0 to 4 (`"up"`) |

Give the note one pitch, the root. To change the chord of a note that is sounding, send `voice` with its handle
and a new `arp`: the pattern starts again from its first step and nothing else about the note does.

### `off`

Let notes go: they die away over the synth's `release`.

```js
{ op: "off", id: "s1", h: 12 }          // the note with that handle
{ op: "off", id: "s1", note: [60] }     // every held note at that pitch
{ op: "off", id: "s1" }                 // everything the synth is playing, its tunes, and its notes not yet started
{ op: "off", id: "s1", cut: true }      // the same, cut off at once
```

### `voice`

Change a note that is sounding, by its handle.

```js
{ op: "voice", id: "s1", h: 12, pitch: 67, glide: 0.5, vol: 0.5, pan: 1 }
```

`pitch` (a note) or `freq` (in Hz) moves it, over `glide` seconds if given. `vol` is a multiplier, 0 to 4 (1 when
a note starts). `pan` is -1 to 1. `kill: true` cuts it off at once. `arp` gives it an
[arpeggio](#an-arpeggio) or changes the one it has, and `arp: null` takes it away.

### `sound`

Play a ready-made game sound.

```js
{ op: "sound", name: "laser", vol: 0.8, pitch: 3, pan: 0.2 }
```

`len`, optional, is a length in seconds for the sound: it is cut off there, or its last note is held until then.

`name` is one of `coin`, `jump`, `laser`, `shoot`, `explosion`, `hit`, `powerup`, `blip`, `click`, `zap`, `bounce`, `pop`,
`win`, `lose`. `vol` is a multiplier (1), `pitch` is semitones up or down (0). A sound is a patch and a few timed
notes that the player knows; it uses a part of its own, made the first time it is played.

### `sample`

Load a recording into a sample id. One of three ways to give it:

```js
{ op: "sample", id: "w1", url: "https://example.org/kick.wav" }      // the player fetches and decodes it
{ op: "sample", id: "w1", bytes: <the file's bytes> }                // a Uint8Array or ArrayBuffer, or base64 text
{ op: "sample", id: "w1", pcm: [0, 0.1, …], channels: 1, rate: 44100 }   // samples, already decoded
```

| field | |
|---|---|
| `note` | the note the recording is at (60): played at that note it comes out unchanged |
| `loop` | `true` to go round the whole recording while a note is held, or `[first frame, frame after the last]` |
| `pingpong` | with `loop`: forwards, then backwards |
| `name` | optional: what to call it in a message if it cannot be loaded |

`bytes` as a typed array is the one thing here that is not JSON. Over a transport that carries only text, send
base64. WAV files (8, 16, 24 and 32 bit, and floating point) are read by the player itself, everywhere; any other
kind is decoded by the browser, so the offline player in node reads WAV only. Loading takes a moment and nothing
waits for it: a note played before the recording has arrived is silent.

To play it, make a synth whose `sample` setting is the sample's id (and whose wave is `"sample"`, which the
`sample` preset's is). Any synth may be given one this way: `{ op: "set", id: "s1", set: { sample: "w1", wave:
"sample" } }` puts the recording under that synth's filter and envelope. A sender should not offer the wave
`"sample"` for a synth it has given no sample (the library leaves it out of `describe("wave").choices`, and does
not send it):

```js
{ op: "synth", id: "s2", preset: "sample", set: { sample: "w1" } }
{ op: "note", id: "s2", note: null, len: null }
```

`{ op: "unsample", id: "w1" }` forgets a recording. There is room for 1024.

A `sample` command with no `url`, `bytes` or `pcm` changes one that is already there: `{ op: "sample", id: "w1",
loop: true }` sets its loop (`false` takes it away) and `note` the note it is at. For a recording still being
made, the loop is put on when it is over.

### `mic`

The microphone: see [The microphone, recording and saving](#the-microphone-recording-and-saving).

```js
{ op: "mic", id: "m1", set: { micGate: -50 } }      // open it: this is when the person is asked
{ op: "mic", id: "m1", listen: true }               // hear it; false to stop hearing it
{ op: "mic", id: "m1", do: "close" }                // let it go
```

| field | |
|---|---|
| `id` | the microphone, which from then on is a synth by that id: `set`, `voice`, `note` and reading back all work on it |
| `set`, `voice` | optional: settings and a voice, as in [`set`](#set) |
| `listen` | optional: whether it is heard. It is not, to begin with |
| `raw` | optional, on the command that opens it: `false` asks the browser for its phone-call processing (echo cancelling, noise removal, automatic level) |
| `do` | `"close"` lets the microphone go |

### `record`

Record into a sample id, which is from then on a sample like one that was loaded.

```js
{ op: "record", id: "w3", from: "mic", len: 3 }                  // three seconds of the microphone
{ op: "record", id: "w4", from: "output", max: 60 }              // everything played, until stopped or for 60 seconds
{ op: "record", id: "w5", from: "synth", synth: "s1", len: 2 }   // one synth
{ op: "record", do: "stop" }                                     // end this sender's recording; with an id, that one
```

| field | |
|---|---|
| `id` | the sample to record into: an id of the sender's choosing, as for `sample` |
| `from` | `"mic"` (the default), `"output"` or `"synth"` with `synth` |
| `len` | seconds. Without it the recording runs until it is stopped, or for `max` seconds (30), or 120 at the very most |
| `effects` | with `from: "mic"`: record the microphone after its voice and effects. This needs it to be listened to; otherwise, and by default, the plain microphone is recorded, after its gain and gate |
| `loop` | as for `sample`, put on when the recording is over |

The microphone and a synth are recorded in one channel, the output in two. `t` is when it starts, on the exact
sample. One recording is made at a time: another one starting ends the first, which keeps what it has.

### `save`

```js
{ op: "save", id: "w3", name: "hello.wav", ask: 7 }
```

Read a sample out of the engine as a 16-bit WAV file (a recording, or any loaded sample). The player downloads
it, or hands it to its `save` option; `download: false` does neither. The file comes back as plain data with
`ask`, the sender's own number for this request. A recording that is still being made is saved when it is over.

### `tune`

A sequence of notes on one synth, which the player keeps in time itself and can repeat for ever. Its timing is
exact to the sample and does not depend on the sender staying awake.

```js
{ op: "tune", id: "t1", synth: "s1", steps: [[0, [60], 0.2, 0.8], [0.25, [64, 67], 0.2, 0.8]], length: 0.5, repeat: true }
```

| field | |
|---|---|
| `id` | the tune, for `stop` |
| `synth` | the synth that plays it |
| `steps` | a list of `[seconds after the tune starts, notes, seconds the note lasts, loudness]`. `notes` is a note, a list, or `null` for the synth's own note |
| `length` | seconds in one time round (so a tune may end with a rest). Missing: the end of the last note |
| `repeat` | `true` for ever, or a number of times. Missing: once |
| `beats` | `true`: every time in `steps` and `length` is in beats, not seconds. The tune goes at the sender's tempo (see [`tempo`](#tempo)) and changes speed when that changes, as it plays |

A tune with the id of one that is playing replaces it.

### `tempo`

```js
{ op: "tempo", bpm: 140 }
```

How fast a beat is for this sender (its scope), in beats a minute: 120 until it says. It matters to the player
only for tunes with `beats: true`, which change speed on the sample of this command's `t` and carry on from the
beat they had reached. Everything else a sender writes in beats (a note's length by name, "the next note of the
line") it turns into seconds itself before sending: `synths-names.json` has the note lengths in beats (`lengths`,
`lengthLetters`; a dot is times 1.5, a triplet times two thirds).

A line of notes (`note("C4", "quarter")`, each beginning where the last ended) is not a command of its own: the
sender keeps, for each synth, the time its line has reached, and writes an ordinary `note` with that `t` and a
`len` of 0.95 of the length. A line that has not been written to, or whose time has passed, begins at the time
of the first such call in the present turn of the program, so that lines written one after another begin
together. `loopNotes` writes one `tune` with `beats: true` for each synth in the section, all with the same `t`
and `length`.

### `stop`

```js
{ op: "stop", id: "t1" }     // stop a tune: notes it has started finish by themselves
{ op: "stop" }               // stop everything: every note cut off, every tune ended, every note not yet started taken back
```

Synths, their settings and samples stay. `stop` happens when it arrives; it does not wait for its `t`.

### `master`

Things that are for all the sound.

```js
{ op: "master", volume: 0.5 }                              // 1 is normal, up to 4
{ op: "master", mute: true }
{ op: "master", set: { echoTime: 0.3, reverbSize: 0.8 } }  // settings whose scope is "all"
```

`{ op: "master", pause: true }` silences the sender's own sound with everything kept as it is (a scene that is
out of view), and `pause: false` brings it back. When every scope of a player is paused, the sound card rests.

### `close`

```js
{ op: "close" }
```

The sender is finished: everything of its scope is stopped and forgotten (synths, tunes, samples), and its parts
are free for others.

### `free`

```js
{ op: "free", id: "s1" }
```

The synth lets go of its notes and gives its part back. The player remembers its settings: if it is played again
it takes a part again.

### `song`

A tracker song: a MOD or XM file, or a song in the engine's own JSON format (`synths-core/docs/song-format.md`).
A file of any of these kinds is given as it is. The engine plays it by itself, on parts 32 to 63 (one for each channel, so at most 32) and sample slots 512 and up, so it never
meets the synths and samples of the other commands. There is one song at a time for the whole player: playing
another replaces it.

```js
{ op: "song", id: "g1", do: "play", url: "https://example.org/tune.mod", repeat: true, vol: 1,
  patches: { "wobble": "bass", "pling": { preset: "pluck", echo: 0.4 } } }
```

| field | |
|---|---|
| `id` | the song, for steering it |
| `do` | `"play"` with a `url` or `bytes`: load this song and start it. Without either: one of the actions below |
| `url`, `bytes` | the song file: an address the player fetches, or its bytes (a typed array, or base64 text) |
| `files` | optional, for a JSON song that names WAV files: `{ "the path as the song writes it": bytes }`. Without it the player fetches each one beside `url`. A song whose samples are inside it (`data`, a WAV file in base64) needs none |
| `repeat` | `false` to play it once (`true`) |
| `vol` | 0 to 2 (1) |
| `raw` | `true`: a sample played faster than it was recorded is left harsh, as old trackers left it; `false`: it is smoothed. Missing: the engine chooses (raw for a MOD or XM as it is, smooth for the engine's own songs) |
| `patches` | what the song's instruments that are synths by name are: for each name a ready-made synth's name, or settings (with `preset` and `macro` if wanted). For a name not given here, the player uses what the song itself says under the instrument's `synth` key: `{ preset, set, macro }`, a ready-made synth's name, settings on top of it and a [step macro](#macro) (missing: the preset's), any of which may be left out, exactly as the [`synth`](#synth) command takes them. `replace` reads it again; failing that, a name that is a ready-made synth's is that synth; and one that nothing says plays as `keys`, and the console says so |
| `name` | optional: what to call it in a message |

Steering, each on the exact sample of its `t`:

```js
{ op: "song", id: "g1", do: "pause" }               // hold it where it is; "resume" (or "play") carries on
{ op: "song", id: "g1", do: "stop" }                // stop, and go back to the start
{ op: "song", id: "g1", do: "seek", order: 2, row: 16 }
{ op: "song", id: "g1", do: "volume", vol: 0.5 }
{ op: "song", id: "g1", do: "repeat", repeat: false }
{ op: "song", id: "g1", do: "mute", channel: 2, on: true }      // channels count from 0; no channel: every one
{ op: "song", id: "g1", do: "solo", channel: 0, on: true }      // while any is soloed, only those are heard
{ op: "song", id: "g1", do: "loopPattern", on: true }           // stay on the pattern that is playing
{ op: "song", id: "g1", do: "replace", text: "{ … the edited song's JSON … }" }   // or bytes; `files` and `patches` as for play
```

`replace` puts an edited song in the place of the one playing, for an editor. When the two have the same number
of channels and the same rules, and the new one has no fewer instruments and samples, nothing stops: sounding
notes carry on, the song keeps its place, and it reads the new song from the next row. Otherwise it is loaded
afresh and put back where it was, with its volume, mutes, solos and loop. The synths of its instruments keep
their ids and parts and are set to what the new song says. A song that cannot be read leaves the one playing as
it was, and the console says why. Mutes, solos and the loop last until they are changed or another song is played.

With no `id` an action is for whatever song is playing; with the `id` of a song that has been replaced it does
nothing. Loading takes a moment (the file is fetched and read): the song starts when it is ready, and what was
asked of it meanwhile is done then, in order. A file that cannot be fetched or read is said once in the console,
in the engine's own words for a JSON song (it names the key that is wrong), and nothing plays. `stop` with no id
(stop everything) stops the song too.

A song's synths are synths of the sender's scope with the ids `song:<name>`, so `player.target("song:bass")`
is a dial's target. They are freed when another song is loaded.

Two more ids read a song, both additive:

- `song:ins:<number>` is the synth that instrument (counted from 1) plays, whatever its name: for `read`,
  `target`, `set`. When two instruments give the same patch name to synths of their own that differ (each with
  its own `synth` in the song), the first has `song:<name>` and each later one `song:<name>#<its number>`.
- `song:channel:<n>` (from 0) is a channel of the song, one of the engine's parts from 32 up, for
  `player.read`: the wave, level and notes of what that channel plays from samples. Notes a channel plays on a
  synth are read at that synth. A channel the song has not got reads as nothing.

Where the song is comes from the player, like the rest of [reading back](#reading-back):
`player.songPosition()` gives `{ state: "none" | "stopped" | "playing" | "paused", order, pattern, row, tick,
speed, tempo, rounds, rows, orders }`, never waiting (the first read asks; the answer follows in a moment). A
transport may offer `songPosition()` beside `send`.

## What a player promises

- **Order.** Commands with the same time happen in the order they were sent, so a `synth` and the first `note`
  for it can be sent together.
- **Exactness.** A note starts on the sample its time names. A change of setting takes hold within 16 samples.
- **Room.** The engine has 64 voices and 64 parts, of which synths are given the first 32 (the rest are a song's
  channels). A 33rd synth takes the part of the one played longest ago,
  which takes one back the same way if it is played again; the console says so once. A note past 64 voices takes
  the place of the oldest. Nothing a sender does can make the output louder than full volume or anything but numbers.
- **Leniency.** Anything not understood is passed over without a word; see [The shape of it](#the-shape-of-it).

## Sound that is not on yet

A browser keeps a page silent until it has been tapped, and the engine takes a moment to load. Until sound is on,
a player keeps what it is sent, and when sound comes on:

- what sets things up (`synth`, `set`, `sample`, `master`) is carried out, in order;
- a `tune` or a `song` starts then (or as far ahead as it was asked for, if that is still to come);
- a single `note`, `sound`, `off` or `voice` is played only if it is not overdue by more than 0.35 seconds when
  the wait was for a tap (so the sound that the tap itself asks for is heard), or 10 seconds when only the engine
  was loading (so the first line of a program is heard). Otherwise it is dropped;
- a `stop` takes back the notes, tunes and songs that were waiting.

The console says once that sound is waiting for a tap. A sender has nothing to do about any of this.

## Writing a sender

In another language the whole library is: check what the person wrote (with `synths-names.json`), build these
objects, and append them to the frame's batch.

- Keep one counter for ids and one for handles.
- Stamp `t` when the function is **called**, not when the batch is sent.
- Remember each synth's settings on your side if the person may read them back (`lead.cutoff`); the player never
  tells you.
- Report mistakes yourself, in plain words, at the line that made them.

```python
def play_note(note, length=0.5, volume=0.8):
    cmds.append({"op": "note", "id": MAIN, "note": [note_number(note)], "len": length, "vel": volume, "t": clock()})

# once a frame
send({"synths": 1, "now": clock(), "cmds": cmds})
```

## Being a host

A host is an app that shows scenes and wants their sound played somewhere other than the scene's own page.

```js
// Where the scene runs: hand the library a transport.
const sound = createSound({ sound: { send: (batch) => port.postMessage(batch) } })

// Where sound may be made: a player.
import { createPlayer } from "synths.js"
const player = createPlayer({ wasm: engineBytes, latency: 0.06 })
port.onmessage = (m) => player.send(m.data)
```

Every `createSound()` on one page that is given no `sound` (and no `context` or `destination` of its own)
shares one player, each in a scope it makes up, so a page of ten scenes has one sound card and one engine. The
first one's options make the player; the player closes when the last one closes. `share: false` gives one a
player to itself. On each: `pause()`, `resume()` and `close()`.

`createPlayer(options)`:

| option | |
|---|---|
| `wasm` | the engine: bytes, a `WebAssembly.Module`, an address, or a promise of one. Without it, `synths_core.wasm` beside `synths.js` is fetched |
| `worklet` | how the worklet's module is loaded: `"blob"` (from text inside `synths.js`; nothing fetched), `"file"` (`synths-worklet.js` beside it), an address, or `"auto"` (the Blob, then the file) |
| `latency` | seconds everything is played ahead (0.04) |
| `context`, `destination` | an `AudioContext` and a node of your own to play into |
| `fallback` | `false` to refuse running the engine on the page's thread when there is no AudioWorklet; `"always"` to insist on it |
| `onState` | called with `"waiting"`, `"on"` or `"failed"` |
| `microphone` | where the microphone comes from when it is not the browser's to ask for: see [microphone.md](microphone.md). `false` for none |
| `save` | called with `{ name, bytes, type }` for a file `saveSound` made, in place of a download |

It returns `send(batch)`, `read(id)` (see [Reading back](#reading-back)), `state`, `kind` (`"worklet"` or `"fallback"`), `ready` (a promise for sound being on),
`pause()`, `resume()`, `unlock()` (call it from a tap of your own), `ask()` (a promise of `{ voices, time }`),
`context`, `node` and `close()`.

`createOfflinePlayer({ sampleRate, wasm, start, microphone, save })` is a promise of a player with `send(batch)` and
`render(seconds)`, which gives `{ left, right, sampleRate, wav() }` and carries on from where the last render
ended. `microphone` is samples to use in a microphone's place (one channel, starting with the first frame). For a video's soundtrack: keep every batch a scene sent while it was recorded, send them to an offline
player whose `start` is the scene's clock at the first frame, and render the length of the video.

Measured in Playwright's browsers on 2026-10-13: in Chromium the worklet loads from a Blob everywhere, including
a sandboxed frame with no origin and a policy that allows no fetch. In WebKit a frame with no origin refuses a
worklet from a Blob ("Cross-origin script load denied"), and loads it from `synths-worklet.js` when that address
is in the frame's `script-src` and is served with `Access-Control-Allow-Origin: *`; with neither, the fallback
plays. WebKit also keeps such a frame silent until it is tapped itself.

## Reading back

Commands are never answered, and stay that way. What a display needs (a scope, a meter, the keys that are lit)
is read from the **player**, by whoever is beside it:

```js
player.read("s1")     // { samples: Float32Array of the synth's latest 1024 frames, level: [left, right], notes: [60, 64] }
player.read()         // the same for all the sound together
```

`samples` are from -1 to 1 and `level` is the peak, from 0 to 1, both as loud as they are heard; `notes` are the
notes sounding, as whole numbers. A read never waits: it gives the latest the audio thread has posted (about 40
times a second, beginning a moment after the first read of that synth, and stopping when nothing has read for a
second and a half). Before anything has arrived, and for a synth that has no part, it gives empty lists and zeros.

`player.target(id)` is a synth that exists by its id, as an object for controls on the player's side to be tied
to when the program that made it is elsewhere: `set(name, value)`, `get(name)`, `describe(name)` (`{ name, kind,
min, max, default, unit, choices }`), `noteOn(note, velocity)`, `noteOff(note)`, `samples()`, `level()`,
`notes()`. It writes ordinary commands for that id, and answers `get` and `describe` from the commands the player
has carried out, so it is told nothing. The sender is not told what a dial changed.

A transport may offer the same as `read(id)` beside its `send(batch)`; the library's synths use it for
`samples()`, `level()` and `notes()`, and give nothing when it is not there. A sender in another place (Python, a
worker) asks its host, however the host chooses to carry it: once a frame is plenty.

## MIDI

One more command, `{ op: "midi", do: … }`, is how a program sends MIDI, has a keyboard play a synth and ties a knob
to a setting. A player carries it out with a desk it loads when the first one arrives (`synths-midi.js`), and hands
back what was received through `player.onMidi(listener, scope)`: lists of plain objects, which is the one other
thing besides [reading back](#reading-back) that comes from a player. A player without it passes `midi` over like
any command it does not know. The `midi` option of `createPlayer` is a host's own way to the devices, for a
browser that has no MIDI. Which device and which channel a sender hears and sends to are `midi` commands too
(`do: "input"` and `do: "output"`, with an `id` for one synth's own), so a select on the screen that chooses
them needs nothing more. All of it is in [midi.md](midi.md).

## The microphone, recording and saving

The microphone is where the player is, so the player opens it, on the first `mic` command and not before; how a
host supplies one where the browser cannot is in [microphone.md](microphone.md). From then on the microphone is a
synth by its id whose sound comes in instead of being made: it has a part of the engine, so `set` and `voice`
work on it, and so does [reading back](#reading-back) (which, while it is not listened to, shows it as it comes
in). A microphone has no filter to begin with, so that it passes untouched.

The library's own microphone has a few words of its own, which it turns into the usual ones before it writes a
command (`synths-names.json`, under `microphone.names`): `pitch` is `pitchShift`, `ring` is `ringMod`, `gain` is
`micGain`, `gate` is `micGate`. A sender in another language does the same.

Three things come back from a player besides what is read, all through `player.onSoundEvents(listener, scope)`,
as lists of plain objects for the sender of that scope:

```js
{ type: "microphone", state: "on" }                              // or "asking", "refused", "none", "busy", "unavailable", "off"; with `message` when there is none
{ type: "recorded", id: "w3", frames: 144000, seconds: 3, rate: 48000, full: false }
{ type: "saved", id: "w3", ask: 7, name: "hello.wav", seconds: 3, bytes: <Uint8Array: the WAV file> }
```

A host carries them to where the program is and gives them to `sound.receiveSoundEvents(events)`; a transport
that has `onSoundEvents(listener, scope)` beside its `send` is asked by the library itself. With no microphone a
`record` from it is answered at once with `frames: 0`, the reason is said once in the console, and every other
command is carried out as usual. While the person is still being asked, a `record` from the microphone waits for
the answer and begins then. `full` is true for a recording that ran out of room.

## What is not here yet

- One song at a time for the whole player, and one microphone.
