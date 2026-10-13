// Record a tune: play the keys, and keep what you played as a WAV file. No microphone is needed: this records
// the sound the page makes, not the room.
// Play it with a finger, the mouse, or the keys A S D F G H J (white) and W E T Y U (black); Z and X change octave.
// Try changing: "pluck" to "organ" or "chip"; the echo; the file's name; { max: 60 } for a longer tune.
//
// This is a pictures.js scene that uses dials.js (https://github.com/johnwylie70/dials.js) for the controls.
// Run it: open examples/index.html and press Record a tune.

const { button, dial, keyboard, scope, label } = await use("../../dials.js/dials.js")
const { makeSynth, recordOutput, saveSound, soundOutput, stopSound } = await use("../synths.js")

const lead = makeSynth("pluck", { echo: 0.3 })
let tune = null

const says = label("press record, then play")
button("record", () => {
  tune = recordOutput({ max: 30 })                           // everything that is played, until stop (or 30 seconds)
  says.value = "recording: play something"
  tune.onDone(() => { says.value = "recorded " + tune.seconds.toFixed(1) + " seconds: play it, or save it" })
})
button("stop", () => { if (tune) tune.stopRecording() })
button("play", () => { if (tune && tune.done) tune.play() })
button("save", () => { if (tune) saveSound(tune, "my-tune.wav") })
dial("echo", lead, "echo")
scope(soundOutput())
keyboard(lead, { octave: 4 })

function onStop() {
  if (tune) tune.stopRecording()
  stopSound()
}
