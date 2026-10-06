# Fritzking

A browser-based circuit sketching tool inspired by [Fritzing](https://fritzing.org). It runs entirely client-side (React + TypeScript + SVG).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Features

- **Breadboard view** with realistic parts and solderless breadboards (half+, full, mini). Parts snap to the 0.1″ grid, and pins pressed into a breadboard connect through its strips. Used strips are highlighted green.
- **Schematic view** with standard symbols. Each part has its own position in each view.
- **Ratsnest lines**: connections made in one view show as dashed lines in the other. Double-click one to turn it into a wire. The status bar tracks routing ("3 of 4 nets routed…").
- **Wires**: drag from any pin or hole to draw one. Drag the middle of a wire to add a bend point, and double-click a bend to remove it. Drag a wire end to reconnect it, or Alt-drag it to branch a new wire. Breadboard wires come in Fritzing's colours.
- **Connector status**: red means unconnected, green means connected. Hovering a pin highlights its whole net and lists what it connects to.
- **DC simulator**: LEDs glow (and burn out without a resistor), motors spin, and buzzers buzz. Click buttons or switches to operate them while simulating, and hover pins to read voltages. It uses modified nodal analysis with piecewise-linear diodes and a switch model for transistors.
- Undo/redo, duplicate, rotate, nudge, marquee and shift selection, autosave to localStorage.
- Save/open `.fzk.json` sketches. Export SVG/PNG of either view, a netlist, or a bill of materials (BOM) as CSV.

## Parts

Breadboards, resistor, ceramic and electrolytic capacitors, diode, NPN transistor, LED, piezo buzzer, DC motor, pushbutton, slide switch, potentiometer, photocell, battery, 555 timer, Arduino Uno.

Parts are plain data plus SVG render functions in `src/parts/`. To add one, define a `PartDef` with pin positions (multiples of `P`) for each view.

## Shortcuts

| Key | Action |
| --- | --- |
| Drag from pin | New wire |
| `R` / `Shift+R` | Rotate selection |
| `⌫` / `Del` | Delete |
| `⌘/Ctrl+D` | Duplicate |
| `⌘/Ctrl+Z`, `⇧⌘Z` | Undo / redo |
| Arrows (`Shift` ×5) | Nudge |
| Scroll / `Space`+drag / middle-drag | Pan |
| `⌘/Ctrl`+scroll, pinch | Zoom |
| `⌘/Ctrl+0` | Fit to window |
| `⌘/Ctrl+1` / `2` | Breadboard / Schematic view |
| `⌘/Ctrl+S` / `O` | Save / open |

## Layout

- `src/types.ts`: data model (parts, wires, part definitions)
- `src/model.ts`: geometry, connectivity (union-find over buses, wires, and coincident pins), ratsnest
- `src/sim.ts`: DC operating-point simulator
- `src/Canvas.tsx`: SVG editor (rendering and all pointer interaction)
- `src/parts/`: part library
- `src/io.ts`: save/load, export, example sketch
