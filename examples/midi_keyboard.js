// MIDI keyboard: plug a MIDI keyboard in and play. One line does it: lead.playFromMidi().
// The synth follows the notes, how hard each key is hit, the pitch wheel and the sustain pedal.
// Try changing: "keys" to "pad" or "bass"; the reverb; add lead.playFromMidi({ channel: 2 }) to hear one channel alone.
//
// Run it: open examples/index.html and press MIDI keyboard. The browser asks whether the page may use your
// MIDI devices: say yes. With no keyboard plugged in, the computer's keys A S D F G H J K play instead.
// (MIDI works in Chrome, Edge and Firefox on a computer. Safari, iPhones and iPads have none for web pages.)

import { makeSynth, onMidiDevices } from "../synths.js"

const lead = makeSynth("keys", { reverb: 0.3 })

lead.playFromMidi()

onMidiDevices((devices) => {
  if (devices.inputs.length) console.log("Play: " + devices.inputs.join(", "))
  else console.log("No MIDI keyboard was found. Press the keys A to K, or click the page, to play instead.")
})

// The computer's keys, for when there is no MIDI keyboard.
const keys = { a: "C4", s: "D4", d: "E4", f: "F4", g: "G4", h: "A4", j: "B4", k: "C5" }
addEventListener("keydown", (e) => { if (keys[e.key] && !e.repeat) lead.noteOn(keys[e.key]) })
addEventListener("keyup", (e) => { if (keys[e.key]) lead.noteOff(keys[e.key]) })
addEventListener("pointerdown", () => lead.noteOn("E4"))
addEventListener("pointerup", () => lead.noteOff("E4"))
