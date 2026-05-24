import React from 'react';
import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';

export type PreShowCheckItem = {
  id: string;
  label: string;
  ok: boolean;
  warn?: boolean;
  detail?: string;
};

const HostPreShowChecklist: React.FC<{ items: PreShowCheckItem[] }> = ({ items }) => {
  const ready = items.every((i) => i.ok);
  return (
    <section className="host-preshow-checklist host-glass-panel" aria-label="Pre-show checklist">
      <h2 className="host-preshow-checklist__title">Pre-show checklist</h2>
      <ul className="host-preshow-checklist__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={
              item.ok
                ? 'host-preshow-checklist__item host-preshow-checklist__item--ok'
                : item.warn
                  ? 'host-preshow-checklist__item host-preshow-checklist__item--warn'
                  : 'host-preshow-checklist__item'
            }
          >
            {item.ok ? (
              <CheckCircle2 className="host-preshow-checklist__icon" aria-hidden />
            ) : item.warn ? (
              <AlertTriangle className="host-preshow-checklist__icon host-preshow-checklist__icon--warn" aria-hidden />
            ) : (
              <Circle className="host-preshow-checklist__icon" aria-hidden />
            )}
            <div>
              <span>{item.label}</span>
              {item.detail ? <span className="host-preshow-checklist__detail">{item.detail}</span> : null}
            </div>
          </li>
        ))}
      </ul>
      <p className={`host-preshow-checklist__summary${ready ? ' host-preshow-checklist__summary--ready' : ''}`}>
        {ready ? 'Ready to go live from the Game tab.' : 'Complete the items above, then start from Game.'}
      </p>
    </section>
  );
};

export default HostPreShowChecklist;
