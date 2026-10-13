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
    ['an order that does not exist', () => lead.arp('Cm', { order: 'sideways' }), /arp: "sideways" is not an order an arpeggio can go in\. The orders are: up, down, up-down, as written, random/],
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
  say(same(lead.describe('filter_cutoff'), { name: 'filter.cutoff', kind: 'float', min: 20, max: 20000, default: 800, unit: 'hz' }) && same(lead.describe('wave').choices, ['sine', 'triangle', 'saw', 'pulse', 'sample']) && lead.describe('wave').kind === 'choice'
    && same([lead.describe('octave').min, lead.describe('octave').max, lead.describe('octave').unit], [-4, 4, 'octaves']) && lead.describe('sync').kind === 'bool' && lead.describe('nothing') === null,
    'describe(name) gives the range, the unit, the kind and the choices, in the friendly name\'s own units', lead.describe('filter_cutoff'))
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

console.log(`${count - failed} of ${count} passed`)
process.exit(failed ? 1 : 0)
