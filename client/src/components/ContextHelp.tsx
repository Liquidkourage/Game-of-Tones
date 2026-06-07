import React from 'react';
import { CircleHelp } from 'lucide-react';
import './ContextHelp.css';

type ContextHelpProps = {
  title?: string;
  children: React.ReactNode;
};

/** Compact ? control — full copy lives here, not inline in the UI. */
const ContextHelp: React.FC<ContextHelpProps> = ({ title = 'Help', children }) => (
  <details className="context-help">
    <summary className="context-help__trigger" aria-label={title} title={title}>
      <CircleHelp size={15} aria-hidden />
    </summary>
    <div className="context-help__body">{children}</div>
  </details>
);

export default ContextHelp;
