// Drum beat: a kick, a snare, a hat and a bass line, each a tune that repeats. They stay together because
// the sound engine keeps the time, not the page.
// Try changing: 0.125, the seconds in a step (smaller is faster); the patterns ("-" is a rest); "bass" to "chipBass".
//
// Run it: open examples/index.html and press Drum beat.

import { makeSynth } from "../synths.js"

const step = 0.125
const forever = { repeat: true }

makeSynth("kick").playNotes("C2 - - - C2 - - - C2 - - - C2 - C2 -", step, forever)
makeSynth("snare").playNotes("- - - - D3 - - - - - - - D3 - - D3", step, forever)
makeSynth("hat").playNotes("C4 C4 C4 C4", step, { repeat: true, volume: 0.4 })
makeSynth("bass").playNotes("C2 - C2 C3 - C2 - Eb2 F2 - F2 F3 - G2 Bb2 -", step, forever)

const pluck = makeSynth("pluck", { echo: 0.4 })
pluck.playNotes("C5 Eb5 G5 Bb5 G5 Eb5 C5 -", step * 2, { repeat: true, after: step * 32 })
