import { childrenOf, topLevel, type Feature } from '@forma/core';
import { useStore } from '../state/store';
import { Icon, featureIcon } from './icons';
import { onPartContext } from './ContextMenu';

export function Tree() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const results = useStore((s) => s.results);
  const select = useStore((s) => s.select);
  const toggleVisible = useStore((s) => s.toggleVisible);
  const roots = topLevel(doc);

  const row = (f: Feature, child: boolean) => {
    const err = results.get(f.id)?.error;
    return (
      <div
        key={f.id}
        className={`item${selection.includes(f.id) ? ' sel' : ''}${child ? ' child' : ''}${f.visible ? '' : ' hidden'}`}
        onClick={(e) => select([f.id], e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace')}
        onContextMenu={onPartContext(f.id)}
        onDoubleClick={() => { select([f.id]); requestAnimationFrame(() => { const el = document.getElementById('f-name') as HTMLInputElement | null; el?.focus(); el?.select(); }); }}
        title={err ?? f.name}
      >
        {featureIcon(f.type)}
        <span className="nm">{f.name}</span>
        {f.type === 'module' && <span className="badge mod">module</span>}
        {f.role === 'hole' && <span className="badge hole">hole</span>}
        {f.role === 'intersect' && <span className="badge mod">keep</span>}
        {f.repeat && f.repeat.mode !== 'none' && <span className="badge mod">×{f.repeat.mode === 'grid' ? f.repeat.count * f.repeat.count2 : f.repeat.mode === 'mirror' ? 2 : f.repeat.count}</span>}
        {err && <span className="badge err">error</span>}
        {doc.filaments.length > 1 && f.role === 'solid' && !child && <i className="fdot" style={{ background: doc.filaments[f.filament - 1]?.color }} title={`Filament ${f.filament}`} />}
        <button className={`eye${f.visible ? '' : ' off'}`} title={f.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); toggleVisible(f.id); }}><Icon.eye /></button>
      </div>
    );
  };

  return (
    <div className="tree">
      {roots.length === 0 && <div className="empty">Nothing here yet. Use <b>Add</b> in the toolbar, press <b>B</b> for a box, or right-click the ground.</div>}
      {[...roots].reverse().map((f) => (
        <div key={f.id}>
          {row(f, false)}
          {f.type === 'combine' && childrenOf(doc, f.id).map((k) => row(k, true))}
        </div>
      ))}
    </div>
  );
}
