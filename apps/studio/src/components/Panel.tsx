import { useUI, type PanelId } from '../state/ui';

/**
 * Floating glass panel. Collapsing it leaves a small pill tab on the same
 * edge, so the viewport gets the space back without losing the panel.
 */
export function Panel({ id, title, side, children, badge }: { id: PanelId; title: string; side: 'left' | 'right'; children: React.ReactNode; badge?: React.ReactNode }) {
  const collapsed = useUI((s) => s.collapsed[id]);
  const toggle = useUI((s) => s.toggle);
  if (collapsed) {
    return (
      <button className={`panel-tab ${side}`} onClick={() => toggle(id)} title={`Show ${title}`}>
        <span>{title}</span>{badge}
      </button>
    );
  }
  return (
    <section className={`panel ${side} panel-${id}`} aria-label={title}>
      <header className="panel-head" onDoubleClick={() => toggle(id)}>
        <span className="panel-title">{title}{badge}</span>
        <button className="panel-collapse" onClick={() => toggle(id)} title={`Collapse ${title}`} aria-label={`Collapse ${title}`}>
          <svg viewBox="0 0 16 16" width="14" height="14"><path d={side === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
