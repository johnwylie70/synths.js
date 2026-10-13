// synths.js: sounds and music in plain JavaScript.
//
// This file is the page's half. It starts the audio worklet, loads the engine
// (synths-core, as WebAssembly) into it, and sends it commands. The sound
// itself is worked out on the audio thread, never here.

export const version = "0.0.0"
