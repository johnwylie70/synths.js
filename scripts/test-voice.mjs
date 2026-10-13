#!/usr/bin/env node
/**
 * The microphone, recording and voice changers without a browser or a microphone: the offline player is given
 * sound in a microphone's place, and what comes out is measured. Covered: what the functions write as commands;
 * the input is heard only while it is listened to; the gate; every voice changes the sound the way its name says;
 * a recording is the right length, plays back at pitch and at other pitches, and wears the microphone's voice;
 * recording what is played; saving a WAV file; and what happens with no microphone at all.
 *
 *   node scripts/test-voice.mjs
 *
 * It ends with code 1 if a case fails.
 */
import * as synths from '../synths.js'

const { createSound, createOfflinePlayer, renderSound, readWav, describe } = synths
const SR = 48000

let failed = 0
let count = 0
const say = (ok, what, got) => {
  count++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`)
}

// --- making and measuring
const tone = (hz, seconds, level = 0.5) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => level * Math.sin(2 * Math.PI * hz * i / SR))
const joined = (...parts) => { const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { all.set(p, at); at += p.length } return all }
const cut = (a, from, to) => a.subarray(Math.round(from * SR), Math.round(to * SR))
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
// How much of one frequency there is in a stretch of sound: the level of a sine of that pitch.
function level(a, hz) {
  let re = 0, im = 0
  for (let i = 0; i < a.length; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (a.length - 1))
    re += a[i] * w * Math.cos(2 * Math.PI * hz * i / SR)
    im += a[i] * w * Math.sin(2 * Math.PI * hz * i / SR)
  }
  return 4 * Math.hypot(re, im) / a.length
}
// The loudest pitch in a stretch of sound between two frequencies, to a fifth of a hertz.
function loudest(a, low, high) {
  let best = low, most = 0
  for (let hz = low; hz <= high; hz += 2) { const l = level(a, hz); if (l > most) { most = l; best = hz } }
  for (let hz = best - 2; hz <= best + 2; hz += 0.2) { const l = level(a, hz); if (l > most) { most = l; best = hz } }
  return best
}
const near = (a, b, within) => Math.abs(a - b) <= within
const thrown = (f) => { try { f(); return null } catch (e) { return e.message } }
const tick = () => new Promise((yes) => setTimeout(yes, 0))
async function saying(run) {
  const said = []
  const keep = { warn: console.warn, info: console.info, error: console.error }
  for (const how of Object.keys(keep)) console[how] = (...a) => said.push(a.join(' '))
  try { await run() } finally { Object.assign(console, keep) }
  return said
}
function commands(play, options = {}) {
  const batches = []
  const s = createSound({ sound: { send: (b) => batches.push(b) }, clock: () => 0, batch: 'manual', ...options })
  play(s)
  s.flush()
  return batches.flatMap((b) => b.cmds)
}
// A program and an offline player to play it, a piece at a time: the program's clock is where rendering has reached.
async function studio(options = {}) {
  const player = await createOfflinePlayer(options)
  const s = createSound({ sound: player, clock: () => player.time, batch: 'manual' })
  return { s, player, async go(seconds) { s.flush(); await tick(); s.flush(); return (await player.render(seconds)).left } }
}
// What the microphone sounds like through some settings: a second of it, listened to with no gate.
async function through(input, set, seconds = 1) {
  const out = await renderSound((s) => { const mic = s.useMicrophone({ gate: 'off', listen: true }); set(mic, s) }, { seconds, microphone: input })
  return out.left
}

// --- what is written
{
  const c = commands((s) => {
    const mic = s.useMicrophone()
    mic.voice = 'robot'
    mic.pitch = 7
    mic.echo = 0.4
    mic.listen()
    mic.mute()
    mic.gain = 2
  })
  say(JSON.stringify(c.map((x) => ({ ...x, t: undefined }))) === JSON.stringify([
    { op: 'mic', id: 'm1', set: { micGate: -50 } }, { op: 'set', id: 'm1', voice: 'robot' }, { op: 'set', id: 'm1', set: { pitchShift: 7 } }, { op: 'set', id: 'm1', set: { echo: 0.4 } },
    { op: 'mic', id: 'm1', listen: true }, { op: 'mic', id: 'm1', listen: false }, { op: 'set', id: 'm1', set: { micGain: 2 } },
  ]), 'useMicrophone writes a mic command with a gentle gate, and a voice, a setting, listen and mute are plain commands on its id; its pitch is the pitch shifter and its gain the input\'s', c)

  let mic, take
  const r = commands((s) => { mic = s.useMicrophone(); mic.voice = 'chipmunk'; take = s.recordSound(3) })
  const rec = r.find((x) => x.op === 'record')
  say(rec.id === 'w2' && rec.from === 'mic' && rec.len === 3 && r.some((x) => x.op === 'synth' && x.preset === 'sample' && x.set.sample === 'w2') && r.some((x) => x.op === 'set' && x.id === take._id && x.voice === 'chipmunk') && take.done === false && take.voice === 'chipmunk' && take.get('pitchShift') === 7,
    'recordSound(3) writes a record command with an id of its own and a sample synth to play it, which is given the microphone\'s voice; the take is there at once, not done', r)
  say(mic.get('pitch') === 7 && mic.pitch === 7 && mic.describe('pitch').min === -12 && mic.describe('pitch').max === 12 && mic.voice === 'chipmunk' && mic.describe('voice').choices.includes('robot') && mic.get('gate') === -50 && mic.listening === false && mic.describe('listening').kind === 'bool',
    'the microphone answers get and describe as a synth does, so a dial takes its range from it: pitch is -12 to 12, voice is a choice, listening is a switch', [mic.get('pitch'), mic.describe('pitch'), mic.describe('voice')])
  const twice = commands((s) => { s.useMicrophone(); s.useMicrophone({ voice: 'robot', listen: true }); s.use_microphone() })
  say(twice.filter((x) => x.op === 'mic' && !('listen' in x)).length === 1 && twice.some((x) => x.voice === 'robot') && twice.some((x) => x.listen === true), 'useMicrophone() again gives the same microphone, and takes a voice and listen in braces', twice)
  const others = commands((s) => { const lead = s.makeSynth('lead'); lead.voice = 'monster'; lead.pitchShift = 3; lead.ringMod = 0.5; lead.comb = 0.3; lead.flanger = 0.4; s.recordOutput(2); s.startRecording({ max: 10 }); s.stopRecording(); lead.record(1) })
  say(others.some((x) => x.op === 'set' && x.voice === 'monster') && others.some((x) => x.set && x.set.pitchShift === 3) && others.some((x) => x.op === 'record' && x.from === 'output' && x.len === 2) && others.some((x) => x.op === 'record' && x.from === 'mic' && x.max === 10 && x.len === undefined)
    && others.some((x) => x.op === 'record' && x.do === 'stop') && others.some((x) => x.op === 'record' && x.from === 'synth' && x.synth === 's1'), 'a synth has the voice effects and a voice too; recordOutput, startRecording, stopRecording and a synth\'s record() are record commands', others)
  const plain = commands((s) => { s.playNote('C4'); s.makeSynth('bass').play('C2'); s.loadSample('kick.wav').play() }, { resolve: (p) => p })
  say(!plain.some((x) => x.op === 'mic' || x.op === 'record' || x.op === 'save' || x.voice), 'a program that does not use the microphone writes nothing about it', plain.map((x) => x.op))
  const wrong = [
    thrown(() => commands((s) => { s.useMicrophone().voice = 'robt' })),
    thrown(() => commands((s) => { s.recordSound(500) })),
    thrown(() => commands((s) => { s.saveSound('hello') })),
    thrown(() => commands((s) => { s.useMicrophone().pich = 3 })),
    thrown(() => commands((s) => { s.recordSound(2, { from: 7 }) })),
  ]
  say(/"robt" is not a voice. Did you mean "robot"\? The voices are: robot, chipmunk/.test(wrong[0]) && /up to 120 seconds long, not 500/.test(wrong[1]) && /saveSound needs a recording or a sample/.test(wrong[2]) && /Did you mean "pitch/.test(wrong[3]) && /needs the microphone, a synth or "output"/.test(wrong[4]),
    'mistakes are said in plain words: a voice that is not one, a recording that is too long, something that cannot be saved, a setting that is nearly one', wrong)
  const d = describe()
  say(Object.keys(d.voices).join() === 'robot,chipmunk,monster,cave,telephone,alien,whisper' && d.voices.chipmunk.values['fx.pitch'] === 7 && d.microphone.names.pitch === 'pitchShift' && d.names.pitchShift.setting === 'fx.pitch' && synths.voiceNames().length === 7
    && typeof synths.use_microphone === 'function' && typeof synths.record_sound === 'function' && typeof synths.save_sound === 'function' && typeof synths.record_output === 'function',
    'the names file has the seven voices as the engine gives them, the microphone\'s own names and the Python spellings', Object.keys(d.voices))
}

// --- the input is heard only when it is listened to
{
  const input = tone(220, 2)
  const out = await renderSound((s) => {
    const mic = s.useMicrophone({ gate: 'off' })
    mic.listen({ })
    s.flush()
  }, { seconds: 0.5, microphone: input })
  const muted = await renderSound((s) => { s.useMicrophone({ gate: 'off' }) }, { seconds: 0.5, microphone: input })
  // In the middle, at setVolume(1): 0.7071 of it on each side, times the engine's master volume of a half.
  let worst = 0
  for (let i = 0; i < out.left.length; i++) worst = Math.max(worst, Math.abs(out.left[i] - input[i] * Math.SQRT1_2 * 0.5))
  say(peak(muted.left) === 0 && peak(muted.right) === 0, 'a microphone that is not listened to is not heard at all: every sample is 0', peak(muted.left))
  say(worst < 1e-6 && out.left[100] === out.right[100], `listened to, with no voice and no gate, it comes out as it went in, sample for sample (the furthest out is ${worst.toExponential(1)})`, worst)

  const st = await studio({ microphone: input })
  const mic = st.s.useMicrophone({ gate: 'off' })
  const a = await st.go(0.25)
  mic.listen()
  const b = await st.go(0.25)
  mic.mute()
  const c = await st.go(0.25)
  say(peak(a) === 0 && peak(b) > 0.17 && peak(c.subarray(64)) === 0, 'listen() and mute() turn it on and off as it runs', [peak(a), peak(b), peak(c)])
  // While it is muted a scope and a meter still show the microphone as it comes in.
  const seen = mic.samples()
  say(seen.length === 1024 && near(peak(seen), 0.5, 0.01) && near(mic.level()[0], 0.5, 0.01), 'a muted microphone still shows on a scope and a meter, as it comes in', [seen.length, peak(seen), mic.level()])
  mic.listen()
  await st.go(0.25)
  say(near(peak(mic.samples()), 0.5 * Math.SQRT1_2 * 0.5, 0.01), 'and listened to, they show it as it is heard', peak(mic.samples()))
}

// --- the gate
{
  const quiet = await renderSound((s) => { s.useMicrophone({ listen: true }) }, { seconds: 0.5, microphone: tone(220, 1, 0.001) })
  const loud = await renderSound((s) => { s.useMicrophone({ listen: true }) }, { seconds: 0.5, microphone: tone(220, 1, 0.1) })
  const open = await renderSound((s) => { s.useMicrophone({ listen: true, gate: 'off' }) }, { seconds: 0.5, microphone: tone(220, 1, 0.001) })
  say(peak(quiet.left) === 0 && peak(loud.left) > 0.03 && peak(open.left) > 0.0003, 'a microphone starts with a gentle gate (-50 dB): hiss at -60 dB is silence, a voice at -20 dB comes through, and gate: "off" lets everything by', [peak(quiet.left), peak(loud.left), peak(open.left)])
}

// --- each voice does what its name says
{
  const voice = tone(200, 2)
  const up = await through(voice, (mic) => { mic.voice = 'chipmunk' })
  const down = await through(voice, (mic) => { mic.voice = 'monster' })
  const upHz = loudest(cut(up, 0.3, 1), 150, 500), downHz = loudest(cut(down, 0.3, 1), 80, 300)
  say(near(upHz / 200, 2 ** (7 / 12), 0.01), `chipmunk: a 200 Hz voice comes out at ${upHz.toFixed(1)} Hz, seven semitones up (${(200 * 2 ** (7 / 12)).toFixed(1)})`, upHz)
  say(near(downHz / 200, 2 ** (-7 / 12), 0.01), `monster: it comes out at ${downHz.toFixed(1)} Hz, seven semitones down (${(200 * 2 ** (-7 / 12)).toFixed(1)})`, downHz)

  // A robot is the voice multiplied by a 50 Hz wave: the tone itself goes, and two appear 50 Hz either side.
  const robot = await through(tone(400, 2), (mic) => { mic.voice = 'robot'; mic.comb = 0; mic.crush = 16 })
  const sides = [level(cut(robot, 0.3, 1), 350), level(cut(robot, 0.3, 1), 400), level(cut(robot, 0.3, 1), 450)]
  say(sides[0] > 0.05 && sides[2] > 0.05 && sides[1] < sides[0] / 20, `robot: a 400 Hz tone becomes two, at 350 and 450 Hz, and the 400 is gone (${sides.map((v) => v.toFixed(3)).join(', ')})`, sides)
  const whole = await through(tone(400, 2), (mic) => { mic.voice = 'robot' })
  say(level(cut(whole, 0.3, 1), 350) > 0.02 && level(cut(whole, 0.3, 1), 400) < level(cut(whole, 0.3, 1), 350) / 3, 'and the whole robot, ringing in its pipe, still has them', [level(cut(whole, 0.3, 1), 350), level(cut(whole, 0.3, 1), 400)])

  // A telephone keeps the middle of the voice.
  const low = await through(tone(100, 2), (mic) => { mic.voice = 'telephone' })
  const mid = await through(tone(1200, 2), (mic) => { mic.voice = 'telephone' })
  const high = await through(tone(9000, 2), (mic) => { mic.voice = 'telephone' })
  const kept = [level(cut(low, 0.3, 1), 100), level(cut(mid, 0.3, 1), 1200), level(cut(high, 0.3, 1), 9000)]
  say(kept[1] > kept[0] * 5 && kept[1] > kept[2] * 5, `telephone: the middle of the voice comes through and the low and the high do not (100 Hz ${kept[0].toFixed(3)}, 1200 Hz ${kept[1].toFixed(3)}, 9000 Hz ${kept[2].toFixed(3)})`, kept)

  // A cave goes on after the voice has stopped.
  const word = joined(tone(300, 0.2), new Float32Array(SR * 2))
  const cave = await through(word, (mic) => { mic.voice = 'cave' }, 1.5)
  const dry = await through(word, () => {}, 1.5)
  say(peak(cut(dry, 0.3, 1.5)) === 0 && peak(cut(cave, 0.5, 0.9)) > 0.01 && peak(cut(cave, 1.0, 1.5)) > 0.001, 'cave: the voice echoes on for more than a second after it stops, where the plain one is silent', [peak(cut(cave, 0.5, 0.9)), peak(cut(cave, 1.0, 1.5))])

  // An alien is four semitones up and multiplied by a 180 Hz wave: 300 Hz becomes 378, then 198 and 558.
  const alien = await through(tone(300, 2), (mic) => { mic.voice = 'alien'; mic.comb = 0; mic.chorus = 0 })
  const moved = 300 * 2 ** (4 / 12)
  const found = [loudest(cut(alien, 0.3, 1), 150, 250), loudest(cut(alien, 0.3, 1), 500, 620)]
  say(near(found[0], moved - 180, 2) && near(found[1], moved + 180, 2), `alien: a 300 Hz tone, four semitones up and multiplied by 180 Hz, is loudest at ${found.map((v) => v.toFixed(0)).join(' and ')} Hz`, found)

  // A whisper has no pitch: the tone is smeared into noise around where it was.
  const hush = await through(tone(1000, 2), (mic) => { mic.voice = 'whisper' })
  const plain = await through(tone(1000, 2), () => {})
  const at = [level(cut(hush, 0.3, 1), 1000) / level(cut(plain, 0.3, 1), 1000), level(cut(hush, 0.3, 1), 1100) + level(cut(hush, 0.3, 1), 870) + level(cut(hush, 0.3, 1), 1230)]
  say(at[0] < 0.2 && at[1] > 0.005 && peak(cut(hush, 0.3, 1)) > 0.02, `whisper: the tone itself falls to ${(at[0] * 100).toFixed(0)}% and there is sound all round it instead`, at)

  // "none" is how things were, and a voice leaves no trace in the next.
  const input = tone(220, 2)
  const back = await through(input, (mic) => { mic.voice = 'telephone'; mic.voice = 'robot'; mic.voice = 'none' })
  let worst = 0
  for (let i = 0; i < back.length; i++) worst = Math.max(worst, Math.abs(back[i] - input[i] * Math.SQRT1_2 * 0.5))
  let mic
  commands((s) => { mic = s.useMicrophone(); mic.echo = 0.3; mic.voice = 'telephone'; mic.pitch = 5; mic.voice = 'chipmunk' })
  say(worst < 1e-6 && mic.get('filter') === 'off' && mic.get('crush') === 16 && mic.get('pitch') === 7 && mic.get('echo') === 0.3, 'a voice puts back what the last one changed, "none" is the plain voice again sample for sample, and what was set before any voice stays under them all', [worst, mic.get('filter'), mic.get('pitch'), mic.get('echo')])
  // Turning the cutoff on a microphone gives it a filter to turn.
  const dull = await through(tone(4000, 2), (m) => { m.cutoff = 400 })
  say(peak(cut(dull, 0.3, 1)) < 0.01, 'mic.cutoff = 400 takes the top off the voice, without being told which filter', peak(cut(dull, 0.3, 1)))
}

// --- the voice effects on a synth
{
  const CLICK = { wave: 'sine', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0 }
  const out = await renderSound((s) => {
    const a = s.makeSynth(CLICK)
    a.play('A3', 1)
    a.pitchShift = 12
    const b = s.makeSynth(CLICK)
    b.voice = 'chipmunk'
    b.play('A3', 1, { at: 1.5 })
    b.set({ voice: 'none' }, { at: 3 })
    const c = s.makeSynth(CLICK)
    c.ringMod = 1
    c.ringSpeed = 100
    c.play('A4', 1, { at: 4.5 })
  }, { seconds: 6 })
  const hz = [loudest(cut(out.left, 0.3, 0.9), 300, 600), loudest(cut(out.left, 1.8, 2.4), 200, 500), level(cut(out.left, 4.8, 5.4), 340), level(cut(out.left, 4.8, 5.4), 440), level(cut(out.left, 4.8, 5.4), 540)]
  say(near(hz[0], 440, 1) && near(hz[1], 220 * 2 ** (7 / 12), 1.5) && hz[2] > 0.05 && hz[4] > 0.05 && hz[3] < hz[2] / 20, `a synth has them too: pitchShift 12 plays A3 at ${hz[0].toFixed(0)} Hz, the chipmunk voice at ${hz[1].toFixed(0)}, and ringMod at 100 Hz turns A4 into 340 and 540 Hz`, hz)
}

// --- recording
{
  // A second of the microphone, which is 220 Hz for the first half second and 330 after.
  const input = joined(tone(220, 0.5), tone(330, 2.5))
  const st = await studio({ microphone: input })
  const mic = st.s.useMicrophone({ gate: 'off' })
  const take = st.s.recordSound(1)
  let told = 0
  take.onDone((t) => { told += t === take && t.done ? 1 : 10 })
  const during = await st.go(0.5)
  const midway = [take.done, take.recording, told]
  await st.go(0.75)
  say(peak(during) === 0 && same(midway, [false, true, 0]) && take.done && !take.recording && take.seconds === 1 && take.frames === SR && told === 1, 'recordSound(1) gives a take at once that is not done; a second later it is, exactly 48000 frames long, and onDone is told once; the muted microphone was not heard meanwhile', [midway, take.done, take.seconds, take.frames, told])
  take.play()
  const back = await st.go(1.25)
  take.play('C5')
  const octave = await st.go(1)
  take.play('G3')
  const lower = await st.go(1.5)
  const pitches = [loudest(cut(back, 0.1, 0.4), 150, 400), loudest(cut(back, 0.6, 0.9), 150, 400), loudest(cut(octave, 0.05, 0.2), 300, 800), loudest(cut(lower, 0.1, 0.5), 100, 300)]
  say(near(pitches[0], 220, 0.5) && near(pitches[1], 330, 0.5) && peak(cut(back, 1.05, 1.25)) === 0, `it plays back as it went in: 220 Hz, then 330 (${pitches[0].toFixed(1)}, ${pitches[1].toFixed(1)}), and ends after its second`, pitches)
  say(near(pitches[2], 440, 1) && near(pitches[3], 220 * 2 ** (-5 / 12), 1), `take.play("C5") is an octave up (${pitches[2].toFixed(1)} Hz) and take.play("G3") a fourth down (${pitches[3].toFixed(1)} Hz)`, pitches)
  let late = 0
  take.onDone(() => { late++ })
  say(late === 1 && (await take.whenDone()) === take, 'onDone after the end is told at once, and whenDone() is a promise of the take', late)

  // Backwards, and round and round.
  take.reverse = true
  take.play()
  const backwards = await st.go(1.25)
  take.reverse = false
  take.loop = true
  const held = take.start()
  const round = await st.go(2.5)
  held.stop()
  await st.go(0.2)
  say(near(loudest(cut(backwards, 0.1, 0.4), 150, 400), 330, 0.5) && near(loudest(cut(backwards, 0.6, 0.9), 150, 400), 220, 0.5), 'take.reverse = true plays it backwards: 330 Hz, then 220', loudest(cut(backwards, 0.1, 0.4), 150, 400))
  say(near(loudest(cut(round, 1.1, 1.4), 150, 400), 220, 0.5) && near(loudest(cut(round, 2.1, 2.4), 150, 400), 220, 0.5) && peak(await st.go(0.2)) === 0, 'take.loop = true goes round while its note is held: the first half second comes again after one second and after two', loudest(cut(round, 1.1, 1.4), 150, 400))

  // Saving: the WAV file is what was recorded.
  const files = []
  const st2 = await studio({ microphone: input, save: (file) => files.push(file) })
  st2.s.useMicrophone({ gate: 'off' })
  const word = st2.s.recordSound(0.5)
  const promised = st2.s.saveSound(word, 'hello')
  await st2.go(0.6)
  await st2.go(0.01)
  const bytes = await promised
  const wav = readWav(bytes)
  let worst = 0
  for (let i = 0; i < wav.pcm.length; i++) worst = Math.max(worst, Math.abs(wav.pcm[i] - input[i + Math.round(0 * SR)]))
  say(String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE' && bytes.length === 44 + 0.5 * SR * 2 && wav.channels === 1 && wav.rate === SR && wav.pcm.length === 0.5 * SR && worst < 1 / 16384,
    'saveSound(take, "hello") waits for the take and gives a WAV file: one channel, 16 bits, 48000 a second, half a second long, and the samples are the microphone\'s', { length: bytes.length, channels: wav.channels, worst })
  say(files.length === 1 && files[0].name === 'hello.wav' && files[0].type === 'audio/wav' && files[0].bytes === bytes, 'and a host that asked to keep saved files is handed it, by name', files.map((f) => f.name))
  const quietly = st2.s.saveSound(word, 'again.wav', { download: false })
  await st2.go(0.01)
  say((await quietly).length === bytes.length && files.length === 1, '{ download: false } gives the bytes alone', files.length)
}

// --- a take wears the microphone's voice
{
  const st = await studio({ microphone: tone(200, 4) })
  const mic = st.s.useMicrophone({ gate: 'off' })
  mic.voice = 'chipmunk'
  const take = st.s.recordSound(1)
  const during = await st.go(1.1)
  take.play()
  const squeaky = await st.go(1.2)
  take.voice = 'none'
  take.play()
  const plain = await st.go(1.2)
  take.voice = 'monster'
  take.play()
  const deep = await st.go(1.5)
  const hz = [loudest(cut(squeaky, 0.3, 0.9), 100, 500), loudest(cut(plain, 0.3, 0.9), 100, 500), loudest(cut(deep, 0.3, 0.9), 80, 500)]
  say(peak(during) === 0 && near(hz[0], 200 * 2 ** (7 / 12), 2) && near(hz[1], 200, 0.5) && near(hz[2], 200 * 2 ** (-7 / 12), 2), `recorded while muted with the chipmunk voice on, the take plays back as a chipmunk (${hz[0].toFixed(0)} Hz); it is the plain voice underneath (take.voice = "none": ${hz[1].toFixed(0)} Hz) and can be a monster afterwards (${hz[2].toFixed(0)} Hz)`, hz)

  // soundLike: the take as the microphone is now, whatever was chosen and turned since.
  mic.voice = 'none'
  mic.pitch = 12
  take.soundLike(mic).play()
  const high = await st.go(1.2)
  mic.voice = 'chipmunk'
  mic.pitch = -12
  take.soundLike(mic).play()
  const low = await st.go(1.5)
  mic.voice = 'none'
  take.soundLike(mic).play()
  const again = await st.go(1.2)
  const like = [loudest(cut(high, 0.3, 0.9), 100, 500), loudest(cut(low, 0.3, 0.9), 80, 500), loudest(cut(again, 0.3, 0.9), 100, 500)]
  say(near(like[0], 400, 2) && near(like[1], 100, 1) && near(like[2], 400, 2) && take.voice === 'none' && take.get('pitchShift') === 12 && mic.pitch === 12, `take.soundLike(mic) gives the take the microphone's voice and dials as they are now: an octave up (${like[0].toFixed(0)} Hz), a chipmunk turned an octave down (${like[1].toFixed(0)} Hz), and with the voice taken off, the octave up it had before (${like[2].toFixed(0)} Hz)`, like)

  // With effects: true and the microphone listened to, the changed voice itself is recorded.
  const st2 = await studio({ microphone: tone(200, 4) })
  const mic2 = st2.s.useMicrophone({ gate: 'off', voice: 'chipmunk', listen: true })
  const wet = st2.s.recordSound(1, { effects: true })
  await st2.go(1.1)
  mic2.mute()
  await st2.go(0.2)
  wet.play()
  const heard = await st2.go(1.2)
  say(wet.voice === 'none' && near(loudest(cut(heard, 0.3, 0.9), 100, 500), 200 * 2 ** (7 / 12), 2), '{ effects: true } while listening records the voice after its effects, and the take needs no voice to sound like it', [wet.voice, loudest(cut(heard, 0.3, 0.9), 100, 500)])
}

// --- with no length, and the limit
{
  const st = await studio({ microphone: tone(220, 10) })
  st.s.useMicrophone({ gate: 'off' })
  const open = st.s.startRecording()
  await st.go(0.7)
  st.s.stopRecording()
  await st.go(0.1)
  say(open.done && near(open.seconds, 0.7, 0.001), `startRecording() runs until stopRecording(): ${open.seconds.toFixed(3)} seconds`, open.seconds)
  const short = st.s.startRecording({ max: 0.5 })
  let said
  said = await saying(async () => { await st.go(1) })
  say(short.done && near(short.seconds, 0.5, 0.001) && said.length === 1 && /reached its longest, .* and stopped by itself/.test(said[0]), 'a recording that reaches its limit stops by itself, is done with what it has, and one message says so', [short.seconds, said])
  // One at a time: a second recording ends the first, which keeps what it had.
  const first = st.s.recordSound(2)
  await st.go(0.5)
  const second = st.s.recordSound(0.25)
  await st.go(0.5)
  say(first.done && near(first.seconds, 0.5, 0.001) && second.done && near(second.seconds, 0.25, 0.001), 'one recording at a time: starting another ends the first, which keeps what it had', [first.seconds, second.seconds])
  const one = st.s.recordSound(2)
  await st.go(0.3)
  one.stopRecording()
  await st.go(0.1)
  say(one.done && near(one.seconds, 0.3, 0.001), 'take.stopRecording() ends that one', one.seconds)
}

// --- recording what is played
{
  const CLICK = { wave: 'sine', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0 }
  const st = await studio()
  const lead = st.s.makeSynth(CLICK)
  lead.pan = -1
  const tune = st.s.recordOutput(1)
  lead.play('A4', 0.5)
  const live = await st.go(1.1)
  const saved = st.s.saveSound(tune, 'tune.wav', { download: false })
  tune.play()
  const again = await st.go(1.1)
  const wav = readWav(await saved)
  let worst = 0
  for (let i = 0; i < SR; i++) worst = Math.max(worst, Math.abs(wav.pcm[i * 2] - live[i]))
  let right = 0
  for (let i = 0; i < SR; i++) right = Math.max(right, Math.abs(wav.pcm[i * 2 + 1]))
  say(tune.done && tune.seconds === 1 && wav.channels === 2 && wav.pcm.length === 2 * SR && worst < 1 / 16384 && right < 1 / 16384, 'recordOutput(1) records what is played in stereo, sample for sample: a note panned left is on the left of the file and not on the right', { seconds: tune.seconds, channels: wav.channels, worst, right })
  say(near(loudest(cut(again, 0.1, 0.4), 300, 600), 440, 0.5) && peak(cut(again, 0.6, 1)) < 1e-4, 'and the recording plays back: A4 for half a second, then nothing', loudest(cut(again, 0.1, 0.4), 300, 600))
  const part = st.s.recordSound(0.5, { from: lead })
  lead.play('A3', 0.25)
  await st.go(0.6)
  part.pan = 0
  part.play()
  const heard = await st.go(0.6)
  say(part.done && near(loudest(cut(heard, 0.05, 0.2), 150, 300), 220, 1), 'lead.record() and { from: lead } record one synth alone', loudest(cut(heard, 0.05, 0.2), 150, 300))
}

// --- no microphone
{
  let mic, take, ready, bytes
  const said = await saying(async () => {
    const st = await studio()
    mic = st.s.useMicrophone({ voice: 'robot' })
    mic.listen()
    mic.pitch = 3
    take = st.s.recordSound(1)
    const other = st.s.startRecording()
    take.play()
    take.play('E4')
    st.s.stopRecording()
    const out = await st.go(0.5)
    ready = [await mic.whenReady(), mic.state, peak(out), take.done, take.seconds, other.done, mic.samples().length, mic.level()]
    const saved = st.s.saveSound(take, 'nothing.wav', { download: false })
    await st.go(0.1)
    bytes = await saved
    st.s.useMicrophone()
    st.s.recordSound(1)
    await st.go(0.1)
  })
  say(said.length === 1 && /there is no microphone when sound is rendered to a file.*Everything else carries on, and a recording of the microphone will be empty/.test(said[0]), 'with no microphone one plain message says why and what to do, however many functions are used', said)
  say(ready[0] === false && ready[1] === 'unavailable' && ready[2] === 0 && ready[3] === true && ready[4] === 0 && ready[5] === true, 'nothing throws: the microphone says it is unavailable, whenReady() is false, and a recording is done at once and empty; playing it is silence', ready)
  say(bytes.length === 44 && readWav(bytes) && readWav(bytes).pcm.length === 0, 'saving the empty recording gives a WAV file with no sound in it', bytes.length)
}

// --- the same by hand: plain commands in, plain data back
{
  const player = await createOfflinePlayer({ microphone: tone(220, 3) })
  const events = []
  player.onSoundEvents((list) => events.push(...list))
  player.send({ synths: 1, now: 0, cmds: [
    { op: 'mic', id: 'mic', set: { gate: -100 } }, { op: 'set', id: 'mic', voice: 'chipmunk' }, { op: 'mic', id: 'mic', listen: true },
    { op: 'record', id: 'rec', from: 'mic', len: 0.5, t: 0 }, { op: 'synth', id: 'play', preset: 'sample', set: { sample: 'rec' } }, { op: 'note', id: 'play', note: 60, len: null, t: 1.5 },
    { op: 'mic', id: 'mic', listen: false, t: 1 }, { op: 'save', id: 'rec', name: 'r.wav', ask: 7, download: false, t: 1 },
  ] })
  const out = (await player.render(2.5)).left
  const kinds = events.map((e) => e.type + (e.state ? ':' + e.state : ''))
  const rec = events.find((e) => e.type === 'recorded'), saved = events.find((e) => e.type === 'saved')
  say(near(loudest(cut(out, 0.3, 0.9), 100, 500), 220 * 2 ** (7 / 12), 2) && peak(cut(out, 1.1, 1.4)) === 0 && near(loudest(cut(out, 1.6, 1.9), 100, 500), 220, 0.5), 'hand-written commands do the same: the microphone through a voice, muted, and a recording of the plain voice played back', loudest(cut(out, 0.3, 0.9), 100, 500))
  say(kinds.includes('microphone:on') && rec && rec.id === 'rec' && rec.frames === SR / 2 && rec.seconds === 0.5 && saved && saved.id === 'rec' && saved.ask === 7 && saved.name === 'r.wav' && readWav(saved.bytes).pcm.length === SR / 2,
    'and the player says back, as plain data: the microphone is on, the recording is over and how long it is, and the file that was asked for', kinds)
  // Two senders on one player: each is told of its own recording only.
  const shared = await createOfflinePlayer({ microphone: tone(220, 3) })
  const a = [], b = []
  shared.onSoundEvents((list) => a.push(...list), 'a')
  shared.onSoundEvents((list) => b.push(...list), 'b')
  shared.send({ synths: 1, now: 0, scope: 'a', cmds: [{ op: 'mic', id: 'm' }, { op: 'record', id: 'r', from: 'mic', len: 0.1 }] })
  shared.send({ synths: 1, now: 0, scope: 'b', cmds: [{ op: 'record', id: 'r', from: 'output', len: 0.1, t: 0.2 }] })
  await shared.render(0.5)
  say(a.filter((e) => e.type === 'recorded').length === 1 && b.filter((e) => e.type === 'recorded').length === 1 && a.some((e) => e.type === 'microphone') && b.some((e) => e.type === 'microphone'), 'two senders that share a player are each told of their own recording, and both of the microphone', [a.map((e) => e.type), b.map((e) => e.type)])
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

// --- a voice chosen by a control: what describe gives is a choice, and a control sets a choice by its place in the list
{
  let mic, lead, d
  const c = commands((s) => {
    mic = s.useMicrophone()
    lead = s.makeSynth('lead')
    d = mic.describe('voice')
    mic.set('voice', d.choices.indexOf('robot'))
    lead.set('voice', d.choices.indexOf('cave'))
    lead.set('wave', lead.describe('wave').choices.indexOf('saw'))
  })
  const was = [mic.voice, mic.get('voice'), lead.voice, lead.get('wave')]
  mic.set('voice', 0)
  const off = mic.voice
  const refused = [thrown(() => mic.set('voice', 99)), thrown(() => { mic.voice = 'nobody' })]
  say(d.kind === 'choice' && d.choices[0] === 'none' && same(was, ['robot', 'robot', 'cave', 'saw']) && off === 'none' && c.some((x) => x.op === 'set' && x.id === mic._id && x.voice === 'robot') && c.some((x) => x.op === 'set' && x.id === lead._id && x.voice === 'cave')
    && refused.every((t) => /is not a voice/.test(t)),
  'a voice set by its place among the choices, as a select or a rotary switch sets it, is that voice (on the microphone and on a synth), 0 is "none", a wave is chosen the same way, and a place that is not there is refused in plain words', [d, was, off, refused])

  // The same on the player's side, where the program is elsewhere.
  const { s, player, go } = await studio()
  const synth = s.makeSynth('lead')
  await go(0.01)
  const target = player.target(synth._id)
  const td = target.describe('voice')
  const before = target.get('voice')
  target.set('voice', td.choices.indexOf('telephone'))
  await go(0.01)
  const on = target.get('voice')
  target.set({ voice: 'none', cutoff: 900 })
  await go(0.01)
  say(td.kind === 'choice' && same(td.choices, d.choices) && before === 'none' && on === 'telephone' && target.get('voice') === 'none' && target.get('cutoff') === 900, 'and a player\'s target describes voice, takes it by its place or its name beside other settings, and reads it back', [td, before, on, target.get('voice'), target.get('cutoff')])
}

console.log(`${count - failed} of ${count} passed`)
process.exit(failed ? 1 : 0)
