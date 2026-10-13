// synths.js: the audio worklet. Made from synths.js by scripts/sync-engine.mjs; do not edit.
const makeCore = function makeCore(wasm, sampleRate, post) {
  let memory = null
  // The four functions the module asks for are never called while it works; they are for the case of a crash.
  const wasi = {
    fd_write(fd, iovs, count, written) {
      const v = new DataView(memory.buffer)
      let total = 0
      for (let i = 0; i < count; i++) total += v.getUint32(iovs + i * 8 + 4, true)
      v.setUint32(written, total, true)
      return 0
    },
    environ_sizes_get(count, size) {
      const v = new DataView(memory.buffer)
      v.setUint32(count, 0, true)
      v.setUint32(size, 0, true)
      return 0
    },
    environ_get() { return 0 },
    proc_exit(code) { throw new Error('synths-core stopped (' + code + ')') },
  }
  const module = wasm instanceof WebAssembly.Module ? wasm : new WebAssembly.Module(wasm)
  const x = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi }).exports
  memory = x.memory
  const engine = x.synths_create(sampleRate)
  if (!engine) throw new Error('the engine could not start at ' + sampleRate + ' frames a second')
  const eventsAt = x.synths_event_buffer(engine)
  const eventRoom = x.synths_event_capacity()
  const outRoom = x.synths_output_capacity()
  const NOTE_ON = 1, NOTE_OFF = 2, ALL_OFF = 3, SONG = 15, RECORD = 16, EVERY = 0xffff

  /** Events not yet handed to the engine: [frame, type, part, a, x, y, z, b], soonest first. */
  const queue = []
  /** Tunes that are playing: id -> { part, steps, length, start, cycle, i, repeat }. */
  const tunes = new Map()
  let handle = 0xc0000000
  let events = null, left = null, right = null

  const core = {
    /** Frames rendered so far: the engine's clock. */
    time: 0,
    /** Add this to a time of the sound card (in frames) to get the engine's time. The host keeps it right. */
    delta: 0,
    sampleRate,
    abi: x.synths_abi_version(),
    exports: Object.keys(x),
    voices: () => x.synths_active_voices(engine),
    exec,
    render,
    taps,
    songPosition,
    packSong,
    pushInput,
    close() { x.synths_destroy(engine) },
  }

  // A time of the sound card in seconds -> the engine's frame. Nothing is ever earlier than now, so things
  // that arrive late keep the order they were asked in.
  const frameOf = (seconds) => (seconds == null ? core.time : Math.max(core.time, Math.round(seconds * sampleRate + core.delta)))

  function add(frame, type, part, a, xv, y, z, b) {
    let low = 0, high = queue.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (queue[mid][0] <= frame) low = mid + 1
      else high = mid
    }
    queue.splice(low, 0, [frame, type, part, a, xv, y, z || 0, b || 0])
  }

  function exec(ops) {
    for (const op of ops) {
      const kind = op[0]
      if (kind === 'e') {
        // A note that reaches this thread more than a quarter of a second after it was due is not started:
        // a page that was stuck would otherwise have all its late notes at once.
        if (op[2] === NOTE_ON && op[1] != null && op[1] * sampleRate + core.delta < core.time - sampleRate / 4) continue
        add(frameOf(op[1]), op[2], op[3], op[4], op[5], op[6] || 0, op[7], op[8])
      } else if (kind === 'macro') setMacro(op)
      else if (kind === 'sample') loadSample(op)
      else if (kind === 'unsample') x.synths_sample_free(engine, op[1])
      else if (kind === 'tune') {
        // A tune's times are in units: seconds, or beats when it has a `beat` (the seconds in a beat, which a
        // change of tempo for its group alters as it plays).
        const [, id, at, part, steps, length, repeat, beat, group] = op
        const unit = (beat || 1) * sampleRate
        if (steps.length && length * unit >= 1) tunes.set(id, { part, steps, length, unit, start: frameOf(at), cycle: 0, i: 0, repeat: repeat || Infinity, beats: !!beat, group })
      } else if (kind === 'tempo') {
        // From this frame on a beat lasts so long: every tune in beats of the group carries on from the beat it had reached.
        // It waits for its frame, so the notes before it keep the old tempo.
        tempos.push([frameOf(op[3]), op[1], op[2]])
        tempos.sort((a, b) => a[0] - b[0])
      } else if (kind === 'stopTune') tunes.delete(op[1])
      else if (kind === 'stopPart') {
        // Let go of what the part is playing, and take back what it has not started.
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i][1] === NOTE_ON && queue[i][2] === op[1]) queue.splice(i, 1)
        for (const [id, tune] of tunes) if (tune.part === op[1]) tunes.delete(id)
        add(core.time, ALL_OFF, op[1], op[2] ? 1 : 0, 0, 0)
      } else if (kind === 'stop') {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i][1] === NOTE_ON) queue.splice(i, 1)
        tunes.clear()
        add(core.time, ALL_OFF, EVERY, 1, 0, 0)
        if (songLoaded) add(core.time, SONG, 0, 0, 0, 0)
      } else if (kind === 'songLoad') loadSong(op)
      else if (kind === 'songUnload') { if (x.synths_song_unload) x.synths_song_unload(engine); songLoaded = false }
      else if (kind === 'record') record(op)
      else if (kind === 'recordStop') recordStop(op)
      else if (kind === 'sampleRead') readSample(op)
      else if (kind === 'sampleConfig') {
        // A loop or a base note for a sample that is already there (a recording, when it is done).
        const [, slot, base, loopMode, loopStart, loopEnd] = op
        const had = kept.get(slot) || { channels: 1, base: 60 }
        if (base != null) had.base = base
        kept.set(slot, had)
        x.synths_sample_config(engine, slot, had.base, loopMode, loopStart, loopEnd || x.synths_sample_frames(engine, slot))
      }
    }
  }

  /** What is known of the sample in each slot, for reading it back out: slot -> { channels, base }. */
  const kept = new Map()

  /**
   * RECORDING. The engine records into a sample slot between a start event and a stop event, one recording at a
   * time. Here each recording asked for is kept until its time comes: [, slot, at, how long or null, what (0 the
   * input, 1 a part, 2 everything), part, room in seconds, channels]. The slot's memory is made now, outside any
   * render. A recording that begins while another is running ends that one, which keeps what it had. When one
   * ends, by its length, by being stopped, by the next beginning or by its room running out, the page is told how
   * many frames it has: { type: 'recorded', slot, frames, full }.
   */
  const recs = []
  let recording = null
  const ended = []
  let recAt = 0
  function record([, slot, at, len, source, part, room, channels]) {
    const none = () => post({ type: 'recorded', slot, frames: 0, full: false, rate: sampleRate })
    if (!x.synths_record_buffer) { post({ type: 'unsupported', what: 'record' }); return none() }
    if (!recAt) recAt = x.synths_alloc(16)
    if (x.synths_record_buffer(engine, slot, Math.max(1, Math.ceil(room * sampleRate)), channels) !== 0) { post({ type: 'problem', what: 'record-memory' }); return none() }
    kept.set(slot, { channels, base: 60 })
    const start = frameOf(at)
    recs.push({ slot, start, end: len == null ? null : start + Math.max(1, Math.round(len * sampleRate)), source, part })
    recs.sort((a, b) => a.start - b.start)
  }
  function recordStop([, at, slot]) {
    const frame = frameOf(at)
    if (recording && (slot < 0 || recording.slot === slot)) recording.end = recording.end == null ? frame : Math.min(recording.end, frame)
    for (let i = recs.length - 1; i >= 0; i--) {
      if (slot >= 0 && recs[i].slot !== slot) continue
      // One that was to begin later never begins; one about to begin is as long as the time until the stop.
      if (recs[i].start >= frame) { post({ type: 'recorded', slot: recs[i].slot, frames: 0, full: false, rate: sampleRate }); recs.splice(i, 1) } else recs[i].end = recs[i].end == null ? frame : Math.min(recs[i].end, frame)
    }
  }
  // The start and stop events that fall before `end`, in the order they happen.
  function recordEvents(end) {
    for (;;) {
      const next = recs[0]
      const stopAt = recording && recording.end != null ? recording.end : Infinity
      if (next && next.start < end && next.start <= stopAt) {
        if (recording) ended.push(recording)
        recording = recs.shift()
        add(Math.max(core.time, recording.start), RECORD, recording.part, 1, recording.slot, recording.source)
      } else if (recording && stopAt < end) {
        add(Math.max(core.time, stopAt), RECORD, 0, 0, 0, 0)
        ended.push(recording)
        recording = null
      } else return
    }
  }
  // After a render: say which recordings are over. One still running that the engine has stopped ran out of room.
  function recordEnds() {
    for (const r of ended.splice(0)) post({ type: 'recorded', slot: r.slot, frames: x.synths_sample_frames(engine, r.slot), full: false, rate: sampleRate })
    if (!recording || !recAt) return
    x.synths_record_read(engine, recAt)
    const state = new Uint32Array(memory.buffer, recAt, 4)
    if (state[0] === 1 && state[1] === recording.slot) return
    post({ type: 'recorded', slot: recording.slot, frames: x.synths_sample_frames(engine, recording.slot), full: true, rate: sampleRate })
    recording = null
  }
  // A sample read back out of the engine, to be saved: [, slot, token].
  function readSample([, slot, token]) {
    const had = kept.get(slot) || { channels: 1 }
    const frames = x.synths_sample_read ? x.synths_sample_frames(engine, slot) : 0
    const at = frames ? x.synths_alloc(frames * had.channels * 4) : 0
    const pcm = at ? new Float32Array(memory.buffer, at, x.synths_sample_read(engine, slot, 0, at, frames) * had.channels).slice() : new Float32Array(0)
    if (at) x.synths_free(at)
    post({ type: 'sample', token, pcm, channels: had.channels, rate: sampleRate })
  }

  /**
   * THE LIVE INPUT: a microphone. render() is handed each block's input by a host that has it as the sound card
   * does (the worklet's own input). A host that has it as frames arriving from elsewhere pushes them here, and they
   * wait in a ring to be played out a block at a time. Playing begins when a lump and a little more is in hand, and
   * begins again like that after the ring runs dry, so frames arriving in uneven lumps are not heard as gaps. The latest input is also kept here as it
   * came, for a scope and a meter to show while the microphone is not being listened to.
   */
  const RING = 65536
  let ring = null, ringAt = 0, ringHas = 0, ringDry = true, ringOn = false
  function pushInput(frames) {
    if (!ring) ring = new Float32Array(RING)
    ringOn = true
    let n = frames.length, from = 0
    if (n > RING) { from = n - RING; n = RING }
    // No room: the oldest frames make way.
    if (ringHas + n > RING) { const drop = ringHas + n - RING; ringAt = (ringAt + drop) % RING; ringHas -= drop }
    let to = (ringAt + ringHas) % RING
    for (let i = 0; i < n; i++) { ring[to] = frames[from + i]; if (++to === RING) to = 0 }
    ringHas += n
    // Enough in hand to begin (again) is one lump and a little more, so the next lump can be late.
    const enough = n + Math.min(n, 2048)
    // Far more than that waiting is a host that sends faster than the sound card plays: the oldest is let go.
    if (ringHas > Math.max(sampleRate / 4, 3 * n)) { const drop = ringHas - enough; ringAt = (ringAt + drop) % RING; ringHas -= drop }
    if (ringDry && ringHas >= enough) ringDry = false
  }
  function pullInput(into, n) {
    if (ringDry || ringHas < n) {
      ringDry = true
      into.fill(0, 0, n)
      return
    }
    for (let i = 0; i < n; i++) { into[i] = ring[ringAt]; if (++ringAt === RING) ringAt = 0 }
    ringHas -= n
  }
  const heardInput = new Float32Array(1024)
  let heardAt = 0, heardPeak = 0
  function hearInput(block, n) {
    let top = 0
    for (let i = 0; i < n; i++) {
      const v = block[i]
      heardInput[heardAt] = v
      heardAt = (heardAt + 1) & 1023
      if (v > top) top = v
      else if (-v > top) top = -v
    }
    // As the engine's meters do: up at once, and back to 37% in half a second.
    heardPeak = Math.max(top, heardPeak * Math.exp(-n / (0.5 * sampleRate)))
  }
  let input = null

  function loadSample([, slot, pcm, channels, rate, base, loopMode, loopStart, loopEnd]) {
    const frames = Math.floor(pcm.length / channels)
    if (!frames) return
    kept.set(slot, { channels, base })
    const at = x.synths_alloc(pcm.length * 4)
    if (!at) return post({ type: 'problem', what: 'sample-memory' })
    new Float32Array(memory.buffer, at, pcm.length).set(pcm)
    const ok = x.synths_sample_load(engine, slot, at, frames, channels, rate)
    x.synths_free(at)
    if (ok === 0) x.synths_sample_config(engine, slot, base, loopMode, loopStart, loopEnd || frames)
  }

  // A SONG. [, token, the song file's bytes, [[a sample file's name as bytes, its bytes], …], first part, first slot].
  // The engine reads the file (a MOD, an XM or one of its own JSON songs) and from then on plays it by itself,
  // steered by `song` events. The page is told how it went, with what it needs to set up the song's synth patches:
  // text is sent as bytes, because this thread may have nothing to turn bytes into text with.
  let songLoaded = false
  function put(bytes) {
    const at = x.synths_alloc(Math.max(1, bytes.length))
    if (at) new Uint8Array(memory.buffer, at, bytes.length).set(bytes)
    return at
  }
  function loadSong([, token, bytes, files, firstPart, firstSlot]) {
    if (!x.synths_song_load) return post({ type: 'song', token, result: -100 })
    for (const [name, data] of files || []) {
      const nameAt = put(name), dataAt = put(data)
      if (nameAt && dataAt) x.synths_song_file(nameAt, name.length, dataAt, data.length)
      x.synths_free(nameAt)
      x.synths_free(dataAt)
    }
    const at = put(bytes)
    // An engine from before songs were given parts 32 up for good took the first part as well.
    const result = !at ? -1 : x.synths_song_load.length >= 5 ? x.synths_song_load(engine, at, bytes.length, firstPart, firstSlot) : x.synths_song_load(engine, at, bytes.length, firstSlot)
    x.synths_free(at)
    songLoaded = result === 0
    const said = { type: 'song', token, result, error: null, info: [], patches: [] }
    if (result !== 0) said.error = songError()
    else {
      const room = x.synths_alloc(256)
      x.synths_song_info(engine, room)
      said.info = Array.from(new Uint32Array(memory.buffer, room, 8))
      for (let i = 1; i <= said.info[3]; i++) {
        const n = Math.min(256, x.synths_song_patch_name(engine, i, room, 256))
        if (n) said.patches.push([i, new Uint8Array(memory.buffer, room, n).slice()])
      }
      x.synths_free(room)
    }
    post(said)
  }
  function songError() {
    const from = x.synths_song_error()
    const all = new Uint8Array(memory.buffer)
    let end = from
    while (from && all[end]) end++
    return all.slice(from, end)
  }
  /** A song file of any kind as the engine's packed form: { bytes } or { error: why not, as bytes of text }. */
  function packSong(bytes) {
    if (!x.synths_song_pack) return { error: null }
    const at = put(bytes)
    const length = at ? x.synths_song_pack(at, bytes.length) : -1
    x.synths_free(at)
    return length > 0 ? { bytes: new Uint8Array(memory.buffer, x.synths_song_packed(), length).slice() } : { error: songError() }
  }
  /** Where the song is, ten numbers (see the engine's document), or null with an engine that plays no songs. */
  let positionAt = 0
  function songPosition() {
    if (!x.synths_song_position) return null
    if (!positionAt) positionAt = x.synths_alloc(40)
    if (!positionAt) return null
    x.synths_song_position(engine, positionAt)
    return Array.from(new Uint32Array(memory.buffer, positionAt, 10))
  }

  // A part's step macro: [, part, the steps' numbers (five a step), count, loop start, loop end, release, flags].
  function setMacro([, part, flat, count, loopStart, loopEnd, release, flags]) {
    if (!x.synths_macro_set) return post({ type: 'unsupported', what: 'macro' })
    if (!count) return x.synths_macro_set(engine, part, 0, 0, 0, 0, 255, 0)
    const at = x.synths_alloc(flat.length * 4)
    if (!at) return
    new Float32Array(memory.buffer, at, flat.length).set(flat)
    x.synths_macro_set(engine, part, at, count, loopStart, loopEnd, release, flags)
    x.synths_free(at)
  }

  /**
   * WHAT IS SOUNDING, for a display: for each source (a part, or 65535 for everything) its latest `frames` samples,
   * its peak level left and right, and the notes sounding as four words of bits. The engine keeps these as it
   * renders; reading them costs the sound nothing. An engine without them gives an empty list.
   */
  let tapAt = 0
  function taps(sources, frames) {
    if (!x.synths_scope_read || !x.synths_levels_read || !x.synths_notes_read) return []
    if (!tapAt) tapAt = x.synths_alloc(4096 * 4)
    if (!tapAt) return []
    const out = []
    for (const source of sources) {
      if (source === 0xfffe) {
        // The microphone as it came in, which is kept here and not in the engine.
        const samples = new Float32Array(1024)
        for (let i = 0; i < 1024; i++) samples[i] = heardInput[(heardAt + i) & 1023]
        out.push([source, samples, heardPeak, heardPeak, new Uint32Array(4)])
        continue
      }
      const n = x.synths_scope_read(engine, source, tapAt, Math.min(frames, 4096))
      const samples = new Float32Array(memory.buffer, tapAt, n).slice()
      x.synths_levels_read(engine, source, 1, tapAt)
      const levels = new Float32Array(memory.buffer, tapAt, 4)
      const peakLeft = levels[0], peakRight = levels[1]
      x.synths_notes_read(engine, source, tapAt)
      out.push([source, samples, peakLeft, peakRight, new Uint32Array(memory.buffer, tapAt, 8).slice(4)])
    }
    return out
  }

  /** Changes of tempo that are still to come: [frame, group, seconds in a beat]. */
  const tempos = []
  function changeTempo([from, group, beat]) {
    for (const tune of tunes.values()) {
      if (!tune.beats || tune.group !== group) continue
      const reached = (from - tune.start) / tune.unit
      tune.unit = beat * sampleRate
      tune.start = from - reached * tune.unit
    }
  }

  // Put the notes of every tune that fall before `end` into the queue.
  function playTunes(end) {
    for (const [id, tune] of tunes) {
      for (let guard = 0; guard < 512; guard++) {
        const step = tune.steps[tune.i]
        const frame = Math.round(tune.start + (tune.cycle * tune.length + step[0]) * tune.unit)
        if (frame >= end) break
        handle = handle >= 0xfffffff0 ? 0xc0000000 : handle + 1
        for (const note of step[1]) add(frame, NOTE_ON, tune.part, handle, note, step[3])
        add(frame + Math.max(1, Math.round(step[2] * tune.unit)), NOTE_OFF, tune.part, handle, 0, 0)
        if (++tune.i >= tune.steps.length) {
          tune.i = 0
          if (++tune.cycle >= tune.repeat) { tunes.delete(id); break }
        }
      }
    }
  }

  // Hand the engine every queued event that falls before `end`.
  function feed(end) {
    while (queue.length && queue[0][0] < end) {
      const room = Math.min(eventRoom, x.synths_event_space(engine))
      if (!room) return
      if (!events || events.buffer !== memory.buffer) events = new DataView(memory.buffer, eventsAt, eventRoom * 32)
      let n = 0
      while (n < room && n < queue.length && queue[n][0] < end) {
        const e = queue[n], at = n * 32
        events.setFloat64(at, e[0], true)
        events.setUint16(at + 8, e[1], true)
        events.setUint16(at + 10, e[2], true)
        events.setUint32(at + 12, e[3], true)
        events.setFloat32(at + 16, e[4], true)
        events.setFloat32(at + 20, e[5], true)
        events.setFloat32(at + 24, e[6], true)
        events.setUint32(at + 28, e[7], true)
        n++
      }
      const taken = x.synths_push_events(engine, n)
      queue.splice(0, taken)
      if (taken < n) return
    }
  }

  /**
   * Make `frames` frames into `outLeft` and `outRight` (which may be missing), starting at `at`. `inLeft` is the
   * live input that came in over the same frames, if the host has one: one channel, at the engine's sample rate.
   */
  function render(outLeft, outRight, frames, at = 0, inLeft = null) {
    const live = (inLeft || ringOn) && x.synths_render_io
    for (let done = 0; done < frames;) {
      const n = Math.min(outRoom, frames - done)
      const end = core.time + n
      while (tempos.length && tempos[0][0] < end) {
        if (tunes.size) playTunes(tempos[0][0])
        changeTempo(tempos.shift())
      }
      if (tunes.size) playTunes(end)
      if (recs.length || recording) recordEvents(end)
      if (queue.length) feed(end)
      if (live) {
        if (!input || input.buffer !== memory.buffer) input = new Float32Array(memory.buffer, x.synths_input_left(engine), outRoom)
        if (!inLeft) pullInput(input, n)
        else if (done + n <= inLeft.length) input.set(done === 0 && n === inLeft.length ? inLeft : inLeft.subarray(done, done + n))
        else { input.fill(0, 0, n); if (done < inLeft.length) input.set(inLeft.subarray(done)) }
        hearInput(input, n)
      }
      const made = live ? x.synths_render_io(engine, n, 1) : x.synths_render(engine, n)
      if (!made) break
      if (!left || left.buffer !== memory.buffer) {
        left = new Float32Array(memory.buffer, x.synths_output_left(engine), outRoom)
        right = new Float32Array(memory.buffer, x.synths_output_right(engine), outRoom)
      }
      outLeft.set(made === outRoom ? left : left.subarray(0, made), at + done)
      if (outRight) outRight.set(made === outRoom ? right : right.subarray(0, made), at + done)
      core.time += made
      done += made
      if (recording || ended.length) recordEnds()
    }
  }

  return core
}
;(function registerSynths(makeCore) {
  registerProcessor('synths', class extends AudioWorkletProcessor {
    constructor(options) {
      super()
      this.core = null
      this.over = false
      // A page that is drawing a scope or a meter says which sources it is watching, and goes on saying so;
      // while it does, what they are doing is posted to it about 40 times a second. Unwatched, nothing is posted.
      this.watch = null
      this.watchFor = 0
      this.blocks = 0
      // Whether the node's input is a microphone to be given to the engine. Until it is, the input is not looked at.
      this.mic = false
      this.begun = false
      this.early = []
      this.port.onmessage = (m) => {
        const core = this.core
        if (!core) return
        if (m.data.close) {
          // The player is finished with: let the browser take this processor away.
          this.core = null
          this.over = true
          core.close()
          return
        }
        if (m.data.ops) {
          // Before the first block is made this thread's clock may not have been brought up to the sound card's
          // (in WebKit it is brought up only as blocks are made), and the engine's own starts at 0: what arrives
          // then is kept for the first block, or it would be put as far into the future as the sound card is old.
          if (!this.begun) this.early.push(m.data.ops)
          else {
            core.delta = core.time - currentFrame
            core.exec(m.data.ops)
          }
        }
        if (m.data.watch) {
          this.watchSong = !!m.data.song
          this.watch = m.data.watch
          this.watchFor = Math.ceil(sampleRate * 1.5 / 128)
        }
        if (m.data.mic !== undefined) this.mic = !!m.data.mic
        if (m.data.input) core.pushInput(m.data.input)
        if (m.data.ask) this.port.postMessage({ type: 'state', ask: m.data.ask, voices: core.voices(), time: core.time, frame: currentFrame })
      }
      try {
        this.core = makeCore(options.processorOptions.wasm, sampleRate, (m) => this.port.postMessage(m))
        this.port.postMessage({ type: 'ready', abi: this.core.abi, exports: this.core.exports })
      } catch (e) {
        this.port.postMessage({ type: 'failed', message: String((e && e.message) || e) })
      }
    }

    process(inputs, outputs) {
      const core = this.core
      const out = outputs[0]
      if (!core) return !this.over
      if (!out || !out[0]) return true
      core.delta = core.time - currentFrame
      if (!this.begun) {
        this.begun = true
        for (const ops of this.early.splice(0)) core.exec(ops)
      }
      core.render(out[0], out[1], out[0].length, 0, (this.mic && inputs[0] && inputs[0][0]) || null)
      if (this.watch && (++this.blocks & 7) === 0) {
        if ((this.watchFor -= 8) <= 0) this.watch = null
        else this.port.postMessage({ type: 'taps', taps: core.taps(this.watch, 1024), song: this.watchSong ? core.songPosition() : null })
      }
      return true
    }
  })
})(makeCore)
