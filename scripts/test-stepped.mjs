#!/usr/bin/env node
/**
 * The stepped player (createPlayer({ stepped })), which a video recorder uses: sound made one video frame at a
 * time, on the clock the recorder moves. Without a browser, with the real engine:
 *
 *   node scripts/test-stepped.mjs
 *
 * It ends with code 1 if a case fails.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSound, createPlayer, createOfflinePlayer, createSteppedPlayer } from '../synths.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR = 48000
let failed = 0, count = 0
const say = (ok, what, got) => {
  count++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`)
}
const CLICK = { wave: 'sine', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0 }
const first = (a, over = 0) => a.findIndex((v) => Math.abs(v) > over)
// How many samples differ, and by how much at most.
function differ(a, b) {
  let n = a.length === b.length ? 0 : Infinity, most = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = Math.abs(a[i] - b[i]); if (d > 0) n++; if (d > most) most = d }
  return [n, most]
}
// A page's clock that a recorder moves, and a sound that reads it.
function stage(options = {}) {
  const clock = { now: 0 }
  const player = createPlayer({ stepped: { fps: options.fps || 60, sampleRate: options.sampleRate || SR, ...options.stepped } })
  const sound = createSound({ sound: player, clock: () => clock.now, read: options.read })
  return { clock, player, sound, stepped: player.stepped }
}
const song = new Uint8Array(await readFile(join(ROOT, 'examples', 'songs', 'night_drive.json')))

// --- it is the offline player, a frame at a time
{
  // The same program for both: notes at awkward times, a tune in beats, a chord, a change of setting, a game sound.
  const program = (s) => {
    const lead = s.makeSynth('lead')
    s.setTempo(140)
    lead.play('C4', { at: 0.0131, length: 0.3 })
    lead.playNotes('C4 E4 G4 C5 . G4 E4 C4', { at: 0.25 })
    s.makeSynth('pad').play(['C3', 'G3', 'Eb4'], { at: 0.5, length: 1.2 })
    s.playSound('coin', { at: 0.777 })
    s.setEffects({ reverbSize: 0.7, echoTime: 0.2 })
    lead.set({ echo: 0.3, reverb: 0.4 })
    lead.set({ cutoff: 900 })
  }
  const offline = await createOfflinePlayer()
  const a = createSound({ sound: offline, clock: () => 0 })
  program(a)
  a.flush()
  const whole = await offline.render(3.1)
  for (const fps of [60, 30, 30000 / 1001]) {
    const { sound, stepped } = stage({ fps })
    program(sound)
    const frames = Math.round(3 * fps)
    for (let n = 0; n < frames; n++) await stepped.step()
    const got = stepped.take()
    const want = Math.round(frames * SR / fps)
    const [n, most] = differ(got.left, whole.left.subarray(0, want)), [nr, mostR] = differ(got.right, whole.right.subarray(0, want))
    say(got.length === want && n === 0 && nr === 0, `at ${Math.round(fps * 100) / 100} frames a second, ${frames} steps give the very samples the offline player gives in one piece (${want} of them, none different)`, { length: got.length, want, n, most, nr, mostR })
  }
  // The engine at another sample rate.
  const low = await createOfflinePlayer({ sampleRate: 44100 })
  const b = createSound({ sound: low, clock: () => 0 })
  program(b)
  b.flush()
  const wholeLow = await low.render(2)
  const { sound, stepped } = stage({ fps: 60, sampleRate: 44100 })
  program(sound)
  for (let n = 0; n < 120; n++) await stepped.step()
  const gotLow = stepped.take()
  say(gotLow.length === 88200 && differ(gotLow.left, wholeLow.left)[0] === 0 && gotLow.sampleRate === 44100, 'and the same at 44100 samples a second (735 a frame)', [gotLow.length, differ(gotLow.left, wholeLow.left)])
}

// --- no drift: ten minutes
{
  for (const fps of [60, 30, 30000 / 1001, 24, 25, 50, 59.94]) {
    for (const rate of [48000, 44100]) {
      const player = createSteppedPlayer({ stepped: { fps, sampleRate: rate }, wasm: null })
      const frames = Math.round(600 * fps)
      let most = 0, least = Infinity, last = 0
      player.stepped.keep = false
      for (let n = 1; n <= frames; n++) {
        await player.stepped.step()
        const made = player.stepped.samples - last
        last = player.stepped.samples
        if (made > most) most = made
        if (made < least) least = made
        // Never more than half a sample from where the frame is.
        if (Math.abs(player.stepped.samples - n * rate / fps) > 0.5) { most = Infinity; break }
      }
      const want = Math.round(frames * rate / fps)
      if (fps === 60 || fps === 30 || fps === 30000 / 1001) say(player.stepped.samples === want && most - least <= 1, `ten minutes at ${Math.round(fps * 100) / 100} frames a second and ${rate} samples: ${frames} steps are ${want} samples to the sample, every step ${least}${most > least ? ' or ' + most : ''}`, [player.stepped.samples, want, least, most])
      else if (player.stepped.samples !== want || most - least > 1) say(false, `ten minutes at ${fps} frames a second and ${rate}`, [player.stepped.samples, want, least, most])
      player.close()
    }
  }
  say(true, 'and the same holds at 24, 25, 50 and 59.94 frames a second')
  // By the clock, as a recorder that counts milliseconds does it.
  const { stepped, player } = stage({ fps: 60 })
  stepped.keep = false
  const step = 1000 / 60
  for (let n = 1; n <= 36000; n++) await stepped.advance(n * step / 1000)
  say(stepped.samples === 36000 * 800, 'advance(seconds) with the clock a recorder keeps in milliseconds (n × 1000 / 60) is as exact: ten minutes are 28 800 000 samples', stepped.samples)
  player.close()
}

// --- the clocks move with the steps and with nothing else
{
  const { clock, sound, stepped, player } = stage({ fps: 60 })
  sound.setTempo(120)
  const music = sound.playSong(song)
  const seen = []
  let wrong = null
  for (let n = 0; n < 240; n++) {
    clock.now = n / 60
    await stepped.advance(clock.now)
    // What a scene's draw() would read in frame n.
    const at = music.position
    seen.push([at.state, at.order, at.row, at.tick])
    if (Math.abs(sound.soundTime() - n / 60) > 1e-12 || Math.abs(sound.beat() - n / 30) > 1e-9 || stepped.samples !== n * 800) wrong = [n, sound.soundTime(), sound.beat(), stepped.samples]
  }
  // Waiting does nothing: only a step moves it.
  const before = JSON.stringify(music.position)
  await new Promise((done) => setTimeout(done, 60))
  const still = JSON.stringify(music.position) === before && stepped.samples === 240 * 800 - 800
  // The song's place against the engine's own, rendered in one piece: the row at each frame's first sample.
  const offline = await createOfflinePlayer()
  const o = createSound({ sound: offline, clock: () => 0 })
  o.playSong(song)
  o.flush()
  const want = []
  for (let n = 0; n < 240; n++) { if (n) await offline.render(1 / 60); else await offline.render(0); const at = offline.songPosition(); want.push([at.state, at.order, at.row, at.tick]) }
  const rows = new Set(seen.map((p) => p[1] * 1000 + p[2])).size
  say(!wrong && still && JSON.stringify(seen) === JSON.stringify(want) && rows > 10 && seen[0][0] !== 'playing' && seen[1][0] === 'playing',
    `soundTime(), beat() and a song's position move exactly with the steps (${rows} rows gone by in four seconds, each on the frame the engine says), and stand still between them`, { wrong, still, rows, seen: seen.slice(0, 4), want: want.slice(0, 4) })
  player.close()
}

// --- a note asked for in frame N starts on frame N's sample
{
  for (const fps of [60, 30, 30000 / 1001]) {
    const { clock, sound, stepped, player } = stage({ fps })
    const lead = sound.makeSynth(CLICK)
    const asked = [0, 7, 31, 100, 101, 250]
    const tick = async (n) => { clock.now = n / fps; await stepped.advance(clock.now) }
    for (let n = 0; n <= 300; n++) {
      await tick(n)
      // A scene's draw(): the note is asked for with nothing said about when.
      if (asked.includes(n)) lead.play('A4', { length: 0.01 })
    }
    const got = stepped.take()
    const starts = []
    let silent = 200
    for (let i = 0; i < got.length; i++) {
      if (Math.abs(got.left[i]) > 1e-5) { if (silent >= 200) starts.push(i); silent = 0 } else silent++
    }
    const want = asked.map((n) => Math.round(n * SR / fps))
    const off = starts.map((s, i) => s - want[i])
    say(starts.length === want.length && off.every((d) => d === 0), `at ${Math.round(fps * 100) / 100} frames a second a note asked for in frames ${asked.join(', ')} starts on that frame's first sample (${want.join(', ')})`, { starts, want, off })
    player.close()
  }
  // A time it names is kept too, to the sample, inside a frame and frames ahead.
  const { clock, sound, stepped, player } = stage({ fps: 30 })
  const lead = sound.makeSynth(CLICK)
  lead.play('A4', { at: 0.5, length: 0.02 })
  lead.play('A4', { after: 0.2501, length: 0.02 })
  for (let n = 1; n <= 30; n++) { clock.now = n / 30; await stepped.advance(clock.now) }
  const got = stepped.take()
  const one = first(got.left, 1e-5), two = first(got.left.subarray(0.4 * SR), 1e-5) + 0.4 * SR
  say(one === Math.round(0.2501 * SR) && two === 0.5 * SR, 'a note with { at } or { after } lands on the sample of that time, inside a frame or many frames ahead', [one, two])
  player.close()
}

// --- what is read back is the frame being drawn
{
  const { clock, sound, stepped, player } = stage({ fps: 60 })
  const lead = sound.makeSynth({ ...CLICK, volume: 1 })
  const levels = []
  for (let n = 0; n < 40; n++) {
    clock.now = n / 60
    await stepped.advance(clock.now)
    if (n === 10) lead.play('A3', { length: 0.1 })
    levels.push([lead.level()[0] > 0.01, lead.samples().some((v) => Math.abs(v) > 0.01), lead.notes().length])
  }
  // Asked for in frame 10: nothing yet in frame 10's own reading, there in frame 11, and the key is up after six frames.
  const on = levels.findIndex((l) => l[0]), wave = levels.findIndex((l) => l[1]), key = levels.findIndex((l) => l[2] > 0), up = levels.findIndex((l, i) => i > key && l[2] === 0)
  say(on === 11 && wave === 11 && key === 11 && up === 17 && sound.soundOutput().samples().length === 1024, 'level(), samples() and notes() are the engine at the frame being drawn: a note asked for in frame 10 is read from frame 11 and its key is up six frames later', { on, wave, key, up })
  player.close()
}

// --- a file that takes its time, and commands before the engine is there
{
  // The song is read by the host (as a scene's files are in an app), and the reading takes 80 ms of real time.
  const slow = (path) => new Promise((done) => setTimeout(() => done(path === 'tune.json' ? song : null), 80))
  const runs = []
  for (const wait of [0, 30]) {
    const { clock, sound, stepped, player } = stage({ fps: 60, read: slow })
    for (let n = 0; n < 90; n++) {
      clock.now = n / 60
      await stepped.advance(clock.now)
      if (n === 20) sound.playSong('tune.json')
      // A recorder that is slow for its own reasons, differently each time.
      if (wait && n % 25 === 0) await new Promise((done) => setTimeout(done, wait))
    }
    runs.push(stepped.take())
    player.close()
  }
  const begins = first(runs[0].left, 1e-6)
  const [n] = differ(runs[0].left, runs[1].left)
  say(begins >= 20 * 800 && begins < 20 * 800 + 2400 && n === 0 && runs[0].length === 89 * 800, `a song asked for in frame 20 whose file takes 80 ms to read still starts in frame 20 (first sound at sample ${begins}), and a second recording, slow in other places, is the same samples`, { begins, n, length: runs[0].length })
  // Everything asked for before the engine has loaded is kept, with its times.
  const { sound, stepped, player } = stage({ fps: 60 })
  sound.makeSynth(CLICK).play('A4', { at: 0.1, length: 0.02 })
  sound.flush()
  const wasLoading = player.state === 'loading'
  for (let n = 0; n < 12; n++) await stepped.step()
  const got = stepped.take()
  say(wasLoading && player.state === 'on' && first(got.left, 1e-5) === 4800 && player.kind === 'stepped' && player.context === null, 'commands sent while the engine is loading are carried out at their own times once it has; the player is "stepped", with no sound card', [wasLoading, player.state, first(got.left, 1e-5)])
  player.close()
}

// --- the clock a recorder takes over part-way, taking and listening
{
  const { clock, sound, stepped, player } = stage({ fps: 60 })
  // The page has been running for 12.3456 seconds when the recorder begins.
  clock.now = 12.3456
  stepped.startAt(clock.now)
  const lead = sound.makeSynth(CLICK)
  const heard = []
  const stop = stepped.onAdvance((left, right, rate) => heard.push([left.length, right.length, rate]))
  lead.play('A4', { length: 0.02 })
  lead.play('A4', { after: 0.05, length: 0.02 })
  const parts = []
  for (let n = 1; n <= 6; n++) { clock.now = 12.3456 + n / 60; await stepped.advance(clock.now); if (n % 2 === 0) parts.push(stepped.take()) }
  stop()
  await stepped.step()
  const all = new Float32Array(4800)
  parts.forEach((p, i) => all.set(p.left, i * 1600))
  const second = first(all.subarray(1200), 1e-5) + 1200
  const wav = parts[0].wav()
  say(first(all, 1e-5) === 0 && second === 2400 && parts.every((p) => p.length === 1600 && p.sampleRate === SR) && heard.length === 6 && heard.every((h) => h[0] === 800 && h[1] === 800 && h[2] === SR) && stepped.take().length === 800 && stepped.frame === 1
    && String.fromCharCode(...wav.subarray(0, 4)) === 'RIFF',
  'startAt(seconds) lines the sound up with a clock that was already running; take() hands over what was made since the last take, as samples or a WAV file; onAdvance is given each stretch as it is made', { first: first(all, 1e-5), second, heard: heard.length })
  player.close()
}

// --- what was asked for before the recording began
{
  // A scene that ran for a while on the machine's clock: a song and a note asked for before the recorder took over.
  const { clock, sound, stepped, player } = stage({ fps: 60 })
  clock.now = 3.21
  sound.playSong(song)
  sound.makeSynth(CLICK).play('A4', { after: 1, length: 0.02 })
  sound.flush()
  await new Promise((done) => setTimeout(done, 30))
  clock.now = 3.7
  stepped.startAt(clock.now)
  for (let n = 1; n <= 60; n++) { clock.now = 3.7 + n / 60; await stepped.advance(clock.now) }
  const got = stepped.take()
  const offline = await createOfflinePlayer()
  const o = createSound({ sound: offline, clock: () => 0 })
  o.playSong(song)
  o.makeSynth(CLICK).play('A4', { at: 0.51, length: 0.02 })
  o.flush()
  const want = await offline.render(1)
  say(got.length === 48000 && differ(got.left, want.left)[0] === 0, 'a song asked for before the recording began starts on its first sample, and a note asked for a second ahead of then keeps its time (0.51 s in), since nothing is carried out before the first step', differ(got.left, want.left))
  player.close()
}

// --- the page's own sound, with nothing but an option
{
  // createSound with no transport makes the page's player from its options: stepped is one of them.
  const clock = { now: 0 }
  const sound = createSound({ stepped: { fps: 30 }, clock: () => clock.now, share: false })
  sound.makeSynth(CLICK).play('A4', { length: 0.02 })
  sound.flush()
  const player = sound.player
  await player.stepped.step()
  const got = player.stepped.take()
  say(player.kind === 'stepped' && got.length === 1600 && first(got.left, 1e-5) === 0 && sound.soundBuffer().thread === 'stepped', 'createSound({ stepped: { fps: 30 } }) gives a scene a stepped player with no other change, and soundBuffer() says so', [player.kind, got.length, first(got.left, 1e-5), sound.soundBuffer()])
  sound.close()
  say(player.state === 'closed', 'and closing the sound closes it', player.state)
}

console.log(`${count - failed} of ${count} passed`)
process.exit(failed ? 1 : 0)
