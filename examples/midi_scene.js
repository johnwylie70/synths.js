// MIDI scene: every key played on a MIDI keyboard throws a ball up the picture and rings a bell, and any knob
// or slider you turn changes how big the balls are. onMidiNote and onMidiControl call your functions.
// Try changing: "bell" to "pluck"; the colours; make the knob change the reverb instead (bell.reverb = value).
//
// This is a pictures.js scene (https://github.com/johnwylie70/pictures.js).
// Run it: open examples/index.html and press MIDI scene, and let the page use your MIDI devices.
// With no keyboard plugged in, a click or a key of the computer pretends to be one.

const { makeSynth, onMidiNote, onMidiControl, onMidiDevices, receiveMidi, stopMidi, stopSound } = await use("../synths.js")

const bell = makeSynth("bell", { reverb: 0.4 })
let balls = []
let size = 0.4
let message = "Looking for a MIDI keyboard"

onMidiNote((note, velocity) => {
  if (velocity === 0) return                       // velocity 0 is the key coming up
  bell.play(note, 0.4, velocity)
  balls.push({ x: width * (note - 36) / 60, y: height, speed: 150 + 450 * velocity, colour: `hsl(${note * 30}, 90%, 60%)` })
})

onMidiControl((number, value) => {
  size = value                                     // a knob's value goes from 0 to 1
})

onMidiDevices((devices) => {
  message = devices.inputs.length ? "Play " + devices.inputs.join(", ") + ", and turn a knob" : "No MIDI keyboard was found: click, or press a key, to pretend"
})

// With no keyboard: receiveMidi hands the program a message just as a keyboard would.
function pretend(note) {
  receiveMidi({ type: "noteOn", note: note, velocity: 0.8, channel: 1 })
}
function onMouseDown(x, y) {
  pretend(Math.round(36 + 60 * x / width))
  size = 1 - y / height
}
function onKeyDown(key) {
  pretend(48 + key.charCodeAt(0) % 25)
}

function update(dt) {
  for (const ball of balls) ball.y -= ball.speed * dt
  balls = balls.filter((ball) => ball.y > -60)
}

function draw() {
  background("black")
  for (const ball of balls) circle(ball.x, ball.y, 6 + 44 * size, ball.colour)
  text(message, width / 2, 30, "white", 16, "centre")
}

function onStop() {
  stopMidi()
  stopSound()
}
