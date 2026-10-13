// Sampler: record a word, then play it on the keys. Middle C is the word as you said it; higher keys are
// higher and faster, lower keys lower and slower, and several keys make a chord of you.
// Play it with a finger, the mouse, or the keys A S D F G H J (white) and W E T Y U (black); Z and X change octave.
// Try changing: 1.5, the seconds recorded; word.reverse = true; word.loop = true; word.voice = "robot".
//
// This is a pictures.js scene that uses dials.js (https://github.com/johnwylie70/dials.js) for the controls.
// Run it: open examples/index.html and press Sampler. With no microphone the keys play a bell instead.

const { button, toggle, dial, keyboard, label } = await use("../../dials.js/dials.js")
const { useMicrophone, stopMicrophone, makeSynth, stopSound } = await use("../synths.js")

const mic = useMicrophone()
let word = makeSynth("bell")                                 // what the keys play until a word is recorded

const says = label("press record and say a word")
button("record", () => {
  const take = mic.record(1.5)
  says.value = "recording…"
  take.onDone(() => {
    if (!take.seconds) { says.value = "no microphone here, so the keys play a bell"; return }
    take.release = 0.2
    take.reverb = 0.2
    word = take
    says.value = "now play the keys"
  })
})
button("backwards", () => { word.reverse = !word.reverse })
dial("echo", { set: (name, value) => { word.echo = value }, get: () => word.echo, describe: () => ({ min: 0, max: 1 }) }, "echo")

// The keyboard plays whatever `word` is now.
keyboard({ noteOn: (note, loud) => word.noteOn(note, loud), noteOff: (note) => word.noteOff(note), notes: () => word.notes() }, { octave: 4 })

function onStop() {
  stopMicrophone()
  stopSound()
}
