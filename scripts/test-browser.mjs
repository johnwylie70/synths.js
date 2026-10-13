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
const CONTROLS = resolve(ROOT, '../dials.js')
const from = process.env.PLAYWRIGHT || 'playwright'
const playwright = await import(from.startsWith('/') ? pathToFileURL(join(from, 'index.mjs')).href : from)

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.wav': 'audio/wav' }
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/test.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><body><button id="b" style="width:200px;height:100px">tap</button>')
  // pictures.js, for the example that draws: from the repository beside this one.
  const file = path.startsWith('/pictures.js/') ? join(PICTURES, path.slice(13)) : path.startsWith('/dials.js/') ? join(CONTROLS, path.slice(10)) : join(ROOT, path)
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
// ONLY=midi runs the MIDI cases alone, ONLY=voice the microphone's, ONLY=examples the examples, and ONLY=busy the
// fallback on a page that is kept busy.
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
  // A block with nothing coming in (a browser gives none while what is before it is silent) is kept as silence,
  // so a sample's place is always its time.
  async tap(player) {
    const src = 'registerProcessor("tap", class extends AudioWorkletProcessor { constructor() { super(); this.first = -1; this.port.onmessage = () => this.port.postMessage(["end", this.first]) } process(i) { if (this.first < 0) { if (!(i[0] && i[0][0])) return true; this.first = currentFrame } this.port.postMessage(i[0] && i[0][0] ? i[0][0].slice() : new Float32Array(128)); return true } })'
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    await player.context.audioWorklet.addModule(url)
    const node = new AudioWorkletNode(player.context, 'tap', { numberOfInputs: 1, numberOfOutputs: 1 })
    const blocks = []
    let done, forgotten = 0
    node.port.onmessage = (m) => (Array.isArray(m.data) ? done(m.data[1]) : blocks.push(m.data))
    player.node.connect(node)
    node.connect(player.context.destination)
    // What it gives has first, the sound card's frame that the first sample was; forget() starts again from here.
    return {
      forget() { forgotten += blocks.length; blocks.length = 0 },
      async samples() { const first = await new Promise((yes) => { done = yes; node.port.postMessage('end') }); const all = new Float32Array(blocks.length * 128); blocks.forEach((b, i) => all.set(b, i * 128)); all.first = first + forgotten * 128; return all },
    }
  },
  // The breaks in a steady sine: each sample of one follows from the two before it, and where it does not, the
  // sound was cut. Breaks closer together than 256 frames are one.
  breaks(a, hz, rate) {
    const k = 2 * Math.cos(2 * Math.PI * hz / rate)
    let found = 0, last = -1e9
    for (let i = 1; i < a.length - 1; i++) if (Math.abs(a[i + 1] - k * a[i] + a[i - 1]) > 0.004) { if (i - last > 256) found++; last = i }
    return found
  },
  // Keep the page's thread busy for some milliseconds, four times a second, as a heavy frame does. It gives back what stops it.
  busy(ms) {
    const timer = setInterval(() => { for (const until = performance.now() + ms; performance.now() < until;); }, 250)
    return () => clearInterval(timer)
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

  // --- a song, fetched and played by the engine in the worklet, and where it is read back
  await fresh(page)
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound()
    const song = s.playSong('/examples/songs/night_drive.json', { patches: { tune: 'bell' } })
    await T.on(() => s.player)
    song.position                        // the first read asks; the answer comes a moment later
    const heard = await T.listen(s.player, 1200)
    const first = song.position
    await T.wait(500)
    const later = song.position
    song.pause()
    await T.wait(600)
    const paused = [song.position.state, (await T.listen(s.player, 200)).peak]
    song.resume()
    song.seek(3)
    await T.wait(300)
    const sought = song.position
    s.stopSong()
    await T.wait(600)
    return { heard, first, later, paused, sought, end: [song.position.state, (await T.listen(s.player, 200)).peak] }
  })
  say(got.heard.peak > 0.1 && got.first.state === 'playing' && got.first.tempo === 125 && (got.later.row > got.first.row || got.later.order > got.first.order) && got.paused[0] === 'paused' && got.paused[1] < 0.05 && got.sought.order === 3 && got.sought.state === 'playing' && got.end[0] === 'stopped' && got.end[1] < 0.02, name,
    `playSong fetches a song and the engine plays it in the worklet: it is heard, its position moves (row ${got.first?.row} then ${got.later?.row}), and it pauses, seeks and stops`, got)

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
  // There is no microphone here, and the examples that use one are expected to say so and carry on.
  page.on('console', (m) => { if (m.type() === 'error' || (/synths\.js: .*(could not|no sound)/.test(m.text()) && !/microphone/.test(m.text()))) errors.push(m.text()) })
  const noMic = []
  page.on('console', (m) => { if (/synths\.js: .*microphone/.test(m.text())) noMic.push(m.text()) })
  const files = (await readdir(join(ROOT, 'examples'))).filter((f) => f.endsWith('.js')).sort()
  let heard = 0
  const silent = []
  for (const file of files) {
    const source = await readFile(join(ROOT, 'examples', file), 'utf8')
    const scene = source.includes('await use(')
    if (scene && !(existsSync(join(PICTURES, 'pictures.js')) && (!source.includes('dials.js') || existsSync(join(CONTROLS, 'dials.js'))))) { console.log(`     ${name}: ${file} needs pictures.js (and dials.js) beside this repository, skipped`); continue }
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
    // The voice changer is a microphone and nothing else: with none, silence is right.
    else if (file !== 'voice_changer.js') silent.push([file, got])
  }
  say(silent.length === 0 && errors.length === 0 && heard >= 8, name, `all ${heard} examples are heard, with no error (the sampler plays its bell and the voice changer is silent, there being no microphone)`, { silent, errors })
  if (!noMic.length) console.log(`     ${name}: the browser here never answers when asked for a microphone, so the examples that want one say nothing and carry on`)
  else say(noMic.every((t) => /Everything else carries on/.test(t)), name, 'and the examples that want a microphone say why there is none here, and carry on', noMic)
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
  // A scene whose first line is the microphone waits like any other first sound, and says so.
  await begin()
  said.length = 0
  const micOnly = await page.evaluate(async () => {
    const synths = await import('/synths.js')
    await ruled(synths)
    synths.useMicrophone()
    await T.wait(1500)
    return { state: synths.soundPlayer().state }
  })
  say(micOnly.state === 'waiting' && said.filter((t) => /sound is waiting for a tap/.test(t)).length === 1, name, 'with nothing asked for but the microphone the player is waiting too, and the console says once that sound is waiting for a tap', { micOnly, said })
  await begin()
  await page.evaluate(async () => {
    const synths = await import('/synths.js')
    await ruled(synths)
    synths.makeSynth(T.CLICK).play('A4', 30)
    synths.playSound('explosion')
    await T.wait(1500)
  })
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
    return { secure: isSecureContext, worklet: 'audioWorklet' in s.player.context, kind: s.player.kind, state: s.player.state, fallback: s.player.fallback, heard: await T.listen(s.player, 400) }
  })
  say(got.secure === false && got.worklet === false && got.kind === 'fallback' && got.heard.peak > 0.2 && Math.abs(got.heard.hz - 440) < 8, name, 'on a page that is not served securely there is no audio worklet, and the fallback plays the note', got)
  say(got.fallback?.buffer === 2048 && got.fallback.reason === 'insecure' && got.fallback.underruns === 0, name, 'player.fallback says why (the page is not secure), that sound is made 2048 frames at a time, and that none came late', got.fallback)
  say(said.filter((t) => /cannot run sound on its own thread \(that needs an https address, or localhost\), so the sound is made on the page's thread instead, \d+ ms at a time\. .* a key is heard about \d+ ms after it is pressed, and it may stutter or click when the page is busy for longer than that\. An https address has neither\./.test(t)).length === 1, name, 'and the console says so once: why, how late a key is heard, that a busy page makes it click, and that https has neither', said)
  const refused = await page.evaluate(async () => {
    const { createPlayer } = await import('/synths.js')
    const player = createPlayer({ fallback: false })
    for (let i = 0; i < 200 && player.state === 'loading'; i++) await T.wait(10)
    return player.state
  })
  say(refused === 'failed' && said.some((t) => /the sound engine could not start, so there will be no sound \(this page has no audio worklet: it needs an https address, or localhost\)/.test(t)), name, 'with the fallback refused it reports plainly that there will be no sound, and why', { refused, said })
  // The microphone on such a page: the browser gives none, and says nothing about why, so the library does. A
  // stream from a host still goes in, through the fallback.
  await page.evaluate(MIC)
  said.length = 0
  const mic = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound({ share: false })
    const none = s.useMicrophone()
    const take = s.recordSound(0.2)
    const ready = await none.whenReady()
    const out = { has: !!navigator.mediaDevices, ready, state: none.state }
    s.close()
    const given = createSound({ share: false, microphone: toneStream(400).stream })
    const mic = given.useMicrophone({ gate: 'off', listen: true })
    given.flush()
    for (let i = 0; i < 300 && given.player.state !== 'on'; i++) await T.wait(10)
    out.given = await mic.whenReady()
    await T.wait(300)
    out.kind = given.player.kind
    out.heard = await T.listen(given.player, 500)
    return out
  })
  say(mic.ready === false && mic.state === 'unavailable' && said.filter((t) => /microphone/.test(t) && !/howl/.test(t)).length === 1 && said.some((t) => /cannot use the microphone, because that needs an https address, or localhost/.test(t)), name, 'on a page that is not served securely there is no microphone to ask for, and one message says what it needs', { mic, said })
  say(mic.given === true && mic.kind === 'fallback' && mic.heard.peak > 0.1 && Math.abs(mic.heard.hz - 400) < 8, name, `and a stream given by a host is still heard through the fallback (400 Hz comes out at ${Math.round(mic.heard?.hz)})`, mic)
  await context.close()
}

/**
 * A BUSY PAGE AND THE FALLBACK. The fallback makes its sound on the page's thread, so a page that is busy for
 * longer than a buffer lasts leaves the sound card with nothing new to play. Here the page is kept busy on
 * purpose while a steady sine plays, and the breaks in what came out are counted (a second worklet keeps every
 * sample, so this is a page that has worklets and is told to use the fallback all the same).
 */
async function busyPage(name, browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (name === 'chromium') await letWorkletsRun(page)
  const said = []
  page.on('console', (m) => said.push(m.text()))
  const BLOCKS = [10, 30, 60, 120]
  const table = {}
  // 1024 frames with everything 80 ms ahead is what the fallback did before.
  for (const size of [1024, 2048, 4096]) {
    table[size] = []
    for (const block of BLOCKS) {
      await fresh(page)
      table[size].push(await page.evaluate(async ({ size, block }) => {
        const { createSound } = await import('/synths.js')
        const s = createSound({ fallback: 'always', share: false, fallbackBuffer: size, ...(size === 1024 ? { latency: 0.08 } : {}) })
        const synth = s.makeSynth(T.CLICK)
        await T.on(() => s.player)
        const tap = await T.tap(s.player)
        synth.start('A4')
        await T.wait(700)
        tap.forget()
        const stop = T.busy(block)
        await T.wait(2500)
        stop()
        return { breaks: T.breaks(await tap.samples(), 440, s.player.context.sampleRate), counted: s.player.fallback.underruns, buffer: s.player.fallback.buffer }
      }, { size, block }))
    }
  }
  const row = (size) => table[size].map((g, i) => `${BLOCKS[i]} ms: ${g.breaks}`).join(', ')
  say(table[2048][0].breaks === 0 && table[2048][1].breaks === 0 && table[2048][1].counted === 0 && table[4096][2].breaks === 0 && table[1024][2].breaks > table[2048][2].breaks && table[2048][3].breaks > table[4096][3].breaks, name,
    `breaks in a steady note on the fallback in 2.5 seconds, with the page busy four times a second. 1024 frames (as it was): ${row(1024)}. 2048 (now): ${row(2048)}. 4096: ${row(4096)}`, table)
  say(BLOCKS.every((b, i) => [1024, 2048, 4096].every((size) => (table[size][i].breaks > 0) === (table[size][i].counted > 0) || table[size][i].counted <= 4)) && table[2048][3].counted >= 8 && table[2048][3].buffer === 2048, name,
    `and the player counts them itself as they happen (player.fallback.underruns: ${table[2048].map((g) => g.counted).join(', ')} at 2048), leaving a buffer that was asked for by its size alone`, table)

  // --- with nothing asked for: the buffer, exact timing while the page is busy, and a key's delay
  await fresh(page)
  let got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound({ fallback: 'always', share: false })
    const synth = s.makeSynth(T.CLICK)
    await T.on(() => s.player)
    const rate = s.player.context.sampleRate
    const tap = await T.tap(s.player)
    await T.wait(300)
    const stop = T.busy(30)
    const t0 = s.soundTime() + 0.3
    for (let i = 0; i < 12; i++) synth.play('A4', 0.02, { at: t0 + i * 0.1 })
    s.flush()
    await T.wait(1900)
    stop()
    const on = T.onsets(await tap.samples())
    const quiet = { ...s.player.fallback }
    // A key, pressed at moments of no one's choosing: when the sound card says it is now, and when the note comes out.
    tap.forget()
    const pressed = []
    for (let i = 0; i < 12; i++) {
      await T.wait(150 + Math.random() * 100)
      pressed.push(s.player.context.currentTime)
      synth.play('A4', 0.03)
      s.flush()
    }
    await T.wait(500)
    const heard = await tap.samples()
    const delays = T.onsets(heard).map((f, i) => ((heard.first + f) / rate - pressed[i]) * 1000)
    return { rate, gaps: on.slice(1).map((f, i) => f - on[i]), quiet, delays, node: s.player.node.constructor.name }
  })
  const worst = Math.max(...got.delays), least = Math.min(...got.delays)
  say(got.quiet.buffer === 2048 && got.quiet.underruns === 0 && got.gaps.length === 11 && got.gaps.every((g) => Math.abs(g - got.rate / 10) <= 1), name,
    'with nothing asked for the fallback makes 2048 frames at a time, and twelve scheduled notes are a tenth of a second apart to the sample while the page is busy for 30 ms four times a second, with no under-run', got)
  say(got.delays.length === 12 && least > 60 && worst < 130, name, `a key pressed on the fallback is heard ${Math.round(least)} to ${Math.round(worst)} ms later by the sound card's clock (at ${got.rate} Hz; 80 ms with the buffer of 1024 it had)`, got)

  // --- a page that stays too busy: the buffer is doubled, once; a quiet page keeps the one it had
  await fresh(page)
  said.length = 0
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound({ fallback: 'always', share: false })
    const synth = s.makeSynth(T.CLICK)
    await T.on(() => s.player)
    const tap = await T.tap(s.player)
    synth.start('A4')
    await T.wait(1500)
    const quiet = { ...s.player.fallback }
    const stop = T.busy(120)
    await T.wait(2500)
    const grown = { ...s.player.fallback }
    await T.wait(2500)
    stop()
    const after = { ...s.player.fallback }
    // The sound goes on through the change of node, and a scheduled note is still exact after it.
    synth.stop?.()
    s.stopSound()
    await T.wait(300)
    tap.forget()
    const click = s.makeSynth(T.CLICK)
    const t0 = s.soundTime() + 0.3
    for (let i = 0; i < 5; i++) click.play('A4', 0.02, { at: t0 + i * 0.1 })
    s.flush()
    await T.wait(1100)
    const on = T.onsets(await tap.samples())
    return { quiet, grown, after, rate: s.player.context.sampleRate, gaps: on.slice(1).map((f, i) => f - on[i]) }
  })
  const grew = said.filter((t) => /the page is busy for longer than the sound was made ahead/.test(t))
  say(got.quiet.buffer === 2048 && got.quiet.underruns === 0 && got.grown.buffer === 4096 && got.after.buffer === 4096 && got.after.underruns > got.quiet.underruns && grew.length === 1, name,
    `a quiet page keeps 2048 frames and counts no under-run; kept busy for 120 ms four times a second, the buffer is doubled to 4096 after ${got.grown.underruns} under-runs, never further, and the console says so once`, { got, said })
  say(got.gaps.length === 4 && got.gaps.every((g) => Math.abs(g - got.rate / 10) <= 1), name, 'and what is scheduled after the change is still exact to the sample, heard through the same player.node', got)

  // --- setSoundBuffer in a program's own code: before the first sound, while a note plays, and "auto" again
  await fresh(page)
  said.length = 0
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound({ fallback: 'always', share: false, fallbackBuffer: 2048 })
    const before = s.setSoundBuffer('large')
    const synth = s.makeSynth(T.CLICK)
    s.flush()
    await T.on(() => s.player)
    const rate = s.player.context.sampleRate
    const tap = await T.tap(s.player)
    await T.wait(300)
    // How long after a key its note is heard, by the sound card's clock.
    const keys = async () => {
      tap.forget()
      const pressed = []
      for (let i = 0; i < 6; i++) { await T.wait(250 + Math.random() * 100); pressed.push(s.player.context.currentTime); synth.play('A4', 0.03); s.flush() }
      await T.wait(500)
      const heard = await tap.samples()
      const d = T.onsets(heard).map((f, i) => ((heard.first + f) / rate - pressed[i]) * 1000)
      return d.length === 6 ? [Math.min(...d), Math.max(...d)] : d
    }
    const large = { is: s.soundBuffer(), keys: await keys() }
    // Changed while a note sounds: the note goes on, and the change itself is not a click.
    const hold = synth.start('A4')
    await T.wait(600)
    tap.forget()
    const rounded = s.setSoundBuffer(1000)
    await T.wait(900)
    const change = await tap.samples()
    let loud = 0
    for (let i = change.length - 4096; i < change.length; i++) loud = Math.max(loud, Math.abs(change[i]))
    const breaks = T.breaks(change, 440, rate)
    // Set by hand it is left alone, however busy the page is.
    let stop = T.busy(120)
    await T.wait(2500)
    stop()
    const pinned = s.soundBuffer()
    hold.stop()
    await T.wait(300)
    const small = { is: s.soundBuffer(), keys: await keys() }
    // "auto" chooses again, and adapts again.
    const auto = s.setSoundBuffer('auto')
    await T.wait(400)
    const chosen = s.soundBuffer()
    stop = T.busy(120)
    await T.wait(3000)
    stop()
    let threw = ''
    try { s.setSoundBuffer('enormous') } catch (e) { threw = e.message }
    return { rate, before, large, rounded, breaks, loud, pinned, small, auto, chosen, grown: s.soundBuffer(), threw, snake: s.set_sound_buffer === s.setSoundBuffer && s.sound_buffer === s.soundBuffer }
  })
  const two = (size) => 2 * size / got.rate * 1000 + 8
  say(got.before.thread === null && got.before.setting === 4096 && got.large.is.frames === 4096 && got.large.is.thread === 'page' && got.large.is.delay === Math.round(two(4096)) && Math.abs(got.large.keys[0] - two(4096)) < 25 && Math.abs(got.large.keys[1] - two(4096)) < 25, name,
    `setSoundBuffer("large") before the first sound is how the fallback starts, whatever the host's option said: 4096 frames on the page's thread, and a key is heard ${Math.round(got.large.keys[0])} to ${Math.round(got.large.keys[1])} ms later (soundBuffer() says ${got.large.is.delay})`, got)
  say(got.small.is.frames === 1024 && got.small.is.setting === 1024 && Math.abs(got.small.keys[0] - two(1024)) < 12 && Math.abs(got.small.keys[1] - two(1024)) < 12 && got.breaks === 0 && got.loud > 0.2 && said.filter((t) => /a sound buffer is a power of two from 256 to 16384, so 1000 is taken as 1024/.test(t)).length === 1, name,
    `setSoundBuffer(1000) while a note sounds is taken as 1024 with one message, the note goes on with no break at the change, and a key is then heard ${Math.round(got.small.keys[0])} to ${Math.round(got.small.keys[1])} ms later`, { got, said })
  say(got.pinned.frames === 1024 && got.pinned.underruns > 3 && got.auto.setting === 'auto' && got.chosen.frames === 2048 && got.grown.frames === 4096 && got.grown.underruns > got.pinned.underruns && /setSoundBuffer needs "small", "medium", "large", "auto" or a number of frames/.test(got.threw) && got.snake, name,
    `a buffer set by hand is left alone on a busy page (${got.pinned.underruns} under-runs counted, still 1024); "auto" chooses 2048 again and doubles it again when the page stays busy; a word that is not one is refused in plain words`, got)

  // --- on the audio thread the buffer cannot change, and the program is told what was done instead
  await fresh(page)
  said.length = 0
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound({ share: false })
    const synth = s.makeSynth(T.CLICK)
    s.flush()
    await T.on(() => s.player)
    const rate = s.player.context.sampleRate
    const usual = s.soundBuffer()
    const set = s.setSoundBuffer(4096)
    s.setSoundBuffer(4096)
    const tap = await T.tap(s.player)
    await T.wait(200)
    const pressed = s.player.context.currentTime
    synth.play('A4', 0.03)
    s.flush()
    await T.wait(500)
    const heard = await tap.samples()
    const auto = s.setSoundBuffer('auto')
    // The same through a transport, as a scene in a frame or Python sends it: a command there, and an event back.
    const { createPlayer } = await import('/synths.js')
    const player = createPlayer({ fallback: 'always' })
    const far = createSound({ sound: { send: (batch) => player.send(JSON.parse(JSON.stringify(batch))), onSoundEvents: (listener, scope) => player.onSoundEvents(listener, scope) } })
    const sent = far.setSoundBuffer('large')
    far.makeSynth(T.CLICK).play('A4', 0.1)
    far.flush()
    await T.on(() => player)
    await T.wait(200)
    return { rate, kind: s.player.kind, usual, set, auto, key: ((heard.first + T.onsets(heard)[0]) / rate - pressed) * 1000, sent, far: far.soundBuffer(), fallback: player.fallback.buffer }
  })
  say(got.kind === 'worklet' && got.usual.thread === 'audio' && got.usual.frames === 128 && got.usual.delay === 40 && got.set.frames === 128 && got.set.delay === Math.round(4096000 / got.rate) && Math.abs(got.key - got.set.delay) < 8 && got.auto.delay === 40
    && said.filter((t) => /sound is made on the audio thread here, always 128 frames at a time, so a sound buffer of 4096 sets how far ahead everything is asked for instead: \d+ ms/.test(t)).length === 1, name,
    `on the audio thread setSoundBuffer(4096) leaves the 128 frames alone and sets how far ahead everything is asked for (${got.set.delay} ms, and a key is heard ${Math.round(got.key)} ms later), which the console says once and soundBuffer() gives; "auto" is 40 ms again`, { got, said })
  say(got.far.frames === 4096 && got.far.thread === 'page' && got.far.setting === 4096 && got.fallback === 4096, name, 'sent as a command to a player elsewhere, the buffer is set there and what it is comes back as an event for soundBuffer()', got)
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

/**
 * THE MICROPHONE in a real browser. There is none here, so its place is taken three ways: by a stream made from an
 * oscillator in the page (the `microphone` option, as a host would give one), by frames pushed in by hand (as a
 * native app would), and in Chromium by its own pretend device, which is the only one that goes through
 * getUserMedia itself. What cannot be tested here is a real microphone and a real person's answer to the browser.
 */
const MIC = `
// A context with a steady tone in it, as a stream: what a host hands over in place of a microphone.
window.toneStream = (hz = 440, level = 0.5) => {
  const context = new AudioContext()
  const osc = context.createOscillator()
  osc.frequency.value = hz
  const gain = context.createGain()
  gain.gain.value = level
  const out = context.createMediaStreamDestination()
  osc.connect(gain).connect(out)
  osc.start()
  return { context, stream: out.stream, osc, gain }
}
// The level of one frequency in what a player is putting out now, from an analyser.
window.spectrum = async (player, ms = 400) => {
  const a = player.context.createAnalyser()
  a.fftSize = 16384
  a.smoothingTimeConstant = 0
  player.node.connect(a)
  await T.wait(ms)
  const bins = new Float32Array(a.frequencyBinCount)
  a.getFloatFrequencyData(bins)
  const data = new Float32Array(a.fftSize)
  a.getFloatTimeDomainData(data)
  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  player.node.disconnect(a)
  const width = player.context.sampleRate / a.fftSize
  const at = (hz) => { let most = -200; for (let i = Math.round(hz / width) - 2; i <= Math.round(hz / width) + 2; i++) most = Math.max(most, bins[i]); return most }
  let best = 1
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i
  return { peak, hz: best * width, at }
}
`
async function voice(name, browser, pretend) {
  const context = await browser.newContext(pretend ? { permissions: ['microphone'] } : {})
  const page = await context.newPage()
  if (name === 'chromium') await letWorkletsRun(page)
  const said = []
  page.on('console', (m) => said.push(m.text()))
  page.on('pageerror', (e) => said.push('ERROR ' + e.message))
  const requests = []
  page.on('request', (r) => requests.push(r.url()))
  const begin = async () => { await fresh(page); await page.evaluate(MIC); said.length = 0; requests.length = 0 }

  if (pretend) {
    // --- Chromium's pretend microphone, through getUserMedia itself: what is asked for, and that it is let go
    await begin()
    const got = await page.evaluate(async () => {
      const asked = []
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      let stream = null
      navigator.mediaDevices.getUserMedia = async (c) => { asked.push(c); return (stream = await real(c)) }
      const { createSound } = await import('/synths.js')
      const s = createSound()
      s.makeSynth(T.CLICK)
      s.flush()
      await T.on(() => s.player)
      const before = asked.length
      const mic = s.useMicrophone()
      const ready = await mic.whenReady()
      let level = 0
      for (let i = 0; i < 100; i++) { level = Math.max(level, mic.level()[0]); await T.wait(20) }
      const silent = await T.listen(s.player, 200)
      mic.listen()
      const heard = await T.listen(s.player, 600)
      const settings = stream.getAudioTracks()[0].getSettings()
      const take = s.recordSound(0.5)
      await take.whenDone()
      s.stopMicrophone()
      await T.wait(200)
      return { before, asked, ready, state: mic.state, level, silent: silent.peak, heard: heard.peak, track: stream.getAudioTracks()[0].readyState, seconds: take.seconds, settings, rate: s.player.context.sampleRate }
    })
    say(got.before === 0 && got.asked.length === 1 && same(got.asked[0], { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false }), name, 'the browser is asked for the microphone only when useMicrophone() is called, once, and for the plain one: no echo cancelling, noise removal or automatic level, one channel', got.asked)
    say(got.ready === true && got.level > 0.01 && got.silent === 0 && got.heard > 0.01 && got.seconds === 0.5, name, `its pretend microphone comes in through getUserMedia: it shows on the meter (${got.level?.toFixed(2)}), is silent until listen() and heard after (${got.heard?.toFixed(2)}), and records half a second`, got)
    say(got.track === 'ended', name, 'stopMicrophone() lets the microphone go, so the browser\'s recording light goes out', got.track)
    console.log(`     ${name}: the pretend microphone's stream is at ${got.settings.sampleRate || 'an unstated rate'} Hz and the sound card at ${got.rate} Hz; the source node brings one to the other`)
    await context.close()
    return
  }

  // --- a stream in the microphone's place: silent until it is listened to, then heard, through each voice
  await begin()
  let got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const from = toneStream(400)
    const s = createSound({ microphone: from.stream })
    const mic = s.useMicrophone({ gate: 'off' })
    s.flush()
    await T.on(() => s.player)
    const ready = await mic.whenReady()
    await T.wait(200)
    const muted = await T.listen(s.player, 300)
    const scope = [0, 0]
    for (let i = 0; i < 20; i++) { scope[1] = Math.max(scope[1], ...mic.samples()); await T.wait(20) }
    scope[0] = mic.samples().length
    mic.listen()
    await T.wait(200)
    const plain = await spectrum(s.player)
    const out = { ready, kind: s.player.kind, muted: muted.peak, scope, plain: { peak: plain.peak, hz: plain.hz }, rate: s.player.context.sampleRate, from: from.context.sampleRate }
    mic.mute()
    await T.wait(200)
    out.after = (await T.listen(s.player, 200)).peak
    mic.listen()
    mic.voice = 'chipmunk'
    await T.wait(300)
    out.chipmunk = (await spectrum(s.player)).hz
    mic.voice = 'monster'
    await T.wait(300)
    out.monster = (await spectrum(s.player)).hz
    mic.voice = 'robot'
    mic.comb = 0
    await T.wait(300)
    const robot = await spectrum(s.player)
    out.robot = [robot.at(350), robot.at(400), robot.at(450)]
    return out
  })
  say(got.ready === true && got.kind === 'worklet' && got.muted === 0 && got.scope[0] === 1024 && got.scope[1] > 0.3, name, 'a stream given in the microphone\'s place reaches the worklet: nothing is heard until listen(), and the scope shows it meanwhile', got)
  say(got.plain.peak > 0.1 && Math.abs(got.plain.hz - 400) < 4 && got.after === 0, name, `listen() lets it be heard as it is (400 Hz comes out at ${got.plain?.hz.toFixed(0)}), and mute() is silence again`, got)
  say(Math.abs(got.chipmunk / 400 - 2 ** (7 / 12)) < 0.02 && Math.abs(got.monster / 400 - 2 ** (-7 / 12)) < 0.02, name, `the chipmunk voice moves it to ${got.chipmunk?.toFixed(0)} Hz and the monster to ${got.monster?.toFixed(0)} Hz, seven semitones each way`, got)
  say(got.robot[0] > got.robot[1] + 20 && got.robot[2] > got.robot[1] + 20, name, `the robot voice puts tones 50 Hz either side of it and takes it away (${got.robot?.map((v) => v.toFixed(0)).join(', ')} dB at 350, 400 and 450 Hz)`, got.robot)
  say(said.filter((t) => /synths\.js/.test(t)).length === 1 && /Through loudspeakers that can howl, so headphones are best/.test(said.find((t) => /synths\.js/.test(t))), name, 'and one thing is said, once, when it is first listened to: that loudspeakers can howl', said)

  // --- recording: the right length, played back at pitch and transposed; what is played; a WAV file
  await begin()
  got = await page.evaluate(async () => {
    const synths = await import('/synths.js')
    const from = toneStream(300)
    const files = []
    const s = synths.createSound({ microphone: from.stream, save: (file) => files.push(file) })
    const mic = s.useMicrophone({ gate: 'off' })
    s.flush()
    await T.on(() => s.player)
    await mic.whenReady()
    await T.wait(200)
    const take = s.recordSound(1)
    const first = [take.done, take.seconds]
    const began = performance.now()
    await take.whenDone()
    const took = performance.now() - began
    const out = { first, took, seconds: take.seconds, frames: take.frames, rate: s.player.context.sampleRate }
    take.loop = true
    const note = take.start()
    await T.wait(150)
    out.same = (await spectrum(s.player)).hz
    note.stop()
    const up = take.start('G4')
    await T.wait(150)
    out.up = (await spectrum(s.player)).hz
    up.stop()
    await T.wait(200)
    const bytes = await s.saveSound(take, 'word')
    const wav = synths.readWav(bytes)
    out.file = { names: files.map((f) => f.name), type: files[0]?.type, channels: wav.channels, rate: wav.rate, frames: wav.pcm.length, peak: Math.max(...wav.pcm.subarray(0, 4800)) }
    // What is played, recorded and played again.
    const lead = s.makeSynth(T.CLICK)
    const tune = s.recordOutput(0.5)
    lead.play('A4', 0.4)
    await tune.whenDone()
    await T.wait(200)
    tune.loop = true
    tune.start()
    await T.wait(150)
    out.tune = [tune.seconds, (await spectrum(s.player)).hz]
    const stereo = synths.readWav(await s.saveSound(tune, { download: false }))
    out.stereo = [stereo.channels, stereo.pcm.length, files.length]
    return out
  })
  say(same(got.first, [false, 0]) && got.seconds === 1 && got.frames === got.rate && got.took > 900 && got.took < 1600, name, `recordSound(1) gives a take at once and it is done a second later (${Math.round(got.took)} ms), exactly ${got.frames} frames long`, got)
  say(Math.abs(got.same - 300) < 4 && Math.abs(got.up / 300 - 2 ** (7 / 12)) < 0.02, name, `the take plays back at its pitch (${got.same?.toFixed(0)} Hz) and seven semitones up at ${got.up?.toFixed(0)} Hz`, got)
  say(same(got.file.names, ['word.wav']) && got.file.type === 'audio/wav' && got.file.channels === 1 && got.file.rate === got.rate && got.file.frames === got.rate && got.file.peak > 0.4, name, 'saveSound gives a WAV file of it to the host that asked for saved files: one channel, a second long, with the sound in it', got.file)
  say(got.tune[0] === 0.5 && Math.abs(got.tune[1] - 440) < 4 && got.stereo[0] === 2 && got.stereo[1] === got.rate && got.stereo[2] === 1, name, 'recordOutput records what is played (an A4, heard again from the recording), in stereo, and { download: false } hands the file to nobody', got)

  // --- frames pushed in by a host, at the sound card's rate and at another
  await begin()
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const calls = []
    let timer = null
    const pushing = (rate, hz) => ({
      open(wants) {
        calls.push(['open', wants.sampleRate, wants.raw, typeof wants.push, wants.constraints.echoCancellation])
        const sr = rate || wants.sampleRate
        let n = 0
        const lump = Math.round(sr / 50)
        const began = performance.now()
        // 20 milliseconds at a time, as many lumps as are due.
        timer = setInterval(() => {
          while (n * lump < (performance.now() - began) / 1000 * sr) {
            const frames = new Float32Array(lump)
            for (let i = 0; i < lump; i++) frames[i] = 0.5 * Math.sin(2 * Math.PI * hz * (n * lump + i) / sr)
            wants.push(frames, rate)
            n++
          }
        }, 5)
        return true
      },
      close() { calls.push(['close']); clearInterval(timer) },
    })
    const out = {}
    for (const [key, rate] of [['same', 0], ['other', 16000]]) {
      const s = createSound({ microphone: pushing(rate, 500), share: false })
      const mic = s.useMicrophone({ gate: 'off', listen: true })
      s.flush()
      await T.on(() => s.player)
      out[key + 'Ready'] = await mic.whenReady()
      await T.wait(400)
      const heard = await spectrum(s.player, 500)
      out[key] = { peak: heard.peak, hz: heard.hz }
      s.close()
      await T.wait(100)
    }
    out.calls = calls
    return out
  })
  say(got.sameReady && got.same.peak > 0.1 && Math.abs(got.same.hz - 500) < 4, name, `a host that pushes the frames itself is heard: 500 Hz in lumps of 20 ms comes out at ${got.same?.hz.toFixed(0)} Hz`, got)
  say(got.otherReady && got.other.peak > 0.1 && Math.abs(got.other.hz - 500) < 4, name, `and at 16000 frames a second, which is not the sound card's rate, it still comes out at ${got.other?.hz.toFixed(0)} Hz`, got)
  say(got.calls.filter((c) => c[0] === 'open').length === 2 && got.calls[0][2] === true && got.calls[0][3] === 'function' && got.calls[0][4] === false && got.calls.filter((c) => c[0] === 'close').length === 2, name, 'the host is told the sample rate, that the plain microphone is wanted and where to push, and is told when to stop', got.calls)

  // --- no microphone: refused, missing, and turned off by the host. One message each, and nothing throws.
  for (const [why, error, state, words] of [['refused', 'NotAllowedError', 'refused', /the microphone was not allowed\. To allow it, .* allow="microphone"/], ['missing', 'NotFoundError', 'none', /no microphone was found\. Plug one in/], ['in use', 'NotReadableError', 'busy', /another program may be using it/]]) {
    await begin()
    got = await page.evaluate(async (error) => {
      if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', error))
      const { createSound } = await import('/synths.js')
      const s = createSound()
      const lead = s.makeSynth(T.CLICK)
      const mic = s.useMicrophone({ voice: 'robot', listen: true })
      mic.pitch = 4
      const take = s.recordSound(1)
      const began = performance.now()
      await take.whenDone()
      take.play()
      take.voice = 'chipmunk'
      const bytes = await s.saveSound(take, { download: false })
      s.useMicrophone().listen()
      s.recordSound(0.2)
      lead.start('A4')
      await T.on(() => s.player)
      const heard = await T.listen(s.player, 300)
      return { ready: await mic.whenReady(), state: mic.state, done: take.done, seconds: take.seconds, took: performance.now() - began, bytes: bytes.length, heard: heard.peak, level: mic.level() }
    }, error)
    const about = said.filter((t) => /microphone/.test(t))
    say(got.ready === false && got.state === state && got.done && got.seconds === 0 && got.bytes === 44 && got.heard > 0.2 && !said.some((t) => /ERROR/.test(t)), name, `a microphone that is ${why}: nothing throws, the microphone says "${got.state}", a recording is empty and done at once, and the rest of the sound plays`, { got, said })
    say(about.length === 1 && words.test(about[0]) && /Everything else carries on/.test(about[0]), name, 'and one message says why, and what to do', about)
  }
  await begin()
  got = await page.evaluate(async () => {
    let asked = 0
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { asked++; return Promise.reject(new Error('should not be asked')) }
    const { createSound } = await import('/synths.js')
    const s = createSound({ microphone: false })
    const mic = s.useMicrophone()
    const take = s.recordSound(1)
    await take.whenDone()
    return { asked, ready: await mic.whenReady(), state: mic.state, seconds: take.seconds }
  })
  say(got.asked === 0 && got.ready === false && got.state === 'unavailable' && said.filter((t) => /microphone/.test(t)).length === 1 && said.some((t) => /turned off for this page by the app that shows it/.test(t)), name, 'a host can turn the microphone off (microphone: false): the browser is never asked, and one message says so', { got, said })

  // --- what the browser itself says here, with no permission given and no pretending
  await begin()
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const s = createSound()
    const mic = s.useMicrophone()
    const take = s.recordSound(0.3)
    const ready = await Promise.race([mic.whenReady(), T.wait(4000).then(() => 'never answered')])
    return { ready, state: mic.state, done: take.done, has: !!navigator.mediaDevices?.getUserMedia }
  })
  if (got.ready === 'never answered') console.log(`     ${name}: asked for a real microphone, the browser here never answers, so nothing is said and nothing fails`)
  else say(got.ready === true || (said.filter((t) => /microphone/.test(t)).length === 1 && got.done), name, `asked for a real microphone, this browser ${got.ready ? 'gives one' : `gives none (${got.state}), and one message says so`}`, { got, said })

  // --- a frame that may not ask: sandboxed, with no origin and no allow="microphone"
  await begin()
  got = await page.evaluate(async () => {
    const inner = '<!doctype html><body><script type="module">' +
      'const said = []; for (const how of ["warn", "info", "error"]) console[how] = (...a) => said.push(a.join(" "));' +
      'try { const { createSound } = await import("' + location.origin + '/synths.js");' +
      'const s = createSound(); const mic = s.useMicrophone({ listen: true }); const take = s.recordSound(0.2);' +
      'const ready = await Promise.race([mic.whenReady(), new Promise((yes) => setTimeout(() => yes("never answered"), 4000))]);' +
      'parent.postMessage({ ready, state: mic.state, done: take.done, said }, "*") } catch (e) { parent.postMessage({ error: String(e), said }, "*") }' +
      '</scr' + 'ipt>'
    const frame = document.createElement('iframe')
    frame.sandbox = 'allow-scripts'
    frame.srcdoc = inner
    const answer = new Promise((yes) => addEventListener('message', (m) => yes(m.data), { once: true }))
    document.body.append(frame)
    return answer
  })
  if (got.ready === 'never answered') console.log(`     ${name}: in a sandboxed frame the browser here never answers the question, so nothing is said and nothing fails`)
  else say(!got.error && got.ready === false && got.said.filter((t) => /microphone/.test(t)).length === 1, name, `in a sandboxed frame with no allow="microphone" there is no microphone (${got.state}), one message says so, and nothing throws`, got)

  // --- a program with no microphone in it asks for nothing and costs nothing
  await begin()
  got = await page.evaluate(async () => {
    let asked = 0
    if (navigator.mediaDevices) { const real = navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = function (...a) { asked++; return real.apply(this, a) } }
    const { createSound } = await import('/synths.js')
    const s = createSound()
    s.makeSynth(T.CLICK).start('A4')
    await T.on(() => s.player)
    const heard = await T.listen(s.player, 300)
    return { asked, heard: heard.peak, inputs: s.player.node.numberOfInputs }
  })
  say(got.asked === 0 && got.heard > 0.2 && same(requests.filter((r) => !r.startsWith('blob:')).map((r) => r.split('/').pop()).filter((r) => r !== 'test.html').sort(), ['synths.js', 'synths_core.wasm']) && !said.some((t) => /microphone/.test(t)), name, 'a program that does not use the microphone never asks the browser for one, fetches nothing more than the library and the engine, and is told nothing', { got, requests, said })

  // --- how late the microphone is: the same click, straight to the output and through the engine
  await begin()
  got = await page.evaluate(async () => {
    const { createSound } = await import('/synths.js')
    const context = new AudioContext()
    const src = 'registerProcessor("pair", class extends AudioWorkletProcessor { constructor() { super(); this.port.onmessage = () => this.port.postMessage("end") } process(i) { if (i[0] && i[0][0]) this.port.postMessage([i[0][0].slice(), (i[0][1] || i[0][0]).slice()]); return true } })'
    await context.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    const osc = context.createOscillator()
    osc.frequency.value = 200
    const gate = context.createGain()
    gate.gain.value = 0
    const stream = context.createMediaStreamDestination()
    osc.connect(gate)
    gate.connect(stream)
    osc.start()
    const s = createSound({ context, microphone: stream.stream })
    const mic = s.useMicrophone({ gate: 'off', listen: true })
    s.flush()
    await T.on(() => s.player)
    await mic.whenReady()
    // One listener with two ears: the click as it left, and as it came back out of the engine.
    const merge = context.createChannelMerger(2)
    gate.connect(merge, 0, 0)
    s.player.node.connect(merge, 0, 1)
    const pair = new AudioWorkletNode(context, 'pair', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete' })
    merge.connect(pair)
    pair.connect(context.destination)
    const blocks = []
    let ended
    pair.port.onmessage = (m) => (m.data === 'end' ? ended() : blocks.push(m.data))
    const late = async (set) => {
      set()
      await T.wait(300)
      blocks.length = 0
      gate.gain.setValueAtTime(1, context.currentTime + 0.1)
      await T.wait(500)
      gate.gain.setValueAtTime(0, context.currentTime)
      await new Promise((yes) => { ended = yes; pair.port.postMessage('end') })
      const a = new Float32Array(blocks.length * 128), b = new Float32Array(blocks.length * 128)
      blocks.forEach((p, i) => { a.set(p[0], i * 128); b.set(p[1], i * 128) })
      const first = (x) => x.findIndex((v) => Math.abs(v) > 0.002)
      await T.wait(200)
      return first(b) - first(a)
    }
    const plain = await late(() => { mic.voice = 'none' })
    const up = await late(() => { mic.voice = 'chipmunk' })
    const down = await late(() => { mic.voice = 'monster' })
    return { plain, up, down, rate: context.sampleRate, base: context.baseLatency, out: context.outputLatency }
  })
  const ms = (frames) => (frames / got.rate * 1000).toFixed(1)
  say(got.plain >= 0 && got.plain < got.rate * 0.1 && got.up >= got.plain && got.up < got.rate * 0.13 && got.down < got.rate * 0.13, name, `a click given as a stream comes out of the engine ${got.plain} frames later (${ms(got.plain)} ms), ${ms(got.up)} ms later through the chipmunk voice and ${ms(got.down)} ms through the monster`, got)
  console.log(`     ${name}: that is inside the browser, stream to worklet to output. A real microphone and loudspeaker add their own: here the sound card says ${((got.base || 0) * 1000).toFixed(1)} ms for a block and ${((got.out || 0) * 1000).toFixed(1)} ms to the loudspeaker`)

  await context.close()
}

/**
 * An engine that takes ten seconds to arrive (a slow connection, a preview that is handed its bytes late). What
 * was asked for meanwhile and goes on (a tune that repeats, a section that goes round, a song) starts when the
 * engine is there; a single note from long before does not.
 */
async function late(name, browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (name === 'chromium') await letWorkletsRun(page)
  const said = []
  page.on('console', (m) => said.push(m.text()))
  page.on('pageerror', (e) => said.push('ERROR ' + e.message))
  for (const how of ['own', 'transport', 'fallback']) {
    await fresh(page)
    const got = await page.evaluate(async (how) => {
      const synths = await import('/synths.js')
      const bytes = await (await fetch('/synths_core.wasm')).arrayBuffer()
      const wasm = new Promise((yes) => setTimeout(() => yes(bytes), 10000))
      // Either the program has the player itself, or (as a preview does) it sends its batches to a player elsewhere.
      let player = null
      const s = how === 'own' ? synths.createSound({ wasm }) : how === 'fallback' ? synths.createSound({ wasm, fallback: 'always', share: false }) : synths.createSound({ sound: { send: (batch) => (player = player || synths.createPlayer({ wasm })).send(JSON.parse(JSON.stringify(batch))) } })
      const the = () => player || s.player
      const a = s.makeSynth(T.CLICK), b = s.makeSynth(T.CLICK), c = s.makeSynth(T.CLICK)
      a.playNotes('A4 A4', 0.25, { repeat: true })
      s.loopNotes(() => { b.note('A5', 'quarter'); b.rest('quarter') })
      c.play(114.23, 0.5)                    // 6000 Hz, where nothing else is
      s.playSong('/examples/songs/' + (await (await fetch('/examples/song.js')).text()).match(/playSong\("songs\/([^"]+)"/)[1])
      await T.wait(9000)
      const before = the().state
      await T.on(the)
      for (let i = 0; i < 600 && the().state !== 'on'; i++) await T.wait(10)
      await T.wait(500)
      const a2 = the().context.createAnalyser()
      a2.fftSize = 16384
      the().node.connect(a2)
      await T.wait(1200)
      const bins = new Float32Array(a2.frequencyBinCount)
      a2.getFloatFrequencyData(bins)
      const width = the().context.sampleRate / a2.fftSize
      const at = (hz) => { let most = -200; for (let i = Math.round(hz / width) - 2; i <= Math.round(hz / width) + 2; i++) most = Math.max(most, bins[i]); return most }
      const song = how !== 'transport' ? the().songPosition() : null
      await T.wait(200)
      return { before, state: the().state, tune: at(440), loop: at(880), note: at(6000), song: how !== 'transport' ? the().songPosition().state : 'not asked', voices: (await the().ask()).voices }
    }, how)
    say(got.before === 'loading' && got.state === 'on' && got.tune > -60 && got.loop > -60 && got.note < got.tune - 20 && (how === 'transport' || got.song === 'playing'), name, `with the engine ten seconds late (${how === 'own' ? 'the page\'s own player' : how === 'fallback' ? 'the fallback, with no worklet' : 'a player sent the batches'}): the repeating tune, the section that goes round and the song all play once it is there, and the single note from ten seconds before does not`, { got, said })
  }
  await context.close()
}

/**
 * THE TESTS MAKE NO SOUND IN THE ROOM. Chromium is started with its output muted. WebKit has no such switch, so in
 * every page and frame (Chromium's too) whatever is connected to the loudspeaker is connected to a gain of nothing
 * that is connected to it instead: the sound card still pulls the graph along, and every measurement is taken
 * from the nodes before it, so nothing that is measured changes.
 */
const QUIET = `(() => {
  if (typeof AudioNode === 'undefined' || typeof AudioDestinationNode === 'undefined') return
  const connect = AudioNode.prototype.connect
  const silent = new WeakMap()
  AudioNode.prototype.connect = function (to, ...rest) {
    if (!(to instanceof AudioDestinationNode)) return connect.call(this, to, ...rest)
    let gain = silent.get(to)
    if (!gain) {
      gain = to.context.createGain()
      gain.gain.value = 0
      connect.call(gain, to)
      silent.set(to, gain)
    }
    connect.call(this, gain, ...rest)
    return to
  }
})()`
const ALLOWED = { chromium: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] }, webkit: {} }
async function launch(name, options) {
  const browser = await playwright[name].launch(options)
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...a) => { const context = await newContext(...a); await context.addInitScript(QUIET); return context }
  return browser
}
for (const name of ['chromium', 'webkit']) {
  let browser
  try { browser = await launch(name, ALLOWED[name]) } catch { console.log(`${name}: not installed, skipped`); continue }
  try {
    if (!ONLY) await withSound(name, browser)
    if (!ONLY || ONLY === 'examples') await examples(name, browser)
    if (!ONLY || ONLY === 'midi') await midi(name, browser)
    if (!ONLY || ONLY === 'voice') await voice(name, browser, false)
    if (!ONLY || ONLY === 'late') await late(name, browser)
    if (!ONLY || ONLY === 'busy') await busyPage(name, browser)
  } catch (e) { say(false, name, 'the tests ran to the end', String(e?.stack || e)) }
  await browser.close()

  if (name === 'chromium' && (!ONLY || ONLY === 'voice')) {
    // Chromium's own pretend microphone (a beep every second), with its question answered yes.
    browser = await launch(name, { args: [...ALLOWED[name].args, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
    try { await voice(name, browser, true) } catch (e) { say(false, name, 'the pretend-microphone tests ran to the end', String(e?.stack || e)) }
    await browser.close()
  }

  browser = await launch(name, ALLOWED[name])
  try { if (!ONLY) await waitingForATap(name, browser) } catch (e) { say(false, name, 'the tap tests ran to the end', String(e?.stack || e)) }
  await browser.close()

  if (name === 'chromium' && (!ONLY || ONLY === 'insecure')) {
    // A name that is not localhost, pointed at this machine: the same page, not a secure context.
    browser = await launch(name, { args: [...ALLOWED[name].args, `--host-resolver-rules=MAP plain.test 127.0.0.1`] })
    try { await notSecure(name, browser) } catch (e) { say(false, name, 'the not-secure tests ran to the end', String(e?.stack || e)) }
    await browser.close()
  }
}

server.close()
console.log(`${count - failed} of ${count} passed`)
process.exit(failed ? 1 : 0)
