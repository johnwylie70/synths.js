#!/usr/bin/env node
/**
 * The library in real browsers: does the engine, running in an audio worklet, really put out sound? Each case
 * listens to what comes out, through an AnalyserNode or through a second worklet that keeps every sample (TAP).
 * Covered: a note is heard at its pitch; a scheduled tune is on time to the sample; the engine given as bytes and
 * the worklet from a Blob, with nothing fetched, on a page and inside a frame with no origin and a strict policy
 * (as Circuitry's preview is); sound that waits for the first tap; the fallback on a page that is not served
 * securely; the offline player; and every example.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/test-browser.mjs
 *
 * Chromium, and WebKit when Playwright has it. It ends with code 1 if a case fails.
 */
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PICTURES = resolve(ROOT, '../pictures.js')
const CONTROLS = resolve(ROOT, '../controls.js')
const from = process.env.PLAYWRIGHT || 'playwright'
const playwright = await import(from.startsWith('/') ? pathToFileURL(join(from, 'index.mjs')).href : from)

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.wav': 'audio/wav' }
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/test.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><body><button id="b" style="width:200px;height:100px">tap</button>')
  // pictures.js, for the example that draws: from the repository beside this one.
  const file = path.startsWith('/pictures.js/') ? join(PICTURES, path.slice(13)) : path.startsWith('/controls.js/') ? join(CONTROLS, path.slice(13)) : join(ROOT, path)
  let body
  try { body = await readFile(file) } catch { return res.writeHead(404).end() }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'access-control-allow-origin': '*' }).end(body)
})
await new Promise((done) => server.listen(0, done))
const port = server.address().port
const at = `http://localhost:${port}`

let failed = 0
let count = 0
const say = (ok, engine, what, got) => {
  count++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${engine}: ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`)
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// ONLY=midi runs the MIDI cases alone.
const ONLY = process.env.ONLY

// Helpers every test page is given, as window.T.
const HELPERS = `
window.T = {
  wait: (ms) => new Promise((yes) => setTimeout(yes, ms)),
  // Wait for a player to be there and its sound to be on; give up after five seconds.
  async on(player) {
    for (let i = 0; i < 500; i++) {
      if (player()?.state === 'on') return
      await T.wait(10)
    }
    throw new Error('sound did not come on: the player is ' + (player() ? player().state + ', its worklet said ' + player().workletProblem : 'not made'))
  },
  // Listen to a player: the loudest sample seen over some time, and the loudest pitch.
  async listen(player, ms = 500) {
    const a = player.context.createAnalyser()
    a.fftSize = 8192
    player.node.connect(a)
    const data = new Float32Array(a.fftSize)
    let peak = 0
    for (const until = performance.now() + ms; performance.now() < until;) {
      a.getFloatTimeDomainData(data)
      for (const v of data) peak = Math.max(peak, Math.abs(v))
      await T.wait(20)
    }
    const bins = new Float32Array(a.frequencyBinCount)
    a.getFloatFrequencyData(bins)
    let best = 0
    for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i
    return { peak, hz: best * player.context.sampleRate / a.fftSize }
  },
  // TAP: a second worklet after the player's that keeps every sample it is given, so timing can be read exactly.
  async tap(player) {
    const src = 'registerProcessor("tap", class extends AudioWorkletProcessor { constructor() { super(); this.port.onmessage = () => this.port.postMessage("end") } process(i) { if (i[0] && i[0][0]) this.port.postMessage(i[0][0].slice()); return true } })'
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    await player.context.audioWorklet.addModule(url)
    const node = new AudioWorkletNode(player.context, 'tap', { numberOfInputs: 1, numberOfOutputs: 1 })
    const blocks = []
    let done
    node.port.onmessage = (m) => (m.data === 'end' ? done() : blocks.push(m.data))
    player.node.connect(node)
    node.connect(player.context.destination)
    return { async samples() { await new Promise((yes) => { done = yes; node.port.postMessage('end') }); const all = new Float32Array(blocks.length * 128); blocks.forEach((b, i) => all.set(b, i * 128)); return all } }
  },
  // The frames where sound begins after silence.
  onsets(a, quiet = 200, over = 1e-4) {
    const found = []
    let silent = quiet
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i]) > over) { if (silent >= quiet) found.push(i); silent = 0 } else silent++
    }
    return found
  },
  CLICK: { wave: 'sine', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0 },
}
`

async function fresh(page, path = '/test.html') {
  await page.goto(at + path)
  await page.evaluate(HELPERS)
}

/**
 * PLAYWRIGHT AND WORKLETS. Playwright (1.55) asks every new thread of a Chromium page to wait until it has been
 * looked at, then lets workers go on and forgets about worklets: an audio worklet never starts and addModule()
 * never answers (measured 2026-10-13 with Chromium 140 and Chrome 155; the same Chrome started by hand is fine).
 * This is a second DevTools session on the page that tells each worklet to go on, in the page and in its frames.
 * It has nothing to do with the library, and WebKit needs none of it.
 */
async function letWorkletsRun(page) {
  const cdp = await page.context().newCDPSession(page)
  let id = 0
  // `path` is the chain of sessions from the page down to a frame inside it.
  const send = (path, method, params = {}) => {
    let message = { method, params }
    for (let i = path.length - 1; i >= 0; i--) message = { method: 'Target.sendMessageToTarget', params: { sessionId: path[i], message: JSON.stringify({ id: ++id, ...message }) } }
    return cdp.send(message.method, message.params).catch(() => {})
  }
  const seen = (path, method, params) => {
    if (method === 'Target.attachedToTarget') {
      const child = [...path, params.sessionId]
      if (params.targetInfo.type === 'worklet') send(child, 'Runtime.runIfWaitingForDebugger')
      else send(child, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false })
    } else if (method === 'Target.receivedMessageFromTarget') {
      const inner = JSON.parse(params.message)
      if (inner.method) seen([...path, params.sessionId], inner.method, inner.params)
    }
  }
  cdp.on('Target.attachedToTarget', (params) => seen([], 'Target.attachedToTarget', params))
  cdp.on('Target.receivedMessageFromTarget', (params) => seen([], 'Target.receivedMessageFromTarget', params))
  await send([], 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false })
}

/** The cases that run with sound allowed from the start. */
async function withSound(name, browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (name === 'chromium') await letWorkletsRun(page)
  const said = []
  page.on('console', (m) => said.push(m.text()))
  page.on('pageerror', (e) => said.push('ERROR ' + e.message))
  const requests = []
  page.on('request', (r) => requests.push(r.url()))

  // --- a note is heard, from the worklet
  await fresh(page)
  let got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound()
    const synth = s.makeSynth(T.CLICK)
    synth.start('A4')
    await T.on(() => s.player)
    const heard = await T.listen(s.player, 400)
    const state = await s.player.ask()
    s.stopSound()
    await T.wait(200)
    const after = await T.listen(s.player, 100)
    return { kind: s.player.kind, worklet: s.player.worklet, heard, voices: state.voices, after: after.peak, secure: isSecureContext, rate: s.player.context.sampleRate }
  })
  say(got.kind === 'worklet' && got.heard.peak > 0.2 && Math.abs(got.heard.hz - 440) < 8 && got.voices === 1, name, `a note from the audio worklet is heard: A4 comes out at ${Math.round(got.heard?.hz)} Hz, peak ${got.heard?.peak.toFixed(2)}, 1 voice`, got)
  say(got.after === 0, name, 'stopSound() leaves silence', got.after)
  say(got.worklet === 'blob' && requests.some((r) => r.endsWith('/synths_core.wasm')) && !requests.some((r) => r.endsWith('/synths-worklet.js')), name, 'by default the engine is fetched from beside the library and the worklet comes from a Blob, with no second file', { worklet: got.worklet, requests })

  // --- reading the sound back for a scope, a meter and lit keys: it arrives from the audio thread without being waited for
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound()
    const synth = s.makeSynth(T.CLICK)
    const other = s.makeSynth(T.CLICK)
    s.flush()
    await T.on(() => s.player)
    const before = [synth.samples().length, synth.level(), synth.notes()]
    synth.noteOn(69)
    synth.noteOn(72)
    let reads = 0
    const began = performance.now()
    while (synth.notes().length < 2 && performance.now() - began < 2000) { reads++; await T.wait(16) }
    const took = performance.now() - began
    other.samples()                        // the first read of anything asks for it; the answer comes a moment later
    s.soundOutput().samples()
    await T.wait(150)
    const wave = synth.samples()
    let crossings = 0
    for (let i = 1; i < wave.length; i++) if (wave[i - 1] < 0 && wave[i] >= 0) crossings++
    const first = { n: wave.length, peak: Math.max(...wave), level: synth.level(), notes: synth.notes(), other: [Math.max(0, ...other.samples()), other.notes()], out: [s.soundOutput().notes(), s.soundOutput().level()[0] > 0.05] }
    const slow = performance.now()
    for (let i = 0; i < 10000; i++) synth.samples()
    const cost = performance.now() - slow
    synth.noteOff(69)
    synth.noteOff(72)
    await T.wait(300)
    return { before, took, first, cost, after: [synth.notes(), Math.max(...synth.samples()), synth.level()[0]] }
  })
  say(JSON.stringify(got.before) === '[0,[0,0],[]]' && got.first.n === 1024 && got.first.peak > 0.2 && got.first.peak <= 1 && got.first.level[0] > 0.1 && JSON.stringify(got.first.notes) === '[69,72]' && got.took < 500, name,
    `samples(), level() and notes() of a synth come from the worklet: 1024 samples, its level, and the keys 69 and 72, ${Math.round(got.took)} ms after the keys went down`, got)
  say(JSON.stringify(got.first.other) === '[0,[]]' && JSON.stringify(got.first.out) === '[[69,72],true]' && JSON.stringify(got.after[0]) === '[]' && got.after[1] === 0 && got.after[2] < got.first.level[0] * 0.8, name, 'another synth reads silent, soundOutput() reads everything, and after noteOff the keys are dark, the wave is flat and the level is falling', got)
  say(got.cost < 100, name, `reading never waits for the audio thread: 10000 reads take ${got.cost.toFixed(1)} ms`, got.cost)

  // --- several scenes on a page share one player
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const a = createSound(), b = createSound(), c = createSound()
    const low = a.makeSynth(T.CLICK), high = b.makeSynth(T.CLICK)
    c.makeSynth(T.CLICK)
    a.flush(); b.flush(); c.flush()
    await T.on(() => a.player)
    low.start('A3'); high.start('A5')
    high.notes(); low.notes()
    await T.wait(300)
    const one = a.player === b.player && b.player === c.player
    const notes = [low.notes(), high.notes()]
    a.stopSound()
    await T.wait(300)
    const after = [low.notes(), high.notes()]
    b.pause(); a.pause(); c.pause()
    await T.wait(200)
    const rested = a.player.context.state
    b.resume()
    await T.wait(200)
    const woke = [b.player.context.state, (await T.listen(b.player, 200)).peak > 0.1]
    a.close(); b.close()
    const still = c.player.state
    c.close()
    return { one, notes, after, rested, woke, still, end: a.player.state }
  })
  say(got.one && JSON.stringify([got.notes, got.after]) === '[[[57],[81]],[[],[81]]]' && got.rested === 'suspended' && JSON.stringify(got.woke) === '["running",true]' && got.still === 'on' && got.end === 'closed', name,
    'three createSound() on a page share one player and one sound card: each stops alone, the sound card rests when all are paused, and the player closes when the last one does', got)

  // --- an arpeggio in the worklet
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound()
    const synth = s.makeSynth(T.CLICK)
    s.flush()
    await T.on(() => s.player)
    const tap = await T.tap(s.player)
    await T.wait(100)
    synth.arp('A3', 'octave', 0.4, { speed: 10 })
    await T.wait(700)
    const all = await tap.samples()
    const rate = s.player.context.sampleRate
    const from = T.onsets(all)[0]
    const hz = (a, b) => { let n = 0; for (let i = from + Math.round(a * rate) + 1; i < from + Math.round(b * rate); i++) if (all[i - 1] < 0 && all[i] >= 0) n++; return n / (b - a) }
    return { voices: 1, steps: [hz(0.01, 0.09), hz(0.11, 0.19), hz(0.21, 0.29), hz(0.31, 0.39)], onsets: T.onsets(all).length }
  })
  say(got.onsets === 1 && got.steps.every((hz, i) => Math.abs(hz - (i % 2 ? 440 : 220)) < 15), name, 'an arpeggio runs inside the engine: one note stepping between A3 and A4 ten times a second', got)

  // --- the plain functions of the page, and the worklet from its file
  await fresh(page)
  got = await page.evaluate(async () => {
    const synths = await import('/synths.js')
    synths.configure({ worklet: 'file' })
    synths.playNotes('C4 E4 G4', 0.1, { repeat: true })
    await T.on(() => synths.soundPlayer())
    const heard = await T.listen(synths.soundPlayer(), 300)
    synths.stopSound()
    return { heard, kind: synths.soundPlayer().kind, worklet: synths.soundPlayer().worklet }
  })
  say(got.kind === 'worklet' && got.worklet === 'file' && got.heard.peak > 0.05, name, 'playNotes straight from the module plays, with the worklet loaded from synths-worklet.js', got)

  // --- timing, read from every sample the worklet puts out
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound({ latency: 0.05 })
    const synth = s.makeSynth(T.CLICK)
    await T.on(() => s.player)
    const tap = await T.tap(s.player)
    await T.wait(100)
    const rate = s.player.context.sampleRate
    // Eight notes asked for one by one from the page, a tenth of a second apart, each a little way ahead.
    const t0 = s.soundTime() + 0.1
    for (let i = 0; i < 8; i++) synth.play('A5', 0.02, { at: t0 + i * 0.1 })
    s.flush()
    // And the page is kept busy while they play, as a slow frame of a game would keep it. (One turn first:
    // WebKit hands a message to the worklet only when the page's thread is next free.)
    await T.wait(30)
    for (const until = performance.now() + 500; performance.now() < until;) { /* busy */ }
    await T.wait(600)
    const first = T.onsets(await tap.samples())
    // A tune, which the engine's own thread repeats.
    const tap2 = await T.tap(s.player)
    const tune = synth.playNotes('A5 A5 A5 A5', 0.125, { repeat: 2, hold: 0.2 })
    await T.wait(1300)
    const second = T.onsets(await tap2.samples())
    return { rate, gaps: first.slice(1).map((f, i) => f - first[i]), tune: second.slice(1).map((f, i) => f - second[i]) }
  })
  const step = got.rate / 10
  say(got.gaps.length === 7 && got.gaps.every((g) => Math.abs(g - step) <= 1), name, `eight notes scheduled a tenth of a second apart from a busy page come out ${step} frames apart, to the sample`, got.gaps)
  say(got.tune.length === 7 && got.tune.every((g) => Math.abs(g - got.rate / 8) < 1), name, `a repeating tune's notes are ${got.rate / 8} frames apart to the sample, eight in a row`, got.tune)

  // --- a one-shot asked for with no time is not late by more than the latency and a block or two
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound()
    const synth = s.makeSynth(T.CLICK)
    await T.on(() => s.player)
    await T.wait(100)
    const before = await s.player.ask()
    const asked = performance.now()
    synth.start('A4')
    let waited = 0
    while ((await s.player.ask()).voices === 0 && waited < 1000) { await T.wait(5); waited = performance.now() - asked }
    return { waited, before: before.voices }
  })
  say(got.before === 0 && got.waited < 150, name, `a note asked for now is sounding ${Math.round(got.waited)} ms later (0.04 seconds of that is on purpose)`, got)

  // --- the engine as bytes, the worklet from a Blob: nothing fetched for sound
  await fresh(page)
  const bytes = [...await readFile(join(ROOT, 'synths_core.wasm'))]
  requests.length = 0
  got = await page.evaluate(async (bytes) => {
    const { createSound } = await import('/synths.js')
    const s = createSound({ wasm: new Uint8Array(bytes), worklet: 'blob' })
    s.makeSynth(T.CLICK).start('A4')
    await T.on(() => s.player)
    return { heard: await T.listen(s.player, 300), kind: s.player.kind }
  }, bytes)
  say(got.kind === 'worklet' && got.heard.peak > 0.2 && !requests.some((r) => /wasm|worklet/.test(r)), name, 'given the engine as bytes it plays from the worklet with nothing fetched', { got, requests })

  // --- inside a frame with no origin and Circuitry's policy: the library is imported, the engine arrives as bytes
  const inFrame = (worklet) => page.evaluate(async ({ bytes, at, helpers, worklet }) => {
    const policy = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${at}/synths.js ${at}/synths-worklet.js; connect-src blob:; worker-src blob:; frame-src 'none'`
    const inner = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><body><script type="module">
      ${helpers}
      addEventListener('message', async (m) => {
        const say = (what) => parent.postMessage(what, '*')
        try {
          const { createSound } = await import('${at}/synths.js')
          const s = createSound({ wasm: m.data, worklet: '${worklet}' })
          const synth = s.makeSynth(T.CLICK)
          s.flush()
          const waited = s.player.context.state !== 'running'
          await T.on(() => s.player)
          synth.start('A4')
          say({ state: 'on', waited, kind: s.player.kind, worklet: s.player.worklet, problem: s.player.workletProblem, heard: await T.listen(s.player, 300), origin, secure: isSecureContext })
        } catch (e) { say({ error: String(e) }) }
      })
      parent.postMessage('ready', '*')
    <\/script>`
    const frame = document.createElement('iframe')
    frame.sandbox = 'allow-scripts'
    frame.allow = 'autoplay'
    frame.srcdoc = inner
    const answer = new Promise((yes) => addEventListener('message', (m) => {
      if (m.source !== frame.contentWindow) return
      if (m.data === 'ready') frame.contentWindow.postMessage(new Uint8Array(bytes), '*')
      else yes(m.data)
    }))
    document.body.append(frame)
    return Promise.race([answer, T.wait(9000).then(() => ({ error: 'the frame did not answer' }))])
  }, { bytes, at, helpers: HELPERS, worklet })
  // A frame of another origin has to be tapped itself before it may make sound (WebKit holds to this even here).
  const tapped = async (answer) => {
    await page.waitForTimeout(700)
    await page.locator('iframe').click({ position: { x: 40, y: 40 } })
    return answer
  }
  await fresh(page)
  requests.length = 0
  got = await tapped(inFrame('auto'))
  say(got.state === 'on' && got.kind === 'worklet' && got.origin === 'null' && got.heard?.peak > 0.2 && !requests.some((r) => /wasm/.test(r)), name,
    `in a sandboxed frame with no origin and a strict policy the engine arrives as bytes and a note is heard from the worklet, loaded from ${got.worklet === 'blob' ? 'a Blob' : `its file (a Blob was refused: ${got.problem})`}${got.waited ? ', after a tap in the frame' : ''}`, { got, requests: requests.filter((r) => /wasm|worklet/.test(r)) })
  await fresh(page)
  requests.length = 0
  got = await tapped(inFrame('blob'))
  say(got.state === 'on' && got.heard?.peak > 0.2 && !requests.some((r) => /wasm|worklet/.test(r)) && (got.kind === 'worklet' || got.kind === 'fallback'), name,
    `the same frame allowed nothing but the Blob, so nothing is fetched at all: a note is heard from the ${got.kind === 'worklet' ? 'worklet' : `fallback (the worklet was refused: ${got.problem})`}`, { got, requests: requests.filter((r) => /wasm|worklet/.test(r)) })

  // --- the fallback, asked for: the same engine on the page's thread
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound({ fallback: 'always', latency: 0.08 })
    const synth = s.makeSynth(T.CLICK)
    await T.on(() => s.player)
    const tap = await T.tap(s.player)
    await T.wait(100)
    const t0 = s.soundTime() + 0.1
    for (let i = 0; i < 5; i++) synth.play('A4', 0.02, { at: t0 + i * 0.1 })
    await T.wait(900)
    const on = T.onsets(await tap.samples())
    synth.start('A4')
    return { kind: s.player.kind, rate: s.player.context.sampleRate, gaps: on.slice(1).map((f, i) => f - on[i]), heard: await T.listen(s.player, 300) }
  })
  say(got.kind === 'fallback' && got.heard.peak > 0.2 && Math.abs(got.heard.hz - 440) < 8 && got.gaps.length === 4 && got.gaps.every((g) => Math.abs(g - got.rate / 10) <= 1), name,
    'the fallback (a ScriptProcessorNode running the same engine on the page\'s thread) plays the same note, and its scheduled notes are as exact', got)

  // --- the offline player, in the browser
  await fresh(page)
  got = await page.evaluate(async () => {
    const { renderSound } = await import('/synths.js')
    const r = await renderSound((s) => { s.makeSynth(T.CLICK).playNotes('A4 A4 A4', 0.25, { hold: 0.2 }); s.playSound('coin', { at: 1 }) }, { seconds: 2 })
    const wav = r.wav()
    // The browser's own decoder reads the file back.
    const buffer = await new AudioContext().decodeAudioData(wav.buffer.slice(0))
    return { onsets: T.onsets(r.left), frames: r.left.length, decoded: [buffer.duration, buffer.numberOfChannels, buffer.sampleRate], wav: wav.length }
  })
  say(JSON.stringify(got.onsets.slice(0, 3)) === '[1,12001,24001]' || JSON.stringify(got.onsets.slice(0, 3)) === '[0,12000,24000]', name, 'renderSound in the browser: three notes a quarter of a second apart begin on frames 0, 12000 and 24000', got.onsets)
  say(got.onsets.length === 4 && Math.abs(got.onsets[3] - 48000) <= 1 && Math.abs(got.decoded[0] - 2) < 0.001 && got.decoded[1] === 2, name, 'and its WAV file, with a coin at one second, is one the browser itself can decode: 2 seconds, stereo', got)

  // --- a sample from a file: fetched, decoded and played
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound()
    const tone = s.loadSample('/examples/sounds/tone.wav', { loop: true })
    tone.play(null, 5)
    await T.on(() => s.player)
    await T.wait(300)
    tone.play(null, 5)
    return T.listen(s.player, 400)
  })
  say(got.peak > 0.1 && Math.abs(got.hz - 440) < 8, name, `loadSample fetches a WAV file and plays it: ${Math.round(got.hz)} Hz`, got)

  const errors = said.filter((t) => /ERROR|could not|no sound/.test(t) && !/cannot run sound on its own thread|Cross-Origin/.test(t))
  say(errors.length === 0, name, 'nothing went wrong in the console along the way', errors)
  await context.close()
}

/** Every example plays without an error. */
async function examples(name, browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (name === 'chromium') await letWorkletsRun(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' || /synths\.js: .*(could not|no sound)/.test(m.text())) errors.push(m.text()) })
  const files = (await readdir(join(ROOT, 'examples'))).filter((f) => f.endsWith('.js')).sort()
  let heard = 0
  const silent = []
  for (const file of files) {
    const source = await readFile(join(ROOT, 'examples', file), 'utf8')
    const scene = source.includes('await use(')
    if (scene && !(existsSync(join(PICTURES, 'pictures.js')) && (!source.includes('controls.js') || existsSync(join(CONTROLS, 'controls.js'))))) { console.log(`     ${name}: ${file} needs pictures.js (and controls.js) beside this repository, skipped`); continue }
    await page.goto(`${at}/examples/index.html?run=${file}${scene ? '&pictures=/pictures.js/pictures.js' : ''}`)
    await page.evaluate(HELPERS)
    // A press that is held and moved, as a person would: the theremin sounds only while something is pressed.
    await page.mouse.move(300, 300)
    await page.mouse.down()
    await page.mouse.move(320, 280)
    const ready = await page.evaluate(async () => {
      for (let i = 0; i < 300 && !window.examplePlayer?.(); i++) await T.wait(10)
      const player = window.examplePlayer?.()
      for (let i = 0; player && i < 300 && player.state !== 'on'; i++) await T.wait(10)
      await T.wait(200)
      return !!player
    })
    await page.keyboard.down('a')            // a white key of the synth panel's keyboard, once the panel is there
    const got = ready ? await page.evaluate(() => T.listen(window.examplePlayer(), 1500)) : { peak: 0, why: 'no sound was asked for' }
    await page.mouse.up()
    await page.keyboard.up('a')
    if (got.peak > 0.01) heard++
    else silent.push([file, got])
  }
  say(silent.length === 0 && errors.length === 0 && heard >= 7, name, `all ${heard} examples are heard, with no error`, { silent, errors })
  await context.close()
}

/**
 * Sound that has to wait for the first tap. Browsers keep a page silent until the person has touched it, but the
 * browsers Playwright starts let any page play (headless Chromium and WebKit both do; only WebKit's frame of
 * another origin, tested above, really waits). So here the rule is put back by hand where the browser has dropped
 * it: RULE makes an AudioContext that will not start until the page has been touched, which is what a browser's
 * own rule does, and gives it to the library. What is tested is the library's side: waiting, saying so, and starting.
 */
const RULE = `
window.ruled = async (synths) => {
  const context = new AudioContext()
  // Does the browser let this page start sound with no tap? (WebKit's context begins suspended either way.)
  await Promise.race([context.resume(), T.wait(300)])
  if (context.state === 'running') {
    await context.suspend()
    let touched = false
    for (const g of ['pointerdown', 'keydown']) addEventListener(g, () => { touched = true }, true)
    const resume = context.resume.bind(context)
    context.resume = () => (touched ? resume() : new Promise(() => {}))
    window.ruleByHand = true
  }
  synths.configure({ context })
  window.synths = synths
}
`
async function waitingForATap(name, browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (name === 'chromium') await letWorkletsRun(page)
  const said = []
  page.on('console', (m) => said.push(m.text()))
  const begin = async () => { await fresh(page); await page.evaluate(RULE) }
  await begin()
  let got = await page.evaluate(async () => {
    const synths = await import('/synths.js')
    await ruled(synths)
    // Asked for before any tap: a long note and a sound effect.
    synths.makeSynth(T.CLICK).play('A4', 30)
    synths.playSound('explosion')
    await T.wait(1500)
    const player = synths.soundPlayer()
    return { state: player.state, context: player.context.state, voices: (await player.ask()).voices, byHand: !!window.ruleByHand }
  })
  const how = got.byHand ? 'the rule put back by hand' : 'the browser\'s own rule'
  const waiting = said.filter((t) => /sound is waiting for a tap/.test(t))
  say(got.state === 'waiting' && got.voices === 0, name, `before any tap the player is waiting, and silent (${how})`, got)
  say(waiting.length === 1, name, 'and the console says once that sound is waiting for a tap', said)
  await page.click('#b')
  got = await page.evaluate(async () => {
    const player = window.synths.soundPlayer()
    await player.ready
    await T.wait(200)
    const voices = (await player.ask()).voices
    const heard = await T.listen(player, 300)
    return { state: player.state, voices, peak: heard.peak }
  })
  say(got.state === 'on' && got.voices === 0 && got.peak === 0, name, 'the tap turns sound on, and the note and the sound effect asked for long before it are not played late', got)
  got = await page.evaluate(async () => {
    window.synths.playSound('coin')
    await T.wait(60)
    return T.listen(window.synths.soundPlayer(), 300)
  })
  say(got.peak > 0.05, name, 'a sound asked for after the tap is heard', got)

  // A tune asked for before the tap starts when the tap comes.
  await begin()
  got = await page.evaluate(async () => {
    const synths = await import('/synths.js')
    await ruled(synths)
    const lead = synths.makeSynth('lead', { cutoff: 900 })
    lead.playNotes('C4 E4 G4 E4', 0.1, { repeat: true })
    lead.volume = 0.5
    await T.wait(1000)
    return { state: synths.soundPlayer().state }
  })
  await page.keyboard.press('a')
  const after = await page.evaluate(async () => {
    const player = window.synths.soundPlayer()
    await player.ready
    return { state: player.state, heard: await T.listen(player, 500) }
  })
  say(got.state === 'waiting' && after.state === 'on' && after.heard.peak > 0.05, name, 'a tune asked for before the first key press starts when the key is pressed', { got, after })

  // The sound the first tap itself asks for is heard: with a player that has been waiting, and with none made yet.
  for (const early of [true, false]) {
    await begin()
    await page.evaluate(async (early) => {
      const synths = await import('/synths.js')
      await ruled(synths)
      const synth = early ? synths.makeSynth(T.CLICK) : null
      document.getElementById('b').onclick = () => (synth || synths.makeSynth(T.CLICK)).start('A4')
      await T.wait(early ? 1200 : 100)
    }, early)
    await page.click('#b')
    got = await page.evaluate(async () => {
      await T.on(() => window.synths.soundPlayer())
      const heard = await T.listen(window.synths.soundPlayer(), 400)
      return { voices: (await window.synths.soundPlayer().ask()).voices, heard }
    })
    say(got.voices === 1 && got.heard.peak > 0.2, name, `the note that the first tap itself asks for is heard, ${early ? 'when sound had been waiting for that tap' : 'when that note is the first sound the page asks for'}`, got)
  }
  await context.close()
}

/** A page that is not served securely has no audio worklet: the fallback takes over and says so. */
async function notSecure(name, browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (name === 'chromium') await letWorkletsRun(page)
  const said = []
  page.on('console', (m) => said.push(m.text()))
  await page.goto(`http://plain.test:${port}/test.html`)
  await page.evaluate(HELPERS)
  const got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound()
    s.makeSynth(T.CLICK).start('A4')
    s.flush()
    for (let i = 0; i < 300 && s.player.state !== 'on'; i++) await T.wait(10)
    // No worklet here, so listen with an analyser alone.
    return { secure: isSecureContext, worklet: 'audioWorklet' in s.player.context, kind: s.player.kind, state: s.player.state, heard: await T.listen(s.player, 400) }
  })
  say(got.secure === false && got.worklet === false && got.kind === 'fallback' && got.heard.peak > 0.2 && Math.abs(got.heard.hz - 440) < 8, name, 'on a page that is not served securely there is no audio worklet, and the fallback plays the note', got)
  say(said.filter((t) => /cannot run sound on its own thread \(that needs an https address, or localhost\)/.test(t)).length === 1, name, 'and the console says so once, with what it needs', said)
  const refused = await page.evaluate(async () => {
    const { createPlayer } = await import('/synths.js')
    const player = createPlayer({ fallback: false })
    for (let i = 0; i < 200 && player.state === 'loading'; i++) await T.wait(10)
    return player.state
  })
  say(refused === 'failed' && said.some((t) => /the sound engine could not start, so there will be no sound \(this page has no audio worklet: it needs an https address, or localhost\)/.test(t)), name, 'with the fallback refused it reports plainly that there will be no sound, and why', { refused, said })
  await context.close()
}

/**
 * MIDI in a real browser. There is no MIDI device here, so three things are looked at: the file is not fetched
 * until MIDI is used; the browser's own Web MIDI is asked and answers (Chromium, with the permission given), or is
 * said plainly not to exist (WebKit); and with a pretend transport in place of the devices, a key plays the synth
 * through the real worklet and what is sent carries exact times.
 */
async function midi(name, browser) {
  const context = await browser.newContext(name === 'chromium' ? { permissions: ['midi', 'midi-sysex'] } : {})
  const page = await context.newPage()
  if (name === 'chromium') await letWorkletsRun(page)
  const said = []
  page.on('console', (m) => said.push(m.text()))
  page.on('pageerror', (e) => said.push('ERROR ' + e.message))
  const requests = []
  page.on('request', (r) => requests.push(r.url()))

  await fresh(page)
  let got = await page.evaluate(async () => {
    const synths = await import('/synths.js')
    synths.playNote('A4', 0.3)
    synths.stopMidi()
    await T.on(() => synths.soundPlayer())
    const before = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('synths-midi')).length
    const has = typeof navigator.requestMIDIAccess === 'function'
    // The first MIDI function: the file is fetched and the browser is asked.
    const lists = []
    const now = synths.midiDevices()
    synths.onMidiDevices((d) => lists.push(d))
    const lead = synths.makeSynth(T.CLICK).playFromMidi()
    synths.onMidiNote(() => {})
    // NOTHING IS SENT where the browser has Web MIDI: the machine running this may have real devices plugged in
    // (the one this was written on has three), and a test must not play them. Where there is none, everything is tried.
    if (!has) {
      lead.sendToMidi()
      synths.sendMidiNote('C4', 0.8, { length: 0.1 })
      synths.sendMidiClock()
    }
    for (let i = 0; i < 300 && !lists.length; i++) await T.wait(10)
    lead.play('A4', 0.2)
    if (!has) synths.sendMidiControl(74, 0.5)
    const heard = await T.listen(synths.soundPlayer(), 300)
    if (!has) synths.sendMidiClock(false)
    synths.stopMidi()
    await T.wait(100)
    return { before, has, now, lists, heard: heard.peak, after: synths.midiDevices() }
  })
  const fetched = requests.filter((r) => r.endsWith('/synths-midi.js')).length
  say(got.before === 0 && fetched === 1, name, 'synths-midi.js is not fetched until a MIDI function is used, and then once', { before: got.before, fetched })
  const about = said.filter((t) => /MIDI/.test(t))
  if (got.has) {
    say(got.lists.length === 1 && got.lists[0].available === true && Array.isArray(got.lists[0].inputs) && got.after.available === true && about.length === 0, name,
      `the browser's own Web MIDI is asked when MIDI is first used and answers: ${got.lists[0]?.inputs.length} inputs, ${got.lists[0]?.outputs.length} outputs, and nothing is said`, { got, about })
  } else {
    say(got.lists.length === 1 && got.lists[0].available === false && got.lists[0].inputs.length === 0 && about.length === 1 && /MIDI is not available in this browser\. Use Chrome, Edge or Firefox on a computer/.test(about[0]), name,
      'this browser has no Web MIDI: one plain message says so, midiDevices() is empty and nothing throws', { got, about })
  }
  say(same(got.now, { inputs: [], outputs: [], available: null }) && got.heard > 0.1, name, 'midiDevices() answers at once (nothing known yet), and the sound plays whatever MIDI does', got)

  // --- a pretend transport in place of the devices, and the real player
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const sent = []
    let play = null
    const pretend = { inputs: () => ['Keys'], outputs: () => ['Box'], send: (bytes, time, output) => sent.push([[...bytes], time, performance.now()]), receive: (listener) => { play = listener } }
    const s = createSound({ midi: pretend, share: false })
    const lead = s.makeSynth(T.CLICK).playFromMidi()
    const messages = []
    s.onMidi((m) => messages.push(m))
    await T.on(() => s.player)
    for (let i = 0; i < 300 && !play; i++) await T.wait(10)
    const silent = await T.listen(s.player, 100)
    // A key goes down on the pretend keyboard.
    const pressed = s.soundTime()
    play([0x90, 69, 127], performance.now(), 'Keys')
    const heard = await T.listen(s.player, 400)
    play([0x80, 69, 0], performance.now(), 'Keys')
    await T.wait(200)
    const after = await T.listen(s.player, 100)
    // A short sequence out: four notes a tenth of a second apart, asked for all at once.
    const asked = performance.now()
    const from = s.soundTime()
    for (let i = 0; i < 4; i++) s.sendMidiNote(60 + i, 0.8, { length: 0.05, at: from + i * 0.1 })
    await T.wait(700)
    const ons = sent.filter((m) => m[0][0] === 0x90)
    const offs = sent.filter((m) => m[0][0] === 0x80)
    s.close()
    const note = messages.find((m) => m.type === 'noteOn')
    return { silent: silent.peak, heard, after: after.peak, note, late: note && note.time - pressed, types: messages.map((m) => m.type),
      gaps: ons.slice(1).map((m, i) => m[1] - ons[i][1]), lengths: ons.map((m, i) => offs[i][1] - m[1]), first: ons[0] && ons[0][1] - asked, ahead: ons.map((m) => m[1] - m[2]), notes: ons.map((m) => m[0][1]) }
  })
  say(got.silent === 0 && got.heard.peak > 0.2 && Math.abs(got.heard.hz - 440) < 8 && got.after === 0, name, `a key on a MIDI keyboard plays the synth through the worklet (${Math.round(got.heard?.hz)} Hz) and letting go stops it`, got)
  say(got.note?.type === 'noteOn' && got.note.note === 69 && got.note.device === 'Keys' && Math.abs(got.late) < 0.02 && same(got.types, ['devices', 'noteOn', 'noteOff']), name, 'the program is told too, with the time of the key on its own sound clock', got)
  say(same(got.notes, [60, 61, 62, 63]) && got.gaps.every((g) => Math.abs(g - 100) < 0.001) && got.lengths.every((l) => Math.abs(l - 50) < 0.001) && got.first > 30 && got.first < 60, name,
    `notes sent out carry exact times: 100 ms apart to a thousandth of a millisecond, however the page's timers run, beginning ${got.first?.toFixed(1)} ms after they were asked for`, got)
  say(got.ahead.every((a) => a > -5 && a < 200), name, 'each is handed to the device a moment before it is due, so that stopSound can still take the rest back', got.ahead)

  const errors = said.filter((t) => /ERROR|could not/.test(t))
  say(errors.length === 0, name, 'nothing went wrong in the console along the way', errors)
  await context.close()

  if (name === 'chromium') {
    // With the permission not given, what does Chromium do? (A headless browser cannot show the question.)
    const denied = await browser.newContext()
    const second = await denied.newPage()
    const told = []
    second.on('console', (m) => told.push(m.text()))
    await fresh(second)
    const answer = await second.evaluate(async () => {
      const synths = await import('/synths.js')
      let devices = null
      synths.onMidiDevices((d) => { devices = d })
      for (let i = 0; i < 300 && !devices; i++) await T.wait(10)
      return devices
    })
    const about = told.filter((t) => /MIDI/.test(t))
    if (answer) say(answer.available || (about.length === 1 && /MIDI was not allowed for this page/.test(about[0])), name, `with no permission given beforehand Web MIDI is ${answer.available ? 'allowed anyway by this browser' : 'refused, and one plain message says how to allow it'}`, { answer, about })
    else console.log(`     ${name}: with no permission given beforehand the browser's question is never answered here, so nothing is said and nothing fails`)
    await denied.close()
  }
}

const ALLOWED = { chromium: { args: ['--autoplay-policy=no-user-gesture-required'] }, webkit: {} }
for (const name of ['chromium', 'webkit']) {
  let browser
  try { browser = await playwright[name].launch(ALLOWED[name]) } catch { console.log(`${name}: not installed, skipped`); continue }
  try {
    if (!ONLY) await withSound(name, browser)
    if (!ONLY) await examples(name, browser)
    if (!ONLY || ONLY === 'midi') await midi(name, browser)
  } catch (e) { say(false, name, 'the tests ran to the end', String(e?.stack || e)) }
  await browser.close()

  browser = await playwright[name].launch(ALLOWED[name])
  try { if (!ONLY) await waitingForATap(name, browser) } catch (e) { say(false, name, 'the tap tests ran to the end', String(e?.stack || e)) }
  await browser.close()

  if (name === 'chromium' && !ONLY) {
    // A name that is not localhost, pointed at this machine: the same page, not a secure context.
    browser = await playwright[name].launch({ args: [...ALLOWED[name].args, `--host-resolver-rules=MAP plain.test 127.0.0.1`] })
    try { await notSecure(name, browser) } catch (e) { say(false, name, 'the not-secure tests ran to the end', String(e?.stack || e)) }
    await browser.close()
  }
}

server.close()
console.log(`${count - failed} of ${count} passed`)
process.exit(failed ? 1 : 0)
