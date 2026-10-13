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
  const NOTE_ON = 1, NOTE_OFF = 2, ALL_OFF = 3, SONG = 15, EVERY = 0xffff

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
        const [, id, at, part, steps, length, repeat] = op
        const frames = Math.round(length * sampleRate)
        if (steps.length && frames >= 1) tunes.set(id, { part, steps, length: frames, start: frameOf(at), cycle: 0, i: 0, repeat: repeat || Infinity })
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
    }
  }

  function loadSample([, slot, pcm, channels, rate, base, loopMode, loopStart, loopEnd]) {
    const frames = Math.floor(pcm.length / channels)
    if (!frames) return
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

  // Put the notes of every tune that fall before `end` into the queue.
  function playTunes(end) {
    for (const [id, tune] of tunes) {
      for (let guard = 0; guard < 512; guard++) {
        const step = tune.steps[tune.i]
        const frame = tune.start + tune.cycle * tune.length + Math.round(step[0] * sampleRate)
        if (frame >= end) break
        handle = handle >= 0xfffffff0 ? 0xc0000000 : handle + 1
        for (const note of step[1]) add(frame, NOTE_ON, tune.part, handle, note, step[3])
        add(frame + Math.max(1, Math.round(step[2] * sampleRate)), NOTE_OFF, tune.part, handle, 0, 0)
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

  /** Make `frames` frames into `outLeft` and `outRight` (which may be missing), starting at `at`. */
  function render(outLeft, outRight, frames, at = 0) {
    for (let done = 0; done < frames;) {
      const n = Math.min(outRoom, frames - done)
      const end = core.time + n
      if (tunes.size) playTunes(end)
      if (queue.length) feed(end)
      const made = x.synths_render(engine, n)
      if (!made) break
      if (!left || left.buffer !== memory.buffer) {
        left = new Float32Array(memory.buffer, x.synths_output_left(engine), outRoom)
        right = new Float32Array(memory.buffer, x.synths_output_right(engine), outRoom)
      }
      outLeft.set(made === outRoom ? left : left.subarray(0, made), at + done)
      if (outRight) outRight.set(made === outRoom ? right : right.subarray(0, made), at + done)
      core.time += made
      done += made
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
          core.delta = core.time - currentFrame
          core.exec(m.data.ops)
        }
        if (m.data.watch) {
          this.watchSong = !!m.data.song
          this.watch = m.data.watch
          this.watchFor = Math.ceil(sampleRate * 1.5 / 128)
        }
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
      core.render(out[0], out[1], out[0].length)
      if (this.watch && (++this.blocks & 7) === 0) {
        if ((this.watchFor -= 8) <= 0) this.watch = null
        else this.port.postMessage({ type: 'taps', taps: core.taps(this.watch, 1024), song: this.watchSong ? core.songPosition() : null })
      }
      return true
    }
  })
})(makeCore)
