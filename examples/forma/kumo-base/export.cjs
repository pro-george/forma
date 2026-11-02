// Replay kumo_commands.json on the live Forma app and download .sc / .3mf / .step.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const cmds = JSON.parse(fs.readFileSync(__dirname + '/kumo_commands.json', 'utf8')).commands;
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'] });
  const ctx = await b.newContext({ acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto('https://studio.artea.ro/forma/?webgl', { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {});
  await p.waitForFunction(() => window.solidcraft && window.solidcraft.execute, null, { timeout: 180000 });
  const X = async (cmd, params) => { const t0 = Date.now(); const r = await p.evaluate(([c, q]) => window.solidcraft.execute(c, q), [cmd, params || {}]); console.log(`✓ ${cmd} (${Date.now() - t0} ms)`); return r; };
  await X('file.new', {});
  for (const c of cmds) await X(c.command, c.params);
  const m = await X('inspect.measure', { body: 'Base' });
  console.log('measure', JSON.stringify(m).slice(0, 300));
  const grab = async (cmd, params, out) => {
    const dl = p.waitForEvent('download', { timeout: 120000 });
    const r = await X(cmd, params);
    console.log(JSON.stringify(r).slice(0, 200));
    const d = await dl; await d.saveAs(__dirname + '/' + out); console.log('saved', out, fs.statSync(__dirname + '/' + out).size);
  };
  for (const [cmd, params, out] of [
    ['file.save_as', { path: '/downloads/KUMO-Base-Cone-Wide-D125-parametric.sc' }, 'KUMO-Base-Cone-Wide-D125-parametric.sc'],
    ['file.export', { path: '/downloads/KUMO-Base-H100.3mf', format: '3mf' }, 'KUMO-Base-H100.3mf'],
    ['file.export', { path: '/downloads/KUMO-Base-H100.step' }, 'KUMO-Base-H100.step'],
    ['file.export', { path: '/downloads/KUMO-Base-H100.stl' }, 'KUMO-Base-H100.stl'],
  ]) { try { await grab(cmd, params, out); } catch (e) { console.log('✗', cmd, e.message.slice(0, 200)); } }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
