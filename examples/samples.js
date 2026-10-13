// Samples: recorded sounds from files. A sample plays as it was recorded, or at another pitch like any synth.
// Try changing: the pattern; "C5" to play the tone higher; reverb; your own .wav or .mp3 beside this file.
//
// Run it: open examples/index.html and press Samples.

import { loadSample } from "../synths.js"

const thud = loadSample("sounds/thud.wav")
const clap = loadSample("sounds/clap.wav", { reverb: 0.3 })
const tone = loadSample("sounds/tone.wav", { loop: true, note: "A4", release: 0.2 })   // the note the recording is

thud.playNotes("C4 - - C4 - - C4 -", 0.15, { repeat: true })
clap.playNotes("- - C4 - - - C4 C4", 0.15, { repeat: true })

// The same recording, played as a tune. It loops for as long as each note lasts.
tone.playNotes("A4 C5 E5 A5 E5 C5", 0.3, { repeat: true, volume: 0.5 })
