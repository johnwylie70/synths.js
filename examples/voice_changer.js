// Voice changer: your voice as a robot, a chipmunk or a monster. Pick a voice, then press "listen" to hear
// yourself (wear headphones: through loudspeakers a microphone that hears itself howls), or press "record",
// say something, and press "play" to hear it back in whichever voice is chosen now.
// Try changing: 3, the seconds a recording lasts; add dial("ring", mic, "ring") or dial("crush", mic, "crush");
// play it back higher with take.play("G4").
//
// This is a pictures.js scene that uses dials.js (https://github.com/johnwylie70/dials.js) for the controls.
// Run it: open examples/index.html and press Voice changer. The browser asks whether the page may use the microphone.
// With no microphone everything still works, and there is simply nothing to hear.

const { dial, select, toggle, button, scope, meter, label } = await use("../../dials.js/dials.js")
const { useMicrophone, stopMicrophone, stopSound } = await use("../synths.js")

const mic = useMicrophone()                                  // nothing is heard until it is listened to
let take = null

const says = label("asking for the microphone…")
select("voice", mic, "voice")
dial("pitch", mic, "pitch")
dial("echo", mic, "echo")
toggle("listen", mic, "listening")
button("record", () => {
  take = mic.record(3)                                       // three seconds, starting now
  says.value = "recording…"
  take.onDone(() => { says.value = take.seconds ? "recorded: press play" : "nothing was recorded: there is no microphone" })
})
button("play", () => {
  if (take) take.soundLike(mic).play()                       // the same words in the voice chosen now
})
scope(mic)
meter(mic)

mic.whenReady().then((there) => {
  says.value = there ? "say something" : "no microphone here: " + mic.state
})

function onStop() {
  stopMicrophone()                                           // the browser's recording light goes out
  stopSound()
}
