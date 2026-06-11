import React from 'react';
import HostSetupStatusStrip, { type HostSetupStatusStripProps } from './HostSetupStatusStrip';
import HostRoundTimeline, { type RoundTimelineRow } from './HostRoundTimeline';
import HostSetupFlow, { type HostSetupStep } from './HostSetupFlow';
import './HostSetupCockpit.css';

export type HostSetupCockpitProps = {
  status: HostSetupStatusStripProps;
  rounds: RoundTimelineRow[];
  roundSummary?: string;
  roundsEmptyHint?: string;
  onSelectRound: (index: number) => void;
  step: HostSetupStep;
  onStepChange: (step: HostSetupStep) => void;
  playlistReady: boolean;
  playlistBlockedReason?: string | null;
  criteriaReady: boolean;
  playReady: boolean;
  children: React.ReactNode;
};

const HostSetupCockpit: React.FC<HostSetupCockpitProps> = ({
  status,
  rounds,
  roundSummary,
  roundsEmptyHint,
  onSelectRound,
  step,
  onStepChange,
  playlistReady,
  playlistBlockedReason,
  criteriaReady,
  playReady,
  children,
}) => {
  return (
    <div className="host-setup-cockpit">
      <HostSetupStatusStrip {...status} />
      <div data-host-tutorial="next-round">
        <HostRoundTimeline
          className="host-round-timeline--cockpit"
          rounds={rounds}
          summary={roundSummary}
          emptyHint={roundsEmptyHint}
          onSelectRound={onSelectRound}
        />
      </div>
      <HostSetupFlow
        step={step}
        onStepChange={onStepChange}
        playlistReady={playlistReady}
        playlistBlockedReason={playlistBlockedReason}
        criteriaReady={criteriaReady}
        playReady={playReady}
      >
        {children}
      </HostSetupFlow>
    </div>
  );
};

export default HostSetupCockpit;
