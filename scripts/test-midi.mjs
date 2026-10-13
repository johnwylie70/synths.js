#!/usr/bin/env node
/**
 * MIDI without a browser and without a MIDI device. Two halves:
 *
 *   the bytes       the reader and the writer of MIDI messages, against byte sequences
 *   the whole path  the library's functions, the commands they write, the desk that carries them out and the
 *                   offline player's real engine, with a pretend `midi` transport in place of the devices
 *
 *   node scripts/test-midi.mjs
 *
 * It ends with code 1 if a case fails.
 */
import * as synths from '../synths.js'
import * as midi from '../synths-midi.js'

const { createSound, createOfflinePlayer, describe } = synths
const { decodeMidi, encodeMidi, midiParser } = midi
const SR = 48000

let failed = 0
let count = 0
const say = (ok, what, got) => {
  count++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const near = (a, b, by = 1e-6) => Math.abs(a - b) <= by
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
function crossings(a, from, to) {
  let n = 0
  for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if (a[i - 1] < 0 && a[i] >= 0) n++
  return n
}
const wait = (ms = 0) => new Promise((yes) => setTimeout(yes, ms))
const thrown = (f) => { try { f(); return null } catch (e) { return e.message } }
const CLICK = { wave: 'sine', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0 }
async function saying(run) {
  const said = []
  const keep = { warn: console.warn, info: console.info, error: console.error }
  for (const how of Object.keys(keep)) console[how] = (...a) => said.push(a.join(' '))
  try { await run() } finally { Object.assign(console, keep) }
  return said
}

/** A pretend MIDI transport: what is sent is kept, and `play` is a device sending bytes. */
function pretend(inputs = ['Keys'], outputs = ['Box']) {
  const t = {
    sent: [], opened: 0, inputs: () => inputs, outputs: () => outputs,
    open() { t.opened++ },
    send(bytes, time, output) { t.sent.push([bytes, time, output]) },
    receive(listener) { t.play = (bytes, input = inputs[0], time) => listener(bytes, time, input) },
    changed(listener) { t.change = (ins, outs) => { inputs = ins; outputs = outs; listener() } },
  }
  return t
}
/** A sound whose player is offline and whose MIDI is pretend, with the MIDI file loaded and the devices known. */
async function midiSound(options = {}, transport = pretend()) {
  const player = await createOfflinePlayer({ midi: transport, ...options })
  let time = 0
  const sound = createSound({ sound: player, clock: () => time, batch: 'manual' })
  sound.midiDevices()
  for (let i = 0; i < 200 && sound.midiDevices().available === null; i++) { sound.flush(); await wait(5) }
  return { sound, player, transport, at: (t) => { time = t }, render: async (seconds) => { sound.flush(); return (await player.render(seconds)).left } }
}

// --- the bytes
{
  const read = midiParser()
  const got = read([0x90, 60, 100, 62, 127, 60, 0])
  say(same(got.map((m) => [m.type, m.channel, m.note]), [['noteOn', 1, 60], ['noteOn', 1, 62], ['noteOff', 1, 60]]) && near(got[0].velocity, 100 / 127) && got[1].velocity === 1 && got[2].velocity === 0,
    'running status: three notes after one status byte, and a note-on with no velocity is a note-off', got)
  say(same(got[1].data, [0x90, 62, 127]), 'each message carries its own whole bytes, the status put back', got[1].data)
  say(same(read([0x83, 60, 64]).map((m) => [m.type, m.channel, m.note, m.velocity]), [['noteOff', 4, 60, 0]]), 'a note-off is on its channel, counted from 1, with velocity 0', null)

  const bend = (bytes) => decodeMidi(bytes).bend
  say(bend([0xe0, 0, 0x40]) === 0 && bend([0xe0, 0x7f, 0x7f]) === 1 && bend([0xe0, 0, 0]) === -1 && near(bend([0xe0, 0, 0x60]), 4096 / 8191), 'pitch bend is 14 bits: the middle is 0, the ends are -1 and 1', [bend([0xe0, 0, 0x60])])
  say(same(encodeMidi({ type: 'bend', channel: 3, bend: 1 }), [0xe2, 0x7f, 0x7f]) && same(encodeMidi({ type: 'bend', bend: -1 }), [0xe0, 0, 0]) && same(encodeMidi({ type: 'bend', bend: 0 }), [0xe0, 0, 0x40]), 'and is written back the same', encodeMidi({ type: 'bend', bend: 0 }))

  const pedal = decodeMidi([0xb0, 64, 127])
  say(pedal.type === 'control' && pedal.control === 64 && pedal.value === 1 && decodeMidi([0xb5, 74, 0]).value === 0 && decodeMidi([0xb5, 74, 0]).channel === 6, 'the sustain pedal is control 64, and a control\'s value is from 0 to 1', pedal)

  const sys = midiParser()
  const first = sys([0xf0, 0x7e, 0x01])
  const second = sys([0xf8, 0x02, 0xf7, 0x90, 60, 0xf8, 100])
  say(first.length === 0 && same(second.map((m) => m.type), ['clock', 'sysex', 'clock', 'noteOn']) && same(second[1].data, [0xf0, 0x7e, 0x01, 0x02, 0xf7]) && second[3].note === 60,
    'a system exclusive message is kept whole across two pieces, and the clock may tick in the middle of it or of a note', second)
  say(same(midiParser()([0xfa, 0xf8, 0xfb, 0xfc, 0xfe, 0xff]).map((m) => m.type), ['start', 'clock', 'continue', 'stop', 'sensing', 'reset']), 'start, clock, continue, stop, sensing and reset are one byte each', null)
  say(same(midiParser()([0xf2, 0x10, 0x01, 0xc1, 5, 6, 0xd0, 127, 0xa0, 60, 127]).map((m) => [m.type, m.value ?? m.program]), [['songPosition', 144], ['program', 5], ['program', 6], ['pressure', 1], ['notePressure', 1]]),
    'song position, a program change (one byte, running too), pressure and a note\'s pressure are read', null)
  say(same(midiParser()([60, 100, 0xf7, 0xf0, 1, 0x90, 60, 100]).map((m) => m.type), ['noteOn']), 'bytes with no status before them, and a system exclusive message that is never finished, are let go', null)

  const all = [
    { type: 'noteOn', channel: 2, note: 61, velocity: 1 }, { type: 'noteOff', channel: 16, note: 0, velocity: 0, release: 0 }, { type: 'control', channel: 1, control: 74, value: 1 },
    { type: 'program', channel: 10, program: 99 }, { type: 'pressure', channel: 1, value: 0 }, { type: 'notePressure', channel: 1, note: 5, value: 1 }, { type: 'bend', channel: 1, bend: -1 },
    { type: 'clock' }, { type: 'start' }, { type: 'stop' }, { type: 'songPosition', value: 300 }, { type: 'sysex', data: [0xf0, 1, 2, 0xf7] },
  ]
  const back = all.map((m) => { const d = decodeMidi(encodeMidi(m)); delete d.data; return d })
  say(same(back, all.map((m) => { const c = { ...m }; if (m.type !== 'sysex') delete c.data; else delete c.data; return c })), 'every kind of message written to bytes and read back is itself', back)
  say(same(encodeMidi({ type: 'noteOn', note: 60, velocity: 0.001 }), [0x90, 60, 1]) && /no kind of MIDI message called "nope"/.test(thrown(() => encodeMidi({ type: 'nope' }))), 'a note that is only just played is still a note-on, and a kind that does not exist is said so', null)

  const names = describe().midi
  say(same(names.functions, midi.MIDI_FUNCTIONS) && same(names.synthFunctions, midi.MIDI_SYNTH_FUNCTIONS) && same(names.types, midi.MIDI_TYPES), 'the names synths.js lists for other languages are the ones synths-midi.js has', names)
  say(names.functions.every((n) => typeof synths[n] === 'function' && typeof synths[n.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] === 'function'), 'every MIDI function is exported, in its Python spelling too', null)
}

// --- a keyboard plays a synth
{
  const { sound, transport, render } = await midiSound()
  const lead = sound.makeSynth(CLICK)
  say(lead.playFromMidi() === lead && lead.play_from_midi === undefined ? false : true, 'playFromMidi gives the synth back', null)
  let a = await render(0.2)
  say(peak(a) === 0, 'nothing sounds until a key goes down', peak(a))
  transport.play([0x90, 60, 127])
  a = await render(1)
  say(peak(a) > 0.2 && Math.abs(crossings(a, 0, 1) - 261.6) <= 2, 'a note from the keyboard plays the synth at its pitch, with the program not asked', [peak(a), crossings(a, 0, 1)])
  transport.play([0x80, 60, 0])
  a = await render(0.2)
  say(peak(a.slice(2400)) === 0, 'and the key coming up lets it go', peak(a.slice(2400)))

  transport.play([0x90, 60, 127])
  const loud = peak(await render(0.1))
  transport.play([0x90, 60, 0, 60, 32])
  const quiet = peak((await render(0.1)).slice(2400))
  transport.play([60, 0])
  say(quiet > 0 && quiet < loud * 0.6, 'how hard the key is hit is how loud the note is', [loud, quiet])

  // The pedal.
  await render(0.1)
  transport.play([0xb0, 64, 127, 0x90, 64, 100, 0x80, 64, 0])
  const held = peak((await render(0.3)).slice(4800))
  transport.play([0xb0, 64, 0])
  const after = peak((await render(0.3)).slice(4800))
  say(held > 0.1 && after === 0, 'with the sustain pedal down a key that comes up goes on sounding, until the pedal comes up', [held, after])

  // Pitch bend: the engine's bend range is two semitones.
  transport.play([0x90, 60, 127, 0xe0, 0x7f, 0x7f])
  a = await render(1)
  say(Math.abs(crossings(a, 0.1, 1) / 0.9 - 293.66) <= 3, 'the pitch wheel pushed right up is two semitones higher', crossings(a, 0.1, 1) / 0.9)
  transport.play([0xe0, 0, 0x40, 0xb0, 123, 0])
  a = await render(0.2)
  say(peak(a.slice(2400)) === 0, 'and "all notes off" from the keyboard lets everything go', peak(a.slice(2400)))

  // One channel only, and stopping.
  lead.playFromMidi({ channel: 2 })
  sound.flush()
  transport.play([0x90, 60, 127])
  const other = peak(await render(0.2))
  transport.play([0x91, 60, 127])
  const mine = peak(await render(0.2))
  say(other === 0 && mine > 0.2, 'playFromMidi({ channel: 2 }) listens to channel 2 alone', [other, mine])
  lead.playFromMidi(false)
  a = await render(0.2)
  transport.play([0x91, 62, 127])
  const off = peak(await render(0.2))
  say(peak(a.slice(2400)) === 0 && off === 0, 'playFromMidi(false) lets go of what is held and stops listening', [peak(a.slice(2400)), off])
  say(transport.opened === 1, 'the transport was opened once', transport.opened)
}

// --- a program hears notes and knobs
{
  const { sound, transport, player, at } = await midiSound({ start: 100 })
  const heard = []
  sound.onMidiNote((note, velocity, channel) => heard.push(['note', note, +velocity.toFixed(3), channel]))
  sound.onMidiControl((number, value, channel) => heard.push(['control', number, +value.toFixed(3), channel]))
  const all = []
  sound.onMidi((m) => all.push(m))
  at(100)
  sound.flush()
  await player.render(0.25)
  transport.play([0x92, 60, 127, 0xb2, 74, 64, 0x82, 60, 0])
  say(same(heard, [['note', 60, 1, 3], ['control', 74, 0.504, 3], ['note', 60, 0, 3]]), 'onMidiNote and onMidiControl are called with the note, how hard, and the channel; a key coming up is velocity 0', heard)
  say(all.length === 3 && all[0].type === 'noteOn' && all[0].device === 'Keys' && near(all[0].time, 100.25, 1e-3) && same(all[1].data, [0xb2, 74, 64]), 'onMidi is given everything decoded, with the device and the time on the sound clock', all[0])
  say(same(JSON.parse(JSON.stringify(all)), all), 'and what is handed over is plain data, which can cross to a worker or another frame', null)

  heard.length = 0
  const ups = []
  sound.onMidiNoteOff((note, channel) => ups.push([note, channel]))
  transport.play([0x90, 62, 100, 0x80, 62, 0])
  say(same(heard.map((h) => h.slice(0, 2)), [['note', 62]]) && same(ups, [[62, 1]]), 'with onMidiNoteOff, a key coming up goes there and not to onMidiNote', [heard, ups])

  // A scene's own functions, as an app wires them.
  const scene = []
  sound.useMidiHooks({ onMidiNote: (note) => scene.push(note), on_midi_control: (number) => scene.push(-number), update() {} })
  transport.play([0x90, 70, 100, 0xb0, 7, 1])
  say(same(scene, [70, -7]), 'useMidiHooks calls a scene\'s own onMidiNote and on_midi_control', scene)

  const lists = []
  sound.onMidiDevices((d) => lists.push(d))
  transport.change(['Keys', 'Pads'], [])
  say(lists.length === 2 && same(lists[1], { inputs: ['Keys', 'Pads'], outputs: [], available: true }) && same(sound.midiDevices().inputs, ['Keys', 'Pads']), 'onMidiDevices is called with what is there, and again when a device is plugged in', lists)

  sound.useMidiInput('Pads')
  sound.flush()
  heard.length = 0
  transport.play([0x90, 50, 100], 'Keys')
  transport.play([0x90, 51, 100], 'Pads')
  say(same(heard.map((h) => h[1]), [51]), 'useMidiInput listens to one device alone', heard)

  let bad
  const said = await saying(() => { sound.onMidiNote(() => { throw new Error('oops') }); transport.play([0x90, 52, 100], 'Pads'); bad = heard.length })
  say(bad === 2 && said.length === 1, 'a function of the program\'s that fails is reported and the others are still called', [bad, said])

  sound.stopMidi()
  sound.flush()
  heard.length = 0
  transport.play([0x90, 53, 100], 'Pads')
  say(heard.length === 0, 'stopMidi forgets every function', heard)
}

// --- sending
{
  const { sound, transport, at } = await midiSound()
  const sent = () => { sound.flush(); return transport.sent.splice(0) }
  sound.sendMidiNote('C4', 0.8, { length: 0.5, channel: 1 })
  say(same(sent(), [[[0x90, 60, 102], 0, undefined], [[0x80, 60, 0], 500, undefined]]), 'sendMidiNote is a note-on now and a note-off after its length, in milliseconds', null)
  sound.sendMidiNote(['C4', 'E4'], 1, 0.25, { channel: 10, after: 2, output: 'Box' })
  say(same(sent(), [[[0x99, 60, 127], 2000, 'Box'], [[0x99, 64, 127], 2000, 'Box'], [[0x89, 60, 0], 2250, 'Box'], [[0x89, 64, 0], 2250, 'Box']]), 'a chord, a channel, an output by name and { after } are carried, in the order of their times', null)
  sound.setTempo(120)
  sound.sendMidiNote('A4', { beat: 4, length: sound.beats(1) })
  sound.sendMidiNote(69, { at: 7, length: null })
  say(same(sent(), [[[0x90, 69, 102], 2000, undefined], [[0x80, 69, 0], 2500, undefined], [[0x90, 69, 102], 7000, undefined]]), '{ beat } and { at } place a note as they place a sound, and length: null holds it', null)
  sound.sendMidiNote('C4', 0.8, { length: 'eighth', after: 'quarter' })
  say(same(sent(), [[[0x90, 60, 102], 500, undefined], [[0x80, 60, 0], 750, undefined]]), 'a length and { after } may be note lengths by name, at the tempo', null)
  sound.sendMidiNoteOff('A4', { at: 8 })
  sound.sendMidiControl(74, 0.5)
  sound.sendMidiControl(1, 1, { channel: 16, after: 0.1 })
  sound.sendMidiBend(-1)
  sound.sendMidiProgram(5, { channel: 2 })
  sound.sendMidi([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7], { after: 0.2 })
  say(same(sent(), [[[0xb0, 74, 64], 0, undefined], [[0xe0, 0, 0], 0, undefined], [[0xc1, 5], 0, undefined], [[0xbf, 1, 127], 100, undefined], [[0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7], 200, undefined], [[0x80, 69, 0], 8000, undefined]]),
    'sendMidiControl, sendMidiBend, sendMidiProgram, sendMidi with any bytes, and sendMidiNoteOff', null)
  sound.useMidiOutput('Box')
  sound.sendMidi([0xfa])
  sound.useMidiOutput()
  say(same(sent(), [[[0xfa], 0, 'Box']]), 'useMidiOutput chooses where everything goes', null)

  // Mistakes, in plain words, at the line.
  const mistakes = [
    [() => sound.sendMidiNote(), /sendMidiNote needs a note, as in sendMidiNote\("C4"\)/],
    [() => sound.sendMidiNote('H4'), /"H4" is not a note/],
    [() => sound.sendMidiNote(140), /MIDI has the notes 0 to 127 \("C-1" to "G9"\), and 140 is outside them/],
    [() => sound.sendMidiNote('C4', 0.8, { channel: 17 }), /channel needs a whole number from 1 to 16, not 17/],
    [() => sound.sendMidiNote('C4', 0.8, { length: -1 }), /the length needs a number of seconds, more than 0/],
    [() => sound.sendMidiControl(200, 0.5), /needs the number of a control, a whole number from 0 to 127, not 200/],
    [() => sound.sendMidiControl(7, 'loud'), /the value needs a number from 0 to 1, not "loud"/],
    [() => sound.sendMidi([60, 100]), /needs the bytes of a MIDI message, beginning with its status byte, as in sendMidi\(\[0x90, 60, 100\]\)/],
    [() => sound.onMidiNote('x'), /onMidiNote needs a function to call, as in onMidiNote\(\(note, velocity\) => \{ \.\.\. \}\), not "x"/],
    [() => sound.makeSynth().mapMidi(74, 'cutof'), /there is no setting called "cutof"\. Did you mean "cutoff"\?/],
    [() => sound.makeSynth().mapMidi('cutoff', 74), /mapMidi needs the number of a knob or slider, from 0 to 119, and then a setting, as in lead\.mapMidi\(74, "cutoff"\)/],
    [() => sound.makeSynth().learn(), /learn needs the name of a setting, as in lead\.learn\("cutoff"\)/],
    [() => sound.useMidiOutput(3), /useMidiOutput needs the name of a MIDI device/],
  ]
  const wrong = mistakes.map(([f, wants]) => [thrown(f), wants]).filter(([got, wants]) => !wants.test(got || ''))
  say(wrong.length === 0, `${mistakes.length} mistakes are said in plain words, with what to write instead`, wrong.map(([got]) => got))
  const said = await saying(() => sound.useMidiOutput('Moog'))
  sound.useMidiOutput()
  say(said.length === 1 && /there is no MIDI output called "Moog" at the moment\. The outputs are: "Box"/.test(said[0]), 'a device that is not there is said, and waited for', said)
  sent()

  // The clock.
  at(1)
  sound.setTempo(120)
  sound.sendMidiClock()
  sound.flush()
  const clock = transport.sent.splice(0)
  const gaps = clock.slice(2, 26).map((m, i) => m[1] - clock[i + 1][1])
  say(same(clock[0], [[0xfa], 1000, undefined]) && clock[1][0][0] === 0xf8 && clock[1][1] === 1000 && gaps.every((g) => near(g, 60000 / 120 / 24, 1e-6)) && clock.length > 2000, 'sendMidiClock sends a start and then 24 ticks a beat, at the tempo', [clock.slice(0, 3), gaps.slice(0, 2), clock.length])
  sound.sendMidiClock(false)
  say(same(sent().map((m) => m[0]), [[0xfc]]), 'and sendMidiClock(false) sends a stop', null)
}

// --- a synth whose notes go out as MIDI
{
  const { sound, transport, at } = await midiSound()
  const sent = () => { sound.flush(); return transport.sent.splice(0) }
  const lead = sound.makeSynth('lead')
  const kick = sound.makeSynth('kick').sendToMidi({ channel: 10 })
  lead.sendToMidi()
  lead.play('C4', 0.5, 1)
  lead.play(['E4', 'G4'], { length: 0.25, after: 1 })
  kick.play()
  say(same(sent(), [[[0x90, 60, 127], 0, undefined], [[0x99, 36, 102], 0, undefined], [[0x89, 36, 0], 300, undefined], [[0x80, 60, 0], 500, undefined], [[0x90, 64, 102], 1000, undefined], [[0x90, 67, 102], 1000, undefined], [[0x80, 64, 0], 1250, undefined], [[0x80, 67, 0], 1250, undefined]]),
    'sendToMidi: what a synth plays goes out as notes on its channel, a drum as its own note', null)
  const note = lead.start('A3')
  const on = sent()
  at(2)
  note.stop()
  say(same(on, [[[0x90, 57, 102], 0, undefined]]) && same(sent(), [[[0x80, 57, 0], 2000, undefined]]), 'a note that is started goes out, and is let go when it is stopped', on)
  lead.noteOn('C5')
  lead.noteOff('C5')
  say(same(sent().map((m) => m[0][0]), [0x90, 0x80]), 'and so do the keys of an on-screen keyboard', null)

  at(10)
  lead.playNotes('C4 - E4:2', 0.25, { repeat: 2 })
  const tune = sent()
  say(same(tune.map((m) => [m[0][0], m[0][1], Math.round(m[1])]), [[0x90, 60, 10000], [0x80, 60, 10225], [0x90, 64, 10500], [0x80, 64, 10950], [0x90, 60, 11000], [0x80, 60, 11225], [0x90, 64, 11500], [0x80, 64, 11950]]), 'a tune goes out step by step, each time round', tune)

  const beat = lead.playNotes('C4 D4', 0.5, { repeat: true })
  const first = sent()
  beat.stop()
  sound.flush()
  say(first.length > 150 && first.every((m) => m[0][0] !== 0x90 || m[1] <= 60000) && first[0][1] === 10000, 'a tune that repeats for ever is written a minute ahead and no further', [first.length, first[0], first[first.length - 1]])

  // Stopping.
  lead.start('C3')
  sound.sendMidiNote('G3', { length: null })
  sound.sendMidiNote('B3', { after: 5 })
  sent()
  sound.stopSound()
  const stopped = sent()
  say(same(stopped.map((m) => m[0]).sort(), [[0x80, 48, 0], [0x80, 55, 0]]), 'stopSound lets go of the MIDI notes that are sounding, and takes back the ones still to come', stopped)
  lead.sendToMidi(false)
  lead.play('C4')
  say(sent().length === 0, 'sendToMidi(false) stops it', null)
}

// --- MIDI in the first lines of a program, before its file has arrived: the order is as written
{
  const transport = pretend()
  const result = await synths.renderSound((s) => {
    const lead = s.makeSynth(CLICK)
    s.sendMidiNote('C2', 1, { length: 0.1, after: 0.5 })
    lead.sendToMidi().playNotes('A4 B4', 0.25)
    lead.play('C5', 0.1, { after: 1 })
    s.sendMidiControl(7, 1)
  }, { seconds: 1.5, midi: transport })
  say(same(transport.sent.map((m) => [m[0][0], m[0][1], Math.round(m[1])]), [[0xb0, 7, 0], [0x90, 69, 0], [0x80, 69, 225], [0x90, 71, 250], [0x80, 71, 475], [0x90, 36, 500], [0x80, 36, 600], [0x90, 72, 1000], [0x80, 72, 1100]]) && peak(result.left) > 0.2,
    'a synth told to send to MIDI and played in the same breath sends its first notes too, at the times they were asked for', transport.sent)
  // And with no transport at all the sound is as it would be.
  const plain = await synths.renderSound((s) => { s.makeSynth(CLICK).play('A4', 0.5) }, { seconds: 1 })
  const withMidi = await synths.renderSound((s) => { s.makeSynth(CLICK).playFromMidi().play('A4', 0.5); s.onMidiNote(() => {}) }, { seconds: 1, midi: pretend() })
  let differ = 0
  for (let i = 0; i < plain.left.length; i++) if (plain.left[i] !== withMidi.left[i]) differ++
  say(differ === 0, 'using MIDI changes nothing about the sound, to the sample', differ)
}

// --- a knob turns a setting
{
  const { sound, transport, player, render } = await midiSound()
  const lead = sound.makeSynth('lead')
  const turned = []
  lead.mapMidi(74, 'cutoff', (value) => turned.push(value))
  lead.mapMidi(71, 'resonance')
  lead.mapMidi(20, 'wave')
  lead.mapMidi(21, 'echo', { min: 0.2, max: 0.6, channel: 2 })
  await render(0.01)
  const target = player.target(lead._id)
  transport.play([0xb0, 74, 0])
  const low = [lead.cutoff, target.get('cutoff')]
  transport.play([0xb0, 74, 127])
  const high = [lead.cutoff, target.get('cutoff')]
  transport.play([0xb0, 74, 64])
  const middle = lead.cutoff
  say(same(low, [20, 20]) && same(high.map(Math.round), [20000, 20000]) && near(middle, 20 * Math.pow(1000, 64 / 127), 0.01), 'mapMidi scales a knob through the whole range of a setting: a pitch in Hz by ratio, 20 at the bottom, 20000 at the top', [low, high, middle])
  say(same(turned.map(Math.round), [20, 20000, 650]), 'and its function is called with each new value', turned)
  transport.play([0xb0, 71, 127])
  const res = lead.resonance
  transport.play([0xb0, 71, 32])
  const d = lead.describe('resonance')
  say(res === d.max && near(lead.resonance, d.min + (d.max - d.min) * 32 / 127, 1e-6) && near(target.get('resonance'), lead.resonance, 1e-6), 'a plain setting is scaled by amount, from its least to its most', [res, lead.resonance, d])
  transport.play([0xb0, 20, 0])
  const firstWave = lead.wave
  transport.play([0xb0, 20, 127])
  const waves = lead.describe('wave').choices
  say(firstWave === waves[0] && lead.wave === waves[waves.length - 1] && target.get('wave') === lead.wave, 'a setting that is a choice steps through its choices', [firstWave, lead.wave])
  transport.play([0xb0, 21, 127])
  const untouched = lead.echo
  transport.play([0xb1, 21, 127, 0xb1, 21, 0])
  say(untouched !== 0.6 && near(lead.echo, 0.2), '{ min, max } narrow the range and { channel } the channel', [untouched, lead.echo])

  // Learning.
  const pad = sound.makeSynth('pad')
  const events = []
  sound.onMidi((m) => { if (m.type === 'learned') events.push([m.setting, m.control]) })
  pad.learn('cutoff')
  pad.learn('reverb')
  sound.flush()
  transport.play([0xb0, 74, 10])      // already tied to the lead's cutoff: not this one
  transport.play([0xb0, 30, 127, 0xb0, 30, 126])
  const one = pad.cutoff
  transport.play([0xb0, 31, 64])
  say(same(events, [['cutoff', 30], ['reverb', 31]]) && near(one, 20 * Math.pow(1000, 126 / 127), 0.5) && near(pad.reverb, 64 / 127, 1e-6), 'learn ties a setting to the next knob that is moved and is not already tied, one knob for each setting waiting', [events, one, pad.reverb])
  pad.unmapMidi('cutoff')
  sound.flush()
  transport.play([0xb0, 30, 0])
  say(near(pad.cutoff, one, 1e-9), 'unmapMidi lets a setting go', pad.cutoff)

  // The engine really is set: the sound changes.
  const tone = sound.makeSynth({ wave: 'saw', filter: 'lowpass', cutoff: 20000, attack: 0, sustain: 1 })
  tone.mapMidi(40, 'cutoff')
  tone.start('C3')
  const bright = await render(0.5)
  transport.play([0xb0, 40, 20])
  const dull = await render(0.5)
  const rough = (a) => { let s = 0; for (let i = 12001; i < a.length; i++) s += Math.abs(a[i] - a[i - 1]); return s }
  say(rough(dull) < rough(bright) * 0.5, 'and the knob is heard: the filter closes', [rough(bright), rough(dull)])
}

// --- the clock another device sends
{
  const { sound, transport, player } = await midiSound()
  const tempos = []
  sound.onMidi((m) => { if (m.type === 'tempo') tempos.push(m.bpm) })
  sound.flush()
  await player.render(0.01)
  transport.play([0xfa], 'Keys', 1000)
  for (let i = 0; i <= 30; i++) transport.play([0xf8], 'Keys', 1000 + i * 20)
  say(same(tempos, [125]), 'a clock arriving 24 ticks a beat is told as a tempo, once it is known', tempos)
}

// --- where there is no MIDI
{
  const run = async (options) => {
    const player = await createOfflinePlayer(options)
    const sound = createSound({ sound: player, clock: () => 0 })
    let devices = null
    let threw = null
    const said = await saying(async () => {
      try {
        sound.onMidiDevices((d) => { devices = d })
        sound.makeSynth('lead').playFromMidi().sendToMidi().learn('cutoff').mapMidi(1, 'echo').play('C4')
        sound.onMidiNote(() => {})
        sound.sendMidiNote('C4')
        sound.sendMidi([0x90, 60, 100])
        sound.sendMidiClock()
        sound.useMidiInput('none')
        await wait(60)
        sound.sendMidiControl(1, 1)
        sound.midiDevices()
        sound.stopMidi()
        await wait(30)
      } catch (e) { threw = e.message }
    })
    const heard = peak((await player.render(0.3)).left)
    return { said, devices, threw, heard, now: sound.midiDevices() }
  }
  // An offline player in node with no transport given: what a browser with no Web MIDI is.
  const none = await run({})
  say(none.threw === null && none.said.length === 1 && /MIDI is not available in this browser\. Use Chrome, Edge or Firefox on a computer \(Safari, iPhones and iPads have no MIDI for web pages\), or the Circuitry app once it supports MIDI\. The rest of your program carries on without it\./.test(none.said[0]),
    'with no MIDI in the browser every MIDI function still works, and one plain message says so and what to use', none)
  say(same(none.devices, { inputs: [], outputs: [], available: false }) && same(none.now, none.devices) && none.heard > 0.05, 'midiDevices() is empty, and the sound plays as ever', [none.devices, none.heard])
  const off = await run({ midi: false })
  say(off.threw === null && off.said.length === 1 && /MIDI is switched off for this page/.test(off.said[0]) && off.devices.available === false, 'midi: false switches it off, with one message', off.said)
  const broken = await run({ midi: { open() { throw new Error('no CoreMIDI') }, inputs: () => [], outputs: () => [], send() {}, receive() {} } })
  say(broken.threw === null && broken.said.length === 1 && /MIDI could not be started here \(no CoreMIDI\)/.test(broken.said[0]), 'a host\'s transport that cannot open is said once, and nothing throws', broken.said)
}

// --- an app whose player is elsewhere: the commands are plain data, and what is received is handed over
{
  const batches = []
  const sound = createSound({ sound: { send: (b) => batches.push(JSON.parse(JSON.stringify(b))) }, clock: () => 5, batch: 'manual', ids: 'a:' })
  const lead = sound.makeSynth('lead')
  const got = []
  lead.playFromMidi({ channel: 3 }).learn('cutoff', (v) => got.push(v))
  sound.onMidiNote((note, velocity) => got.push([note, velocity]))
  sound.sendMidiNote('C4', 0.5, { length: 1, after: 1 })
  for (let i = 0; i < 100 && !batches.some((b) => b.cmds.some((c) => c.op === 'midi')); i++) { await wait(5); sound.flush() }
  const cmds = batches.flatMap((b) => b.cmds).filter((c) => c.op === 'midi')
  say(same(cmds, [
    { op: 'midi', do: 'play', id: 'a:s1', vibrato: [0.15, 0.5], channel: 3 },
    { op: 'midi', do: 'learn', id: 'a:s1', setting: 'cutoff', min: 20, max: 20000, kind: 'float', curve: 'exp' },
    { op: 'midi', do: 'listen' },
    { op: 'midi', do: 'send', bytes: [0x90, 60, 64], t: 6 },
    { op: 'midi', do: 'send', bytes: [0x80, 60, 0], t: 7 },
  ]), 'the functions write midi commands that survive JSON, stamped with when they were called even while the MIDI file was still loading', cmds)
  // The player's side: a desk beside an offline player, as a host would have one beside its real player.
  const transport = pretend()
  const player = await createOfflinePlayer({ midi: transport, start: 5 })
  player.onMidi((events) => sound.receiveMidi(JSON.parse(JSON.stringify(events))))
  for (const b of batches) player.send(b)
  await wait(20)
  transport.play([0x92, 60, 127])
  transport.play([0xb0, 9, 127])
  const a = (await player.render(0.5)).left
  say(peak(a) > 0.05 && same(got, [[60, 1], 20000]) && Math.round(lead.cutoff) === 20000 && same(transport.sent.map((m) => m[1]), [1000, 2000]), 'a player elsewhere plays the keyboard itself and hands back what the program asked to hear, through receiveMidi', [peak(a), got, transport.sent])
}

console.log(`${count - failed} of ${count} passed`)
process.exit(failed ? 1 : 0)
