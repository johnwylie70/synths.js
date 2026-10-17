# Every setting of a synth

Every setting a synth has, by name, with the values it takes, where it starts and what it is measured in. It is written from the library's own table of names (`synths-names.json`), so it is what the library has. [Settings](../README.md#settings) says what the common ones do.

A setting is a plain property of a synth (`lead.cutoff = 800`), a name in `makeSynth({ cutoff: 800 })`, and a name a control can be tied to. In Python the same names are written with underscores: `lead.vibrato_rate`, `make_synth(vibrato_rate=6)`. Either spelling works in both languages.

## Tying a control to a setting

A control from [dials.js](https://github.com/johnwylie70/dials.js) (or [pydials](https://github.com/johnwylie70/pydials) in Python) takes the setting's name and nothing else: it asks the synth for the setting's range, unit and choices (`lead.describe("cutoff")`), so the dial is as wide as the setting and shows its unit.

```js
dial("cutoff", lead, "cutoff")        // a number: a dial (or slider, or number box)
select("wave", lead, "wave")          // one of a list: a select (or rotary, choose, dropdown)
toggle("sync", lead, "sync")          // on or off: a toggle (or checkbox)
```

```python
dial("cutoff", lead, "cutoff")
select("wave", lead, "wave")
toggle("sync", lead, "sync")
```

Which control suits what:

| The setting is | Use | Notes |
|---|---|---|
| a number in a range | `dial`, `slider`, `fader`, `number`, `wheel` | The range, unit and start come from the synth. |
| one of a list of words | `select`, `rotary`, `choose`, `dropdown`, `radio` | The choices come from the synth. |
| on or off | `toggle`, `checkbox` | |
| two numbers at once | `xyPad(label, lead, "cutoff", "resonance")` | One finger sets both. |
| attack, decay, sustain and release | `envelope(label, lead)` | Finds the four settings and draws them as one shape. |
| the gate or the arpeggio pattern | `tranceGate(label, lead)`, `arpPattern(label, lead)` | Each also puts its own settings beside it. |
| something of your own | `custom(label, { draw, onDown, ... })` | See [Your own controls](https://github.com/johnwylie70/dials.js#your-own-controls). |

## Oscillators

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `wave` | `wave` | `"sine"`, `"triangle"`, `"saw"`, `"pulse"`, `"sample"` | `"triangle"` |  | `select("wave", lead, "wave")` |
| `level1` | `level1` | 0 to 1 | 1 | 1 is as it comes | `dial("level1", lead, "level1")` |
| `width` or `pulseWidth` | `width` or `pulse_width` | 0 to 1 | 0.5 |  | `dial("width", lead, "width")` |
| `sample` | `sample` | 0 to 1023, whole numbers | 0 | a slot | `dial("sample", lead, "sample")` |
| `octave` | `octave` | -4 to 4, whole numbers | 0 | octaves | `dial("octave", lead, "octave")` |
| `pitch` | `pitch` | -48 to 48 | 0 | semitones | `dial("pitch", lead, "pitch")` |
| `voices` | `voices` | 1 to 8, whole numbers | 1 | voices | `dial("voices", lead, "voices")` |
| `detune` | `detune` | 0 to 100 | 20 | hundredths of a semitone | `dial("detune", lead, "detune")` |
| `spread` | `spread` | 0 to 1 | 0.5 |  | `dial("spread", lead, "spread")` |
| `wave2` | `wave2` | `"sine"`, `"triangle"`, `"saw"`, `"pulse"`, `"sample"` | `"saw"` |  | `select("wave2", lead, "wave2")` |
| `level2` | `level2` | 0 to 1 | 0 | 1 is as it comes | `dial("level2", lead, "level2")` |
| `pitch2` | `pitch2` | -48 to 48 | 0 | semitones | `dial("pitch2", lead, "pitch2")` |
| `detune2` | `detune2` | -100 to 100 | 0 | hundredths of a semitone | `dial("detune2", lead, "detune2")` |
| `width2` | `width2` | 0 to 1 | 0.5 |  | `dial("width2", lead, "width2")` |
| `sync` | `sync` | `true` or `false` (`True`, `False`) | off |  | `toggle("sync", lead, "sync")` |
| `ring` | `ring` | 0 to 1 | 0 |  | `dial("ring", lead, "ring")` |
| `sub` | `sub` | 0 to 1 | 0 | 1 is as it comes | `dial("sub", lead, "sub")` |
| `noise` | `noise` | 0 to 1 | 0 | 1 is as it comes | `dial("noise", lead, "noise")` |
| `macroRate` | `macro_rate` | 1 to 1000 | 50 | Hz | `dial("macroRate", lead, "macroRate")` |
| `macroSync` | `macro_sync` | `true` or `false` (`True`, `False`) | off |  | `toggle("macroSync", lead, "macroSync")` |
| `reverse` | `reverse` | `true` or `false` (`True`, `False`) | off |  | `toggle("reverse", lead, "reverse")` |
| `osc1Coarse` | `osc1_coarse` | -48 to 48 | 0 | semitones | `dial("osc1Coarse", lead, "osc1.coarse")` |
| `osc1Fine` | `osc1_fine` | -100 to 100 | 0 | hundredths of a semitone | `dial("osc1Fine", lead, "osc1.fine")` |
| `osc1Start` | `osc1_start` | 0 to 1 | 0 |  | `dial("osc1Start", lead, "osc1.start")` |
| `osc1Keytrack` | `osc1_keytrack` | `true` or `false` (`True`, `False`) | on |  | `toggle("osc1Keytrack", lead, "osc1.keytrack")` |
| `osc2Sample` | `osc2_sample` | 0 to 1023, whole numbers | 0 | a slot | `dial("osc2Sample", lead, "osc2.sample")` |
| `osc2Start` | `osc2_start` | 0 to 1 | 0 |  | `dial("osc2Start", lead, "osc2.start")` |
| `osc2Keytrack` | `osc2_keytrack` | `true` or `false` (`True`, `False`) | on |  | `toggle("osc2Keytrack", lead, "osc2.keytrack")` |
| `osc2Reverse` | `osc2_reverse` | `true` or `false` (`True`, `False`) | off |  | `toggle("osc2Reverse", lead, "osc2.reverse")` |
| `subWave` | `sub_wave` | `"sine"`, `"square"`, `"triangle"` | `"sine"` |  | `select("subWave", lead, "sub.wave")` |
| `subOctave` | `sub_octave` | -2 to -1, whole numbers | -1 | octaves | `dial("subOctave", lead, "sub.octave")` |
| `sampleAntialias` | `sample_antialias` | `true` or `false` (`True`, `False`) | on |  | `toggle("sampleAntialias", lead, "sample.antialias")` |
| `noiseType` | `noise_type` | `"white"`, `"pink"`, `"lfsr"`, `"lfsr_short"` | `"white"` |  | `select("noiseType", lead, "noise.type")` |
| `noisePitch` | `noise_pitch` | -48 to 48 | 0 | semitones | `dial("noisePitch", lead, "noise.pitch")` |

## Loudness of a note (amplitude envelope)

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `attack` | `attack` | 0 to 20 | 0.005 | seconds | `dial("attack", lead, "attack")` |
| `decay` | `decay` | 0 to 20 | 0.1 | seconds | `dial("decay", lead, "decay")` |
| `sustain` | `sustain` | 0 to 1 | 0.8 |  | `dial("sustain", lead, "sustain")` |
| `release` | `release` | 0 to 20 | 0.15 | seconds | `dial("release", lead, "release")` |
| `curve` | `curve` | 0 to 1 | 0.5 |  | `dial("curve", lead, "curve")` |

## Filter

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `filter` | `filter` | `"off"`, `"lowpass"`, `"highpass"`, `"bandpass"`, `"notch"`, `"low_band"`, `"band_high"`, `"all"` | `"off"` |  | `select("filter", lead, "filter")` |
| `slope` | `slope` | `"12db"`, `"24db"` | `"12db"` |  | `select("slope", lead, "slope")` |
| `cutoff` | `cutoff` | 20 to 20000 | 2000 | Hz | `dial("cutoff", lead, "cutoff")` |
| `resonance` | `resonance` | 0 to 1 | 0.15 |  | `dial("resonance", lead, "resonance")` |
| `keytrack` | `keytrack` | 0 to 1 | 0 |  | `dial("keytrack", lead, "keytrack")` |
| `sweep` | `sweep` | -96 to 96 | 0 | semitones | `dial("sweep", lead, "sweep")` |
| `sweepAttack` | `sweep_attack` | 0 to 20 | 0.005 | seconds | `dial("sweepAttack", lead, "sweepAttack")` |
| `sweepDecay` | `sweep_decay` | 0 to 20 | 0.2 | seconds | `dial("sweepDecay", lead, "sweepDecay")` |
| `sweepSustain` | `sweep_sustain` | 0 to 1 | 0.3 |  | `dial("sweepSustain", lead, "sweepSustain")` |
| `sweepRelease` | `sweep_release` | 0 to 20 | 0.2 | seconds | `dial("sweepRelease", lead, "sweepRelease")` |
| `filterVelocity` | `filter_velocity` | -96 to 96 | 0 | semitones | `dial("filterVelocity", lead, "filter.velocity")` |
| `filterEnvCurve` | `filter_env_curve` | 0 to 1 | 0.5 |  | `dial("filterEnvCurve", lead, "filter_env.curve")` |

## Pitch

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `pitchSweep` | `pitch_sweep` | -48 to 48 | 0 | semitones | `dial("pitchSweep", lead, "pitchSweep")` |
| `pitchSweepAttack` | `pitch_sweep_attack` | 0 to 20 | 0.005 | seconds | `dial("pitchSweepAttack", lead, "pitchSweepAttack")` |
| `pitchSweepDecay` | `pitch_sweep_decay` | 0 to 20 | 0.2 | seconds | `dial("pitchSweepDecay", lead, "pitchSweepDecay")` |
| `tune` | `tune` | -100 to 100 | 0 | hundredths of a semitone | `dial("tune", lead, "tune")` |
| `bend` | `bend` | -1 to 1 | 0 |  | `dial("bend", lead, "bend")` |
| `bendRange` | `bend_range` | 0 to 48 | 2 | semitones | `dial("bendRange", lead, "bend_range")` |
| `glide` | `glide` | 0 to 10 | 0 | seconds | `dial("glide", lead, "glide")` |
| `modEnvSustain` | `mod_env_sustain` | 0 to 1 | 0 |  | `dial("modEnvSustain", lead, "mod_env.sustain")` |
| `modEnvRelease` | `mod_env_release` | 0 to 20 | 0.2 | seconds | `dial("modEnvRelease", lead, "mod_env.release")` |
| `modEnvCurve` | `mod_env_curve` | 0 to 1 | 0.5 |  | `dial("modEnvCurve", lead, "mod_env.curve")` |
| `modEnvOsc2Pitch` | `mod_env_osc2_pitch` | -48 to 48 | 0 | semitones | `dial("modEnvOsc2Pitch", lead, "mod_env.osc2_pitch")` |
| `modEnvPulseWidth` | `mod_env_pulse_width` | -1 to 1 | 0 |  | `dial("modEnvPulseWidth", lead, "mod_env.pulse_width")` |

## Vibrato, tremolo, wobble (the two LFOs)

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `vibrato` | `vibrato` | -48 to 48 | 0 | semitones | `dial("vibrato", lead, "vibrato")` |
| `vibratoRate` | `vibrato_rate` | 0.01 to 50 | 5 | Hz | `dial("vibratoRate", lead, "vibratoRate")` |
| `vibratoDelay` | `vibrato_delay` | 0 to 10 | 0 | seconds | `dial("vibratoDelay", lead, "vibratoDelay")` |
| `tremolo` | `tremolo` | 0 to 1 | 0 |  | `dial("tremolo", lead, "tremolo")` |
| `wobble` | `wobble` | -96 to 96 | 0 | semitones | `dial("wobble", lead, "wobble")` |
| `wobbleRate` or `pwmRate` | `wobble_rate` or `pwm_rate` | 0.01 to 50 | 0.5 | Hz | `dial("wobbleRate", lead, "wobbleRate")` |
| `autopan` | `autopan` | 0 to 1 | 0 |  | `dial("autopan", lead, "autopan")` |
| `pwm` | `pwm` | -1 to 1 | 0 |  | `dial("pwm", lead, "pwm")` |
| `lfo1Wave` | `lfo1_wave` | `"sine"`, `"triangle"`, `"saw"`, `"square"`, `"random"` | `"sine"` |  | `select("lfo1Wave", lead, "lfo1.wave")` |
| `lfo1Fade` | `lfo1_fade` | 0 to 10 | 0 | seconds | `dial("lfo1Fade", lead, "lfo1.fade")` |
| `lfo1Sync` | `lfo1_sync` | `true` or `false` (`True`, `False`) | on |  | `toggle("lfo1Sync", lead, "lfo1.sync")` |
| `lfo1PulseWidth` | `lfo1_pulse_width` | -1 to 1 | 0 |  | `dial("lfo1PulseWidth", lead, "lfo1.pulse_width")` |
| `lfo1Cutoff` | `lfo1_cutoff` | -96 to 96 | 0 | semitones | `dial("lfo1Cutoff", lead, "lfo1.cutoff")` |
| `lfo1Pan` | `lfo1_pan` | 0 to 1 | 0 |  | `dial("lfo1Pan", lead, "lfo1.pan")` |
| `lfo2Wave` | `lfo2_wave` | `"sine"`, `"triangle"`, `"saw"`, `"square"`, `"random"` | `"triangle"` |  | `select("lfo2Wave", lead, "lfo2.wave")` |
| `lfo2Delay` | `lfo2_delay` | 0 to 10 | 0 | seconds | `dial("lfo2Delay", lead, "lfo2.delay")` |
| `lfo2Fade` | `lfo2_fade` | 0 to 10 | 0 | seconds | `dial("lfo2Fade", lead, "lfo2.fade")` |
| `lfo2Sync` | `lfo2_sync` | `true` or `false` (`True`, `False`) | off |  | `toggle("lfo2Sync", lead, "lfo2.sync")` |
| `lfo2Pitch` | `lfo2_pitch` | -48 to 48 | 0 | semitones | `dial("lfo2Pitch", lead, "lfo2.pitch")` |
| `lfo2Amp` | `lfo2_amp` | 0 to 1 | 0 |  | `dial("lfo2Amp", lead, "lfo2.amp")` |

## Effects of the synth

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `distortion` or `drive` | `distortion` or `drive` | 0 to 1 | 0 |  | `dial("distortion", lead, "distortion")` |
| `crush` or `bits` | `crush` or `bits` | 1 to 16 | 16 | bits | `dial("crush", lead, "crush")` |
| `downsample` | `downsample` | 1 to 64, whole numbers | 1 |  | `dial("downsample", lead, "downsample")` |
| `pitchShift` | `pitch_shift` | -12 to 12 | 0 | semitones | `dial("pitchShift", lead, "pitchShift")` |
| `ringMod` | `ring_mod` | 0 to 1 | 0 |  | `dial("ringMod", lead, "ringMod")` |
| `ringSpeed` | `ring_speed` | 1 to 5000 | 30 | Hz | `dial("ringSpeed", lead, "ringSpeed")` |
| `ringWave` | `ring_wave` | `"sine"`, `"noise"` | `"sine"` |  | `select("ringWave", lead, "ringWave")` |
| `comb` | `comb` | 0 to 1 | 0 |  | `dial("comb", lead, "comb")` |
| `combTone` | `comb_tone` | 50 to 5000 | 200 | Hz | `dial("combTone", lead, "combTone")` |
| `combFeedback` | `comb_feedback` | -0.97 to 0.97 | 0.7 |  | `dial("combFeedback", lead, "combFeedback")` |
| `flanger` | `flanger` | 0 to 1 | 0 |  | `dial("flanger", lead, "flanger")` |
| `flangerRate` | `flanger_rate` | 0.01 to 10 | 0.3 | Hz | `dial("flangerRate", lead, "flangerRate")` |

## Sends to the shared effects

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `echo` or `delay` | `echo` or `delay` | 0 to 1 | 0 | 1 is as it comes | `dial("echo", lead, "echo")` |
| `reverb` | `reverb` | 0 to 1 | 0 | 1 is as it comes | `dial("reverb", lead, "reverb")` |
| `chorus` | `chorus` | 0 to 1 | 0 | 1 is as it comes | `dial("chorus", lead, "chorus")` |

## The trance gate

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `tranceGateDepth` | `trance_gate_depth` | 0 to 1 | 0 |  | `dial("tranceGateDepth", lead, "tranceGateDepth")` |
| `tranceGateRate` | `trance_gate_rate` | 0.25 to 16 | 4 | steps | `dial("tranceGateRate", lead, "tranceGateRate")` |
| `tranceGateSmooth` | `trance_gate_smooth` | 0.001 to 0.5 | 0.008 | seconds | `dial("tranceGateSmooth", lead, "tranceGateSmooth")` |
| `tranceGateSwing` | `trance_gate_swing` | 0 to 0.75 | 0 |  | `dial("tranceGateSwing", lead, "tranceGateSwing")` |
| `tranceGateSends` | `trance_gate_sends` | `true` or `false` (`True`, `False`) | on |  | `toggle("tranceGateSends", lead, "tranceGateSends")` |
| `tranceGateStereo` | `trance_gate_stereo` | `true` or `false` (`True`, `False`) | off |  | `toggle("tranceGateStereo", lead, "tranceGateStereo")` |

## The synth as a whole

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `volume` | `volume` | 0 to 2 | 1 | 1 is as it comes | `dial("volume", lead, "volume")` |
| `pan` | `pan` | -1 to 1 | 0 | -1 is left, 1 is right | `dial("pan", lead, "pan")` |
| `mode` | `mode` | `"poly"`, `"mono"`, `"legato"` | `"poly"` |  | `select("mode", lead, "mode")` |
| `velocity` | `velocity` | 0 to 1 | 1 |  | `dial("velocity", lead, "velocity")` |
| `panLaw` | `pan_law` | `"equal_power"`, `"square_root"` | `"equal_power"` |  | `select("panLaw", lead, "pan.law")` |

## Shared by every synth

| JavaScript | Python | Values | Starts at | Measured in | A control for it |
|---|---|---|---|---|---|
| `maxVoices` | `max_voices` | 1 to 64, whole numbers | 64 | voices | `set_effects`, not a synth |
| `masterVolume` | `master_volume` | 0 to 2 | 0.35 | 1 is as it comes | `set_effects`, not a synth |
| `limiter` | `limiter` | `true` or `false` (`True`, `False`) | on |  | `set_effects`, not a synth |
| `echoTime` | `echo_time` | 0.001 to 2 | 0.3 | seconds | `set_effects`, not a synth |
| `echoFeedback` | `echo_feedback` | 0 to 0.95 | 0.4 |  | `set_effects`, not a synth |
| `echoTone` | `echo_tone` | 200 to 20000 | 6000 | Hz | `set_effects`, not a synth |
| `echoBounce` | `echo_bounce` | `true` or `false` (`True`, `False`) | off |  | `set_effects`, not a synth |
| `reverbSize` | `reverb_size` | 0 to 1 | 0.5 |  | `set_effects`, not a synth |
| `reverbDamping` | `reverb_damping` | 0 to 1 | 0.4 |  | `set_effects`, not a synth |
| `reverbType` | `reverb_type` | `"room"`, `"hall"`, `"plate"`, `"cathedral"`, `"spring"` | `"room"` |  | `set_effects`, not a synth |
| `reverbDecay` | `reverb_decay` | 0 to 30 | 0 | seconds | `set_effects`, not a synth |
| `reverbPredelay` | `reverb_predelay` | 0 to 0.2 | 0 | seconds | `set_effects`, not a synth |
| `reverbLowCut` | `reverb_low_cut` | 20 to 1000 | 120 | Hz | `set_effects`, not a synth |
| `reverbLevel` | `reverb_level` | 0 to 2 | 1 | 1 is as it comes | `set_effects`, not a synth |
| `echoLevel` | `echo_level` | 0 to 2 | 1 | 1 is as it comes | `set_effects`, not a synth |
| `chorusRate` | `chorus_rate` | 0.05 to 10 | 0.8 | Hz | `set_effects`, not a synth |
| `chorusDepth` | `chorus_depth` | 0 to 1 | 0.5 |  | `set_effects`, not a synth |
| `micGain` | `mic_gain` | 0 to 8 | 1 | 1 is as it comes | `set_effects`, not a synth |
| `micGate` | `mic_gate` | -100 to 0 | -100 | decibels | `set_effects`, not a synth |
| `micGateRelease` | `mic_gate_release` | 0.005 to 2 | 0.15 | seconds | `set_effects`, not a synth |
| `inputPart` | `input_part` | 0 to 63, whole numbers | 31 | a part | `set_effects`, not a synth |
| `inputMonitor` | `input_monitor` | `true` or `false` (`True`, `False`) | on |  | `set_effects`, not a synth |
| `tempo` | `tempo` | 20 to 999 | 120 | beats a minute | `set_effects`, not a synth |

## Also see

- [The README](../README.md): what the settings do, with examples.
- [dials.js](https://github.com/johnwylie70/dials.js): every control, and [Targets](https://github.com/johnwylie70/dials.js#targets), how a control is tied to a synth.
- [pydials](https://github.com/johnwylie70/pydials): the same controls for Python.
