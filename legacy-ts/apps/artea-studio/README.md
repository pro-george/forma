# Artea Studio

Customers shape their own lampshade and order it. Lives at **studio.artea.ro**.

- Geometry: the `artea-lamp` module in `@forma/core` (five families: Tulip, Oli, Cloud, Onda, Lumi), built with Manifold in a Web Worker.
- A design is a short code, e.g. `ART1-tulip-220-130-20-25-0-0-0-alb-portocaliu`
  (family-height-width-ribs-ribDepth×10-waves-waveDepth×10-twist-shade-base). It is in the URL (`?d=`), so every design has a link.
- **Comandă lampa** sends the customer to the Webflow product `/product/lampa-studio?marime=s|m|l&cod=<code>`.
- Workshop mode: open `?admin=1` (or `?admin=1&d=<code from an order>`) to download the STL or 3MF of any design.

Things to set before launch, in `src/config.ts`: the S/M/L prices, the shop link and the colours on offer. Socket hole sizes are in `packages/core/src/modules/builtin/lamp.ts` (`SOCKET_HOLE_RADIUS`).

## Develop

    pnpm install
    pnpm --filter @forma/artea-studio dev      # http://localhost:5174
    pnpm --filter @forma/artea-studio test

## Deploy (Cloudflare Pages, free)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → `pro-george/forma`.
2. Build command: `pnpm install && pnpm --filter @forma/artea-studio build`
   Output directory: `apps/artea-studio/dist`
   Environment variable: `NODE_VERSION = 22`
3. Custom domains → add `studio.artea.ro`. Cloudflare shows a CNAME (`studio` → `<project>.pages.dev`); add it where artea.ro's DNS is managed.

Every push to `main` redeploys.
