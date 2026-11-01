/**
 * A customer's design: the lampshade module inputs plus the two colours.
 *
 * It travels as a short, human-readable code so George can read it in an
 * order and reopen the exact lamp:  ART1-tulip-220-130-20-25-0-0-0-alb-portocaliu
 *   family-height-width-ribs-ribDepth×10-waves-waveDepth×10-twist-shade-base
 */
import { LAMP_FAMILIES, lampshadeModule, familyInputs } from '@forma/core';
import { SIZE_TIERS, SHADE_COLORS, BASE_COLORS, FAMILY_UI, type SizeTier } from './config';

export interface Design {
  family: string;
  height: number;
  width: number;
  ribs: number;
  ribDepth: number;
  waves: number;
  waveDepth: number;
  twist: number;
  shade: string;
  base: string;
}

const PREFIX = 'ART1';

type NumKey = 'height' | 'width' | 'ribs' | 'ribDepth' | 'waves' | 'waveDepth' | 'twist';
export const RANGES = Object.fromEntries(
  lampshadeModule.inputs.filter((i) => i.type === 'number').map((i) => [i.key, i]),
) as unknown as Record<NumKey | 'wall', { min: number; max: number; step: number; unit?: string }>;

const clampTo = (k: NumKey, v: number) => {
  const r = RANGES[k];
  const stepped = Math.round(v / r.step) * r.step;
  return Math.min(r.max, Math.max(r.min, Number(stepped.toFixed(2))));
};

export function familyDesign(id: string): Design {
  const inp = familyInputs(id);
  const ui = FAMILY_UI[String(inp.family)]!;
  return {
    family: String(inp.family), height: Number(inp.height), width: Number(inp.width), ribs: Number(inp.ribs),
    ribDepth: Number(inp.ribDepth), waves: Number(inp.waves), waveDepth: Number(inp.waveDepth), twist: Number(inp.twist),
    shade: ui.shade, base: ui.base,
  };
}

export function normalise(d: Design): Design {
  const fam = LAMP_FAMILIES.some((f) => f.id === d.family) ? d.family : 'tulip';
  return {
    family: fam,
    height: clampTo('height', d.height), width: clampTo('width', d.width), ribs: clampTo('ribs', d.ribs),
    ribDepth: clampTo('ribDepth', d.ribDepth), waves: clampTo('waves', d.waves), waveDepth: clampTo('waveDepth', d.waveDepth),
    twist: clampTo('twist', d.twist),
    shade: SHADE_COLORS.some((c) => c.id === d.shade) ? d.shade : SHADE_COLORS[0]!.id,
    base: BASE_COLORS.some((c) => c.id === d.base) ? d.base : BASE_COLORS[0]!.id,
  };
}

export function encode(d: Design): string {
  const n = normalise(d);
  return [PREFIX, n.family, n.height, n.width, n.ribs, Math.round(n.ribDepth * 10), n.waves, Math.round(n.waveDepth * 10), n.twist, n.shade, n.base].join('-');
}

/** Parse a design code; returns null when it is not one. Values are clamped to what the printer allows. */
export function decode(code: string): Design | null {
  const parts = code.trim().split('-');
  if (parts[0] !== PREFIX || parts.length < 11) return null;
  // colour ids can contain '-' (frost-blue): the 8 numbers sit at fixed positions, colours take the rest
  const [, family, h, w, ribs, rd, waves, wd, twist, ...rest] = parts;
  const nums = [h, w, ribs, rd, waves, wd, twist].map(Number);
  if (nums.some((x) => !Number.isFinite(x))) return null;
  const colours = rest.join('-');
  const shade = SHADE_COLORS.map((c) => c.id).sort((a, b) => b.length - a.length).find((id) => colours.startsWith(id + '-'));
  const base = shade ? colours.slice(shade.length + 1) : '';
  if (!shade || !BASE_COLORS.some((c) => c.id === base)) return null;
  return normalise({
    family: family!, height: nums[0]!, width: nums[1]!, ribs: nums[2]!, ribDepth: nums[3]! / 10,
    waves: nums[4]!, waveDepth: nums[5]! / 10, twist: nums[6]!, shade, base,
  });
}

export function tierFor(d: Design): SizeTier {
  const dim = Math.max(d.height, d.width);
  return SIZE_TIERS.find((t) => dim <= t.maxDim) ?? SIZE_TIERS[SIZE_TIERS.length - 1]!;
}

/** Module inputs for the geometry worker. */
export function moduleInputs(d: Design, detail: 'preview' | 'print'): Record<string, string | number> {
  const n = normalise(d);
  return { family: n.family, height: n.height, width: n.width, ribs: n.ribs, ribDepth: n.ribDepth, waves: n.waves, waveDepth: n.waveDepth, twist: n.twist, wall: 1.6, socket: 'family', detail };
}

export const lei = (n: number) => `${n.toLocaleString('ro-RO')} lei`;
