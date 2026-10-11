/**
 * Everything George may want to change without touching the app logic:
 * prices, the shop link and the filament colours on offer.
 */

/** Webflow product the customer is sent to; the size picks the variant, the code goes into the order. */
export const PRODUCT_URL = 'https://www.artea.ro/product/lampa-studio';

/**
 * Size tiers, chosen by the larger of height and width (mm).
 * TODO(George): confirm the prices; these are placeholders.
 */
export const SIZE_TIERS = [
  { id: 's', label: 'S', maxDim: 160, price: 299 },
  { id: 'm', label: 'M', maxDim: 210, price: 399 },
  { id: 'l', label: 'L', maxDim: Infinity, price: 499 },
] as const;
export type SizeTier = (typeof SIZE_TIERS)[number];

export interface Swatch { id: string; name: string; hex: string; translucent?: boolean }

/** Shade filaments, taken from the colours already sold in the shop. */
export const SHADE_COLORS: Swatch[] = [
  { id: 'alb', name: 'Alb', hex: '#f2efe8' },
  { id: 'crem', name: 'Crem', hex: '#e9dcc4' },
  { id: 'translucid', name: 'Translucid', hex: '#ebe9e3', translucent: true },
  { id: 'chihlimbar', name: 'Chihlimbar', hex: '#c9822e', translucent: true },
  { id: 'frost-blue', name: 'Frost Blue', hex: '#22a6d6' },
  { id: 'teracota', name: 'Teracotă', hex: '#b5543a' },
  { id: 'olive', name: 'Olive', hex: '#9fb39a' },
  { id: 'mov', name: 'Mov', hex: '#8a6bbd' },
];

/** Legs and bases. */
export const BASE_COLORS: Swatch[] = [
  { id: 'crem', name: 'Crem', hex: '#e3d6bf' },
  { id: 'portocaliu', name: 'Portocaliu', hex: '#e8803a' },
  { id: 'teracota', name: 'Teracotă', hex: '#b5543a' },
  { id: 'ocru', name: 'Ocru', hex: '#d39a2c' },
  { id: 'cobalt', name: 'Cobalt', hex: '#2f5bd3' },
  { id: 'olive', name: 'Olive', hex: '#a9bfae' },
  { id: 'bej', name: 'Bej', hex: '#d9c6a8' },
  { id: 'negru', name: 'Negru', hex: '#1d1d1d' },
];

/** Romanian names and the default colours per family. */
export const FAMILY_UI: Record<string, { name: string; blurb: string; shade: string; base: string; support: string }> = {
  tulip: { name: 'Tulip', blurb: 'Lacrimă nervurată, pe trepied', shade: 'alb', base: 'portocaliu', support: 'trepied' },
  oli: { name: 'Oli', blurb: 'Cilindru cu nervuri fine, pe patru picioare', shade: 'alb', base: 'crem', support: 'patru picioare' },
  cloud: { name: 'Cloud', blurb: 'Trepte rotunde, pe soclu', shade: 'frost-blue', base: 'negru', support: 'soclu' },
  onda: { name: 'Onda', blurb: 'Forme organice, în valuri', shade: 'alb', base: 'olive', support: 'bază nervurată' },
  lumi: { name: 'Lumi', blurb: 'Cilindru simplu, pe patru picioare', shade: 'alb', base: 'ocru', support: 'patru picioare' },
};

export const WHATSAPP = 'https://wa.me/40746602964';
