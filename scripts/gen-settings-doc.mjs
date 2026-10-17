#!/usr/bin/env node
/**
 * Writes docs/settings.md: every setting of a synth, by name, from the library's own table of names
 * (synths-names.json), so the page cannot name a setting the library has not got or leave one out.
 * For each setting: its name in JavaScript and in Python, what it holds, where it starts, what it is
 * measured in, and the line that ties a control (dials.js, pydials) to it.
 *
 *   node scripts/gen-settings-doc.mjs           write docs/settings.md (and ../synths-py/docs/settings.md, its copy, when that is beside this)
 *   node scripts/gen-settings-doc.mjs --check   write nothing; exit 1 if the page is out of date
 *
 * The same table writes the help page /docs/synths/settings in Circuitry Studio (scripts/gen-synths-docs.mjs
 * in the Circuitry repository); change what a setting is called here and run both.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const names = JSON.parse(readFileSync(join(root, 'synths-names.json'), 'utf8'))
// The Python library carries the same page (its names are in it), so both are written, and checked.
const outs = [join(root, 'docs', 'settings.md'), join(root, '..', 'synths-py', 'docs', 'settings.md')].filter((file, i) => i === 0 || existsSync(dirname(file)))

const code = (t) => '`' + t + '`'
const number = (n) => String(Math.round(n * 1000) / 1000)
const snake = (name) => name.replace(/(?<=[a-z0-9])([A-Z])/g, '_$1').replace(/[.\s-]+/g, '_').toLowerCase()
const camel = (name) => name.replace(/[._]([a-z0-9])/g, (_m, c) => c.toUpperCase())
const UNITS = { seconds: 'seconds', semitones: 'semitones', hz: 'Hz', cents: 'hundredths of a semitone', voices: 'voices', octaves: 'octaves', bits: 'bits', gain: '1 is as it comes', pan: '-1 is left, 1 is right', db: 'decibels', bpm: 'beats a minute', steps: 'steps', part: 'a part', slot: 'a slot' }
const byName = new Map(names.settings.map((s) => [s.name, s]))

function range(setting, scale) {
  if (setting.kind === 'bool') return '`true` or `false` (`True`, `False`)'
  if (setting.kind === 'choice') return setting.choices.map((c) => code(`"${c}"`)).join(', ')
  return `${number(setting.min / scale)} to ${number(setting.max / scale)}${setting.kind === 'int' || scale !== 1 ? ', whole numbers' : ''}`
}
function start(setting, scale) {
  if (setting.kind === 'bool') return setting.default ? 'on' : 'off'
  if (setting.kind === 'choice') return code(`"${setting.choices[setting.default]}"`)
  return number(setting.default / scale)
}
/** The control that suits a kind of setting, as a line to copy. */
function control(kind, label, name) {
  const target = `lead, "${name}"`
  if (kind === 'choice') return code(`select("${label}", ${target})`)
  if (kind === 'bool') return code(`toggle("${label}", ${target})`)
  return code(`dial("${label}", ${target})`)
}

// The area a setting belongs to, from the engine's own name for it.
const AREAS = [
  ['Oscillators', /^(osc1|osc2|sub|noise|unison|sample|macro)\.|^transpose$/],
  ['Loudness of a note (amplitude envelope)', /^amp\./],
  ['Filter', /^filter(_env)?\./],
  ['Pitch', /^(mod_env|bend|bend_range|tune|glide)\b/],
  ['Vibrato, tremolo, wobble (the two LFOs)', /^lfo[12]\./],
  ['Effects of the synth', /^fx\./],
  ['Sends to the shared effects', /^send\./],
  ['The trance gate', /^gate\./],
  ['The synth as a whole', /^(volume|pan|pan\.law|mode|velocity)$/],
]
const areaOf = (engine) => (AREAS.find(([, re]) => re.test(engine)) || ['Other', null])[0]

// One row for each engine setting, with every plain name it answers to.
const rows = new Map()
for (const [plain, { setting, scale }] of Object.entries(names.names)) {
  const entry = byName.get(setting)
  if (!entry) continue
  const key = `${setting}*${scale}`
  if (!rows.has(key)) rows.set(key, { plain: [], entry, scale })
  rows.get(key).plain.push(plain)
}
const named = new Set(Object.values(names.names).map((n) => n.setting))
for (const entry of names.settings) if (!named.has(entry.name)) rows.set(`${entry.name}*1`, { plain: [], entry, scale: 1 })

const groups = new Map()
for (const row of rows.values()) {
  const area = row.entry.scope === 'all' ? 'Shared by every synth' : areaOf(row.entry.name)
  if (!groups.has(area)) groups.set(area, [])
  groups.get(area).push(row)
}
const order = [...AREAS.map(([a]) => a), 'Other', 'Shared by every synth'].filter((a) => groups.has(a))

function line({ plain, entry, scale }) {
  const first = plain[0] || camel(entry.name)
  const js = plain.length ? plain.map(code).join(' or ') : code(camel(entry.name))
  const py = plain.length ? [...new Set(plain.map(snake))].map(code).join(' or ') : code(snake(entry.name))
  const unit = scale === 12 ? 'octaves' : UNITS[entry.unit] ?? entry.unit
  const ctl = entry.scope === 'all' ? '`set_effects`, not a synth' : control(entry.kind, first, plain[0] || entry.name)
  return `| ${js} | ${py} | ${range(entry, scale)} | ${start(entry, scale)} | ${unit} | ${ctl} |`
}

const tables = order.map((area) => `## ${area}\n\n| JavaScript | Python | Values | Starts at | Measured in | A control for it |\n|---|---|---|---|---|---|\n${groups.get(area).map(line).join('\n')}\n`).join('\n')

const md = `# Every setting of a synth

Every setting a synth has, by name, with the values it takes, where it starts and what it is measured in. It is written from the library's own table of names (\`synths-names.json\`), so it is what the library has. [Settings](../README.md#settings) says what the common ones do.

A setting is a plain property of a synth (\`lead.cutoff = 800\`), a name in \`makeSynth({ cutoff: 800 })\`, and a name a control can be tied to. In Python the same names are written with underscores: \`lead.vibrato_rate\`, \`make_synth(vibrato_rate=6)\`. Either spelling works in both languages.

## Tying a control to a setting

A control from [dials.js](https://github.com/johnwylie70/dials.js) (or [pydials](https://github.com/johnwylie70/pydials) in Python) takes the setting's name and nothing else: it asks the synth for the setting's range, unit and choices (\`lead.describe("cutoff")\`), so the dial is as wide as the setting and shows its unit.

\`\`\`js
dial("cutoff", lead, "cutoff")        // a number: a dial (or slider, or number box)
select("wave", lead, "wave")          // one of a list: a select (or rotary, choose, dropdown)
toggle("sync", lead, "sync")          // on or off: a toggle (or checkbox)
\`\`\`

\`\`\`python
dial("cutoff", lead, "cutoff")
select("wave", lead, "wave")
toggle("sync", lead, "sync")
\`\`\`

Which control suits what:

| The setting is | Use | Notes |
|---|---|---|
| a number in a range | \`dial\`, \`slider\`, \`fader\`, \`number\`, \`wheel\` | The range, unit and start come from the synth. |
| one of a list of words | \`select\`, \`rotary\`, \`choose\`, \`dropdown\`, \`radio\` | The choices come from the synth. |
| on or off | \`toggle\`, \`checkbox\` | |
| two numbers at once | \`xyPad(label, lead, "cutoff", "resonance")\` | One finger sets both. |
| attack, decay, sustain and release | \`envelope(label, lead)\` | Finds the four settings and draws them as one shape. |
| the gate or the arpeggio pattern | \`tranceGate(label, lead)\`, \`arpPattern(label, lead)\` | Each also puts its own settings beside it. |
| something of your own | \`custom(label, { draw, onDown, ... })\` | See [Your own controls](https://github.com/johnwylie70/dials.js#your-own-controls). |

${tables}
## Also see

- [The README](../README.md): what the settings do, with examples.
- [dials.js](https://github.com/johnwylie70/dials.js): every control, and [Targets](https://github.com/johnwylie70/dials.js#targets), how a control is tied to a synth.
- [pydials](https://github.com/johnwylie70/pydials): the same controls for Python.
`
if (process.argv.includes('--check')) {
  for (const out of outs) if (!existsSync(out) || readFileSync(out, 'utf8') !== md) { console.error(`${out} is out of date. Run: node scripts/gen-settings-doc.mjs`); process.exit(1) }
} else for (const out of outs) { writeFileSync(out, md); console.log(`wrote ${out}`) }
