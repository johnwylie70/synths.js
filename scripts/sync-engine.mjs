#!/usr/bin/env node
/**
 * Brings the engine into this package, and keeps what is made from it in step:
 *
 *   synths_core.wasm     the engine, copied from ../synths-core/target/wasm (build it there with scripts/build-wasm.sh)
 *   synths.js            its table of the engine's parameters, between the PARAMS marks, read out of the engine itself
 *   synths-worklet.js    the audio worklet's module, which is text taken from synths.js
 *   synths-names.json    every name a binding in another language needs: settings, friendly names, synths, sounds
 *
 *   node scripts/sync-engine.mjs            copy the engine and write the rest
 *   node scripts/sync-engine.mjs --keep     do not copy; make the rest from the engine already here
 *   node scripts/sync-engine.mjs --check    change nothing; end with code 1 if anything is out of step
 *
 * The built engine is committed, so the package works on a machine with no Rust.
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FROM = resolve(ROOT, '../synths-core/target/wasm/synths_core.wasm')
const WASM = join(ROOT, 'synths_core.wasm')
const check = process.argv.includes('--check')
const keep = check || process.argv.includes('--keep')

if (!keep) {
  if (!existsSync(FROM)) {
    console.error(`There is no ${FROM}. Build the engine first: scripts/build-wasm.sh in synths-core.`)
    process.exit(1)
  }
  await copyFile(FROM, WASM)
}

// Ask the engine for its table.
const module = new WebAssembly.Module(await readFile(WASM))
let memory
const view = () => new DataView(memory.buffer)
const { exports: x } = new WebAssembly.Instance(module, { wasi_snapshot_preview1: {
  fd_write: (fd, iovs, n, written) => { let t = 0; for (let i = 0; i < n; i++) t += view().getUint32(iovs + i * 8 + 4, true); view().setUint32(written, t, true); return 0 },
  environ_sizes_get: (count, size) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0 },
  environ_get: () => 0,
  proc_exit: (code) => { throw new Error(`synths-core stopped (${code})`) },
} })
memory = x.memory
// The first call builds the text and may grow the memory, so the pointer is taken before the memory is looked at.
const tableAt = x.synths_param_table()
const table = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, tableAt, x.synths_param_table_len())))

const rows = table.params.map((p) => '  ' + JSON.stringify([p.id, p.name, p.kind === 'choice' ? 'c' : p.kind[0], p.min, p.max, p.default, p.unit || '', ...(p.choices ? [p.choices] : [])]) + ',')
const block = [
  '/* PARAMS:BEGIN */',
  `const ENGINE = ${JSON.stringify({ abi: table.abi, version: table.version, parts: table.limits.parts, voices: table.limits.voices, samples: table.limits.samples, events: table.events.map((e) => e.name) })}`,
  'const PARAMS = [', ...rows, ']',
  '/* PARAMS:END */',
].join('\n')

let out = 0
async function put(path, text, what) {
  const had = existsSync(path) ? await readFile(path, 'utf8') : null
  if (had === text) return
  out++
  if (check) console.error(`${what} is out of step with the engine. Run: node scripts/sync-engine.mjs --keep`)
  else { await writeFile(path, text); console.log(`wrote ${what}`) }
}

const libPath = join(ROOT, 'synths.js')
const lib = await readFile(libPath, 'utf8')
const marks = /\/\* PARAMS:BEGIN \*\/[\s\S]*?\/\* PARAMS:END \*\//
if (!marks.test(lib)) { console.error('synths.js has lost its PARAMS marks.'); process.exit(1) }
await put(libPath, lib.replace(marks, () => block), 'the parameter table in synths.js')

// The rest is made from the library as it now is (a fresh import, so a table just written is the one read).
const made = await import(pathToFileURL(libPath).href + '?' + Date.now())
await put(join(ROOT, 'synths-worklet.js'), made.workletSource, 'synths-worklet.js')
await put(join(ROOT, 'synths-names.json'), JSON.stringify(made.describe(), null, 1) + '\n', 'synths-names.json')

console.log(`engine ${table.version}, interface ${table.abi}: ${table.params.length} parameters, ${(await readFile(WASM)).length} bytes${out ? '' : ', everything in step'}`)
if (check && out) process.exit(1)
