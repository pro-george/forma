import { zipSync, strToU8 } from 'fflate';
import type { TriangleMesh } from '../document/types.js';

export interface ThreeMFObject { name: string; mesh: TriangleMesh; }

/**
 * Minimal 3MF (3D Manufacturing Format) writer: one object per mesh, all in
 * one build, millimetres, Z up. Opens in PrusaSlicer, Bambu Studio, Cura.
 */
export function to3MF(objects: ThreeMFObject[], title = 'Forma model'): Uint8Array {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  parts.push(`<metadata name="Title">${esc(title)}</metadata><metadata name="Application">Forma</metadata>`);
  parts.push('<resources>');
  objects.forEach((o, i) => {
    const p = o.mesh.positions, idx = o.mesh.indices;
    const v: string[] = [];
    for (let k = 0; k < p.length; k += 3) v.push(`<vertex x="${f(p[k]!)}" y="${f(p[k + 1]!)}" z="${f(p[k + 2]!)}"/>`);
    const t: string[] = [];
    for (let k = 0; k < idx.length; k += 3) t.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`);
    parts.push(`<object id="${i + 1}" name="${esc(o.name)}" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`);
  });
  parts.push('</resources><build>');
  objects.forEach((_, i) => parts.push(`<item objectid="${i + 1}"/>`));
  parts.push('</build></model>');
  const model = parts.join('');
  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  }, { level: 6 });
}

const f = (n: number) => (Math.round(n * 10000) / 10000).toString();
