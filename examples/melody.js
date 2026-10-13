// Melody: a tune written as ordinary code, one line a note. Each note begins where the one before it ended,
// so there is no arithmetic: change a length and everything after it moves along.
// Try changing: setTempo(100) to 160; "quarter" to "eighth"; the notes; add a note inside the loop.
//
// Run it: open examples/index.html and press Melody.

import { setTempo, note, rest, chord, makeSynth, loopNotes } from "../synths.js"

setTempo(100)

// The tune, on the synth that playNote uses. A length is "whole", "half", "quarter", "eighth" or "sixteenth".
note("E4", "quarter")
note("E4", "quarter")
note("F4", "quarter")
note("G4", "quarter")
for (const name of ["G4", "F4", "E4", "D4"]) note(name, "quarter")      // a loop writes notes too
note("C4", "quarter")
note("C4", "quarter")
note("D4", "quarter")
note("E4", "quarter")
note("E4", "quarter.")                     // a dot makes it half as long again
note("D4", "eighth")
note("D4", "half")
rest("quarter")
chord("C", "half")

// A bass of its own synth, written after the tune, plays along with it from the start.
const bass = makeSynth("bass")
for (const name of ["C2", "G2", "C2", "G2", "C2", "G2", "D2", "G2"]) bass.note(name, "half")

// A section written once that goes round and round: a drum beat, for as long as the page is open.
const kick = makeSynth("chipKick"), hat = makeSynth("chipHat", { volume: 0.4 })
loopNotes(() => {
  kick.note("C3", "quarter")
  kick.rest("quarter")
  for (let i = 0; i < 4; i++) hat.note("C5", "eighth")
})
