# The piano recordings

Nine notes of a grand piano, one every half octave: `piano-C2.wav`, `piano-Fs2.wav` (F sharp), `piano-C3.wav`,
`piano-Fs3.wav`, `piano-C4.wav`, `piano-Fs4.wav`, `piano-C5.wav`, `piano-Fs5.wav`, `piano-C6.wav`. Each is one
channel at 32 kHz, 2.5 to 5.5 seconds long, 2.4 MB in all.

They are from the [University of Iowa Musical Instrument Samples](https://theremin.music.uiowa.edu/MIS.html)
(University of Iowa Electronic Music Studios), whose page says they "may be downloaded and used for any projects,
without restrictions". For this example they were cut to length and made one channel at 32 kHz.

`examples/piano.js` plays them as one instrument with `loadSamples`.
