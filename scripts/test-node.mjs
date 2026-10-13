#!/usr/bin/env node
/**
 * The library without a browser: what the functions write as commands, and what those commands sound like when
 * the offline player renders them with the real engine. Each case renders sound to numbers and measures it:
 * where the first sample is, how many times the wave crosses zero, how loud it is.
 *
 *   node scripts/test-node.mjs
 *
 * It ends with code 1 if a case fails.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as synths from '../synths.js'

const { renderSound, createSound, createOfflinePlayer, noteNumber, chordNotes, toWav, readWav, describe } = synths
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR = 48000

let failed = 0
let count = 0
const say = (ok, what, got) => {
  count++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// --- measuring
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const first = (a, over = 0) => a.findIndex((v) => Math.abs(v) > over)
// The frames where sound begins after at least `quiet` frames of silence.
function onsets(a, quiet = 200, over = 1e-4) {
  const found = []
  let silent = quiet
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]) > over) {
      if (silent >= quiet) found.push(i)
      silent = 0
    } else silent++
  }
  return found
}
// Upward crossings of zero between two times: the pitch of a plain wave, in Hz, when the span is a second.
function crossings(a, from, to) {
  let n = 0
  for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if (a[i - 1] < 0 && a[i] >= 0) n++
  return n
}
// A plain voice that starts and stops at once, so its edges can be found to the sample.
const CLICK = { wave: 'sine', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0 }
const thrown = (f) => { try { f(); return null } catch (e) { return e.message } }
// What a function writes, as the batches a transport would be given.
function written(play, options = {}) {
  const batches = []
  const s = createSound({ sound: { send: (b) => batches.push(b) }, clock: () => 0, batch: 'manual', ...options })
  play(s)
  s.flush()
  return batches
}
const commands = (play, options) => written(play, options).flatMap((b) => b.cmds)
// What is said in the console while a function runs.
async function saying(run) {
  const said = []
  const keep = { warn: console.warn, info: console.info, error: console.error }
  for (const how of Object.keys(keep)) console[how] = (...a) => said.push(a.join(' '))
  try { await run() } finally { Object.assign(console, keep) }
  return said
}

// --- what is vendored is in step
{
  const check = spawnSync(process.execPath, [join(ROOT, 'scripts/sync-engine.mjs'), '--check'], { encoding: 'utf8' })
  say(check.status === 0, 'the parameter table, the worklet file and the names file match the engine in the package', check.stdout + check.stderr)
  const d = describe()
  const byName = new Map(d.settings.map((p) => [p.name, p]))
  const lost = Object.entries(d.names).filter(([, to]) => !byName.has(to.setting)).map(([alias]) => alias)
  say(d.engine.abi === 1 && d.settings.length >= 100 && lost.length === 0, `every friendly name (${Object.keys(d.names).length}) is a setting the engine has (${d.settings.length})`, { abi: d.engine.abi, lost })
  const names = synths.settingNames()
  const bad = []
  for (const which of ['synths', 'sounds']) for (const [name, entry] of Object.entries(d[which])) {
    if (name === 'sample') continue          // what loadSample starts from: it is given its sample there
    const said = thrown(() => written((s) => s.makeSynth(which === 'synths' ? Object.fromEntries(Object.entries(entry).filter(([k]) => k !== 'note')) : entry.patch)))
    if (said) bad.push(`${name}: ${said}`)
  }
  say(bad.length === 0 && names.includes('cutoff'), `every ready-made synth (${Object.keys(d.synths).length}) and sound (${Object.keys(d.sounds).length}) uses only settings and choices that exist`, bad)
}

{
  const pack = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const missing = pack.files.filter((f) => !existsSync(join(ROOT, f)))
  say(pack.version === synths.version && describe().version === pack.version && missing.length === 0, 'the package and the library agree on the version, and every file the package lists is there', { pack: pack.version, lib: synths.version, missing })
}

// --- notes
say(same(['C4', 'A4', 'c#4', 'Db4', 'F#3', 'Bb5', 'C-1', 'G', 61.5, '72'].map(noteNumber), [60, 69, 61, 61, 54, 82, 0, 67, 61.5, 72]), 'note names and numbers', ['C4', 'A4', 'c#4', 'Db4', 'F#3', 'Bb5', 'C-1', 'G', 61.5, '72'].map(noteNumber))
say(/"H4" is not a note\. Write a note as a name like "C4"/.test(thrown(() => noteNumber('H4'))), 'a note that is not one says how to write a note', thrown(() => noteNumber('H4')))

// --- a note makes sound, at the right pitch, at the right time
{
  const r = await renderSound((s) => s.makeSynth(CLICK).play('A4', 0.5), { seconds: 1 })
  const hz = crossings(r.left, 0, 0.5) * 2
  say(first(r.left) <= 1 && Math.abs(hz - 440) <= 2 && peak(r.left) > 0.2 && peak(r.left) < 0.5, 'a sine at A4 starts on the first sample, is 440 Hz and is neither silent nor too loud', { first: first(r.left), hz, peak: peak(r.left) })
  const end = r.left.length - 1 - [...r.left].reverse().findIndex((v) => Math.abs(v) > 1e-4)
  say(Math.abs(end - 0.5 * SR) < 0.01 * SR, 'it stops when its length is over (half a second, within a hundredth)', end / SR)
}
{
  const r = await renderSound((s) => s.makeSynth(CLICK).play('A4', 0.1, { at: 0.5 }), { seconds: 1 })
  say(first(r.left) === 0.5 * SR + 1 || first(r.left) === 0.5 * SR, '{ at: 0.5 } starts on frame 24000 exactly', first(r.left))
  const q = await renderSound((s) => s.makeSynth(CLICK).play('A4', 0.1, { after: 0.25 }), { seconds: 1 })
  say(Math.abs(first(q.left) - 0.25 * SR) <= 1, '{ after: 0.25 } starts on frame 12000', first(q.left))
  const b = await renderSound((s) => { s.setTempo(120); s.makeSynth(CLICK).play('A4', s.beats(0.1), { beat: 3 }) }, { seconds: 2 })
  say(Math.abs(first(b.left) - 1.5 * SR) <= 1, '{ beat: 3 } at 120 beats a minute starts at a second and a half', first(b.left))
}
{
  const r = await renderSound((s) => s.playNote('C4'), { seconds: 2 })
  const chord = await renderSound((s) => s.playNote(['C4', 'E4', 'G4']), { seconds: 2 })
  say(peak(r.left) > 0.1 && peak(chord.left) > peak(r.left) * 1.3, 'playNote plays, and a list of notes is a chord (louder than one note)', [peak(r.left), peak(chord.left)])
  const loud = await renderSound((s) => s.playNote('C4', 0.5, 1), { seconds: 1 })
  const soft = await renderSound((s) => s.playNote('C4', 0.5, 0.25), { seconds: 1 })
  say(Math.abs(peak(soft.left) / peak(loud.left) - 0.25) < 0.02, 'the third thing given to playNote is how loud: 0.25 is a quarter of 1', peak(soft.left) / peak(loud.left))
}

// --- a tune is on the beat to the sample
{
  const r = await renderSound((s) => s.makeSynth(CLICK).playNotes('A4 - A4 A4:2 A4', 0.25, { hold: 0.2 }), { seconds: 2 })
  const got = onsets(r.left)
  say(same(got.map((f) => Math.round(f / 10) * 10), [0, 24000, 36000, 60000]), 'playNotes("A4 - A4 A4:2 A4", 0.25): notes at 0, 0.5, 0.75 and 1.25 seconds, the rest and the long note counted', got)
  const exact = got.slice(1).map((f, i) => f - got[i])
  say(same(exact, [24000, 12000, 24000]), 'and the gaps between them are exact to the sample', exact)
}
{
  const r = await renderSound((s) => s.makeSynth(CLICK).playNotes(['A4', null, 'E5'], 0.1, { repeat: true, hold: 0.2 }), { seconds: 3 })
  const got = onsets(r.left)
  const gaps = got.slice(1).map((f, i) => f - got[i])
  say(got.length === 20 && gaps.every((g, i) => g === (i % 2 ? 4800 : 9600)), 'a tune with { repeat: true } keeps going, every gap exact: 20 notes in 3 seconds', { notes: got.length, gaps: [...new Set(gaps)] })
  const twice = await renderSound((s) => s.makeSynth(CLICK).playNotes('A4 E5', 0.1, { repeat: 2, hold: 0.2 }), { seconds: 3 })
  say(onsets(twice.left).length === 4, '{ repeat: 2 } plays it twice', onsets(twice.left).length)
  const stopped = await renderSound((s) => { const tune = s.makeSynth(CLICK).playNotes('A4 E5', 0.1, { repeat: true, hold: 0.2 }); tune.stop() }, { seconds: 1 })
  say(peak(stopped.left) === 0, 'a tune that is stopped is silent', peak(stopped.left))
}

// --- settings
{
  const dull = await renderSound((s) => s.makeSynth({ wave: 'saw', cutoff: 200 }).play('C3', 0.5), { seconds: 0.5 })
  const bright = await renderSound((s) => s.makeSynth({ wave: 'saw', cutoff: 8000 }).play('C3', 0.5), { seconds: 0.5 })
  // How jagged the wave is: the size of the step from one sample to the next (a saw's sudden drop counts for a lot).
  const jagged = (a) => Math.sqrt(a.slice(1).reduce((sum, v, i) => sum + (v - a[i]) ** 2, 0) / a.length)
  say(jagged(bright.left) > jagged(dull.left) * 4, 'cutoff works without turning the filter on first: 8000 is much brighter than 200', [jagged(dull.left), jagged(bright.left)])
  const later = await renderSound((s) => { const synth = s.makeSynth({ wave: 'saw', cutoff: 8000 }); synth.play('C3', 0.5); synth.cutoff = 200 }, { seconds: 0.5 })
  say(Math.abs(jagged(later.left) - jagged(dull.left)) < jagged(dull.left) * 0.1, 'a setting written as a property (lead.cutoff = 200) changes the sound', [jagged(later.left), jagged(dull.left)])
}
{
  let lead
  const cmds = commands((s) => {
    lead = s.makeSynth('lead', { cutoff: 1200 })
    lead.cutoff = 800
    lead.filter_cutoff = 700
    lead['filter.resonance'] = 0.5
    lead.octave = -1
    lead.wave = 'square'
    lead.mine = 'kept'
  })
  say(same([lead.cutoff, lead.filterCutoff, lead.resonance, lead.octave, lead.transpose, lead.wave, lead.width, lead.attack, lead.echo, lead.mine, lead.nothing], [700, 700, 0.5, -1, -12, 'pulse', 0.5, 0.01, 0.2, 'kept', undefined]),
    'settings read back what was asked for, by any spelling, and a ready-made synth\'s own values',
    [lead.cutoff, lead.filterCutoff, lead.resonance, lead.octave, lead.transpose, lead.wave, lead.width, lead.attack, lead.echo, lead.mine, lead.nothing])
  say(same(cmds.map((c) => [c.op, c.preset, c.set]), [['synth', 'lead', { cutoff: 1200 }], ['set', undefined, { cutoff: 800 }], ['set', undefined, { filter_cutoff: 700 }], ['set', undefined, { 'filter.resonance': 0.5 }], ['set', undefined, { octave: -1 }], ['set', undefined, { wave: 'square' }]]),
    'and each one is a command with the name as it was written', cmds)
  const up = await renderSound((s) => s.makeSynth({ ...CLICK, octave: 1 }).play('A3', 0.5), { seconds: 0.5 })
  say(Math.abs(crossings(up.left, 0, 0.5) * 2 - 440) <= 2, 'octave: 1 plays A3 as A4', crossings(up.left, 0, 0.5) * 2)
}

// --- mistakes are said in plain words, with what was meant
{
  const s = createSound({ sound: { send() {} }, clock: () => 0 })
  const lead = s.makeSynth()
  const cases = [
    ['a setting spelt wrongly', () => s.makeSynth({ cutof: 800 }), /makeSynth\(\): there is no setting called "cutof"\. Did you mean "cutoff"\?/],
    ['a setting spelt wrongly as a property', () => { lead.resonence = 0.5 }, /A synth has no setting called "resonence"\. Did you mean "resonance"\?/],
    ['a wave that does not exist', () => s.makeSynth({ wave: 'sqare' }), /wave: "sqare" is not one of its choices\. Did you mean "square"\? They are: sine, triangle, saw, pulse, sample/],
    ['a setting given words', () => { lead.cutoff = 'low' }, /set: cutoff needs a number from 20 to 20000, not "low"/],
    ['a sound that does not exist', () => s.playSound('lazer'), /playSound\("lazer"\): there is no sound called "lazer"\. Did you mean "laser"\? The sounds are: coin, jump, laser/],
    ['a synth that does not exist', () => s.makeSynth('base'), /makeSynth\("base"\): there is no synth called "base"\. Did you mean "bass"\? The synths are: keys, bass, lead/],
    ['a note that is not one', () => lead.play('H2'), /"H2" is not a note/],
    ['a length that is not a time', () => lead.play('C4', -1), /play: the length needs a number of seconds, more than 0, or a note length such as "quarter", not -1/],
    ['playNote with nothing', () => s.playNote(), /playNote needs a note, as in playNote\("C4"\)/],
    ['a tune with nothing in it', () => s.playNotes(''), /playNotes needs notes to play, as in playNotes\("C4 E4 G4 - C5"\)/],
    ['loadSample with no file', () => s.loadSample(), /loadSample\(\) needs the name of a sound file, as in loadSample\("kick\.wav"\)/],
    ['a synth setting given to setEffects', () => s.setEffects({ cutoff: 500 }), /setEffects is for the effects every synth shares: .*echoTime.*A synth's own settings are set on the synth/],
    ['an effect spelt wrongly', () => s.setEffects({ echoTim: 0.2 }), /there is no setting called "echoTim"\. Did you mean "echoTime"\?/],
  ]
  for (const [what, run, says] of cases) say(says.test(thrown(run) || ''), `${what} says so`, thrown(run))
}

// --- both spellings
{
  const s = createSound({ sound: { send() {} } })
  const camel = Object.keys(synths).filter((n) => /^[a-z]+[A-Z]/.test(n) && typeof synths[n] === 'function' && !['createPlayer', 'createOfflinePlayer', 'readWav', 'toWav', 'soundPlayer'].includes(n))
  const snake = (n) => n.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
  const missing = camel.filter((n) => synths[snake(n)] !== synths[n])
  const inScene = ['playSound', 'playNote', 'playNotes', 'makeSynth', 'loadSample', 'playSong', 'stopSong', 'stopSound', 'setVolume', 'muteSound', 'unmuteSound', 'setEffects', 'setTempo', 'soundTime'].filter((n) => s[snake(n)] !== s[n])
  say(missing.length === 0 && inScene.length === 0 && camel.length >= 16, `every function has its Python spelling too (${camel.length} of them, play_sound to note_number)`, { missing, inScene })
}

// --- the ready-made sounds and synths
{
  const quiet = []
  for (const name of synths.soundNames()) {
    const r = await renderSound((s) => s.playSound(name), { seconds: 3 })
    const p = Math.max(peak(r.left), peak(r.right))
    if (!(p > 0.1 && p <= 1) || !r.left.every(Number.isFinite) || first(r.left) > 240) quiet.push([name, p])
  }
  say(quiet.length === 0, `all ${synths.soundNames().length} game sounds make sound within 5 milliseconds, none silent and none past full volume`, quiet)
  for (const name of synths.synthNames()) {
    const r = await renderSound((s) => s.makeSynth(name).play(), { seconds: 3 })
    const p = Math.max(peak(r.left), peak(r.right))
    if (!(p > 0.1 && p <= 1) || !r.left.every(Number.isFinite)) quiet.push([name, p])
  }
  say(quiet.length === 0, `all ${synths.synthNames().length} ready-made synths play when asked with no note at all`, quiet)
  const low = await renderSound((s) => s.playSound('blip'), { seconds: 0.05 })
  const high = await renderSound((s) => s.playSound('blip', { pitch: 12 }), { seconds: 0.05 })
  say(Math.abs(crossings(high.left, 0, 0.05) / crossings(low.left, 0, 0.05) - 2) < 0.05, 'playSound("blip", { pitch: 12 }) is an octave higher', [crossings(low.left, 0, 0.05), crossings(high.left, 0, 0.05)])
  const soft = await renderSound((s) => s.playSound('blip', 0.5), { seconds: 0.05 })
  say(Math.abs(peak(soft.left) / peak(low.left) - 0.5) < 0.02, 'playSound("blip", 0.5) is half as loud', peak(soft.left) / peak(low.left))
  const leftOnly = await renderSound((s) => s.playSound('blip', { pan: -1 }), { seconds: 0.05 })
  say(peak(leftOnly.left) > 0.1 && peak(leftOnly.right) < 0.001, '{ pan: -1 } is all on the left', [peak(leftOnly.left), peak(leftOnly.right)])
}

// --- a held note
{
  const r = await renderSound((s) => { const synth = s.makeSynth(CLICK); const note = synth.start('A3'); note.slideTo('A4'); note.volume = 0.5 }, { seconds: 1 })
  const plain = await renderSound((s) => s.makeSynth(CLICK).start('A4'), { seconds: 1 })
  say(Math.abs(crossings(r.left, 0.5, 1) * 2 - 440) <= 2 && Math.abs(peak(r.left.slice(SR / 2)) / peak(plain.left) - 0.5) < 0.02, 'start() gives a note that stays, and can be moved to another pitch and turned down', [crossings(r.left, 0.5, 1) * 2, peak(r.left.slice(SR / 2)) / peak(plain.left)])
  const off = await renderSound((s) => s.makeSynth(CLICK).start('A4').stop(), { seconds: 0.5 })
  const all = await renderSound((s) => { const synth = s.makeSynth(CLICK); synth.start('A4'); synth.start('E5'); synth.stop() }, { seconds: 0.5 })
  say(peak(off.left.slice(2000)) === 0 && peak(all.left.slice(2000)) === 0, 'note.stop() stops it, and synth.stop() stops every note of the synth', [peak(off.left.slice(2000)), peak(all.left.slice(2000))])
}

// --- volume, mute, stop
{
  const one = await renderSound((s) => s.makeSynth(CLICK).play('A4', 0.2), { seconds: 0.2 })
  const half = await renderSound((s) => { s.setVolume(0.5); s.makeSynth(CLICK).play('A4', 0.2) }, { seconds: 0.2 })
  const muted = await renderSound((s) => { s.muteSound(); s.makeSynth(CLICK).play('A4', 0.2) }, { seconds: 0.2 })
  const back = await renderSound((s) => { s.muteSound(); s.unmuteSound(); s.makeSynth(CLICK).play('A4', 0.2) }, { seconds: 0.2 })
  say(Math.abs(peak(half.left) / peak(one.left) - 0.5) < 0.01 && peak(muted.left) === 0 && peak(back.left) === peak(one.left), 'setVolume(0.5) halves everything, muteSound() silences it and unmuteSound() brings it back', [peak(half.left) / peak(one.left), peak(muted.left), peak(back.left)])
  const stopped = await renderSound((s) => { const synth = s.makeSynth(CLICK); synth.play('A4', 0.5); synth.play('A4', 0.5, { at: 1 }); synth.playNotes('C4 E4', 0.5, { repeat: true, at: 1 }); s.stopSound() }, { seconds: 2 })
  say(peak(stopped.left) === 0, 'stopSound() stops what is sounding and takes back what had not started yet', peak(stopped.left))
  const after = await renderSound((s) => { const synth = s.makeSynth(CLICK); s.stopSound(); synth.play('A4', 0.2) }, { seconds: 0.2 })
  say(peak(after.left) === peak(one.left), 'and a synth still plays afterwards, with its settings', [peak(after.left), peak(one.left)])
}

// --- effects
{
  const dry = await renderSound((s) => s.makeSynth(CLICK).play('A4', 0.1), { seconds: 1.5 })
  const echo = await renderSound((s) => { s.setEffects({ echoTime: 0.5, echoFeedback: 0.5 }); s.makeSynth({ ...CLICK, echo: 1 }).play('A4', 0.1) }, { seconds: 1.5 })
  const reverb = await renderSound((s) => { const synth = s.makeSynth(CLICK); synth.reverb = 0.8; synth.play('A4', 0.1) }, { seconds: 1.5 })
  const at = (a, from, to) => peak(a.slice(from * SR, to * SR))
  say(at(dry.left, 0.3, 1.5) === 0 && at(echo.left, 0.5, 0.6) > 0.05 && at(echo.left, 0.3, 0.45) < 0.001 && at(echo.left, 1, 1.1) > 0.02, 'echo: the note comes back half a second later, and again, quieter', [at(echo.left, 0.5, 0.6), at(echo.left, 1, 1.1)])
  say(at(reverb.left, 0.2, 0.6) > 0.005, 'reverb: the note rings on after it has stopped', at(reverb.left, 0.2, 0.6))
  const clean = await renderSound((s) => s.makeSynth(CLICK).play('A4', 0.2), { seconds: 0.2 })
  const driven = await renderSound((s) => s.makeSynth({ ...CLICK, distortion: 0.8 }).play('A4', 0.2), { seconds: 0.2 })
  const diff = driven.left.reduce((m, v, i) => Math.max(m, Math.abs(v - clean.left[i])), 0)
  say(diff > 0.05, 'distortion changes the shape of the wave', diff)
}

// --- samples
{
  // A recording to load: a tenth of a second of a 441 Hz sine, as a WAV file.
  const wave = Float32Array.from({ length: 4410 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 441 * i / 44100))
  const file = toWav(wave, wave, 44100)
  const back = readWav(file)
  say(back.channels === 2 && back.rate === 44100 && back.pcm.length === 8820 && Math.abs(back.pcm[200] - wave[100]) < 1e-4, 'a WAV file written by toWav reads back the same', [back.channels, back.rate, back.pcm.length])
  const read = async (path) => (path === 'tone.wav' ? file : null)
  const r = await renderSound((s) => s.loadSample('tone.wav').play(), { seconds: 0.5, read })
  const up = await renderSound((s) => s.loadSample('tone.wav').play('C5'), { seconds: 0.5, read })
  say(Math.abs(crossings(r.left, 0, 0.1) * 10 - 441) <= 10 && peak(r.left) > 0.1 && peak(r.left.slice(0.11 * SR)) < 0.001, 'loadSample(...).play() plays the recording at its own pitch, once', [crossings(r.left, 0, 0.1) * 10, peak(r.left), peak(r.left.slice(0.11 * SR))])
  say(Math.abs(crossings(up.left, 0, 0.05) * 20 - 882) <= 20 && peak(up.left.slice(0.06 * SR)) < 0.001, 'play("C5") plays it an octave up, in half the time', [crossings(up.left, 0, 0.05) * 20])
  const looped = await renderSound((s) => s.loadSample('tone.wav', { loop: true }).play(null, 1), { seconds: 1.2, read })
  say(peak(looped.left.slice(0.8 * SR, 0.95 * SR)) > 0.1 && peak(looped.left.slice(1.1 * SR)) < 0.001, '{ loop: true } keeps it going for as long as the note', peak(looped.left.slice(0.8 * SR, 0.95 * SR)))
  const said = await saying(async () => {
    const gone = await renderSound((s) => { s.loadSample('missing.wav').play(); s.playSound('blip') }, { seconds: 0.2, read })
    say(peak(gone.left) > 0.1, 'a sample whose file is missing is silent and the rest still plays', peak(gone.left))
  })
  say(said.length === 1 && /loadSample\("missing\.wav"\): the file could not be read \(it is not there\), so it will be silent/.test(said[0]), 'and the console says which file, once', said)
}

// --- running out of room
{
  const said = await saying(async () => {
    const r = await renderSound((s) => {
      const all = Array.from({ length: 70 }, () => s.makeSynth(CLICK))
      all.forEach((synth, i) => synth.play(60 + (i % 12), 0.1, { at: i * 0.01 }))
      all[0].play('A4', 0.1, { at: 1 })          // the first one lost its place long ago, and takes one back
    }, { seconds: 1.5 })
    say(r.left.every(Number.isFinite) && onsets(r.left.slice(SR)).length === 1 && Math.abs(crossings(r.left, 1, 1.1) * 10 - 440) <= 10, '70 synths at once (there is room for 32; the other parts of the engine belong to a song): all play, and one that lost its place plays again as itself', onsets(r.left.slice(SR)))
  })
  say(said.length === 1 && /more than 32 synths are in use at once.*call its remove\(\)/.test(said[0]), 'the console says so once, with what to do', said)
  const many = await saying(async () => {
    const player = await createOfflinePlayer()
    const s = createSound({ sound: player, clock: () => 0 })
    const synth = s.makeSynth({ ...CLICK })
    for (let i = 0; i < 200; i++) synth.play(40 + (i % 60), 1)
    s.flush()
    const r = await player.render(0.5)
    say(player.voices() === 64 && peak(r.left) <= 1 && r.left.every(Number.isFinite), '200 notes at once: 64 voices sound and the output stays within full volume', [player.voices(), peak(r.left)])
    const freed = Array.from({ length: 200 }, () => s.makeSynth(CLICK))
    freed.forEach((f) => { f.play('C4', 0.01); f.remove() })
    s.flush()
    await player.render(0.1)
  })
  say(many.length === 0, 'synths that are removed give their places back: 200 made and removed, nothing said', many)
}

// --- musical time: lengths by name, the tempo, and tunes written a note at a time
{
  const { lengthBeats } = synths
  say(same(['whole', 'half', 'quarter', 'eighth', 'sixteenth', '1/4', '1/8', 'q', 'e', 'h', 'quarter.', 'q.', 'dotted half', 'eighth triplet', 'e3', 'Quarter note', 'soon', 'm7'].map(lengthBeats),
    [4, 2, 1, 0.5, 0.25, 1, 0.5, 1, 0.5, 2, 1.5, 1.5, 3, 1 / 3, 1 / 3, 1, null, null]), 'note lengths by name, in beats: words, fractions, letters, dotted and triplets', ['q.', 'e3'].map(lengthBeats))
  const ends = (r) => (r.left.length - 1 - [...r.left].reverse().findIndex((v) => Math.abs(v) > 1e-4)) / SR
  const a = await renderSound((s) => s.makeSynth(CLICK).play('A4', 'quarter'), { seconds: 2 })
  const b = await renderSound((s) => { s.setTempo(60); s.makeSynth(CLICK).play('A4', 'quarter') }, { seconds: 2 })
  const c = await renderSound((s) => { s.setTempo(120); s.playNote('A4', 'eighth', { after: 'half' }) }, { seconds: 2 })
  say(Math.abs(ends(a) - 0.5) < 0.01 && Math.abs(ends(b) - 1) < 0.01 && Math.abs(first(c.left) / SR - 1) < 0.001, 'a length by name follows the tempo: a quarter note is half a second at 120 and a second at 60, and { after: "half" } waits two beats', [ends(a), ends(b), first(c.left) / SR])
  const cut = await renderSound((s) => s.playSound('win', { length: 0.15 }), { seconds: 2 })
  const whole = await renderSound((s) => s.playSound('win'), { seconds: 3 })
  const held = await renderSound((s) => s.playSound('powerup', { length: 'whole' }), { seconds: 3 })
  const usual = await renderSound((s) => s.playSound('powerup'), { seconds: 3 })
  const energy = (r, from, to) => peak(r.left.slice(from * SR, to * SR))
  say(energy(cut, 0.1, 0.14) > 0.1 && energy(cut, 0.6, 2) < energy(whole, 0.6, 2) * 0.2 && energy(held, 1.5, 1.9) > 0.1 && energy(usual, 1.5, 1.9) < 0.01, 'playSound takes a length: a sound is cut short there, or its last note is held until then', [energy(cut, 0.6, 2), energy(whole, 0.6, 2), energy(held, 1.5, 1.9), energy(usual, 1.5, 1.9)])

  // One line per note: each begins exactly where the last ended.
  const line = await renderSound((s) => { const v = s.makeSynth(CLICK); v.note('A4', 'quarter'); v.note('E5', 'eighth'); v.rest('eighth'); v.note('A4', 'half'); v.chord('Am', 1) }, { seconds: 4 })
  say(same(onsets(line.left), [0, 24000, 48000, 96000]) || same(onsets(line.left).map((f) => f - onsets(line.left)[0]), [0, 24000, 48000, 96000]), 'note, rest and chord in a row: a quarter, an eighth, a rest, a half and a chord begin on frames 0, 24000, 48000 and 96000 at 120 beats a minute', onsets(line.left))
  const moved = await renderSound((s) => { const v = s.makeSynth(CLICK); v.note('A4', 'quarter'); s.setTempo(60); v.note('A4', 'quarter'); v.note('A4', 2); v.note('A4') }, { seconds: 5 })
  say(same(onsets(moved.left), [0, 24000, 72000, 168000]), 'setTempo between notes changes the lengths of the ones written after it; a number is beats', onsets(moved.left))
  // Two lines written one after the other, with a clock that moves between calls, start on the same instant.
  let tick = 0
  const two = commands((s) => {
    const lead = s.makeSynth('lead'), bass = s.makeSynth('bass')
    for (const n of ['C4', 'E4', 'G4']) lead.note(n, 'eighth')
    bass.note('C2', 'quarter.')
    s.note('C5', 'whole')
    bass.startLine({ after: 1 }).note('G2')
  }, { clock: () => (tick += 0.001) })
  const starts = two.filter((c) => c.op === 'note').map((c) => [c.id, +(c.t - two.find((x) => x.op === 'note').t).toFixed(6)])
  say(same(starts.slice(0, 5).map((x) => x[1]), [0, 0.25, 0.5, 0, 0]) && starts[5][1] > 0.99 && starts[5][1] < 1.02, 'lines of different synths written in one go begin on the same instant, without arithmetic; startLine({ after: 1 }) begins one again later', starts)
  say(/note needs a note, as in note\("C4", "quarter"\)\. For a silence, use rest\("quarter"\)/.test(thrown(() => createSound({ sound: { send() {} } }).note())) && /note needs a number, or a note length by name: "whole", "half", "quarter", "eighth", "sixteenth".*not "quater"\. Did you mean "quarter"\?/.test(thrown(() => createSound({ sound: { send() {} } }).note('C4', 'quater'))),
    'note with nothing, and a length spelt wrongly, say so', thrown(() => createSound({ sound: { send() {} } }).note('C4', 'quater')))

  // Tunes in beats: lengths in the text, a step by name, and a tempo that changes as it plays.
  const text = await renderSound((s) => s.makeSynth(CLICK).playNotes('A4:q A4:e A4:e A4:2 A4', 'sixteenth', { hold: 0.2 }), { seconds: 3 })
  say(same(onsets(text.left), [0, 24000, 36000, 48000, 60000]), 'in a tune, "A4:q A4:e" are a quarter and an eighth whatever the step, ":2" is two steps, and the step can be "sixteenth"', onsets(text.left))
  const player = await createOfflinePlayer()
  const s = createSound({ sound: player, clock: () => 0 })
  s.makeSynth(CLICK).playNotes('A4 A4', 'quarter', { repeat: true, hold: 0.2 })
  s.makeSynth(CLICK).playNotes('E6', 0.5, { repeat: true, hold: 0.02, at: 0.25 })
  s.flush()
  player.send({ synths: 1, now: 0, cmds: [{ op: 'tempo', bpm: 240, t: 1.5 }] })
  const fast = await player.render(3)
  const got = onsets(fast.left)
  say(same(got.slice(0, 12), [0, 12000, 24000, 36000, 48000, 60000, 72000, 84000, 96000, 108000, 120000, 132000]), 'a tune in beats changes speed when the tempo does (a note every half second, then every quarter from 1.5 seconds), and a tune in seconds beside it does not', got)
  let made
  const loop = await renderSound((x) => {
    const v = x.makeSynth(CLICK), w = x.makeSynth(CLICK)
    v.note('A4', 'quarter')
    made = x.loopNotes(() => { v.note('A4', 'eighth'); v.rest('eighth'); w.rest('quarter'); w.note('A5', 'eighth'); w.rest('eighth') }, 2)
    v.note('E5', 'quarter')
  }, { seconds: 4 })
  say(same(onsets(loop.left), [0, 24000, 48000, 72000, 96000, 120000]) && typeof made.stop === 'function', 'loopNotes writes a section once and has it go round (twice here), every synth in it together, and the line carries on after it', onsets(loop.left))
  const dn = describe()
  say(dn.lengths.quarter === 1 && dn.lengthLetters.e === 0.5, 'the names file has the note lengths for other languages', dn.lengths)
}

// --- chords by name
{
  say(same([chordNotes('Cm7'), chordNotes('C3', 'minor'), chordNotes('F#sus4'), chordNotes('Bbmaj7'), chordNotes('C'), chordNotes('AM7'), chordNotes('Am7'), chordNotes(['C4', 'G4'])],
    [[60, 63, 67, 70], [48, 51, 55], [66, 71, 73], [70, 74, 77, 81], [60, 64, 67], [69, 73, 76, 80], [69, 72, 76, 79], [60, 67]]), 'chords by name: Cm7, C3 minor, F#sus4, Bbmaj7, C, AM7 (major) and Am7 (minor)', chordNotes('AM7'))
  const cmds = commands((s) => { const lead = s.makeSynth(); lead.play('Cm7'); lead.play('C7'); lead.play('C'); s.playNote('Gsus4', 1); lead.playNotes('C4 Am F+A+C5 -') })
  say(same(cmds.filter((c) => c.op === 'note').map((c) => c.note), [[60, 63, 67, 70], [96], [60], [67, 72, 74]]) && same(cmds.find((c) => c.op === 'tune').steps.map((x) => x[1]), [[60], [69, 72, 76], [65, 69, 72]]),
    'play("Cm7") plays the chord\'s four notes; a letter and a number is always a note ("C7" is the C of octave 7); a chord can stand in a tune', cmds.filter((c) => c.op === 'note').map((c) => c.note))
  const s = createSound({ sound: { send() {} }, clock: () => 0 })
  const lead = s.makeSynth()
  for (const [what, run, says] of [
    ['a chord spelt wrongly', () => lead.play('Cmaj77'), /"Cmaj77" is not a note or a chord\. Did you mean "Cmaj7"\? A note is written "C4" or "F#3", and a chord "Cm", "Cmaj7" or "Csus4"/],
    ['a kind of chord that does not exist', () => lead.arp('C4', 'minr'), /"minr" is not a kind of chord\. Did you mean "minor"\? The kinds are: major, minor, dim, aug, sus2, sus4, 5, 6/],
    ['an arpeggio with no chord', () => lead.arp(), /arp needs a chord, as in arp\("Cm7"\), arp\("C4", "minor"\) or arp\(\["C4", "E4", "G4"\]\)/],
    ['an order that does not exist', () => lead.arp('Cm', { order: 'sideways' }), /arp: "sideways" is not an order an arpeggio can go in\. The orders are: up, down, up-down, up-down2 \(the top and bottom notes twice\), as written, random, together/],
    ['a macro step with a wave that does not exist', () => lead.setMacro([{ wave: 'nose' }]), /setMacro: "nose" is not a wave a step can switch to\. Did you mean "noise"\? They are: sine, triangle, saw, pulse, square, noise/],
    ['a macro that is not a list', () => { lead.macro = 5 }, /setMacro: a macro needs a list of steps, as in \[\{ pitch: 0 \}, \{ pitch: 4 \}, \{ pitch: 7 \}\], not 5/],
  ]) say(says.test(thrown(run) || ''), `${what} says so`, thrown(run))
}

// --- arpeggios: a chord from one voice
{
  // The pitch of each fifth of a second, from how often the wave crosses zero.
  const pitches = (a, n) => Array.from({ length: n }, (_, i) => crossings(a, i * 0.2 + 0.01, i * 0.2 + 0.19) / 0.18)
  const near = (got, want) => got.length === want.length && got.every((hz, i) => Math.abs(hz - want[i]) < 8)
  const C = 261.6, Eb = 311.1, E = 329.6, G = 392, F = 349.2, Ab = 415.3
  const player = await createOfflinePlayer()
  const s = createSound({ sound: player, clock: () => 0 })
  s.makeSynth(CLICK).arp('C4', 'major', 1.2, { speed: 5 })
  s.flush()
  const up = await player.render(1.2)
  say(near(pitches(up.left, 6), [C, E, G, C, E, G]) && onsets(up.left).length === 1, 'arp("C4", "major", { speed: 5 }) steps one unbroken note through C, E and G, five steps a second', pitches(up.left, 6))
  say(player.voices() === 1, 'and it is one voice, not three', player.voices())
  const down = await renderSound((x) => x.makeSynth(CLICK).arp(['C4', 'E4', 'G4'], 1, { speed: 5, order: 'down' }), { seconds: 1 })
  const both = await renderSound((x) => x.makeSynth(CLICK).arp('Cm', 1.2, { speed: 5, order: 'up-down' }), { seconds: 1.2 })
  const written = await renderSound((x) => x.makeSynth(CLICK).arp(['G4', 'C4', 'E4'], 1, { speed: 5, order: 'as written' }), { seconds: 1 })
  say(near(pitches(down.left, 3), [G, E, C]) && near(pitches(both.left, 5), [C, Eb, G, Eb, C]) && near(pitches(written.left, 3), [G, C, E]), 'the orders: down, up-down (a chord by name) and as written', [pitches(down.left, 3), pitches(both.left, 5), pitches(written.left, 3)])
  const fast = await renderSound((x) => x.makeSynth(CLICK).arp('C'), { seconds: 1 })
  const edges = onsets(fast.left)
  const end = fast.left.length - 1 - [...fast.left].reverse().findIndex((v) => Math.abs(v) > 1e-4)
  say(edges.length === 1 && Math.abs(end - 0.5 * SR) < 500 && Math.abs(crossings(fast.left, 0, 0.02) * 50 - C) < 50 && Math.abs(crossings(fast.left, 0.02, 0.04) * 50 - E) < 50, 'with nothing said it steps 50 times a second (960 frames a step) and lasts half a second', [end, crossings(fast.left, 0, 0.02) * 50, crossings(fast.left, 0.02, 0.04) * 50])
  // A held arpeggio changes chord without starting the note again.
  const held = await renderSound((x) => { const chord = x.makeSynth({ ...CLICK, attack: 0.3 }).startArp('C4', 'major', { speed: 5 }); chord.change('F4', 'minor', { at: 0.6 }) }, { seconds: 1.2 })
  const quiet = peak(held.left.slice(0, 0.05 * SR)), full = peak(held.left.slice(0.6 * SR, 0.65 * SR))
  say(near(pitches(held.left, 6), [C, E, G, F, Ab, 523.3]) && onsets(held.left).length === 1 && quiet < full * 0.3 && full > 0.2, 'startArp gives an arpeggio that stays, and change("F4", "minor") moves it to another chord without starting the note again (its slow attack is not heard twice)', [pitches(held.left, 6), quiet, full])
  const top = commands((x) => { x.playArp('Am7', { speed: 30, order: 'random' }); x.startArp('C4', 'sus4').stop() })
  say(same(top.filter((c) => c.arp).map((c) => [c.op, c.note, c.len, c.arp]), [['note', [69], 0.5, { offsets: [0, 3, 7, 10], rate: 30, order: 4 }], ['note', [60], null, { offsets: [0, 5, 7], rate: 50, order: 0 }]]) && top.some((c) => c.op === 'synth' && c.preset === 'chip'),
    'playArp and startArp need no synth (they use a chip sound), and an arpeggio is a note command with its offsets, rate and order', top)
  const big = await renderSound((x) => x.playArp(['C3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5', 'G5'], 1, { speed: 8 }), { seconds: 1 })
  say(Math.abs(crossings(big.left, 0.88, 0.99) / 0.11 - 784) < 20, 'an arpeggio of eight notes reaches its eighth', crossings(big.left, 0.88, 0.99) / 0.11)
}

// --- step macros
{
  const pitches = (a, n) => Array.from({ length: n }, (_, i) => crossings(a, i * 0.2 + 0.01, i * 0.2 + 0.19) / 0.18)
  const r = await renderSound((s) => s.makeSynth({ ...CLICK, macroRate: 5, macro: { steps: [{ pitch: 0 }, { pitch: 12 }], loop: true } }).play('A3', 0.8), { seconds: 0.8 })
  say(pitches(r.left, 4).every((hz, i) => Math.abs(hz - (i % 2 ? 440 : 220)) < 8), 'a macro of two steps that loops takes a note up an octave and back, five steps a second', pitches(r.left, 4))
  const off = await renderSound((s) => { const synth = s.makeSynth({ ...CLICK, macroRate: 5, macro: [{ pitch: 12 }] }); synth.macro = null; synth.play('A3', 0.4) }, { seconds: 0.4 })
  say(Math.abs(pitches(off.left, 2)[0] - 220) < 8, 'synth.macro = null takes it away', pitches(off.left, 2))
  const snare = await renderSound((s) => s.makeSynth('chipSnare').play(), { seconds: 0.5 })
  const kick = await renderSound((s) => s.makeSynth('chipKick').play(), { seconds: 0.5 })
  // The snare changes from noise to a tone and back: noise crosses zero far more often than the tone between.
  const rate = (a, from, to) => crossings(a, from, to) / (to - from)
  say(peak(snare.left) > 0.1 && rate(snare.left, 0.022, 0.038) < rate(snare.left, 0.062, 0.078) * 0.7 && rate(kick.left, 0.002, 0.018) > rate(kick.left, 0.062, 0.078) * 1.5, 'the chip drums are made of steps: the snare goes from noise to a tone to noise, and the kick falls in pitch', [rate(snare.left, 0.022, 0.038), rate(snare.left, 0.062, 0.078), rate(kick.left, 0.002, 0.018), rate(kick.left, 0.062, 0.078)])
  // 70 synths: a part that changes hands takes the new synth's macro, or none.
  const many = await saying(async () => {
    const moved = await renderSound((s) => {
      const first = s.makeSynth({ ...CLICK, macro: [{ pitch: 12 }] })
      first.play('A3', 0.01)
      const rest = Array.from({ length: 32 }, () => s.makeSynth(CLICK))
      rest.forEach((synth, i) => synth.play('A3', 0.01, { at: 0.01 + i * 0.001 }))
      rest[31].play('A3', 0.4, { at: 0.2 })
    }, { seconds: 0.6 })
    say(Math.abs(crossings(moved.left, 0.21, 0.39) / 0.18 - 220) < 8, 'a place that passes from a synth with a macro to one without loses the macro', crossings(moved.left, 0.21, 0.39) / 0.18)
  })
}

// --- what a dial, a keyboard, a scope and a meter look for
{
  const player = await createOfflinePlayer()
  const s = createSound({ sound: player, clock: () => 0 })
  const lead = s.makeSynth('lead')
  lead.set('cutoff', 800)
  say(lead.get('cutoff') === 800 && lead.get('filter_cutoff') === 800 && lead.cutoff === 800 && lead.get('wave') === 'saw', 'set(name, value) and get(name) work by any spelling', [lead.get('cutoff'), lead.get('wave')])
  say(same(lead.describe('filter_cutoff'), { name: 'filter.cutoff', kind: 'float', min: 20, max: 20000, default: 800, unit: 'hz' }) && same(lead.describe('wave').choices, ['sine', 'triangle', 'saw', 'pulse']) && lead.describe('wave').kind === 'choice'
    && same([lead.describe('octave').min, lead.describe('octave').max, lead.describe('octave').unit], [-4, 4, 'octaves']) && lead.describe('sync').kind === 'bool' && lead.describe('nothing') === null,
    'describe(name) gives the range, the unit, the kind and the choices, in the friendly name\'s own units', lead.describe('filter_cutoff'))

  // "sample" is a wave only for a synth that has a sample: a select offers it then, and not before.
  {
    const batches = []
    const player = await createOfflinePlayer()
    const w = createSound({ sound: { send: (b) => { batches.push(b); player.send(b) }, read: (i, sc) => player.read(i, sc) }, clock: () => 0, batch: 'manual', resolve: (p) => 'file://' + join(ROOT, 'examples', p) })
    const plain = w.makeSynth('lead')
    let told = await saying(async () => { plain.wave = 'sample'; plain.set({ wave: 'sample', cutoff: 900 }); plain.wave2 = 'sample' })
    w.flush()
    const sent = batches.flatMap((b) => b.cmds).filter((c) => c.op === 'set')
    say(plain.describe('wave').max === 3 && !plain.describe('wave2').choices.includes('sample') && plain.get('wave') === 'saw' && plain.get('cutoff') === 900 && sent.length === 1 && same(sent[0].set, { cutoff: 900 })
      && told.length === 2 && /wave = "sample" needs a sample to play, and this synth has none, so its wave stays "saw"\. Give it one first: lead\.sample = loadSample\("piano\.wav"\)/.test(told[0]) && /wave2 = "sample"/.test(told[1]),
      'on a synth with no sample "sample" is not among the choices of wave or wave2, and setting it in code says once how to give the synth a sample, keeps the wave it had and still makes the other changes', { told, sent, wave: plain.get('wave') })
    const thud = w.loadSample('sounds/thud.wav')
    plain.sample = thud
    const by = [plain.describe('wave').choices.includes('sample'), plain.get('wave'), plain.describe('wave2').choices.includes('sample'), thud.describe('wave').choices.includes('sample')]
    plain.wave = 'saw'
    plain.wave = 'sample'
    const layered = w.makeSynth({ sample: 'sounds/tone.wav', note: 'A4', loop: true, cutoff: 1500, attack: 0, release: 0.05 })
    const second = w.makeSynth('lead', { 'osc2.sample': thud, level2: 0.5 })
    w.flush()
    const made = batches.flatMap((b) => b.cmds)
    const file = made.find((c) => c.op === 'sample' && /tone\.wav$/.test(c.url))
    say(same(by, [true, 'sample', false, true]) && plain.get('wave') === 'sample' && layered.get('wave') === 'sample' && layered.describe('wave').choices.includes('sample') && layered.get('cutoff') === 1500 && file && file.note === 69 && file.loop === true
      && made.some((c) => c.op === 'synth' && c.set && c.set.sample === file.id && c.set['osc1.wave'] === 'sample' && c.set.note === undefined) && second.get('wave2') === 'sample' && second.get('wave') === 'saw' && second.describe('wave2').choices.includes('sample') && !second.describe('wave').choices.includes('sample'),
      'lead.sample = loadSample(…) gives a synth a sample and turns its wave to it, after which "sample" is a choice; makeSynth({ sample: "tone.wav", note: "A4" }) loads the file itself; and the second oscillator can have one alone', { by, file })
    await player.render(0.2)
    layered.play('A4', 0.5)
    w.flush()
    const out = await player.render(0.5)
    say(Math.abs(crossings(out.left, 0.02, 0.12) * 10 - 440) <= 20 && peak(out.left) > 0.02 && player.target(layered._id).describe('wave').choices.includes('sample') && !player.target(second._id).describe('wave').choices.includes('sample'), 'the layered synth plays its recording through its own filter and envelope, and a target beside the player knows which synths have a sample too', [crossings(out.left, 0.02, 0.12) * 10, peak(out.left)])
    told = await saying(async () => { w.makeSynth({ wave: 'sample' }); w.makeSynth('bass', { wave2: 'sample' }) })
    say(told.length === 2 && thrown(() => w.makeSynth({ sample: 7 })) && /sample needs a sample from loadSample, a recording, or the name of a sound file/.test(thrown(() => { plain.sample = 7 })), 'makeSynth({ wave: "sample" }) with no sample says the same, and a sample that is not one says what it should be', told)
  }
  const plain = s.makeSynth(CLICK)
  say(same([plain.samples().length, plain.level(), plain.notes()], [1024, [0, 0], []]) || plain.samples().length === 0, 'before anything plays, samples(), level() and notes() are empty', [plain.samples().length, plain.level(), plain.notes()])
  plain.noteOn(69, 1)
  plain.noteOn('E5', 0.5)
  lead.play('C3', 2)
  s.flush()
  await player.render(0.3)
  const wave = plain.samples()
  say(wave.length === 1024 && peak(wave) > 0.2 && peak(wave) <= 1 && same(plain.notes(), [69, 76]) && plain.level().length === 2 && plain.level()[0] > 0.1 && plain.level()[0] <= 1, 'after noteOn(69) and noteOn("E5"): samples() is the last 1024 frames of that synth, level() its left and right, notes() is [69, 76]', [wave.length, peak(wave), plain.notes(), plain.level()])
  const out = s.soundOutput()
  say(same(lead.notes(), [48]) && same(out.notes(), [48, 69, 76]) && out.samples().length === 1024 && out.level()[0] > 0.1, 'each synth reads only itself, and soundOutput() reads everything together', [lead.notes(), out.notes()])
  plain.noteOff(69)
  plain.note_off('E5')
  s.flush()
  await player.render(0.3)
  say(same(plain.notes(), []) && peak(plain.samples()) === 0 && same(lead.notes(), [48]), 'noteOff lets each key go: the synth reads silent and the other still sounds', [plain.notes(), peak(plain.samples())])
  out.set('volume', 0.5)
  out.set('echoTime', 0.2)
  say(out.get('volume') === 0.5 && out.get('echoTime') === 0.2 && out.describe('volume').max === 2 && out.describe('reverbSize').max === 1 && s.mainSynth().describe('attack').unit === 'seconds', 'soundOutput() takes dials for the volume and the shared effects, and mainSynth() is the synth playNote uses', [out.get('volume'), out.describe('reverbSize')])
  // A synth made somewhere else (Python sends its commands), driven on the page by its id alone.
  const there = await createOfflinePlayer()
  there.send({ synths: 1, now: 0, cmds: [{ op: 'synth', id: 'p1', preset: 'bass', set: { cutoff: 700, wave: 'sine', filter: 'off', attack: 0, release: 0 } }] })
  const knob = there.target('p1')
  say(knob.get('cutoff') === 700 && knob.get('wave') === 'sine' && same(knob.describe('cutoff'), { name: 'filter.cutoff', kind: 'float', min: 20, max: 20000, default: 700, unit: 'hz' }) && knob.describe('sub').default === 0.6,
    'player.target(id) answers get and describe for a synth it was only sent commands for, preset and all', [knob.get('cutoff'), knob.describe('cutoff')])
  knob.set('cutoff', 1500)
  knob.noteOn(69, 1)
  await there.render(0.2)
  const sounding = [knob.get('cutoff'), knob.notes(), knob.samples().length, knob.level()[0] > 0.1]
  knob.noteOff(69)
  await there.render(0.2)
  say(same(sounding, [1500, [69], 1024, true]) && same(knob.notes(), []), 'and its set, noteOn and noteOff play that synth, with notes(), samples() and level() to draw', [sounding, knob.notes()])
  // Two senders with clocks of their own may share a real-time player; offline, a batch's own times are simply kept.
  const far = createSound({ sound: { send() {} } }).makeSynth()
  say(same([far.samples().length, far.level(), far.notes()], [0, [0, 0], []]), 'a synth whose commands go somewhere that cannot be read gives nothing, without a fuss', [far.samples().length, far.level(), far.notes()])
}

// --- several programs on one player, each in a scope of its own
{
  const player = await createOfflinePlayer()
  const a = createSound({ sound: player, clock: () => 0, scope: 'a' })
  const b = createSound({ sound: player, clock: () => 0, scope: 'b' })
  const low = a.makeSynth(CLICK), high = b.makeSynth(CLICK)          // both are "s1" to their own program
  low.start('A3')
  high.start('A5')
  a.flush(); b.flush()
  const hz = (r) => crossings(r.left, 0.02, 0.18) / 0.16
  const both = await player.render(0.2)
  say(same([low.notes(), high.notes(), a.soundOutput().notes()], [[57], [81], [57, 81]]) && player.voices() === 2, 'two programs with the same ids share a player without meeting: each synth reads its own note', [low.notes(), high.notes()])
  a.setVolume(0.5)
  a.flush()
  await player.render(1.5)            // a meter falls slowly: give it time to come down to the new level
  const quieter = [low.level()[0], high.level()[0]]
  a.stopSound()
  a.flush()
  const one = await player.render(0.2)
  say(Math.abs(hz(one) - 880) < 8 && same(low.notes(), []) && same(high.notes(), [81]), 'stopSound() in one stops only its own: the other plays on', [hz(one), low.notes(), high.notes()])
  b.pause()
  const silent = await player.render(0.2)
  b.resume()
  const back = await player.render(0.2)
  say(peak(silent.left.slice(4800)) === 0 && Math.abs(hz(back) - 880) < 8, 'pause() silences one program with its notes kept, and resume() brings them back', [peak(silent.left.slice(2000)), hz(back)])
  low.start('A3', { at: player.time })
  a.flush()
  await player.render(0.1)
  b.close()
  const left = await player.render(0.2)
  say(Math.abs(hz(left) - 220) < 8 && player.voices() === 1 && Math.abs(quieter[0] / quieter[1] - 0.5) < 0.1, 'close() ends one program and leaves the other, and setVolume(0.5) in one had halved only its own', [hz(left), player.voices(), quieter])
  const said = await saying(async () => {
    for (let i = 0; i < 40; i++) { const c = createSound({ sound: player, clock: () => 0, scope: 'c' + i }); c.makeSynth(CLICK).play('C4', 0.01); c.close() }
    await player.render(0.1)
  })
  say(said.length === 0, '40 programs that come and go leave their places free (nothing is said about running out)', said)
}

// --- songs
{
  const read = async (path) => readFile(join(ROOT, 'examples', path)).catch(() => null)
  const start = async (file, o, more = {}) => {
    const player = await createOfflinePlayer()
    const s = createSound({ sound: player, clock: () => player.time, read, ...more })
    const song = s.playSong(file, o)
    await new Promise((yes) => setTimeout(yes, 30))
    s.flush()
    return { player, s, song, go: async (seconds) => { s.flush(); return player.render(seconds) } }
  }
  let said = await saying(async () => {
    const { player, s, song, go } = await start('songs/night_drive.json', { patches: { tune: 'bell' } })
    const first = await go(2)
    const at = song.position
    say(peak(first.left) > 0.2 && peak(first.left) < 0.9 && first.left.every(Number.isFinite) && at.state === 'playing' && at.order === 0 && at.row === 16 && at.speed === 6 && at.tempo === 125 && at.rows === 32 && at.orders === 4,
      'playSong plays one of our own songs: after 2 seconds at 125 beats a minute it is on row 16 of its first pattern, and says so', [peak(first.left), at])
    // The bass is the synth the song names: its part is one of ours, and reads its notes.
    const bass = player.target('song:bass')
    say(bass.get('wave') === 'saw' && player.read('song:tune').level[0] > 0 && player.target('song:tune').get('decay') === 1.4, 'its instruments that are synths by name are set up: "bass" is the ready-made bass, and "tune" is what the program said (a bell)', [bass.get('wave'), player.target('song:tune').get('decay')])
    s.playSound('coin')
    const over = await go(0.3)
    say(peak(over.left) > 0.2 && song.position.row > 16, 'a game sound plays over the song', peak(over.left))
    song.pause()
    const paused = await go(0.5)
    const held = song.position
    song.resume()
    const again = await go(0.5)
    say(peak(paused.left.slice(12000)) < 0.05 && held.state === 'paused' && peak(again.left) > 0.1 && song.position.state === 'playing' && song.position.row > held.row, 'pause() holds it where it is, with only the last notes dying away, and resume() carries on from there', [peak(paused.left.slice(12000)), held, song.position])
    song.seek(2, 8)
    await go(0.05)
    say(song.position.order === 2 && song.position.row === 8, 'seek(2, 8) goes to row 8 of the third place in the order', song.position)
    const loud = await go(1)
    song.volume = 0.25
    await go(0.1)
    const soft = await go(1)
    const rms = (a) => Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length)
    say(rms(soft.left) < rms(loud.left) * 0.45 && rms(soft.left) > rms(loud.left) * 0.1, 'song.volume = 0.25 turns the whole song down, its synths with it', [rms(loud.left), rms(soft.left)])
    song.stop()
    const stopped = await go(0.5)
    say(peak(stopped.left.slice(12000)) < 0.02 && song.position.state === 'stopped' && song.position.row === 0, 'stop() ends it and takes it back to the start', [peak(stopped.left.slice(12000)), song.position])
    s.playSong('songs/night_drive.json', { repeat: false, volume: 0.5, patches: { tune: 'bell' } })
    await new Promise((yes) => setTimeout(yes, 30))
    await go(16)          // four patterns of 32 rows at 8 rows a second are 16 seconds
    await go(0.5)
    say(player.songPosition().state === 'stopped' && player.songPosition().rounds === 1, '{ repeat: false } plays the song once: after its 16 seconds it has stopped', player.songPosition())
    s.playSong('songs/night_drive.json', { patches: { tune: 'bell' } })
    await new Promise((yes) => setTimeout(yes, 30))
    await go(0.5)
    s.stopSound()
    const quiet = await go(0.5)
    say(peak(quiet.left.slice(12000)) < 0.02 && player.songPosition().state === 'stopped', 'stopSound() stops a song too', peak(quiet.left.slice(12000)))
  })
  say(said.length === 0, 'and nothing is said in the console about any of it', said)

  // Steering for an editor: channels muted and soloed, one pattern going round, and an edited song put in its place.
  const rms = (a) => Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length)
  said = await saying(async () => {
    const json = JSON.parse(new TextDecoder().decode(await read('songs/night_drive.json')))
    // The song says itself what its "tune" is, so nobody has to.
    json.instruments.find((i) => i.patch === 'tune').synth = { preset: 'bell', set: { decay: 1.4, echo: 0.2 } }
    const { player, song, go } = await start(new TextEncoder().encode(JSON.stringify(json)))
    const whole = await go(1)
    const tune = player.target('song:tune')
    say(tune.get('decay') === 1.4 && tune.get('echo') === 0.2 && tune.get('wave') === 'sine', 'a song that carries its own word for a synth ({ preset, set } under the instrument) is set up from it, with no patches given', [tune.get('decay'), tune.get('wave')])
    song.mute()
    await go(0.2)
    const none = await go(0.8)
    song.mute(1, false)
    await go(0.2)
    const bass = await go(0.8)
    song.unmute()
    song.solo(1)
    await go(0.2)
    const alone = await go(0.8)
    song.solo('all', false)
    await go(0.2)
    const back = await go(0.8)
    say(rms(none.left) < rms(whole.left) * 0.05 && rms(bass.left) > rms(whole.left) * 0.05 && rms(bass.left) < rms(back.left) * 0.9 && Math.abs(rms(alone.left) - rms(bass.left)) < rms(back.left) * 0.5 && rms(alone.left) < rms(back.left) * 0.9 && rms(back.left) > rms(whole.left) * 0.5,
      'song.mute() silences every channel, song.mute(1, false) lets the bass back alone, song.solo(1) is the bass alone too, and with both undone the whole song is heard', [rms(whole.left), rms(none.left), rms(bass.left), rms(alone.left), rms(back.left)])
    song.seek(0, 0)
    song.loopPattern()
    await go(6)
    const stayed = song.position
    song.loopPattern(false)
    await go(4)
    say(stayed.order === 0 && stayed.state === 'playing' && song.position.order > 0, 'song.loopPattern() stays on the pattern that is playing (six seconds on, still the first), and loopPattern(false) carries on through the song', [stayed, song.position])
    // The same song with every key let go at the top of each pattern and nothing else in it, put in its place:
    // it keeps its place, and falls silent.
    const before = song.position
    const empty = { ...json, patterns: json.patterns.map((p) => ({ ...p, events: [0, 4, 8, 12, 16, 20, 24, 28].flatMap((row) => [0, 1, 2, 3].map((ch) => ({ row, ch, note: 'off' }))) })) }
    song.replace(empty)
    await go(2.5)
    const after = await go(1)
    const there = song.position
    say(there.state === 'playing' && (there.order > before.order || there.row > before.row || there.rounds > before.rounds) && rms(after.left) < rms(whole.left) * 0.1, 'song.replace(edited) puts an edited song in its place as it plays: it carries on from where it was, and plays the new notes (here, none)', [before, there, rms(after.left)])
    song.replace(json)
    await go(1)
    const again = await go(1)
    say(rms(again.left) > rms(whole.left) * 0.3 && player.target('song:tune').get('decay') === 1.4, 'and the first one put back is heard again, on the same synths', rms(again.left))
  })
  say(said.length === 0, 'and nothing is said in the console about that either', said)

  // What the tracker editor saves: a preset, settings and a step macro, all three inside the instrument's `synth`.
  // And a recording carried inside the song itself, so that it is one file.
  said = await saying(async () => {
    const tone = toWav(Float32Array.from({ length: 4800 }, (_, i) => 0.8 * Math.sin(2 * Math.PI * 440 * i / 48000)), null, 48000)
    const one = {
      format: 'synths-song', version: 1, speed: 6, tempo: 125, channels: 2, order: [0],
      patterns: [{ rows: 16, events: [{ row: 0, ch: 0, note: 'C-4', ins: 1 }, { row: 8, ch: 1, note: 'C-4', ins: 2 }] }],
      instruments: [
        { name: 'snare', patch: 'my snare', synth: { preset: 'chip', set: { decay: 0.3, sustain: 0, 'noise.type': 'lfsr' }, macro: [{ wave: 'noise', pitch: 24 }, { wave: 'noise', pitch: 24 }, { wave: 'pulse', pitch: 0 }] } },
        { name: 'tone', sample: 0 },
      ],
      samples: [{ name: 'tone', data: Buffer.from(tone).toString('base64') }],
    }
    const { player, song, go } = await start(new TextEncoder().encode(JSON.stringify(one)))
    const r = await go(1.4)
    // Two fiftieths of a second of noise, then a pulse at middle C: many crossings of zero, then about 262 a second.
    const noisy = crossings(r.left, 0.002, 0.038) / 0.036, pitched = crossings(r.left, 0.08, 0.18) / 0.1
    const snare = player.target('song:my snare')
    say(snare.get('decay') === 0.3 && snare.get('wave') === 'pulse' && noisy > 1500 && Math.abs(pitched - 262) < 15, `a song instrument's own synth is a preset, settings and a step macro together: the snare is ${Math.round(noisy)} crossings a second of noise, then a pulse at ${Math.round(pitched)} Hz`, [noisy, pitched, snare.get('decay')])
    const sampled = crossings(r.left, 1.0, 1.05) / 0.05
    say(peak(r.left.slice(0.96 * SR, 1.05 * SR)) > 0.05 && Math.abs(sampled - 440) < 25, `and a recording carried inside the song as base64 plays, with no file beside it (${Math.round(sampled)} Hz)`, [peak(r.left.slice(0.96 * SR, 1.05 * SR)), sampled])
    // An edited song put in its place brings its macro with it: now a pulse from the first step.
    one.instruments[0].synth.macro = [{ wave: 'pulse', pitch: 12 }]
    song.replace(one)
    song.seek(0, 0)
    await go(0.3)
    song.seek(0, 0)
    const again = await go(0.3)
    const now = crossings(again.left, 0.01, 0.11) / 0.1
    say(Math.abs(now - 523) < 30, `song.replace reads the instrument's synth again, macro and all (the snare is now a pulse an octave up, ${Math.round(now)} Hz)`, now)
  })
  say(said.length === 0, 'with nothing said: no patches had to be given', said)

  // pwm: the pulse wave's width moving, by a friendly name, on the slow LFO it shares with wobble.
  {
    const c = commands((s) => { const lead = s.makeSynth({ wave: 'square', pwm: 0.4 }); lead.pwmRate = 2; lead.pwm_rate = 3; say(lead.get('wobbleRate') === 3 && lead.get('pwm') === 0.4 && lead.describe('pwm').max === 1, 'pwm and pwmRate are settings by name; pwmRate is the same speed as wobbleRate', [lead.get('wobbleRate'), lead.describe('pwm')]) })
    const d = describe()
    const still = await renderSound((s) => { s.makeSynth({ ...CLICK, wave: 'square' }).play('A3', 1) }, { seconds: 1 })
    const moving = await renderSound((s) => { s.makeSynth({ ...CLICK, wave: 'square', pwm: 0.4, pwmRate: 2 }).play('A3', 1) }, { seconds: 1 })
    // An even square wave has no second harmonic; one whose width is moving has, most of the time.
    const second = (a) => { let re = 0, im = 0; for (let i = 0; i < a.length; i++) { re += a[i] * Math.cos(2 * Math.PI * 440 * i / SR); im += a[i] * Math.sin(2 * Math.PI * 440 * i / SR) } return 2 * Math.hypot(re, im) / a.length }
    const even = [second(still.left.slice(0.1 * SR, 0.2 * SR)), Math.max(second(moving.left.slice(0.1 * SR, 0.2 * SR)), second(moving.left.slice(0.3 * SR, 0.4 * SR)))]
    say(d.names.pwm.setting === 'lfo2.pulse_width' && d.names.pwmRate.setting === 'lfo2.rate' && c.some((x) => x.set && x.set.pwm === 0.4) && even[0] < 0.005 && even[1] > 0.03, `and pwm moves the width of a square wave: its second harmonic goes from ${even[0].toFixed(4)} to ${even[1].toFixed(3)}`, even)
  }
  said = await saying(async () => {
    const { song, go } = await start('songs/night_drive.json', { patches: { tune: 'bell' } })
    await go(0.5)
    song.replace('{"format": "synths-song", "version": 1, "channels": 99}')
    const r = await go(1)
    say(peak(r.left) > 0.1 && song.position.state === 'playing', 'a song that cannot be read does not take the place of the one playing', peak(r.left))
    say(thrown(() => song.replace(7)) && /needs the number of a channel, counting from 0/.test(thrown(() => song.mute('drums'))), 'replace and mute say what they need', thrown(() => song.mute('drums')))
  })
  say(said.length === 1 && /could not be read, so the one that was playing carries on: /.test(said[0]), 'and one message says so, in the engine\'s words', said)

  // A song whose synth is not known plays it as keys and says how to name it; a file that is not a song says why.
  said = await saying(async () => {
    const { go } = await start('songs/night_drive.json')
    const r = await go(1)
    say(peak(r.left) > 0.2, 'a song with a synth nobody named still plays', peak(r.left))
    const bad = await start(new TextEncoder().encode('{"format": "synths-song", "version": 1, "channels": 99}'))
    const nothing = await bad.go(0.5)
    const missing = await start('songs/nowhere.mod')
    await missing.go(0.1)
    bad.s.playSound('blip')
    say(peak(nothing.left) === 0 && peak((await bad.go(0.2)).left) > 0.1, 'a song that cannot be read is silent, and the rest still plays', peak(nothing.left))
  })
  say(said.length === 3 && /has an instrument that is a synth called "tune", and was not told what that is, so it plays as "keys"\. Say what it is: playSong\(file, \{ patches: \{ "tune": "bass" \} \}\)/.test(said[0]) && /the song "given as bytes" could not be played: .*channels/.test(said[1]) && /playSong\("songs\/nowhere\.mod"\): the file could not be read \(it is not there\), so it will not play/.test(said[2]),
    'the console says which synth to name, what the engine found wrong with a song (in its own words), and which file is missing', said)

  // A MOD file, made here byte by byte: one pattern with one note, and one sample that is a square wave of 32 bytes.
  {
    const mod = new Uint8Array(1084 + 1024 + 64)
    mod.set(new TextEncoder().encode('made in a test'), 0)
    const sample = 20
    mod[sample + 22] = 0; mod[sample + 23] = 32          // 32 words long
    mod[sample + 25] = 64                                 // full volume
    mod[sample + 28] = 0; mod[sample + 29] = 16           // looping: 16 words, one square wave
    mod[950] = 1; mod[951] = 127                          // one place in the order
    mod.set(new TextEncoder().encode('M.K.'), 1080)
    mod.set([0x01, 0xac, 0x10, 0x00], 1084)               // row 0, channel 0: C-2 (period 428), sample 1
    for (let i = 0; i < 64; i++) mod[1084 + 1024 + i] = (i % 32) < 16 ? 100 : 156    // +100, -100
    const { song, go, player } = await start(mod)
    const r = await go(1)
    // Period 428 on a PAL Amiga is 8287 samples a second; 32 samples a wave is 259 Hz.
    const hz = crossings(r.left, 0.2, 0.8) / 0.6
    say(Math.abs(hz - 259) < 4 && peak(r.left) > 0.05 && song.position.state === 'playing' && song.position.tempo === 125 && player.songPosition().rows === 64, 'a .mod file given as bytes plays: its one note comes out at 259 Hz, as an Amiga would play it', [hz, peak(r.left), song.position])
  }
  {
    const mod = new Uint8Array(1084 + 1024 + 64)
    mod[20 + 23] = 32; mod[20 + 25] = 64; mod[20 + 29] = 16; mod[950] = 1; mod[951] = 127
    mod.set(new TextEncoder().encode('M.K.'), 1080)
    mod.set([0x01, 0xac, 0x10, 0x00], 1084)
    for (let i = 0; i < 64; i++) mod[1084 + 1024 + i] = (i % 32) < 16 ? 100 : 156
    const packed = await synths.packSong(mod)
    const { go, song } = await start(packed, { raw: true })
    const r = await go(1)
    const hz = crossings(r.left, 0.2, 0.8) / 0.6
    const why = await synths.packSong(new TextEncoder().encode('not a song at all')).catch((e) => e.message)
    say(packed instanceof Uint8Array && packed.length > 60 && Math.abs(hz - 259) < 4 && song.position.state === 'playing' && /^That could not be packed: /.test(why), `packSong turns a .mod into the packed form (${packed.length} bytes here), which plays the same note; something that is not a song says why`, [packed.length, hz, why])
  }
  const cmds = commands((s) => { const song = s.playSong('tune.xm', { repeat: false, volume: 0.8, patches: { lead: { preset: 'lead', cutoff: 900 } } }); song.seek(3); song.volume = 0.5; song.pause(); s.stopSong() }, { read: undefined })
  say(same(cmds.map((c) => { const { t, ...rest } = c; return rest }), [{ op: 'song', id: 'g1', do: 'play', repeat: false, vol: 0.8, patches: { lead: { preset: 'lead', cutoff: 900 } }, name: 'tune.xm', url: 'tune.xm' },
    { op: 'song', id: 'g1', do: 'seek', order: 3, row: 0 }, { op: 'song', id: 'g1', do: 'volume', vol: 0.5 }, { op: 'song', id: 'g1', do: 'pause' }, { op: 'song', do: 'stop' }]), 'a song is commands like everything else: play with its address, then seek, volume, pause and stop', cmds)
  const s = createSound({ sound: { send() {} } })
  say(/playSong\(\) needs the name of a song file, as in playSong\("tune\.mod"\)/.test(thrown(() => s.playSong())) && /playSong: the patch "x" names a synth called "bas", and there is none\. Did you mean "bass"\?/.test(thrown(() => s.playSong('a.mod', { patches: { x: 'bas' } }))) && /playSong: the patch "x": there is no setting called "cutof"\. Did you mean "cutoff"\?/.test(thrown(() => s.playSong('a.mod', { patches: { x: { cutof: 1 } } }))),
    'playSong with no file, a patch that names no synth and a patch with a setting spelt wrongly each say so', thrown(() => s.playSong('a.mod', { patches: { x: { cutof: 1 } } })))
}

// --- a song's channels and instruments, read one at a time
{
  const doc = { format: 'synths-song', version: 1, speed: 6, tempo: 125, channels: 3, order: [0],
    patterns: [{ rows: 16, events: [{ row: 0, ch: 0, note: 'A-3', ins: 1 }, { row: 0, ch: 1, note: 'A-3', ins: 2 }, { row: 0, ch: 2, note: 'A-4', ins: 3 }] }],
    instruments: [{ name: 'dull', patch: 'lead', synth: { preset: 'chip', set: { filter: 'lowpass', cutoff: 200 } } }, { name: 'bright', patch: 'lead', synth: { preset: 'chip', set: { filter: 'lowpass', cutoff: 8000 } } }, { name: 'beep', sample: 0 }],
    samples: [{ name: 'square', wave: [100, 100, 100, 100, -100, -100, -100, -100], loop: { start: 0, length: 8 } }] }
  const player = await createOfflinePlayer()
  const s = createSound({ sound: player, clock: () => 0 })
  const song = s.playSong(new TextEncoder().encode(JSON.stringify(doc)))
  s.flush()
  await new Promise((yes) => setTimeout(yes, 30))
  await player.render(0.3)
  const one = player.target('song:ins:1'), two = player.target('song:ins:2')
  say(one.get('cutoff') === 200 && two.get('cutoff') === 8000 && player.target('song:lead').get('cutoff') === 200 && player.target('song:lead#2').get('cutoff') === 8000 && one.level()[0] > 0 && two.level()[0] > one.level()[0],
    'two instruments that give one name to synths that differ each keep their own: "song:ins:1" and "song:ins:2" read them by number, and the second is the brighter', [one.get('cutoff'), two.get('cutoff'), one.level(), two.level()])
  const beep = song.channel(2), none = song.channel(7)
  say(beep.samples().length === 1024 && peak(beep.samples()) > 0.01 && beep.level()[0] > 0.01 && same(player.read('song:channel:2').notes.length > 0, true) && same([none.samples().length, none.level()], [0, [0, 0]]) && song.channel(0).level()[0] > 0.01 && song.channel(1).level()[0] > song.channel(0).level()[0] && peak(song.channel(0).samples()) === 0,
    'song.channel(n).level() is what is heard on a channel whichever kind of instrument plays it: the two channels that play synths read their own levels (the brighter the louder) and the one that plays a sample its own; a channel the song has not got reads nothing; a synth\'s wave and notes are read at the synth', [peak(beep.samples()), beep.level(), song.channel(0).level(), song.channel(1).level(), none.level()])
  // The song's mix, moved while it plays, and a stretch of it going round.
  {
    const mix = { format: 'synths-song', version: 2, speed: 6, tempo: 125, channels: 2, order: [0, 1, 2],
      patterns: [0, 1, 2].map(() => ({ rows: 8, events: [{ row: 0, ch: 0, note: 'A-4', ins: 1 }, { row: 0, ch: 1, note: 'C-3', ins: 2 }] })),
      instruments: [{ name: 'beep', sample: 0 }, { name: 'low', patch: 'low', synth: { set: CLICK } }],
      samples: [{ name: 'square', wave: [100, 100, 100, 100, -100, -100, -100, -100], loop: { start: 0, length: 8 } }] }
    const player = await createOfflinePlayer()
    const s = createSound({ sound: player, clock: () => player.time, batch: 'manual' })
    const song = s.playSong(new TextEncoder().encode(JSON.stringify(mix)))
    s.flush()
    await new Promise((yes) => setTimeout(yes, 30))
    const levels = async () => { await player.render(2); return [song.channel(0).level(), song.channel(1).level()].map((l) => l.map((v) => +v.toFixed(3))) }
    const plain = await levels()
    const unset = song.channel(0).volume
    song.channel(0).volume = 0.5
    song.channel(1).volume = 0.5
    s.flush()
    const halved = await levels()
    song.channel(0).pan = -1
    song.channel(1).pan = 1
    s.flush()
    const panned = await levels()
    song.loop([1, 0], [2, 0])
    s.flush()
    const places = new Set()
    await player.render(1.5)
    for (let i = 0; i < 40; i++) { await player.render(0.1); places.add(song.position.order) }
    song.loop(null)
    s.flush()
    for (let i = 0; i < 20; i++) { await player.render(0.1); places.add('then ' + song.position.order) }
    const refused = [thrown(() => song.loop('middle')), thrown(() => { song.channel(0).volume = 'loud' })]
    say(unset === undefined && plain[0][0] > 0.05 && plain[1][0] > 0.05 && Math.abs(halved[0][0] / plain[0][0] - 0.5) < 0.15 && Math.abs(halved[1][0] / plain[1][0] - 0.5) < 0.06 && panned[0][1] < panned[0][0] * 0.15 && panned[1][0] < panned[1][1] * 0.15 && song.channel(0).volume === 0.5 && song.channel(1).pan === 1,
      'song.channel(n).volume and .pan move a channel in the song\'s mix as it plays, a channel of samples and a channel that plays a synth alike, and read back what was set', [plain, halved, panned])
    say(same([...places].filter((p) => typeof p === 'number').sort(), [1]) && [...places].includes('then 2') && refused.every((t) => typeof t === 'string'), 'song.loop([1, 0], [2, 0]) keeps the song going round that stretch, and song.loop(null) lets it run on', [[...places], refused])
  }

  // The reverb's and the echo's own levels, and what a song that sets the effects leaves behind.
  {
    const tail = async (set) => { const out = await renderSound((s) => { set(s); s.makeSynth({ ...CLICK, reverb: 1 }).play('A4', 0.05) }, { seconds: 1 }); return peak(out.left.subarray(SR * 0.3)) }
    const tails = [await tail(() => {}), await tail((s) => s.setEffects({ reverbLevel: 0 })), await tail((s) => s.setEffects({ reverbLevel: 2 }))]
    const got = { ops: [] }
    let post = null
    const clock = { currentTime: 0, sampleRate: 48000, state: 'running', resume: async () => {}, addEventListener() {} }
    const player = synths.createPlayer({ context: clock, core: (given) => { post = given.post; return { exec: (ops) => got.ops.push(...ops) } } })
    await player.ready
    const s = createSound({ sound: player, clock: () => 0, batch: 'manual' })
    s.setEffects({ reverbSize: 0.9 })
    s.playSong(new TextEncoder().encode(JSON.stringify({ format: 'synths-song', version: 2, channels: 1, order: [0], patterns: [{ rows: 4, events: [] }], instruments: [], effects: { reverbType: 'hall', echoLevel: 0.5 } })))
    s.flush()
    await new Promise((yes) => setTimeout(yes, 20))
    post({ type: 'song', token: got.ops.find((op) => op[0] === 'songLoad')[1], result: 0, error: null, info: [1, 1, 1, 0, 0, 6, 125, 0], patches: [], replaced: false })
    const before = got.ops.length
    s.close()
    const table = describe().settings
    const id = (name) => table.find((x) => x.name === name).id
    const back = got.ops.slice(before).filter((op) => op[0] === 'e' && op[2] === 4 && op[3] === 0)
    const value = (name) => back.find((op) => op[4] === id(name))?.[5]
    say(tails[0] > 0.001 && tails[1] === 0 && tails[2] > tails[0] * 1.7 && value('reverb.type') === 0 && value('delay.level') === 1 && Math.abs(value('reverb.size') - 0.9) < 1e-6 && describe().names.echoLevel.setting === 'delay.level',
      'reverbLevel and echoLevel are settings (a level of 0 and the reverb is not heard); when a song that set the effects goes, the reverb and the echo are put back to what the page itself asked for, or to how they began', [tails, back.length, value('reverb.type'), value('reverb.size')])
  }

  // A song of format version 2, with an arpeggio struck in sixteenths: each row of it is a note of its own.
  {
    const v2 = { format: 'synths-song', version: 2, speed: 6, tempo: 125, channels: 1, order: [0],
      patterns: [{ rows: 16, events: [{ row: 0, ch: 0, note: 'C-4', ins: 1, arp: { chord: 'maj', rate: '1/16', order: 'up', octaves: 2, gate: 0.5 } }] }],
      instruments: [{ name: 'blip', patch: 'blip', synth: { set: CLICK } }] }
    const player = await createOfflinePlayer()
    const s = createSound({ sound: player, clock: () => 0 })
    s.playSong(new TextEncoder().encode(JSON.stringify(v2)), { repeat: false })
    s.flush()
    await new Promise((yes) => setTimeout(yes, 30))
    const out = (await player.render(1)).left
    const on = onsets(out)
    const row = SR * 2.5 * 6 / 125
    say(on.length >= 7 && on.slice(1, 7).every((f, i) => Math.abs(f - on[i] - row) <= 1) && describe().engine.events.includes('arp_style') && describe().engine.events.length >= 23,
      'a song of format version 2 with a struck arpeggio plays through playSong: a new note on every row (a sixteenth), each held for half of it; the engine\'s events are described, arp_style and those after it among them', [on.slice(0, 8), row, describe().engine.events.length])
  }
  // A song whose channels all play synths, as most chiptunes do, and one that changes instrument on a channel.
  {
    const chip = { format: 'synths-song', version: 1, speed: 6, tempo: 125, channels: 3, order: [0],
      patterns: [{ rows: 16, events: [{ row: 0, ch: 0, note: 'C-3', ins: 1 }, { row: 0, ch: 1, note: 'E-4', ins: 2 }, { row: 8, ch: 2, note: 'G-4', ins: 2 }, { row: 8, ch: 0, note: 'C-4', ins: 3 }] }],
      instruments: [{ name: 'low', patch: 'bass' }, { name: 'high', patch: 'lead' }, { name: 'beep', sample: 0 }],
      samples: [{ name: 'square', wave: [100, 100, 100, 100, -100, -100, -100, -100], loop: { start: 0, length: 8 } }] }
    const player = await createOfflinePlayer()
    const s = createSound({ sound: player, clock: () => 0 })
    const song = s.playSong(new TextEncoder().encode(JSON.stringify(chip)), { repeat: false })
    s.flush()
    await new Promise((yes) => setTimeout(yes, 30))
    const levels = () => [0, 1, 2].map((ch) => +song.channel(ch).level()[0].toFixed(3))
    await player.render(0.3)
    const early = [levels(), peak(song.channel(0).samples())]
    await player.render(0.95)
    const late = [levels(), peak(song.channel(0).samples()), player.read('song:ins:1').level[0] > 0]
    say(early[0][0] > 0.01 && early[0][1] > 0.01 && early[0][2] === 0 && early[1] === 0 && late[0][0] > 0.01 && late[0][2] > 0.01 && late[1] > 0.01,
      'in a song whose channels play synths every channel\'s level moves with its own notes (the third reads nothing until its first note), and a channel that goes from a synth to a sample is followed: its wave is read once it plays the sample', [early, late])
  }
}

// --- the commands are the contract
{
  const play = (s) => {
    s.setTempo(140)
    s.setEffects({ echoTime: 0.2, reverbSize: 0.9 })
    const lead = s.makeSynth('lead', { cutoff: 1500, reverb: 0.3 })
    lead.play(['C4', 'E4', 'G4'], 0.4, { volume: 0.7, pan: -0.5 })
    lead.set({ cutoff: 400 }, { at: 0.2, glide: 0.3 })
    const note = lead.start('C5', { at: 0.5 })
    note.slideTo('G5', 0.2)
    s.makeSynth('bass').playNotes('C2 - C2 G2', 0.125, { repeat: true, at: 0.25 })
    s.makeSynth('kick').playNotes([null, 36], 0.25, { repeat: 3 })
    s.playSound('coin', { at: 0.75, pitch: 3 })
    s.playNote('A4', 0.2, { after: 1 })
    const chord = s.makeSynth('chip').startArp('Am', { at: 0.3, speed: 25 })
    chord.change('F', { at: 0.9 })
    s.makeSynth('chipSnare').playNotes([null, null], 0.25)
    s.makeSynth('chip').setMacro([{ pitch: 0 }, { pitch: 7 }]).play('C5', 0.2, { at: 1.5 })
    s.setVolume(0.8)
  }
  const batches = written(play)
  const cmds = batches.flatMap((b) => b.cmds)
  const text = JSON.stringify(batches)
  say(batches.every((b) => b.synths === 1 && typeof b.now === 'number') && cmds.every((c) => typeof c.op === 'string') && same(JSON.parse(text), batches), `what the functions write is plain data: ${cmds.length} commands that survive being turned into text and back`, null)
  say(same([...new Set(cmds.map((c) => c.op))].sort(), ['macro', 'master', 'note', 'set', 'sound', 'synth', 'tempo', 'tune', 'voice']), 'with the ops macro, master, note, set, sound, synth, tempo, tune and voice', [...new Set(cmds.map((c) => c.op))].sort())
  const direct = await renderSound(play, { seconds: 2 })
  const player = await createOfflinePlayer()
  for (const batch of JSON.parse(text)) player.send(batch)
  const replayed = await player.render(2)
  let differ = 0
  for (let i = 0; i < direct.left.length; i++) if (direct.left[i] !== replayed.left[i] || direct.right[i] !== replayed.right[i]) differ++
  // The pad of unison voices starts each at a random point of its wave, so only synths without unison are compared.
  say(differ === 0 && peak(direct.left) > 0.2, 'commands sent as text to another player make exactly the same sound, sample for sample', differ)
  // The same commands in two batches stamped later on the sender's clock, with the player told when its first sample is.
  const late = await createOfflinePlayer({ start: 100 })
  const shifted = JSON.parse(text).map((b) => ({ ...b, now: b.now + 100, cmds: b.cmds.map((c) => ({ ...c, t: c.t + 100 })) }))
  late.send({ ...shifted[0], cmds: shifted[0].cmds.slice(0, 6) })
  late.send({ ...shifted[0], cmds: shifted[0].cmds.slice(6) })
  const moved = await late.render(2)
  differ = 0
  for (let i = 0; i < direct.left.length; i++) if (direct.left[i] !== moved.left[i]) differ++
  say(differ === 0, 'and the sender\'s clock may start anywhere and the commands come in any number of batches', differ)
  // Rendered a piece at a time, the pieces join exactly.
  const pieces = await createOfflinePlayer()
  for (const batch of batches) pieces.send(batch)
  const a = await pieces.render(0.3337)
  const b = await pieces.render(2 - 0.3337)
  const joined = [...a.left, ...b.left]
  differ = 0
  for (let i = 0; i < direct.left.length; i++) if (direct.left[i] !== joined[i]) differ++
  say(differ === 0 && joined.length === direct.left.length, 'an offline render made in two pieces is the same as one made whole', differ)
  const wav = direct.wav()
  say(wav.length === 44 + 2 * SR * 4 && String.fromCharCode(...wav.slice(0, 4)) === 'RIFF' && readWav(wav).rate === SR, 'the result gives a WAV file: 2 seconds, stereo, 16 bits', wav.length)
  // A command from another language may name things the lenient way, and unknown ops and settings are passed over.
  const loose = await createOfflinePlayer()
  loose.send({ synths: 1, now: 0, cmds: [{ op: 'synth', id: 7, set: { wave: 'sine', filter: 'off', attack: 0, release: 0, sustain: 1, nonsense: 3 } }, { op: 'future-thing', x: 1 }, null, { op: 'note', id: 7, note: 'A4', len: 0.2 }, { op: 'note', id: 'never made', note: 60, len: 0.1, t: 0.5 }] })
  const heard = await loose.render(1)
  say(Math.abs(crossings(heard.left, 0, 0.2) * 5 - 440) <= 5 && peak(heard.left.slice(0.5 * SR, 0.6 * SR)) > 0.05, 'a hand-written batch plays: ids may be numbers, notes may be names, a synth never made gets the default, and what is not understood is passed over', crossings(heard.left, 0, 0.2) * 5)
}

// --- the reverb's types: one reverb, which every synth sends into
{
  const TYPES = ['room', 'hall', 'plate', 'cathedral', 'spring']
  let lead, pad, out
  const cmds = written((s) => {
    lead = s.makeSynth('lead')
    pad = s.makeSynth('pad')
    out = s.soundOutput()
    lead.reverbType = 'hall'
  }).flatMap((b) => b.cmds)
  const d = lead.describe('reverbType')
  say(same(d.choices, TYPES) && d.kind === 'choice' && d.default === 'hall' && same(out.describe('reverb_type').choices, TYPES) && same(describe().settings.find((x) => x.name === 'reverb.type').choices, TYPES) && describe().names.reverbType.setting === 'reverb.type',
    'describe("reverbType") lists the five types, on a synth, on soundOutput() and in the names for other languages', d)
  say(same(cmds[cmds.length - 1].set, { reverbType: 'hall' }) && lead.reverbType === 'hall' && pad.reverbType === 'hall' && pad.get('reverb_type') === 'hall' && out.get('reverbType') === 'hall',
    'the type set on one synth is the type every synth and soundOutput() read back: there is one reverb', [cmds[cmds.length - 1], pad.reverbType, out.get('reverbType')])
  // A select tied to a choice hands over its place in the list.
  pad.set('reverbType', 2)
  const byPlace = [lead.reverbType, out.get('reverbType')]
  out.set('reverbType', 'cathedral')
  const byOutput = [lead.get('reverbType'), pad.reverbType]
  written((s) => { s.setEffects({ reverbDecay: 3, reverb_predelay: 0.05, reverbLowCut: 300 }); lead = s.makeSynth('lead'); out = s.soundOutput() })
  say(same(byPlace, ['plate', 'plate']) && same(byOutput, ['cathedral', 'cathedral']) && lead.reverbDecay === 3 && lead.reverbPredelay === 0.05 && lead.get('reverbLowCut') === 300 && out.get('reverbDecay') === 3 && lead.describe('reverbDecay').max === 30 && lead.describe('reverbLowCut').unit === 'hz',
    'a place in the list chooses a type too, setEffects and soundOutput() set the same value, and reverbDecay, reverbPredelay and reverbLowCut are there', [byPlace, byOutput, lead.reverbDecay])
  say(/reverbType: "cave" is not one of its choices\. They are: room, hall, plate, cathedral, spring/.test(thrown(() => { lead.reverbType = 'cave' })), 'a type that does not exist is said, with the five there are', null)

  // How long each rings: the time from a click until the sound has fallen by 60 dB and stays there.
  const rings = async (play, seconds = 14) => {
    const a = (await renderSound((s) => { play(s); s.makeSynth({ ...CLICK, reverb: 0.5 }).play('C5', 0.05) }, { seconds })).left
    const w = SR / 20, levels = []
    for (let i = 0; i + w <= a.length; i += w) { let sum = 0; for (let j = i; j < i + w; j++) sum += a[j] * a[j]; levels.push(Math.sqrt(sum / w)) }
    const top = Math.max(...levels)
    return (levels.reduce((last, level, i) => (level > top / 1000 ? i : last), 0) + 1) / 20
  }
  const tails = {}
  for (const type of TYPES) tails[type] = await rings((s) => s.setEffects({ reverbType: type }))
  const usual = await rings(() => {})
  say(tails.room < tails.plate && tails.plate < tails.hall && tails.hall < tails.cathedral && tails.room > 0.5 && tails.room < 1.5 && tails.cathedral > 4 && usual === tails.room,
    `the types ring for longer in the order room, plate, hall, cathedral (${TYPES.map((t) => `${t} ${tails[t]} s`).join(', ')}), and the room is the one to begin with`, [tails, usual])
  const onSynth = await rings((s) => { s.makeSynth('bass').reverbType = 'hall' })
  const decay = [await rings((s) => s.setEffects({ reverbDecay: 0.4 })), await rings((s) => s.setEffects({ reverbDecay: 5 }))]
  say(onSynth === tails.hall && decay[0] < tails.room && decay[1] > tails.hall, 'the type set on any synth is heard on every other, and reverbDecay says how long the tail is whatever the type', [onSynth, tails.hall, decay])

  // A target on the player's side, as dials.js is given one where the program is elsewhere.
  const player = await createOfflinePlayer({})
  const s = createSound({ sound: player, clock: () => 0, batch: 'manual', ids: 'r:' })
  const synth = s.makeSynth('lead')
  s.flush()
  await player.render(0.01)
  const target = player.target(synth._id)
  const before = target.get('reverbType')
  target.set('reverbType', 'plate')
  await player.render(0.01)
  say(before === 'room' && target.get('reverbType') === 'plate' && same(target.describe('reverbType').choices, TYPES) && target.describe('reverbType').kind === 'choice', 'a player\'s target describes the reverb\'s type with its choices, and sets it', [before, target.get('reverbType'), target.describe('reverbType')])
}

// --- with no transport given, a sound makes the page's own player: here, where there is no Web Audio, it says so and carries on
{
  const said = []
  const keep = console.warn
  console.warn = (...a) => said.push(a.join(' '))
  let state = null
  const threw = thrown(() => {
    const s = createSound({ batch: 'manual' })
    const lead = s.makeSynth('lead')
    lead.reverbType = 'hall'
    s.setEffects({ reverbSize: 0.7 })
    s.playNote('C4')
    s.flush()
    state = s.player?.state
    const other = createSound({ batch: 'manual' })
    other.playNote('E4')
    other.flush()
    other.close()
    s.close()
  })
  console.warn = keep
  say(threw === null && state === 'failed' && said.filter((t) => /no Web Audio/.test(t)).length <= 1, 'createSound() with nothing given reaches for the page\'s shared player on its first flush, a second sound joins it, and both close: nothing throws where there is no sound card', [threw, state, said])
}

// --- arpeggios played in time: each step a note struck afresh, counted in beats of the tempo
{
  const hzOf = (n) => 440 * 2 ** ((n - 69) / 12)
  const studio = async (bpm) => {
    const player = await createOfflinePlayer({ sampleRate: SR })
    const s = createSound({ sound: player, clock: () => player.time, batch: 'manual' })
    if (bpm) s.setTempo(bpm)
    return { player, s, go: async (seconds) => { s.flush(); return (await player.render(seconds)).left } }
  }
  // The pitch in a stretch of a plain wave, from its upward crossings of zero.
  const pitch = (a, from, to) => { let firstAt = -1, lastAt = -1, n = 0; for (let i = from + 1; i < to; i++) if (a[i - 1] < 0 && a[i] >= 0) { const at = i - a[i] / (a[i] - a[i - 1]); if (firstAt < 0) firstAt = at; else n++; lastAt = at } return n ? n * SR / (lastAt - firstAt) : 0 }
  const noteOf = (hz) => Math.round(69 + 12 * Math.log2(hz / 440))
  const top = (a, from, to) => peak(a.subarray(from, to))

  // Sixteenths at two tempos, to the sample.
  const grid = {}
  for (const bpm of [120, 150]) {
    const { s, go } = await studio(bpm)
    s.makeSynth(CLICK).arp('Cm7', 1.9, { step: 'sixteenth', gate: 0.5 })
    grid[bpm] = onsets(await go(2))
  }
  say(grid[120].length === 16 && grid[120].every((f, i) => f === i * 6000) && grid[150].length === 19 && grid[150].every((f, i) => f === i * 4800),
    'an arpeggio with { step: "sixteenth" } strikes a note every sixteenth on the exact sample: every 6000 frames at 120 beats a minute, every 4800 at 150', grid)

  // Struck against sliding, the gate, the octaves and the orders.
  {
    const pluck = { wave: 'sine', filter: 'off', attack: 0, decay: 0.04, sustain: 0.1, release: 0 }
    const a = await studio(120), b = await studio(120), c = await studio(120), d = await studio(120)
    a.s.makeSynth(pluck).arp('C4', 'major', 1.9, { step: 'sixteenth', gate: 1 })
    b.s.makeSynth(pluck).arp('C4', 'major', 1.9, { step: 'sixteenth', style: 'slide' })
    c.s.makeSynth(CLICK).arp('C4', 'major', 1.9, { step: 'sixteenth', gate: 0.25, octaves: 2 })
    d.s.makeSynth(CLICK).arp('C4', 'major', 1.9, { step: 'eighth', order: 'up-down2', gate: 0.5 })
    const struck = await a.go(2), slid = await b.go(2), short = await c.go(2), twice = await d.go(2)
    const tops = (x) => [0, 1, 2, 3, 4, 5].map((k) => +top(x, k * 6000, k * 6000 + 600).toFixed(2))
    const lengths = onsets(short).slice(0, 6).map((f) => { let end = f; for (let i = f; i < f + 6000; i++) if (Math.abs(short[i]) > 1e-4) end = i; return end - f })
    const through = [0, 1, 2, 3, 4, 5, 6].map((k) => noteOf(pitch(short, k * 6000 + 40, k * 6000 + 1400)))
    const order = [0, 1, 2, 3, 4, 5, 6].map((k) => noteOf(pitch(twice, k * 12000 + 40, k * 12000 + 5800)))
    say(tops(struck).every((v) => v > 0.2) && tops(slid)[0] > 0.2 && tops(slid).slice(2).every((v) => v < 0.12) && onsets(slid).length === 1,
      'each step of a struck arpeggio starts the envelope again, where style "slide" is one note whose pitch jumps under one envelope', [tops(struck), tops(slid)])
    say(lengths.every((n) => Math.abs(n - 1500) < 30) && same(through, [60, 64, 67, 72, 76, 79, 60]) && same(order, [60, 64, 67, 67, 64, 60, 60]),
      'gate: 0.25 holds each note for a quarter of its step, octaves: 2 goes through the chord and then the same an octave up, and "up-down2" plays the top and the bottom twice', [lengths, through, order])
  }

  // The tempo changes under a held arpeggio, its chord changes and keeps its place, and it stops.
  {
    const { s, go } = await studio(120)
    const lead = s.makeSynth(CLICK)
    const arp = lead.startArp('C4', 'major', { step: 'sixteenth', gate: 0.5 })
    const first = await go(0.3)                 // steps at 0, 6000, 12000
    s.setTempo(240)
    arp.change('F4', 'major')
    const then = await go(0.5)
    arp.stop()
    const after = await go(0.3)
    const on = onsets(then)
    const pitches = [noteOf(pitch(first, 12040, 13400)), noteOf(pitch(then, on[1] + 40, on[1] + 1300)), noteOf(pitch(then, on[2] + 40, on[2] + 1300))]
    say(same(onsets(first), [0, 6000, 12000]) && on[1] === 18000 - 14400 && on.slice(2, 6).every((f, i) => f - on[i + 1] === 3000) && same(pitches, [67, 65, 69]) && peak(after.subarray(2400)) === 0,
      'setTempo under a held arpeggio moves the step after the one in hand (which comes when it was always going to) and the rest are twice as fast; chord.change("F") is taken at that step and keeps the place (the fourth step is F major\'s first note again, the fifth its second); stop() ends it', [onsets(first), on.slice(0, 6), pitches])
  }

  // Swing, accents, a pattern and stabs.
  {
    const a = await studio(120), b = await studio(120), c = await studio(120), d = await studio(120)
    a.s.makeSynth(CLICK).arp('C4', 'major', 0.95, { step: 'eighth', gate: 0.3, swing: 0.5 })
    b.s.makeSynth(CLICK).arp('C4', 'major', 0.95, { step: 'sixteenth', gate: 0.5, accent: [1, 0.4, 0, 0.4] })
    c.s.makeSynth(CLICK).arp('C4', 'major', 1.9, { step: 'sixteenth', gate: 0.5, pattern: '1 - 3 - 2\' _ - -' })
    const stabs = d.s.makeSynth(CLICK)
    stabs.arp('C4', 'major', 0.95, { step: 'quarter', order: 'together', gate: 0.5 })
    const swung = onsets(await a.go(1)), accented = await b.go(1), patterned = await c.go(2)
    await d.go(0.01)
    const voices = d.player.voices()
    const levels = [0, 1, 2, 3, 4].map((k) => +top(accented, k * 6000, k * 6000 + 2900).toFixed(2))
    const pat = onsets(patterned)
    const held = (() => { let end = pat[2]; for (let i = pat[2]; i < pat[2] + 20000; i++) if (Math.abs(patterned[i]) > 1e-4) end = i; return end - pat[2] })()
    say(same(swung, [0, 18000, 24000, 42000]) && levels[0] > 0.2 && Math.abs(levels[1] / levels[0] - 0.4) < 0.05 && levels[2] === 0 && Math.abs(levels[3] - levels[1]) < 0.02 && levels[4] === levels[0],
      'swing: 0.5 puts every second step half a step late; accent: [1, 0.4, 0, 0.4] strikes the steps that hard, with a rest where it is 0, and goes round', [swung, levels])
    say(same(pat.slice(0, 6), [0, 12000, 24000, 48000, 60000, 72000]) && same([noteOf(pitch(patterned, 40, 2800)), noteOf(pitch(patterned, 12040, 14800)), noteOf(pitch(patterned, 24040, 28000))], [60, 67, 76]) && Math.abs(held - 9000) < 60 && voices === 3,
      'a pattern is a rhythm of its own ("1 - 3 - 2\' _ - -": the first note, a rest, the third, a rest, the second an octave up held through the next step, two rests), and order "together" strikes the whole chord at each step', [pat.slice(0, 6), held, voices])
  }

  // The fast arpeggio of a C64 tune is as it was: one voice, by the engine's `arp` event, with nothing new sent.
  {
    const player = await createOfflinePlayer({ sampleRate: SR })
    const sent = []
    const s = createSound({ sound: { send: (b) => { sent.push(...b.cmds); player.send(b) } }, clock: () => 0, batch: 'manual' })
    const lead = s.makeSynth(CLICK)
    lead.arp('C4', 'major')
    s.flush()
    createSound({ sound: { send: (b) => sent.push(...b.cmds) }, clock: () => 0 }).makeSynth(CLICK).arp('C4', 'major', { speed: 25, order: 'down' })
    await new Promise((yes) => setTimeout(yes, 5))
    const a = (await player.render(0.4)).left
    const steps = [0, 1, 2, 3].map((k) => noteOf(pitch(a, k * 960 + 20, k * 960 + 940)))
    const arps = sent.filter((c) => c.arp).map((c) => c.arp)
    say(same(arps, [{ offsets: [0, 4, 7], rate: 50, order: 0 }, { offsets: [0, 4, 7], rate: 25, order: 1 }]) && onsets(a).length === 1 && same(steps, [60, 64, 67, 60]),
      'arp(chord) with a speed, or with nothing said, is the fast arpeggio it always was: the same command, one note, its pitch stepping fifty times a second', [arps, steps])
  }

  // By hand, as a tracker auditions one: a note command with the whole arpeggio in it.
  {
    const player = await createOfflinePlayer({ sampleRate: SR })
    player.send({ now: 0, cmds: [{ op: 'synth', id: 'a', set: CLICK }, { op: 'tempo', bpm: 120, t: 0 }, { op: 'note', id: 'a', note: [48], len: 0.9, vel: 0.8, t: 0, arp: { offsets: [0, 3, 7, 10], beats: 0.25, style: 'strike', gate: 0.5, octaves: 2, order: 'up' } }] })
    const a = (await player.render(1)).left
    const on = onsets(a)
    const notes = on.map((f) => noteOf(pitch(a, f + 40, f + 1100)))
    say(same(on, [0, 6000, 12000, 18000, 24000, 30000, 36000, 42000]) && same(notes, [48, 51, 55, 58, 60, 63, 67, 70]) && describe().engine.events.includes('arp_style') && same(describe().arp.styles, ['slide', 'strike']) && describe().arp.patterns.includes('trance') && describe().orders.together === 6,
      'a note command carries the whole arpeggio (offsets, beats, style, gate, octaves, order, swing, accent, pattern) and is struck in time; the names are described, and the engine says it has arp_style', [on, notes])
  }

  // A synth's own pattern for its arpeggios, as a setting an editor can be tied to, and the step that is sounding.
  {
    const { player, s, go } = await studio(120)
    const lead = s.makeSynth(CLICK)
    lead.arpPattern = [1, 0, 3, 0]
    const d = lead.describe('arpPattern')
    const arp = lead.startArp('C4', 'major', { step: 'sixteenth', gate: 0.5 })
    const first = await go(0.5)                           // rows 0 to 3: notes on steps 0 and 2
    const at = [lead.arpStep(), lead.get('arpStep'), player.target(lead._id).get('arpStep')]
    lead.set('arp_pattern', 'bounce')                     // 1 2 3 2, from the next step
    const then = await go(0.5)
    const far = [player.target(lead._id).get('arpPattern'), lead.arpPattern, lead.describe('arp_pattern').named]
    player.target(lead._id).set('arpPattern', '1 1\' - -')
    await go(0.01)
    const set = player.target(lead._id).get('arpPattern')
    lead.arpPattern = 'off'
    arp.stop()
    await go(0.2)
    const refused = [thrown(() => { lead.arpPattern = '1 x 3' }), thrown(() => lead.set({ arpPattern: 7 }))]
    say(same(onsets(first), [0, 12000]) && d.kind === 'pattern' && d.value === '1 - 3 -' && d.patterns.trance === '1^ - 3 2 - 1^ 3 -' && same(at, [0, 0, 0]) && same(far, ['1 2 3 2', '1 2 3 2', 'bounce']) && onsets(then).length >= 4 && set === '1 1\' - -' && lead.arpPattern === '' && lead.arpStep() === -1 && refused.every((t) => /a pattern is up to 32 steps/.test(t)),
      'lead.arpPattern is the rhythm of every arpeggio of a synth that says none: set as text, a name or a list, read back as text (with the name it has in describe), taken by the arpeggio that is sounding at its next step, set from a player\'s target too; arpStep() is the step that is sounding', [onsets(first), d, at, far, onsets(then), set, refused])
  }

  // The trance gate: a held note chopped into a pattern, in time with the tempo.
  {
    const { player, s, go } = await studio(120)
    const pad = s.makeSynth(CLICK)
    const before = [pad.get('gateDepth'), pad.gatePattern, pad.gateStep()]
    pad.gate('x.x.xx..', { smooth: 0.001 })
    pad.start('A4')
    const levels = (a, steps, long = 6000) => Array.from({ length: steps }, (_, k) => +top(a, k * long + 800, (k + 1) * long - 800).toFixed(2))
    const chopped = levels(await go(1), 8)
    const during = [pad.get('gateDepth'), pad.gatePattern, pad.gateStep(), player.target(pad._id).get('gateStep'), player.target(pad._id).get('gatePattern')]
    await go(0.125 + 0.0625)                                // into step 1 of the second round
    const step = pad.gateStep()
    pad.gate('eighths', { rate: 'eighth', depth: 0.5, smooth: 0.001 })
    s.setTempo(120)                                         // beat 0 is now: the pattern begins again here
    const halved = levels(await go(1), 4, 12000)
    const named = [pad.gatePattern, pad.describe('gatePattern').named, pad.get('gateRate'), pad.get('gateDepth')]
    pad.gatePattern = [1, 0.5, 0, 1]
    const listed = pad.gatePattern
    pad.gate('off')
    const open = levels(await go(0.5), 4)
    const mic = s.useMicrophone()
    mic.gate = -45
    const refused = [thrown(() => pad.gate('x-x-')), thrown(() => pad.gate('x.x.', { speed: 2 }))]
    say(same(before, [0, '', -1]) && chopped[0] > 0.2 && same(chopped.map((v) => (v > 0.1 ? 'x' : '.')).join(''), 'x.x.xx..') && same(during, [1, 'x.x.xx..', 0, 0, 'x.x.xx..']) && step === 1,
      'pad.gate("x.x.xx..") chops a held note into that pattern, a step a sixteenth, on the beat that setTempo began; the gate\'s depth becomes 1; gateStep() is the step that is sounding, on the synth and on a player\'s target', [before, chopped, during, step])
    say(halved[0] > 0.2 && Math.abs(halved[1] / halved[0] - 0.5) < 0.03 && Math.abs(halved[2] - halved[0]) < 0.01 && same(named, ['x.x.x.x.x.x.x.x.', 'eighths', 2, 0.5]) && listed === 'x5.x' && open.every((v) => v > 0.2) && pad.gateStep() === -1 && pad.get('gateDepth') === 0 && mic.get('gate') === -45 && typeof mic.gate === 'number'
      && /a gate's pattern is up to 32 steps/.test(refused[0]) && /there is no "speed" to say here/.test(refused[1]),
      'a gate takes a pattern by name, a rate as a note length and a depth (half closed is half as loud), a list of levels is its text, pad.gate("off") opens it again, the microphone\'s own gate is still its noise gate, and nonsense is refused', [halved, named, listed, open, refused])
  }

  // The pitch of a note moved: a glide from the last note, bends by their shapes, a slide, a vibrato.
  {
    const semis = (a, from, to) => +(12 * Math.log2(pitch(a, Math.round(from * SR), Math.round(to * SR)) / hzOf(60))).toFixed(1)
    const one = async (play) => { const { s, go } = await studio(120); const lead = s.makeSynth(CLICK); play(lead, s); return go(1) }
    const glided = await one((lead, s) => { lead.play('C4', 0.1); lead.play('E4', 0.6, { after: 0.2, glide: 0.2 }) })
    const scoop = await one((lead) => lead.play('C4', 0.6, { bend: 'scoop' }))
    const up = await one((lead) => lead.play('C4', 0.6, { bend: { to: 2, over: 0.2 } }))
    const named = await one((lead) => lead.play('C4', 0.6, { bend: { to: 'E4', over: 'sixteenth' } }))
    const dip = await one((lead) => lead.play('C4', 0.6, { bend: 'dip' }))
    const fall = await one((lead) => lead.play('C4', 0.6, { bend: 'fall' }))
    const slid = await one((lead) => lead.play('C4', 0.6, { slide: 12 }))
    const got = {
      glide: [semis(glided, 0.2, 0.215), semis(glided, 0.29, 0.31), semis(glided, 0.45, 0.6)],
      scoop: [semis(scoop, 0, 0.012), semis(scoop, 0.2, 0.4)],
      up: [semis(up, 0, 0.012), semis(up, 0.09, 0.11), semis(up, 0.3, 0.5)],
      named: semis(named, 0.2, 0.5),
      dip: [semis(dip, 0.115, 0.135), semis(dip, 0.3, 0.5)],
      fall: [semis(fall, 0.1, 0.3), semis(fall, 0.58, 0.598)],
      slid: semis(slid, 0.2, 0.5),
    }
    const near = (v, want, by = 0.3) => Math.abs(v - want) <= by
    say(near(got.glide[0], 0, 0.5) && near(got.glide[1], 2, 0.5) && near(got.glide[2], 4, 0.05) && near(got.scoop[0], -2, 0.4) && near(got.scoop[1], 0, 0.05) && near(got.up[0], 0, 0.3) && near(got.up[1], 1, 0.3) && near(got.up[2], 2, 0.05) && near(got.named, 4, 0.05)
      && near(got.dip[0], -1, 0.3) && near(got.dip[1], 0, 0.05) && near(got.fall[0], 0, 0.05) && got.fall[1] < -3.5 && near(got.slid, 12, 0.05),
      'play(note, { glide }) slides to the note from the synth\'s last one; bend: "scoop" comes up into it, { to: 2, over } bends there and stays, a note by name is bent to, "dip" goes down and comes back, "fall" droops at the note\'s end, and slide: 12 is an octave up over a sixteenth', got)

    // A vibrato begins after its delay: the pitch is steady, and then is not.
    const sung = await one((lead) => lead.play('C4', 0.9, { vibrato: { depth: 1, rate: 8, delay: 0.3 } }))
    const held = await (async () => { const { s, go } = await studio(120); const note = s.makeSynth(CLICK).start('C4'); const a = await go(0.3); note.vibrato({ depth: 1, rate: 8 }); const b = await go(0.4); note.vibrato(false); await go(0.1); return [a, b, await go(0.3)] })()
    const spread = (a, from, to) => { const ps = []; let last = -1; for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if (a[i - 1] < 0 && a[i] >= 0) { const at = i - a[i] / (a[i] - a[i - 1]); if (last >= 0) ps.push(SR / (at - last)); last = at } return +(12 * Math.log2(Math.max(...ps) / Math.min(...ps))).toFixed(2) }
    const wobble = [spread(sung, 0.02, 0.28), spread(sung, 0.35, 0.85), spread(held[0], 0.02, 0.28), spread(held[1], 0.05, 0.38), spread(held[2], 0.02, 0.28)]
    say(wobble[0] < 0.05 && wobble[1] > 1.5 && wobble[1] < 2.3 && wobble[2] < 0.05 && wobble[3] > 1.5 && wobble[4] < 0.05,
      'vibrato: { depth: 1, rate: 8, delay: 0.3 } leaves the note steady for 0.3 seconds and then moves it a semitone each way; note.vibrato() gives one to a note that is sounding, and note.vibrato(false) stops it', wobble)

    // A sequencer looking ahead: a key down at a time of soundTime() is on that exact sample.
    const { s, go } = await studio(120)
    const drum = s.makeSynth(CLICK)
    const t0 = s.soundTime()
    for (let i = 0; i < 4; i++) { drum.noteOn('C4', 0.8, { at: t0 + 0.1 + i * 0.125 }); drum.noteOff('C4', { at: t0 + 0.15 + i * 0.125 }) }
    const hits = onsets(await go(1))
    const refused = [thrown(() => drum.play('C4', { bend: 'wobble' })), thrown(() => drum.play('C4', { bend: 'dip', slide: 2 })), thrown(() => drum.play('C4', { vibrato: 3 })), thrown(() => drum.play(['C4', 'E4'], { bend: { to: 'G4' } }))]
    say(same(hits, [4800, 10800, 16800, 22800]) && same(describe().moves.shapes, ['scoop', 'fall', 'dip']) && refused.every((t) => typeof t === 'string' && t.length > 20),
      'noteOn(note, velocity, { at }) and noteOff(note, { at }) are on the exact sample of a time of soundTime(), for a sequencer that looks ahead; what a note\'s pitch cannot be told is refused', [hits, refused])
  }

  const wrong = [() => createSound({ sound: { send() {} } }).makeSynth('lead').arp('Cm7', { step: 'sixteenth', speed: 30 }), () => createSound({ sound: { send() {} } }).makeSynth('lead').arp('Cm7', { style: 'bounce' }),
    () => createSound({ sound: { send() {} } }).makeSynth('lead').arp('Cm7', { pattern: '1 x 3' }), () => createSound({ sound: { send() {} } }).makeSynth('lead').arp('Cm7', { accent: 'loud' }), () => createSound({ sound: { send() {} } }).makeSynth('lead').arp('Cm7', { order: 'sideways' })].map(thrown)
  say(wrong.every((t) => typeof t === 'string') && /step .* or speed .*, not both/.test(wrong[0]) && /"strike".*"slide"/.test(wrong[1]) && /a pattern is up to 32 steps with spaces between them/.test(wrong[2]) && /up-down2/.test(wrong[4]), 'what an arpeggio cannot be told is refused in plain words', wrong)
}

// --- several recordings as one instrument (loadSamples): keys, layers, kits, names, a missing file, and letting go
{
  const hzOf = (n) => 440 * 2 ** ((n - 69) / 12)
  const tone = (hz, seconds = 1) => { const w = Float32Array.from({ length: SR * seconds }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / SR)); return toWav(w, w, SR) }
  // The pitch of a plain wave between two times, from where it first and last goes up through zero.
  const pitch = (a, from = 0.05, to = 0.35) => {
    let firstAt = -1, lastAt = -1, n = 0
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if (a[i - 1] < 0 && a[i] >= 0) { const at = i - a[i] / (a[i] - a[i - 1]); if (firstAt < 0) firstAt = at; else n++; lastAt = at }
    return n ? n * SR / (lastAt - firstAt) : 0
  }
  const cents = (hz, note) => 1200 * Math.log2(hz / hzOf(note))
  // Each recording is a sine a little off its note, by an amount of its own, so what is heard says which one played.
  const OFF = { 'p-C3.wav': 0, 'p-C4.wav': 30, 'p-C5.wav': 60 }
  const files = { 'p-C3.wav': tone(hzOf(48)), 'p-C4.wav': tone(hzOf(60.3)), 'p-C5.wav': tone(hzOf(72.6)), 'soft-C4.wav': tone(300), 'hard-C4.wav': tone(500), 'kick.wav': tone(100, 0.3), 'snare.wav': tone(200, 0.3), 'hat.wav': tone(900, 0.3), 'take1.wav': tone(400, 0.2), 'take2.wav': tone(600, 0.2) }
  const studio = async (more = {}) => {
    const player = await createOfflinePlayer()
    const s = createSound({ sound: player, clock: () => player.time, batch: 'manual', read: async (path) => files[path] || null, ...more })
    const settle = async () => { s.flush(); await new Promise((yes) => setTimeout(yes, 20)); s.flush(); await player.render(0.02) }
    const hear = async (synth, note, volume) => { synth.play(note, 0.4, volume); s.flush(); return (await player.render(0.5)).left }
    return { player, s, settle, hear }
  }

  let said = await saying(async () => {
    const { player, s, settle, hear } = await studio()
    const piano = s.loadSamples(['p-C3.wav', 'p-C4.wav', 'p-C5.wav'])
    const zones = piano.zones()
    say(same(zones.map((z) => [z.file, z.note, z.from, z.to]), [['p-C3.wav', 48, 0, 53], ['p-C4.wav', 60, 54, 65], ['p-C5.wav', 72, 66, 127]]) && zones[0].release > zones[1].release && zones[1].release > zones[2].release && zones.every((z) => same(z.loud, [0, 1]) && !z.oneShot && !z.asRecorded),
      'loadSamples reads each recording\'s note from its file\'s name and splits the keys halfway between neighbours (C3 up to F3, C4 from F#3 to F4, C5 from F#4), with a longer release for the lower notes', zones)
    await settle()
    const heard = {}
    for (const n of [48, 60, 72, 53, 54, 65, 66, 36, 79]) heard[n] = Math.round(cents(pitch(await hear(piano, n)), n))
    say([48, 53, 36].every((n) => Math.abs(heard[n] - 0) < 4) && [60, 54, 65].every((n) => Math.abs(heard[n] - 30) < 4) && [72, 66, 79].every((n) => Math.abs(heard[n] - 60) < 4),
      'a note at each recording\'s own key plays it at its pitch, and every other key plays the nearer recording moved to that key (each recording is off its note by an amount of its own, which is what is heard)', heard)
    const d = piano.describe('zones')
    const far = player.target(piano._id).get('zones')
    say(d.kind === 'zones' && d.zones.length === 3 && same(piano.get('zones'), d.zones) && far.length === 3 && same(far.map((z) => [z.note, z.from, z.to]), zones.map((z) => [z.note, z.from, z.to])) && piano.get('wave') === 'sample' && piano.release !== undefined,
      'the zones are read back for an editor: piano.zones(), describe("zones") and get("zones"), on the synth and on a player\'s target', [d, far])

    // The same three by the note each was played at, on an ordinary synth, with neighbours faded into each other.
    const lead = s.makeSynth({ ...CLICK, samples: { C3: 'p-C3.wav', C4: 'p-C4.wav', C5: 'p-C5.wav' } })
    const other = s.makeSynth(CLICK)
    other.samples = { C3: 'p-C3.wav', C5: 'p-C5.wav' }
    const faded = s.makeSynth(CLICK).setSamples({ C3: 'p-C3.wav', C4: 'p-C4.wav' }, { crossfade: 4 })
    await settle()
    const got = [Math.round(cents(pitch(await hear(lead, 61)), 61)), Math.round(cents(pitch(await hear(other, 61)), 61)), lead.get('wave'), other.get('wave'), typeof other.samples]
    const fz = faded.zones()
    say(same(got, [30, 60, 'sample', 'sample', 'function']) && same(fz.map((z) => [z.from, z.to, z.crossfade.keys]), [[0, 55, [0, 4]], [52, 127, [4, 0]]]),
      'makeSynth({ samples }), lead.samples = { … } and lead.setSamples(files, { crossfade: 4 }) put a map on an ordinary synth and turn its wave to "sample"; samples() is still the wave for a scope; a crossfade of 4 keys has neighbours overlap by 4', [got, fz])
    other.samples = null
    await settle()
    say(other.zones().length === 0 && other.get('zones') === null && player.target(other._id).get('zones') === null, 'and null takes the recordings away', other.zones())
  })
  say(said.length === 0, 'and nothing is said in the console about any of it', said)

  said = await saying(async () => {
    // Loudness layers, and takes that go in turn.
    const { s, settle, hear } = await studio()
    const layered = s.loadSamples([{ file: 'soft-C4.wav', note: 'C4', loud: [0, 0.5] }, { file: 'hard-C4.wav', note: 'C4', loud: [0.5, 1] }])
    const turns = s.loadSamples({ C4: ['take1.wav', 'take2.wav'] })
    const by = s.loadSamples([{ file: 'soft-C4.wav', note: 'C4', from: 'A3', to: 'E4', tune: -100, volume: 0.5, release: 2 }])
    await settle()
    const layers = [Math.round(pitch(await hear(layered, 'C4', 0.3))), Math.round(pitch(await hear(layered, 'C4', 0.49))), Math.round(pitch(await hear(layered, 'C4', 0.51))), Math.round(pitch(await hear(layered, 'C4', 1)))]
    const lz = layered.zones().map((z) => z.loud)
    say(same(layers, [300, 300, 500, 500]) && lz[0][1] < 0.5 && lz[1][0] > 0.5, 'two recordings of one note with loud: [0, 0.5] and [0.5, 1] are layers: the soft one below half, the hard one from half up, never both', [layers, lz])
    const takes = []
    for (let i = 0; i < 4; i++) takes.push(Math.round(pitch(await hear(turns, 'C4'), 0.02, 0.18)))
    say(same(takes, [400, 600, 400, 600]) && turns.zones().every((z) => z.take === 1), 'several files for one note are takes that go in turn', takes)
    // A kit: each key its own sound at its own pitch, and nothing between.
    const kit = s.loadSamples({ C2: 'kick.wav', D2: 'snare.wav', 'F#2': 'hat.wav' }, { kit: true })
    await settle()
    const drums = [Math.round(pitch(await hear(kit, 'C2'), 0.02, 0.25)), Math.round(pitch(await hear(kit, 'D2'), 0.02, 0.25)), Math.round(pitch(await hear(kit, 'F#2'), 0.02, 0.25)), peak(await hear(kit, 'C#2')), peak(await hear(kit, 'C4'))]
    say(same(drums.slice(0, 3), [100, 200, 900]) && drums[3] === 0 && drums[4] === 0 && kit.zones().every((z) => z.oneShot && z.asRecorded && z.from === z.to && z.release === null), 'with { kit: true } each key plays its own recording as it was recorded, whatever the key, and the keys between are silent', [drums, kit.zones()])
    const out = await hear(by, 'C4')
    const bz = by.zones()[0]
    say(Math.abs(cents(pitch(out), 59) - 1200 * Math.log2(300 / hzOf(60))) < 4 && same([bz.from, bz.to, bz.tune, bz.volume, bz.release], [57, 64, -100, 0.5, 2]), 'the explicit form sets a recording\'s keys, tuning, loudness and release by hand', [pitch(out), bz])

  })
  say(said.length === 0, 'and nothing is said in the console about any of that either', said)

  // The names of files.
  const read = [['piano-C2.wav', 36], ['piano-Fs2.wav', 42], ['F#2.wav', 42], ['Gb2.ogg', 42], ['60.wav', 60], ['kick_36.wav', 36], ['samples/soft-C4.wav', 60], ['bass-a2.wav', 45], ['Bb3.mp3', 58], ['take2-D4.wav', 62], ['C-1.wav', 0], ['loud.wav', null], ['piano.mp3', null]]
  const unread = thrown(() => createSound({ sound: { send() {} }, batch: 'manual' }).loadSamples(['piano-C2.wav', 'piano-loud.wav']))
  const wrong = [thrown(() => createSound({ sound: { send() {} } }).loadSamples()), thrown(() => createSound({ sound: { send() {} } }).loadSamples({})), thrown(() => createSound({ sound: { send() {} } }).loadSamples([{ file: 'a-C4.wav', lowd: 1 }])), thrown(() => createSound({ sound: { send() {} } }).loadSamples({ H9: 'a.wav' }))]
  say(read.every(([name, note]) => synths.noteInName(name) === note) && /the note of "piano-loud.wav" cannot be read from its name\. Put the note in the name/.test(unread) && wrong.every((t) => typeof t === 'string' && t.length > 20) && /Did you mean "loud"/.test(wrong[2]),
    'a file\'s note is read from its name (C2, Fs2, F#2, Gb2, a number alone), a name with none is refused with what to do about it, and so is nonsense', [read.map(([n]) => [n, synths.noteInName(n)]), unread, wrong])

  // The commands, for another language to write.
  const c = commands((s) => { s.load_samples({ C3: 'p-C3.wav', C4: 'p-C4.wav' }, { reverb: 0.3, crossfade: 2 }) }, { resolve: (path) => 'https://x.test/' + path })
  say(same(c.map((x) => x.op), ['sample', 'sample', 'synth', 'zones']) && c[0].zone === true && c[0].url === 'https://x.test/p-C3.wav' && c[0].note === 48 && c[2].preset === 'sample' && c[2].set.reverb === 0.3
    && same(c[3].zones, [{ file: 'p-C3.wav', note: 48, sample: c[0].id }, { file: 'p-C4.wav', note: 60, sample: c[1].id }]) && c[3].crossfade === 2 && c[3].id === c[2].id && describe().zones.functions[0] === 'loadSamples' && describe().zones.most === 512,
  'loadSamples writes a sample command for each file, a synth, and a zones command that names them with their notes; the names are described', c)

  // A file that is not there: one message, and the others play in its place.
  said = await saying(async () => {
    const { s, settle, hear, player } = await studio({ read: undefined, resolve: (path) => 'data:audio/wav;base64,' + (files[path] ? Buffer.from(files[path]).toString('base64') : '') })
    const piano = s.loadSamples({ C3: 'p-C3.wav', C4: 'missing-C4.wav', C5: 'p-C5.wav' })
    await settle()
    await new Promise((yes) => setTimeout(yes, 50))
    await player.render(0.05)
    const heard = [Math.round(cents(pitch(await hear(piano, 58)), 58)), Math.round(cents(pitch(await hear(piano, 62)), 62))]
    const far = player.target(piano._id).get('zones')
    say(Math.abs(heard[0]) < 4 && Math.abs(heard[1] - 60) < 4 && far.length === 2 && far[0].to === 59 && far[1].from === 60, 'with one file missing the others take its keys between them', [heard, far])
  })
  say(said.length === 1 && /loadSamples: "missing-C4.wav" could not be loaded \(.*\), so the other recordings play in its place/.test(said[0]), 'and one message names the file that failed', said)

  // Letting go: a removed instrument's recordings are freed, so there is room for as many again.
  said = await saying(async () => {
    const tiny = toWav(new Float32Array(64).fill(0.5), new Float32Array(64).fill(0.5), SR)
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, 'tiny.wav']))
    const { s, settle, hear } = await studio({ read: async (path) => (path === 'tiny.wav' ? tiny : files[path] || null) })
    for (let round = 0; round < 8; round++) {
      const big = s.loadSamples(Array.from({ length: 100 }, (_, i) => ({ file: 'tiny.wav', note: i, start: round })))
      await settle()
      big.remove()
    }
    const piano = s.loadSamples(['p-C3.wav', 'p-C4.wav', 'p-C5.wav'])
    await settle()
    const heard = Math.round(cents(pitch(await hear(piano, 60)), 60))
    piano.remove()
    await settle()
    const gone = peak(await hear(piano, 60))
    say(heard === 30 && gone === 0 && many[0] === 'tiny.wav', 'remove() frees an instrument\'s recordings: eight instruments of a hundred recordings each, one after another, leave room for a piano, and a removed one is silent', [heard, gone])
  })
  say(said.length === 0, 'and nothing is said about running out of room', said)

  // As a song's instrument.
  {
    const player = await createOfflinePlayer()
    const s = createSound({ sound: player, clock: () => player.time, read: async (path) => files[path] || readFile(join(ROOT, 'examples', path)).catch(() => null) })
    const piano = s.loadSamples(['p-C3.wav', 'p-C4.wav', 'p-C5.wav'], { reverb: 0.2 })
    s.playSong('songs/night_drive.json', { patches: { tune: piano } })
    await new Promise((yes) => setTimeout(yes, 60))
    s.flush()
    const out = await player.render(2)
    const tune = player.target('song:tune')
    say(tune.get('zones')?.length === 3 && tune.get('wave') === 'sample' && tune.get('reverb') === 0.2 && peak(out.left) > 0.02, 'an instrument from loadSamples can be a song instrument\'s patch: the song\'s synth has its recordings and its settings', [tune.get('zones'), tune.get('wave'), peak(out.left)])
  }
}

// --- values that mean something else are labelled for a control: a reverb's decay of 0 is the type's own
{
  const s = createSound({ sound: { send() {} }, batch: 'manual' })
  const lead = s.makeSynth('lead')
  const mic = s.useMicrophone()
  const player = await createOfflinePlayer({})
  const far = createSound({ sound: player, clock: () => 0, batch: 'manual', ids: 'l:' })
  const synth = far.makeSynth('lead')
  far.flush()
  await player.render(0.01)
  const got = [lead.describe('reverbDecay'), s.soundOutput().describe('reverbDecay'), player.target(synth._id).describe('reverbDecay'), mic.describe('gate'), lead.describe('reverbPredelay'), lead.describe('cutoff')]
  const waves = [lead.describe('wave'), player.target(synth._id).describe('wave'), lead.describe('filter'), s.soundOutput().describe('reverbType'), lead.describe('cutoff')]
  say(same(waves[0].aliases, { square: 'pulse', sawtooth: 'saw', tri: 'triangle', sin: 'sine' }) && same(waves[1].aliases, waves[0].aliases) && waves[2].aliases.low === 'lowpass' && waves[2].aliases.none === 'off' && waves[3].aliases === undefined && waves[4].aliases === undefined && !waves[0].choices.includes('square'),
    'describe gives aliases for a choice that may be set by other words (square for pulse, low for lowpass), on a synth and on a player\'s target, and none where there are none', waves)
  const table = describe().settings
  say(got.slice(0, 3).every((d) => d && same(d.labels, { 0: 'auto' }) && d.min === 0) && same(got[3].labels, { '-100': 'off' }) && got[4].labels === undefined && got[5].labels === undefined
    && same(table.find((x) => x.name === 'reverb.decay').labels, { 0: 'auto' }) && same(table.find((x) => x.name === 'input.gate').labels, { '-100': 'off' }),
  'describe gives labels for the values that mean something else (reverbDecay 0 is "auto" on a synth, on soundOutput() and on a player\'s target; the microphone\'s gate at -100 is "off"), none where 0 is a real zero, and the table of settings carries them', got)
}

// --- a reply that says "ok" and has nothing in it: the file is asked for again in other ways, and the reason is plain
{
  const engine = await readFile(join(ROOT, 'synths_core.wasm'))
  const kept = { fetch: globalThis.fetch, xhr: globalThis.XMLHttpRequest, web: globalThis.CapacitorWebFetch }
  const reply = (bytes, status = 200) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  const empty = new Uint8Array(0)
  const asked = []
  const pretendXhr = (bytes) => class { open(method, url) { this.url = url } send() { asked.push('xhr ' + (this.responseType || '')); this.status = 200; this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); setTimeout(() => this.onload(), 0) } }
  const start = async () => { try { const p = await createOfflinePlayer({ wasm: 'https://app.test/lib/synths_core.wasm' }); p.close?.(); return 'ok' } catch (e) { return e.message } }
  const out = {}
  try {
    // A fetch that a web view has patched: an empty "200 ok" for a whole address, where XMLHttpRequest has the bytes.
    globalThis.fetch = async (url, o) => { asked.push('fetch' + (o?.cache ? ' ' + o.cache : '') + (url instanceof URL ? ' URL' : '')); return reply(empty) }
    globalThis.XMLHttpRequest = pretendXhr(engine)
    out.xhr = [await start(), asked.splice(0)]
    // No XMLHttpRequest: empty the first time, there the second time, past the cache.
    delete globalThis.XMLHttpRequest
    globalThis.fetch = async (url, o) => { asked.push('fetch' + (o?.cache ? ' ' + o.cache : '')); return reply(o?.cache === 'reload' ? engine : empty) }
    out.again = [await start(), asked.splice(0)]
    // A host that says where the fetch from before the patch is.
    globalThis.fetch = async () => { asked.push('fetch'); throw new TypeError('Load failed') }
    globalThis.CapacitorWebFetch = async (url) => { asked.push('unpatched ' + typeof url); return reply(engine) }
    out.unpatched = [await start(), asked.splice(0)]
    delete globalThis.CapacitorWebFetch
    // Always empty, always something else, and not there at all.
    globalThis.fetch = async () => { asked.push('fetch'); return reply(empty) }
    globalThis.XMLHttpRequest = pretendXhr(empty)
    out.empty = [await start(), asked.splice(0)]
    globalThis.fetch = async () => reply(new TextEncoder().encode('<!doctype html><title>Not found</title>'))
    globalThis.XMLHttpRequest = pretendXhr(new TextEncoder().encode('<!doctype html>'))
    out.wrong = [await start()]
    asked.length = 0
    globalThis.fetch = async () => { asked.push('fetch'); return reply(empty, 404) }
    out.gone = [await start(), asked.splice(0)]
    out.given = [await (async () => { try { await createOfflinePlayer({ wasm: new Uint8Array(0) }); return 'ok' } catch (e) { return e.message } })()]
    // A sample and a song the same way.
    globalThis.fetch = async (url) => { asked.push('fetch'); return reply(empty) }
    globalThis.XMLHttpRequest = pretendXhr(toWav(new Float32Array(4800).fill(0.5), new Float32Array(4800).fill(0.5), SR))
    const player = await createOfflinePlayer({ wasm: engine })
    const s = createSound({ sound: player, clock: () => player.time, batch: 'manual', resolve: (path) => 'https://app.test/' + path })
    const said = await saying(async () => {
      s.loadSample('there.wav').play()
      s.flush()
      out.sample = [peak((await player.render(0.05)).left), asked.splice(0)]
      globalThis.XMLHttpRequest = pretendXhr(empty)
      s.loadSample('hollow.wav').play()
      s.playSong('hollow.mod')
      s.flush()
      await player.render(0.05)
    })
    out.said = said
  } finally {
    globalThis.fetch = kept.fetch
    if (kept.xhr) globalThis.XMLHttpRequest = kept.xhr; else delete globalThis.XMLHttpRequest
    if (kept.web) globalThis.CapacitorWebFetch = kept.web; else delete globalThis.CapacitorWebFetch
  }
  say(out.xhr[0] === 'ok' && same(out.xhr[1], ['fetch URL', 'xhr arraybuffer']) && out.again[0] === 'ok' && same(out.again[1], ['fetch', 'fetch reload']) && out.unpatched[0] === 'ok' && same(out.unpatched[1], ['fetch', 'unpatched string']),
    'an engine file that comes back empty (or whose fetch fails) is asked for again: through the fetch a host kept from before it was patched, through XMLHttpRequest, and by fetch once more past the cache; whichever has the bytes starts the engine', out)
  say(out.empty[0] === 'the engine\'s file came back empty from https://app.test/lib/synths_core.wasm' && same(out.empty[1], ['fetch', 'xhr arraybuffer', 'fetch']) && /the engine's file is not what was expected at https:\/\/app\.test\/lib\/synths_core\.wasm \(\d+ bytes of something else came back\)/.test(out.wrong[0])
    && /could not be fetched/.test(out.gone[0]) && same(out.gone[1], ['fetch']) && out.given[0] === 'the engine that was given is empty',
    'when every way gives nothing the reason says what came back and from where, not that WebAssembly could not read it; a page of text in the engine\'s place is said to be something else; a file that is not there is not asked for again', out)
  say(out.sample[0] > 0.1 && same(out.sample[1], ['fetch', 'xhr arraybuffer']) && out.said.some((t) => /the sample "hollow.wav" could not be loaded \(that file came back empty from https:\/\/app\.test\/hollow\.wav\)/.test(t)) && out.said.some((t) => /hollow\.mod/.test(t) && /came back empty/.test(t)),
    'a sample is fetched the same way, and a sample or a song that comes back empty every time is said to have come back empty', out)
}

// --- a host that makes the sound itself: createPlayer is given a core and a clock, and needs no Web Audio and no engine
{
  const { createPlayer } = synths
  const clock = { currentTime: 100, sampleRate: 44100, state: 'running', resume: async () => {}, suspend: async () => {}, close: async () => {}, addEventListener() {} }
  const got = { ops: [], given: null, pushed: 0, closed: false }
  let post = null
  const core = {
    time: 0, sampleRate: 44100,
    voices: () => 3,
    exec(ops) { got.ops.push(...ops) },
    taps: (sources, frames) => sources.map((source) => [source, new Float32Array(frames).fill(0.25), 0.5, 0.25, new Uint32Array([0, 1 << 28, 0, 0])]),
    songPosition: () => [2, 1, 4, 7, 0, 6, 125, 0, 64, 12],
    pushInput(frames) { got.pushed += frames.length },
    close() { got.closed = true },
  }
  const states = []
  const player = createPlayer({ context: clock, onState: (s) => states.push(s), core: (given) => { got.given = given; post = given.post; return core }, wasm: () => { throw new Error('the engine was asked for') } })
  await player.ready
  const s = createSound({ sound: player, clock: () => 0, batch: 'manual', read: async () => toWav(new Float32Array(100).fill(0.5), new Float32Array(100).fill(0.5), 44100) })
  const lead = s.makeSynth('lead')
  lead.play('A4', 0.5, 0.7)
  s.flush()
  const on = got.ops.find((op) => op[0] === 'e' && op[2] === 1)
  const off = got.ops.find((op) => op[0] === 'e' && op[2] === 2)
  const params = got.ops.filter((op) => op[0] === 'e' && op[2] === 4)
  const part = on && on[3]
  // What the core says back reaches whoever asked: a song that was read, and a recording that is over.
  s.playSong(new TextEncoder().encode('{"format":"synths-song"}'))
  const take = s.recordOutput(1)
  s.flush()
  await new Promise((yes) => setTimeout(yes, 20))
  const load = got.ops.find((op) => op[0] === 'songLoad')
  const rec = got.ops.find((op) => op[0] === 'record')
  let done = null
  take.onDone((t) => { done = t })
  post({ type: 'song', token: load[1], result: 0, error: null, info: [4, 8, 1, 0, 0, 6, 125, 0], patches: [], replaced: false })
  post({ type: 'recorded', slot: rec[1], frames: 4410, full: false, rate: 44100 })
  await new Promise((yes) => setTimeout(yes, 5))
  const started = got.ops.find((op) => op[0] === 'e' && op[2] === 15 && op[4] === 1)
  // Everything else a program asks for reaches the host's core as its op: a recording, a tune kept by the core,
  // a tempo, a buffer (which is the player's own and is not passed on), stopping, and a synth let go.
  const before = got.ops.length
  const drum = s.loadSample('thud.wav', { note: 'C3' })
  const tune = lead.playNotes('C4 E4 G4', 0.25, { repeat: true })
  s.setTempo(90)
  s.setSoundBuffer('large')
  s.flush()
  await new Promise((yes) => setTimeout(yes, 20))
  s.flush()
  await new Promise((yes) => setTimeout(yes, 20))
  const was = s.soundBuffer()
  const other = s.makeSynth('bass')
  other.play('C2', 0.2)
  s.flush()
  const otherPart = got.ops.filter((op) => op[0] === 'e' && op[2] === 1).pop()[3]
  tune.stop()
  other.remove()
  s.flush()
  const more = got.ops.slice(before)
  const kinds = [...new Set(more.map((op) => op[0]))]
  const sampled = more.find((op) => op[0] === 'sample'), tuned = more.find((op) => op[0] === 'tune'), tempoed = more.find((op) => op[0] === 'tempo'), stopped = more.find((op) => op[0] === 'stopPart')
  const read = player.read(lead._id)
  const place = player.songPosition()
  const asked = await player.ask()
  const buffer = player.buffer()
  player.close()
  say(player.kind === 'host' && player.how === 'host' && player.context === clock && player.node === null, 'a player given a core by its host starts with no Web Audio and no engine fetched, on the host\'s clock', player.kind)
  say(got.given.sampleRate === 44100 && typeof got.given.post === 'function' && states.includes('on') && on && on[0] === 'e' && Math.abs(on[1] - (100 + 0.04)) < 1e-9 && on[5] === 69 && Math.abs(on[6] - 0.7) < 1e-6 && off && Math.abs(off[1] - on[1] - 0.5) < 1e-9 && off[3] === part && off[4] === on[4] && params.length > 3 && params.every((op) => op[3] === part || op[3] === 0),
    'a note reaches the host\'s exec as the documented ops: ["e", seconds on the host\'s clock (now and the latency), 1 note_on, part, handle, note, velocity], its note_off the note\'s length later, after the params that set the part', [on, off, params.length])
  say(load && load[2] instanceof Uint8Array && load[4] === 32 && load[5] === 512 && started && rec && rec[3] === 1 && done && Math.abs(done.seconds - 0.1) < 1e-9 && done.frames === 4410 && player.node === null,
    'a song message from the core starts the song (a song event is sent back to exec) and a recorded message reaches the program that asked, with its length', [load && load.slice(3), started, rec, done && done.seconds])
  say(sampled && sampled[2] instanceof Float32Array && sampled[2].length === 200 && sampled[3] === 2 && sampled[4] === 44100 && sampled[5] === 48 && tuned && tuned[3] === part && tuned[4].length === 3 && tuned[4][1][0] === 0.25 && same(tuned[4][1][1], [64]) && tuned[6] === 0
    && tempoed && Math.abs(tempoed[2] - 60 / 90) < 1e-9 && more.some((op) => op[0] === 'stopTune' && op[1] === tuned[1]) && stopped && stopped[1] === otherPart && otherPart !== part && !kinds.includes('buffer') && was.thread === 'host' && was.setting === 4096,
    'a sample (its frames, channels, rate and the note it is at), a tune (its steps, for the core to play), a tempo, stopping the tune and remove() each reach the host as the documented op; a buffer command is the player\'s own and no op; no engine was asked for', [kinds, sampled && sampled.slice(3), tuned && tuned.slice(4), tempoed, stopped, was])
  say(read.samples.length === 1024 && Math.abs(read.level[0] - 0.5 * 0.5) < 1e-6 && same(read.notes, [60]) && place.state === 'playing' && place.row === 7 && place.tempo === 125 && asked.voices === 3 && buffer.thread === 'host' && got.closed === true,
    'read(), songPosition() and ask() are answered by the host\'s core, soundBuffer() says the thread is the host\'s, and close() closes the core', [read.level, read.notes, place, asked, buffer])
}

// --- the sound buffer: a command like the rest, with the words and the rounding
{
  const said = []
  const keep = console.warn
  console.warn = (...a) => said.push(a.join(' '))
  const sent = []
  const s = createSound({ batch: 'manual', sound: { send: (batch) => sent.push(...batch.cmds) } })
  const first = s.soundBuffer()
  s.flush()
  s.setSoundBuffer('large')
  s.set_sound_buffer(3000)
  s.setSoundBuffer(3000)
  s.setSoundBuffer('auto')
  s.flush()
  s.receiveSoundEvents([{ type: 'buffer', frames: 2048, delay: 93, thread: 'page', underruns: 2, setting: 'auto' }])
  const threw = [thrown(() => s.setSoundBuffer('huge')), thrown(() => s.setSoundBuffer(-4)), thrown(() => s.setSoundBuffer({}))]
  console.warn = keep
  const offline = await createOfflinePlayer()
  const quiet = thrown(() => { offline.send({ cmds: [{ op: 'buffer', size: 4096 }] }) })
  const d = describe().buffer
  say(same(first, { frames: 0, delay: 0, thread: null, underruns: 0, setting: 'auto' }) && same(sent.map((c) => [c.op, c.size]), [['buffer', undefined], ['buffer', 4096], ['buffer', 4096], ['buffer', 4096], ['buffer', 'auto']])
    && said.filter((t) => /a sound buffer is a power of two from 256 to 16384, so 3000 is taken as 4096/.test(t)).length === 1 && same(s.soundBuffer(), { frames: 2048, delay: 93, thread: 'page', underruns: 2, setting: 'auto' })
    && threw.every((t) => /setSoundBuffer needs "small", "medium", "large", "auto" or a number of frames from 256 to 16384/.test(t)) && quiet === null
    && same(d.functions, ['setSoundBuffer', 'soundBuffer']) && d.words.small === 1024 && d.words.medium === 2048 && d.words.large === 4096 && d.words.auto === 'auto',
  'setSoundBuffer writes a buffer command (a word, or frames brought to a power of two with one message), soundBuffer() asks once and gives what the player said back, nonsense is refused in plain words, an offline player passes it by, and the names are described',
  { first, sent, said, threw, quiet, d })
}

console.log(`${count - failed} of ${count} passed`)
process.exit(failed ? 1 : 0)
