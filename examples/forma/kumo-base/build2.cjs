// KUMO Base Cone Wide D125 — parametric rebuild in Forma (SolidCraft engine) through the browser command API.
const { chromium } = require('playwright');
const fs = require('fs');
const RIBS = process.env.RIBS || '97';            // rib count for this run (the parameter stays editable)
const UNION = process.env.UNION !== '0';          // union the ribs into the base
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(1500000);
  await p.goto('https://studio.artea.ro/forma/?webgl', { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(12000);
  const log = [];
  const X = async (cmd, params) => { const t0 = Date.now(); try { const r = await p.evaluate(([c, q]) => window.solidcraft.execute(c, q), [cmd, params || {}]); const line = `✓ ${cmd} (${Date.now() - t0} ms) ${JSON.stringify(r).slice(0, 200)}`; console.log(line); log.push({ cmd, params, ms: Date.now() - t0, result: r }); return r; } catch (e) { console.log(`✗ ${cmd}:`, e.message.split('\n')[0].slice(0, 300)); throw e; } };
  await X('file.new', { name: 'KUMO Base Cone Wide D125' });
  const P = [
    ['H', '100 mm', 'Cone height — the family is H50…H175', undefined, true],
    ['D_bottom', '185 mm', 'Bottom diameter of the cone, measured at the rib valleys'], ['D_top', '125 mm', 'Top diameter of the cone at the rib valleys (the D125 in the name)'],
    ['bore', '54 mm', 'Through bore'], ['bore_chamfer', '0.5 mm', 'Chamfer at the bottom of the bore'],
    ['neck_d', '62 mm', 'Neck cylinder diameter (the bayonet lugs sit on it)'], ['cap_d', '66 mm', 'Cap diameter where the cone of the cap starts'], ['cap_top_d', '47 mm', 'Cap diameter at the very top'], ['cap_z', '7 mm', 'Height of the neck cylinder above the cone top (the cap underside)'], ['neck_h', '15 mm', 'Total height of neck + cap above the cone'],
    ['hole_top', '42 mm', 'Bore through the cap'], ['top_bore', '44 mm', 'Wider bore at the very top'], ['top_bore_depth', '3 mm', 'Depth of the wider top bore'],
    ['cs_start', '3 mm', 'The 45° countersink from the bore to the cap bore starts this far above the cone top'], ['cs_depth', '6 mm', 'Height of the 45° countersink (bore − hole_top) / 2'],
    ['ribs', RIBS, 'Number of ribs around the cone', ''], ['rib_w', '2.1 mm', 'Rib width'], ['rib_h', '1.05 mm', 'Rib height, measured square to the cone surface'], ['rib_r', '0.55 mm', 'Rib shoulder radius'], ['rib_bite', '0.5 mm', 'How far the rib reaches into the cone, for a clean union'],
    ['pocket_d1', '60 mm', 'Bottom pocket inner diameter'], ['pocket_d2', '77 mm', 'Bottom pocket outer diameter'], ['pocket_depth', '1.5 mm', 'Bottom pocket depth'],
    ['chan_d', '7 mm', 'Cable channel diameter (round part)'], ['chan_z', '5 mm', 'Height of the channel axis above the bottom'], ['chan_slot', '5.5 mm', 'Width of the slot that opens the channel to the bottom'],
    ['lug_t', '2 mm', 'Bayonet lug thickness (neck_d/2 → cap_d/2)'], ['lugs', '4', 'Bayonet lugs', ''], ['lug_a1', '5 deg', 'Lug width at the bottom step'], ['lug_a2', '30 deg', 'Lug width at the middle step'], ['lug_a3', '55 deg', 'Lug width at the top step'], ['lug_z2', '3 mm', 'Middle step starts this far above the cone top'], ['lug_z3', '4.5 mm', 'Top step starts this far above the cone top'],
  ];
  for (const [name, expression, comment, unit, favorite] of P) await X('parameters.add', { name, expression, comment, favorite: !!favorite, ...(unit !== undefined ? { unit } : {}) });

  // 1. the revolved body: profile on YZ (sketch x = world Y = radius, sketch y = world Z)
  await X('sketch.create', { plane: 'YZ' });
  await X('sketch.line', { closed: true, infer: false, points: [
    ['bore / 2 + bore_chamfer', '0'], ['D_bottom / 2', '0'], ['D_top / 2', 'H'], ['neck_d / 2', 'H'], ['neck_d / 2', 'H + cap_z'], ['cap_d / 2', 'H + cap_z'], ['cap_top_d / 2', 'H + neck_h'],
    ['top_bore / 2', 'H + neck_h'], ['top_bore / 2', 'H + neck_h - top_bore_depth'], ['hole_top / 2', 'H + neck_h - top_bore_depth - (top_bore - hole_top) / 2'], ['hole_top / 2', 'H + cs_start + cs_depth'], ['bore / 2', 'H + cs_start'], ['bore / 2', 'bore_chamfer'],
  ] });
  await X('sketch.finish');
  await X('solid.revolve', { axis: 'y', body_name: 'Base' });

  // 2. ribs: one rib swept square to the cone's slant, then patterned around Z and joined
  await X('sketch.create', { plane: 'YZ' });                       // the path: the slant at the rib valleys
  await X('sketch.line', { points: [['D_bottom / 2', '0'], ['D_top / 2', 'H']], infer: false });
  await X('sketch.finish');
  const pathSketch = (await X('document.inspect')).sketches.slice(-1)[0].name;
  await X('construct.plane.along_path', { path: { sketch: pathSketch, curve: 'l1' }, t: 0, name: 'RibPlane' });
  await X('sketch.create', { plane: 'RibPlane' });
  // the plane is square to the slant at its bottom end; its origin is the path start. Which local axis is tangential is probed below.
  const probe = await X('sketch.line', { points: [[0, 0], [5, 0]], infer: false, construction: true });
  await X('sketch.delete', { entities: probe.curves });
  await X('sketch.line', { infer: false, points: [['-rib_w / 2', '-rib_bite'], ['rib_w / 2', '-rib_bite'], ['rib_w / 2', 'rib_h - rib_r']] });
  await X('sketch.arc.center_point', { center: ['rib_w / 2 - rib_r', 'rib_h - rib_r'], start: ['rib_w / 2', 'rib_h - rib_r'], end: ['rib_w / 2 - rib_r', 'rib_h'] });
  await X('sketch.line', { infer: false, points: [['rib_w / 2 - rib_r', 'rib_h'], ['-rib_w / 2 + rib_r', 'rib_h']] });
  await X('sketch.arc.center_point', { center: ['-rib_w / 2 + rib_r', 'rib_h - rib_r'], start: ['-rib_w / 2 + rib_r', 'rib_h'], end: ['-rib_w / 2', 'rib_h - rib_r'] });
  await X('sketch.line', { infer: false, points: [['-rib_w / 2', 'rib_h - rib_r'], ['-rib_w / 2', '-rib_bite']] });
  await X('sketch.finish');
  const ribSketch = (await X('document.inspect')).sketches.slice(-1)[0].name;
  await X('solid.sweep', { sketch: ribSketch, path_sketch: pathSketch, path: ['l1'], orientation: 'perpendicular', body_name: 'Rib' });
  const mrib = await X('inspect.measure', { bodies: ['Rib'] });
  fs.writeFileSync('measure_rib.json', JSON.stringify(mrib, null, 1));
  if (UNION) {
    await X('solid.pattern.circular', { bodies: ['Rib'], axis: 'Z', count: 'ribs' });
    const ribs = (await X('document.inspect')).bodies.map((x) => x.name).filter((n) => n !== 'Base');
    await X('solid.combine', { target: 'Base', tools: ribs, operation: 'join' });
  }

  // 3. bayonet lugs: three stacked sectors on the neck cylinder (5° from the cone top, 30° from +3 mm, 55° from +4.5 mm), ×4 around Z, joined
  const lugStep = async (a, zExpr, hExpr, name) => {
    await X('construct.plane.offset', { base: 'XY', offset: zExpr, name: `${name}Plane` });
    await X('sketch.create', { plane: `${name}Plane` });
    await X('sketch.line', { infer: false, points: [['neck_d / 2 - 0.3 mm', '0'], ['cap_d / 2', '0']] });
    await X('sketch.arc.center_point', { center: [0, 0], start: ['cap_d / 2', '0'], end: [`cap_d / 2 * cos(${a})`, `cap_d / 2 * sin(${a})`] });
    await X('sketch.line', { infer: false, points: [[`cap_d / 2 * cos(${a})`, `cap_d / 2 * sin(${a})`], [`(neck_d / 2 - 0.3 mm) * cos(${a})`, `(neck_d / 2 - 0.3 mm) * sin(${a})`]] });
    await X('sketch.arc.center_point', { center: [0, 0], start: [`(neck_d / 2 - 0.3 mm) * cos(${a})`, `(neck_d / 2 - 0.3 mm) * sin(${a})`], end: ['neck_d / 2 - 0.3 mm', '0'], clockwise: true });
    await X('sketch.finish');
    const r = await X('solid.extrude', { distance: hExpr, operation: 'join', targets: ['Base'] });
    lugFeats.push(r.name);
  };
  const lugFeats = [];
  await lugStep('lug_a1', 'H', 'cap_z', 'LugA');
  await lugStep('lug_a2', 'H + lug_z2', 'cap_z - lug_z2', 'LugB');
  await lugStep('lug_a3', 'H + lug_z3', 'cap_z - lug_z3', 'LugC');
  // the other three lugs: pattern the three extrude features around Z
  await X('solid.pattern.circular', { features: lugFeats, axis: 'Z', count: 'lugs' });

  // 4. bottom pocket: an annulus cut 1.5 mm up from the bottom face
  await X('sketch.create', { plane: 'XY' });
  await X('sketch.circle.center', { center: [0, 0], diameter: 'pocket_d1' });
  await X('sketch.circle.center', { center: [0, 0], diameter: 'pocket_d2' });
  await X('sketch.finish');
  await X('solid.extrude', { distance: 'pocket_depth', operation: 'cut', targets: ['Base'] });

  // 5. cable channel along +Y: a keyhole section (round channel + slot open to the bottom), cut from the bore to the outside
  await X('sketch.create', { plane: 'XZ' });
  // XZ sketch axes: +X and -Z (per sketch.create's docs), so heights are negated
  const zc = 'chan_z - sqrt((chan_d / 2)^2 - (chan_slot / 2)^2)';
  await X('sketch.line', { infer: false, points: [['-chan_slot / 2', '1 mm'], ['chan_slot / 2', '1 mm'], ['chan_slot / 2', `-(${zc})`]] });
  await X('sketch.arc.center_point', { center: ['0', '-chan_z'], start: ['chan_slot / 2', `-(${zc})`], end: ['-chan_slot / 2', `-(${zc})`], clockwise: true });
  await X('sketch.line', { infer: false, points: [['-chan_slot / 2', `-(${zc})`], ['-chan_slot / 2', '1 mm']] });
  await X('sketch.finish');
  const chanFeat = await X('solid.extrude', { distance: 'D_bottom / 2 + 5 mm', operation: 'cut', targets: ['Base'] });

  const m3 = await X('inspect.measure');
  fs.writeFileSync('v2_measure_H100.json', JSON.stringify(m3, null, 1));
  const insp = await X('document.inspect');
  fs.writeFileSync('v2_insp.json', JSON.stringify(insp, null, 1));
  if (process.env.FAMILY) for (const H of ['50 mm', '175 mm']) {
    await X('parameters.change', { name: 'H', expression: H });
    const m = await X('inspect.measure');
    fs.writeFileSync(`v2_measure_${H.replace(' mm', '')}.json`, JSON.stringify(m, null, 1));
  }
  await X('parameters.change', { name: 'H', expression: '100 mm' });
  const script = await X('timeline.export_script');
  fs.writeFileSync('kumo_script.json', JSON.stringify(script, null, 1));
  fs.writeFileSync('build_log.json', JSON.stringify(log, null, 1));
  // try to get the design and a 3MF out of the browser's virtual file system
  try {
    await X('file.save_as', { path: '/kumo.sc' });
    await X('file.export', { path: '/kumo.3mf', format: '3mf' });
    const files = await p.evaluate(async () => { const out = {}; try { const root = await navigator.storage.getDirectory(); for await (const [name, h] of root.entries()) { if (h.kind === 'file') { const f = await h.getFile(); out[name] = f.size; } } } catch (e) { out.err = String(e); } return out; });
    console.log('OPFS files:', JSON.stringify(files));
  } catch (e) { console.log('save/export:', e.message.slice(0, 200)); }
  await b.close();
})();
