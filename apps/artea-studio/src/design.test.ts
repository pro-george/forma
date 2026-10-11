import { describe, it, expect } from 'vitest';
import { decode, encode, familyDesign, tierFor, normalise } from './design';

describe('design codes', () => {
  it('round-trips every family, including colour ids with dashes', () => {
    for (const fam of ['tulip', 'oli', 'cloud', 'onda', 'lumi']) {
      const d = familyDesign(fam);
      const back = decode(encode(d));
      expect(back).toEqual(normalise(d));
    }
    const blue = { ...familyDesign('cloud'), shade: 'frost-blue', base: 'negru' };
    expect(encode(blue)).toContain('frost-blue-negru');
    expect(decode(encode(blue))).toEqual(normalise(blue));
  });
  it('keeps decimals and clamps out-of-range values', () => {
    const d = decode('ART1-tulip-999-50-20-25-2-65-30-alb-crem')!;
    expect(d.height).toBe(250);
    expect(d.width).toBe(90);
    expect(d.ribDepth).toBe(2.5);
    expect(d.waveDepth).toBe(6.5);
  });
  it('rejects things that are not a design code', () => {
    expect(decode('hello')).toBeNull();
    expect(decode('ART1-tulip-a-b-c-d-e-f-g-alb-crem')).toBeNull();
    expect(decode('ART1-tulip-200-130-20-25-0-0-0-auriu-crem')).toBeNull();
  });
  it('picks the size tier by the larger dimension', () => {
    expect(tierFor({ ...familyDesign('lumi'), height: 150, width: 110 }).id).toBe('s');
    expect(tierFor({ ...familyDesign('lumi'), height: 150, width: 200 }).id).toBe('m');
    expect(tierFor({ ...familyDesign('tulip'), height: 240, width: 130 }).id).toBe('l');
  });
});
