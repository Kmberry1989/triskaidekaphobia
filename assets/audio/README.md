# Building 13 audio map

The runtime keeps the approved music bed `Relay Shaft Ritual.ogg` and layers these short OGG cues through `Floor13Audio`:

| File | Role | Intended moment |
| --- | --- | --- |
| `shaft-ambient.ogg` | low shaft hum and cable resonance | looping under active gameplay |
| `floor-display-tick.ogg` | compact LED relay tick | each floor-display increment |
| `suspense-rise.ogg` | rising restrained tension | the final allowed guess begins |
| `suspense-hold.ogg` | sustained low tension | late-floor and floor 13 suspense |
| `brake-thump.ogg` | damped low arrival impact | the car brakes at the destination |
| `cinematic-sting.ogg` | three-tone copper/metal sting | floors 10–13 story beats and the final reveal |
| `reroute-confirm.ogg` | two-step relay confirmation | one-use REROUTE activation |

All seven cues are local OGG/Vorbis files, stereo, 48 kHz, and short enough to overlap without holding a shared audio element open. The generated cues are file assets only; the browser does not synthesize replacement tones at runtime.

`dreamymelancholypop.ogg` is retained as a user-supplied optional music asset. It is not selected by default; `Relay Shaft Ritual.ogg` remains the primary bed.
