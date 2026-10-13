# The core: the contract for an engine that is not this one's

synths.js is in three parts. The **functions** write commands; the **conductor** (in the player) turns
commands into what the engine understands, and remembers which synth has which part and which sample has which
slot; the **core** owns the engine, keeps what is to come in a queue, and renders. In a browser the core is
`makeCore` in `synths.js`, running the WebAssembly engine in an audio worklet (or on the page's thread).

An app that makes its sound somewhere else, such as a native app with the engine on its own audio thread, can
give the player a core of its own:

```js
const player = createPlayer({
  context: clock,                       // the app's clock, in the place of an AudioContext
  core: async ({ sampleRate, post }) => myCore,
})
```

Nothing is fetched, no worklet is loaded, no Web Audio is used and `player.node` stays `null`. `player.kind` is
`"host"`. Everything else is as ever: `player.send(batch)`, `read`, `songPosition`, `target`, MIDI, the
microphone by pushed frames (see [microphone.md](microphone.md)), `onSoundEvents`.

This page is what such a core has to do. It is `makeCore`'s behaviour written down; where the two differ,
`makeCore` in `synths.js` is right and this page is wrong. The engine's own interface (the event record, the
parameters, the zone record, the song format) is synths-core's `docs/engine-api.md`, referred to here as "the
engine's document".

## The clock: `context`

An object with what the player uses of an AudioContext:

| | |
|---|---|
| `currentTime` | seconds, read often. It is the clock every time in an op is on |
| `sampleRate` | frames a second of the engine |
| `state` | `"running"` when sound can be made; anything else and the player waits (`"waiting"`), holding what it is sent |
| `resume()` | asked on the first tap, a click or a key press, and on `player.resume()`. May return a promise |
| `suspend()` | asked on `player.pause()` and when every sender has paused |
| `addEventListener("statechange", fn)` | call `fn` when `state` changes, so the player notices that sound is on |
| `decodeAudioData(arrayBuffer, yes, no)` | only for sound files that are not WAV. WAV files are read by the library |
| `close()` | never called: a `context` that was given is the giver's to close |

## The timing rule

**Every time in an op is in seconds on `context.currentTime`.** The player has already added its `latency`
(0.04 seconds unless the option says otherwise) to everything, so an op's time is a little in the future when it
arrives; the core's work is to turn that time into its own frame and do the thing on exactly that frame.

- A time of `null` is "now": the first frame not yet rendered.
- A time that has already gone by is also now. Nothing is ever placed earlier than now, so things that arrive
  late keep the order they were sent in.
- One exception: a `note_on` event that arrives more than a quarter of a second after its time is dropped, not
  played late.

`makeCore` keeps `delta` (engine frames minus sound-card frames) and computes
`frame = max(now, round(seconds * sampleRate + delta))`. A host core does the same with its own clock.

## What `core(given)` is given, and what it returns

`given` is `{ sampleRate, post }`. `post(message)` is how the core says things back ([messages](#messages)); it
may be called at any time, from the page's thread.

The function returns (or resolves to) an object with:

| | |
|---|---|
| `exec(ops)` | carry out a list of [ops](#ops). The only one that is required |
| `time` | frames rendered so far (a number). Read by `player.ask()` |
| `sampleRate` | as given |
| `voices()` | how many voices are sounding. Read by `player.ask()` |
| `taps(sources, frames)` | what is sounding, for displays: see [Reading back](#reading-back) |
| `songPosition()` | where the song is: ten numbers, or `null`. See [Reading back](#reading-back) |
| `pushInput(frames)` | a `Float32Array` of microphone frames, one channel at `sampleRate`, to be played into the engine's live input |
| `close()` | the player is closed |

All but `exec` may be left out; what would have been read is then empty.

## Ops

`exec(ops)` is given a list. Each op is an array whose first item is its kind. Ops are carried out in order.
Only `e`, `tune`, `tempo`, `record` and `recordStop` carry a time; every other op happens at once.

### `e`: an engine event

```js
["e", seconds | null, type, part, a, x, y, z, b]
```

One event of the engine's, to be given to it on the frame of `seconds`. `type`, `part`, `a`, `x`, `y`, `z` and
`b` are the fields of the engine's 32-byte event record, in that order (the engine's document, "The event
record"): `type` and `part` are `u16`, `a` is `u32` (a handle, or a parameter's id), `x`, `y` and `z` are `f32`,
`b` is `u32`. The types the conductor sends:

| type | name | part | a | x | y | z | b |
|---|---|---|---|---|---|---|---|
| 1 | `note_on` | part | handle | note (fractions are pitch) | velocity 0..1 | | |
| 2 | `note_off` | part | handle | | | | |
| 3 | `all_notes_off` | part, or 65535 for all | 1 to cut, 0 to release | | | | |
| 4 | `param` | part (0 for the settings all share, ids 200 up) | parameter id | value | glide in seconds | | |
| 6 to 9, 11 | `voice_pitch`, `voice_freq`, `voice_volume`, `voice_pan`, `voice_kill` | part | handle | value | seconds to get there | | |
| 13, 14 | `arp`, `arp_more` | part | handle | steps a second | order | how many offsets | four offsets as bytes |
| 17 | `arp_style` | part | handle, or 0 for the part's next note | gate (0: one voice) | octaves | swing | accents, four bits a step |
| 18 | `arp_beat` | part | handle or 0 | steps to a beat (0: the rate) | | | |
| 19 | `arp_notes` | part | handle or 0 | steps a second (0: as it was) | order | how many offsets | four offsets as bytes |
| 21 | `arp_pattern` | part | handle or 0 | a pattern's place, 1 to 64, or 0 for none | | | |
| 15 | `song` | 0 | what: 0 stop, 1 play, 2 pause, 3 seek (x order, y row), 4 repeat (x 1 or 0), 5 volume (x), 6 a patch's part (x instrument, y part), 7 mute and 8 solo (x channel or -1, y 1 or 0), 9 loop the pattern (x) | | | | |

Any other type in the engine's document may come the same way (5 `pitch_bend`, 12 `macro_tick`, and those a
later engine adds). An arpeggio that the engine's arpeggiator plays is sent as 19 (and 14 for more than four offsets), 17, 18 and
21, all with `a` 0 and the time of the note, and then the `note_on`: the order within one time matters, and a
core must keep events of the same frame in the order they came. A `tempo` command is also a `param` event for
parameter 224 (`tempo`, beats a minute), which those arpeggios count their beats by.

A core that only passes events through needs to know none of this: it turns `seconds` into a frame and hands the
seven numbers to the engine. Handles from the conductor are below `0xc0000000`.

`all_notes_off`, when it is the core that sends it (`stop`, `stopPart`), goes on the frame of now.

### `tune`: a tune the core plays by itself

```js
["tune", id, seconds, part, steps, length, repeat, beat, group]
```

A tune is kept in time by the core, not by the page. `steps` is a list of `[after, notes, len, velocity]`:
`after` is when the step starts, counted from the start of a round; `notes` a list of note numbers; `len` how
long they are held; all in **units**. A unit is a second when `beat` is 0, and otherwise a beat, which lasts
`beat` seconds until a `tempo` op for the same `group` says otherwise. `length` is one round, in units; `repeat`
is how many rounds, with 0 for ever. `steps` is sorted by `after`.

The core plays step `i` of round `c` on frame `round(start + (c * length + after) * unit)`, with `start` the
frame of `seconds` and `unit` in frames: a `note_on` for each note with one handle of the core's own (from
`0xc0000000` up, a new one each step) and the step's velocity, and a `note_off` for that handle
`max(1, round(len * unit))` frames later. A tune with no steps, or whose round is shorter than a frame, is not
kept. A `tune` with an id that is already playing takes its place.

### `tempo`

```js
["tempo", group, secondsInABeat, seconds]
```

From the frame of `seconds`, a beat of every tune in beats of that `group` lasts so long. Each such tune carries
on from the beat it had reached: with `from` that frame, `reached = (from - start) / unit`, then
`unit = secondsInABeat * sampleRate` and `start = from - reached * unit`. Steps before the frame keep the old
tempo.

### `stopTune`, `stopPart`, `stop`

```js
["stopTune", id]
["stopPart", part, cut]      // cut: 1 to cut the sound, 0 to let it die away
["stop"]
```

`stopTune` forgets a tune; notes it has already started end as they would have. `stopPart` takes every
`note_on` for that part that is waiting out of the queue, forgets the tunes that play on it, and sends
`all_notes_off` (type 3) for the part now with `a` = `cut`. `stop` does the same for everything: every waiting
`note_on` is taken back, every tune forgotten, `all_notes_off` for part 65535 with `a` = 1, and if a song is
loaded a `song` event with `a` = 0 (stop).

### `sample`, `sampleConfig`, `unsample`

```js
["sample", slot, pcm, channels, rate, baseNote, loopMode, loopStart, loopEnd]
["sampleConfig", slot, baseNote | null, loopMode, loopStart, loopEnd]
["unsample", slot]
```

`sample` loads a recording into a slot (0 to 511 from the conductor; a song's are from 512). `pcm` is a
`Float32Array`, interleaved when `channels` is 2; `rate` its frames a second; `baseNote` the note it is at;
`loopMode` 0 none, 1 forward, 2 ping-pong, from `loopStart` to `loopEnd` in frames, where a `loopEnd` of 0 is the
end of the sample. An empty `pcm` does nothing. The core remembers each slot's channels and base note (for
`sampleRead` and `sampleConfig`). `sampleConfig` changes the loop, and the base note unless it is `null`, of a
sample that is there. `unsample` frees the slot. If there is no memory: `post({ type: "problem", what:
"sample-memory" })`.

### `zones`: a part's sample map

```js
["zones", part, bytes | null, count, flags]
```

`bytes` is a `Uint8Array` of `count` zone records, 48 bytes each, exactly as the engine's `synths_zones_set`
takes them (the engine's document, "The zone record"); `flags` is its `flags` (1: a note no zone holds is
silent). `null` or a count of 0 takes the part's map away (`synths_zones_clear`). The slots in the records are
the conductor's.

### `arpPattern`: a pattern for arpeggios

```js
["arpPattern", place, text]
```

`text` is a `Uint8Array` of the pattern's text in UTF-8 (`"1 - 3 2 _ 1 3 5^"`, or the name of one of the engine's),
to be put in `place` (1 to 64) with `synths_arp_pattern_text`. It is sent before the `arp_pattern` event that
names the place.

### `macro`: a part's step macro

```js
["macro", part, numbers, count, loopStart, loopEnd, release, flags]
```

`numbers` is five numbers a step, `count` steps, as `synths_macro_set` takes them. A `count` of 0 takes the
macro away.

### `songLoad`, `songUnload`

```js
["songLoad", token, bytes, files, firstPart, firstSlot, replace]
["songUnload"]
```

`bytes` is a song file (a MOD, an XM, or one of the engine's own). `files` is a list of `[name, data]`, both
`Uint8Array`, for the sound files a song of the engine's own names: each is given to the engine before the song
is read. `firstPart` (32) and `firstSlot` (512) are where the song's channels and samples go. `replace`, when
true, puts the song in the place of the one that is playing, which goes on from where it is. The core answers
with a [`song` message](#messages) every time, whether it could be read or not. The song does not start until
the conductor sends a `song` event to play.

### `record`, `recordStop`

```js
["record", slot, seconds, length | null, source, part, room, channels]
["recordStop", seconds, slot]
```

Record into a sample slot, starting on the frame of `seconds`, for `length` seconds, or with `null` until
stopped. `source` is 0 for the live input, 1 for what `part` plays, 2 for everything. `room` is the most it may
be, in seconds, and the slot's memory is made for that much at once (`channels` 1 or 2). One recording runs at a
time: one that begins while another is running ends that one. `recordStop` ends the recording in `slot` (a
negative slot: whichever is running, and all that are waiting) at the frame of `seconds`; one that had not begun
never does. The engine is told with `record` events (type 16) on the exact frames.

Every recording asked for ends with one [`recorded` message](#messages): when its length is up, when it is
stopped, when the next begins, or when its room runs out (`full: true`). One that never began says 0 frames.

### `sampleRead`

```js
["sampleRead", slot, token]
```

Read a sample back out of its slot. The core answers with a [`sample` message](#messages) carrying the token.

## Messages

What a core says back, with `post`:

| message | when |
|---|---|
| `{ type: "song", token, result, error, info, patches, replaced }` | after every `songLoad`. `result` is 0 if the song was read, the engine's error number if not (-100: this core plays no songs). `error` is the engine's words as bytes of text, or `null`. `info` is the eight numbers of `synths_song_info` (the first is how many channels, the fourth how many patches). `patches` is a list of `[number, name, synth]` for the song's synth patches: the instrument's number, its name as bytes of text, and what the song itself says the synth is as bytes of JSON text, or `null`. `replaced` is the op's `replace` |
| `{ type: "recorded", slot, frames, full, rate }` | a recording is over: how many frames are in the slot, whether it ran out of room, and the frames a second (the core's `sampleRate`) |
| `{ type: "sample", token, pcm, channels, rate }` | the answer to `sampleRead`: the slot's frames as a `Float32Array` (interleaved if two channels) |
| `{ type: "problem", what }` | `"sample-memory"` or `"record-memory"`: there was no room. The player says so in the console |
| `{ type: "unsupported", what }` | `"macro"` or `"record"`: this core cannot. Nothing is done with it |

Text travels as bytes because an audio thread may have nothing to turn bytes into text with.

## Reading back

**`taps(sources, frames)`** is called with a list of sources and how many samples are wanted (1024). A source is
a part's number, 65535 for all the sound, or 65534 for the live input as it came in. It returns a list, one item
for each source it knows, in any order:

```js
[source, samples, peakLeft, peakRight, notes]
```

`samples` is a `Float32Array` of the latest frames of that source, one channel, oldest first; the peaks are
levels as the engine's meters give them (up at once, back to 37% in half a second), before the player's own
volume; `notes` is a `Uint32Array` of four words whose bits are the notes sounding (bit `n % 32` of word
`n >> 5` for note `n`). The player calls it whenever something reads (`player.read`, a scope, a meter), so it
must be cheap and must never wait.

**`songPosition()`** returns ten numbers, or `null`: state (0 none, 1 stopped, 2 playing, 3 paused), order,
pattern, row, tick, speed, tempo, rounds, rows in the pattern, orders in the song (`synths_song_position`).

**`voices()`** and **`time`** are for `player.ask()`.

**`pushInput(frames)`** is given the microphone when the app pushes it to the player (the `microphone` option's
`push`), already at the core's sample rate. `makeCore` keeps a ring and begins to play it out once a lump and a
little more is in hand; a host with its own microphone path need not take it from here at all.

## What the player does not do for a host core

- No Web Audio: no node, no destination, no ScriptProcessorNode, no under-run counting. `player.fallback` is not
  there, and `soundBuffer()` gives `{ frames: 0, thread: "host", underruns: 0, … }`. A `buffer` command sets
  nothing.
- A microphone given as a MediaStream cannot be used (there is no graph to put it in): push frames.
- The clock is the host's: the player never corrects it.
