import { childrenOf, topLevel, type Feature } from '@forma/core';
import { useStore } from '../state/store';
import { Icon, featureIcon } from './icons';

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
        title={err ?? f.name}
      >
        {featureIcon(f.type)}
        <span className="nm">{f.name}</span>
        {f.type === 'module' && <span className="badge mod">module</span>}
        {f.role === 'hole' && <span className="badge hole">hole</span>}
        {err && <span className="badge err">error</span>}
        <button className={`eye${f.visible ? '' : ' off'}`} title={f.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); toggleVisible(f.id); }}><Icon.eye /></button>
      </div>
    );
  };

  return (
    <div className="tree">
      <h3>Parts</h3>
      {roots.length === 0 && <div className="empty">Nothing here yet. Add a primitive or a module from the left, or draw a sketch and extrude it.</div>}
      {[...roots].reverse().map((f) => (
        <div key={f.id}>
          {row(f, false)}
          {f.type === 'combine' && childrenOf(doc, f.id).map((k) => row(k, true))}
        </div>
      ))}
    </div>
  );
}
