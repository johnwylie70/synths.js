// Theremin: press and move. Left to right is the pitch, up and down is how loud.
// Try changing: "sine" to "saw"; 48 and 36, the lowest note and how many notes the page is wide; vibrato; reverb.
//
// Run it: open examples/index.html and press Theremin, then press on the page and move.

import { makeSynth } from "../synths.js"

const voice = makeSynth({ wave: "sine", attack: 0.05, release: 0.4, vibrato: 0.2, reverb: 0.4 })
let note = null

const pitch = (e) => 48 + 36 * e.clientX / innerWidth         // a note number; a fraction is between two notes
const loudness = (e) => 1 - e.clientY / innerHeight

addEventListener("pointerdown", (e) => {
  note = voice.start(pitch(e), loudness(e))
})
addEventListener("pointermove", (e) => {
  if (!note) return
  note.slideTo(pitch(e), 0.03)
  note.volume = loudness(e)
})
addEventListener("pointerup", () => {
  if (note) note.stop()
  note = null
})
