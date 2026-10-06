import type { ReactNode } from 'react';

/** Grid pitch in canvas units: one breadboard hole spacing (0.1in). */
export const P = 20;

export type ViewId = 'bb' | 'sch';

export interface Pt {
  x: number;
  y: number;
}

export interface Placement {
  x: number;
  y: number;
  rot: number; // 0 | 90 | 180 | 270
}

export interface PartInstance {
  id: string;
  type: string;
  label: string;
  props: Record<string, string>;
  bb: Placement;
  sch: Placement;
}

export interface WireEnd extends Pt {
  attach?: { part: string; conn: string };
}

export interface Wire {
  id: string;
  view: ViewId;
  ends: [WireEnd, WireEnd];
  bends: Pt[];
  color: string;
}

export interface Doc {
  parts: PartInstance[];
  wires: Wire[];
}

export interface PropDef {
  key: string;
  label: string;
  kind: 'select' | 'text' | 'range' | 'bool';
  options?: string[];
  min?: number;
  max?: number;
  default: string;
  /** Shown under the field in the inspector. */
  hint?: string;
}

export interface ConnectorDef {
  id: string;
  name: string;
}

/** Live per-part data passed to renderers (from the simulator). */
export interface PartSimState {
  current?: number; // amps through the part (main path)
  power?: number; // watts
  on?: boolean;
  burnt?: boolean;
  level?: number; // 0..1 generic intensity
  /** Per-tag currents for multi-channel parts (e.g. RGB LED). */
  channels?: Record<string, number>;
}

export interface SimEnv {
  /** Milliseconds since the simulation started. */
  t: number;
}

export interface RenderCtx {
  view: ViewId;
  sim?: PartSimState;
  simulating: boolean;
}

export interface ViewGeom {
  /** Connector positions in local coordinates. Must be integer multiples of P. */
  pins: Record<string, Pt>;
  /** Rotation pivot in local coordinates (multiple of P). */
  pivot: Pt;
  /** Local bounding box of the artwork. */
  bounds: { x: number; y: number; w: number; h: number };
  render: (inst: PartInstance, ctx: RenderCtx) => ReactNode;
}

export type SimElement =
  | { kind: 'R'; a: string; b: string; r: number; tag?: string }
  | { kind: 'V'; p: string; n: string; v: number; r: number; tag?: string }
  | { kind: 'D'; a: string; k: string; vf: number; rs: number; tag?: string }
  | { kind: 'Q'; b: string; c: string; e: string; tag?: string };

export interface PartDef {
  type: string;
  title: string;
  category: string;
  description: string;
  labelPrefix: string;
  props: PropDef[];
  connectors: ConnectorDef[];
  /** Groups of connectors that are internally connected. */
  buses?: string[][];
  bb: ViewGeom;
  sch?: ViewGeom;
  isBreadboard?: boolean;
  /** Short value text shown next to the label in schematic view. */
  valueText?: (inst: PartInstance) => string;
  sim?: (inst: PartInstance, env: SimEnv) => SimElement[];
  /** Interaction while simulating (e.g. pressing a button). */
  simToggle?: { key: string; values: [string, string]; momentary?: boolean };
}
