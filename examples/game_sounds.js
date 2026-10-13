// Game sounds: every ready-made sound, one after another. Each is one line in a game: playSound("coin").
// Try changing: 0.7, the seconds between them; add { pitch: 5 } to play one higher; soundNames() to your own list.
//
// Run it: open examples/index.html and press Game sounds.

import { playSound, soundNames } from "../synths.js"

soundNames().forEach((name, i) => {
  playSound(name, { after: i * 0.7 })
})
