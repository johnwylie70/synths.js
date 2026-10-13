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

const { renderSound, createSound, createOfflinePlayer, noteNumber, toWav, readWav, describe } = synths
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
    ['a length that is not a time', () => lead.play('C4', -1), /play: the length needs a number of seconds, more than 0, not -1/],
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
    if (!(p > 0.1 && p <= 1) || !r.left.every(Number.isFinite) || first(r.left) > 1) quiet.push([name, p])
  }
  say(quiet.length === 0, `all ${synths.soundNames().length} game sounds make sound from the first sample, none silent and none past full volume`, quiet)
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
    say(r.left.every(Number.isFinite) && onsets(r.left.slice(SR)).length === 1 && Math.abs(crossings(r.left, 1, 1.1) * 10 - 440) <= 10, '70 synths at once (there is room for 64): all play, and one that lost its place plays again as itself', onsets(r.left.slice(SR)))
  })
  say(said.length === 1 && /more than 64 synths are in use at once.*call its remove\(\)/.test(said[0]), 'the console says so once, with what to do', said)
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

// --- songs are not ready, and say so
{
  const said = await saying(async () => {
    const r = await renderSound((s) => { const song = s.playSong('tune.mod'); s.playSong('other.xm'); song.stop(); s.playSound('coin') }, { seconds: 0.3 })
    say(peak(r.left) > 0.1, 'playSong does not get in the way of other sound', peak(r.left))
  })
  say(said.length === 1 && /tracker songs are not ready yet in this version, so playSong plays nothing/.test(said[0]), 'playSong says once that songs are not ready yet', said)
  say(/playSong\(\) needs the name of a song file, as in playSong\("tune\.mod"\)/.test(thrown(() => createSound({ sound: { send() {} } }).playSong())), 'playSong with no file says what it needs', null)
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
    s.setVolume(0.8)
  }
  const batches = written(play)
  const cmds = batches.flatMap((b) => b.cmds)
  const text = JSON.stringify(batches)
  say(batches.every((b) => b.synths === 1 && typeof b.now === 'number') && cmds.every((c) => typeof c.op === 'string') && same(JSON.parse(text), batches), `what the functions write is plain data: ${cmds.length} commands that survive being turned into text and back`, null)
  say(same([...new Set(cmds.map((c) => c.op))].sort(), ['master', 'note', 'set', 'sound', 'synth', 'tune', 'voice']), 'with the ops master, note, set, sound, synth, tune and voice', [...new Set(cmds.map((c) => c.op))].sort())
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
