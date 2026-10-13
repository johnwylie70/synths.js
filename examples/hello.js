// Hello: one note, then a short tune. The smallest program that makes a sound.
// Try changing: "C4" to another note ("A3", "F#5"); 0.25, the seconds each step of the tune lasts; the notes of the tune.
//
// Run it: open examples/index.html and press Hello.

import { playNote, playNotes } from "../synths.js"

playNote("C4")                                        // middle C, for half a second

playNotes("E4 G4 C5 - G4 C5:2", 0.25, { after: 1 })   // a second later: a tune. "-" is a rest, ":2" lasts two steps
