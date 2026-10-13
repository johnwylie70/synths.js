# The microphone

How sound gets *in*: for an app that shows scenes, a binding in another language, or a native app. A program
only calls `useMicrophone()`, `recordSound(3)` and `saveSound(take, "hello.wav")`; this is what happens
underneath, and what a host has to provide where a browser page cannot ask for a microphone itself. The commands
(`mic`, `record`, `save`) and what comes back are in [commands.md](commands.md).

- [The shape of it](#the-shape-of-it)
- [Where a microphone exists](#where-a-microphone-exists)
- [What the browser is asked for](#what-the-browser-is-asked-for)
- [The `microphone` option: a host's own microphone](#the-microphone-option-a-hosts-own-microphone)
- [A program in a frame, a worker or Python](#a-program-in-a-frame-a-worker-or-python)
- [Hearing yourself, and howling](#hearing-yourself-and-howling)
- [How late it is](#how-late-it-is)
- [Recording and saving](#recording-and-saving)
- [What a native app needs](#what-a-native-app-needs)

## The shape of it

```
microphone ──▶ player ──▶ the worklet's input ──▶ engine: gain, gate ──▶ one part: voice effects, filter, echo… ──▶ sound
 (getUserMedia, or the host)                            └────────────▶ a recording (a sample)
```

The microphone belongs to the **player**, as the sound card does. The first `mic` command a player is sent
opens it. The engine takes it in one channel and plays it through one of its parts, so everything a synth's
part has, the microphone has: that is why a microphone *is* a synth to the commands. It is not heard until a
`mic` command says `listen: true`.

## Where a microphone exists

| where | |
|---|---|
| a page served over https or from localhost | `getUserMedia` asks the person, once. |
| a page not served securely | No `getUserMedia` at all. The console says what it needs. |
| a frame from another origin | Only with `allow="microphone"` on the `<iframe>`; otherwise it is refused without the person being asked. |
| a sandboxed frame with no origin (`sandbox="allow-scripts"`) | Refused (Chromium), or the question is never answered (WebKit under Playwright); both measured on 2026-10-13. A frame with no origin has nothing a person's answer can be remembered against, so do not count on `allow="microphone"` there: the host's page should have the player, and so the microphone, and be sent the commands. |
| an iPad or iPhone app (WKWebView) | `getUserMedia` works from iOS 14.3 if the app has `NSMicrophoneUsageDescription`, and from iOS 15 the app decides whether the person is asked again (`WKUIDelegate`'s `requestMediaCapturePermissionFor`). The app owns the audio session: asking for the microphone moves it to play-and-record, which changes the route and the level of everything playing. |
| node, or the offline player | None. `createOfflinePlayer({ microphone: samples })` takes sound in its place. |

Whenever there is none, nothing throws. One sentence in the console says why and what to do, the microphone's
`state` says which (`"refused"`, `"none"`, `"busy"`, `"unavailable"`), a recording of it is over at once and
empty, and every other command is carried out as usual. The person is asked when the first `mic` command arrives
(`useMicrophone()`), never when the library loads, and even while the sound itself is still waiting for a tap.

## What the browser is asked for

```js
{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false }
```

A browser's microphone is set up for a phone call. Each of the three is a filter that delays the sound by tens
of milliseconds and reshapes it: a pitch shifter then warbles on the noise remover's edges, and the level pumps
up and down under an echo. So the plain microphone is asked for, in one channel, since a voice is one.
`useMicrophone({ raw: false })` (`raw: false` on the `mic` command) asks for all three instead. That is right for
one case: listening through loudspeakers, where echo cancelling is what stops the howl.

**Sample rate.** The engine does not convert its input, so the input has to arrive at the sound card's rate, and
it does: the stream goes into the worklet through a `MediaStreamAudioSourceNode`, which converts where the two
differ (Chromium and WebKit; Firefox does not convert and does not need to, since a context with no rate asked
for and a microphone are both at the device's rate). The library never asks for a rate, of the context or of the
microphone. The worklet node has one input, mixed down to one channel; with nothing connected it costs nothing.

**No worklet.** On the fallback (a ScriptProcessorNode on the page's thread) the input is carried too, a buffer
at a time (2048 frames unless `fallbackBuffer` says otherwise), so it is about 45 milliseconds later each way. A page that has no worklet because it is not
served securely has no `getUserMedia` either, so this matters only to a host that supplies the microphone.

## The `microphone` option: a host's own microphone

`createPlayer({ microphone })`, also taken by `createSound` and `configure` for the player they make. Any of:

```js
microphone: false                                   // there is none here: never ask
microphone: stream                                  // a MediaStream (or a promise of one) the host already has
microphone: (wants) => stream                       // a function called when the microphone is first wanted
microphone: {
  open(wants) { … },                                // called when the microphone is first wanted
  close() { … },                                    // called when it is let go
}
```

`wants` is `{ sampleRate, raw, constraints, push }`: the sound card's sample rate, whether the plain microphone
is wanted, the constraints above ready to hand to `getUserMedia`, and where to push frames. What `open` (or the
function) gives back, at once or as a promise, decides how the sound comes in:

| it gives | |
|---|---|
| a `MediaStream` | It is connected to the worklet's input. The host stops its tracks in `close()`: the library stops only a stream it asked the browser for itself. |
| `true` (or any object that is not a stream) | **The host pushes the frames.** It calls `wants.push(frames, sampleRate)` whenever it has some: a `Float32Array` of one channel, from -1 to 1, any number of frames at a time. Leave `sampleRate` out when it is `wants.sampleRate`; give it otherwise and the frames are brought to the sound card's rate with straight lines between samples, which is good enough for a voice, so prefer to capture at the rate asked for. |
| `false`, `null` or nothing | There is no microphone. |
| it throws, or the promise is refused | There is no microphone. An error named as the browser names its own (`NotAllowedError`, `NotFoundError`, `NotReadableError`) gets the matching message; anything else is quoted. |

Pushed frames wait in a ring in the engine's thread and are played out a block at a time. Playing begins when
one lump and a little more is in hand (a lump and up to 2048 frames), and begins again like that if the ring
runs dry, so lumps that arrive unevenly are not heard as gaps: push small lumps (10 to 20 milliseconds) for a
short delay. If more than a quarter of a second is ever waiting, the oldest is let go. Nothing is pushed back at
the host, and `push` may be called from any callback on the page's thread.

## A program in a frame, a worker or Python

The program's side needs nothing: `useMicrophone()` writes a `mic` command into the same batches as everything
else. The host's page has the player, so the host's page is where the person is asked, and where the `microphone`
option goes if the host wants to supply it. Three things travel back, as plain data:

```js
player.onSoundEvents((events) => port.postMessage({ sound: events }), scope)    // beside the player
port.onmessage = (m) => { if (m.data.sound) sound.receiveSoundEvents(m.data.sound) }   // where the program is
```

`{ type: "microphone", state }`, `{ type: "recorded", id, frames, seconds }` and `{ type: "saved", id, ask, name,
bytes }`. Without them a program still runs, but a recording never says it is done, `saveSound` never gives its
bytes, and `mic.state` stays `"asking"`. What a scope and a meter show is read as for any synth: `player.read(id)`.

Saving: `saveSound` reaches the player as a `save` command, and the player downloads the file from its own page.
A sandboxed frame may not download, which is another reason for the player to be the host's. `createPlayer({
save(file) })` is given `{ name, bytes, type: "audio/wav" }` in place of the download, for a host that keeps
files its own way.

## Hearing yourself, and howling

A microphone that is heard through loudspeakers hears itself, and the sound goes round and grows into a howl. So:

- The microphone is **not heard until `listen()`**. Recording, the scope and the meter work without it.
- The first time a real microphone is listened to, the console says once that headphones are best.
- A microphone starts with a **gate at -50 dB**: anything quieter is taken as silence, so the hiss of a room is
  not echoed, crushed and fed round. `mic.gate = -40` for a noisy room, `mic.gate = "off"` for none.
- With loudspeakers and no headphones, `useMicrophone({ raw: false })` has the browser cancel the echo, at the
  price of the sound.

The engine's limiter keeps a howl from being louder than full volume, and nothing more than that.

## How late it is

Measured in Playwright's browsers on 2026-10-13 at 44100 frames a second, with a click sent in as a
`MediaStream` and found again in the worklet's output, so inside the browser from stream to output:

| | Chromium | WebKit |
|---|---|---|
| no voice | 21.6 ms | 50.0 ms |
| chipmunk (seven semitones up) | 22.7 ms | 51.7 ms |
| monster (seven semitones down) | 29.9 ms | 61.6 ms |

The engine itself adds nothing: the frames that come in with a block go out with that block. All of the plain
figure is the browser carrying a stream into the audio graph. The pitch shifter adds between one frame and 18
milliseconds, depending on where it last jumped. A real microphone and a real loudspeaker add their own on top
(the sound card here said 6 to 32 ms to the loudspeaker), which cannot be measured without them; expect 30 to 60
milliseconds from mouth to ear on a laptop, which is fine for a robot and too late to sing in time with.

## Recording and saving

- A recording is a sample, at the sound card's sample rate, whose own pitch is middle C. It can be played while
  it is still being made.
- **What is recorded** from the microphone is the plain voice, after the gain and the gate, whether or not it is
  listened to. The library then gives the take the microphone's voice and voice effects (as ordinary `set`
  commands), so it plays back as the microphone sounds and can be changed afterwards. `effects: true` records
  after the effects instead, which works only while the microphone is listened to, since a microphone that is
  not listened to is not put through them.
- **How long**: up to 120 seconds. With no length it stops by itself after 30 seconds, or `max`. The memory is
  taken when the recording starts: 30 seconds at 48 kHz is 5.8 MB (twice that for the output, which is stereo).
  At the limit it stops, is done with what it has, and the console says so once.
- **One at a time.** Another recording starting ends the one running.
- A saved file is 16-bit WAV: one channel for the microphone or a synth, two for the output.

## What a native app needs

An app with its own sound engine (synths-core built for iOS or Android) and no browser audio carries out the
same commands itself. For the microphone it needs:

| | |
|---|---|
| to open | On the first `mic` command: ask for permission, set the session for playing and recording (iOS: `.playAndRecord`, mode `.measurement` or `.default` with voice processing off, to match `raw`), and start capturing one channel at the engine's sample rate. Send `{ type: "microphone", state }` back. |
| each block | Copy the block's input into `synths_input_left(engine)` and render with `synths_render_io(engine, frames, 1)` in place of `synths_render`. Input and output are then in one callback, which is as short a delay as the device allows. |
| `mic` | Give the microphone a part and set `input.part` to it; `listen` is `input.monitor`. It starts off (the engine's own default is on). Settings and voices are `param` events on that part, as for a synth. |
| `record` | `synths_record_buffer(engine, slot, frames, channels)` outside the render, then a `record` event (16) at the start and one at the end; `synths_record_read` says when it has stopped. Send `{ type: "recorded", id, frames, seconds }`. |
| `save` | `synths_sample_frames` and `synths_sample_read`, written as a WAV file where the app keeps files. Send `{ type: "saved", id, ask, name, bytes }`, or leave `bytes` out and keep the file. |
| to close | Stop capturing, give the session back to playing alone, send `state: "off"`. |

An app that shows the program in a web view but wants the web view to make the sound uses the `microphone`
option instead: capture natively and `push` the frames across.
