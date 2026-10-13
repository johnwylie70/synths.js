// My synth: make a synth from a few settings, play a chord and some notes, and change it while it plays.
// Try changing: "saw" to "square" or "triangle"; 1200, how bright it is; 0.3, how long a note dies away; echo.
//
// Run it: open examples/index.html and press My synth.

import { makeSynth } from "../synths.js"

const lead = makeSynth({ wave: "saw", cutoff: 1200, attack: 0.01, release: 0.3 })

lead.play(["C4", "E4", "G4"], 1)              // three notes at once: a chord

lead.echo = 0.4                               // a setting is a plain property
lead.play("C5", 0.2, { after: 1.2 })
lead.play("G4", 0.2, { after: 1.4 })
lead.play("E4", 0.6, { after: 1.6 })

// A note that stays until it is stopped, and can be moved while it sounds.
const bass = makeSynth("bass")
const note = bass.start("C2", { after: 2.4 })
setTimeout(() => note.slideTo("G2", 0.5), 3000)
setTimeout(() => note.stop(), 4000)

// Sweep the brightness of the lead while a long chord plays.
setTimeout(() => {
  lead.cutoff = 200
  lead.play(["C3", "G3", "E4"], 2.5)
  lead.set({ cutoff: 6000 }, { glide: 2 })
}, 4200)
