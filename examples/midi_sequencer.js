// MIDI sequencer: sixteen steps that play a synth on your desk (or any MIDI instrument) through sendMidiNote.
// Each note is given the beat it belongs on, so the rhythm is exact however busy the page is.
// Try changing: the notes in steps ("-" is a rest); 110, the tempo; { channel: 10 } to play a drum machine;
// useMidiOutput("the name") to choose which instrument, from midiDevices().outputs.
//
// Run it: open examples/index.html and press MIDI sequencer, and let the page use your MIDI devices.
// With nothing plugged in you still hear it: the same notes are played on a synth on this page.

import { sendMidiNote, sendMidiControl, makeSynth, setTempo, beats, onMidiDevices } from "../synths.js"

const steps = ["C2", "-", "C3", "C2", "Eb2", "-", "C3", "G2", "C2", "-", "C3", "C2", "F2", "G2", "Bb2", "C3"]
const bars = 8

setTempo(110)
const here = makeSynth("bass", { volume: 0.5 })      // the synth on this page

for (let bar = 0; bar < bars; bar++) {
  steps.forEach((note, step) => {
    if (note === "-") return
    const beat = 0.5 + bar * 4 + step / 4              // four steps to a beat, four beats to a bar, starting half a beat from now
    const loud = step % 4 === 0 ? 1 : 0.6              // the first step of each beat is the loudest
    sendMidiNote(note, loud, { length: beats(0.2), beat: beat })
    here.play(note, beats(0.2), { volume: loud, beat: beat })
  })
  // Control 74 is "brightness" on most synths: open the filter a little more each bar.
  sendMidiControl(74, bar / (bars - 1), { beat: 0.5 + bar * 4 })
}

onMidiDevices((devices) => {
  if (devices.outputs.length) console.log("Playing " + devices.outputs[0] + ". The others are: " + devices.outputs.slice(1).join(", "))
  else console.log("No MIDI instrument was found, so you are hearing the synth on this page instead.")
})
