// Arpeggio: chords from one voice, stepping through their notes fifty times a second, as the tunes of a
// Commodore 64 did. A chip bass and chip drums play underneath.
// Try changing: the chords ("Am", "Fmaj7", "Dsus4"); speed: 50 to 12, to hear the steps; order: "up" to "random".
//
// Run it: open examples/index.html and press Arpeggio.

import { makeSynth, startArp } from "../synths.js"

const chords = ["Am", "F", "C", "G"]
const bar = 1.6                                    // seconds each chord lasts

const chord = startArp(chords[0], { speed: 50, order: "up", volume: 0.5 })
for (let i = 1; i < 16; i++) chord.change(chords[i % 4], { after: i * bar })     // the note never starts again
setTimeout(() => chord.stop(), 16 * bar * 1000)

makeSynth("chipBass").playNotes("A1:4 F1:4 C2:4 G1:4", bar / 4, { repeat: 4 })
makeSynth("chipKick").playNotes("C3 - - - C3 - - -", bar / 8, { repeat: 16 })
makeSynth("chipSnare").playNotes("- - A3 - - - A3 -", bar / 8, { repeat: 16 })
makeSynth("chipHat").playNotes("C5 C5", bar / 8, { repeat: 64, volume: 0.3 })
