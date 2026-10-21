/** Collapsible sidebar section (native <details>, so it is keyboard accessible for free). */
import { forwardRef, type ReactNode } from 'react';

interface SectionProps {
  id: string;
  title: string;
  /** Short status shown next to the title (e.g. "90 × 90 mm"). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export const Section = forwardRef<HTMLDetailsElement, SectionProps>(function Section(
  { id, title, summary, defaultOpen = false, children },
  ref,
) {
  return (
    <details className="section" id={id} open={defaultOpen} ref={ref}>
      <summary>
        <h2>{title}</h2>
        {summary !== undefined && <span className="section-summary">{summary}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
});

/** A small titled group inside a section. */
export function Group({ title, children, note }: { title?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <fieldset className="group">
      {title && <legend>{title}</legend>}
      {note && <p className="group-note">{note}</p>}
      {children}
    </fieldset>
  );
}
