# MIDI

This is the contract for MIDI in synths.js: what the functions write, what a player does with it, what a program
is handed back, and what an app must supply where the browser has no MIDI of its own. It adds one command,
`midi`, to [the commands](commands.md), and nothing else about them changes. The code is `synths-midi.js`,
which `synths.js` fetches the first time a MIDI function is used.

- [The shape of it](#the-shape-of-it)
- [Where MIDI exists](#where-midi-exists)
- [The `midi` command](#the-midi-command)
- [What is handed back](#what-is-handed-back)
- [Time](#time)
- [The `midi` option: a host's own transport](#the-midi-option-a-hosts-own-transport)
- [A program in a worker, another frame or Python](#a-program-in-a-worker-another-frame-or-python)
- [A scene's own functions](#a-scenes-own-functions)
- [Writing a sender](#writing-a-sender)
- [What a native app needs](#what-a-native-app-needs)

## The shape of it

```
your program ── functions ──▶ midi commands ─ transport ─▶ player ─▶ THE DESK ─▶ a MIDI transport ─▶ devices
     ▲          (makeMidiApi)   (in the sound's batches)              │  ▲        (Web MIDI, or the host's)
     └──────────── what was received, as plain data ◀── onMidi ───────┘  └── a keyboard plays a synth here
```

- **The functions only write commands**, as the sound's do, into the same batches. Nothing is answered.
- **The desk** is on the player's side, because that is where the devices are. It carries the commands out.
- **A keyboard plays a synth on the player's side.** `lead.playFromMidi()` is a command; from then on the desk
  turns each key into a note for that synth itself. The program is not asked, so it is as quick with the program
  in a worker or in Python as on the page.
- **What is received is handed back as plain data**: lists of objects, to whoever asked the player with
  `onMidi(listener, scope)`. A program that is elsewhere is given them with its next frame.
- **Nothing is fetched or asked until MIDI is used.** `synths-midi.js` is imported, and the browser asks its
  permission, when the first `midi` command reaches a player. A program with no MIDI in it costs nothing.

## Where MIDI exists

Web MIDI (`navigator.requestMIDIAccess`) is in Chrome, Edge and other Chromium browsers, and in Firefox. It needs
a secure page (https or localhost), it asks the person's permission, and a page inside a frame of another origin
needs `allow="midi"` on the frame. Safari has none, and so neither has any browser or web view on an iPhone or an
iPad. Measured on 2026-10-13 with Playwright: Chromium 140 has it (with the permission given it lists the
machine's devices; without, it refuses with `NotAllowedError`; in a frame of another origin it refuses with
`SecurityError` until the frame has `allow="midi"`), and WebKit 26.0 has no `requestMIDIAccess` at all.
Firefox was not measured.

Where there is none, every MIDI function still works and nothing throws: `midiDevices()` is empty, nothing is
received, what is sent goes nowhere, and the console says **once**, in plain words, why and what to use instead.
An app that has MIDI by other means (an iPad app, with CoreMIDI) gives it as [the `midi` option](#the-midi-option-a-hosts-own-transport).

## The `midi` command

`{ op: "midi", do: … }`, with `t` as on every command. A player with no desk passes it over, like any command it
does not know. Ids are the sender's synth ids; channels are 1 to 16.

| `do` | fields | |
|---|---|---|
| `"devices"` | | Nothing but "MIDI is in use": the desk opens, and the sender is told the devices |
| `"listen"` | `on` | Hand this sender every message that arrives (`on: false` stops) |
| `"input"` | `name` | Listen to this input alone: a name, a list of names, or `null` for all (the default). For the whole player |
| `"output"` | `name` | Send to this output unless a message names its own: a name, or `null` for the first there is (the default) |
| `"send"` | `bytes`, `output` | Send one whole message, as a list of numbers from 0 to 255 beginning with its status byte, at `t` |
| `"play"` | `id`, `channel`, `vibrato`, `on` | A keyboard plays this synth: see below. `channel` narrows it to one; `on: false` stops and lets go |
| `"through"` | `id`, `channel`, `note`, `output`, `on` | What this synth is asked to play also goes out as MIDI on `channel` (1). `note` is the synth's own note (60), for a note with none |
| `"map"` | `id`, `control`, `channel`, `setting`, `min`, `max`, `curve`, `kind` | Control `control` (0 to 119) turns `setting` of the synth |
| `"learn"` | `id`, `setting`, `min`, `max`, `curve`, `kind` | The same, for the next control that is moved and is not already mapped by this sender |
| `"unmap"` | `id`, `setting` | No control turns it any more; with no `setting`, none of the synth's |
| `"clock"` | `bpm`, `on` | Send the MIDI clock: a start (0xFA) at `t`, then 24 ticks (0xF8) a beat. Sent again with a new `bpm` it changes speed; `on: false` sends a stop (0xFC) |
| `"stop"` | | Everything of this sender's MIDI: its notes out let go, nothing listened to, played, sent on or mapped |

```js
{ op: "midi", do: "send", bytes: [144, 60, 102], t: 12.25 }                    // sendMidiNote("C4") is this,
{ op: "midi", do: "send", bytes: [128, 60, 0], t: 12.75 }                      // and this, half a second later
{ op: "midi", do: "play", id: "s1", vibrato: [0, 0.5] }                        // lead.playFromMidi()
{ op: "midi", do: "map", id: "s1", control: 74, setting: "cutoff", min: 20, max: 20000, curve: "exp", kind: "float" }
```

**`play`.** A note-on starts a note on the synth (`{ op: "note", len: null, vel: velocity }` with a handle of the
desk's own, from 0x7E000000) and its note-off lets it go. Control 64, the sustain pedal, at half or more keeps
the keys that come up sounding until it is let up. Pitch bend sets the synth's `bend` (-1 to 1; `bendRange` is
how many semitones, 2). Control 1, the modulation wheel, sets `vibrato` to `vibrato[0] + value * vibrato[1]`
semitones (the sender gives the synth's own vibrato and how much the wheel adds), unless the sender has mapped
control 1. Controls 120 and 123 let everything go. Notes are played a hundredth of a second ahead, not the whole
`latency`.

**`map` and `learn`.** A control's value `v`, from 0 to 1, becomes `min + (max - min) * v`, or with `curve: "exp"`
`min * (max / min) ** v`. `kind` is the setting's: `"int"` and `"choice"` are rounded, `"bool"` is `v >= 0.5`.
The desk sets the synth itself (`{ op: "set", glide: 0.02 }`) and tells the sender with a `set` event. The sender
works `min`, `max`, `curve` and `kind` out from its own table of settings: synths.js uses the setting's whole
range, and `"exp"` for one in Hz that spans a hundred times or more.

**`through`.** The desk reads the sender's own `note`, `off`, `voice` (`kill`), `tune`, `stop` and `free`
commands for that synth and writes the MIDI: so a tune that repeats goes out for as long as it plays, and `stop`
takes it back. Notes are rounded to whole ones; an arpeggio goes out as its root.

**`stop` with no id** (the sound command) also takes back this sender's MIDI still to be sent and lets go of the
notes it has sounding, and `close` ends everything of the sender's.

## What is handed back

`player.onMidi(listener, scope)` gives `listener` a list of plain objects each time something happens, and
returns a function that stops it. Every one has `type`. A sender is told only what is its own to know.

A message from a device, when the sender has asked to `listen`. `time` is on the sender's own clock, `device` is
the input's name, and `data` is the message's bytes:

| `type` | fields |
|---|---|
| `noteOn` | `channel`, `note`, `velocity` (0 to 1, never 0) |
| `noteOff` | `channel`, `note`, `velocity` (always 0), `release` (how fast the key came up, 0 to 1). A note-on with no velocity is one of these |
| `control` | `channel`, `control` (0 to 127), `value` (0 to 1) |
| `bend` | `channel`, `bend` (-1 to 1) |
| `program` | `channel`, `program` (0 to 127) |
| `pressure`, `notePressure` | `channel`, `value` (0 to 1), and `note` for a note's |
| `sysex` | `data`: the whole message from 0xF0 to 0xF7 |
| `clock`, `start`, `continue`, `stop` | the other device's clock |
| `songPosition`, `songSelect`, `timeCode` | `value` |
| `tuneRequest`, `sensing`, `reset`, `other` | |

Made by the desk:

| `type` | fields | |
|---|---|---|
| `devices` | `inputs`, `outputs` (lists of names), `available` | Told to every sender that uses MIDI when the devices are first known, and when one comes or goes. `available: false`: there is no MIDI here |
| `tempo` | `bpm` | Another device's clock has been measured over a beat (and again when it changes by half a beat a minute). For senders that `listen` |
| `learned` | `id`, `setting`, `control`, `channel` | A `learn` found its control |
| `set` | `id`, `setting`, `value`, `control` | A mapped control set a synth's setting. `value` is in the setting's own units (a choice as its number) |

The bytes are read with running status, a real-time byte may come in the middle of another message, and a
system exclusive message is kept whole however many pieces it arrives in.

## Time

- **Sending.** `t` is on the sender's clock, as for sound. The desk lines that clock up with its own
  (`performance.now()`) from the `now` of the batches, the way the player lines it up with the sound card, adds
  the player's `latency` so that MIDI goes out with the sound, and hands each message to the transport with the
  exact time it is due. So a sequence asked for in one go, or from a busy page, comes out evenly: measured,
  notes asked 100 ms apart leave 100.000 ms apart.
- **A moment ahead.** A message is handed to the transport no more than 150 ms before it is due (1.5 seconds
  for a page that is out of view, where timers run slowly), so that `stop` can still take the rest back.
- **Receiving.** A message's `time` is the device's timestamp moved onto the sender's clock: compare it with
  `soundTime()`.
- **Late.** What was asked for more than a quarter of a second before the permission was given is not sent,
  except note-offs.

## The `midi` option: a host's own transport

`createPlayer({ midi })`, `createSound({ midi })` and `configure({ midi })` take a **MIDI transport** in place of
the browser's Web MIDI. It is shaped like `sound` and `storage`: a plain object of functions.

```js
const midi = {
  open() {},                        // optional; may return a promise. Called once, when MIDI is first used: ask permission here. Throw, or reject, if there is no MIDI
  inputs() { return ["Keystation 49"] },      // the names of the devices there now
  outputs() { return ["Minilogue"] },
  send(bytes, time, output) {},     // one whole message. bytes: a list of numbers. time: milliseconds on this page's performance.now() clock (it may be a little in the future; send at once if it is past).
                                    // output: a name from outputs(), or undefined for the first
  receive(listener) {},             // keep the listener, and call listener(bytes, time, input) for what arrives: bytes as a list or Uint8Array, holding one message, several, or part of one;
                                    // time in milliseconds on performance.now() (or nothing, for "now"); input: the name of the device
  changed(listener) {},             // optional: keep the listener, and call listener() when a device is plugged in or pulled out
  close() {},                       // optional
}
```

`midi: false` switches MIDI off. `midiSysex: true` asks Web MIDI for system exclusive messages too (browsers ask
the person more sternly for that). `midiModule` is `synths-midi.js` as a module, a promise of it or its address,
for a copy of `synths.js` with nothing beside it.

Names are what a person sees and chooses by, so two devices should not share one: Web MIDI's transport calls the
second `"name 2"`.

## A program in a worker, another frame or Python

The program's side writes commands; the page's side has the player, and so the desk. Two lines join them:

```js
// The page: hand the program what the desk says, however the batches already travel.
const player = createPlayer({ midi })                    // `midi` only if the host has its own
port.onmessage = (m) => player.send(m.data)
player.onMidi((events) => port.postMessage({ midi: events }), scope)    // scope: the one on that program's batches, if any

// The program (JavaScript): its functions are called with what arrived.
const sound = createSound({ sound: { send: (batch) => port.postMessage(batch) } })
port.onmessage = (m) => { if (m.data.midi) sound.receiveMidi(m.data.midi) }
```

A transport that is itself on the page may offer `onMidi(listener, scope)` beside its `send(batch)`, as a player
does, and then `receiveMidi` is not needed. A host that runs a program a frame at a time keeps the events and
hands them over with the next frame; nothing is lost by the wait, because the keyboard has already played the
synth and each event carries its own `time`.

## A scene's own functions

In pictures.js a scene has functions with names the app looks for (`update`, `draw`, `onKeyDown`). MIDI has the
same: `onMidiNote(note, velocity, channel)`, `onMidiNoteOff(note, channel)`, `onMidiControl(number, value,
channel)`, `onMidi(message)` and `onMidiDevices(devices)`, and their Python spellings (`on_midi_note`). An app
wires them with one call, given whatever holds the scene's functions:

```js
sound.useMidiHooks(scene)          // every one of those the scene has is called from now on
```

Nothing is asked of the browser unless the scene has at least one. Until an app does this, a scene registers its
own: `onMidiNote((note, velocity) => { … })`. When a scene defines `onMidiNoteOff`, a key coming up goes there;
when it does not, `onMidiNote` is called with velocity 0.

## Writing a sender

In another language, MIDI is: write the commands above into the frame's batch, and call the program's functions
with the events the host hands over.

- `sendMidiNote` is two `send` commands, a note-on at `t` and a note-off at `t + length`. Velocity 0 to 1 becomes
  1 to 127 (never 0, which would be a note-off).
- Keep the devices from the latest `devices` event for `midiDevices()`; it is empty until the first arrives.
- For `learn` and `mapMidi`, send the setting's `min`, `max` and `kind` from `synths-names.json`, and on a `set`
  event update the setting you remember for that synth, so that reading it back is right.
- `synths-names.json` has `midi`: `types` (every `type` above), `does` (every `do`), and `functions` and
  `synthFunctions`, the names synths.js gives its own, to be spelt the Python way.
- Check what the person wrote and say what is wrong where they wrote it: a note from 0 to 127, a channel from
  1 to 16, a control from 0 to 127.

## What a native app needs

For an app whose web view has no Web MIDI (an iPad), the transport above over the app's bridge is the whole of
it. On the native side, with CoreMIDI:

- **List**: the sources and destinations, by display name, and a notice when the setup changes
  (`MIDIClientCreateWithBlock`'s notification), which becomes `changed`.
- **Receive**: one input port connected to every source; for each packet, the bytes, the source's name and its
  timestamp, posted to the page, which calls the `receive` listener. Convert the timestamp (host time) to the
  page's `performance.now()` by taking both clocks once at the same moment; or send none, and the arrival time is used.
- **Send**: `send(bytes, time, output)` becomes one `MIDISend` (or `MIDISendEventList`) to the named destination,
  with `time` converted back to host time so that CoreMIDI does the waiting.
- **Permission**: USB MIDI needs none. Bluetooth MIDI needs the Bluetooth permission and a
  pairing screen (`CABTMIDICentralViewController`), which is the app's to show.

Nothing else is native: reading the bytes, the keyboard that plays a synth, mapping, timing and the queue are all
in the desk, in the page.
