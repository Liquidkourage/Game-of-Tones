import React from 'react';
import './HostRoundsTabWorkspace.css';

export type HostRoundsTabWorkspaceProps = {
  timeline: React.ReactNode;
  library: React.ReactNode;
  summary: React.ReactNode;
  footer?: React.ReactNode;
  advanced?: React.ReactNode;
};

const HostRoundsTabWorkspace: React.FC<HostRoundsTabWorkspaceProps> = ({
  timeline,
  library,
  summary,
  footer,
  advanced,
}) => {
  return (
    <div className="host-rounds-tab-workspace">
      {timeline}
      <div className="host-rounds-tab-workspace__grid">
        <section className="host-rounds-tab-workspace__library host-glass-panel" aria-label="Playlist library">
          <h3 className="host-rounds-tab-workspace__library-title">Playlist library</h3>
          {library}
        </section>
        <aside className="host-rounds-tab-workspace__aside">{summary}</aside>
      </div>
      {footer ? <div className="host-rounds-tab-workspace__footer">{footer}</div> : null}
      {advanced ? <div className="host-rounds-tab-workspace__advanced">{advanced}</div> : null}
    </div>
  );
};

export default HostRoundsTabWorkspace;
