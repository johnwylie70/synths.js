// MIDI dials: a synth panel that a MIDI controller works. The keyboard plays the synth, and the first three
// knobs you turn become the cutoff, the resonance and the echo: the dial on the screen turns with the knob.
// Try changing: "lead" to "pad"; learn another setting ("attack", "reverb"); or tie a knob by its number
// with lead.mapMidi(74, "cutoff") instead of learning it.
//
// This is a pictures.js scene that uses dials.js (https://github.com/johnwylie70/dials.js) for the dials.
// Run it: open examples/index.html and press MIDI dials (dials.js and pictures.js sit beside this repository).
// With no controller plugged in it is still a synth panel: turn the dials and play the keys by hand.

const { dial, scope, keyboard } = await use("../../dials.js/dials.js")
const { makeSynth, onMidiDevices, stopMidi, stopSound } = await use("../synths.js")

const lead = makeSynth("lead")

const cutoff = dial("cutoff", lead, "cutoff")
const resonance = dial("resonance", lead, "resonance")
const echo = dial("echo", lead, "echo")
scope(lead)
keyboard(lead, { octave: 4 })

lead.playFromMidi()                                          // the MIDI keyboard plays it

// learn: the next knob that is moved turns this setting from then on. The function is given each new value.
lead.learn("cutoff", (value) => { cutoff.value = value })
lead.learn("resonance", (value) => { resonance.value = value })
lead.learn("echo", (value) => { echo.value = value })

onMidiDevices((devices) => {
  if (devices.inputs.length) console.log("Turn three knobs on " + devices.inputs[0] + ": they become the cutoff, the resonance and the echo.")
  else console.log("No MIDI controller was found: turn the dials and play the keys by hand.")
})

function onStop() {
  stopMidi()
  stopSound()
}
