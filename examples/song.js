// Song: a whole tune played by the sound engine from one file, the way a tracker plays it.
// "Night Drive" is in songs/night_drive.json: open it, it is made to be read and changed by hand.
// Its chords are arpeggios on one channel; its bass, drums and tune are synths, named in the file and chosen here.
// Try changing: "bell" to "lead" or "chipLead"; volume; song.seek(2) to jump to the third part; a .mod or .xm of your own.
//
// Run it: open examples/index.html and press Song.

import { playSong, playSound } from "../synths.js"

const song = playSong("songs/night_drive.json", {
  volume: 0.9,
  patches: { tune: { preset: "bell", echo: 0.3 } },     // "bass", "chipKick" and "chipSnare" are ready-made synths
})

// A game's own sounds play over a song. And the song can be asked where it is:
setTimeout(() => playSound("coin"), 2000)
setTimeout(() => console.log("the song is at", song.position), 3000)
