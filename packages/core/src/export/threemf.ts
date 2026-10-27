import { zipSync, strToU8 } from 'fflate';
import type { TriangleMesh, Filament } from '../document/types.js';

export interface ThreeMFObject {
  name: string;
  mesh: TriangleMesh;
  /** 1-based filament / AMS slot (slicer "extruder"); defaults to 1 */
  filament?: number;
}

export interface ThreeMFOptions {
  /**
   * `parts`: every object becomes a part of ONE slicer object, so a
   * multi-colour print (body + lettering in another filament) keeps its parts
   * glued together and slices as a single multi-material object.
   * `objects`: one independent slicer object per entry, free to arrange.
   */
  layout?: 'parts' | 'objects';
  /** filament palette; index + 1 is the slot number parts refer to */
  filaments?: Filament[];
  /**
   * Also embed colours as standard 3MF material groups (`m:colorgroup`).
   * PrusaSlicer/Cura show them; Bambu Studio and Orca open a colour-mapping
   * dialog on import, which the slot assignment already makes unnecessary —
   * so leave it off for Bambu-targeted files.
   */
  colors?: boolean;
}

const MATERIAL_NS = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const BAMBU_NS = 'http://schemas.bambulab.com/package/2021';
const f = (n: number) => (Math.round(n * 10000) / 10000).toString();
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

/**
 * 3MF (3D Manufacturing Format) writer, millimetres, Z up.
 *
 * Beyond the core spec it writes the two per-part config files slicers read
 * so every part lands in the right filament slot without any clicking:
 *  - `Metadata/model_settings.config` — Bambu Studio / Orca Slicer. Mirrors
 *    `_BBS_3MF_Exporter::_add_model_config_file_to_archive` in
 *    bambulab/BambuStudio `src/libslic3r/Format/bbs_3mf.cpp`: an `<object>`
 *    with `<part id subtype="normal_part">` entries whose
 *    `<metadata key="extruder" value="N"/>` goes straight into the part's
 *    config on import (`_generate_volumes_new`). Bambu Studio adds AMS slots
 *    up to the highest extruder it finds ("add extruder for ... Other model
 *    if only import geometry" in `Plater::priv::load_files`).
 *  - `Metadata/Slic3r_PE_model.config` — PrusaSlicer (same idea, older keys).
 *
 * The `Application` metadata deliberately names Forma: Bambu treats the file
 * as a third-party 3MF ("load geometry data"), which is exactly the path that
 * honours per-part extruders without expecting a full project profile.
 */
export function to3MF(objects: ThreeMFObject[], title = 'Forma model', opts: ThreeMFOptions = {}): Uint8Array {
  const layout = opts.layout ?? (objects.length > 1 && new Set(objects.map((o) => o.filament ?? 1)).size > 1 ? 'parts' : 'objects');
  const filaments = opts.filaments ?? [];
  const withColors = opts.colors === true && filaments.length > 0;
  const slotOf = (o: ThreeMFObject) => Math.max(1, Math.min(16, Math.round(o.filament ?? 1)));
  const colorOf = (slot: number) => filaments[slot - 1]?.color ?? '#e8e4dc';

  // ids: 1..N meshes, then N+1 the assembly object (parts layout), colour groups after
  const meshId = (i: number) => i + 1;
  const assemblyId = objects.length + 1;
  let nextId = assemblyId + 1;
  const colorGroupIds = new Map<number, number>();
  if (withColors) for (const o of objects) { const s = slotOf(o); if (!colorGroupIds.has(s)) colorGroupIds.set(s, nextId++); }

  const m: string[] = [];
  m.push('<?xml version="1.0" encoding="UTF-8"?>');
  m.push(`<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="${BAMBU_NS}"${withColors ? ` xmlns:m="${MATERIAL_NS}"` : ''}>`);
  const date = new Date().toISOString().slice(0, 10);
  m.push(`<metadata name="Application">Forma</metadata><metadata name="Title">${esc(title)}</metadata><metadata name="CreationDate">${date}</metadata><metadata name="ModificationDate">${date}</metadata>`);
  m.push('<resources>');
  if (withColors) for (const [slot, id] of colorGroupIds) m.push(`<m:colorgroup id="${id}"><m:color color="${colorOf(slot)}"/></m:colorgroup>`);
  objects.forEach((o, i) => {
    const p = o.mesh.positions, idx = o.mesh.indices;
    const v: string[] = [];
    for (let k = 0; k < p.length; k += 3) v.push(`<vertex x="${f(p[k]!)}" y="${f(p[k + 1]!)}" z="${f(p[k + 2]!)}"/>`);
    const t: string[] = [];
    for (let k = 0; k < idx.length; k += 3) t.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`);
    const color = withColors ? ` pid="${colorGroupIds.get(slotOf(o))}" pindex="0"` : '';
    m.push(`<object id="${meshId(i)}" name="${esc(o.name)}" type="model"${color}><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`);
  });
  if (layout === 'parts') {
    m.push(`<object id="${assemblyId}" name="${esc(title)}" type="model"><components>`);
    objects.forEach((_, i) => m.push(`<component objectid="${meshId(i)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`));
    m.push('</components></object>');
  }
  m.push('</resources><build>');
  if (layout === 'parts') m.push(`<item objectid="${assemblyId}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>`);
  else objects.forEach((_, i) => m.push(`<item objectid="${meshId(i)}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>`));
  m.push('</build></model>');

  // Bambu Studio / Orca: Metadata/model_settings.config
  const b: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  const part = (o: ThreeMFObject, id: number) => [
    `    <part id="${id}" subtype="normal_part">`,
    `      <metadata key="name" value="${esc(o.name)}"/>`,
    `      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>`,
    `      <metadata key="extruder" value="${slotOf(o)}"/>`,
    `      <mesh_stat face_count="${o.mesh.indices.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>`,
    '    </part>',
  ].join('\n');
  if (layout === 'parts') {
    b.push(`  <object id="${assemblyId}">`, `    <metadata key="name" value="${esc(title)}"/>`, `    <metadata key="extruder" value="${objects[0] ? slotOf(objects[0]) : 1}"/>`);
    objects.forEach((o, i) => b.push(part(o, meshId(i))));
    b.push('  </object>');
  } else {
    objects.forEach((o, i) => b.push(`  <object id="${meshId(i)}">`, `    <metadata key="name" value="${esc(o.name)}"/>`, `    <metadata key="extruder" value="${slotOf(o)}"/>`, part(o, meshId(i)), '  </object>'));
  }
  b.push('</config>');

  // PrusaSlicer: Metadata/Slic3r_PE_model.config (volumes addressed by triangle ranges inside one object)
  const pr: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  const prusaVolume = (o: ThreeMFObject, first: number, last: number) =>
    `    <volume firstid="${first}" lastid="${last}">\n      <metadata type="volume" key="name" value="${esc(o.name)}"/>\n      <metadata type="volume" key="volume_type" value="ModelPart"/>\n      <metadata type="volume" key="extruder" value="${slotOf(o)}"/>\n    </volume>`;
  if (layout === 'parts') {
    pr.push(`  <object id="${assemblyId}" instances_count="1">`, `    <metadata type="object" key="name" value="${esc(title)}"/>`);
    // PrusaSlicer flattens components into one mesh, so ranges run on across parts
    let first = 0;
    for (const o of objects) { const n = o.mesh.indices.length / 3; pr.push(prusaVolume(o, first, first + n - 1)); first += n; }
    pr.push('  </object>');
  } else {
    objects.forEach((o, i) => pr.push(`  <object id="${meshId(i)}" instances_count="1">`, `    <metadata type="object" key="name" value="${esc(o.name)}"/>`, `    <metadata type="object" key="extruder" value="${slotOf(o)}"/>`, prusaVolume(o, 0, o.mesh.indices.length / 3 - 1), '  </object>'));
  }
  pr.push('</config>');

  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(m.join('\n')),
    'Metadata/model_settings.config': strToU8(b.join('\n')),
    'Metadata/Slic3r_PE_model.config': strToU8(pr.join('\n')),
  }, { level: 6 });
}
