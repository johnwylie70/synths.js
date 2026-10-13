/**
 * synths-midi.js: MIDI for synths.js. A MIDI keyboard plays a synth, a program hears notes and knobs, and notes
 * go out to a synth on the desk. synths.js fetches this file the first time a MIDI function is used; a program
 * with no MIDI in it never loads it. It imports nothing: synths.js hands it what it needs.
 *
 *   lead.playFromMidi()                        a MIDI keyboard plays this synth: notes, how hard, pitch bend, the pedal
 *   onMidiNote((note, velocity, channel) => {})    a key went down (velocity 0: it came up, unless onMidiNoteOff is used)
 *   onMidiControl((number, value, channel) => {})  a knob or slider moved; value is from 0 to 1
 *   onMidi((message) => {})                    everything, decoded: { type, channel, note, velocity, control, value, … }
 *   sendMidiNote("C4", 0.8, { length: 0.5 })   a note out, let go half a second later
 *   sendMidiControl(74, 0.5), sendMidi([0x90, 60, 100])
 *   lead.sendToMidi()                          what this synth plays also goes out as MIDI
 *   lead.learn("cutoff"), lead.mapMidi(74, "cutoff")    a knob turns a setting, through the setting's own range
 *   midiDevices(), useMidiInput(name), useMidiOutput(name)
 *   midiInput(), lead.midiInput(), midiOutput()    the device and the channel, as something a control on the screen can be tied to
 *
 * HOW IT IS BUILT. Like the sound, in layers, so that the program may be in a worker, another frame or Python:
 *
 *   1. THE FUNCTIONS (makeMidiApi) only write commands, { op: "midi", do: "send", bytes: [144, 60, 100], t }, into
 *      the same batches as the sound's, and call the program's functions with the messages they are handed.
 *   2. THE DESK (makeMidiDesk) is on the player's side, where the devices are. It carries the commands out, sends
 *      at the exact time asked for, plays a synth from a keyboard without the program in between (so it feels
 *      immediate however far away the program is), and hands each sender what was received, as plain data.
 *   3. A MIDI TRANSPORT reaches the devices: Web MIDI in the page (webMidi), or the host's own, given as the
 *      `midi` option, for a place with no Web MIDI (an iPad's app, which has CoreMIDI behind it).
 *
 * docs/midi.md is the contract. MIT licence.
 */

const clamp = (v, low, high) => Math.min(high, Math.max(low, v))

// --- bytes and messages ----------------------------------------------------------------------

const CHANNEL = { 0x80: 'noteOff', 0x90: 'noteOn', 0xa0: 'notePressure', 0xb0: 'control', 0xc0: 'program', 0xd0: 'pressure', 0xe0: 'bend' }
const SYSTEM = { 0xf0: 'sysex', 0xf1: 'timeCode', 0xf2: 'songPosition', 0xf3: 'songSelect', 0xf6: 'tuneRequest', 0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop', 0xfe: 'sensing', 0xff: 'reset' }
/** Every kind of message: the ones a device sends, then the ones the desk makes itself. */
export const MIDI_TYPES = [...Object.values(CHANNEL), ...Object.values(SYSTEM), 'other', 'devices', 'tempo', 'learned', 'set']
// How many bytes follow a status byte.
const following = (status) => (status < 0xf0 ? ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2) : status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0)

/**
 * The bytes of ONE whole message -> what it says. Channels are 1 to 16; `velocity` and `value` are from 0 to 1;
 * `bend` is from -1 to 1. A note-on with no velocity is a note-off, as MIDI has it. `data` is the bytes themselves.
 */
export function decodeMidi(bytes) {
  const data = Array.from(bytes)
  const [status, a = 0, b = 0] = data
  if (status < 0xf0) {
    const type = CHANNEL[status & 0xf0]
    const m = { type, channel: (status & 15) + 1 }
    if (type === 'noteOn' && b === 0) m.type = 'noteOff'
    if (type === 'noteOn' || type === 'noteOff') { m.note = a; m.velocity = m.type === 'noteOn' ? b / 127 : 0; if (type === 'noteOff') m.release = b / 127 }
    else if (type === 'notePressure') { m.note = a; m.value = b / 127 }
    else if (type === 'control') { m.control = a; m.value = b / 127 }
    else if (type === 'program') m.program = a
    else if (type === 'pressure') m.value = a / 127
    else if (type === 'bend') { const v = (a | b << 7) - 8192; m.bend = v < 0 ? v / 8192 : v / 8191 }
    m.data = data
    return m
  }
  const m = { type: SYSTEM[status] || 'other' }
  if (status === 0xf2) m.value = a | b << 7
  else if (status === 0xf1 || status === 0xf3) m.value = a
  m.data = data
  return m
}

/** What a message says -> its bytes: the other way round. A list of bytes is given back as it is. */
export function encodeMidi(m) {
  if (Array.isArray(m) || ArrayBuffer.isView(m)) return Array.from(m)
  if (Array.isArray(m.data) && !m.type) return [...m.data]
  const ch = clamp(Math.round((m.channel ?? 1) - 1), 0, 15)
  const seven = (v) => clamp(Math.round((v ?? 0) * 127), 0, 127)
  const whole = (v) => clamp(Math.round(v ?? 0), 0, 127)
  switch (m.type) {
    case 'noteOn': return [0x90 | ch, whole(m.note), m.velocity > 0 ? Math.max(1, seven(m.velocity)) : 0]
    case 'noteOff': return [0x80 | ch, whole(m.note), seven(m.release)]
    case 'notePressure': return [0xa0 | ch, whole(m.note), seven(m.value)]
    case 'control': return [0xb0 | ch, whole(m.control), seven(m.value)]
    case 'program': return [0xc0 | ch, whole(m.program)]
    case 'pressure': return [0xd0 | ch, seven(m.value)]
    case 'bend': { const b = clamp(m.bend ?? 0, -1, 1); const v = clamp(Math.round(8192 + b * (b < 0 ? 8192 : 8191)), 0, 16383); return [0xe0 | ch, v & 127, v >> 7] }
    case 'songPosition': return [0xf2, (m.value ?? 0) & 127, ((m.value ?? 0) >> 7) & 127]
    case 'timeCode': case 'songSelect': return [m.type === 'timeCode' ? 0xf1 : 0xf3, whole(m.value)]
    case 'sysex': return [...(m.data || [0xf0, 0xf7])]
    default: {
      const status = Object.keys(SYSTEM).find((s) => SYSTEM[s] === m.type)
      if (status) return [+status]
      throw new Error(`there is no kind of MIDI message called ${JSON.stringify(m.type)}. The kinds are: ${MIDI_TYPES.slice(0, 18).join(', ')}`)
    }
  }
}

/**
 * A reader for the bytes of one input as they arrive, in pieces of any size: `const read = midiParser()`, then
 * `read(bytes)` gives the whole messages those bytes finished. It knows running status (a message that leaves its
 * status byte out because it is the same as the last one), lets a real-time byte (the clock) arrive in the middle
 * of anything, and keeps a system exclusive message whole from 0xF0 to 0xF7.
 */
export function midiParser() {
  let status = 0
  let need = 0
  let got = []
  let sysex = null
  return function read(bytes) {
    const out = []
    for (const b of bytes) {
      if (b >= 0xf8) { out.push(decodeMidi([b])); continue }
      if (b >= 0x80) {
        const whole = sysex
        sysex = null
        if (b === 0xf7) { if (whole) out.push(decodeMidi([...whole, b])); continue }
        // Any other status ends a system exclusive message that was never finished: it is let go.
        if (b === 0xf0) { sysex = [b]; status = 0; continue }
        status = b
        need = following(b)
        got = []
        if (need === 0) { out.push(decodeMidi([b])); status = 0 }
        continue
      }
      if (sysex) { sysex.push(b); continue }
      if (!status) continue
      got.push(b)
      if (got.length === need) {
        out.push(decodeMidi([status, ...got]))
        got = []
        if (status >= 0xf0) status = 0
      }
    }
    return out
  }
}

// --- the transport: Web MIDI in the page -------------------------------------------------------

/**
 * A MIDI TRANSPORT is how the desk reaches the devices. This one is the browser's own Web MIDI. A host gives its
 * own, of the same shape, as the `midi` option (docs/midi.md):
 *
 *   open()                       optional; may return a promise. Called once, when MIDI is first used: the place to ask permission
 *   inputs(), outputs()          the names of the devices there now, as lists of text
 *   send(bytes, time, output)    one whole message; `time` is in milliseconds on this page's performance.now() clock; `output` is a name, or nothing for the first
 *   receive(listener)            keeps the listener, and calls listener(bytes, time, input) for what arrives
 *   changed(listener)            optional: calls listener() when a device is plugged in or pulled out
 *   close()                      optional
 */
export function webMidi(sysex = false) {
  let access = null
  let hear = null
  let change = null
  let ins = new Map()
  let outs = new Map()
  // Two devices of the same make have the same name: the second is "name 2".
  const named = (ports) => {
    const out = new Map()
    for (const port of ports.values()) {
      if (port.state === 'disconnected') continue
      const base = port.name || port.manufacturer || 'MIDI device'
      let name = base
      for (let n = 2; out.has(name); n++) name = `${base} ${n}`
      out.set(name, port)
    }
    return out
  }
  function wire() {
    ins = named(access.inputs)
    outs = named(access.outputs)
    for (const [name, port] of ins) port.onmidimessage = (e) => hear?.(e.data, e.timeStamp, name)
  }
  return {
    async open() {
      const ask = typeof navigator !== 'undefined' && navigator.requestMIDIAccess
      if (!ask) throw Object.assign(new Error('this browser has no Web MIDI'), { name: 'NotSupportedError' })
      access = await ask.call(navigator, { sysex: !!sysex })
      wire()
      access.onstatechange = () => { wire(); change?.() }
    },
    inputs: () => [...ins.keys()],
    outputs: () => [...outs.keys()],
    send(bytes, time, output) {
      const port = output == null ? outs.values().next().value : outs.get(output)
      if (port) port.send(bytes, time)
    },
    receive(listener) { hear = listener },
    changed(listener) { change = listener },
    close() { for (const port of ins.values()) port.onmidimessage = null; if (access) access.onstatechange = null },
  }
}

// Why there is no MIDI, in plain words. One of these is said, once.
function whyNot(e, given) {
  const carry = ' The rest of your program carries on without it.'
  if (given === false) return 'MIDI is switched off for this page.' + carry
  if (given && typeof given === 'object') return `MIDI could not be started here (${(e && e.message) || e}).` + carry
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'MIDI was not allowed for this page, so MIDI devices cannot be heard or played. Allow MIDI devices for this site in the browser\'s settings and load the page again (a page inside a frame also needs allow="midi" on the frame).' + carry
  if (e && e.name === 'NotSupportedError') {
    if (typeof isSecureContext !== 'undefined' && !isSecureContext) return 'MIDI needs a page with an https address, or localhost, and this page has neither.' + carry
    return 'MIDI is not available in this browser. Use Chrome, Edge or Firefox on a computer (Safari, iPhones and iPads have no MIDI for web pages), or the Circuitry app once it supports MIDI.' + carry
  }
  return `MIDI could not be started (${(e && e.message) || e}).` + carry
}

// --- the desk: the player's side ---------------------------------------------------------------

/**
 * THE DESK carries out the `midi` commands of every sender that shares a player, and hands each what was received.
 * synths.js makes one beside a player the first time a batch has a `midi` command in it.
 *
 * @param h  what the player lends it:
 *   midi          the host's transport, `false` for none, or nothing for Web MIDI
 *   sysex         ask Web MIDI for system exclusive messages too
 *   now()         the desk's clock in milliseconds (performance.now())
 *   look          how far ahead messages are handed to the transport, in milliseconds (150; 1500 for a page out of view)
 *   offset        the seconds to add to a sender's time to get the desk's, when it is known (the offline player); else it is worked out from each batch's `now`
 *   latency()     the seconds everything is played late, so that MIDI goes out with the sound
 *   play(c, scope)       carry out one sound command now, for a scope: how a keyboard plays a synth
 *   emit(scope, events)  hand a sender what happened, as a list of plain objects
 *   tell(text, how), noteNumber(note)
 */
export function makeMidiDesk(h) {
  const now = h.now || (() => performance.now())
  const look = () => h.look ?? (typeof document !== 'undefined' && document.hidden ? 1500 : 150)
  let transport = null
  let state = 'closed'          // 'opening', 'open', or 'none' when there is no MIDI here
  let opening = null
  let queue = []
  let timer = null
  let closed = false
  let handle = 0x7e000000
  let ticks = []
  let tempo = 0
  const parsers = new Map()
  const scopes = new Map()
  const clocks = new Map()

  const scopeOf = (name) => {
    let s = scopes.get(name)
    if (!s) scopes.set(name, s = { name, listen: false, told: false, offset: h.offset || 0, routes: new Map(), maps: [], learning: [], in: { name: null, channel: null }, out: { name: null, channel: null }, ins: new Map(), outs: new Map(), through: new Map(), tunes: new Map(), sounding: new Map(), beat: null, last: 0 })
    return s
  }
  const names = (list) => { try { return Array.from(list || [], (d) => String(d && typeof d === 'object' ? d.name : d)) } catch (e) { return [] } }
  // The devices there are, said to every sender when they are first known and when one comes or goes (a browser
  // also says "changed" when a device is only opened: that is not news).
  let listed = ''
  const list = () => ({ type: 'devices', inputs: names(transport?.inputs?.()), outputs: names(transport?.outputs?.()), available: state === 'open' })
  function devices() {
    const event = list()
    const news = listed !== (listed = JSON.stringify(event))
    for (const s of scopes.values()) {
      if (!news && s.told) continue
      s.told = true
      h.emit(s.name, [event])
    }
  }

  // THE PERMISSION is asked for here, the first time a sender uses MIDI, and never before.
  function open() {
    if (opening) return opening
    const given = h.midi
    state = 'opening'
    opening = (async () => {
      try {
        transport = given === false ? null : given && typeof given === 'object' ? given : webMidi(h.sysex)
        if (!transport) throw new Error('off')
        await transport.open?.()
        if (closed) return
        transport.receive?.(heard)
        transport.changed?.(devices)
        state = 'open'
        // What was asked for long before the answer came is let go: a note played late would be wrong.
        const at = now()
        queue = queue.filter((q) => q.t > at - 250 || (q.bytes[0] & 0xf0) === 0x80)
      } catch (e) {
        state = 'none'
        transport = null
        queue = []
        h.tell(whyNot(e, given))
      }
      devices()
      pump()
    })()
    return opening
  }

  // --- sending: a queue, handed to the transport a moment before each message is due, with its exact time

  // A message goes to the output it names, or to the one its sender had chosen when it was asked for, or to the first there is.
  const enqueue = (s, bytes, t, output, from) => queue.push({ s, bytes, t, output: output ?? s.out.name ?? undefined, from })
  function deliver(q, at) {
    const [status, note, velocity] = q.bytes
    const kind = status & 0xf0
    // What is sounding is remembered, so that stopping can let it go.
    if (kind === 0x90 || kind === 0x80) {
      const k = `${q.output ?? ''}|${status & 15}|${note}`
      if (kind === 0x90 && velocity > 0) q.s.sounding.set(k, q)
      else q.s.sounding.delete(k)
    }
    q.s.last = Math.max(q.s.last, q.t)
    try { transport.send(q.bytes, Math.max(q.t, at), q.output) } catch (e) {
      h.tell(q.bytes[0] === 0xf0 ? 'a system exclusive MIDI message could not be sent: the browser allows those only when asked, with configure({ midiSysex: true }).' : `a MIDI message could not be sent (${(e && e.message) || e}).`)
    }
  }
  // Take back what a sender has waiting and let go of what it has sounding: all of it, or one synth's.
  function hush(s, from) {
    const whose = (q) => q.s === s && (from === undefined || q.from === from)
    queue = queue.filter((q) => !whose(q) || q.bytes[0] >= 0xf8)
    if (state !== 'open') return
    const at = Math.max(now(), s.last) + 1
    for (const [k, q] of [...s.sounding]) {
      if (!whose(q)) continue
      s.sounding.delete(k)
      try { transport.send([0x80 | (q.bytes[0] & 15), q.bytes[1], 0], at, q.output) } catch (e) { /* the device has gone */ }
    }
  }
  // The tunes of synths that go out as MIDI, and the clock, are written into the queue a little way ahead.
  function generate(s, limit) {
    for (const [id, tune] of s.tunes) {
      const th = s.through.get(tune.synth)
      if (!th || !Array.isArray(tune.steps) || !tune.steps.length || !(tune.length > 0)) { s.tunes.delete(id); continue }
      for (;;) {
        if (tune.step >= tune.steps.length) {
          tune.step = 0
          if (++tune.round >= tune.repeat) { s.tunes.delete(id); break }
        }
        const [at, notes, length, velocity] = tune.steps[tune.step]
        const when = tune.start + (tune.round * tune.length + at) * 1000
        if (when > limit) break
        noteOut(s, th, tune.synth, notes, velocity, when, length)
        tune.step++
      }
    }
    if (s.beat) for (; s.beat.next <= limit; s.beat.next += s.beat.gap) enqueue(s, [0xf8], s.beat.next)
  }
  function pump() {
    if (closed) return
    const at = now()
    const horizon = at + look()
    for (const s of scopes.values()) generate(s, Math.min(horizon, at + 60000))
    if (state === 'open') {
      queue.sort((a, b) => a.t - b.t)
      let n = 0
      while (n < queue.length && queue[n].t <= horizon) deliver(queue[n++], at)
      queue.splice(0, n)
    } else if (state === 'none') queue = []
    const busy = queue.length > 0 || [...scopes.values()].some((s) => s.tunes.size || s.beat)
    if (busy && !timer && Number.isFinite(look())) timer = setInterval(pump, 25)
    else if (!busy && timer) { clearInterval(timer); timer = null }
  }

  // --- a synth whose notes go out as MIDI: the desk reads the sender's own sound commands

  const noteOf = (n) => { try { return Math.round(h.noteNumber(n)) } catch (e) { return -1 } }
  // Where a synth's notes go: the channel and the output chosen for it, or else the sender's, or else channel 1 of the first output.
  const outOf = (s, id) => { const p = s.outs.get(id); return { status: (p?.channel ?? s.out.channel ?? 1) - 1, output: p?.name ?? undefined } }
  function noteOut(s, th, from, notes, velocity, t, length) {
    const { status, output } = outOf(s, from)
    const list = (notes == null ? [th.note] : [].concat(notes)).map(noteOf).filter((n) => n >= 0 && n <= 127)
    for (const n of list) {
      enqueue(s, [0x90 | status, n, clamp(Math.round((velocity ?? 0.8) * 127), 1, 127)], t, output, from)
      if (length != null) enqueue(s, [0x80 | status, n, 0], t + length * 1000, output, from)
    }
    return list
  }
  function watch(s, c, t) {
    if (c.op === 'stop' && c.id == null) { hush(s); s.tunes.clear(); return }
    if (c.op === 'stop') { s.tunes.delete(c.id); return }
    if (c.op === 'close') { does.stop(s, c, t); scopes.delete(s.name); return }
    const id = c.op === 'tune' ? c.synth : c.id
    const th = s.through.get(id)
    if (!th) return
    const { status, output } = outOf(s, id)
    const off = (notes) => { for (const n of notes || []) enqueue(s, [0x80 | status, n, 0], t, output, id) }
    if (c.op === 'note') {
      const notes = noteOut(s, th, id, c.note, c.vel, t, c.len)
      if (c.h != null && c.len == null) th.held.set(c.h, notes)
    } else if (c.op === 'off' || c.op === 'free') {
      if (c.op === 'off' && c.h != null) { off(th.held.get(c.h)); th.held.delete(c.h) }
      else if (c.op === 'off' && c.note != null) off([].concat(c.note).map(noteOf).filter((n) => n >= 0 && n <= 127))
      else {
        for (const [tid, tune] of s.tunes) if (tune.synth === id) s.tunes.delete(tid)
        th.held.clear()
        hush(s, id)
      }
    } else if (c.op === 'voice' && c.kill && c.h != null) { off(th.held.get(c.h)); th.held.delete(c.h) }
    else if (c.op === 'tune') {
      const steps = Array.isArray(c.steps) ? c.steps : []
      const length = c.length > 0 ? c.length : steps.reduce((end, step) => Math.max(end, step[0] + step[2]), 0)
      s.tunes.set(c.id, { synth: id, steps, length, repeat: c.repeat === true ? Infinity : c.repeat > 0 ? c.repeat : 1, start: t, round: 0, step: 0 })
    }
  }

  // --- receiving

  // Let go of the notes a keyboard is holding on a synth.
  function release(s, route) {
    for (const hh of route.held.values()) h.play({ op: 'off', id: route.id, h: hh }, s.name)
    route.held.clear()
    route.kept.clear()
  }
  const scaled = (k, v) => {
    if (k.kind === 'bool') return v >= 0.5
    const x = k.curve === 'exp' && k.min > 0 && k.max > 0 ? k.min * Math.pow(k.max / k.min, v) : k.min + (k.max - k.min) * v
    return k.kind === 'int' || k.kind === 'choice' ? Math.round(x) : x
  }
  // What one message does for one sender, on the page, before the sender hears of it.
  function route(s, m, events, input) {
    let mapped = false
    if (m.type === 'control' && m.control < 120) {
      // LEARNING: the next knob that is moved, and is not already tied to something, is tied to the setting that is waiting.
      if (s.learning.length && !s.maps.some((k) => k.control === m.control)) {
        const k = s.learning.shift()
        s.maps.push({ ...k, control: m.control, channel: null })
        events.push({ type: 'learned', id: k.id, setting: k.setting, control: m.control, channel: m.channel })
      }
      for (const k of s.maps) {
        if (k.control !== m.control || (k.channel != null && k.channel !== m.channel)) continue
        mapped = true
        const value = scaled(k, m.value)
        h.play({ op: 'set', id: k.id, set: { [k.setting]: value }, ...(k.kind === 'float' ? { glide: 0.02 } : {}) }, s.name)
        events.push({ type: 'set', id: k.id, setting: k.setting, value, control: m.control })
      }
    }
    if (m.channel === undefined) return
    // A KEYBOARD PLAYS A SYNTH from here, with the sender not asked: so it is as quick as the page can make it.
    for (const r of s.routes.values()) {
      const own = s.ins.get(r.id)
      if (own && ((own.channel != null && own.channel !== m.channel) || (own.name && !own.name.includes(input)))) continue
      const off = (note) => {
        if (r.held.has(note)) h.play({ op: 'off', id: r.id, h: r.held.get(note) }, s.name)
        r.held.delete(note)
        r.kept.delete(note)
      }
      if (m.type === 'noteOn') {
        off(m.note)
        handle = handle >= 0x7efffff0 ? 0x7e000001 : handle + 1
        r.held.set(m.note, handle)
        h.play({ op: 'note', id: r.id, note: [m.note], len: null, vel: m.velocity, h: handle }, s.name)
      } else if (m.type === 'noteOff') {
        // With the pedal down a key that comes up goes on sounding, until the pedal comes up.
        if (r.pedal) { if (r.held.has(m.note)) r.kept.add(m.note) } else off(m.note)
      } else if (m.type === 'bend') h.play({ op: 'set', id: r.id, set: { bend: m.bend } }, s.name)
      else if (m.type === 'control') {
        if (m.control === 64) {
          r.pedal = m.value >= 0.5
          if (!r.pedal) for (const note of [...r.kept]) off(note)
        } else if (m.control === 1 && !mapped) h.play({ op: 'set', id: r.id, set: { vibrato: r.vibrato[0] + m.value * r.vibrato[1] }, glide: 0.02 }, s.name)
        else if (m.control === 120 || m.control === 123) release(s, r)
      }
    }
  }
  function heard(bytes, time, input) {
    if (closed || !bytes) return
    input = input == null ? '' : String(input)
    let read = parsers.get(input)
    if (!read) parsers.set(input, read = midiParser())
    const messages = read(bytes)
    if (!messages.length) return
    const at = typeof time === 'number' && time > 0 ? time : now()
    // THE CLOCK another device sends is 24 ticks a beat: a beat's worth of them says how fast it is going.
    const extra = []
    for (const m of messages) {
      if (m.type === 'start') ticks = []
      if (m.type !== 'clock') continue
      ticks.push(at)
      if (ticks.length > 25) ticks.shift()
      const bpm = ticks.length === 25 ? Math.round(600000 / (at - ticks[0])) / 10 : 0
      if (bpm > 0 && Number.isFinite(bpm) && Math.abs(bpm - tempo) >= 0.5) extra.push({ type: 'tempo', bpm: tempo = bpm })
    }
    for (const s of [...scopes.values()]) {
      // Each sender hears the input and the channel it has chosen: all of them, until it chooses.
      if (s.in.name && !s.in.name.includes(input)) continue
      const events = []
      const stamp = { time: at / 1000 - s.offset, device: input }
      for (const m of messages) {
        if (s.in.channel != null && m.channel !== undefined && m.channel !== s.in.channel) continue
        route(s, m, events, input)
        if (s.listen) events.push({ ...m, ...stamp })
      }
      if (s.listen) for (const m of extra) events.push({ ...m, ...stamp })
      if (events.length) h.emit(s.name, events)
    }
  }

  // --- the commands: { op: "midi", do: … }

  const channelOf = (c) => (Number.isInteger(c.channel) && c.channel >= 1 && c.channel <= 16 ? c.channel : null)
  const mapOf = (c) => ({ id: c.id, setting: String(c.setting), control: c.control, channel: channelOf(c), min: +c.min || 0, max: typeof c.max === 'number' ? c.max : 1, curve: c.curve === 'exp' ? 'exp' : 'lin', kind: c.kind || 'float' })
  const unmap = (s, id, setting) => {
    const same = (k) => k.id === id && (setting == null || k.setting === String(setting))
    s.maps = s.maps.filter((k) => !same(k))
    s.learning = s.learning.filter((k) => !same(k))
  }
  // THE CHOICE of a device and a channel: the sender's own, or with an `id` one synth's. A field that is left out stays as it was.
  const choiceOf = (s, c, which) => {
    if (c.id == null) return s[which === 'ins' ? 'in' : 'out']
    if (!s[which].has(c.id)) s[which].set(c.id, { name: null, channel: null })
    return s[which].get(c.id)
  }
  const does = {
    devices() {},
    listen(s, c) { s.listen = c.on !== false },
    input(s, c) {
      const p = choiceOf(s, c, 'ins')
      if ('name' in c) p.name = c.name == null ? null : [].concat(c.name).map(String)
      if ('channel' in c) p.channel = channelOf(c)
      // A key that is down is let go: its coming up may never be heard now.
      for (const r of s.routes.values()) if (c.id == null || r.id === c.id) release(s, r)
    },
    output(s, c) {
      const p = choiceOf(s, c, 'outs')
      if ('name' in c) p.name = c.name == null ? null : String(c.name)
      if ('channel' in c) p.channel = channelOf(c)
      // The notes a synth has sounding where it was sending are let go there.
      for (const [id, th] of s.through) if (c.id == null || id === c.id) { th.held.clear(); hush(s, id) }
    },
    send(s, c, t) {
      const bytes = Array.isArray(c.bytes) || ArrayBuffer.isView(c.bytes) ? Array.from(c.bytes, (b) => b & 255) : []
      if (bytes.length && bytes[0] >= 0x80) enqueue(s, bytes, t, c.output == null ? undefined : String(c.output))
    },
    play(s, c) {
      const had = s.routes.get(c.id)
      if (c.on === false) { if (had) release(s, had); s.routes.delete(c.id); return }
      const vibrato = Array.isArray(c.vibrato) ? [+c.vibrato[0] || 0, +c.vibrato[1] || 0] : [0, 0.5]
      choiceOf(s, c, 'ins').channel = channelOf(c)
      s.routes.set(c.id, { id: c.id, vibrato, held: had ? had.held : new Map(), kept: had ? had.kept : new Set(), pedal: had ? had.pedal : false })
    },
    through(s, c) {
      if (c.on === false) { hush(s, c.id); s.through.delete(c.id); return }
      Object.assign(choiceOf(s, c, 'outs'), { channel: channelOf(c), name: c.output == null ? null : String(c.output) })
      s.through.set(c.id, { note: c.note ?? 60, held: s.through.get(c.id)?.held || new Map() })
    },
    map(s, c) {
      if (!Number.isInteger(c.control) || c.setting == null) return
      unmap(s, c.id, c.setting)
      s.maps.push(mapOf(c))
    },
    learn(s, c) {
      if (c.setting == null) return
      unmap(s, c.id, c.setting)
      s.learning.push(mapOf(c))
    },
    unmap(s, c) { unmap(s, c.id, c.setting) },
    // THE CLOCK this sender sends: a start, then 24 ticks a beat until it is stopped.
    clock(s, c, t) {
      if (c.on === false) {
        if (!s.beat) return
        queue = queue.filter((q) => q.s !== s || q.bytes[0] !== 0xf8 || q.t <= t)
        enqueue(s, [0xfc], t)
        s.beat = null
        return
      }
      const gap = 60000 / (clamp(+c.bpm || 120, 20, 400) * 24)
      if (s.beat) s.beat.gap = gap
      else { enqueue(s, [0xfa], t); s.beat = { next: t, gap } }
    },
    // Everything of this sender's MIDI: its notes let go, and nothing played, sent on or tied to a knob any more.
    stop(s, c, t) {
      if (s.beat) does.clock(s, { on: false }, t)
      hush(s)
      for (const r of s.routes.values()) release(s, r)
      Object.assign(s, { listen: false, maps: [], learning: [] })
      s.routes.clear()
      s.through.clear()
      s.tunes.clear()
    },
  }

  /** Carry out a batch: its `midi` commands, and the sound commands of synths whose notes go out as MIDI. `at` is when it arrived. */
  function take(batch, at = now()) {
    if (closed || !batch || !Array.isArray(batch.cmds)) return
    const name = batch.scope || ''
    // The sender's clock is lined up with the desk's as the player lines it up with the sound card's: the shortest journey seen is the difference.
    let offset = h.offset
    if (offset === undefined) {
      const known = clocks.get(batch.clock || '')
      if (typeof batch.now === 'number') {
        const seen = at / 1000 - batch.now
        offset = known ? Math.min(seen, known[0] + 0.0005 * Math.max(0, at / 1000 - known[1])) : seen
        clocks.set(batch.clock || '', [offset, at / 1000])
      } else if (known) offset = known[0]
    }
    let used = false
    for (const c of batch.cmds) {
      if (!c || (c.op !== 'midi' && !scopes.has(name))) continue
      const s = scopeOf(name)
      if (offset !== undefined) s.offset = offset
      const t = (typeof c.t === 'number' && offset !== undefined ? (c.t + offset) * 1000 : at) + (h.latency ? h.latency() * 1000 : 0)
      if (c.op !== 'midi') { watch(s, c, t); continue }
      used = true
      does[c.do]?.(s, c, t)
    }
    if (used) {
      const s = scopes.get(name)
      if (state === 'closed') open()
      else if (state !== 'opening' && s && !s.told) { s.told = true; h.emit(name, [list()]) }
    }
    if (scopes.size) pump()
  }

  function close() {
    if (closed) return
    for (const s of scopes.values()) hush(s)
    closed = true
    if (timer) clearInterval(timer)
    timer = null
    try { transport?.close?.() } catch (e) { /* already gone */ }
  }

  return { take, pump, close, get state() { return state } }
}

// --- the functions: the sender's side ----------------------------------------------------------

/** The functions synths.js gives a program, and the ones every synth has. */
export const MIDI_FUNCTIONS = ['onMidi', 'onMidiNote', 'onMidiNoteOff', 'onMidiControl', 'onMidiDevices', 'useMidiHooks', 'sendMidi', 'sendMidiNote', 'sendMidiNoteOff', 'sendMidiControl', 'sendMidiBend', 'sendMidiProgram', 'sendMidiClock', 'midiDevices', 'useMidiInput', 'useMidiOutput', 'midiInput', 'midiOutput', 'receiveMidi', 'stopMidi']
export const MIDI_SYNTH_FUNCTIONS = ['playFromMidi', 'sendToMidi', 'mapMidi', 'learn', 'unmapMidi', 'midiInput', 'midiOutput']
/** What midiInput() and midiOutput() can be asked for by name, and the words among their choices that are not a device or a channel. */
export const MIDI_CHOICES = { settings: ['device', 'channel'], all: 'all', none: 'no devices', unavailable: 'no MIDI here' }
const tick = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * THE FUNCTIONS. They write `midi` commands and call the program's own functions with what is received.
 *
 * @param h  what createSound lends it:
 *   command(c)            add a command to the batch
 *   clock(), when(o, said)   the sender's clock, and when a call with { after, at, beat } should happen
 *   listen(fn)            ask the transport to hand fn what the desk emits; gives back a function that stops it
 *   tempo()               beats a minute
 *   api                   createSound's own functions (setTempo is wrapped so that a clock being sent follows it)
 *   choices, notesOf, shown, amount, length(value, said), meant, tell, remember(synth, setting, value)
 *   storage               where the device chosen on the screen is kept for next time, shaped like localStorage (the page's own if there is none; `false` for nowhere)
 */
export function makeMidiApi(h) {
  const on = { all: new Set(), note: new Set(), noteOff: new Set(), control: new Set(), devices: new Set() }
  let devices = { inputs: [], outputs: [], available: null }
  let listening = false
  let joined = null
  let clockOn = false
  let asked = false
  /** Synths with a setting tied to a knob: id -> setting -> { synth, changed }. */
  const bound = new Map()
  /** The device and the channel chosen, for 'input' and for 'output': id -> { device, channel, … }. The id '' is the program's own choice, the others a synth's. */
  const chosen = { input: new Map(), output: new Map() }

  // Every MIDI call sends a command (which is what makes the desk ask for permission) and makes sure this sender is handed what the desk says.
  function midi(c) {
    h.command({ op: 'midi', ...c })
    if (!joined) joined = h.listen(receive) || (() => {})
  }
  const ask = () => { if (!asked) { asked = true; midi({ do: 'devices' }) } }
  const listen = () => { if (!listening) { listening = true; midi({ do: 'listen' }) } }
  const call = (fns, ...args) => { for (const fn of [...fns]) { try { fn(...args) } catch (e) { console.error(e) } } }

  /** What the desk says happened, as a list of plain objects: the program's functions are called with it. */
  function receive(events) {
    for (const m of Array.isArray(events) ? events : [events]) {
      if (!m || typeof m !== 'object') continue
      if (m.type === 'devices') {
        devices = { inputs: [...(m.inputs || [])], outputs: [...(m.outputs || [])], available: !!m.available }
        arrived()
        call(on.devices, api.midiDevices())
      } else if (m.type === 'set') {
        // A knob turned a setting on the page: the synth here is told, so that reading it back gives what it is.
        const b = bound.get(m.id)?.get(m.setting)
        if (b) { h.remember(b.synth, m.setting, m.value); if (b.changed) call([b.changed], b.synth.get(m.setting), m.setting) }
      } else if (m.type === 'noteOn') call(on.note, m.note, m.velocity, m.channel)
      else if (m.type === 'noteOff') { if (on.noteOff.size) call(on.noteOff, m.note, m.channel); else call(on.note, m.note, 0, m.channel) }
      else if (m.type === 'control') call(on.control, m.control, m.value, m.channel)
      if (m.channel !== undefined) light(m)
      call(on.all, m)
    }
  }

  const callback = (name, fn, example) => {
    if (typeof fn !== 'function') throw new Error(`${name} needs a function to call, as in ${name}(${example} => { ... }), not ${h.shown(fn)}`)
    return fn
  }
  const channelOf = (o, said) => {
    const channel = o.channel ?? choice('output').channel ?? 1
    if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new Error(`${said}: channel needs a whole number from 1 to 16, not ${h.shown(channel)}`)
    return channel - 1
  }
  const whole = (value, said, what, most = 127) => {
    if (!Number.isInteger(value) || value < 0 || value > most) throw new Error(`${said} needs ${what}, a whole number from 0 to ${most}, not ${h.shown(value)}`)
    return value
  }
  const seven = (v) => clamp(Math.round(v * 127), 0, 127)
  const optionsOf = (o, said) => {
    if (o === undefined || o === null) return {}
    if (typeof o !== 'object' || Array.isArray(o)) throw new Error(`${said}: the options go in braces, as in { channel: 2, after: 0.5 }, not ${h.shown(o)}`)
    return o
  }
  // Notes as MIDI has them: whole numbers from 0 to 127.
  const notesOut = (what, said) => h.notesOf(what).map((n) => {
    const note = Math.round(n)
    if (note < 0 || note > 127) throw new Error(`${said}: MIDI has the notes 0 to 127 ("C-1" to "G9"), and ${h.shown(what)} is outside them`)
    return note
  })
  function out(bytes, t, o) {
    const c = { do: 'send', bytes, t }
    if (o.output != null) c.output = String(o.output)
    midi(c)
  }
  // A setting of a synth that a knob can turn: its range, and whether it moves by ratio (a pitch in Hz) or by amount.
  function turning(synth, setting, rest, said) {
    const o = {}
    let changed = null
    for (const arg of rest) {
      if (typeof arg === 'function') changed = arg
      else if (arg && typeof arg === 'object') Object.assign(o, arg)
    }
    if (typeof setting !== 'string') throw new Error(`${said} needs the name of a setting, as in ${said === 'learn' ? 'lead.learn("cutoff")' : 'lead.mapMidi(74, "cutoff")'}, not ${h.shown(setting)}`)
    const d = synth.describe(setting)
    if (!d) throw new Error(`${said}: there is no setting called ${h.shown(setting)}.${h.meant(setting)}`)
    const min = o.min ?? d.min
    const max = o.max ?? d.max
    if (typeof min !== 'number' || typeof max !== 'number') throw new Error(`${said}: min and max need numbers, not ${h.shown(o.min)} and ${h.shown(o.max)}`)
    if (!bound.has(synth._id)) bound.set(synth._id, new Map())
    bound.get(synth._id).set(setting, { synth, changed: o.onChange || o.on_change || changed })
    const c = { id: synth._id, setting, min, max, kind: d.kind, curve: /^hz$/i.test(d.unit || '') && min > 0 && max / min >= 100 ? 'exp' : 'lin' }
    if (o.channel !== undefined) c.channel = channelOf(o, said) + 1
    return c
  }

  const api = {
    /** Everything that arrives, decoded: onMidi((message) => { ... }). */
    onMidi(fn) { on.all.add(callback('onMidi', fn, '(message)')); listen() },
    /** A key went down: onMidiNote((note, velocity, channel) => { ... }). Velocity 0 is the key coming up, unless onMidiNoteOff is used. */
    onMidiNote(fn) { on.note.add(callback('onMidiNote', fn, '(note, velocity)')); listen() },
    /** A key came up: onMidiNoteOff((note, channel) => { ... }). */
    onMidiNoteOff(fn) { on.noteOff.add(callback('onMidiNoteOff', fn, '(note)')); listen() },
    /** A knob, slider or pedal moved: onMidiControl((number, value, channel) => { ... }), value from 0 to 1. */
    onMidiControl(fn) { on.control.add(callback('onMidiControl', fn, '(number, value)')); listen() },
    /** The devices are known, or one was plugged in or pulled out: onMidiDevices(({ inputs, outputs, available }) => { ... }). */
    onMidiDevices(fn) {
      on.devices.add(callback('onMidiDevices', fn, '(devices)'))
      if (devices.available !== null) call([fn], api.midiDevices())
      else ask()
    },
    /**
     * For an app that runs scenes: a scene's own functions called onMidiNote, onMidiNoteOff, onMidiControl, onMidi and
     * onMidiDevices (or their Python spellings) are called with what arrives. Give it an object that has them.
     */
    useMidiHooks(hooks) {
      if (!hooks || (typeof hooks !== 'object' && typeof hooks !== 'function')) throw new Error(`useMidiHooks needs an object with functions such as onMidiNote in it, not ${h.shown(hooks)}`)
      for (const name of ['onMidi', 'onMidiNote', 'onMidiNoteOff', 'onMidiControl', 'onMidiDevices']) {
        const fn = hooks[name] || hooks[name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())]
        if (typeof fn === 'function') api[name](fn)
      }
    },

    /** Any message, as its bytes: sendMidi([0x90, 60, 100]), with { after, at, beat, output }. */
    sendMidi(bytes, o) {
      o = optionsOf(o, 'sendMidi')
      const list = Array.isArray(bytes) || ArrayBuffer.isView(bytes) ? Array.from(bytes) : null
      if (!list || !list.length || list.some((b) => !Number.isInteger(b) || b < 0 || b > 255) || list[0] < 0x80) throw new Error(`sendMidi needs the bytes of a MIDI message, beginning with its status byte, as in sendMidi([0x90, 60, 100]), not ${h.shown(bytes)}`)
      out(list, h.when(o, 'sendMidi'), o)
    },
    /** A note out: sendMidiNote("C4", 0.8, { length: 0.5, channel: 1 }). It is let go after `length` (seconds, or a note length such as "eighth"); `length: null` holds it until sendMidiNoteOff. */
    sendMidiNote(...args) {
      const o = h.choices(args, ['note', 'velocity', 'length'])
      const said = 'sendMidiNote'
      if (o.note === undefined || o.note === null) throw new Error('sendMidiNote needs a note, as in sendMidiNote("C4")')
      const notes = notesOut(o.note, said)
      const velocity = o.velocity === undefined ? 0.8 : h.amount(o.velocity, `${said}: velocity`)
      const length = o.length === undefined ? 0.5 : o.length === null ? null : h.length(o.length, `${said}: the length`)
      const channel = channelOf(o, said)
      const t = h.when(o, said)
      for (const note of notes) {
        if (velocity > 0) out([0x90 | channel, note, Math.max(1, seven(velocity))], t, o)
        if (length !== null || !(velocity > 0)) out([0x80 | channel, note, 0], t + (velocity > 0 ? length : 0), o)
      }
    },
    /** Let go of a note that sendMidiNote is holding: sendMidiNoteOff("C4"). */
    sendMidiNoteOff(note, o) {
      o = optionsOf(o, 'sendMidiNoteOff')
      if (note === undefined || note === null) throw new Error('sendMidiNoteOff needs a note, as in sendMidiNoteOff("C4")')
      const channel = channelOf(o, 'sendMidiNoteOff')
      const t = h.when(o, 'sendMidiNoteOff')
      for (const n of notesOut(note, 'sendMidiNoteOff')) out([0x80 | channel, n, 0], t, o)
    },
    /** Turn a knob on the other device: sendMidiControl(74, 0.5). The number is the control's, 0 to 127; the value is from 0 to 1. */
    sendMidiControl(number, value, o) {
      o = optionsOf(o, 'sendMidiControl')
      const said = 'sendMidiControl'
      out([0xb0 | channelOf(o, said), whole(number, said, 'the number of a control'), seven(h.amount(value, `${said}: the value`))], h.when(o, said), o)
    },
    /** Bend the pitch on the other device: sendMidiBend(0.5), from -1 to 1, and 0 to let it go back. */
    sendMidiBend(bend, o) {
      o = optionsOf(o, 'sendMidiBend')
      out(encodeMidi({ type: 'bend', channel: channelOf(o, 'sendMidiBend') + 1, bend: h.amount(bend, 'sendMidiBend', -1, 1) }), h.when(o, 'sendMidiBend'), o)
    },
    /** Choose a sound on the other device by its number: sendMidiProgram(5). */
    sendMidiProgram(number, o) {
      o = optionsOf(o, 'sendMidiProgram')
      out([0xc0 | channelOf(o, 'sendMidiProgram'), whole(number, 'sendMidiProgram', 'the number of a sound')], h.when(o, 'sendMidiProgram'), o)
    },
    /** Send the beat to other devices, so that their own sequencers keep time with setTempo: sendMidiClock(), and sendMidiClock(false) to stop. */
    sendMidiClock(send = true) {
      clockOn = send !== false
      midi({ do: 'clock', on: clockOn, bpm: h.tempo(), t: h.clock() })
    },

    /** The devices there are: { inputs: [names], outputs: [names], available }. `available` is null until the browser has answered. */
    midiDevices() {
      ask()
      return { inputs: [...devices.inputs], outputs: [...devices.outputs], available: devices.available }
    },
    /** Listen to one input by its name (or a list of names), instead of all of them: useMidiInput("Keystation"). No name: all again. */
    useMidiInput(name) { setDevice('input', '', name, 'useMidiInput') },
    /** Send to one output by its name, instead of the first: useMidiOutput("Minilogue"). No name: the first again. */
    useMidiOutput(name) { setDevice('output', '', name, 'useMidiOutput') },
    /**
     * The input a program hears, or with a synth the one that synth plays from, as something a control can be tied to:
     * get("device"), set("device", name), describe("device").choices (and the same for "channel"), level() and notes().
     */
    midiInput(synth) { return port('input', synth) },
    /** The output a program sends to, or with a synth the one that synth's notes go to: "device" and "channel", the same way. */
    midiOutput(synth) { return port('output', synth) },
    // What a midiInput() or midiOutput() that was asked for before this file arrived passes on.
    setMidiChoice(which, synth, name, value) { port(which, synth).set(name, value) },
    watchMidiChoice(which, synth, fn) { return port(which, synth).onChange(fn) },

    /** For an app whose player is elsewhere: hand this what the player's onMidi gave, and the program's functions are called. */
    receiveMidi: receive,
    /** Finished with MIDI: every function forgotten, nothing played from a keyboard, sent on or tied to a knob, and the notes sent out let go. */
    stopMidi() {
      for (const fns of Object.values(on)) fns.clear()
      bound.clear()
      for (const p of chosen.input.values()) if (p.lit) Object.assign(p.lit, { level: 0, held: new Set() })
      listening = clockOn = false
      midi({ do: 'stop', t: h.clock() })
    },

    // --- what every synth has: the synth is handed over first

    /** lead.playFromMidi(): a MIDI keyboard plays this synth. { channel: 2 } listens to one channel; lead.playFromMidi(false) stops. */
    playFromMidi(synth, o) {
      if (o === false) { midi({ do: 'play', id: synth._id, on: false }); return synth }
      o = optionsOf(o, 'playFromMidi')
      const c = { do: 'play', id: synth._id, vibrato: [synth.get('vibrato') || 0, o.vibrato === undefined ? 0.5 : h.amount(o.vibrato, 'playFromMidi: vibrato', 0, 12)] }
      // The channel is the synth's own choice, which midiInput() shows: one that is not said stays as it was.
      const p = choice('input', synth._id)
      if (o.channel !== undefined) { p.channel = channelFrom(o.channel, 'playFromMidi', true); changed(p, 'channel') }
      if (p.channel != null) c.channel = p.channel
      midi(c)
      return synth
    },
    /** lead.sendToMidi(): what this synth plays also goes out as MIDI. { channel: 2, output: name }; lead.sendToMidi(false) stops. */
    sendToMidi(synth, o) {
      if (o === false) { midi({ do: 'through', id: synth._id, on: false }); return synth }
      o = optionsOf(o, 'sendToMidi')
      const p = choice('output', synth._id)
      if (o.channel !== undefined) p.channel = channelFrom(o.channel, 'sendToMidi', false)
      if (o.output !== undefined) setDevice('output', synth._id, o.output, 'sendToMidi', true)
      const c = { do: 'through', id: synth._id, note: synth._note }
      if (p.channel != null) c.channel = p.channel
      const output = there('output', p)
      if (output) c.output = output[0]
      p.sent = JSON.stringify(output ? output[0] : null)
      midi(c)
      if (o.channel !== undefined) changed(p, 'channel')
      return synth
    },
    /** lead.mapMidi(74, "cutoff"): knob 74 turns the cutoff, through the setting's own range. A function is called with each new value; { min, max, channel } narrow it. */
    mapMidi(synth, control, setting, ...rest) {
      if (!Number.isInteger(control) || control < 0 || control > 119) throw new Error(`mapMidi needs the number of a knob or slider, from 0 to 119, and then a setting, as in lead.mapMidi(74, "cutoff"), not ${h.shown(control)}`)
      midi({ do: 'map', control, ...turning(synth, setting, rest, 'mapMidi') })
      return synth
    },
    /** lead.learn("cutoff"): the next knob or slider that is moved turns the cutoff from then on. */
    learn(synth, setting, ...rest) {
      midi({ do: 'learn', ...turning(synth, setting, rest, 'learn') })
      return synth
    },
    /** lead.unmapMidi("cutoff"): no knob turns it any more. With no name: none of this synth's settings. */
    unmapMidi(synth, setting) {
      if (setting === undefined) bound.delete(synth._id)
      else bound.get(synth._id)?.delete(setting)
      midi(setting === undefined ? { do: 'unmap', id: synth._id } : { do: 'unmap', id: synth._id, setting })
      return synth
    },

    close() { if (typeof joined === 'function') joined() },
  }

  // --- THE CHOICE of a device and a channel: the program's own, and each synth's. useMidiInput and a select on the
  // screen set the same thing. The desk is told a device only while it is there: one that is not, or that is
  // pulled out, leaves every input listened to (or the first output sent to) until it appears, which is said once.

  const W = MIDI_CHOICES
  function choice(which, id = '') {
    let p = chosen[which].get(id)
    if (!p) chosen[which].set(id, p = { which, id, device: null, channel: null, sent: 'null', seen: false, gone: false, watchers: new Set(), lit: null, target: null })
    return p
  }
  // The devices chosen that are there now, or null. Until the devices are known a choice is taken at its word.
  function there(which, p) {
    if (p.device == null) return null
    const known = devices[which + 's']
    const list = [].concat(p.device).filter((n) => devices.available === null || known.includes(n))
    return list.length ? list : null
  }
  const changed = (p, name) => call(p.watchers, name)
  const withId = (p, c) => (p.id === '' ? c : { ...c, id: p.id })
  // Tell the desk the device, if what it was last told is no longer so.
  function sync(p) {
    const list = there(p.which, p)
    const name = !list ? null : list.length === 1 || p.which === 'output' ? list[0] : list
    if (p.sent === (p.sent = JSON.stringify(name))) return
    midi(withId(p, { do: p.which, name }))
  }
  const listed = (which) => (devices[which + 's'].length ? `The ${which}s are: ${devices[which + 's'].map(h.shown).join(', ')}` : `No MIDI ${which} is plugged in`)
  const meanwhile = (which) => (which === 'input' ? 'every input is listened to' : 'what is sent goes to the first output there is')
  // The devices are known, or one has come or gone.
  function arrived() {
    for (const which of ['input', 'output']) {
      for (const p of chosen[which].values()) {
        if (p.device != null && devices.available) {
          const here = !!there(which, p)
          if (here) { p.seen = true; p.gone = false } else if (!p.gone) {
            p.gone = true
            const name = h.shown([].concat(p.device)[0])
            h.tell(p.seen ? `the MIDI ${which} ${name} is not there any more, so ${meanwhile(which)}. It is chosen again if it comes back.` : `there is no MIDI ${which} called ${name} at the moment. ${listed(which)}. Until it appears ${meanwhile(which)}.`)
          }
          sync(p)
        }
        changed(p, 'device')
      }
    }
  }
  function setDevice(which, id, name, said, quiet) {
    if (name !== undefined && name !== null && typeof name !== 'string' && !(which === 'input' && Array.isArray(name) && name.every((n) => typeof n === 'string'))) throw new Error(`${said} needs the name of a MIDI device, as in ${said}(midiDevices().${which}s[0]), not ${h.shown(name)}`)
    const p = choice(which, id)
    const none = name == null || name === '' || name === W.none || name === W.unavailable || (which === 'input' && name === W.all) || (Array.isArray(name) && !name.length)
    Object.assign(p, { device: none ? null : name, seen: false, gone: false })
    if (!none && devices.available) {
      if (there(which, p)) p.seen = true
      else {
        p.gone = true
        h.tell(`${said}(${h.shown(name)}): there is no MIDI ${which} called ${h.shown([].concat(name)[0])} at the moment. ${listed(which)}. Until it appears ${meanwhile(which)}.`)
      }
    }
    if (!quiet) sync(p)
    changed(p, 'device')
    // A synth with no output of its own follows the program's.
    if (which === 'output' && id === '') for (const other of chosen.output.values()) if (other !== p) changed(other, 'device')
    return p
  }
  // A channel as it may be said: 3, "3", and for an input "all" (or nothing) for every channel.
  function channelFrom(value, said, all) {
    if (all && (value === null || value === W.all || value === 0 || value === '0' || value === '')) return null
    const n = typeof value === 'string' && /^\d+$/.test(value) ? +value : value
    if (!Number.isInteger(n) || n < 1 || n > 16) throw new Error(`${said}: channel needs ${all ? '"all" or ' : ''}a whole number from 1 to 16, not ${h.shown(value)}`)
    return n
  }
  // Where the device chosen on the screen is kept for next time. No storage, or one that refuses, is no trouble.
  function kept(which, name) {
    try {
      const store = h.storage === false ? null : h.storage || (typeof document !== 'undefined' ? globalThis.localStorage : null)
      if (!store) return null
      const key = 'synths.midi.' + which
      if (name === undefined) return store.getItem(key)
      if (name === null) store.removeItem(key)
      else store.setItem(key, name)
    } catch (e) { /* a page that may keep nothing */ }
    return null
  }
  // AN ACTIVITY LIGHT: a note lights an input as hard as it was hit and anything else a little, and the light fades.
  function light(m) {
    for (const p of chosen.input.values()) {
      if (!p.lit) continue
      if (p.id !== '') {
        const own = there('input', p)
        if ((p.channel != null && p.channel !== m.channel) || (own && devices.available && !own.includes(m.device))) continue
      }
      if (m.type === 'noteOff') { p.lit.held.delete(m.note); continue }
      if (m.type === 'noteOn') p.lit.held.add(m.note)
      else if (m.type === 'control' && (m.control === 120 || m.control === 123)) p.lit.held.clear()
      const level = m.type === 'noteOn' ? m.velocity : 0.25
      if (level >= levelOf(p)) Object.assign(p.lit, { level, at: tick() })
    }
  }
  const levelOf = (p) => { const v = p.lit ? p.lit.level * Math.pow(0.5, (tick() - p.lit.at) / 90) : 0; return v < 0.02 ? 0 : v }

  /** What midiInput() and midiOutput() give: a target for a control (set, get, describe), and plain properties for code. */
  function port(which, synth) {
    const input = which === 'input'
    const id = synth ? synth._id : ''
    const p = choice(which, id)
    if (p.target) return p.target
    const said = input ? 'midiInput' : 'midiOutput'
    const mine = () => (id === '' ? null : choice(which))
    const deviceNow = () => {
      if (devices.available === false) return W.unavailable
      const known = devices[which + 's']
      if (!known.length) return W.none
      const own = there(which, p)
      if (input) return own ? own[0] : W.all
      return own?.[0] ?? (mine() && there(which, mine())?.[0]) ?? known[0]
    }
    const channelNow = () => (input ? p.channel ?? W.all : p.channel ?? mine()?.channel ?? 1)
    const watch = () => { if (!p.lit) p.lit = { level: 0, at: 0, held: new Set() }; listen() }
    const t = {
      names: [...W.settings],
      get(name) { return name === 'device' ? deviceNow() : name === 'channel' ? String(channelNow()) : undefined },
      set(name, value) {
        if (name === 'device') {
          if (devices.available === false && value !== W.unavailable && value != null) return t
          setDevice(which, id, value, `${said}().device`)
          if (id === '') kept(which, typeof p.device === 'string' ? p.device : null)
        } else if (name === 'channel') {
          const channel = channelFrom(value, `${said}()`, input)
          if (channel !== p.channel) {
            p.channel = channel
            midi(withId(p, { do: which, channel }))
            changed(p, 'channel')
            if (!input && id === '') for (const other of chosen.output.values()) if (other !== p) changed(other, 'channel')
          }
        } else throw new Error(`${said}() has "device" and "channel", and no ${h.shown(name)}`)
        return t
      },
      /** What a control needs to know: the choices there are NOW. They change as devices come and go: onChange says when. */
      describe(name) {
        if (name === 'device') {
          const known = devices[which + 's']
          const choices = devices.available === false ? [W.unavailable] : !known.length ? [W.none] : input ? [W.all, ...known] : [...known]
          return { name, kind: 'text', choices, default: choices[0] }
        }
        if (name === 'channel') {
          const numbers = Array.from({ length: 16 }, (_, i) => String(i + 1))
          return { name, kind: 'text', choices: input ? [W.all, ...numbers] : numbers, default: input ? W.all : '1' }
        }
        return undefined
      },
      /** midiIn.onChange((name) => { ... }): called with "device" or "channel" when its value or its choices change. It gives back a function that stops it. */
      onChange(fn) { p.watchers.add(callback(`${said}().onChange`, fn, '(name)')); return () => p.watchers.delete(fn) },
      get device() { return deviceNow() },
      set device(name) { t.set('device', name) },
      get channel() { return channelNow() },
      set channel(channel) { t.set('channel', channel) },
    }
    t.on_change = t.onChange
    if (input) {
      /** How hard the last note was hit, fading: from 0 to 1, for a meter that is an activity light. */
      t.level = () => { watch(); return levelOf(p) }
      /** The keys held down on this input now, as numbers. */
      t.notes = () => { watch(); return [...p.lit.held] }
    }
    p.target = t
    // The device chosen on the screen last time, unless the program has said one itself.
    if (id === '' && p.device == null) {
      const last = kept(which)
      if (typeof last === 'string' && last) { Object.assign(p, { device: last, gone: true }); sync(p) }
    }
    ask()
    return t
  }

  // A clock that is being sent keeps up with setTempo.
  const setTempo = h.api.setTempo
  h.api.setTempo = h.api.set_tempo = (bpm) => {
    setTempo(bpm)
    if (clockOn) midi({ do: 'clock', bpm: h.tempo(), t: h.clock() })
  }

  return api
}
