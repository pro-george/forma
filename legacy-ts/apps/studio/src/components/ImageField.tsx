import { useEffect, useRef, useState } from 'react';
import { decodeHeightMap, encodeHeightMap, rasterToHeightMap, HEIGHTMAP_MAX_SIDE } from '@forma/core';

/**
 * Picture input for modules: accepts SVG / PNG / JPG, turns it into a
 * height map ("ink" = dark × opaque) and stores it as one compact string.
 * The thumbnail is drawn back from that string, so it survives reloads.
 */
export function ImageField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      onChange(await fileToHeightMap(file));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="imagefield"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void load(f); }}>
      <HeightMapThumb map={value} />
      <div className="imagefield-actions">
        <button id={id} type="button" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Reading…' : value ? 'Replace' : 'Upload'}</button>
        {value && <button type="button" className="ghost" onClick={() => onChange('')}>Clear</button>}
        <input ref={fileRef} type="file" accept=".svg,.png,.jpg,.jpeg,.webp,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }} />
      </div>
      {err && <div className="note err">{err}</div>}
    </div>
  );
}

function HeightMapThumb({ map }: { map: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const hm = decodeHeightMap(map);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!hm) return;
    const img = ctx.createImageData(hm.width, hm.height);
    for (let i = 0; i < hm.data.length; i++) {
      const v = hm.data[i]!;
      img.data[i * 4] = 240; img.data[i * 4 + 1] = 240; img.data[i * 4 + 2] = 240; img.data[i * 4 + 3] = v;
    }
    const off = document.createElement('canvas');
    off.width = hm.width; off.height = hm.height;
    off.getContext('2d')!.putImageData(img, 0, 0);
    const s = Math.min(c.width / hm.width, c.height / hm.height);
    const w = hm.width * s, h = hm.height * s;
    ctx.drawImage(off, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }, [map]);
  return <canvas ref={ref} width={56} height={56} className="imagefield-thumb" title={map ? 'Raised areas are light' : 'No picture'} />;
}

/** Rasterise a picture file to a height map string. Dark and opaque pixels become height. */
export async function fileToHeightMap(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url, file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg'));
    // draw at up to 2× the stored size so the box filter has something to average
    const target = HEIGHTMAP_MAX_SIDE * 2;
    const scale = Math.min(1, target / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available');
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const data = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 4]!, g = px[i * 4 + 1]!, b = px[i * 4 + 2]!, a = px[i * 4 + 3]! / 255;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      data[i] = a * (1 - lum);
    }
    return encodeHeightMap(rasterToHeightMap({ data, width: w, height: h }, HEIGHTMAP_MAX_SIDE));
  } finally { URL.revokeObjectURL(url); }
}

function loadImage(url: string, isSvg: boolean): Promise<{ width: number; height: number } & CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // an SVG without width/height reports 0×0 in some browsers; give it a sensible canvas size
      const width = img.naturalWidth || (isSvg ? 512 : 0), height = img.naturalHeight || (isSvg ? 512 : 0);
      if (!width || !height) { reject(new Error('Could not read that picture')); return; }
      if (!img.naturalWidth) { img.width = width; img.height = height; }
      resolve(Object.assign(img, { width, height }));
    };
    img.onerror = () => reject(new Error('Could not read that picture (is it a valid SVG/PNG/JPG?)'));
    img.src = url;
  });
}
