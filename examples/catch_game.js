// Catch: a tiny game with sound, drawn with pictures.js. Catch the stars in the basket; a rock costs a life.
// Use: move the mouse, or drag a finger. A tap plays again.
// Try changing: "coin" and "hit" to other sounds; the tune; 0.5, the seconds between stars.
//
// This is a pictures.js scene (https://github.com/johnwylie70/pictures.js). Until sound is built into
// pictures.js, the first line fetches the sound functions; after that they are used like the drawing ones.
// Run it: open examples/index.html and press Catch.

const { playSound, makeSynth, stopSound } = await use("../synths.js")

const basket = new Sprite("🧺", 200, 250, 64)
let things = []
let score = 0
let lives = 3
let next = 0

const music = makeSynth("chipLead", { volume: 0.4 })
const bass = makeSynth("chipBass", { volume: 0.6 })

function start() {
  score = 0
  lives = 3
  things = []
  music.playNotes("E5 G5 C6 G5 E5 G5 A5 G5", 0.15, { repeat: true })
  bass.playNotes("C3:2 C3:2 F3:2 G3:2", 0.15, { repeat: true })
}

function update(dt) {
  if (lives <= 0) {
    if (pressed.has(" ") || mouse.down) start()
    return
  }
  if (mouse.inside) basket.x = mouse.x
  basket.y = height - 50

  next -= dt
  if (next <= 0) {
    next = 0.5
    const thing = new Sprite(random() < 0.25 ? "🪨" : "⭐", random(20, width - 20), -20, 36)
    thing.vy = random(150, 260)
    things.push(thing)
  }

  for (const thing of [...things]) {
    thing.update(dt)
    if (thing.touches(basket)) {
      remove(things, thing)
      if (thing.picture === "⭐") {
        score += 1
        playSound("coin", { pitch: score % 12 })      // each star a little higher
      } else {
        lives -= 1
        playSound(lives > 0 ? "hit" : "lose")
        if (lives <= 0) stopMusic()
      }
    } else if (thing.y > height + 30) remove(things, thing)
  }
}

function stopMusic() {
  music.stop()
  bass.stop()
}

function draw() {
  background("midnightblue")
  for (const thing of things) thing.draw()
  basket.draw()
  text("Score " + score + "   " + "❤️".repeat(Math.max(0, lives)), 12, 30, "white", 20)
  if (lives <= 0) text("Game over. Tap to play again", width / 2, height / 2, "white", 24, "centre")
}

function onStop() {
  stopSound()
}

start()
