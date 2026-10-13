#!/usr/bin/env node
/**
 * Makes the recordings the examples and tests load, with the library itself, so nothing here is anyone else's:
 *
 *   examples/sounds/tone.wav    a tenth of a second of a 440 Hz sine that loops without a click
 *   examples/sounds/thud.wav    a low drum
 *   examples/sounds/clap.wav    a burst of noise
 *
 *   node scripts/make-example-sounds.mjs
 */
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderSound, toWav } from '../synths.js'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../examples/sounds')
const tone = Float32Array.from({ length: 4410 }, (_, i) => 0.6 * Math.sin(2 * Math.PI * 440 * i / 44100))
await writeFile(join(OUT, 'tone.wav'), toWav(tone, tone, 44100))
const thud = await renderSound((s) => { s.setVolume(2); s.makeSynth('kick', { decay: 0.4, distortion: 0.3 }).play('A1', 0.4) }, { seconds: 0.45, sampleRate: 44100 })
await writeFile(join(OUT, 'thud.wav'), thud.wav())
const clap = await renderSound((s) => { s.setVolume(2); const c = s.makeSynth('snare', { level: 0, cutoff: 1200, decay: 0.2 }); for (const at of [0, 0.012, 0.025]) c.play('C4', 0.2, { at }) }, { seconds: 0.3, sampleRate: 44100 })
await writeFile(join(OUT, 'clap.wav'), clap.wav())
console.log('wrote tone.wav, thud.wav and clap.wav')
