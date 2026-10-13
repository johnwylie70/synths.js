/**
 * synths.js: sounds and music in plain JavaScript. The sound sibling of
 * pictures.js, with the same plain functions.
 *
 *   playSound("laser")                     a ready-made game sound: coin, jump, laser, explosion, hit, powerup, blip, …
 *   playNote("C4")                         a note on a pleasant synth: a name or a number (60 is middle C), then how
 *   playNote("C4", 0.5, 0.8)               long in seconds and how loud (0 to 1). A list of notes is a chord
 *   playNotes("C4 E4 G4 - C5", 0.25)       a tune, a step every quarter of a second; "-" is a rest; { repeat: true } loops it
 *   note("C4", "quarter"), rest("eighth")   a tune a line at a time: each note begins where the last ended. chord("Cm", "half")
 *   setTempo(120)                          a length by name ("quarter", "eighth.", "1/16") follows the tempo; a number is seconds
 *   const lead = makeSynth("lead")         a synth of your own, from a ready-made one (bass, lead, pad, pluck, organ, chip, …)
 *   const mine = makeSynth({ wave: "saw", cutoff: 1200, attack: 0.01, release: 0.3 })
 *   lead.play("E4", 0.5)                   play a note; lead.play(["C4", "E4", "G4"]) is a chord
 *   lead.cutoff = 800                      every setting is a plain property, and changes the notes already sounding
 *   lead.echo = 0.4                        effects are one word: echo, reverb, chorus, distortion, crush
 *   const note = lead.start("C4")          a note that stays until note.stop(); note.slideTo("G4", 0.5), note.volume = 0.5
 *   lead.arp("Cm7"), playArp("C4", "minor")   a chord from one voice, as a fast arpeggio (a C64 chord); startArp stays, and changes chord
 *   lead.play("Cm7")                       a chord by name plays all its notes
 *   lead.macro = [{ wave: "noise" }, …]    a step macro: chip drums and moving pulse widths
 *   lead.samples(), .level(), .notes()     what it is doing now, for a scope, a meter and lit keys (dials.js uses these)
 *   const drum = loadSample("kick.wav")    a recorded sound from a file; drum.play(), drum.play("E4") at another pitch
 *   const song = playSong("tune.mod")      a whole song from a file (.mod, .xm, or our own .json): song.pause(), .seek(2), .volume, .position
 *   setVolume(0.5), muteSound(), unmuteSound(), stopSound()
 *   setEffects({ echoTime: 0.3, reverbSize: 0.8 })
 *   setTempo(120), beats(2)                beats(2) is how many seconds two beats last
 *   lead.playFromMidi()                    a MIDI keyboard plays a synth; onMidiNote, onMidiControl, sendMidiNote("C4"),
 *   lead.learn("cutoff")                   lead.sendToMidi(), midiDevices(): MIDI, which is in synths-midi.js
 *   const mic = useMicrophone()            the microphone (the browser asks first); nothing is heard until mic.listen()
 *   mic.voice = "robot"                    a voice changer: robot, chipmunk, monster, cave, telephone, alien, whisper, "none"
 *   mic.pitch = 7, mic.echo = 0.4          and the settings a synth has; a synth has them too: lead.pitchShift, ringMod, comb
 *   const take = recordSound(3)            three seconds of the microphone as a sample: take.play(), take.play("E4"),
 *   startRecording(), stopRecording()      take.onDone(() => ...), take.voice = "monster"; recordOutput(10) is what was played
 *   saveSound(take, "hello.wav")           a recording or a sample as a WAV file
 *
 * When something starts: every call that makes a sound takes { after: seconds }, { at: a time read from
 * soundTime() } or { beat: a beat number }. Every name has its Python spelling too (play_sound, make_synth).
 *
 * HOW IT IS BUILT. Three layers, so that the same commands can come from another frame, a worker or Python:
 *
 *   1. THE API (createSound) only writes COMMANDS: plain objects such as { op: "note", id: "s1", note: 60, len: 0.5 },
 *      with ids chosen here, so no call ever waits for an answer. docs/commands.md is the contract.
 *   2. A TRANSPORT carries them, a batch at a time: { synths: 1, now, cmds }. Without one the batch goes straight to
 *      a player on this page. A host passes `sound: { send(batch) }` to take the batches and play them elsewhere.
 *   3. A PLAYER (createPlayer) owns the AudioContext and the audio worklet and carries the commands out.
 *      THE ENGINE (synths-core, WebAssembly) runs in the worklet, on the audio thread. Nothing on the page's own
 *      thread works out a sample. createOfflinePlayer is the same player without a sound card: it renders the same
 *      commands to numbers, or a WAV file, in a browser or in node.
 *
 * TIME. Every command carries the time it was asked for, on the sender's own clock, and every batch the sender's
 * time when it was sent. The player lines that clock up with the sound card's and plays everything a moment late
 * (`latency`, 0.04 seconds) on the exact sample, so a busy page or a slow message does not make the rhythm uneven.
 *
 * MIT licence.
 */

export const version = '0.1.0'

// Where this file is, for the engine and the worklet beside it. A copy imported from a Blob has no "beside":
// it is given the engine as bytes, and the worklet comes from a Blob too, so nothing is looked for there.
const BASE = (() => {
  try { return new URL('./', import.meta.url) } catch (e) { /* a blob: address cannot be a base */ }
  try { return new URL('./', document.baseURI) } catch (e) { return 'http://localhost/' }
})()
/** The engine's parts that synths are given. The rest (32 to 63) are a tracker song's, one for each channel. */
const SYNTH_PARTS = 32
/** The sample slots loadSample is given. A song's samples go in the slots from here on. */
const SAMPLE_SLOTS = 512
/** The version of the command format: `synths` in every batch. */
const COMMANDS = 1

// The engine's parameter table, written here by scripts/sync-engine.mjs from the engine itself. Do not edit by hand.
// Each row: id, name, kind (f float, i whole number, b on or off, c a choice), least, most, default, unit, the choices.
// VOICES are the engine's voice changers: for each, what it is and the settings it gives the part it is put on.
/* PARAMS:BEGIN */
const ENGINE = {"abi":1,"version":"0.0.0","parts":64,"voices":64,"samples":1024,"events":["note_on","note_off","all_notes_off","param","pitch_bend","voice_pitch","voice_freq","voice_volume","voice_pan","voice_position","voice_kill","macro_tick","arp","arp_more","song","record"]}
const PARAMS = [
  [0,"volume","f",0,2,1,"gain"],
  [1,"pan","f",-1,1,0,"pan"],
  [2,"transpose","f",-48,48,0,"semitones"],
  [3,"tune","f",-100,100,0,"cents"],
  [4,"bend","f",-1,1,0,""],
  [5,"bend_range","f",0,48,2,"semitones"],
  [6,"glide","f",0,10,0,"seconds"],
  [7,"mode","c",0,2,0,"",["poly","mono","legato"]],
  [8,"unison.voices","i",1,8,1,"voices"],
  [9,"unison.detune","f",0,100,20,"cents"],
  [10,"unison.spread","f",0,1,0.5,""],
  [11,"velocity","f",0,1,1,""],
  [12,"pan.law","c",0,1,0,"",["equal_power","square_root"]],
  [16,"osc1.wave","c",0,4,1,"",["sine","triangle","saw","pulse","sample"]],
  [17,"osc1.level","f",0,1,1,"gain"],
  [18,"osc1.coarse","f",-48,48,0,"semitones"],
  [19,"osc1.fine","f",-100,100,0,"cents"],
  [20,"osc1.pulse_width","f",0,1,0.5,""],
  [21,"osc1.sample","i",0,1023,0,"slot"],
  [22,"osc1.start","f",0,1,0,""],
  [23,"osc1.keytrack","b",0,1,1,""],
  [24,"osc2.wave","c",0,4,2,"",["sine","triangle","saw","pulse","sample"]],
  [25,"osc2.level","f",0,1,0,"gain"],
  [26,"osc2.coarse","f",-48,48,0,"semitones"],
  [27,"osc2.fine","f",-100,100,0,"cents"],
  [28,"osc2.pulse_width","f",0,1,0.5,""],
  [29,"osc2.sample","i",0,1023,0,"slot"],
  [30,"osc2.start","f",0,1,0,""],
  [31,"osc2.keytrack","b",0,1,1,""],
  [32,"osc2.sync","b",0,1,0,""],
  [33,"osc2.ring","f",0,1,0,""],
  [34,"osc1.reverse","b",0,1,0,""],
  [35,"osc2.reverse","b",0,1,0,""],
  [36,"sub.level","f",0,1,0,"gain"],
  [37,"sub.wave","c",0,2,0,"",["sine","square","triangle"]],
  [38,"sub.octave","i",-2,-1,-1,"octaves"],
  [39,"sample.antialias","b",0,1,1,""],
  [40,"noise.level","f",0,1,0,"gain"],
  [41,"noise.type","c",0,3,0,"",["white","pink","lfsr","lfsr_short"]],
  [42,"noise.pitch","f",-48,48,0,"semitones"],
  [48,"filter.type","c",0,7,0,"",["off","lowpass","highpass","bandpass","notch","low_band","band_high","all"]],
  [49,"filter.slope","c",0,1,0,"",["12db","24db"]],
  [50,"filter.cutoff","f",20,20000,2000,"hz"],
  [51,"filter.resonance","f",0,1,0.15,""],
  [52,"filter.keytrack","f",0,1,0,""],
  [53,"filter.env","f",-96,96,0,"semitones"],
  [54,"filter.velocity","f",-96,96,0,"semitones"],
  [56,"amp.attack","f",0,20,0.005,"seconds"],
  [57,"amp.decay","f",0,20,0.1,"seconds"],
  [58,"amp.sustain","f",0,1,0.8,""],
  [59,"amp.release","f",0,20,0.15,"seconds"],
  [60,"amp.curve","f",0,1,0.5,""],
  [64,"filter_env.attack","f",0,20,0.005,"seconds"],
  [65,"filter_env.decay","f",0,20,0.2,"seconds"],
  [66,"filter_env.sustain","f",0,1,0.3,""],
  [67,"filter_env.release","f",0,20,0.2,"seconds"],
  [68,"filter_env.curve","f",0,1,0.5,""],
  [72,"mod_env.attack","f",0,20,0.005,"seconds"],
  [73,"mod_env.decay","f",0,20,0.2,"seconds"],
  [74,"mod_env.sustain","f",0,1,0,""],
  [75,"mod_env.release","f",0,20,0.2,"seconds"],
  [76,"mod_env.curve","f",0,1,0.5,""],
  [77,"mod_env.pitch","f",-48,48,0,"semitones"],
  [78,"mod_env.osc2_pitch","f",-48,48,0,"semitones"],
  [79,"mod_env.pulse_width","f",-1,1,0,""],
  [80,"lfo1.wave","c",0,4,0,"",["sine","triangle","saw","square","random"]],
  [81,"lfo1.rate","f",0.01,50,5,"hz"],
  [82,"lfo1.delay","f",0,10,0,"seconds"],
  [83,"lfo1.fade","f",0,10,0,"seconds"],
  [84,"lfo1.sync","b",0,1,1,""],
  [85,"lfo1.pitch","f",-48,48,0,"semitones"],
  [86,"lfo1.pulse_width","f",-1,1,0,""],
  [87,"lfo1.cutoff","f",-96,96,0,"semitones"],
  [88,"lfo1.amp","f",0,1,0,""],
  [89,"lfo1.pan","f",0,1,0,""],
  [96,"lfo2.wave","c",0,4,1,"",["sine","triangle","saw","square","random"]],
  [97,"lfo2.rate","f",0.01,50,0.5,"hz"],
  [98,"lfo2.delay","f",0,10,0,"seconds"],
  [99,"lfo2.fade","f",0,10,0,"seconds"],
  [100,"lfo2.sync","b",0,1,0,""],
  [101,"lfo2.pitch","f",-48,48,0,"semitones"],
  [102,"lfo2.pulse_width","f",-1,1,0,""],
  [103,"lfo2.cutoff","f",-96,96,0,"semitones"],
  [104,"lfo2.amp","f",0,1,0,""],
  [105,"lfo2.pan","f",0,1,0,""],
  [106,"fx.pitch","f",-12,12,0,"semitones"],
  [107,"fx.ring","f",0,1,0,""],
  [108,"fx.ring_freq","f",1,5000,30,"hz"],
  [109,"fx.ring_wave","c",0,1,0,"",["sine","noise"]],
  [110,"fx.comb","f",0,1,0,""],
  [111,"fx.comb_freq","f",50,5000,200,"hz"],
  [112,"fx.drive","f",0,1,0,""],
  [113,"fx.bits","f",1,16,16,"bits"],
  [114,"fx.downsample","i",1,64,1,""],
  [115,"send.delay","f",0,1,0,"gain"],
  [116,"send.reverb","f",0,1,0,"gain"],
  [117,"send.chorus","f",0,1,0,"gain"],
  [120,"macro.rate","f",1,1000,50,"hz"],
  [121,"macro.sync","b",0,1,0,""],
  [122,"fx.comb_feedback","f",-0.97,0.97,0.7,""],
  [123,"fx.comb_rate","f",0.01,10,0.3,"hz"],
  [124,"fx.comb_depth","f",0,1,0,""],
  [200,"master.volume","f",0,2,0.35,"gain"],
  [201,"master.limiter","b",0,1,1,""],
  [202,"delay.time","f",0.001,2,0.3,"seconds"],
  [203,"delay.feedback","f",0,0.95,0.4,""],
  [204,"delay.tone","f",200,20000,6000,"hz"],
  [205,"delay.pingpong","b",0,1,0,""],
  [208,"reverb.size","f",0,1,0.6,""],
  [209,"reverb.damping","f",0,1,0.4,""],
  [212,"chorus.rate","f",0.05,10,0.8,"hz"],
  [213,"chorus.depth","f",0,1,0.5,""],
  [216,"voices","i",1,64,64,"voices"],
  [217,"input.part","i",0,63,31,"part"],
  [218,"input.gain","f",0,8,1,"gain"],
  [219,"input.monitor","b",0,1,1,""],
  [220,"input.gate","f",-100,0,-100,"db"],
  [221,"input.gate_release","f",0.005,2,0.15,"seconds"],
]
const VOICES = {"robot":{"help":"A machine: the voice multiplied by a 50 Hz wave, ringing in a metal pipe.","values":{"fx.ring":1,"fx.ring_freq":50,"fx.comb":0.45,"fx.comb_freq":110,"fx.comb_feedback":0.8,"fx.bits":10}},"chipmunk":{"help":"Small and squeaky: everything seven semitones higher.","values":{"fx.pitch":7}},"monster":{"help":"Huge and deep: seven semitones lower, with a growl and a little room.","values":{"fx.pitch":-7,"fx.drive":0.25,"send.reverb":0.25,"reverb.size":0.7,"reverb.damping":0.6}},"cave":{"help":"Far inside a cave: long echoes and a very big room.","values":{"send.delay":0.5,"send.reverb":0.7,"delay.time":0.38,"delay.feedback":0.55,"delay.tone":2500,"reverb.size":0.92,"reverb.damping":0.3}},"telephone":{"help":"Down an old phone line: only the middle of the voice, coarse and a little crushed.","values":{"filter.type":3,"filter.slope":1,"filter.cutoff":1200,"filter.resonance":0.2,"fx.drive":0.2,"fx.bits":8,"fx.downsample":6}},"alien":{"help":"Not from here: higher, multiplied by a 180 Hz wave, with a slow metallic sweep.","values":{"fx.pitch":4,"fx.ring":0.8,"fx.ring_freq":180,"fx.comb":0.4,"fx.comb_freq":600,"fx.comb_feedback":0.75,"fx.comb_rate":0.4,"fx.comb_depth":0.5,"send.chorus":0.4}},"whisper":{"help":"Hoarse and breathy: the voice's pitch blurred into noise, with its low end taken off.","values":{"filter.type":2,"filter.cutoff":500,"filter.resonance":0,"fx.ring":1,"fx.ring_wave":1,"fx.ring_freq":350}}}
/* PARAMS:END */

/**
 * FRIENDLY NAMES. A setting may be written as the engine names it ("filter.cutoff", filterCutoff, filter_cutoff)
 * or by one of these shorter names. A list is [engine name, how many engine units one unit of the friendly name is].
 */
const ALIASES = {
  wave: 'osc1.wave', level1: 'osc1.level', width: 'osc1.pulse_width', pulseWidth: 'osc1.pulse_width', sample: 'osc1.sample',
  octave: ['transpose', 12], pitch: 'transpose', maxVoices: 'voices',
  voices: 'unison.voices', detune: 'unison.detune', spread: 'unison.spread',
  wave2: 'osc2.wave', level2: 'osc2.level', pitch2: 'osc2.coarse', detune2: 'osc2.fine', width2: 'osc2.pulse_width', sync: 'osc2.sync', ring: 'osc2.ring',
  sub: 'sub.level', noise: 'noise.level', macroRate: 'macro.rate', macroSync: 'macro.sync',
  filter: 'filter.type', slope: 'filter.slope', cutoff: 'filter.cutoff', resonance: 'filter.resonance', keytrack: 'filter.keytrack', sweep: 'filter.env',
  sweepAttack: 'filter_env.attack', sweepDecay: 'filter_env.decay', sweepSustain: 'filter_env.sustain', sweepRelease: 'filter_env.release',
  attack: 'amp.attack', decay: 'amp.decay', sustain: 'amp.sustain', release: 'amp.release', curve: 'amp.curve',
  pitchSweep: 'mod_env.pitch', pitchSweepAttack: 'mod_env.attack', pitchSweepDecay: 'mod_env.decay',
  vibrato: 'lfo1.pitch', vibratoRate: 'lfo1.rate', vibratoDelay: 'lfo1.delay', tremolo: 'lfo1.amp',
  wobble: 'lfo2.cutoff', wobbleRate: 'lfo2.rate', autopan: 'lfo2.pan',
  distortion: 'fx.drive', drive: 'fx.drive', crush: 'fx.bits', bits: 'fx.bits', downsample: 'fx.downsample',
  // The voice effects, which every synth has: a pitch shifter, a ring modulator and a comb (which sweeps as a flanger).
  pitchShift: 'fx.pitch', ringMod: 'fx.ring', ringSpeed: 'fx.ring_freq', ringWave: 'fx.ring_wave',
  comb: 'fx.comb', combTone: 'fx.comb_freq', combFeedback: 'fx.comb_feedback', flanger: 'fx.comb_depth', flangerRate: 'fx.comb_rate',
  reverse: 'osc1.reverse',
  echo: 'send.delay', delay: 'send.delay', reverb: 'send.reverb', chorus: 'send.chorus',
  masterVolume: 'master.volume', limiter: 'master.limiter',
  echoTime: 'delay.time', echoFeedback: 'delay.feedback', echoTone: 'delay.tone', echoBounce: 'delay.pingpong',
  reverbSize: 'reverb.size', reverbDamping: 'reverb.damping', chorusRate: 'chorus.rate', chorusDepth: 'chorus.depth',
  micGain: 'input.gain', micGate: 'input.gate', micGateRelease: 'input.gate_release',
}
/**
 * THE MICROPHONE'S OWN NAMES. A microphone has no notes to transpose and no second oscillator, so on it `pitch` is
 * the pitch shifter and `ring` the ring modulator, and its gain and gate (which are the engine's) are plain words.
 */
const MIC_NAMES = { pitch: 'pitchShift', ring: 'ringMod', gain: 'micGain', gate: 'micGate', gaterelease: 'micGateRelease' }
/** The gate a microphone starts with, in dB: quieter than this is taken as silence, so the room's hiss is not echoed and crushed. */
const MIC_GATE = -50
/** How long a recording may be, in seconds, and how long one with no length runs before it stops by itself. */
const LONGEST_RECORDING = 120
const USUAL_RECORDING = 30
/** Where the plain microphone can be read from for a scope and a meter: a source of its own beside the engine's parts. */
const MIC_TAP = 0xfffe
/** Other words for a choice. */
const CHOICE_WORDS = { square: 'pulse', sawtooth: 'saw', tri: 'triangle', sin: 'sine', low: 'lowpass', high: 'highpass', band: 'bandpass', none: 'off', hiss: 'white', chip: 'lfsr', buzz: 'lfsr_short' }

/** What every synth starts from, before its own settings: the engine's defaults, with the filter open and ready. */
const PLAIN = { filter: 'lowpass', cutoff: 20000, resonance: 0.1 }

/** READY-MADE SYNTHS, all of them settings of the engine, none a recording. `note` is what play() plays when no note is given. */
const PRESETS = {
  keys: { wave: 'triangle', wave2: 'sine', level2: 0.35, pitch2: 12, cutoff: 3500, sweep: 18, sweepDecay: 0.3, sweepSustain: 0.2, keytrack: 0.5, attack: 0.003, decay: 0.45, sustain: 0.3, release: 0.35, reverb: 0.12 },
  bass: { wave: 'saw', sub: 0.6, cutoff: 320, resonance: 0.3, sweep: 30, sweepDecay: 0.18, sweepSustain: 0.15, attack: 0.003, decay: 0.2, sustain: 0.75, release: 0.12, note: 36 },
  lead: { wave: 'saw', wave2: 'square', level2: 0.6, detune2: 9, cutoff: 2800, resonance: 0.25, keytrack: 0.5, attack: 0.01, decay: 0.15, sustain: 0.7, release: 0.2, vibrato: 0.15, vibratoDelay: 0.25, vibratoRate: 5.5, echo: 0.2 },
  pad: { wave: 'saw', voices: 4, detune: 22, spread: 0.8, cutoff: 1600, attack: 0.5, decay: 0.5, sustain: 0.8, release: 1.2, chorus: 0.4, reverb: 0.4 },
  pluck: { wave: 'saw', cutoff: 500, resonance: 0.2, sweep: 48, sweepDecay: 0.12, sweepSustain: 0, keytrack: 0.5, attack: 0.001, decay: 0.3, sustain: 0, release: 0.25 },
  organ: { wave: 'sine', wave2: 'sine', level2: 0.6, pitch2: 12, sub: 0.5, attack: 0.008, decay: 0.01, sustain: 1, release: 0.06, chorus: 0.3 },
  strings: { wave: 'saw', voices: 3, detune: 14, spread: 0.6, cutoff: 3200, attack: 0.25, decay: 0.3, sustain: 0.85, release: 0.6, vibrato: 0.08, vibratoDelay: 0.4, reverb: 0.3 },
  bell: { wave: 'sine', wave2: 'sine', level2: 0.45, pitch2: 19, detune2: 2, attack: 0.001, decay: 1.4, sustain: 0, release: 1.2, reverb: 0.3 },
  flute: { wave: 'triangle', noise: 0.03, cutoff: 3000, attack: 0.06, decay: 0.1, sustain: 0.9, release: 0.15, vibrato: 0.1, vibratoDelay: 0.3 },
  // Chip sounds: the plain waves of an 8-bit sound chip, with no filter.
  chip: { wave: 'square', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0.02 },
  chipLead: { wave: 'pulse', width: 0.25, filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0.02, vibrato: 0.2, vibratoDelay: 0.15, vibratoRate: 6 },
  chipBass: { wave: 'pulse', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0.02, note: 36, macroRate: 4,
    macro: { steps: [{ width: 0.06 }, { width: 0.2 }, { width: 0.5 }, { width: 0.8 }, { width: 0.94 }, { width: 0.8 }, { width: 0.5 }, { width: 0.2 }], loop: true, slide: true } },
  chipNoise: { level1: 0, noise: 1, 'noise.type': 'lfsr', filter: 'off', attack: 0, decay: 0.12, sustain: 0, release: 0.05 },
  // Chip drums: one voice that changes wave and pitch fifty times a second, as a sound chip's drums do.
  chipKick: { wave: 'triangle', filter: 'off', attack: 0, decay: 0.16, sustain: 0, release: 0.05, note: 48,
    macro: [{ wave: 'square', pitch: 12 }, { wave: 'triangle', pitch: 5 }, { wave: 'triangle', pitch: 0 }, { wave: 'triangle', pitch: -5 }, { wave: 'triangle', pitch: -10, volume: 0.8 }, { wave: 'triangle', pitch: -14, volume: 0.6 }] },
  chipSnare: { wave: 'pulse', 'noise.type': 'lfsr', filter: 'off', attack: 0, decay: 0.16, sustain: 0, release: 0.05, note: 57,
    macro: [{ wave: 'noise', pitch: 24 }, { wave: 'square', pitch: 0 }, { wave: 'square', pitch: -5, volume: 0.9 }, { wave: 'noise', pitch: 18, volume: 0.8 }, { wave: 'noise', pitch: 14, volume: 0.6 }, { wave: 'noise', pitch: 12, volume: 0.45 }] },
  chipHat: { wave: 'pulse', 'noise.type': 'lfsr', filter: 'off', attack: 0, decay: 0.05, sustain: 0, release: 0.02, note: 72,
    macro: [{ wave: 'noise', pitch: 30 }, { wave: 'noise', pitch: 26, volume: 0.6 }, { wave: 'noise', pitch: 24, volume: 0.3 }] },
  // Drums.
  kick: { wave: 'sine', filter: 'off', pitchSweep: 30, pitchSweepDecay: 0.06, pitchSweepAttack: 0, attack: 0, decay: 0.3, sustain: 0, release: 0.1, note: 36 },
  snare: { wave: 'triangle', level1: 0.6, noise: 1, filter: 'highpass', cutoff: 500, resonance: 0.05, pitchSweep: 12, pitchSweepDecay: 0.04, pitchSweepAttack: 0, attack: 0, decay: 0.17, sustain: 0, release: 0.08, note: 52 },
  hat: { level1: 0, noise: 1, filter: 'highpass', cutoff: 7000, attack: 0, decay: 0.05, sustain: 0, release: 0.03, note: 60 },
  // What loadSample starts from: the recording as it is.
  sample: { wave: 'sample', filter: 'off', attack: 0, decay: 0, sustain: 1, release: 0.03 },
}

/**
 * READY-MADE GAME SOUNDS. A patch, and the notes that play it: [seconds after the start, note, length, loudness,
 * a note to slide to, seconds the slide takes].
 */
const SOUNDS = {
  coin: { patch: { wave: 'square', filter: 'off', attack: 0, decay: 0.3, sustain: 0, release: 0.2 }, notes: [[0, 83, 0.07, 0.8], [0.07, 88, 0.4, 0.8]] },
  jump: { patch: { wave: 'square', width: 0.3, filter: 'off', attack: 0, decay: 0.25, sustain: 0, release: 0.05 }, notes: [[0, 57, 0.22, 0.8, 78, 0.2]] },
  laser: { patch: { wave: 'saw', cutoff: 6000, attack: 0, decay: 0.24, sustain: 0, release: 0.05 }, notes: [[0, 98, 0.24, 0.8, 58, 0.22]] },
  explosion: { patch: { wave: 'sine', level1: 0.9, noise: 1, cutoff: 180, sweep: 50, sweepAttack: 0, sweepDecay: 0.55, sweepSustain: 0, pitchSweep: 24, pitchSweepDecay: 0.25, pitchSweepAttack: 0, distortion: 0.5, attack: 0, decay: 0.9, sustain: 0, release: 0.3 }, notes: [[0, 30, 0.9, 1]] },
  hit: { patch: { wave: 'square', 'noise.type': 'lfsr', filter: 'off', attack: 0, decay: 0.12, sustain: 0, release: 0.05,
    macro: [{ wave: 'noise', pitch: 12 }, { wave: 'square', pitch: 0 }, { wave: 'square', pitch: -5 }, { wave: 'noise', pitch: 4, volume: 0.7 }, { wave: 'noise', pitch: 0, volume: 0.5 }, { wave: 'noise', pitch: -4, volume: 0.3 }] }, notes: [[0, 50, 0.12, 0.9]] },
  shoot: { patch: { wave: 'pulse', width: 0.25, filter: 'off', attack: 0, decay: 0.16, sustain: 0, release: 0.03, macroRate: 60,
    macro: [{ wave: 'noise', pitch: 30 }, { wave: 'pulse', pitch: 19 }, { pitch: 14 }, { pitch: 9 }, { pitch: 4 }, { pitch: 0 }, { pitch: -5, volume: 0.8 }, { pitch: -10, volume: 0.6 }, { pitch: -15, volume: 0.4 }] }, notes: [[0, 76, 0.16, 0.8]] },
  powerup: { patch: { wave: 'square', filter: 'off', attack: 0, decay: 0.2, sustain: 0.5, release: 0.15, macroRate: 16,
    macro: { steps: [{ pitch: 0 }, { pitch: 4 }, { pitch: 7 }, { pitch: 12 }, { pitch: 16 }, { pitch: 19 }, { pitch: 24 }, { pitch: 19 }], loop: [6, 8] } }, notes: [[0, 60, 0.6, 0.7]] },
  blip: { patch: { wave: 'square', filter: 'off', attack: 0, decay: 0.06, sustain: 0, release: 0.02 }, notes: [[0, 81, 0.06, 0.7]] },
  click: { patch: { wave: 'sine', noise: 0.4, filter: 'off', attack: 0, decay: 0.015, sustain: 0, release: 0.01 }, notes: [[0, 96, 0.02, 0.8]] },
  zap: { patch: { wave: 'saw', cutoff: 5000, vibrato: 7, vibratoRate: 32, attack: 0, decay: 0.3, sustain: 0, release: 0.05 }, notes: [[0, 84, 0.3, 0.8, 55, 0.3]] },
  bounce: { patch: { wave: 'sine', filter: 'off', attack: 0, decay: 0.14, sustain: 0, release: 0.04 }, notes: [[0, 55, 0.14, 0.9, 69, 0.07]] },
  pop: { patch: { wave: 'sine', filter: 'off', attack: 0, decay: 0.07, sustain: 0, release: 0.02 }, notes: [[0, 70, 0.07, 0.9, 86, 0.04]] },
  win: { patch: { wave: 'square', wave2: 'square', level2: 0.5, pitch2: 12, filter: 'off', attack: 0, decay: 0.3, sustain: 0.4, release: 0.2, echo: 0.2 }, notes: [[0, 72, 0.1, 0.7], [0.11, 76, 0.1, 0.7], [0.22, 79, 0.1, 0.7], [0.33, 84, 0.45, 0.8]] },
  lose: { patch: { wave: 'triangle', wave2: 'square', level2: 0.3, cutoff: 2500, attack: 0, decay: 0.3, sustain: 0.5, release: 0.2 }, notes: [[0, 67, 0.16, 0.8], [0.17, 63, 0.16, 0.8], [0.34, 60, 0.16, 0.8], [0.51, 55, 0.5, 0.8, 43, 0.5]] },
}

/** CHORDS, as semitones above the root. A chord is a root and one of these: "Cm7", "F#sus4", or ("C4", "minor"). */
const CHORDS = {
  major: [0, 4, 7], maj: [0, 4, 7], minor: [0, 3, 7], min: [0, 3, 7], m: [0, 3, 7],
  dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], 5: [0, 7], power: [0, 7], octave: [0, 12],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10], dom7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], min7: [0, 3, 7, 10],
  dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], mmaj7: [0, 3, 7, 11], add9: [0, 4, 7, 14], 9: [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14],
}
/**
 * NOTE LENGTHS by name, in beats (a quarter note is one beat). Also written "1/4", or by letter: w h q e s t.
 * A dot after one makes it half as long again ("quarter.", "q."); "triplet" or a 3 makes three fit where two did ("eighth triplet", "e3").
 */
const LENGTHS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25, thirtysecond: 0.125 }
const LENGTH_LETTERS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125 }
/** The orders an arpeggio can go in, as the engine numbers them. */
const ORDERS = { up: 0, down: 1, updown: 2, written: 3, aswritten: 3, given: 3, random: 4 }
/** The waves a step of a macro can switch to. */
const MACRO_WAVES = { sine: 0, triangle: 1, saw: 2, pulse: 3, square: 3, noise: 4 }

// --- names, notes and mistakes ---------------------------------------------------------------

const key = (name) => String(name).toLowerCase().replace(/[_.\s-]/g, '')
const camel = (name) => name.replace(/[._]+(\w)/g, (_, c) => c.toUpperCase())
const shown = (v) => (typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(shown).join(', ') + ']' : String(v))
const clamp = (v, low, high) => Math.min(high, Math.max(low, v))
const KINDS = { f: 'float', i: 'int', b: 'bool', c: 'choice' }

/** Every way a setting can be written, as key(name) -> { id, name, kind, min, max, def, choices, part, scale }. */
let settings = null
/** The names to show a person: the friendly ones, then the engine's own in camelCase. */
let namesToShow = []
function allSettings() {
  if (settings) return settings
  settings = new Map()
  const byName = new Map()
  for (const [id, name, kind, min, max, def, unit, choices] of PARAMS) {
    const entry = { id, name, kind, min, max, def, unit, choices: choices || null, part: id < 200, scale: 1 }
    byName.set(name, entry)
    settings.set(key(name), entry)
  }
  const friendly = []
  for (const [alias, to] of Object.entries(ALIASES)) {
    const [name, scale] = Array.isArray(to) ? to : [to, 1]
    const entry = byName.get(name)
    if (!entry) continue
    settings.set(key(alias), scale === 1 ? entry : { ...entry, scale })
    friendly.push(alias)
  }
  namesToShow = [...friendly, ...[...byName.keys()].map(camel).filter((n) => !friendly.includes(n))]
  return settings
}
const setting = (name) => (typeof name === 'string' ? allSettings().get(key(name)) : undefined)

/** What a setting is, for a control that takes its range from it; `now` is its value in the engine's units, if it is not the default. */
function describeSetting(entry, now) {
  const value = (now === undefined ? entry.def : now) / entry.scale
  return { name: entry.name, kind: KINDS[entry.kind], min: entry.min / entry.scale, max: entry.max / entry.scale, default: entry.kind === 'c' ? entry.choices[value] : entry.kind === 'b' ? value === 1 : value,
    unit: entry.scale === 12 ? 'octaves' : entry.unit, ...(entry.choices ? { choices: [...entry.choices] } : {}) }
}
/** A setting's value as a person reads it: a choice by name, a switch as true or false, a number in the friendly name's units. */
function readSetting(entry, now) {
  const value = (now === undefined ? entry.def : now) / entry.scale
  return entry.kind === 'c' ? entry.choices[value] : entry.kind === 'b' ? value === 1 : value
}

/** The name in `names` nearest to `word`, when one is near enough to be what was meant. */
function nearest(word, names) {
  const a = key(word)
  let best = null
  // A short word has to be very near: one slip in four letters, two in eight, three in anything longer.
  let bestCost = (a.length <= 4 ? 1 : a.length <= 8 ? 2 : 3) + 1
  for (const name of names) {
    const b = key(name)
    if (b.startsWith(a) && a.length >= 4) return name
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      let last = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const keep = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1))
        last = keep
      }
    }
    if (row[b.length] < bestCost) { bestCost = row[b.length]; best = name }
  }
  return best
}
const meant = (word, names) => { const n = nearest(word, names); return n ? ` Did you mean ${shown(n)}?` : '' }

/**
 * A setting's value as the engine's number, from what a person wrote: a number, a choice by name ("saw"), true or false.
 * It throws a plain sentence for a value that cannot be meant.
 */
function settingValue(entry, value, said) {
  if (entry.kind === 'c') {
    if (typeof value === 'string') {
      const word = value.toLowerCase().trim()
      let i = entry.choices.indexOf(word)
      if (i < 0) i = entry.choices.indexOf(CHOICE_WORDS[word])
      if (i < 0) i = entry.choices.indexOf(word + 'db')
      if (i >= 0) return i
      const words = Object.keys(CHOICE_WORDS).filter((w) => entry.choices.includes(CHOICE_WORDS[w]))
      throw new Error(`${said}: ${shown(value)} is not one of its choices.${meant(value, [...entry.choices, ...words])} They are: ${entry.choices.join(', ')}`)
    }
    if (typeof value === 'number' && entry.choices.includes(value + 'db')) return entry.choices.indexOf(value + 'db')
  }
  if (entry.kind === 'b') {
    if (value === true || value === 'on') return 1
    if (value === false || value === 'off') return 0
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    const wants = entry.kind === 'c' ? `one of ${entry.choices.join(', ')}` : entry.kind === 'b' ? 'true or false' : `a number from ${entry.min / entry.scale} to ${entry.max / entry.scale}`
    throw new Error(`${said} needs ${wants}, not ${shown(value)}`)
  }
  return clamp(value * entry.scale, entry.min, entry.max)
}

/**
 * Settings as a person wrote them -> Map of engine id -> number, added to `into`. `strict` throws on a name that
 * does not exist or a value that cannot be meant; without it they are passed over. `sampleSlot` turns a sample's
 * id into the number the engine knows it by.
 */
function patchOf(given, said, strict, into = new Map(), sampleSlot = null) {
  for (const [name, value] of Object.entries(given || {})) {
    if (name === 'note' || name === 'preset' || name === 'macro') continue
    const entry = setting(name)
    if (!entry) {
      if (strict) throw new Error(`${said}: there is no setting called ${shown(name)}.${meant(name, namesToShow)}`)
      continue
    }
    if (entry.name.endsWith('.sample') && sampleSlot) { into.set(entry.id, sampleSlot(value)); continue }
    try {
      into.set(entry.id, settingValue(entry, value, `${said}: ${name}`))
      // "square" is the pulse wave at an even width (the width is four ids after the wave).
      if (typeof value === 'string' && value.toLowerCase().trim() === 'square' && entry.choices?.includes('pulse')) into.set(entry.id + 4, 0.5)
    } catch (e) {
      if (strict) throw e
    }
  }
  return into
}

/** A note length by name as a number of beats: "quarter" is 1, "eighth." is 0.75, "1/16" is 0.25, "q3" is two thirds. Not a length: null. */
export function lengthBeats(name) {
  if (typeof name !== 'string') return null
  let text = name.toLowerCase().replace(/[\s_-]/g, '')
  let times = 1
  if (text.startsWith('dotted')) { times *= 1.5; text = text.slice(6) }
  if (text.endsWith('triplet')) { times *= 2 / 3; text = text.slice(0, -7) }
  if (text.endsWith('.')) { times *= 1.5; text = text.slice(0, -1) }
  if (text.endsWith('note')) text = text.slice(0, -4)
  if (text.length > 1 && /[a-z]3$/.test(text)) { times *= 2 / 3; text = text.slice(0, -1) }
  const fraction = /^(\d+)\/(\d+)$/.exec(text)
  if (fraction && +fraction[2] > 0) return 4 * fraction[1] / fraction[2] * times
  const beats = Object.prototype.hasOwnProperty.call(LENGTHS, text) ? LENGTHS[text] : Object.prototype.hasOwnProperty.call(LENGTH_LETTERS, text) ? LENGTH_LETTERS[text] : null
  return beats === null ? null : beats * times
}
const NOT_A_LENGTH = 'a number, or a note length by name: "whole", "half", "quarter", "eighth", "sixteenth" (also "1/4", "q", and "quarter." for a dotted one)'

const SEMITONES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
/** A note as a number: "C4" is 60, "A4" is 69, "F#3" and "Bb5" work, and a number is itself. */
export function noteNumber(note) {
  if (typeof note === 'number' && Number.isFinite(note)) return note
  if (typeof note === 'string') {
    const m = /^\s*([a-gA-G])([#b♯♭]*)(-?\d+)?\s*$/.exec(note)
    if (m) {
      let n = SEMITONES[m[1].toLowerCase()]
      for (const c of m[2]) n += c === '#' || c === '♯' ? 1 : -1
      return 12 * ((m[3] === undefined ? 4 : +m[3]) + 1) + n
    }
    if (note.trim() !== '' && Number.isFinite(+note)) return +note
  }
  throw new Error(`${shown(note)} is not a note. Write a note as a name like "C4", "F#3" or "Bb5", or as a number, where 60 is middle C`)
}

// The kind of chord a person named: "m7", "Maj7", "M7" (a capital M is major), "minor".
function chordKind(kind) {
  let k = String(kind).trim()
  if (/^M(?!aj|in|AJ|IN)/.test(k)) k = 'maj' + k.slice(1)
  k = k.toLowerCase().replace(/[\s_-]/g, '')
  if (k === 'maj' || k === '') k = 'major'
  return Object.prototype.hasOwnProperty.call(CHORDS, k) ? CHORDS[k] : null
}
const kindsToShow = () => ['major', 'minor', 'dim', 'aug', 'sus2', 'sus4', '5', '6', 'm6', '7', 'maj7', 'm7', 'dim7', 'm7b5', 'mmaj7', 'add9', '9', 'maj9', 'm9', 'octave']

/**
 * The notes of a chord, as numbers: chordNotes("Cm7") is [60, 63, 67, 70], chordNotes("C3", "minor") is [48, 51, 55].
 * A letter followed by a number is always a note, so "C7" is the note C in octave 7: a seventh chord is "Cdom7",
 * or ("C", "7"). With no kind at all, it is a major chord.
 */
export function chordNotes(name, kind) {
  if (Array.isArray(name)) return name.map(noteNumber)
  let root = name
  if (kind === undefined && typeof name === 'string') {
    const m = /^\s*([a-gA-G][#b♯♭]*(?:-?\d+)?)\s*(.*?)\s*$/.exec(name)
    if (m) { root = m[1]; kind = m[2] }
  }
  const base = noteNumber(root)
  const steps = chordKind(kind === undefined ? '' : kind)
  if (!steps) throw new Error(`${shown(kind)} is not a kind of chord.${meant(String(kind), Object.keys(CHORDS))} The kinds are: ${kindsToShow().join(', ')}`)
  return steps.map((s) => base + s)
}

// What play() is given -> a list of note numbers: a note, a list of notes, or a chord by name ("Cm7").
function notesOf(what) {
  if (Array.isArray(what)) return what.map(noteNumber)
  if (typeof what === 'string' && !/^\s*[a-gA-G][#b♯♭]*(-?\d+)?\s*$/.test(what) && /^\s*[a-gA-G]/.test(what) && !Number.isFinite(+what)) {
    const m = /^\s*([a-gA-G][#b♯♭]*(?:-?\d+)?)\s*(.*?)\s*$/.exec(what)
    if (m && chordKind(m[2])) return chordNotes(what)
    if (m) throw new Error(`${shown(what)} is not a note or a chord.${meant(m[2], Object.keys(CHORDS)) && ` Did you mean ${shown(m[1] + nearest(m[2], Object.keys(CHORDS)))}?`} A note is written "C4" or "F#3", and a chord "Cm", "Cmaj7" or "Csus4"`)
  }
  return [noteNumber(what)]
}

// The order of an arpeggio as the engine's number, from "up", "down", "up-down", "as written" or "random".
function orderOf(order, strict, said) {
  if (order === undefined || order === null) return 0
  if (typeof order === 'number' && order >= 0 && order <= 4) return Math.floor(order)
  const k = key(order)
  if (Object.prototype.hasOwnProperty.call(ORDERS, k)) return ORDERS[k]
  if (strict) throw new Error(`${said}: ${shown(order)} is not an order an arpeggio can go in.${meant(String(order), ['up', 'down', 'up-down', 'as written', 'random'])} The orders are: up, down, up-down, as written, random`)
  return 0
}

/**
 * A STEP MACRO as the engine takes it, from what a person wrote: a list of steps, or { steps, loop, release, slide }.
 * A step is { wave, pitch, width, cutoff, volume } with any of them left out, or the five as a list.
 * `loop` is true (the whole list goes round while the note is held) or [first step, step after the last].
 */
function macroOf(given, strict, said) {
  if (given === null || given === undefined || given === false) return null
  const spec = Array.isArray(given) ? { steps: given } : given
  const bad = (why) => { if (strict) throw new Error(`${said}: ${why}`); return null }
  if (!spec || !Array.isArray(spec.steps) || !spec.steps.length) return bad(`a macro needs a list of steps, as in [{ pitch: 0 }, { pitch: 4 }, { pitch: 7 }], not ${shown(given)}`)
  if (spec.steps.length > 64) return bad(`a macro has room for 64 steps, and this has ${spec.steps.length}`)
  const flat = []
  for (const step of spec.steps) {
    const o = Array.isArray(step) ? { wave: step[0], pitch: step[1], width: step[2], cutoff: step[3], volume: step[4] } : step || {}
    let wave = -1
    if (typeof o.wave === 'number') wave = o.wave
    else if (o.wave !== undefined && o.wave !== null) {
      wave = MACRO_WAVES[String(o.wave).toLowerCase()]
      if (wave === undefined) return bad(`${shown(o.wave)} is not a wave a step can switch to.${meant(String(o.wave), Object.keys(MACRO_WAVES))} They are: ${Object.keys(MACRO_WAVES).join(', ')}`)
    }
    for (const name of ['pitch', 'width', 'cutoff', 'volume']) if (o[name] !== undefined && o[name] !== null && (typeof o[name] !== 'number' || !Number.isFinite(o[name]))) return bad(`a step's ${name} needs a number, not ${shown(o[name])}`)
    flat.push(wave, o.pitch ?? 0, o.width ?? (String(o.wave).toLowerCase() === 'square' ? 0.5 : -1), o.cutoff ?? 0, o.volume ?? 1)
  }
  const count = spec.steps.length
  const loop = spec.loop === true ? [0, count] : Array.isArray(spec.loop) ? spec.loop : [0, 0]
  return { flat, count, loopStart: loop[0] | 0, loopEnd: loop[1] | 0, release: Number.isInteger(spec.release) ? spec.release : 255, flags: spec.slide ? 1 : 0 }
}

/** Each thing said once in the console, however often it happens. */
const told = new Set()
function tell(what, how = 'warn') {
  if (told.has(what)) return
  told.add(what)
  if (typeof console !== 'undefined') console[how]('synths.js: ' + what)
}

// --- voices ----------------------------------------------------------------------------------

/** The voice changers as engine ids: { rows: name -> Map of id -> value, all: every id any of them sets }. */
let voiceTable = null
function voices() {
  if (voiceTable) return voiceTable
  const rows = new Map(), all = new Set()
  for (const [name, voice] of Object.entries(VOICES)) {
    const row = patchOf(voice.values, '', false)
    rows.set(name, row)
    for (const pid of row.keys()) all.add(pid)
  }
  return (voiceTable = { rows, all })
}
/** A setting's name as the microphone says it -> the name every synth knows it by. */
const micName = (name) => (typeof name === 'string' && Object.prototype.hasOwnProperty.call(MIC_NAMES, key(name)) ? MIC_NAMES[key(name)] : name)
const NO_VOICE = new Set(['none', 'plain', 'off', 'normal', ''])
/** A voice's name as written -> its name here, "none" for the plain voice, or null for a name that is not a voice. */
function voiceName(name) {
  if (name === null || name === undefined || name === false) return 'none'
  const k = key(name)
  return NO_VOICE.has(k) ? 'none' : Object.prototype.hasOwnProperty.call(VOICES, k) ? k : null
}
/**
 * PUT A VOICE ON. `worn` is what is remembered between voices ({ voice, under }) and `patch` the settings, by engine
 * id. The first voice put on keeps what the settings it may touch were (`under`); every voice after starts by
 * putting those back, so a voice never leaves a trace in the next, and "none" is how things were before any.
 * A setting of the whole engine (the echo's time, the reverb's size) is touched only if this voice or the last
 * names it. It gives the settings to send, as a Map of id -> value, and changes `patch` to match.
 */
function wearVoice(worn, patch, name, defaults) {
  const { rows, all } = voices()
  const row = rows.get(name) || new Map()
  const last = rows.get(worn.voice) || new Map()
  if (!worn.under) {
    worn.under = new Map()
    for (const pid of all) if (patch.has(pid)) worn.under.set(pid, patch.get(pid))
  }
  const out = new Map()
  for (const pid of all) {
    if (pid >= 200 && !row.has(pid) && !last.has(pid)) continue
    out.set(pid, row.has(pid) ? row.get(pid) : worn.under.has(pid) ? worn.under.get(pid) : defaults(pid))
  }
  for (const [pid, value] of out) patch.set(pid, value)
  worn.voice = name
  if (name === 'none') worn.under = null
  return out
}
let defaultOf = null
/** The engine's default for a setting, by id. */
function engineDefault(pid) {
  if (!defaultOf) defaultOf = new Map(PARAMS.map((p) => [p[0], p[5]]))
  return defaultOf.get(pid)
}

// --- WAV files -------------------------------------------------------------------------------

/** A WAV file's bytes -> { pcm: Float32Array (left, right, left, …), channels, rate }, or null if it is not one this reads. */
export function readWav(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = (at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
  if (b.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let format = 0, channels = 0, rate = 0, bits = 0
  for (let at = 12; at + 8 <= b.length;) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      rate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true)
    } else if (id === 'data') {
      const step = bits / 8
      if (!(format === 1 || format === 3) || !step || channels < 1 || channels > 2) return null
      const count = Math.floor(Math.min(size, b.length - body) / step)
      const pcm = new Float32Array(count)
      for (let i = 0; i < count; i++) {
        const p = body + i * step
        pcm[i] = format === 3 ? (bits === 64 ? view.getFloat64(p, true) : view.getFloat32(p, true))
          : bits === 8 ? (b[p] - 128) / 128
          : bits === 16 ? view.getInt16(p, true) / 32768
          : bits === 24 ? ((view.getInt8(p + 2) << 16) | (b[p + 1] << 8) | b[p]) / 8388608
          : view.getInt32(p, true) / 2147483648
      }
      return { pcm, channels, rate }
    }
    at = body + size + (size & 1)
  }
  return null
}

/** Left and right samples -> the bytes of a 16-bit stereo WAV file. */
export function toWav(left, right, sampleRate) {
  const frames = left.length
  const bytes = new Uint8Array(44 + frames * 4)
  const view = new DataView(bytes.buffer)
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 4, true); text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, frames * 4, true)
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 4, Math.round(clamp(left[i], -1, 1) * 32767), true)
    view.setInt16(46 + i * 4, Math.round(clamp((right || left)[i], -1, 1) * 32767), true)
  }
  return bytes
}

/** Samples as the engine keeps them (one channel, or left, right, left, …) -> the bytes of a 16-bit WAV file with as many channels. */
function pcmWav(pcm, channels, sampleRate) {
  const bytes = new Uint8Array(44 + pcm.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.round(clamp(pcm[i], -1, 1) * 32767), true)
  return bytes
}

// --- the core: the engine and its queue, on the audio thread ---------------------------------

/**
 * THE CORE holds the engine and feeds it. It runs wherever the samples are made: in the audio worklet, on the page
 * for the fallback, or in node for an offline render. It is given low-level `ops` that the conductor (below) has
 * already worked out, keeps the events that are not due yet in its own queue (so "stop everything" can take back
 * notes that have not started, and the engine's own queue never fills), and repeats tunes on the exact sample.
 *
 * THIS FUNCTION STANDS ALONE: its text is what the worklet runs, so it may use nothing outside itself.
 *
 * @param wasm        the engine: a WebAssembly.Module, or its bytes
 * @param sampleRate  frames a second
 * @param post        called with a message for the page ({ type: 'unsupported', what })
 */
function makeCore(wasm, sampleRate, post) {
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

/** The audio worklet's processor: the core, a block at a time. Its text is what the worklet runs, with makeCore. */
function registerSynths(makeCore) {
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
      core.render(out[0], out[1], out[0].length, 0, (this.mic && inputs[0] && inputs[0][0]) || null)
      if (this.watch && (++this.blocks & 7) === 0) {
        if ((this.watchFor -= 8) <= 0) this.watch = null
        else this.port.postMessage({ type: 'taps', taps: core.taps(this.watch, 1024), song: this.watchSong ? core.songPosition() : null })
      }
      return true
    }
  })
}

/** The text of the worklet's module: what `synths-worklet.js` holds, and what is loaded from a Blob without it. */
export const workletSource = `// synths.js: the audio worklet. Made from synths.js by scripts/sync-engine.mjs; do not edit.\nconst makeCore = ${makeCore.toString()}\n;(${registerSynths.toString()})(makeCore)\n`

// --- the conductor: commands in, the core's ops out ------------------------------------------

/**
 * THE CONDUCTOR carries out commands (docs/commands.md). It knows which part of the engine each synth has, which
 * slot each sample is in and what every part is set to, and turns a command into the engine events that do it.
 * It runs on the player's side of the transport, never on the audio thread. One is shared by the real-time
 * player and the offline one, which is why they sound the same.
 *
 * @param post   given the ops for the core: post(ops, transfer)
 * @param load     reads and decodes a sample: load({ url, bytes }) -> Promise<{ pcm, channels, rate }>
 * @param bytesOf  reads a file as it is: bytesOf({ url, bytes }) -> Promise<bytes>
 * @param say      tells a sender something, as plain data: say(the sender's scope, { type: 'recorded', id, … })
 */
function makeConductor(post, load, bytesOf, say = () => {}) {
  const params = allSettings()
  const partParams = PARAMS.filter((p) => p[0] < 200)
  const id = (name) => params.get(key(name)).id
  const PARAM = 4, NOTE_ON = 1, NOTE_OFF = 2, VOICE_PITCH = 6, VOICE_FREQ = 7, VOICE_VOLUME = 8, VOICE_PAN = 9, VOICE_KILL = 11, ARP = 13, ARP_MORE = 14
  const canArp = ENGINE.events.includes('arp')
  const MASTER = id('master.volume')
  // The live input, in an engine that has one: which part it plays through, and whether it is heard.
  const INPUT_PART = params.get('inputpart')?.id, MONITOR = params.get('inputmonitor')?.id
  /** What the settings of the whole engine were last set to, by id. */
  const globals = new Map()

  /** id -> { patch: Map of engine id -> value, part: its part or -1, used, note } */
  const synths = new Map()
  /** For each part: who has it, and what every parameter was last set to. */
  const parts = Array.from({ length: Math.min(SYNTH_PARTS, ENGINE.parts) }, () => ({ owner: null, values: new Map(), macro: null }))
  const slots = new Map()
  const freeSlots = []
  let nextSlot = 0
  let uses = 0
  let handle = 0x80000000
  let volume = 1, muted = false, paused = false
  let ops = []
  let transfer = []
  /** Samples still being read: the offline player waits for these before it renders. */
  const loading = new Set()

  const event = (at, type, part, a, x, y, z, b) => ops.push(['e', at, type, part, a >>> 0, x, y || 0, z || 0, b || 0])

  /**
   * SCOPES. Several senders can share one player without knowing of each other (the scenes on one page): each
   * names a scope on its batches. A scope has its own ids, its own volume, mute and pause, and "stop everything"
   * stops only what is its own. The scope with no name is the player itself: its volume is the volume of all.
   * A scope's volume is made by turning each of its synths' parts down, since the engine has one master volume.
   */
  const scopes = new Map()
  let scope = null
  let prefix = ''
  const VOLUME = id('volume')
  function enter(name) {
    name = name || ''
    prefix = name ? name + '\u0001' : ''
    scope = scopes.get(name)
    if (!scope) scopes.set(name, scope = { name, tempo: 120, gain: 1, muted: false, paused: false, synths: new Set(), samples: new Set(), tunes: new Set() })
  }
  const heard = (sc) => (sc.name === '' ? 1 : sc.muted || sc.paused ? 0 : sc.gain)
  // What a part is really set to for a synth's setting: its volume is turned by its scope's.
  const real = (rec, pid, value) => (pid === VOLUME ? clamp(value * heard(rec.scope), 0, 2) : value)
  function record(sid, patch, note, macro) {
    const rec = { patch, part: -1, used: 0, note, macro, scope }
    synths.set(sid, rec)
    scope.synths.add(sid)
    return rec
  }
  const slotFor = (sample) => slotOf(prefix + sample)
  // A scope's volume has changed: turn its parts.
  function turn(sc, at) {
    for (const sid of sc.synths) {
      const rec = synths.get(sid)
      if (!rec || rec.part < 0) continue
      const want = real(rec, VOLUME, rec.patch.has(VOLUME) ? rec.patch.get(VOLUME) : 1)
      parts[rec.part].values.set(VOLUME, want)
      event(at, PARAM, rec.part, VOLUME, want, 0.02)
    }
  }

  // Give the note with a handle an arpeggio (or change the one it has, or with no offsets take it away): the
  // engine steps one voice through the offsets, in semitones, so many times a second.
  function arpeggio(at, part, h, arp) {
    if (!canArp) return tell('arpeggios are not ready yet in this version, so an arpeggio plays as its lowest note alone.')
    const offsets = arp && Array.isArray(arp.offsets) ? arp.offsets.slice(0, 8).map((v) => clamp(Math.round(+v || 0), -128, 127)) : []
    const pack = (o) => ((o[0] & 255) | (o[1] & 255) << 8 | (o[2] & 255) << 16 | (o[3] & 255) << 24) >>> 0
    event(at, ARP, part, h, arp && arp.rate > 0 ? clamp(arp.rate, 0.1, 1000) : 50, orderOf(arp && arp.order, false), offsets.length, pack(offsets))
    if (offsets.length > 4) event(at, ARP_MORE, part, h, 0, 0, 0, pack(offsets.slice(4)))
  }
  const autoHandle = () => (handle = handle >= 0xbffffff0 ? 0x80000001 : handle + 1)
  const plain = () => patchOf(PLAIN, '', false)

  function slotOf(sample) {
    let slot = slots.get(sample)
    if (slot === undefined) {
      slot = freeSlots.length ? freeSlots.pop() : nextSlot < SAMPLE_SLOTS ? nextSlot++ : -1
      if (slot < 0) {
        tell(`more than ${SAMPLE_SLOTS} samples are loaded at once, which is all there is room for. The newest one will be silent.`)
        return SAMPLE_SLOTS - 1
      }
      slots.set(sample, slot)
    }
    return slot
  }

  // Set a part to a synth's patch at a time, sending only what differs from what the part already has.
  function dress(rec, at) {
    const part = parts[rec.part]
    for (const [pid, , , , , def] of partParams) {
      const want = real(rec, pid, rec.patch.has(pid) ? rec.patch.get(pid) : def)
      if ((part.values.has(pid) ? part.values.get(pid) : def) !== want) {
        part.values.set(pid, want)
        event(at, PARAM, rec.part, pid, want, 0)
      }
    }
    if (part.macro !== rec.macro) {
      part.macro = rec.macro
      const m = rec.macro
      ops.push(m ? ['macro', rec.part, m.flat, m.count, m.loopStart, m.loopEnd, m.release, m.flags] : ['macro', rec.part, [], 0, 0, 0, 255, 0])
    }
  }

  // A synth needs a part. When all are taken, the one used longest ago gives its part up (and takes one back
  // the same way if it is ever played again).
  function seat(rec, at) {
    if (rec.part >= 0) return
    let index = parts.findIndex((p) => !p.owner)
    if (index < 0) {
      let oldest = null
      for (const other of synths.values()) if (other.part >= 0 && other !== mic && (!oldest || other.used < oldest.used)) oldest = other
      tell(`more than ${parts.length} synths are in use at once, which is all there is room for. The one played longest ago gave up its place. To free one yourself, call its remove().`)
      index = oldest.part
      ops.push(['stopPart', index, 1])
      oldest.part = -1
    }
    parts[index].owner = rec
    rec.part = index
    dress(rec, at)
  }

  function synthFor(sid, at) {
    let rec = synths.get(sid)
    if (!rec) {
      rec = record(sid, patchOf(PRESETS.keys, '', false, plain()), 60, null)
    }
    seat(rec, at)
    rec.used = ++uses
    return rec
  }

  const note = (n) => { try { return noteNumber(n) } catch (e) { return null } }
  const notes = (n) => (Array.isArray(n) ? n : [n]).map(note).filter((v) => v !== null)

  function setAll(rec, given, at, glide) { change(rec, patchOf(given, '', false, new Map(), slotFor), at, glide) }
  // Settings by engine id: a part's go to the synth and its part, the whole engine's to the engine.
  function change(rec, changed, at, glide) {
    for (const [pid, value] of changed) {
      if (pid >= 200) { if (pid !== MASTER && pid !== INPUT_PART && pid !== MONITOR) { globals.set(pid, value); event(at, PARAM, 0, pid, value, glide) } continue }
      if (!rec) continue
      rec.patch.set(pid, value)
      if (rec.part >= 0) {
        parts[rec.part].values.set(pid, real(rec, pid, value))
        event(at, PARAM, rec.part, pid, real(rec, pid, value), glide)
      }
    }
  }

  // A voice changer on a synth (or on the microphone, which is one here): see wearVoice. A name that is not a voice is passed over.
  function voiceOn(rec, name, at) {
    const voice = voiceName(name)
    if (voice === null) return
    if (!rec.worn) rec.worn = { voice: 'none', under: null }
    // The synth's settings and the engine's are looked at together, and what comes back is sent to each.
    const both = new Map([...globals, ...rec.patch])
    change(rec, wearVoice(rec.worn, both, voice, engineDefault), at, 0)
  }

  /**
   * THE MICROPHONE is a synth with no notes of its own: the engine plays its live input through the part of
   * whichever synth this is, so that part's filter, effects, volume, scope and meter are the microphone's. It
   * keeps its part for as long as it is open, and is heard only while it is listened to.
   */
  let mic = null
  const hear = (at) => { if (MONITOR !== undefined) event(at, PARAM, 0, MONITOR, mic && mic.listen && mic.part >= 0 ? 1 : 0, 0) }
  /** Recordings being made, and samples being read out to save: what the core will answer about, and for whom. */
  const recordings = new Map()
  const saves = new Map()
  let asked = 0
  // A sample's loop, by what was asked: true for all of it, or [first frame, the frame after the last].
  const loopOf = (c) => { const loop = c.loop === true ? [0, 0] : Array.isArray(c.loop) ? c.loop : null; return [loop ? (c.pingpong ? 2 : 1) : 0, loop ? loop[0] : 0, loop ? loop[1] : 0] }

  // setVolume(1) is the engine's master volume at 0.5: loud enough for one voice, with room for many.
  const master = (at) => event(at, PARAM, 0, MASTER, muted || paused ? 0 : clamp(volume * 0.5, 0, 2), 0)

  const does = {
    synth(c, at) {
      let rec = synths.get(c.id)
      if (!rec) { rec = record(c.id, null, 60, null); rec.used = ++uses }
      const preset = c.preset == null ? null : PRESETS[c.preset] || PRESETS.keys
      rec.patch = patchOf(c.set, '', false, patchOf(preset, '', false, plain()), slotFor)
      rec.note = (preset && preset.note) || 60
      rec.macro = macroOf(c.macro !== undefined ? c.macro : preset && preset.macro, false)
      for (const [pid, value] of rec.patch) if (pid >= 200) { rec.patch.delete(pid); if (pid !== MASTER) event(at, PARAM, 0, pid, value, 0) }
      rec.worn = null
      if (rec.part >= 0) dress(rec, at)
      else seat(rec, at)
      if (c.voice != null) voiceOn(rec, c.voice, at)
    },
    set(c, at) {
      const rec = c.id == null ? null : synthFor(c.id, at)
      if (rec && c.voice != null) voiceOn(rec, c.voice, at)
      if (c.set) setAll(rec, c.set, at, c.glide > 0 ? c.glide : 0)
    },
    // The microphone: opened (it takes a part and the engine's input is sent there), listened to or not, and closed.
    mic(c, at) {
      let rec = synths.get(c.id)
      if (c.do === 'close') {
        if (!rec) return
        if (rec.part >= 0) { ops.push(['stopPart', rec.part, 1]); parts[rec.part].owner = null; rec.part = -1 }
        rec.listen = false
        if (mic === rec) { mic = null; hear(at) }
        return
      }
      if (INPUT_PART === undefined) return tell('the microphone is not ready yet in this version, so nothing will be heard from it. The rest of your sound is not affected.')
      if (!rec) { rec = record(c.id, new Map(), 60, null); rec.listen = false }
      rec.used = ++uses
      // One microphone, one part: it goes to whoever asked for it last.
      if (mic && mic !== rec && mic.part >= 0) { ops.push(['stopPart', mic.part, 1]); parts[mic.part].owner = null; mic.part = -1 }
      mic = rec
      const seated = rec.part < 0
      seat(rec, at)
      if (seated) event(at, PARAM, 0, INPUT_PART, rec.part, 0)
      if (c.voice != null) voiceOn(rec, c.voice, at)
      if (c.set) setAll(rec, c.set, at, 0)
      if (c.listen != null) rec.listen = !!c.listen
      hear(at)
    },
    /**
     * Record into a sample: the microphone as it comes in (or after its effects, with `effects`, while it is
     * listened to), a synth, or everything that is played. The sample can be played while it is being recorded.
     */
    record(c, at) {
      if (c.do === 'stop') {
        // One recording by its id, or with none every recording of this sender.
        for (const [slot, r] of recordings) if (c.id != null ? r.sid === c.id : r.scope === scope.name) ops.push(['recordStop', at, slot])
        return
      }
      const mine = { sid: c.id, id: prefix ? c.id.slice(prefix.length) : c.id, scope: scope.name }
      const none = () => say(mine.scope, { type: 'recorded', id: mine.id, frames: 0, seconds: 0, full: false })
      if (!ENGINE.events.includes('record')) { tell('recording is not ready yet in this version, so a recording will be empty. The rest of your sound is not affected.'); return none() }
      let source = 0, part = 0
      if (c.from === 'output') source = 2
      else if (c.from === 'synth') { source = 1; part = synthFor(c.synth, at).part } else {
        if (!mic || mic.part < 0) return none()
        if (c.effects && mic.listen) { source = 1; part = mic.part }
      }
      const slot = slotOf(c.id)
      scope.samples.add(c.id)
      const len = c.len > 0 ? Math.min(c.len, LONGEST_RECORDING) : null
      const room = len ?? clamp(c.max > 0 ? c.max : USUAL_RECORDING, 0.01, LONGEST_RECORDING)
      mine.loop = c.loop ? loopOf(c) : null
      mine.open = len === null
      recordings.set(slot, mine)
      ops.push(['record', slot, at, len, source, part, room, c.from === 'output' ? 2 : 1])
    },
    // A sample read back out of the engine and handed to whoever asked, as a WAV file.
    save(c) {
      const slot = slots.get(c.id)
      const mine = { id: prefix ? c.id.slice(prefix.length) : c.id, scope: scope.name, name: c.name || 'sound.wav', ask: c.ask, download: c.download !== false }
      // Something that is not a sample here is saved as a file with no sound in it, so whoever asked is still answered.
      if (slot === undefined) return say(mine.scope, { type: 'saved', id: mine.id, ask: mine.ask, name: mine.name, seconds: 0, bytes: pcmWav(new Float32Array(0), 1, 48000) })
      const go = () => { saves.set(++asked, mine); ops.push(['sampleRead', slot, asked]) }
      // A recording that is still being made is saved when it is over, and a sample still being fetched when it has arrived.
      const making = recordings.get(slot)
      if (making) (making.then = making.then || []).push(go)
      else if (loading.size) Promise.allSettled([...loading]).then(() => { go(); flush() })
      else go()
    },
    macro(c, at) {
      const rec = synthFor(c.id, at)
      rec.macro = macroOf(c.macro, false)
      dress(rec, at)
    },
    free(c) {
      const rec = synths.get(c.id)
      if (!rec) return
      if (rec.part >= 0) { ops.push(['stopPart', rec.part, 0]); parts[rec.part].owner = null; rec.part = -1 }
    },
    note(c, at) {
      const rec = synthFor(c.id, at)
      const h = c.h > 0 ? c.h : autoHandle()
      const list = c.note == null ? [rec.note] : notes(c.note)
      for (const n of list) event(at, NOTE_ON, rec.part, h, n, c.vel == null ? 0.8 : clamp(c.vel, 0, 1))
      if (c.pan) event(at, VOICE_PAN, rec.part, h, clamp(c.pan, -1, 1))
      if (c.arp) arpeggio(at, rec.part, h, c.arp)
      if (c.len != null && list.length) event(at + Math.max(0.001, c.len), NOTE_OFF, rec.part, h, 0)
    },
    off(c, at) {
      const rec = synths.get(c.id)
      if (!rec || rec.part < 0) return
      if (c.h > 0) event(at, NOTE_OFF, rec.part, c.h, 0)
      else if (c.note != null) for (const n of notes(c.note)) event(at, NOTE_OFF, rec.part, 0, n)
      else ops.push(['stopPart', rec.part, c.cut ? 1 : 0])
    },
    voice(c, at) {
      const rec = synths.get(c.id)
      if (!rec || rec.part < 0 || !(c.h > 0)) return
      const glide = c.glide > 0 ? c.glide : 0
      if (c.pitch != null && note(c.pitch) !== null) event(at, VOICE_PITCH, rec.part, c.h, note(c.pitch), glide)
      if (c.freq > 0) event(at, VOICE_FREQ, rec.part, c.h, c.freq, glide)
      if (c.vol != null) event(at, VOICE_VOLUME, rec.part, c.h, clamp(c.vol, 0, 4))
      if (c.pan != null) event(at, VOICE_PAN, rec.part, c.h, clamp(c.pan, -1, 1))
      if (c.arp !== undefined) arpeggio(at, rec.part, c.h, c.arp)
      if (c.kill) event(at, VOICE_KILL, rec.part, c.h, 0)
    },
    sound(c, at) {
      const sound = SOUNDS[c.name]
      if (!sound) return
      const sid = prefix + 'sound:' + c.name
      if (!synths.has(sid)) record(sid, patchOf(sound.patch, '', false, plain()), 60, macroOf(sound.patch.macro, false))
      const rec = synthFor(sid, at)
      // With a length of its own the sound is cut short there, or its last note is held until then.
      const cut = c.len > 0 ? c.len : null
      const last = sound.notes[sound.notes.length - 1]
      for (const each of sound.notes) {
        const [after, n, , vel, slideTo, slideTime] = each
        if (cut !== null && after >= cut) continue
        const len = cut === null ? each[2] : each === last ? cut - after : Math.min(each[2], cut - after)
        const h = autoHandle()
        const when = at + after
        if (cut !== null && after + len >= cut - 1e-9) event(at + cut + 0.03, VOICE_KILL, rec.part, h, 0)
        event(when, NOTE_ON, rec.part, h, n + (c.pitch || 0), vel)
        if (c.vol != null && c.vol !== 1) event(when, VOICE_VOLUME, rec.part, h, clamp(c.vol, 0, 4))
        if (c.pan) event(when, VOICE_PAN, rec.part, h, clamp(c.pan, -1, 1))
        if (slideTo != null) event(when, VOICE_PITCH, rec.part, h, slideTo + (c.pitch || 0), slideTime)
        event(when + len, NOTE_OFF, rec.part, h, 0)
      }
    },
    sample(c) {
      // With no sound in it, the command changes a sample that is already there: its loop, or the note it was recorded at.
      if (!c.pcm && !c.url && !c.bytes) {
        const slot = slots.get(c.id)
        if (slot === undefined) return
        const making = recordings.get(slot)
        if (making) { making.loop = c.loop ? loopOf(c) : null; return }
        return ops.push(['sampleConfig', slot, c.note == null ? null : note(c.note), ...loopOf(c)])
      }
      const slot = slotOf(c.id)
      scope.samples.add(c.id)
      const send = ({ pcm, channels, rate }) => {
        const base = c.note == null ? 60 : note(c.note) ?? 60
        ops.push(['sample', slot, pcm, channels, rate, base, ...loopOf(c)])
        transfer.push(pcm.buffer)
      }
      if (c.pcm) return send({ pcm: Float32Array.from(c.pcm), channels: c.channels === 2 ? 2 : 1, rate: c.rate || 44100 })
      const job = load(c).then((sound) => { send(sound); flush() }, (e) => tell(`the sample ${shown(c.name || c.url || c.id)} could not be loaded (${(e && e.message) || e}), so it will be silent.`))
      loading.add(job)
      job.finally(() => loading.delete(job))
    },
    unsample(c) {
      const slot = slots.get(c.id)
      if (slot === undefined) return
      recordings.delete(slot)
      slots.delete(c.id)
      freeSlots.push(slot)
      ops.push(['unsample', slot])
    },
    tune(c, at) {
      const rec = synthFor(c.synth, at)
      const steps = (c.steps || []).map(([after, n, len, vel]) => [Math.max(0, after), n == null ? [rec.note] : notes(n), Math.max(0.001, len), vel == null ? 0.8 : clamp(vel, 0, 1)])
        .filter((s) => s[1].length).sort((a, b) => a[0] - b[0])
      const length = c.length > 0 ? c.length : steps.length ? steps[steps.length - 1][0] + steps[steps.length - 1][2] : 0
      // The last number is how many times round; 0 is for ever.
      scope.tunes.add(c.id)
      ops.push(['tune', c.id, at, rec.part, steps, length, c.repeat === true ? 0 : c.repeat > 1 ? Math.floor(c.repeat) : 1, c.beats ? 60 / scope.tempo : 0, scope.name])
    },
    // How fast the beat is for this sender: tunes written in beats change speed from here on.
    tempo(c, at) {
      if (!(c.bpm > 0)) return
      scope.tempo = clamp(+c.bpm, 20, 400)
      ops.push(['tempo', scope.name, 60 / scope.tempo, at])
    },
    stop(c) {
      if (c.id != null) ops.push(['stopTune', c.id])
      else if (scope.name === '') ops.push(['stop'])
      else {
        // Everything of this scope, and nothing of anyone else's.
        for (const sid of scope.synths) if (synths.get(sid)?.part >= 0) ops.push(['stopPart', synths.get(sid).part, 1])
        for (const tune of scope.tunes) ops.push(['stopTune', tune])
        scope.tunes.clear()
        if (song && song.scope === scope) { if (song.ready) steer({ do: 'stop' }, null); else song = null }
      }
    },
    master(c, at) {
      if (c.set) setAll(null, c.set, at, 0)
      if (c.volume == null && c.mute == null && c.pause == null) return
      if (scope.name === '') {
        if (c.volume != null && Number.isFinite(+c.volume)) volume = Math.max(0, +c.volume)
        if (c.mute != null) muted = !!c.mute
        if (c.pause != null) paused = !!c.pause
        return master(at)
      }
      if (c.volume != null && Number.isFinite(+c.volume)) scope.gain = clamp(+c.volume, 0, 4)
      if (c.mute != null) scope.muted = !!c.mute
      if (c.pause != null) scope.paused = !!c.pause
      turn(scope, at)
    },
    // The sender is finished: everything of its scope is stopped and forgotten, and its places are free again.
    close() {
      for (const sid of scope.synths) {
        const rec = synths.get(sid)
        if (rec && rec.part >= 0) { ops.push(['stopPart', rec.part, 1]); parts[rec.part].owner = null }
        if (rec && rec === mic) { mic = null; hear(null) }
        synths.delete(sid)
      }
      for (const tune of scope.tunes) ops.push(['stopTune', tune])
      for (const sample of scope.samples) does.unsample({ id: sample })
      if (song && song.scope === scope) { dropSongSynths(); ops.push(['songUnload']); song = null }
      scopes.delete(scope.name)
    },
    // A SONG is read and played by the engine itself. Loading takes a moment (the file is fetched, and the engine
    // answers with the synth patches the song asks for by name); what is asked of the song meanwhile waits for it.
    song(c, at) {
      const what = c.do || 'play'
      if (what === 'play' && (c.url || c.bytes)) {
        if (!ENGINE.events.includes('song')) return tell('tracker songs are not ready yet in this version, so playSong plays nothing. The rest of your sound is not affected.')
        const mine = song = { id: c.id, scope, token: ++songs, ready: false, waiting: [], raw: c.raw, patches: c.patches || {}, name: c.name || c.url || 'given as bytes', at, vol: c.vol, repeat: c.repeat ?? c.loop }
        const job = (async () => {
          const bytes = new Uint8Array(await bytesOf(c))
          const files = []
          // One of our own songs is JSON, and may name WAV files beside it for its samples.
          if (bytes[bytes.findIndex((b) => b > 32)] === 123) {
            let named = []
            try { named = (JSON.parse(new TextDecoder().decode(bytes)).samples || []).map((sample) => sample && sample.file).filter((f) => typeof f === 'string') } catch (e) { /* the engine will say what is wrong with it */ }
            for (const file of new Set(named)) {
              const given = c.files && c.files[file]
              files.push([new TextEncoder().encode(file), new Uint8Array(await bytesOf(given ? { bytes: given } : { url: c.url ? new URL(file, new URL(c.url, typeof document !== 'undefined' ? document.baseURI : 'file:///')).href : file }))])
            }
          }
          if (song !== mine) return
          ops.push(['songLoad', mine.token, bytes, files, parts.length, SAMPLE_SLOTS])
          flush()
        })().catch((e) => { tell(`the song ${shown(mine.name)} could not be loaded (${(e && e.message) || e}), so it will not play.`); if (song === mine) song = null })
        loading.add(job)
        job.finally(() => loading.delete(job))
        return
      }
      if (!song || (c.id != null && c.id !== song.id)) return
      if (song.ready) steer(c, at)
      else song.waiting.push([c, at])
    },
  }

  let song = null
  let songs = 0
  const SONG = 15
  // One thing asked of the song, as the event that does it on its exact frame.
  function steer(c, at) {
    const what = c.do || 'play'
    if (what === 'play' || what === 'resume') event(at, SONG, 0, 1, 0, 0)
    else if (what === 'stop') event(at, SONG, 0, 0, 0, 0)
    else if (what === 'pause') event(at, SONG, 0, 2, 0, 0)
    else if (what === 'seek') event(at, SONG, 0, 3, Math.max(0, c.order | 0), Math.max(0, c.row | 0))
    else if (what === 'repeat') event(at, SONG, 0, 4, c.repeat === false ? 0 : 1, 0)
    else if (what === 'volume' && Number.isFinite(+c.vol)) {
      // The engine turns the song's own channels; its synth patches are parts of ours, and are turned here.
      song.vol = clamp(+c.vol, 0, 2)
      event(at, SONG, 0, 5, song.vol, 0)
      for (const rec of synths.values()) {
        if (!rec.ofSong) continue
        rec.patch.set(VOLUME, clamp(rec.songVolume * song.vol, 0, 2))
        if (rec.part >= 0) { parts[rec.part].values.set(VOLUME, real(rec, VOLUME, rec.patch.get(VOLUME))); event(at, PARAM, rec.part, VOLUME, parts[rec.part].values.get(VOLUME), 0.02) }
      }
    }
  }
  // The synths a song's instruments were given, which go when the song does.
  function dropSongSynths() {
    for (const [sid, rec] of synths) {
      if (!rec.ofSong) continue
      if (rec.part >= 0) { ops.push(['stopPart', rec.part, 1]); parts[rec.part].owner = null }
      rec.scope.synths.delete(sid)
      synths.delete(sid)
    }
  }
  // The engine has read the song (or could not). Set up a synth for each instrument that names a patch, tell the
  // song which part each is, and start it.
  function songLoaded(m, now) {
    if (!song || m.token !== song.token) return
    const text = (bytes) => new TextDecoder().decode(bytes)
    if (m.result !== 0) {
      tell(`the song ${shown(song.name)} could not be played: ${m.result === -100 ? 'this version of the engine does not play songs' : (m.error && text(m.error)) || 'it is not a song file this can read (a .mod, an .xm or a song of its own)'}.`)
      song = null
      return
    }
    dropSongSynths()
    enter(song.scope.name)
    for (const [instrument, nameBytes] of m.patches) {
      const name = text(nameBytes)
      let bound = song.patches[name]
      if (bound === undefined && PRESETS[name]) bound = name
      if (bound === undefined) tell(`the song ${shown(song.name)} has an instrument that is a synth called ${shown(name)}, and was not told what that is, so it plays as "keys". Say what it is: playSong(file, { patches: { ${shown(name)}: "bass" } }).`)
      const settings = bound && typeof bound === 'object' ? bound : {}
      const preset = PRESETS[typeof bound === 'string' ? bound : settings.preset] || (settings.preset === undefined && typeof bound === 'object' ? null : PRESETS.keys)
      const rec = record(prefix + 'song:' + name, patchOf(settings, '', false, patchOf(preset, '', false, plain()), slotFor), 60, macroOf(settings.macro !== undefined ? settings.macro : preset && preset.macro, false))
      rec.ofSong = true
      // A song's channels play at half volume, to leave room for one another; its synths do the same.
      rec.songVolume = (rec.patch.has(VOLUME) ? rec.patch.get(VOLUME) : 1) * 0.5
      rec.patch.set(VOLUME, clamp(rec.songVolume * (song.vol ?? 1), 0, 2))
      rec.used = ++uses
      seat(rec, now)
      event(now, SONG, 0, 6, instrument, rec.part)
    }
    song.ready = true
    song.info = m.info
    // The song's channels are the engine's parts from 32. Raw: a sample played fast is left harsh, as old trackers
    // left it; not raw: it is smoothed. With nothing said the engine chooses (raw for a .mod or .xm as it is).
    if (song.raw != null) for (let ch = 0; ch < Math.min(32, m.info[0]); ch++) event(now, PARAM, parts.length + ch, id('sample.antialias'), song.raw ? 0 : 1, 0)
    if (song.repeat === false) event(now, SONG, 0, 4, 0, 0)
    if (song.vol != null) steer({ do: 'volume', vol: song.vol }, now)
    event(Math.max(now, song.at ?? now), SONG, 0, 1, 0, 0)
    for (const [c, at] of song.waiting) steer(c, Math.max(now, at ?? now))
    song.waiting = []
  }

  function flush() {
    while (ops.length) {
      const sending = ops, moving = transfer
      ops = []
      transfer = []
      post(sending, moving)
    }
  }

  return {
    /** Carry out one command at a time of the sound card, in seconds, for the sender whose scope is named. */
    run(command, at, scopeName) {
      const how = command && does[command.op]
      if (!how) return
      enter(scopeName)
      // Inside a scope every id is the scope's own.
      if (prefix && (command.id != null || command.synth != null)) command = { ...command, ...(command.id != null ? { id: prefix + command.id } : {}), ...(command.synth != null ? { synth: prefix + command.synth } : {}) }
      how(command, at)
    },
    flush,
    /** Set the engine to how a new conductor expects to find it: the live input is not heard until it is listened to. */
    begin() { enter(''); master(null); hear(null); flush() },
    songLoaded,
    /** The core says a recording is over. It gives [the sender's scope, what to tell it], or null if it was nobody's. */
    recorded(m) {
      const mine = recordings.get(m.slot)
      if (!mine) return null
      recordings.delete(m.slot)
      if (mine.loop && m.frames) ops.push(['sampleConfig', m.slot, null, ...mine.loop])
      for (const go of mine.then || []) go()
      flush()
      if (m.full && mine.open) tell(`a recording reached its longest, ${Math.round(m.frames / m.rate)} seconds, and stopped by itself. For a longer one say how long: startRecording({ max: 60 }), up to ${LONGEST_RECORDING}.`, 'info')
      return [mine.scope, { type: 'recorded', id: mine.id, frames: m.frames, seconds: m.frames / m.rate, rate: m.rate, full: !!m.full }]
    },
    /** The core hands back a sample to be saved: [the sender's scope, what to tell it (with the WAV file), whether to save it here]. */
    saved(m) {
      const mine = saves.get(m.token)
      if (!mine) return null
      saves.delete(m.token)
      return [mine.scope, { type: 'saved', id: mine.id, ask: mine.ask, name: mine.name, seconds: m.pcm.length / m.channels / m.rate, bytes: pcmWav(m.pcm, m.channels, m.rate) }, mine.download]
    },
    loading,
    /**
     * Where a synth is read from: its part of the engine, 65535 for no id (everything), -1 for a synth with no part.
     * A microphone that is not being listened to puts nothing through its part, and is read as it comes in.
     */
    partOf(sid, scopeName) {
      if (sid == null) return 0xffff
      const rec = synths.get((scopeName ? scopeName + '\u0001' : '') + sid)
      return !rec ? -1 : rec === mic && !rec.listen && rec.part >= 0 ? MIC_TAP : rec.part
    },
    /** Whether a synth is the microphone, whose settings have names of their own. */
    isMic(sid, scopeName) { const rec = synths.get((scopeName ? scopeName + '\u0001' : '') + sid); return !!rec && rec === mic },
    /** A setting of a synth as the commands so far have left it: [what it is, its value in the engine's units], or null. */
    settingOf(sid, name, scopeName) {
      const entry = setting(name)
      const rec = synths.get((scopeName ? scopeName + '\u0001' : '') + sid)
      return entry && rec ? [entry, entry.part ? rec.patch.get(entry.id) : globals.get(entry.id)] : null
    },
    /** How much everything is turned down or up after the parts are mixed. */
    gain: () => (muted || paused ? 0 : clamp(volume * 0.5, 0, 2)),
  }
}

// --- loading the engine ----------------------------------------------------------------------

// Node's own modules, named so that a bundler for the web does not go looking for them.
const hidden = (name) => import(/* @vite-ignore */ /* webpackIgnore: true */ name)
const inNode = typeof process !== 'undefined' && !!process.versions?.node

async function fileOrFetch(url, missing) {
  if (url.protocol === 'file:' && inNode) {
    const { readFile } = await hidden('node:fs/promises')
    const { fileURLToPath } = await hidden('node:url')
    return readFile(fileURLToPath(url))
  }
  const reply = await fetch(url)
  if (!reply.ok) throw new Error(missing)
  return reply.arrayBuffer()
}

/** The engine, from what a host gave (bytes, a module, an address, a promise of one) or the file beside this one. */
async function engineBytes(wasm) {
  wasm = await wasm
  if (wasm instanceof ArrayBuffer || ArrayBuffer.isView(wasm) || wasm instanceof WebAssembly.Module) return wasm
  const url = new URL(wasm || 'synths_core.wasm', BASE)
  return fileOrFetch(url, `the engine's file ${url.href} could not be fetched`)
}

async function sampleBytes(c) {
  if (c.bytes) return typeof c.bytes === 'string' ? Uint8Array.from(atob(c.bytes), (ch) => ch.charCodeAt(0)) : c.bytes
  if (!c.url) throw new Error('it has no address and no bytes')
  return fileOrFetch(new URL(c.url, typeof document !== 'undefined' ? document.baseURI : inNode ? hiddenCwd() : BASE), 'there is no such file')
}
const hiddenCwd = () => 'file://' + process.cwd().replace(/\\/g, '/') + '/'

/** A sound file's bytes as samples: a WAV file is read here; anything else (mp3, ogg) is the browser's to decode. */
async function decode(bytes, context) {
  const wav = readWav(bytes)
  if (wav) return wav
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
  const decoder = context || (Offline ? new Offline(1, 1, 44100) : null)
  if (!decoder) throw new Error('only WAV files can be read here')
  const copy = bytes instanceof ArrayBuffer ? bytes.slice(0) : new Uint8Array(bytes).slice().buffer
  const buffer = await new Promise((yes, no) => { const p = decoder.decodeAudioData(copy, yes, no); if (p && p.catch) p.catch(no) })
  const channels = Math.min(2, buffer.numberOfChannels)
  const pcm = new Float32Array(buffer.length * channels)
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i++) pcm[i * channels + ch] = data[i]
  }
  return { pcm, channels, rate: buffer.sampleRate }
}

// --- reading the sound back -------------------------------------------------------------------

/** What a display is given when there is nothing to show. */
const NOTHING = { samples: new Float32Array(0), level: [0, 0], notes: [] }
/** One source's taps from the core -> { samples, level: [left, right] from 0 to 1, notes: the notes sounding }. */
function reading([source, samples, left, right, words], gain) {
  const notes = []
  for (let n = 0; n < 128; n++) if ((words[n >> 5] >>> (n & 31)) & 1) notes.push(n)
  // The engine measures a part before the volume of everything is applied; a display should show what is heard.
  if (source >= MIC_TAP) gain = 1
  else for (let i = 0; i < samples.length; i++) samples[i] = clamp(samples[i] * gain, -1, 1)
  return { samples, level: [Math.min(1, left * gain), Math.min(1, right * gain)], notes }
}

/**
 * A TARGET for a synth that already exists by its id: the thing dials, a keyboard, a scope and a meter are tied to
 * when the program that made the synth is somewhere else (Python, a worker). It writes ordinary commands for that
 * id, and answers get() and describe() from what the commands so far have set, so it needs to be told nothing.
 */
function makeTarget(id, run, conductor, read, scope) {
  const held = new Map()
  let handle = 0x7f000000
  // The microphone's settings go by its own names (its `pitch` is the pitch shifter).
  const named = (name) => (conductor()?.isMic(id, scope) ? micName(name) : name)
  const target = {
    id,
    set(name, value) { run({ op: 'set', id, set: Object.fromEntries(Object.entries(typeof name === 'string' ? { [name]: value } : name).map(([k, v]) => [named(k), v])) }); return target },
    get(name) { const now = conductor()?.settingOf(id, named(name), scope); return now ? readSetting(now[0], now[1]) : undefined },
    describe(name) { const now = conductor()?.settingOf(id, named(name), scope); return now ? describeSetting(now[0], now[1]) : setting(named(name)) ? describeSetting(setting(named(name))) : null },
    noteOn(note, velocity = 0.8) {
      const n = noteNumber(note)
      target.noteOff(n)
      handle = handle >= 0x7ffffff0 ? 0x7f000000 : handle + 1
      held.set(n, handle)
      run({ op: 'note', id, note: [n], len: null, vel: velocity, h: handle })
      return target
    },
    noteOff(note) {
      const n = noteNumber(note)
      if (held.has(n)) run({ op: 'off', id, h: held.get(n) })
      held.delete(n)
      return target
    },
    samples: () => read(id, scope).samples,
    level: () => read(id, scope).level,
    notes: () => read(id, scope).notes,
  }
  target.note_on = target.noteOn
  target.note_off = target.noteOff
  return target
}

// --- MIDI ------------------------------------------------------------------------------------

/**
 * MIDI is in a file of its own, synths-midi.js, beside this one, and is fetched the first time a MIDI function is
 * used: a program with no MIDI in it never loads it. docs/midi.md is its contract. `midiModule` (an option of
 * createSound and of a player) is the module itself, a promise of it or its address, for a copy of this file that
 * has no "beside".
 */
let midiFile = null
const loadMidi = (given) => (given ? Promise.resolve(typeof given === 'string' ? hidden(given) : given) : midiFile || (midiFile = hidden(new URL('synths-midi.js', BASE).href)))
const midiMissing = (e) => tell(`MIDI could not be loaded, so there will be none (${(e && e.message) || e}). It is in the file synths-midi.js, which belongs beside synths.js.`, 'error')
/** MIDI's functions: createSound's, and every synth's. They are in synths-midi.js; these are the names it is asked for by. */
const MIDI_FUNCTIONS = ['onMidi', 'onMidiNote', 'onMidiNoteOff', 'onMidiControl', 'onMidiDevices', 'useMidiHooks', 'sendMidi', 'sendMidiNote', 'sendMidiNoteOff', 'sendMidiControl', 'sendMidiBend', 'sendMidiProgram', 'sendMidiClock', 'midiDevices', 'useMidiInput', 'useMidiOutput', 'receiveMidi', 'stopMidi']
const MIDI_SYNTH_FUNCTIONS = ['playFromMidi', 'sendToMidi', 'mapMidi', 'learn', 'unmapMidi']
/** The kinds of MIDI message, and what a `midi` command may do: for a binding in another language. */
const MIDI = {
  types: ['noteOff', 'noteOn', 'notePressure', 'control', 'program', 'pressure', 'bend', 'sysex', 'timeCode', 'songPosition', 'songSelect', 'tuneRequest', 'clock', 'start', 'continue', 'stop', 'sensing', 'reset', 'other', 'devices', 'tempo', 'learned', 'set'],
  does: ['devices', 'listen', 'input', 'output', 'send', 'play', 'through', 'map', 'learn', 'unmap', 'clock', 'stop'],
  functions: MIDI_FUNCTIONS, synthFunctions: MIDI_SYNTH_FUNCTIONS,
}

/**
 * A PLAYER'S MIDI. The devices are where the player is, so that is where MIDI is done: the DESK (synths-midi.js)
 * carries out the `midi` commands in the batches, and plays a synth from a keyboard with `play`, without the
 * sender in between. It is made when the first `midi` command arrives, which is also when the browser asks its
 * permission. What is received goes to whoever asked with onMidi(listener, scope), as lists of plain objects.
 */
function midiSide(options, hooks) {
  let desk = null
  let kept = null
  let closed = false
  const heard = new Map()
  const emit = (scope, events) => { for (const listener of [...(heard.get(scope || '') || [])]) listener(events) }
  const at = () => (hooks.now ? hooks.now() : performance.now())
  function load() {
    kept = []
    return loadMidi(options.midiModule).then((m) => {
      desk = m.makeMidiDesk({ midi: options.midi, sysex: options.midiSysex, tell, noteNumber, emit, ...hooks })
      if (closed) desk.close()
      else for (const [batch, when] of kept) desk.take(batch, when)
    }).catch((e) => { kept = { push() {} }; midiMissing(e) })
  }
  return {
    load,
    take(batch) {
      if (desk) return desk.take(batch)
      if (!kept) {
        if (!batch.cmds.some((c) => c && c.op === 'midi')) return
        load()
      }
      // While the file is on its way everything is kept, with when it came.
      kept.push([batch, at()])
    },
    onMidi(listener, scope) {
      const name = scope || ''
      if (!heard.has(name)) heard.set(name, new Set())
      heard.get(name).add(listener)
      return () => heard.get(name)?.delete(listener)
    },
    pump() { desk?.pump() },
    close() { closed = true; desk?.close() },
  }
}
// --- the microphone ---------------------------------------------------------------------------

/** Why there is no microphone, as [the state it leaves, one plain sentence]. `e` is what the browser threw, or { kind }. */
function micProblem(e) {
  const name = (e && e.name) || '', kind = e && e.kind
  const rest = ' Everything else carries on, and a recording of the microphone will be empty.'
  if (kind === 'insecure') return ['unavailable', 'this page cannot use the microphone, because that needs an https address, or localhost.' + rest]
  if (kind === 'unsupported') return ['unavailable', 'there is no way to ask for the microphone here: this browser gives pages none, or this is a frame that may not ask (the app showing it can pass one in: see docs/microphone.md).' + rest]
  if (kind === 'off') return ['unavailable', 'the microphone is turned off for this page by the app that shows it.' + rest]
  if (kind === 'offline') return ['unavailable', 'there is no microphone when sound is rendered to a file. Give the sound to use in its place: createOfflinePlayer({ microphone: samples }).' + rest]
  if (kind === 'nothing') return ['none', 'the app that shows this page was asked for the microphone and gave none.' + rest]
  if (/NotAllowed|Security|PermissionDenied/.test(name)) return ['refused', 'the microphone was not allowed. To allow it, press the microphone or the padlock beside the page\'s address, allow it there, and load the page again. (A page inside a frame also needs allow="microphone" on the frame.)' + rest]
  if (/NotFound|Overconstrained/.test(name)) return ['none', 'no microphone was found. Plug one in, or let the browser use one in the computer\'s settings, and load the page again.' + rest]
  if (/NotReadable|TrackStart|Abort/.test(name)) return ['busy', 'the microphone is there but could not be opened: another program may be using it. Close that, and load the page again.' + rest]
  return ['unavailable', `the microphone could not be opened (${(e && e.message) || e}).` + rest]
}

/**
 * WHAT IS ASKED OF THE BROWSER FOR A MICROPHONE. A browser's microphone is set up for a phone call: it cancels
 * echo, takes out noise and turns the level up and down by itself. Each of those is a filter that delays the
 * sound by tens of milliseconds and reshapes it, and a voice changer then changes the reshaped voice: the pitch
 * shifter warbles on the noise gate's edges and the level pumps. So the plain microphone is asked for (`raw`,
 * which is the default), in one channel, since a voice is one. `raw: false` asks for the phone-call kind instead,
 * which is the right thing for one case: listening through loudspeakers, where echo cancelling stops the howl.
 */
const micConstraints = (raw) => ({ echoCancellation: !raw, noiseSuppression: !raw, autoGainControl: !raw, channelCount: 1 })

/** Frames at one rate as frames at another, a lump at a time: straight lines between the samples, carried across lumps. */
function resampler() {
  let last = 0, pos = 0
  return (input, step) => {
    const n = input.length
    const out = new Float32Array(Math.max(0, Math.ceil((n - 1 - pos) / step)))
    let made = 0
    for (; pos < n - 1 && made < out.length; pos += step) {
      const i = Math.floor(pos)
      const a = i < 0 ? last : input[i]
      out[made++] = a + (input[i + 1] - a) * (pos - i)
    }
    pos -= n
    if (n) last = input[n - 1]
    return made === out.length ? out : out.subarray(0, made)
  }
}

/**
 * A PLAYER'S MICROPHONE. The microphone is where the player is, so that is where it is opened: the first `mic`
 * command asks for it (which is when the browser asks the person), and never anything before that. While the
 * answer is awaited a recording of the microphone waits too, and begins when it is there; with no microphone the
 * recording is over at once with nothing in it, the reason is said once, and every other command is carried out
 * as usual. Senders are told how it went as plain data: { type: 'microphone', state, message }.
 *
 * @param hooks  open(command): open it, now or as a promise, or throw why not; close(); emit(scope, events) to tell
 *               senders (no scope: all of them); run(command, at, scope) to carry out a command that waited
 */
function micSide(hooks) {
  let state = 'off', message, turn = 0, asking = null
  let waiting = []
  // Every sender is told when the state changes; one that asks later is told how things stand, once.
  const knows = new Set()
  const say = (to) => { if (to == null) knows.clear(); knows.add(to || ''); hooks.emit(to, [{ type: 'microphone', state, ...(message ? { message } : {}) }]) }
  function settle(mine, now, why) {
    if (mine !== turn || state !== 'asking') return
    state = now
    message = why
    if (why) tell(why)
    say(null)
    knows.add(asker)
    if (now === 'on' && listened) howl()
    const kept = waiting
    waiting = []
    for (const [c, at, scope] of kept) if (take(c, scope)) hooks.run(c, at, scope)
  }
  // Said once, when a real microphone is first listened to.
  let listened = false
  const howl = () => { if (hooks.live) tell('the microphone is being listened to. Through loudspeakers that can howl, so headphones are best; mic.mute() stops it.', 'info') }
  let asker = ''
  function open(c, scope) {
    if (state !== 'off') return
    asker = scope || ''
    const mine = ++turn
    state = 'asking'
    message = undefined
    say(null)
    const no = (e) => settle(mine, ...micProblem(e))
    try {
      const opened = hooks.open(c)
      if (opened && typeof opened.then === 'function') asking = opened.then(() => settle(mine, 'on'), no)
      else settle(mine, 'on')
    } catch (e) { no(e) }
  }
  /** One command on its way to be carried out: false if it is not to be (it waits for the microphone, or there is none). */
  function take(c, scope, at) {
    if (c.op === 'mic') {
      if (c.do === 'close') {
        if (state !== 'off') { turn++; hooks.close(); state = 'off'; message = undefined; say(null) }
        const kept = waiting
        waiting = []
        for (const [w, , sc] of kept) hooks.emit(sc, [{ type: 'recorded', id: w.id, frames: 0, seconds: 0, full: false }])
        return true
      }
      if (state === 'off') open(c, scope)
      else if (state !== 'asking' && !knows.has(scope || '')) say(scope)
      if (c.listen != null) listened = !!c.listen
      if (c.listen && state === 'on') howl()
    } else if (c.op === 'record' && c.do !== 'stop' && (c.from === 'mic' || c.from == null)) {
      if (state === 'asking') { waiting.push([c, at, scope]); return false }
      if (state !== 'on') { hooks.emit(scope, [{ type: 'recorded', id: c.id, frames: 0, seconds: 0, full: false }]); return false }
    }
    return true
  }
  return {
    get state() { return state },
    open, take,
    /** A promise of the browser's answer, if it is being waited for. */
    settled: () => asking || Promise.resolve(),
    close() { if (state !== 'off') { turn++; hooks.close(); state = 'off' } },
  }
}
/** The senders that asked to be told things, by scope, and the telling: for a player. */
function listeners() {
  const heard = new Map()
  return {
    on(listener, scope) {
      const name = scope || ''
      if (!heard.has(name)) heard.set(name, new Set())
      heard.get(name).add(listener)
      return () => heard.get(name)?.delete(listener)
    },
    emit(scope, events) { for (const [name, set] of heard) if (scope == null || name === (scope || '')) for (const listener of [...set]) listener(events) },
  }
}

/** Where a song is, from the engine's ten numbers: for drawing a cursor. */
const NO_SONG = { state: 'none', order: 0, pattern: 0, row: 0, tick: 0, speed: 0, tempo: 0, rounds: 0, rows: 0, orders: 0 }
const songPlace = (n) => (n ? { state: ['none', 'stopped', 'playing', 'paused'][n[0]] || 'none', order: n[1], pattern: n[2], row: n[3], tick: n[4], speed: n[5], tempo: n[6], rounds: n[7], rows: n[8], orders: n[9] } : NO_SONG)

// --- the real-time player --------------------------------------------------------------------

/** Commands that make a sound once. One that could not be played near the time it was asked for is dropped, never played late. */
const ONE_SHOTS = new Set(['note', 'sound', 'off', 'voice'])
/** How late a one-shot may be and still be played, in seconds. */
const TOO_LATE = 0.25
/**
 * How long a one-shot is kept for sound that is not on yet. While the browser waits for a tap: a third of a second,
 * which is enough for the sound the tap itself asks for. While the engine is only still loading: ten seconds, so the
 * first line of a program is heard however slow the connection is.
 */
const KEPT_FOR_A_TAP = 0.35
const KEPT_WHILE_LOADING = 10

/**
 * A player: it owns the AudioContext and the engine's worklet, and plays the batches of commands it is sent.
 * The API makes one for itself the first time a sound is asked for. A host that takes a scene's commands through
 * the `sound` option makes its own, in a page that is allowed to make sound, and passes each batch to `send`.
 *
 * @param {{ wasm?: ArrayBuffer | Uint8Array | WebAssembly.Module | string | Promise<any>, worklet?: 'auto' | 'blob' | 'file' | string,
 *           latency?: number, context?: AudioContext, destination?: AudioNode, fallback?: boolean | 'always',
 *           onState?: (state: string) => void, microphone?: any, save?: (file: { name: string, bytes: Uint8Array, type: string }) => void }} options
 *   `wasm` is the engine, as bytes (for a page that may not fetch it) or an address; without it, `synths_core.wasm` beside this file.
 *   `worklet` is how the worklet's module is loaded: 'blob' from the text inside this file (no second file, no fetch), 'file'
 *   from `synths-worklet.js` beside this file, or an address. 'auto' tries the blob and then the file.
 *   `latency` is how far ahead of the sound card everything is scheduled, in seconds (0.04).
 *   `context` and `destination` put the sound into an AudioContext and a node of your own (a recorder, an analyser).
 *   `fallback: false` refuses the slower way of working when the browser has no audio worklet; 'always' uses it regardless.
 *   `microphone` is where the microphone comes from when it is not the browser's to ask for: a MediaStream, or
 *   { open({ sampleRate, raw, constraints, push }), close() }, or false for none (docs/microphone.md is the contract).
 *   `save` is given a file that saveSound made, in place of the browser being asked to download it.
 * @returns {{ send(batch): void, read(id?): { samples: Float32Array, level: number[], notes: number[] },
 *             state: 'loading'|'waiting'|'on'|'failed', kind: 'worklet'|'fallback'|null, ready: Promise<void>,
 *             context: AudioContext, node: AudioNode, unlock(): void, pause(): void, resume(): void, ask(): Promise<object>, close(): void }}
 *   `state` is 'waiting' while the browser keeps the page silent until a tap. `ready` resolves when sound is on.
 *   `read(id)` is what a synth is doing now, for a scope, a meter and lit keys (no id: all the sound). It never waits:
 *   it gives the latest the audio thread has posted, which starts to arrive a moment after the first read.
 */
export function createPlayer(options = {}) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext
  let latency = options.latency ?? 0.04
  let held = []
  let saidWaiting = false
  /** For each sender's clock (a batch may name its own): [how far it is from the sound card's, when that was last seen]. */
  const clocks = new Map()
  let conductor = null
  let core = null          // the fallback's core, on this thread
  let port = null
  let asks = 0
  let closed = false
  let paused = false
  let resting = false
  let waitingSince = null
  const local = () => performance.now() / 1000
  const waiting = new Map()
  let ready
  const told = listeners()
  const player = {
    state: 'loading', kind: null, context: null, node: null,
    ready: new Promise((yes) => { ready = yes }),
    send, unlock, close, read, songPosition,
    /** What the player has to say to one sender, as lists of plain objects: a recording is over, a file is saved, the microphone is on or is not. It gives back a function that stops it. */
    onSoundEvents: (listener, scope) => told.on(listener, scope),
    /** What MIDI devices send, and what the desk has to say, for one sender: onMidi((events) => { ... }, scope). It gives back a function that stops it. */
    onMidi: (listener, scope) => midi.onMidi(listener, scope),
    /** A synth that exists by its id, as something controls can be tied to: set, get, describe, noteOn, noteOff, samples, level, notes. */
    target: (id, scope) => makeTarget(id, (c) => send({ synths: COMMANDS, scope, cmds: [c] }), () => conductor, read, scope),
    /** Silence, with everything kept as it is: for a scene that is paused or out of view. */
    pause() { paused = true; player.context?.suspend?.() },
    resume() { paused = false; unlock() },
    /** What the engine is doing: { voices, time } (for tests and meters). */
    ask() {
      if (core) return Promise.resolve({ voices: core.voices(), time: core.time })
      if (!port) return Promise.resolve({ voices: 0, time: 0 })
      return new Promise((yes) => { waiting.set(++asks, yes); port.postMessage({ ask: asks }) })
    },
  }
  // A keyboard plays a synth as soon as the page can manage: a hundredth of a second ahead, not the whole latency.
  const midi = midiSide(options, {
    latency: () => latency,
    play(c, scope) {
      if (closed || player.state === 'failed') return
      if (!live()) return send({ synths: COMMANDS, scope, cmds: [c] })
      conductor.run(c, context.currentTime + Math.min(latency, core ? latency : 0.01), scope)
      conductor.flush()
    },
  })
  const state = (s) => {
    if (player.state === s) return
    player.state = s
    waitingSince = s === 'waiting' ? local() : null
    options.onState?.(s)
  }
  if (!Context) {
    tell('this browser has no Web Audio, so there will be no sound.')
    state('failed')
    return player
  }
  const context = player.context = options.context || new Context({ latencyHint: 'interactive' })
  let engineReady = false
  const live = () => engineReady && context.state === 'running'
  let engineUp
  const engineIsUp = new Promise((yes) => { engineUp = yes })

  // THE MICROPHONE. The browser is asked for the plain microphone as a stream, which goes into the worklet's one
  // input through a source node; that node brings the stream to the sound card's sample rate where the two differ,
  // so the engine is always given frames at its own rate. (Firefox does not convert, and does not need to: its
  // default rate for a context and for a microphone are the same device's.) A host may give the stream instead,
  // or push the frames itself, which the core plays out of a ring.
  let micStream = null, micSource = null, micOwn = false, micLive = false, micOpen = 0
  const stretch = resampler()
  function pushMic(frames, rate) {
    if (closed || mic.state === 'off' || !frames || !frames.length) return
    let lump = frames instanceof Float32Array ? frames : Float32Array.from(frames)
    if (rate > 0 && rate !== context.sampleRate) lump = stretch(lump, rate / context.sampleRate)
    if (port) port.postMessage({ input: lump })
    else core?.pushInput(lump)
  }
  async function openMic(c) {
    const mine = ++micOpen
    const raw = c.raw !== false
    const wants = { sampleRate: context.sampleRate, raw, constraints: micConstraints(raw), push: pushMic }
    const given = options.microphone
    let got, own = false
    if (given === false) throw { kind: 'off' }
    if (given && typeof given.open === 'function') got = await given.open(wants)
    else if (typeof given === 'function') got = await given(wants)
    else if (given) got = await given
    else {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw { kind: globalThis.isSecureContext === false ? 'insecure' : 'unsupported' }
      got = await navigator.mediaDevices.getUserMedia({ audio: wants.constraints, video: false })
      own = true
    }
    await engineIsUp
    const stream = got && typeof got.getAudioTracks === 'function' ? got : null
    if (closed || mine !== micOpen) { if (own) for (const track of stream.getTracks()) track.stop(); return }
    if (stream) {
      if (!stream.getAudioTracks().length) throw { name: 'NotFoundError' }
      micStream = stream
      micOwn = own
      micSource = context.createMediaStreamSource(stream)
      micSource.connect(player.node)
      micLive = true
      port?.postMessage({ mic: true })
    } else if (!got) throw { kind: 'nothing' }
    // Anything else that is not a stream is a host that pushes the frames itself.
  }
  function closeMic() {
    micOpen++
    micLive = false
    port?.postMessage({ mic: false })
    try { micSource?.disconnect() } catch (e) { /* already gone */ }
    // A microphone the browser was asked for here is let go, so its light goes out; a host's own is the host's to stop.
    if (micOwn && micStream) for (const track of micStream.getTracks()) track.stop()
    if (!micOwn) { try { options.microphone?.close?.() } catch (e) { /* the host's affair */ } }
    micStream = micSource = null
  }
  const mic = micSide({
    live: true, open: openMic, close: closeMic, emit: told.emit,
    run(c, at, scope) { if (closed || !live()) return; conductor.run(c, context.currentTime + latency, scope); conductor.flush() },
  })
  // Every command goes by the microphone's side on its way to the conductor.
  const carry = (c, at, scope) => { if (mic.take(c, scope, at)) conductor.run(c, at, scope) }
  // A file made by saveSound: the host's to keep if it said so, or else the browser's to download.
  function saveFile(file) {
    if (options.save) return options.save({ name: file.name, bytes: file.bytes, type: 'audio/wav' })
    if (typeof document === 'undefined' || !document.body) return
    try {
      const url = URL.createObjectURL(new Blob([file.bytes], { type: 'audio/wav' }))
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.style.display = 'none'
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (e) { tell(`the file ${shown(file.name)} could not be saved from this page (${(e && e.message) || e}).`) }
  }

  // BROWSERS KEEP A PAGE SILENT until the person has touched it. Every touch asks again; the first one that the
  // browser accepts turns the sound on, and what was held back for it is played then.
  function unlock() {
    if (!closed && !paused && !resting && context.state !== 'running') context.resume?.().catch(() => {})
  }
  const GESTURES = ['pointerdown', 'mousedown', 'touchend', 'keydown']
  if (typeof addEventListener === 'function') for (const g of GESTURES) addEventListener(g, unlock, { capture: true, passive: true })
  context.addEventListener?.('statechange', settle)
  unlock()

  function settle() {
    if (closed || player.state === 'failed') return
    clocks.clear()
    if (!live()) {
      if (engineReady) state('waiting')
      return
    }
    // What was held is carried out now, each thing as far ahead as it still has to go. A single note or sound
    // effect that is overdue is let go, because played late it would be wrong: by a third of a second if the wait
    // was for a tap (so the sound the tap itself asked for is heard), by much longer if only the engine was loading.
    const here = local()
    const patience = waitingSince !== null && here - waitingSince > KEPT_FOR_A_TAP ? KEPT_FOR_A_TAP : KEPT_WHILE_LOADING
    state('on')
    const now = context.currentTime + latency
    const waited = held
    held = []
    for (const { c, asked, ahead, scope } of waited) {
      const still = ahead - (here - asked)
      if (ONE_SHOTS.has(c.op) && still < -patience) continue
      carry(c, now + Math.max(0, still), scope)
    }
    conductor.flush()
    ready()
  }

  // Senders that share this player each pause for themselves (a scene out of view). When every one of them is
  // paused the sound card is let rest; the first to come back wakes it.
  const pausedScopes = new Map()
  function pauses(batch) {
    const name = batch.scope || ''
    for (const c of batch.cmds) {
      if (c && c.op === 'master' && c.pause != null) pausedScopes.set(name, !!c.pause)
      else if (c && c.op === 'close') pausedScopes.delete(name)
      else if (!pausedScopes.has(name)) pausedScopes.set(name, false)
    }
    const all = pausedScopes.size > 0 && [...pausedScopes.values()].every(Boolean)
    if (all && !resting) { resting = true; context.suspend?.() } else if (!all && resting) { resting = false; unlock() }
  }

  function send(batch) {
    if (closed || !batch || !Array.isArray(batch.cmds)) return
    midi.take(batch)
    if (player.state === 'failed') return
    pauses(batch)
    // The microphone is asked for as soon as a program wants it, even while the sound itself is waiting for a tap.
    for (const c of batch.cmds) if (c && c.op === 'mic' && c.do !== 'close') mic.open(c, batch.scope)
    if (!live()) {
      // Not able to play yet: everything is kept in order, with when it was asked for (see settle).
      const at = local()
      if (held.length > 1000) held = held.filter((h) => !ONE_SHOTS.has(h.c.op) || h.ahead - (at - h.asked) > -KEPT_WHILE_LOADING)
      for (const c of batch.cmds) {
        if (!c) continue
        if (c.op === 'stop') held = held.filter((h) => h.scope !== batch.scope || !(ONE_SHOTS.has(h.c.op) || h.c.op === 'tune' || h.c.op === 'song') || (c.id != null && h.c.id !== c.id))
        const ahead = typeof c.t === 'number' && typeof batch.now === 'number' ? c.t - batch.now : 0
        if (c.op !== 'stop' || c.id == null) held.push({ c, asked: at, ahead, scope: batch.scope })
      }
      if (!saidWaiting && batch.cmds.some((c) => c && (ONE_SHOTS.has(c.op) || c.op === 'tune' || c.op === 'song'))) {
        saidWaiting = true
        setTimeout(() => { if (!closed && !paused && !resting && context.state !== 'running' && player.state !== 'failed') tell('sound is waiting for a tap, a click or a key press. Browsers keep a page silent until the person using it has touched it.', 'info') }, 400)
      }
      return
    }
    // Line the sender's clock up with the sound card's. The shortest journey seen is the true difference between
    // them; a batch that took longer is late by the rest, and `latency` is there to cover it. The difference is
    // let creep up half a millisecond a second, for two clocks that do not run at quite the same speed.
    const current = context.currentTime
    let offset = null
    if (typeof batch.now === 'number') {
      const name = batch.clock || ''
      const known = clocks.get(name)
      const seen = current - batch.now
      offset = known ? Math.min(seen, known[0] + 0.0005 * Math.max(0, current - known[1])) : seen
      clocks.set(name, [offset, current])
    }
    for (const c of batch.cmds) {
      if (!c) continue
      let at = current + latency
      if (typeof c.t === 'number' && offset !== null) at = c.t + offset + latency
      if (at < current - TOO_LATE && ONE_SHOTS.has(c.op)) continue
      carry(c, at, batch.scope)
    }
    conductor.flush()
  }

  // READING BACK. The page says which parts it is watching (again every half second while it goes on reading), and
  // the worklet posts what they are doing; a read gives the latest and never waits. The fallback's engine is on
  // this thread, and is read directly.
  const tapped = new Map()
  const watched = new Map()
  let watchSaid = 0
  let songWatched = -10
  let songNow = NO_SONG
  // Say what is being watched, when something new is, and again every half second while reading goes on.
  function watch(at, fresh) {
    if (!fresh && at - watchSaid <= 0.5) return
    for (const [p, last] of watched) if (at - last > 2) { watched.delete(p); tapped.delete(p) }
    watchSaid = at
    port.postMessage({ watch: [...watched.keys()], song: at - songWatched < 2 })
  }
  function read(id, scope) {
    const part = conductor ? conductor.partOf(id, scope) : -1
    if (part < 0 || closed) return NOTHING
    if (core) { const now = core.taps([part], 1024)[0]; return now ? reading(now, conductor.gain()) : NOTHING }
    if (!port) return NOTHING
    const at = local()
    const fresh = !watched.has(part)
    watched.set(part, at)
    watch(at, fresh)
    return tapped.get(part) || NOTHING
  }
  /** Where the song is now: { state: 'none'|'stopped'|'playing'|'paused', order, pattern, row, tick, speed, tempo, rounds, rows, orders }. It never waits. */
  function songPosition() {
    if (closed) return NO_SONG
    if (core) return songPlace(core.songPosition())
    if (!port) return NO_SONG
    const at = local()
    const fresh = at - songWatched > 2
    songWatched = at
    watch(at, fresh)
    return songNow
  }

  function close() {
    if (closed) return
    closed = true
    midi.close()
    mic.close()
    if (typeof removeEventListener === 'function') for (const g of GESTURES) removeEventListener(g, unlock, { capture: true })
    try { player.node?.disconnect() } catch (e) { /* already gone */ }
    if (player.node) player.node.onaudioprocess = null
    if (port) port.postMessage({ close: true })
    if (core) core.close()
    if (!options.context) context.close?.().catch(() => {})
    player.state = 'closed'
  }

  function failed(why) {
    if (closed) return
    tell(`the sound engine could not start, so there will be no sound (${why}).`, 'error')
    state('failed')
  }

  function onMessage(m) {
    if (m.type === 'taps') {
      for (const tap of m.taps) tapped.set(tap[0], reading(tap, conductor.gain()))
      if (m.song) songNow = songPlace(m.song)
    } else if (m.type === 'song') {
      conductor.songLoaded(m, context.currentTime + latency)
      conductor.flush()
    } else if (m.type === 'state') { waiting.get(m.ask)?.(m); waiting.delete(m.ask) }
    else if (m.type === 'recorded') { const say = conductor.recorded(m); if (say) told.emit(say[0], [say[1]]) }
    else if (m.type === 'sample') {
      const say = conductor.saved(m)
      if (!say) return
      if (say[2]) saveFile(say[1])
      told.emit(say[0], [say[1]])
    } else if (m.type === 'problem') tell(m.what === 'record-memory' ? 'there was not enough memory for a recording, so it will be empty.' : 'there was not enough memory for a sample, so it will be silent.')
  }

  async function start() {
    const wasm = await engineBytes(options.wasm)
    if (closed) return
    const post = (ops, transfer) => {
      if (port) port.postMessage({ ops }, transfer)
      else core.exec(ops)
    }
    conductor = makeConductor(post, async (c) => decode(await sampleBytes(c), context), sampleBytes, (scope, event) => told.emit(scope, [event]))
    const destination = options.destination || context.destination
    const how = options.fallback !== 'always' && context.audioWorklet && typeof AudioWorkletNode !== 'undefined' ? await loadWorklet() : 'none'
    if (closed) return
    if (how === 'worklet') {
      const bytes = wasm instanceof WebAssembly.Module ? wasm : ArrayBuffer.isView(wasm) ? wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) : wasm
      // Its one input is for a microphone, mixed down to one channel; with nothing connected it is not there at all.
      const node = player.node = new AudioWorkletNode(context, 'synths', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit', processorOptions: { wasm: bytes } })
      await new Promise((yes, no) => {
        node.port.onmessage = (m) => {
          if (m.data.type === 'ready') yes()
          else if (m.data.type === 'failed') no(new Error(m.data.message))
          else onMessage(m.data)
        }
        node.onprocessorerror = () => no(new Error('the audio worklet stopped'))
      })
      port = node.port
      node.connect(destination)
      player.kind = 'worklet'
    } else {
      // THE FALLBACK. With no audio worklet (a page that is not served securely has none) the same engine runs on
      // the page's own thread through a ScriptProcessorNode. It is the same sound, but a busy page can make it crackle.
      if (options.fallback === false || !context.createScriptProcessor) throw new Error(context.audioWorklet ? 'the audio worklet could not be loaded' : 'this page has no audio worklet: it needs an https address, or localhost')
      if (options.fallback !== 'always') tell(`this page cannot run sound on its own thread (${context.audioWorklet ? `the audio worklet could not be loaded: ${player.workletProblem}` : 'that needs an https address, or localhost'}), so the sound is made on the page's thread instead. It is the same sound, but it may crackle when the page is busy.`, 'info')
      core = makeCore(wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm), context.sampleRate, onMessage)
      const node = player.node = context.createScriptProcessor(1024, 1, 2)
      node.onaudioprocess = (e) => {
        const out = e.outputBuffer
        core.delta = core.time - Math.round(e.playbackTime * context.sampleRate)
        core.render(out.getChannelData(0), out.getChannelData(1), out.length, 0, micLive ? e.inputBuffer.getChannelData(0) : null)
      }
      node.connect(destination)
      player.kind = 'fallback'
      // It makes sound 1024 frames at a time, so it has to be asked a little further ahead to stay exact.
      if (options.latency === undefined) latency = 0.08
    }
    engineReady = true
    engineUp()
    conductor.begin()
    if (context.state !== 'running') state('waiting')
    settle()
  }

  // The worklet's module, from a Blob made of the text in this file (so a page with one file, or one that may not
  // fetch, still has it), or from the file beside this one.
  async function loadWorklet() {
    const want = options.worklet || 'auto'
    for (const way of want === 'auto' ? ['blob', 'file'] : [want]) {
      let made = null
      try {
        const url = way === 'blob' ? (made = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }))) : way === 'file' ? new URL('synths-worklet.js', BASE).href : new URL(way, document.baseURI).href
        // A worklet that never answers (it happens under some test drivers) is given five seconds, then the next way is tried.
        await Promise.race([context.audioWorklet.addModule(url), new Promise((yes, no) => setTimeout(() => no(new Error('the audio worklet did not answer')), 5000))])
        player.worklet = way
        return 'worklet'
      } catch (e) {
        player.workletProblem = String((e && e.message) || e)
      } finally {
        if (made) URL.revokeObjectURL(made)
      }
    }
    return 'none'
  }

  start().catch((e) => failed((e && e.message) || e))
  return player
}

// --- the offline player ----------------------------------------------------------------------

/**
 * A player with no sound card: the same engine and the same commands, rendered to numbers. For tests, and for
 * giving a recorded video its soundtrack. It works in a browser and in node.
 *
 * @param {{ sampleRate?: number, wasm?: any, start?: number, microphone?: Float32Array | { samples: Float32Array, sampleRate: number },
 *           save?: (file: { name: string, bytes: Uint8Array, type: string }) => void }} options
 *   `start` is the sender's time that is the first sample (0): a batch's times are counted from there.
 *   `microphone` is sound to use in place of a microphone: one channel, whose first sample comes in with the first
 *   frame rendered. After it ends, silence comes in. Without it there is no microphone, as on a page that was refused one.
 * @returns {Promise<{ send(batch): void, render(seconds: number): Promise<{ left: Float32Array, right: Float32Array, sampleRate: number, wav(): Uint8Array }>,
 *                     time: number, voices(): number, close(): void }>}
 *   `render` carries on from where the last one ended, so a long piece can be rendered a part at a time.
 */
export async function createOfflinePlayer(options = {}) {
  const sampleRate = options.sampleRate || 48000
  const start = options.start || 0
  const wasm = await engineBytes(options.wasm)
  const told = listeners()
  const core = makeCore(wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm), sampleRate, (m) => {
    if (m.type === 'song') conductor.songLoaded(m, core.time / sampleRate)
    else if (m.type === 'recorded') { const say = conductor.recorded(m); if (say) told.emit(say[0], [say[1]]) } else if (m.type === 'sample') {
      const say = conductor.saved(m)
      if (!say) return
      if (say[2]) options.save?.({ name: say[1].name, bytes: say[1].bytes, type: 'audio/wav' })
      told.emit(say[0], [say[1]])
    }
  })
  const conductor = makeConductor((ops) => core.exec(ops), async (c) => decode(await sampleBytes(c)), sampleBytes, (scope, event) => told.emit(scope, [event]))
  conductor.begin()
  // The sound given in place of a microphone, at this player's sample rate.
  const given = options.microphone
  const input = !given ? null : given.samples ? (given.sampleRate && given.sampleRate !== sampleRate ? resampler()(Float32Array.from(given.samples), given.sampleRate / sampleRate) : Float32Array.from(given.samples)) : Float32Array.from(given)
  const mic = micSide({
    open() { if (!input) throw { kind: 'offline' } }, close() {}, emit: told.emit,
    run(c, at, scope) { conductor.run(c, at, scope); conductor.flush() },
  })
  // MIDI for an offline player is the `midi` transport it is given: its clock is the point rendering has reached.
  const midi = midiSide(options, {
    now: () => core.time / sampleRate * 1000, look: Infinity, offset: -start, latency: () => 0,
    play(c, scope) { conductor.run(c, core.time / sampleRate, scope); conductor.flush() },
  })
  if (options.midi) await midi.load()
  return {
    onMidi: midi.onMidi,
    /** What the player has to say to one sender (see createPlayer): a recording is over, a file is saved, there is or is not a microphone. */
    onSoundEvents: (listener, scope) => told.on(listener, scope),
    send(batch) {
      if (!batch || !Array.isArray(batch.cmds)) return
      midi.take(batch)
      for (const c of batch.cmds) {
        if (!c) continue
        const at = (typeof c.t === 'number' ? c.t : typeof batch.now === 'number' ? batch.now : start) - start
        if (mic.take(c, batch.scope, at)) conductor.run(c, at, batch.scope)
      }
      conductor.flush()
    },
    async render(seconds) {
      while (conductor.loading.size) await Promise.allSettled([...conductor.loading])
      midi.pump()
      const frames = Math.max(0, Math.round(seconds * sampleRate))
      const left = new Float32Array(frames)
      const right = new Float32Array(frames)
      core.render(left, right, frames, 0, mic.state === 'on' ? input.subarray(Math.min(input.length, core.time), Math.min(input.length, core.time + frames)) : null)
      return { left, right, sampleRate, wav: () => toWav(left, right, sampleRate) }
    },
    get time() { return core.time / sampleRate },
    voices: () => core.voices(),
    /** Where the song is at the point rendering has reached (see createPlayer). */
    songPosition: () => songPlace(core.songPosition()),
    /** A synth that exists by its id, as something controls can be tied to (see createPlayer). What it plays starts where rendering has reached. */
    target(id, scope) { return makeTarget(id, (c) => { conductor.run(c, core.time / sampleRate, scope); conductor.flush() }, () => conductor, (i, sc) => this.read(i, sc), scope) },
    /** What a synth (or, with no id, everything) is doing at the point rendering has reached: { samples, level, notes }. */
    read(id, scope) {
      const part = conductor.partOf(id, scope)
      const now = part < 0 ? null : core.taps([part], 1024)[0]
      return now ? reading(now, conductor.gain()) : NOTHING
    },
    close() { midi.close(); core.close() },
  }
}

/**
 * A song file of any kind (.mod, .xm, or our own JSON) as the engine's packed form: small, quick to load, and what
 * a tracker editor keeps after "import a module". `await packSong(bytes)` gives a Uint8Array that playSong plays.
 * A JSON song that names WAV files gives them in `files`: { "the path as the song writes it": bytes }.
 * It throws, in the engine's words, for a file that is not a song.
 */
export async function packSong(bytes, options = {}) {
  const wasm = await engineBytes(options.wasm)
  const core = makeCore(wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm), 8000, () => {})
  try {
    const packed = core.packSong(new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength))
    if (packed.bytes) return packed.bytes
    throw new Error(packed.error ? `That could not be packed: ${new TextDecoder().decode(packed.error)}` : 'This version of the engine cannot pack songs')
  } finally { core.close() }
}

/**
 * Render what a function plays: `await renderSound((s) => { s.playNote("C4") }, { seconds: 1 })`.
 * `s` has every function of the library, and its clock starts at 0 and stands still, so { at: 2 } and
 * { after: 2 } both mean two seconds in. The result has `left`, `right`, `sampleRate` and `wav()`.
 */
export async function renderSound(play, options = {}) {
  const player = await createOfflinePlayer(options)
  const sound = createSound({ sound: player, clock: () => 0, resolve: options.resolve, read: options.read })
  await play(sound)
  await sound.settled()
  sound.flush()
  // A sample read through `read` sends its command when the bytes arrive.
  await new Promise((yes) => setTimeout(yes, 0))
  sound.flush()
  const result = await player.render(options.seconds ?? 2)
  player.close()
  return result
}

// --- the API: plain functions that write commands --------------------------------------------

/** What a call was given: its plain arguments by position, and anything in braces by name. */
function choices(args, names) {
  const out = {}
  let i = 0
  for (const arg of args) {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) Object.assign(out, arg)
    else if (arg !== undefined && i < names.length) out[names[i]] = arg
    i++
  }
  return out
}

/**
 * The library's functions, writing their commands to one transport.
 *
 * @param {{ sound?: { send(batch): void }, clock?: () => number, resolve?: (path: string) => string,
 *           read?: (path: string) => Promise<Uint8Array | ArrayBuffer>, ids?: string, batch?: 'auto' | 'manual',
 *           wasm?: any, worklet?: string, latency?: number }} options
 *   `sound` takes the batches of commands in place of a player on this page (see docs/commands.md).
 *   `clock` is the sender's clock, in seconds (performance.now() / 1000).
 *   `resolve` turns a sample's path into an address, and `read` reads its bytes for a host whose player cannot fetch it.
 *   `ids` begins every id this makes, for two scenes that share one player.
 *   `batch: 'manual'` sends nothing until flush() is called (once a frame, say); otherwise a batch goes at the end of each turn.
 *   The rest are createPlayer's, for the player this makes when there is no `sound`: among them `microphone` (a
 *   stream or pushed frames in place of the browser's microphone) and `save` (given the files saveSound makes).
 *   What a player says back (a recording is over, a file is saved, the microphone is on or is not) reaches a
 *   program whose player is elsewhere through receiveSoundEvents(events).
 */
let shared = null

export function createSound(options = {}) {
  const clock = options.clock || (() => performance.now() / 1000)
  const prefix = options.ids || ''
  let transport = options.sound || null
  let player = null
  let scope = options.scope || ''
  let mine = null
  let cmds = []
  let waiting = false
  let ids = 0
  let handles = 0
  let tempo = 120
  let beatZero = clock()
  let main = null
  let closed = false

  function flush() {
    waiting = false
    turn = null
    if (!cmds.length || closed || midiLoading) return
    if (!transport) {
      // ONE PLAYER FOR THE PAGE. Every createSound() on a page that is not given a transport, or an AudioContext
      // of its own, shares one player (the options of the first make it), each in a scope of its own: so ten
      // scenes on a page are one sound card and one engine, and each still stops, mutes and pauses alone.
      if (options.context || options.destination || options.share === false) transport = player = createPlayer(options)
      else {
        if (!shared || shared.player.state === 'closed' || shared.player.state === 'failed') shared = { player: createPlayer(options), users: 0, made: 0 }
        shared.users++
        mine = shared
        scope = options.scope || 'page' + ++shared.made
        transport = player = shared.player
      }
    }
    for (const join of midiJoins.splice(0)) join()
    const batch = { synths: COMMANDS, now: clock(), cmds: midiKept ? cmds.flat() : cmds }
    if (scope) batch.scope = scope
    cmds = []
    transport.send(batch)
  }
  function command(c) {
    (midiSlot || cmds).push(c)
    if (!waiting && options.batch !== 'manual') { waiting = true; queueMicrotask(flush) }
  }
  // When a call should happen, on the sender's clock.
  function when(o, said) {
    const number = (name) => { if (typeof o[name] !== 'number' || !Number.isFinite(o[name])) throw new Error(`${said}: ${name} needs a number, not ${shown(o[name])}`); return o[name] }
    if (o.at !== undefined) return number('at')
    if (o.beat !== undefined) return beatZero + number('beat') * 60 / tempo
    if (o.after !== undefined) return clock() + (typeof o.after === 'string' ? length(o.after, `${said}: after`) : number('after'))
    return clock()
  }
  const amount = (value, said, least = 0, most = 1) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${said} needs a number from ${least} to ${most}, not ${shown(value)}`)
    return clamp(value, least, most)
  }
  const seconds = (value, said) => {
    if (typeof value !== 'number' || !(value > 0)) throw new Error(`${said} needs a number of seconds, more than 0, not ${shown(value)}`)
    return value
  }
  // A LENGTH is seconds as a number, or a note length by name, which is so many beats at the tempo now.
  const length = (value, said) => {
    if (typeof value === 'string') {
      const beats = lengthBeats(value)
      if (beats === null) throw new Error(`${said} needs ${NOT_A_LENGTH}, not ${shown(value)}.${meant(value, Object.keys(LENGTHS))}`)
      return beats * 60 / tempo
    }
    if (typeof value !== 'number' || !(value > 0)) throw new Error(`${said} needs a number of seconds, more than 0, or a note length such as "quarter", not ${shown(value)}`)
    return value
  }
  // In a line of notes a length is beats as a number, or a note length by name. It gives beats.
  const beatsLong = (value, said) => {
    if (value === undefined) return 1
    if (typeof value === 'string') {
      const beats = lengthBeats(value)
      if (beats === null) throw new Error(`${said} needs ${NOT_A_LENGTH}, not ${shown(value)}.${meant(value, Object.keys(LENGTHS))}`)
      return beats
    }
    if (typeof value !== 'number' || !(value > 0)) throw new Error(`${said} needs a number of beats, more than 0, or a note length such as "quarter", not ${shown(value)}`)
    return value
  }

  /**
   * LINES OF NOTES. note(), chord() and rest() write a tune as ordinary calls: each begins where the one before it
   * ended. Every synth has a line of its own, and lines begun in the same turn of the program begin on the same
   * sample, so a bass and a melody written one after the other play together. Nothing is timed here: each call
   * is a note command stamped with the time its place in the line comes to.
   */
  const lines = new Map()
  let turn = null            // when the lines begun in this turn begin
  let writing = null         // inside loopNotes: Map of synth id -> { steps, at (beats) }
  const HELD = 0.95          // how much of its length a note in a line sounds for
  function lineAt(key) {
    if (turn === null) turn = clock()
    const at = lines.get(key)
    return at === undefined || at < turn ? turn : at
  }
  function write(synth, what, long, o, said) {
    const beats = beatsLong(long, said)
    const vel = o.volume === undefined ? undefined : amount(o.volume, `${said}: volume`)
    if (writing) {
      let line = writing.get(synth._id)
      if (!line) writing.set(synth._id, line = { steps: [], at: 0 })
      if (what) line.steps.push([line.at, what, beats * HELD, vel ?? 0.8])
      line.at += beats
      return
    }
    const at = lineAt(synth._id)
    if (what) {
      const c = { op: 'note', id: synth._id, note: what, len: beats * 60 / tempo * HELD, t: at }
      if (vel !== undefined) c.vel = vel
      if (o.pan !== undefined) c.pan = amount(o.pan, `${said}: pan`, -1, 1)
      command(c)
    }
    lines.set(synth._id, at + beats * 60 / tempo)
  }

  // MIDI. Its functions are in synths-midi.js, fetched the first time one is used. Until it has arrived (a moment),
  // each call is kept with the time it was made and a place among the commands, and nothing is sent; then the calls
  // are carried out, their commands go where they were asked for, and everything is sent as written. A mistake in
  // one of those first calls is said in the console, since its line has gone by.
  let midi = null
  let midiKept = null
  let midiLoading = false
  let midiNow = null
  let midiSlot = null
  const midiJoins = []
  function midiCall(name, args, back) {
    if (midi) return midi[name](...args)
    if (!midiKept) {
      if (name === 'stopMidi') return back
      midiKept = []
      midiLoading = true
      midiComing = loadMidi(options.midiModule).then((m) => {
        const made = m.makeMidiApi({
          command, choices, notesOf, shown, amount, length, tell, api,
          clock: () => midiNow ?? clock(),
          // When a kept call should happen: counted from when it was asked, not from now.
          when: (o, said) => when(o, said) - (midiNow === null || o.at !== undefined || o.beat !== undefined ? 0 : clock() - midiNow),
          tempo: () => tempo,
          meant: (name) => meant(String(name), namesToShow),
          remember: (synth, name, value) => patchOf({ [name]: value }, 'MIDI', false, synth._patch, () => 0),
          // What the player's desk says is asked for once there is a transport to ask, which is at the next batch.
          listen(heard) {
            let stop = null
            const join = () => { if (stop !== false) stop = transport?.onMidi?.(heard, scope) || null }
            if (transport) join()
            else midiJoins.push(join)
            return () => { if (stop) stop(); stop = false }
          },
        })
        for (const [n, a, t, slot] of midiKept) {
          midiNow = t
          midiSlot = slot
          try { made[n](...a) } catch (e) { tell((e && e.message) || String(e), 'error') }
        }
        midiNow = midiSlot = null
        midi = made
      }).catch((e) => { midiKept = { push() {} }; midiMissing(e) }).then(() => {
        midiLoading = false
        if (options.batch !== 'manual') flush()
      })
    }
    const slot = []
    cmds.push(slot)
    midiKept.push([name, args, clock(), slot])
    return back
  }
  let midiComing = null

  /** A note that is sounding: what start() gives back. */
  class Note {
    constructor(synth, h) { this.synth = synth; this.h = h }
    stop() { command({ op: 'off', id: this.synth, h: this.h, t: clock() }); return this }
    cut() { command({ op: 'voice', id: this.synth, h: this.h, kill: true, t: clock() }); return this }
    slideTo(note, time = 0) { command({ op: 'voice', id: this.synth, h: this.h, pitch: noteNumber(note), glide: time, t: clock() }); return this }
    slide_to(note, time) { return this.slideTo(note, time) }
    set pitch(note) { this.slideTo(note, 0) }
    set frequency(hz) { command({ op: 'voice', id: this.synth, h: this.h, freq: amount(hz, 'frequency', 1, 20000), t: clock() }) }
    set volume(v) { command({ op: 'voice', id: this.synth, h: this.h, vol: amount(v, 'volume', 0, 4), t: clock() }) }
    set pan(v) { command({ op: 'voice', id: this.synth, h: this.h, pan: amount(v, 'pan', -1, 1), t: clock() }) }
  }

  // The chord an arpeggio is given -> its notes as numbers: a list of notes, a chord by name, or a root and a kind.
  function chordOf(chord, kind, said) {
    if (chord === undefined || chord === null) throw new Error(`${said} needs a chord, as in ${said}("Cm7"), ${said}("C4", "minor") or ${said}(["C4", "E4", "G4"])`)
    const notes = chordNotes(chord, kind)
    if (notes.length > 8) throw new Error(`${said}: an arpeggio has room for 8 notes, and this chord has ${notes.length}`)
    return notes
  }
  // An arpeggio as a command carries it: semitones from the note the voice was started on, a rate and an order.
  function arpOf(notes, root, o, said) {
    const offsets = notes.map((n) => n - root)
    if (offsets.some((v) => !Number.isInteger(v) || v < -128 || v > 127)) throw new Error(`${said}: the notes of an arpeggio have to be whole notes within ten octaves of the first one`)
    return { offsets, rate: o.speed === undefined ? 50 : amount(o.speed, `${said}: speed`, 0.1, 1000), order: orderOf(o.order, true, said) }
  }
  // What arp() was given: a chord, then in any order a kind of chord (text), a length (a number) and options.
  function arpArgs(args) {
    const o = {}
    let kind, length
    for (const arg of args.slice(1)) {
      if (typeof arg === 'string' && lengthBeats(arg) !== null) length = arg
      else if (typeof arg === 'string') kind = arg
      else if (typeof arg === 'number') length = arg
      else if (arg && typeof arg === 'object') Object.assign(o, arg)
    }
    if (o.kind !== undefined) kind = o.kind
    if (o.length !== undefined) length = o.length
    return { chord: args[0], kind, length, o }
  }

  /** An arpeggio that is sounding: what arp() and startArp() give back. Its chord can be changed as it plays. */
  class Arp extends Note {
    constructor(synth, h, root, o) { super(synth, h); this.root = root; this.o = o }
    /** Another chord, without starting the note again: arp.change("Fm"), arp.change("F4", "minor"), or a list of notes. */
    change(chord, kind, o = {}) {
      if (kind && typeof kind === 'object') { o = kind; kind = undefined }
      this.o = { ...this.o, ...o }
      command({ op: 'voice', id: this.synth, h: this.h, arp: arpOf(chordOf(chord, kind, 'change'), this.root, this.o, 'change'), t: when(o, 'change') })
      this.now = [chord, kind]
      return this
    }
    set chord(chord) { this.change(chord) }
    set speed(speed) { this.change(...this.now, { speed }) }
    set order(order) { this.change(...this.now, { order }) }
  }

  /** A tune that is playing: what playNotes() gives back. */
  class Tune {
    constructor(id) { this.id = id }
    stop() { command({ op: 'stop', id: this.id, t: clock() }); return this }
  }

  // "C4 E4:q G4 - C5:2", or a list of notes, chords (lists) and rests (null) -> the steps of a tune, in steps' own
  // units. `step` is how long a step is in those units, and `beat` how many of the units a beat is.
  function stepsOf(tune, step, beat, o, said) {
    const items = typeof tune === 'string' ? tune.trim().split(/[\s,|]+/).filter(Boolean) : tune
    if (!Array.isArray(items) || !items.length) throw new Error(`${said} needs notes to play, as in playNotes("C4 E4 G4 - C5"), not ${shown(tune)}`)
    const hold = o.hold === undefined ? 0.9 : amount(o.hold, `${said}: hold`, 0.01, 4)
    const vel = o.volume === undefined ? 0.8 : amount(o.volume, `${said}: volume`)
    const steps = []
    let at = 0
    for (const item of items) {
      let what = item, long = step
      if (typeof item === 'string') {
        const m = /^(.*?)(?::([^:]+))?$/.exec(item)
        what = m[1]
        // After a colon: a number is so many steps, and a note length ("q", "eighth", "1/4") is itself.
        if (m[2] && /^\d*\.?\d+$/.test(m[2])) long = +m[2] * step
        else if (m[2]) {
          const beats = lengthBeats(m[2])
          if (beats === null) throw new Error(`${said}: in ${shown(item)}, ${shown(m[2])} is not a length. After the colon write how many steps (":2") or a note length (":q", ":h", ":eighth", ":1/4")`)
          long = beats * beat
        }
        if (/^[-._~]*$/.test(what)) what = null
        else if (what.includes('+')) what = what.split('+')
      }
      if (what !== null && what !== undefined) steps.push([at, notesOf(what), long * hold, vel])
      at += long
    }
    return { steps, length: at }
  }

  /** A synth: its settings are plain properties, read and written through the Proxy below. */
  class Synth {
    constructor(id, patch, note, length) {
      this._id = id
      this._patch = patch
      this._note = note
      this._length = length
      this._held = new Map()
      // A voice that is on and what was under it, what the synth had before it was made to sound like another, a sample's loop, and the synth as the program holds it.
      this._worn = null
      this._plain = null
      this._loop = false
      this._self = null
    }

    /** play(note, length, volume) or play(note, { length, volume, pan, after, at, beat }). No note: the synth's own. */
    play(...args) {
      const o = choices(args, ['note', 'length', 'volume'])
      const c = { op: 'note', id: this._id, note: o.note === undefined || o.note === null ? null : notesOf(o.note), len: o.length === null ? null : o.length === undefined ? this._length : length(o.length, 'play: the length'), t: when(o, 'play') }
      if (o.volume !== undefined) c.vel = amount(o.volume, 'play: volume')
      if (o.pan !== undefined) c.pan = amount(o.pan, 'play: pan', -1, 1)
      command(c)
      return this
    }

    /** Start a note that stays until it is stopped: `const note = lead.start("C4")`, then `note.stop()`. */
    start(...args) {
      const o = choices(args, ['note', 'volume'])
      const h = (handles = handles >= 0x7ffffff0 ? 1 : handles + 1)
      const c = { op: 'note', id: this._id, note: o.note === undefined || o.note === null ? null : notesOf(o.note), len: null, h, t: when(o, 'start') }
      if (o.volume !== undefined) c.vel = amount(o.volume, 'start: volume')
      if (o.pan !== undefined) c.pan = amount(o.pan, 'start: pan', -1, 1)
      command(c)
      return new Note(this._id, h)
    }

    /** Let go of every note of this synth, or of one note: lead.stop("C4"). */
    stop(note) {
      const c = { op: 'off', id: this._id, t: clock() }
      if (note !== undefined) c.note = notesOf(note)
      command(c)
      return this
    }

    /** A tune on this synth: lead.playNotes("C4 E4 G4 - C5", 0.25, { repeat: true }). */
    playNotes(...args) {
      const o = choices(args, ['notes', 'step'])
      const said = 'playNotes'
      // A step given in seconds makes a tune in seconds. A step by name ("eighth"), or none (an eighth), makes
      // a tune in beats, which keeps to the tempo and changes speed when setTempo is called as it plays.
      const inBeats = typeof o.step !== 'number'
      let step = 0.5
      if (o.step !== undefined) {
        if (inBeats) { step = lengthBeats(o.step); if (step === null) throw new Error(`${said}: the time of a step needs ${NOT_A_LENGTH}, not ${shown(o.step)}`) } else step = seconds(o.step, `${said}: the time of a step`)
      }
      const { steps, length: whole } = stepsOf(o.notes, step, inBeats ? 1 : 60 / tempo, o, said)
      const id = prefix + 't' + ++ids
      const repeat = o.repeat === true ? true : o.repeat === undefined || o.repeat === false ? 1 : amount(o.repeat, `${said}: repeat`, 1, 1e9)
      const c = { op: 'tune', id, synth: this._id, steps, length: whole, repeat, t: when(o, said) }
      if (inBeats) c.beats = true
      command(c)
      return new Tune(id)
    }
    play_notes(...args) { return this.playNotes(...args) }

    /**
     * A chord from one voice, as a fast arpeggio: the sound of a C64 tune. lead.arp("Cm7"), lead.arp("C4", "minor"),
     * lead.arp(["C4", "E4", "G4"]), then a length in seconds (half a second unless you say) and
     * { speed: steps a second (50), order: "up" | "down" | "up-down" | "as written" | "random", volume, pan, after }.
     */
    arp(...args) { return this._arp(args, 'arp', 0.5) }
    /** The same, staying until it is stopped: `const chord = lead.startArp("Am")`, `chord.change("F")`, `chord.stop()`. */
    startArp(...args) { return this._arp(args, 'startArp', null) }
    start_arp(...args) { return this.startArp(...args) }
    _arp(args, said, usual) {
      const { chord, kind, length: long, o } = arpArgs(args)
      const notes = chordOf(chord, kind, said)
      const h = (handles = handles >= 0x7ffffff0 ? 1 : handles + 1)
      const c = { op: 'note', id: this._id, note: [notes[0]], len: long === undefined ? usual : long === null ? null : length(long, `${said}: the length`), h, arp: arpOf(notes, notes[0], o, said), t: when(o, said) }
      if (o.volume !== undefined) c.vel = amount(o.volume, `${said}: volume`)
      if (o.pan !== undefined) c.pan = amount(o.pan, `${said}: pan`, -1, 1)
      command(c)
      const arp = new Arp(this._id, h, notes[0], { speed: o.speed, order: o.order })
      arp.now = [chord, kind]
      return arp
    }

    /**
     * A step macro: a short list of steps that every note of this synth plays through, fifty a second (the setting
     * `macroRate`), each changing the wave, pitch, pulse width, cutoff or volume. It is what makes chip drums.
     * lead.setMacro([{ wave: "noise", pitch: 24 }, { wave: "square" }, { pitch: -5, volume: 0.8 }]), and null takes it away.
     * { steps, loop: true, slide: true, release: a step } says more.
     */
    setMacro(macro) {
      macroOf(macro, true, 'setMacro')
      command({ op: 'macro', id: this._id, macro: macro ?? null, t: clock() })
      return this
    }
    set_macro(macro) { return this.setMacro(macro) }

    // --- what a dial, a keyboard, a scope and a meter look for (dials.js binds to anything that has these)

    /** The value of a setting: lead.get("cutoff"). */
    get(name) {
      if (key(name) === 'voice') return this.voice
      const entry = setting(this._name(name))
      if (!entry) throw new Error(`get: there is no setting called ${shown(name)}.${meant(String(name), namesToShow)}`)
      return readSetting(entry, this._patch.get(entry.id))
    }
    /** What a setting is: { name, min, max, default, unit, kind, choices }, for a control that takes its range from it. */
    describe(name) {
      if (key(name) === 'voice') return { name: 'voice', kind: 'choice', min: 0, max: Object.keys(VOICES).length, default: 'none', unit: '', choices: ['none', ...Object.keys(VOICES)] }
      const entry = setting(this._name(name))
      return entry ? describeSetting(entry, this._patch.get(entry.id)) : null
    }
    /** A setting's name as this synth says it -> the name it has everywhere. (The microphone has words of its own.) */
    _name(name) { return name }
    // What set() was given, ready to send: a voice is put on, and the rest go by their names everywhere.
    _given(given, at) {
      const out = {}
      for (const [name, value] of Object.entries(given)) {
        if (key(name) === 'voice') this._wear(value, at)
        else out[this._name(name)] = value
      }
      return out
    }

    /**
     * A voice changer on everything this synth plays: lead.voice = "robot". The voices are robot, chipmunk, monster,
     * cave, telephone, alien and whisper, and "none" takes it off. Each is a handful of settings (the pitch shifter,
     * the ring modulator, the comb, the filter, the echo), which can be turned further once the voice is on.
     * Choosing another voice first puts back what the last one changed.
     */
    get voice() { return this._worn ? this._worn.voice : 'none' }
    set voice(name) { this._wear(name, clock()) }
    _wear(name, at) {
      const voice = voiceName(name)
      if (voice === null) throw new Error(`${shown(name)} is not a voice.${meant(String(name), Object.keys(VOICES))} The voices are: ${Object.keys(VOICES).join(', ')}, and "none"`)
      if (!this._worn) this._worn = { voice: 'none', under: null }
      wearVoice(this._worn, this._patch, voice, engineDefault)
      command({ op: 'set', id: this._id, voice, t: at })
    }

    /**
     * Give this the voice and the voice effects of another: take.soundLike(mic) makes a recording sound as the
     * microphone does now, whatever voice has been chosen and however its dials have been turned since.
     */
    soundLike(other) {
      if (!(other instanceof Synth)) throw new Error(`soundLike needs the microphone or a synth to sound like, as in take.soundLike(mic), not ${shown(other)}`)
      dressLike(this, other)
      return this._self || this
    }
    sound_like(other) { return this.soundLike(other) }

    /** Record what this synth plays into a sample: `const take = lead.record(4)`. On the microphone, it records the microphone. See recordSound. */
    record(...args) { return recordFrom({ ...choices(args, ['length']), from: this._self || this }, 'record') }

    /** A sample or a recording that goes round and round while its note is held: drum.loop = true, or [first frame, the frame after the last]. */
    get loop() { return this._loop }
    set loop(on) {
      this._loop = Array.isArray(on) ? on : !!on
      if (this._sample) command({ op: 'sample', id: this._sample, loop: this._loop, t: clock() })
    }
    /** A key goes down, and comes up: what a keyboard plays. The note stays until its noteOff. */
    noteOn(note, velocity = 0.8) {
      const n = noteNumber(note)
      this._held.get(n)?.stop()
      this._held.set(n, this.start(n, amount(velocity, 'noteOn: velocity')))
      return this
    }
    noteOff(note) {
      const n = noteNumber(note)
      this._held.get(n)?.stop()
      this._held.delete(n)
      return this
    }
    note_on(note, velocity) { return this.noteOn(note, velocity) }
    note_off(note) { return this.noteOff(note) }
    /** The wave this synth is making now, numbers from -1 to 1: a scope draws it. */
    samples() { return (transport?.read?.(this._id, scope) || NOTHING).samples }
    /** How loud this synth is now, [left, right], each from 0 to 1: a meter shows it. */
    level() { return (transport?.read?.(this._id, scope) || NOTHING).level }
    /** The notes this synth is sounding now, as numbers: a keyboard lights them. */
    notes() { return (transport?.read?.(this._id, scope) || NOTHING).notes }

    /**
     * The next note of this synth's line: it begins where the last one ended. lead.note("C4", "quarter"), then
     * lead.note("E4", "eighth"). The length is a note length by name or a number of beats (a quarter with nothing said).
     * A chord's name or a list of notes plays them together. { volume, pan }.
     */
    note(what, long, o = {}) {
      if (long && typeof long === 'object') { o = long; long = undefined }
      if (what === undefined || what === null) throw new Error('note needs a note, as in note("C4", "quarter"). For a silence, use rest("quarter")')
      write(this, notesOf(what), long, o, 'note')
      return this
    }
    /** The next thing in the line is a chord: lead.chord("Cm", "whole"), lead.chord("C4", "minor", "half"), lead.chord(["C4", "E4", "G4"]). */
    chord(name, kind, long, o = {}) {
      if (kind !== undefined && (typeof kind !== 'string' || lengthBeats(kind) !== null)) { o = long && typeof long === 'object' ? long : o; long = kind; kind = undefined }
      if (long && typeof long === 'object') { o = long; long = undefined }
      if (name === undefined || name === null) throw new Error('chord needs a chord, as in chord("Cm", "whole")')
      write(this, chordNotes(name, kind), long, o, 'chord')
      return this
    }
    /** A silence in the line: lead.rest("quarter"). */
    rest(long) { write(this, null, long, {}, 'rest'); return this }
    /** Begin this synth's line again from now (or { after }, { at }, { beat }): what is written next starts there. */
    startLine(o = {}) { lines.set(this._id, Math.max(when(o, 'startLine'), turn ?? -Infinity)); return this }
    start_line(o) { return this.startLine(o) }

    /** Change several settings at once: lead.set({ cutoff: 800, resonance: 0.4 }), and { glide: seconds } to slide there. Or one: lead.set("cutoff", 800). */
    set(given, o = {}) {
      if (typeof given === 'string') return this.set({ [given]: o })
      if (!given || typeof given !== 'object') throw new Error(`set needs settings in braces, as in set({ cutoff: 800 }), not ${shown(given)}`)
      const at = when(o, 'set')
      given = this._given(given, at)
      if (!Object.keys(given).length) return this
      patchOf(given, 'set', true, this._patch, () => 0)
      const c = { op: 'set', id: this._id, set: sendable(given), t: at }
      if (o.glide !== undefined) c.glide = amount(o.glide, 'set: glide', 0, 60)
      command(c)
      return this
    }

    // MIDI (synths-midi.js): a MIDI keyboard plays this synth, its notes go out as MIDI, and a knob turns a setting.
    playFromMidi(...args) { return midiCall('playFromMidi', [this, ...args], this) }
    sendToMidi(...args) { return midiCall('sendToMidi', [this, ...args], this) }
    mapMidi(...args) { return midiCall('mapMidi', [this, ...args], this) }
    learn(...args) { return midiCall('learn', [this, ...args], this) }
    unmapMidi(...args) { return midiCall('unmapMidi', [this, ...args], this) }
    play_from_midi(...args) { return this.playFromMidi(...args) }
    send_to_midi(...args) { return this.sendToMidi(...args) }
    map_midi(...args) { return this.mapMidi(...args) }
    unmap_midi(...args) { return this.unmapMidi(...args) }

    /** Give the synth's place back. It can still be played afterwards: it takes a place again. */
    remove() { command({ op: 'free', id: this._id, t: clock() }); return this }
  }

  // A sample written as a setting's value goes as its id.
  const sendable = (given) => Object.fromEntries(Object.entries(given).map(([k, v]) => [k, v && typeof v === 'object' && v._sample ? v._sample : v]))

  // SETTINGS AS PROPERTIES. `lead.cutoff = 800` writes a command; `lead.cutoff` reads back what was last asked for.
  // A name that is nearly a setting is a slip, and says so; any other name is the program's own to use.
  const asSynth = (synth) => new Proxy(synth, {
    get(target, name, self) {
      if (typeof name !== 'string' || name in target) return Reflect.get(target, name, target)
      return setting(target._name(name)) ? target.get(name) : undefined
    },
    set(target, name, value) {
      if (name === 'macro') { target.setMacro(value); return true }
      if (typeof name !== 'string' || name in target) return Reflect.set(target, name, value, target)
      if (!setting(target._name(name))) {
        const near = nearest(name, namesToShow)
        if (near) throw new Error(`A synth has no setting called ${shown(name)}. Did you mean ${shown(near)}?`)
        return Reflect.set(target, name, value, target)
      }
      target.set({ [name]: value })
      return true
    },
  })

  function makeSynth(...args) {
    const o = {}
    let preset = null
    for (const arg of args) {
      if (typeof arg === 'string') preset = arg
      else if (arg && typeof arg === 'object') Object.assign(o, arg)
      else if (arg !== undefined) throw new Error(`makeSynth needs the name of a synth or its settings in braces, as in makeSynth("bass") or makeSynth({ wave: "saw" }), not ${shown(arg)}`)
    }
    if (typeof o.preset === 'string') preset = o.preset
    delete o.preset
    const macro = o.macro
    delete o.macro
    macroOf(macro, true, 'makeSynth')
    const names = Object.keys(PRESETS).filter((n) => n !== 'sample')
    if (preset !== null && !PRESETS[preset]) throw new Error(`makeSynth(${shown(preset)}): there is no synth called ${shown(preset)}.${meant(preset, names)} The synths are: ${names.join(', ')}`)
    const said = `makeSynth(${preset ? shown(preset) : ''})`
    const patch = patchOf(o, said, true, patchOf(preset ? PRESETS[preset] : null, said, false, patchOf(PLAIN, said, false)), () => 0)
    const id = prefix + 's' + ++ids
    const c = { op: 'synth', id, t: clock() }
    if (preset) c.preset = preset
    if (Object.keys(o).length) c.set = sendable(o)
    if (macro !== undefined) c.macro = macro
    command(c)
    return asSynth(new Synth(id, patch, (preset && PRESETS[preset].note) || 60, 0.3))
  }

  function loadSample(path, o = {}) {
    if (typeof path !== 'string' || !path.trim()) throw new Error(`loadSample(${path === undefined ? '' : shown(path)}) needs the name of a sound file, as in loadSample("kick.wav")`)
    const said = `loadSample(${shown(path)})`
    const settings = { ...o }
    delete settings.note
    delete settings.loop
    const patch = patchOf(settings, said, true, patchOf(PRESETS.sample, said, false, patchOf(PLAIN, said, false)), () => 0)
    const sid = prefix + 'w' + ++ids
    const c = { op: 'sample', id: sid, name: path }
    if (o.note !== undefined) c.note = noteNumber(o.note)
    if (o.loop) c.loop = Array.isArray(o.loop) ? o.loop : true
    if (options.read) {
      Promise.resolve().then(() => options.read(path)).then((bytes) => { if (!bytes) throw new Error('it is not there'); command({ ...c, bytes }) })
        .catch((e) => tell(`${said}: the file could not be read (${(e && e.message) || e}), so it will be silent.`))
    } else command({ ...c, url: options.resolve ? options.resolve(path) : typeof document !== 'undefined' ? new URL(path, document.baseURI).href : path })
    const id = prefix + 's' + ++ids
    command({ op: 'synth', id, preset: 'sample', set: { ...sendable(settings), sample: sid }, t: clock() })
    const synth = new Synth(id, patch, c.note ?? 60, null)
    synth._sample = sid
    return asSynth(synth)
  }

  // WHAT THE PLAYER SAYS BACK: a recording is over, a file is saved, the microphone is there or is not. It is asked
  // for the first time something needs it; a host that carries the commands away hands what its player says to
  // receiveSoundEvents.
  const takes = new Map()
  const saves = new Map()
  let asks = 0
  let hearing = false
  let stopHearing = null
  function hearBack() {
    if (hearing) return
    hearing = true
    const join = () => { if (stopHearing !== false) stopHearing = transport?.onSoundEvents?.(receiveSoundEvents, scope) || null }
    if (transport) join()
    else midiJoins.push(join)
  }
  function receiveSoundEvents(events) {
    for (const e of Array.isArray(events) ? events : [events]) {
      if (!e) continue
      if (e.type === 'recorded') takes.get(e.id)?._finish(e)
      else if (e.type === 'saved') { saves.get(e.ask)?.(e.bytes); saves.delete(e.ask) } else if (e.type === 'microphone') micSynth?._said(e)
    }
  }

  /**
   * THE MICROPHONE: `const mic = useMicrophone()`. It is a synth whose sound comes in instead of being made, so it
   * has a synth's settings (mic.echo = 0.4, mic.cutoff = 900), the voice changers (mic.voice = "robot") and the
   * things a dial, a scope and a meter look for. Its own words: `pitch` is the pitch shifter (-12 to 12 semitones),
   * `ring` the ring modulator, `gain` how much the microphone is turned up, and `gate` the level in dB below which
   * it is taken as silence ("off" for none). Nothing is heard until listen().
   */
  class Mic extends Synth {
    constructor(id) {
      super(id, new Map(), 60, 0.3)
      this._listening = false
      /** "asking" until the browser answers, then "on", or why not: "refused", "none", "busy", "unavailable". "off" once closed. */
      this.state = 'asking'
      this.message = ''
      this._waiting = []
    }
    _name(name) { return micName(name) }
    _given(given, at) {
      const out = {}
      for (const [name, value] of Object.entries(given)) {
        const k = key(name)
        if (k === 'listening') this.listening = value
        else if (k === 'gate' && (value === false || value === 'off' || value === null)) out.micGate = -100
        else out[name] = value
      }
      // The microphone starts with no filter, so that it comes through untouched. Turning the cutoff asks for one.
      const names = Object.keys(out).map((n) => setting(micName(n))?.name)
      if ((names.includes('filter.cutoff') || names.includes('filter.resonance')) && !names.includes('filter.type') && this.get('filter') === 'off') out.filter = 'lowpass'
      return super._given(out, at)
    }
    get(name) { return key(name) === 'listening' ? this._listening : super.get(name) }
    describe(name) { return key(name) === 'listening' ? { name: 'listening', kind: 'bool', min: 0, max: 1, default: false, unit: '' } : super.describe(name) }
    /** Hear the microphone, through its voice and effects. With loudspeakers this can howl: headphones are best. */
    listen(on = true) {
      this._listening = !!on
      command({ op: 'mic', id: this._id, listen: this._listening, t: clock() })
      return this
    }
    /** Stop hearing it. It can still be recorded, and a scope and a meter still show it. */
    mute() { return this.listen(false) }
    get listening() { return this._listening }
    set listening(on) { this.listen(on === true || on === 1 || on === 'on') }
    /** A promise of whether there is a microphone: true once it is on, false if there is none (the console says why, once). */
    whenReady() { return this.state === 'asking' ? new Promise((yes) => this._waiting.push(yes)) : Promise.resolve(this.state === 'on') }
    when_ready() { return this.whenReady() }
    _said(e) {
      if (this.state === 'off') return
      this.state = e.state
      this.message = e.message || ''
      if (e.state !== 'asking') for (const yes of this._waiting.splice(0)) yes(e.state === 'on')
    }
    /** Let the microphone go: the browser's recording light goes out. useMicrophone() opens it again. */
    close() {
      if (this.state === 'off') return this
      this.state = 'off'
      this._listening = false
      for (const yes of this._waiting.splice(0)) yes(false)
      command({ op: 'mic', id: this._id, do: 'close', t: clock() })
      if (micSynth === this) micSynth = mic = null
      return this
    }
    remove() { return this.close() }
  }
  let mic = null
  let micSynth = null
  /**
   * The microphone. The first call asks the browser for it, and the browser asks the person; until then, and if
   * the answer is no, everything still works and there is simply no sound from it. useMicrophone({ voice: "robot",
   * listen: true }) sets it up in one line; { raw: false } asks for the browser's own tidying (echo cancelling, noise
   * removal, automatic level), which suits loudspeakers and spoils a voice changer.
   */
  function useMicrophone(o = {}) {
    if (typeof o === 'string') o = { voice: o }
    if (!o || typeof o !== 'object') throw new Error(`useMicrophone takes its settings in braces, as in useMicrophone({ voice: "robot" }), not ${shown(o)}`)
    const { raw, listen, ...rest } = o
    if (!mic) {
      micSynth = new Mic(prefix + 'm' + ++ids)
      mic = micSynth._self = asSynth(micSynth)
      patchOf({ micGate: MIC_GATE }, 'useMicrophone', false, micSynth._patch)
      const c = { op: 'mic', id: micSynth._id, set: { micGate: MIC_GATE }, t: clock() }
      if (raw === false) c.raw = false
      hearBack()
      command(c)
    }
    if (Object.keys(rest).length) mic.set(rest)
    if (listen !== undefined) mic.listen(!!listen)
    return mic
  }

  /**
   * A RECORDING, while it is being made and afterwards: what recordSound gives back at once. It is a sample like
   * one from loadSample, so take.play(), take.play("E4"), take.reverse = true and take.loop = true all work, and
   * they work while it is still recording (it plays what there is so far). `done` turns true and `seconds` says
   * how long it is when it is over; take.onDone(() => take.play()) is told then, and `await take.whenDone()` waits.
   */
  class Take extends Synth {
    constructor(id, patch, sample) {
      super(id, patch, 60, null)
      this._sample = sample
      this.done = false
      this.recording = true
      this.seconds = 0
      this.frames = 0
      this._after = []
    }
    onDone(fn) {
      if (typeof fn !== 'function') throw new Error('onDone needs a function to call when the recording is over, as in take.onDone(() => take.play())')
      if (this.done) fn(this._self)
      else this._after.push(fn)
      return this._self
    }
    on_done(fn) { return this.onDone(fn) }
    whenDone() { return new Promise((yes) => this.onDone(yes)) }
    when_done() { return this.whenDone() }
    /** End this recording now. */
    stopRecording() { if (!this.done) command({ op: 'record', do: 'stop', id: this._sample, t: clock() }); return this._self }
    stop_recording() { return this.stopRecording() }
    _finish(e) {
      if (this.done) return
      this.done = true
      this.recording = false
      this.seconds = e.seconds || 0
      this.frames = e.frames || 0
      for (const fn of this._after.splice(0)) { try { fn(this._self) } catch (err) { tell((err && err.message) || String(err), 'error') } }
    }
  }
  let settingName = null
  // Settings by engine id as settings by name, to send.
  const named = (list) => {
    if (!settingName) settingName = new Map(PARAMS.map((p) => [p[0], p[1]]))
    return Object.fromEntries(list.map(([pid, value]) => [settingName.get(pid), value]))
  }
  // One synth is given the voice and the voice effects of another, as ordinary commands: what the other had before
  // any voice, its voice, and what was turned after that. So a recording of the plain microphone plays back as the
  // microphone sounds, and both sides of the commands still agree on what "none" puts back.
  function dressLike(synth, from) {
    const part = [...voices().all].filter((pid) => pid < 200)
    const now = (pid) => (synth._patch.has(pid) ? synth._patch.get(pid) : engineDefault(pid))
    if (synth.voice !== 'none') synth.voice = 'none'
    // What it had before it was first dressed is what a setting goes back to when the other has nothing to say.
    if (!synth._plain) synth._plain = new Map(part.map((pid) => [pid, now(pid)]))
    const send = (has, get) => {
      const list = part.map((pid) => [pid, has(pid) ? get(pid) : synth._plain.get(pid)]).filter(([pid, value]) => value !== now(pid))
      if (list.length) synth.set(named(list))
    }
    const under = from._worn && from._worn.under
    if (under) {
      send((pid) => under.has(pid), (pid) => under.get(pid))
      synth.voice = from._worn.voice
      const list = part.filter((pid) => from._patch.has(pid) && from._patch.get(pid) !== now(pid)).map((pid) => [pid, from._patch.get(pid)])
      if (list.length) synth.set(named(list))
    } else send((pid) => from._patch.has(pid), (pid) => from._patch.get(pid))
  }
  // What recordSound, recordOutput, startRecording and a synth's record() all do.
  function recordFrom(o, said) {
    const wid = prefix + 'w' + ++ids
    const c = { op: 'record', id: wid }
    const from = o.from === undefined ? 'mic' : o.from
    let source = null
    if (from === 'output' || from === output) c.from = 'output'
    else if (from === 'mic' || from === 'microphone' || from instanceof Mic) { c.from = 'mic'; source = useMicrophone() } else if (from instanceof Synth) { c.from = 'synth'; c.synth = from._id } else throw new Error(`${said}: "from" needs the microphone, a synth or "output", not ${shown(from)}`)
    if (o.length !== undefined && o.length !== null) {
      c.len = length(o.length, `${said}: the length`)
      if (c.len > LONGEST_RECORDING) throw new Error(`${said}: a recording can be up to ${LONGEST_RECORDING} seconds long, not ${Math.round(c.len)}`)
    } else if (o.max !== undefined) c.max = amount(o.max, `${said}: max`, 0.1, LONGEST_RECORDING)
    if (o.effects) c.effects = true
    if (o.loop) c.loop = Array.isArray(o.loop) ? o.loop : true
    c.t = when(o, said)
    const sid = prefix + 's' + ++ids
    hearBack()
    command(c)
    command({ op: 'synth', id: sid, preset: 'sample', set: { sample: wid }, t: clock() })
    const made = new Take(sid, patchOf(PRESETS.sample, said, false, patchOf(PLAIN, said, false)), wid)
    if (c.loop) made._loop = c.loop
    const take = made._self = asSynth(made)
    takes.set(wid, made)
    if (source && !c.effects) dressLike(take, source)
    return take
  }
  /**
   * Record the microphone into a sample: `const take = recordSound(3)` is three seconds (a note length by name
   * works too). It gives the sample back at once and does not wait: see Take. What is recorded is the plain voice,
   * whether or not the microphone is being listened to, and the take is given the microphone's voice and effects,
   * so it plays back as the microphone sounds and can be changed afterwards (take.voice = "monster").
   * { effects: true } records the voice after its effects instead, which needs listen(). { from: lead } records a
   * synth, { from: "output" } everything. With no microphone the take is empty, and done at once.
   */
  function recordSound(...args) { return recordFrom(choices(args, ['length']), 'recordSound') }
  /** A recording with no set length: it runs until stopRecording(), or for 30 seconds, or { max: seconds } up to 120. */
  function startRecording(o = {}) { return recordFrom({ ...o, length: undefined }, 'startRecording') }
  /** End the recording that is being made. */
  function stopRecording() { command({ op: 'record', do: 'stop', t: clock() }) }
  /** Record everything that is played, in stereo, for "save my tune": `const tune = recordOutput(10)`, then saveSound(tune, "tune.wav"). */
  function recordOutput(...args) { return recordFrom({ ...choices(args, ['length']), from: 'output' }, 'recordOutput') }
  /**
   * A recording or a sample as a WAV file: saveSound(take, "hello.wav"). In a browser the file is downloaded (or
   * given to the app showing the page, if it asked to be). It gives a promise of the file's bytes, and
   * { download: false } gives the bytes alone. A recording that is still being made is saved when it is over.
   */
  function saveSound(what, name, o = {}) {
    if (name && typeof name === 'object') { o = name; name = undefined }
    if (!what || !what._sample) throw new Error('saveSound needs a recording or a sample to save, as in saveSound(take, "hello.wav")')
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) throw new Error(`saveSound needs a name for the file, as in saveSound(take, "hello.wav"), not ${shown(name)}`)
    name = name === undefined ? 'sound.wav' : /\.wav$/i.test(name) ? name : name + '.wav'
    const ask = ++asks
    const c = { op: 'save', id: what._sample, name, ask }
    if (o.download === false) c.download = false
    hearBack()
    const bytes = new Promise((yes) => saves.set(ask, yes))
    if (typeof what.whenDone === 'function') what.whenDone().then(() => command({ ...c, t: clock() }))
    else command({ ...c, t: clock() })
    return bytes
  }

  // The synth playNote and playNotes use.
  const mainSynth = () => main || (main = makeSynth('keys'))

  function playNote(...args) {
    const o = choices(args, ['note', 'length', 'volume'])
    if (o.note === undefined) throw new Error('playNote needs a note, as in playNote("C4")')
    if (o.length === undefined) o.length = 0.5
    mainSynth().play(o)
  }

  function playNotes(...args) { return mainSynth().playNotes(...args) }

  // Arpeggios with no synth named are played on a plain square wave, as a sound chip would.
  let chip = null
  const arpSynth = () => chip || (chip = makeSynth('chip'))

  /** Everything that is sounding, as a target for a scope, a meter and dials for the volume and the shared effects. */
  let volumeNow = 1
  const output = {
    samples: () => (transport?.read?.(undefined, scope) || NOTHING).samples,
    level: () => (transport?.read?.(undefined, scope) || NOTHING).level,
    notes: () => (transport?.read?.(undefined, scope) || NOTHING).notes,
    describe(name) {
      if (key(name) === 'volume') return { name: 'volume', kind: 'float', min: 0, max: 2, default: 1, unit: 'gain' }
      const entry = setting(name)
      return entry && !entry.part ? { name: entry.name, kind: KINDS[entry.kind], min: entry.min, max: entry.max, default: entry.def, unit: entry.unit, ...(entry.choices ? { choices: [...entry.choices] } : {}) } : null
    },
    get(name) { return key(name) === 'volume' ? volumeNow : effects.has(key(name)) ? effects.get(key(name)) : setting(name)?.def },
    set(name, value) { if (key(name) === 'volume') api.setVolume(value); else api.setEffects({ [name]: value }) },
  }
  const effects = new Map()

  /**
   * Write a section once and have it go round: loopNotes(() => { note("C4", "quarter"); bass.note("C2", "half") }).
   * Everything written inside, on any synth, is kept in time by the engine and follows the tempo. It goes round for
   * ever, or as many times as the number given first or last. What it gives back has stop().
   */
  function loopNotes(a, b) {
    const section = typeof a === 'function' ? a : b
    const times = typeof a === 'function' ? b : a
    if (typeof section !== 'function') throw new Error('loopNotes needs the notes to go round, as a function: loopNotes(() => { note("C4", "quarter"); note("E4", "quarter") })')
    if (writing) throw new Error('loopNotes cannot be used inside another loopNotes')
    const repeat = times === undefined || times === true ? true : amount(times, 'loopNotes: how many times', 1, 1e9)
    writing = new Map()
    let written
    try { section() } finally { written = writing; writing = null }
    const whole = Math.max(0, ...[...written.values()].map((line) => line.at))
    if (!(whole > 0)) throw new Error('loopNotes: nothing was written to go round. Use note(), chord() and rest() inside it')
    // Every line of the section starts together, where the latest of those lines has reached.
    const start = Math.max(...[...written.keys()].map(lineAt))
    const made = []
    for (const [synth, line] of written) {
      const id = prefix + 't' + ++ids
      made.push(id)
      if (line.steps.length) command({ op: 'tune', id, synth, steps: line.steps, length: whole, repeat, beats: true, t: start })
      lines.set(synth, repeat === true ? start : start + repeat * whole * 60 / tempo)
    }
    return { stop() { for (const id of made) command({ op: 'stop', id, t: clock() }); return this } }
  }

  function playSound(...args) {
    const o = choices(args, ['name', 'volume'])
    const name = o.name
    if (typeof name !== 'string' || !SOUNDS[name]) throw new Error(`playSound(${name === undefined ? '' : shown(name)}): there is no sound called ${shown(name)}.${typeof name === 'string' ? meant(name, Object.keys(SOUNDS)) : ''} The sounds are: ${Object.keys(SOUNDS).join(', ')}`)
    const c = { op: 'sound', name, t: when(o, 'playSound') }
    if (o.volume !== undefined) c.vol = amount(o.volume, 'playSound: volume', 0, 4)
    if (o.pitch !== undefined) c.pitch = amount(o.pitch, 'playSound: pitch', -48, 48)
    if (o.pan !== undefined) c.pan = amount(o.pan, 'playSound: pan', -1, 1)
    if (o.length !== undefined) c.len = length(o.length, 'playSound: length')
    command(c)
  }

  /**
   * Play a tracker song: a .mod or .xm file, or one of our own songs (.json). playSong("tune.mod"), or its bytes.
   * { repeat: false } plays it once, { volume: 0.5 }, { after: 2 }. A song whose instruments are synths by name is
   * told what they are with { patches: { "wobble": "bass", "pling": { preset: "pluck", echo: 0.4 } } }; a name that
   * is a ready-made synth's needs no telling. One song plays at a time.
   */
  function playSong(file, o = {}) {
    const bytes = file instanceof ArrayBuffer || ArrayBuffer.isView(file)
    if (!bytes && (typeof file !== 'string' || !file.trim())) throw new Error(`playSong(${file === undefined ? '' : shown(file)}) needs the name of a song file, as in playSong("tune.mod")`)
    const id = prefix + 'g' + ++ids
    const c = { op: 'song', id, do: 'play', repeat: (o.repeat ?? o.loop) !== false, t: when(o, 'playSong') }
    if (o.volume !== undefined) c.vol = amount(o.volume, 'playSong: volume', 0, 2)
    if (o.raw !== undefined) c.raw = !!o.raw
    if (o.patches !== undefined) {
      if (!o.patches || typeof o.patches !== 'object') throw new Error(`playSong: patches needs names and what each is, as in { patches: { "wobble": "bass" } }, not ${shown(o.patches)}`)
      const names = Object.keys(PRESETS).filter((n) => n !== 'sample')
      for (const [name, what] of Object.entries(o.patches)) {
        const preset = typeof what === 'string' ? what : what && what.preset
        if (preset !== undefined && !PRESETS[preset]) throw new Error(`playSong: the patch ${shown(name)} names a synth called ${shown(preset)}, and there is none.${meant(String(preset), names)} The synths are: ${names.join(', ')}`)
        if (what && typeof what === 'object') { patchOf(what, `playSong: the patch ${shown(name)}`, true, new Map(), () => 0); macroOf(what.macro, true, `playSong: the patch ${shown(name)}`) } else if (typeof what !== 'string') throw new Error(`playSong: the patch ${shown(name)} needs the name of a synth or settings in braces, not ${shown(what)}`)
      }
      c.patches = o.patches
    }
    if (bytes) command({ ...c, bytes: file })
    else if (options.read) {
      // A host whose player cannot fetch reads the song here, and the WAV files one of our own songs names.
      const from = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''
      Promise.resolve().then(() => options.read(file)).then(async (data) => {
        if (!data) throw new Error('it is not there')
        const all = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength)
        const files = {}
        if (all[all.findIndex((b) => b > 32)] === 123) {
          let named = []
          try { named = (JSON.parse(new TextDecoder().decode(all)).samples || []).map((sample) => sample && sample.file).filter((f) => typeof f === 'string') } catch (e) { /* the engine says what is wrong */ }
          for (const name of new Set(named)) files[name] = await options.read(from + name)
        }
        command({ ...c, name: file, bytes: all, files })
      }).catch((e) => tell(`playSong(${shown(file)}): the file could not be read (${(e && e.message) || e}), so it will not play.`))
    } else command({ ...c, name: file, url: options.resolve ? options.resolve(file) : typeof document !== 'undefined' ? new URL(file, document.baseURI).href : file })
    const say = (what, more) => { command({ op: 'song', id, do: what, ...more, t: clock() }); return song }
    const song = {
      stop: () => say('stop'),
      pause: () => say('pause'),
      resume: () => say('resume'),
      /** Go to a place in the song: its order list, then a row of the pattern there. */
      seek: (order, row = 0) => say('seek', { order: amount(order, 'seek: the order', 0, 65535), row: amount(row, 'seek: the row', 0, 255) }),
      set volume(v) { say('volume', { vol: amount(v, 'volume', 0, 2) }) },
      set repeat(on) { say('repeat', { repeat: !!on }) },
      /** Where the song is: { state, order, pattern, row, tick, speed, tempo, rounds, rows, orders }, for drawing it. */
      get position() { return transport?.songPosition?.() || NO_SONG },
    }
    return song
  }

  const api = {
    playSound, playNote, playNotes, makeSynth, loadSample, playSong,
    useMicrophone, recordSound, startRecording, stopRecording, recordOutput, saveSound, receiveSoundEvents,
    /** Let the microphone go, if it was asked for. */
    stopMicrophone() { micSynth?.close() },
    /** The voice changers by name. */
    voiceNames,
    /** A chord as a fast arpeggio on a chip sound: playArp("Cm7"), playArp("C4", "minor", 1, { speed: 30, order: "down" }). */
    playArp(...args) { return arpSynth().arp(...args) },
    /** The same, staying until it is stopped, and able to change chord: `const chord = startArp("Am")`, `chord.change("F")`. */
    startArp(...args) { return arpSynth().startArp(...args) },
    /** A tune as ordinary calls, each note beginning where the last ended (on the synth playNote uses): note("C4", "quarter"), chord("Cm", "half"), rest("eighth"). */
    note(...args) { mainSynth().note(...args) },
    chord(...args) { mainSynth().chord(...args) },
    rest(long) { mainSynth().rest(long) },
    /** Begin every line again together, from now (or { after }, { at }, { beat }). */
    startLines(o = {}) { lines.clear(); turn = when(o, 'startLines') },
    loopNotes,
    /** The synth that playNote and playNotes use: change it (`mainSynth().cutoff = 900`), or tie a keyboard to it. */
    mainSynth,
    /** All the sound together: soundOutput().samples() for a scope, .level() for a meter, .notes() for lit keys. */
    soundOutput: () => output,
    stopSong() { command({ op: 'song', do: 'stop', t: clock() }) },
    /** Stop everything that is sounding or waiting to sound. Synths and their settings stay. */
    stopSound() { command({ op: 'stop', t: clock() }) },
    /** How loud everything is: 1 is normal, 0 is silent, 2 is twice as loud. */
    setVolume(v) { volumeNow = amount(v, 'setVolume', 0, 4); command({ op: 'master', volume: volumeNow, t: clock() }) },
    muteSound(on = true) { command({ op: 'master', mute: !!on, t: clock() }) },
    unmuteSound() { command({ op: 'master', mute: false, t: clock() }) },
    /** The effects every synth shares: setEffects({ echoTime: 0.3, echoFeedback: 0.5, reverbSize: 0.8 }). */
    setEffects(given) {
      if (!given || typeof given !== 'object') throw new Error(`setEffects needs settings in braces, as in setEffects({ echoTime: 0.3 }), not ${shown(given)}`)
      const patch = patchOf(given, 'setEffects', true)
      for (const pid of patch.keys()) if (pid < 200) throw new Error(`setEffects is for the effects every synth shares: ${namesToShow.filter((n) => !setting(n).part).join(', ')}. A synth's own settings are set on the synth, as in lead.echo = 0.4`)
      for (const [name, value] of Object.entries(given)) effects.set(key(name), value)
      command({ op: 'master', set: given, t: clock() })
    },
    /** How fast the beat is, in beats a minute. Beat 0 is now. */
    setTempo(bpm) { tempo = amount(bpm, 'setTempo', 20, 400); beatZero = clock(); command({ op: 'tempo', bpm: tempo, t: clock() }) },
    /** How many seconds that many beats last. */
    beats(n = 1) { return (typeof n === 'string' ? beatsLong(n, 'beats') : n) * 60 / tempo },
    /** Which beat it is now (a fraction between beats). */
    beat() { return (clock() - beatZero) * tempo / 60 },
    /** The sound clock now, in seconds: the time that { at } is read against. */
    soundTime() { return clock() },
    soundNames, synthNames, settingNames,
    /** Silence for this program alone, with everything kept as it is (a scene that is out of view), and back again. */
    pause() { command({ op: 'master', pause: true, t: clock() }); flush() },
    resume() { command({ op: 'master', pause: false, t: clock() }); flush() },
    /** Send what has been asked for so far (for `batch: 'manual'`). */
    flush,
    /** A promise of everything asked for so far being ready to send: MIDI's file, if a MIDI function was used, has arrived. */
    settled: () => midiComing || Promise.resolve(),
    /** The player this made for itself, once a sound has been asked for (null with a `sound` transport). */
    get player() { return player },
    /** Stop everything and let go of the sound card. */
    close() {
      if (closed) return
      midi?.close()
      if (stopHearing) stopHearing()
      stopHearing = false
      cmds = [...(micSynth ? [{ op: 'mic', id: micSynth._id, do: 'close', t: clock() }] : []), { op: 'stop', t: clock() }, { op: 'close', t: clock() }]
      if (transport) flush()
      closed = true
      if (mine) { if (--mine.users <= 0) { mine.player.close(); if (shared === mine) shared = null } } else player?.close()
    },
  }
  for (const name of MIDI_FUNCTIONS) api[name] = (...args) => midiCall(name, args, name === 'midiDevices' ? { inputs: [], outputs: [], available: null } : undefined)
  // The Python spellings.
  for (const name of Object.keys(api)) {
    const snake = name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
    if (snake !== name && typeof api[name] === 'function') api[snake] = api[name]
  }
  return api
}

// --- the library's own functions: one sound for the page --------------------------------------

let pageOptions = {}
let page = null
const mine = () => page || (page = createSound(pageOptions))

/**
 * Set the page's sound up before the first sound is asked for: `configure({ wasm: bytes, worklet: 'blob' })` for a
 * page that may not fetch the engine, `configure({ sound: { send(batch) {} } })` to take the commands yourself,
 * `configure({ latency: 0.02 })`. The options are createSound's.
 */
export function configure(options = {}) {
  if (page) { page.close(); page = null }
  pageOptions = { ...options }
}

/** Everything a binding needs to check names without the engine: the settings, their friendly names, the synths and the sounds. */
export function describe() {
  return {
    version, commands: COMMANDS, engine: ENGINE,
    settings: PARAMS.map(([id, name, kind, min, max, def, unit, choices]) => ({ id, name, kind: KINDS[kind], min, max, default: def, unit, ...(choices ? { choices } : {}), scope: id < 200 ? 'synth' : 'all' })),
    names: Object.fromEntries(Object.entries(ALIASES).map(([alias, to]) => [alias, Array.isArray(to) ? { setting: to[0], scale: to[1] } : { setting: to, scale: 1 }])),
    choiceWords: CHOICE_WORDS, plain: PLAIN, synths: PRESETS, sounds: SOUNDS, chords: CHORDS, orders: ORDERS, macroWaves: MACRO_WAVES, lengths: LENGTHS, lengthLetters: LENGTH_LETTERS, midi: MIDI,
    // The voice changers (each a list of settings; putting one on first puts back what the last changed), and the microphone.
    voices: VOICES,
    microphone: {
      names: MIC_NAMES, gate: MIC_GATE, states: ['asking', 'on', 'refused', 'none', 'busy', 'unavailable', 'off'],
      functions: ['useMicrophone', 'stopMicrophone', 'recordSound', 'startRecording', 'stopRecording', 'recordOutput', 'saveSound', 'receiveSoundEvents', 'voiceNames'],
      micFunctions: ['listen', 'mute', 'record', 'whenReady', 'close'], takeFunctions: ['onDone', 'whenDone', 'stopRecording'],
      events: ['microphone', 'recorded', 'saved'], longestRecording: LONGEST_RECORDING, usualRecording: USUAL_RECORDING,
    },
  }
}

/** The names of the ready-made game sounds, the ready-made synths, and every setting a synth has. */
export function soundNames() { return Object.keys(SOUNDS) }
export function synthNames() { return Object.keys(PRESETS).filter((n) => n !== 'sample') }
export function settingNames() { allSettings(); return [...namesToShow] }
/** The voice changers a microphone, a recording or a synth can be given: mic.voice = "robot". */
export function voiceNames() { return Object.keys(VOICES) }

export const playSound = (...a) => mine().playSound(...a)
export const playNote = (...a) => mine().playNote(...a)
export const playNotes = (...a) => mine().playNotes(...a)
export const playArp = (...a) => mine().playArp(...a)
export const startArp = (...a) => mine().startArp(...a)
export const note = (...a) => mine().note(...a)
export const chord = (...a) => mine().chord(...a)
export const rest = (long) => mine().rest(long)
export const startLines = (o) => mine().startLines(o)
export const loopNotes = (a, b) => mine().loopNotes(a, b)
export const mainSynth = () => mine().mainSynth()
export const soundOutput = () => mine().soundOutput()
export const makeSynth = (...a) => mine().makeSynth(...a)
export const loadSample = (...a) => mine().loadSample(...a)
export const playSong = (...a) => mine().playSong(...a)
export const stopSong = () => mine().stopSong()
export const stopSound = () => mine().stopSound()
export const setVolume = (v) => mine().setVolume(v)
export const muteSound = (on) => mine().muteSound(on)
export const unmuteSound = () => mine().unmuteSound()
export const setEffects = (given) => mine().setEffects(given)
export const setTempo = (bpm) => mine().setTempo(bpm)
export const beats = (n) => mine().beats(n)
export const beat = () => mine().beat()
export const soundTime = () => mine().soundTime()
// MIDI: a keyboard, knobs and other synths (see synths-midi.js, and lead.playFromMidi(), lead.learn("cutoff")).
export const onMidi = (fn) => mine().onMidi(fn)
export const onMidiNote = (fn) => mine().onMidiNote(fn)
export const onMidiNoteOff = (fn) => mine().onMidiNoteOff(fn)
export const onMidiControl = (fn) => mine().onMidiControl(fn)
export const onMidiDevices = (fn) => mine().onMidiDevices(fn)
export const useMidiHooks = (hooks) => mine().useMidiHooks(hooks)
export const sendMidi = (...a) => mine().sendMidi(...a)
export const sendMidiNote = (...a) => mine().sendMidiNote(...a)
export const sendMidiNoteOff = (...a) => mine().sendMidiNoteOff(...a)
export const sendMidiControl = (...a) => mine().sendMidiControl(...a)
export const sendMidiBend = (...a) => mine().sendMidiBend(...a)
export const sendMidiProgram = (...a) => mine().sendMidiProgram(...a)
export const sendMidiClock = (on) => mine().sendMidiClock(on)
export const midiDevices = () => mine().midiDevices()
export const useMidiInput = (name) => mine().useMidiInput(name)
export const useMidiOutput = (name) => mine().useMidiOutput(name)
export const receiveMidi = (events) => mine().receiveMidi(events)
export const stopMidi = () => { if (page) page.stopMidi() }
// The microphone, recording and saving (see createSound's useMicrophone, recordSound and saveSound).
export const useMicrophone = (o) => mine().useMicrophone(o)
export const stopMicrophone = () => { if (page) page.stopMicrophone() }
export const recordSound = (...a) => mine().recordSound(...a)
export const startRecording = (o) => mine().startRecording(o)
export const stopRecording = () => { if (page) page.stopRecording() }
export const recordOutput = (...a) => mine().recordOutput(...a)
export const saveSound = (...a) => mine().saveSound(...a)
export const receiveSoundEvents = (events) => mine().receiveSoundEvents(events)
/** The page's player, once a sound has been asked for: its `state` is 'waiting' until the first tap. */
export const soundPlayer = () => mine().player
export {
  playSound as play_sound, playNote as play_note, playNotes as play_notes, makeSynth as make_synth, loadSample as load_sample,
  playSong as play_song, stopSong as stop_song, stopSound as stop_sound, setVolume as set_volume, muteSound as mute_sound,
  unmuteSound as unmute_sound, setEffects as set_effects, setTempo as set_tempo, soundTime as sound_time,
  soundNames as sound_names, synthNames as synth_names, settingNames as setting_names, noteNumber as note_number,
  createSound as create_sound, renderSound as render_sound, packSong as pack_song, playArp as play_arp, startArp as start_arp, mainSynth as main_synth,
  soundOutput as sound_output, chordNotes as chord_notes, startLines as start_lines, loopNotes as loop_notes, lengthBeats as length_beats,
  onMidi as on_midi, onMidiNote as on_midi_note, onMidiNoteOff as on_midi_note_off, onMidiControl as on_midi_control,
  onMidiDevices as on_midi_devices, useMidiHooks as use_midi_hooks, sendMidi as send_midi, sendMidiNote as send_midi_note,
  sendMidiNoteOff as send_midi_note_off, sendMidiControl as send_midi_control, sendMidiBend as send_midi_bend,
  sendMidiProgram as send_midi_program, sendMidiClock as send_midi_clock, midiDevices as midi_devices,
  useMidiInput as use_midi_input, useMidiOutput as use_midi_output, receiveMidi as receive_midi, stopMidi as stop_midi,
  useMicrophone as use_microphone, stopMicrophone as stop_microphone, recordSound as record_sound, startRecording as start_recording,
  stopRecording as stop_recording, recordOutput as record_output, saveSound as save_sound, receiveSoundEvents as receive_sound_events,
  voiceNames as voice_names,
}
