// Piano: a real piano made of nine recordings, one every half octave from C2 to C6.
// Each key plays the nearest recording, moved to its pitch, so no note is stretched by more than three keys.
// Play it with a finger, the mouse, or the keys A S D F G H J (white) and W E T Y U (black); Z and X change octave.
// Try changing: leave out every second file and hear the notes between get thinner; crossfade: 0; reverbType to "room".
//
// The recordings are from the University of Iowa Musical Instrument Samples (https://theremin.music.uiowa.edu/MIS.html),
// which may be downloaded and used for any projects, without restrictions: see piano/README.md.
//
// This is a pictures.js scene that uses dials.js (https://github.com/johnwylie70/dials.js) for the keys and dials.
// Run it: open examples/index.html and press Piano (dials.js and pictures.js sit beside this repository).

const { dial, select, scope, meter, keyboard } = await use("../../dials.js/dials.js")
const { loadSamples } = await use("../synths.js")

// The note each was played at is in its name: C2, Fs2 (F sharp), C3 …
const piano = loadSamples([
  "piano/piano-C2.wav", "piano/piano-Fs2.wav", "piano/piano-C3.wav", "piano/piano-Fs3.wav", "piano/piano-C4.wav",
  "piano/piano-Fs4.wav", "piano/piano-C5.wav", "piano/piano-Fs5.wav", "piano/piano-C6.wav",
], { crossfade: 2, reverb: 0.25, reverbType: "hall" })

dial("reverb", piano, "reverb")
select("room", piano, "reverbType")
dial("volume", piano, "volume")
scope(piano)
meter(piano)
keyboard(piano, { octave: 3, octaves: 3 })

// A chord to begin with, so there is something to hear before a key is touched.
piano.playNotes("C3 G3 E4 G4 C5:2", 0.18, { volume: 0.7 })
