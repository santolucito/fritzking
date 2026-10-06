import type { PartDef } from '../types';
import { breadboards } from './breadboard';
import { components } from './components';

export const PART_DEFS: PartDef[] = [...breadboards, ...components];
export const PARTS: Record<string, PartDef> = Object.fromEntries(PART_DEFS.map((d) => [d.type, d]));
export const CATEGORIES = ['Core', 'Input', 'Output', 'Power', 'ICs', 'Microcontrollers'];

export function getDef(type: string): PartDef {
  const d = PARTS[type];
  if (!d) throw new Error(`Unknown part type: ${type}`);
  return d;
}
