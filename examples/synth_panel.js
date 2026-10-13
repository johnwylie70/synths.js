// Synth panel: a synth with dials for its settings, the wave it is making, a meter and a piano keyboard.
// Play it with a finger, the mouse, or the keys A S D F G H J (white) and W E T Y U (black); Z and X change octave.
// Try changing: "lead" to "bass" or "chip"; add dial("vibrato", lead, "vibrato"); hold a chord with startArp.
//
// This is a pictures.js scene that uses controls.js (https://github.com/johnwylie70/controls.js) for the dials:
// each control is tied to the synth by name, and takes its range from it. Both are fetched in the first two lines.
// Run it: open examples/index.html and press Synth panel (controls.js and pictures.js sit beside this repository).

const { dial, slider, select, scope, meter, keyboard } = await use("../../controls.js/controls.js")
const { makeSynth } = await use("../synths.js")

const lead = makeSynth("lead")

select("wave", lead, "wave")
dial("cutoff", lead, "cutoff")
dial("resonance", lead, "resonance")
dial("echo", lead, "echo")
slider("attack", lead, "attack")
slider("release", lead, "release")
scope(lead)
meter(lead)
keyboard(lead, { octave: 4 })
