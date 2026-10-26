import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAMP_FAMILIES } from '@forma/core';
import { Viewport } from './Viewport';
import { geometry, type LampMesh } from './geometry';
import { decode, encode, familyDesign, lei, moduleInputs, normalise, RANGES, tierFor, type Design } from './design';
import { BASE_COLORS, FAMILY_UI, PRODUCT_URL, SHADE_COLORS, SIZE_TIERS, WHATSAPP } from './config';

const params = new URLSearchParams(location.search);
const ADMIN = params.get('admin') === '1';

function initialDesign(): Design {
  const fromUrl = params.get('d');
  const decoded = fromUrl ? decode(fromUrl) : null;
  if (decoded) return decoded;
  const fam = params.get('forma');
  return familyDesign(fam && FAMILY_UI[fam] ? fam : 'tulip');
}

/** Small silhouette of a family, drawn from the same curve the geometry uses. */
function Silhouette({ id }: { id: string }) {
  const fam = LAMP_FAMILIES.find((f) => f.id === id)!;
  const w = 40, h = 52;
  const right = fam.curve.map(([r, t]) => [w / 2 + r * (w / 2 - 2), h - 2 - t * (h - 4)] as const);
  const left = [...right].reverse().map(([x, y]) => [w - x, y] as const);
  const d = 'M' + [...right, ...left].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') + ' Z';
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} fill="currentColor" opacity="0.9" /></svg>;
}

function Slider({ label, value, k, onChange, format }: {
  label: string; value: number; k: keyof typeof RANGES; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  const r = RANGES[k];
  const id = `s-${k}`;
  return (
    <div className="slider">
      <div className="slider-top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format ? format(value) : `${value}${r.unit ? ' ' + r.unit : ''}`}</output>
      </div>
      <input id={id} type="range" min={r.min} max={r.max} step={r.step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--p' as string]: `${((value - r.min) / (r.max - r.min)) * 100}%` }} />
    </div>
  );
}

function Swatches({ label, list, value, onPick }: { label: string; list: typeof SHADE_COLORS; value: string; onPick: (id: string) => void }) {
  const cur = list.find((c) => c.id === value);
  return (
    <div className="swatches">
      <div className="slider-top"><span className="lbl">{label}</span><span className="muted">{cur?.name}</span></div>
      <div role="radiogroup" aria-label={label} className="sw-row">
        {list.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={c.id === value} aria-label={c.name} title={c.name}
            className={'sw' + (c.id === value ? ' on' : '')} onClick={() => onPick(c.id)}>
            <span style={{ background: c.translucent ? `linear-gradient(135deg, ${c.hex}, rgba(255,255,255,.55))` : c.hex }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [design, setDesign] = useState<Design>(initialDesign);
  const [mesh, setMesh] = useState<LampMesh | null>(null);
  const [busy, setBusy] = useState(true);
  const [lit, setLit] = useState(false);
  const [spinning, setSpinning] = useState(true);
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState(0);
  const [adminCode, setAdminCode] = useState('');

  const code = useMemo(() => encode(design), [design]);
  const tier = tierFor(design);
  const shade = SHADE_COLORS.find((c) => c.id === design.shade)!;
  const base = BASE_COLORS.find((c) => c.id === design.base)!;

  useEffect(() => { geometry.onMesh((m) => { setMesh(m); setBusy(false); }); }, []);
  useEffect(() => {
    setBusy(true);
    geometry.request(moduleInputs(design, 'preview'));
    const url = new URL(location.href);
    url.searchParams.set('d', code);
    url.searchParams.delete('forma');
    history.replaceState(null, '', url);
  }, [design, code]);

  const set = useCallback(<K extends keyof Design>(k: K, v: Design[K]) => setDesign((d) => normalise({ ...d, [k]: v })), []);
  const pickFamily = (id: string) => setDesign((d) => ({ ...familyDesign(id), ...(d.family === id ? d : {}) }));

  const orderUrl = `${PRODUCT_URL}?marime=${tier.id}&cod=${encodeURIComponent(code)}`;

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  const download = async (format: 'stl' | '3mf' | 'obj') => {
    const bytes = await geometry.exportModel(moduleInputs(design, 'print'), format, code);
    const blob = new Blob([new Uint8Array(bytes)], { type: format === 'stl' ? 'model/stl' : format === 'obj' ? 'model/obj' : 'model/3mf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${code}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const steps = ['Forma', 'Mărimea', 'Textura', 'Culorile'];
  const panelRef = useRef<HTMLDivElement>(null);
  const goStep = (i: number) => { setStep(i); panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <div className={'app' + (lit ? ' night' : '')}>
      <header className="bar glass">
        <a className="brand" href="https://www.artea.ro/" aria-label="Artea, înapoi la magazin">
          <svg width="24" height="24" viewBox="0 0 172 168" aria-hidden="true"><path fill="currentColor" d="M66 166.8C78 161.3 84.7 151.6 88.4 139.5C89.7 135.4 89.9 131.2 89.9 126.9C90.1 115.3 94.4 105.4 103 97.6C108.9 92.2 115.9 89 123.7 87.7C127.2 87.1 130.6 87.2 134 87.3C145.6 87.5 157.2 87.3 168.8 87.3C170.9 87.3 171 87.3 171 89.4C171 101.2 170.9 112.9 171 124.7C171 132.5 169.6 139.9 165.7 146.7C160.9 154.8 154.1 160.5 145.4 164C139.4 166.3 133.2 166.7 127 166.8C106.8 167 86.7 166.8 66.5 166.9C66.4 166.9 66.3 166.9 66.1 166.8H66ZM23.6 87.7C30 87.7 36.3 87.5 42.7 87.7C56.9 88.2 68.2 94.5 75.7 106.4C83.4 118.4 84.2 131.3 78.1 144.3C73.1 155.2 64.5 162.1 53.1 165.4C44.5 167.8 35.9 167.6 27.5 164.2C12.1 158.1 3.6 146.5 1.8 130.2C1 123.2 1.3 116.2 1.3 109.1C1.2 102.5 1.1 95.9 1 89.3C1 88 1.3 87.6 2.6 87.6C9.6 87.7 16.6 87.7 23.6 87.7ZM106.1 1.2C94.1 6.7 87.4 16.4 83.7 28.5C82.5 32.6 82.3 36.8 82.2 41.1C82.1 52.7 77.7 62.6 69.1 70.4C63.3 75.8 56.3 79 48.4 80.3C45 80.9 41.6 80.8 38.1 80.7C26.5 80.5 14.9 80.7 3.3 80.7C1.2 80.7 1.2 80.7 1.2 78.6C1.2 66.8 1.2 55.1 1.2 43.3C1.2 35.5 2.5 28.1 6.5 21.3C11.2 13.2 18 7.5 26.8 4C32.7 1.7 38.9 1.3 45.2 1.2C65.4 1 85.5 1.2 105.6 1.1C105.8 1.1 105.9 1.1 106.1 1.2ZM148.6 80.3C142.2 80.3 135.8 80.5 129.4 80.3C115.2 79.8 104 73.5 96.4 61.6C88.8 49.6 88 36.7 94 23.7C99.1 12.8 107.7 5.9 119.1 2.6C127.7 0.2 136.3 0.4 144.6 3.8C160 9.9 168.6 21.5 170.4 37.8C171.2 44.8 170.8 51.8 170.9 58.9C170.9 65.5 171 72.1 171.2 78.7C171.2 80 170.9 80.4 169.5 80.4C162.6 80.3 155.6 80.3 148.6 80.3Z" /></svg>
          <span>Artea <b>Studio</b></span>
        </a>
        <span className="beta">Beta</span>
        <nav className="bar-links" aria-label="Navigare">
          <a href="https://www.artea.ro/configurator">Modele gata făcute</a>
          <a href={WHATSAPP}>Ajutor</a>
        </nav>
      </header>

      <main className="layout">
        <section className="stage" aria-label="Lampa ta">
          <Viewport mesh={mesh} family={design.family} width={design.width} shade={shade} base={base} lit={lit} spinning={spinning} onInteract={() => setSpinning(false)} />
          <div className="stage-tools">
            <button type="button" className={'pill glass' + (lit ? ' on' : '')} onClick={() => setLit((v) => !v)} aria-pressed={lit}>
              {lit ? 'Aprinsă' : 'Stinsă'}
            </button>
            <button type="button" className="pill glass" onClick={() => setSpinning((v) => !v)} aria-pressed={spinning}>{spinning ? 'Oprește rotirea' : 'Rotește'}</button>
          </div>
          <div className="stage-meta glass" aria-live="polite">
            <span>{design.height} × {design.width} mm</span>
            <span className="dot" />
            <span>Mărimea {tier.label}</span>
            {busy && <span className="spin" aria-label="Se actualizează" />}
          </div>
          {mesh?.error && <div className="stage-error glass" role="alert">Forma asta nu se poate printa: {mesh.error}. Încearcă alte valori.</div>}
        </section>

        <aside className="panel" ref={panelRef}>
          <div className="panel-head">
            <h1>Creează-ți lampa.</h1>
            <p className="muted">Alegi o formă de bază, o modelezi cu glisoarele și o printăm pentru tine.</p>
            <ol className="steps" aria-label="Pași">
              {steps.map((s, i) => (
                <li key={s}><button type="button" className={i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined} onClick={() => goStep(i)}><span>{i + 1}</span>{s}</button></li>
              ))}
            </ol>
          </div>

          {step === 0 && (
            <div className="group" role="radiogroup" aria-label="Forma de bază">
              {LAMP_FAMILIES.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={design.family === f.id}
                  className={'family' + (design.family === f.id ? ' on' : '')} onClick={() => pickFamily(f.id)}>
                  <Silhouette id={f.id} />
                  <span className="fam-txt"><b>{FAMILY_UI[f.id]!.name}</b><span className="muted">{FAMILY_UI[f.id]!.blurb}</span></span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="group">
              <Slider label="Înălțimea abajurului" k="height" value={design.height} onChange={(v) => set('height', v)} />
              <Slider label="Lățimea" k="width" value={design.width} onChange={(v) => set('width', v)} />
              <div className="tiers" aria-label="Mărimi și prețuri">
                {SIZE_TIERS.map((t) => (
                  <div key={t.id} className={'tier' + (t.id === tier.id ? ' on' : '')}>
                    <b>{t.label}</b><span>{lei(t.price)}</span>
                    <small>{t.maxDim === Infinity ? 'peste 210 mm' : `până la ${t.maxDim} mm`}</small>
                  </div>
                ))}
              </div>
              <p className="hint">Mărimea se stabilește după latura cea mai mare. Suportul ({FAMILY_UI[design.family]!.support}) e inclus.</p>
            </div>
          )}

          {step === 2 && (
            <div className="group">
              <Slider label="Nervuri" k="ribs" value={design.ribs} onChange={(v) => set('ribs', v)} format={(v) => (v === 0 ? 'fără' : String(v))} />
              <Slider label="Adâncimea nervurilor" k="ribDepth" value={design.ribDepth} onChange={(v) => set('ribDepth', v)} />
              <Slider label="Valuri" k="waves" value={design.waves} onChange={(v) => set('waves', v)} format={(v) => (v === 0 ? 'fără' : String(v))} />
              <Slider label="Adâncimea valurilor" k="waveDepth" value={design.waveDepth} onChange={(v) => set('waveDepth', v)} />
              <Slider label="Răsucire" k="twist" value={design.twist} onChange={(v) => set('twist', v)} format={(v) => `${v}°`} />
              <button type="button" className="link" onClick={() => setDesign((d) => ({ ...familyDesign(d.family), height: d.height, width: d.width, shade: d.shade, base: d.base }))}>
                Revino la textura {FAMILY_UI[design.family]!.name}
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="group">
              <Swatches label="Abajurul" list={SHADE_COLORS} value={design.shade} onPick={(id) => set('shade', id)} />
              <Swatches label={`Suportul (${FAMILY_UI[design.family]!.support})`} list={BASE_COLORS} value={design.base} onPick={(id) => set('base', id)} />
              <p className="hint">Aprinde lampa din butonul de pe scenă ca să vezi cum trece lumina.</p>
            </div>
          )}

          <div className="nav-steps">
            <button type="button" className="btn ghost" disabled={step === 0} onClick={() => goStep(step - 1)}>Înapoi</button>
            {step < steps.length - 1
              ? <button type="button" className="btn ghost" onClick={() => goStep(step + 1)}>Mai departe: {steps[step + 1]}</button>
              : <span />}
          </div>

          <p className="muted small note">Fiecare lampă din Studio e verificată de noi înainte de printare. Dacă ceva nu se poate printa, te sunăm înainte.</p>

          <div className="summary glass">
            <div className="sum-row">
              <div>
                <div className="price">{lei(tier.price)}</div>
                <div className="muted small">Mărimea {tier.label} · bec inclus · printată în 18–24 h</div>
              </div>
              <a className="btn primary" href={orderUrl}>Comandă lampa</a>
            </div>
            <div className="sum-row small">
              <code title="Codul designului tău">{code}</code>
              <button type="button" className="link" onClick={copyLink}>{copied ? 'Link copiat' : 'Salvează linkul'}</button>
            </div>
          </div>

          {ADMIN && (
            <div className="admin glass">
              <b>Atelier</b>
              <div className="cta">
                <button type="button" className="btn ghost" onClick={() => void download('stl')}>Descarcă STL</button>
                <button type="button" className="btn ghost" onClick={() => void download('3mf')}>Descarcă 3MF</button>
                <button type="button" className="btn ghost" onClick={() => void download('obj')}>Descarcă OBJ</button>
              </div>
              <form className="load" onSubmit={(e) => { e.preventDefault(); const d = decode(adminCode); if (d) setDesign(d); }}>
                <label htmlFor="code-in" className="small">Deschide un cod din comandă</label>
                <input id="code-in" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} placeholder="ART1-…" />
                <button type="submit" className="btn ghost">Deschide</button>
              </form>
              {mesh && <p className="muted small">Material ≈ {Math.round(mesh.volumeCm3)} cm³ · ≈ {Math.round(mesh.volumeCm3 * 1.24)} g PLA · construită în {Math.round(mesh.ms)} ms (previzualizare)</p>}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
