import React from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ListMusic, Settings2, Play } from 'lucide-react';
import './HostSetupFlow.css';

export type HostSetupStep = 'playlist' | 'criteria' | 'play';

const STEPS: Array<{ id: HostSetupStep; label: string; icon: React.ReactNode }> = [
  { id: 'playlist', label: 'Build rounds', icon: <ListMusic aria-hidden /> },
  { id: 'criteria', label: 'Card setup', icon: <Settings2 aria-hidden /> },
  { id: 'play', label: 'Play game', icon: <Play aria-hidden /> },
];

export type HostSetupFlowProps = {
  step: HostSetupStep;
  onStepChange: (step: HostSetupStep) => void;
  playlistReady: boolean;
  criteriaReady: boolean;
  playReady: boolean;
  children: React.ReactNode;
};

const HostSetupFlow: React.FC<HostSetupFlowProps> = ({
  step,
  onStepChange,
  playlistReady,
  criteriaReady,
  playReady,
  children,
}) => {
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canGoBack = stepIndex > 0;
  const canGoNext =
    step === 'playlist' ? playlistReady : step === 'criteria' ? criteriaReady : false;
  const nextBlockedReason =
    step === 'playlist' && !playlistReady
      ? 'Add at least one playlist to continue.'
      : step === 'criteria' && !criteriaReady
        ? 'Finish card setup to continue.'
        : null;

  const stepStatus = (id: HostSetupStep): 'complete' | 'current' | 'upcoming' => {
    const idx = STEPS.findIndex((s) => s.id === id);
    if (idx < stepIndex) return 'complete';
    if (idx === stepIndex) return 'current';
    return 'upcoming';
  };

  const goToStep = (id: HostSetupStep) => {
    if (id === 'criteria' && !playlistReady) return;
    if (id === 'play' && !criteriaReady) return;
    onStepChange(id);
  };

  return (
    <div className="host-setup-flow">
      <nav className="host-setup-flow__stepper host-glass-panel" aria-label="Game setup steps">
        <ol className="host-setup-flow__steps">
          {STEPS.map((item, idx) => {
            const status = stepStatus(item.id);
            const disabled =
              (item.id === 'criteria' && !playlistReady) || (item.id === 'play' && !criteriaReady);
            return (
              <li key={item.id} className={`host-setup-flow__step host-setup-flow__step--${status}`}>
                {idx > 0 ? <span className="host-setup-flow__connector" aria-hidden /> : null}
                <button
                  type="button"
                  className="host-setup-flow__step-btn"
                  onClick={() => goToStep(item.id)}
                  disabled={disabled}
                  aria-current={status === 'current' ? 'step' : undefined}
                >
                  <span className="host-setup-flow__step-icon">
                    {status === 'complete' ? <CheckCircle2 aria-hidden /> : item.icon}
                  </span>
                  <span className="host-setup-flow__step-label">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="host-setup-flow__panel host-glass-panel">{children}</div>

      <div className="host-setup-flow__nav">
        {canGoBack ? (
          <button
            type="button"
            className="btn-secondary host-setup-flow__nav-btn"
            onClick={() => onStepChange(STEPS[stepIndex - 1].id)}
          >
            <ChevronLeft className="w-4 h-4" aria-hidden />
            Back
          </button>
        ) : (
          <span />
        )}
        {step !== 'play' ? (
          <span className="host-setup-flow__nav-next">
            {nextBlockedReason ? (
              <span className="host-setup-flow__nav-reason" role="status">
                {nextBlockedReason}
              </span>
            ) : null}
            <button
              type="button"
              className="btn-primary host-setup-flow__nav-btn"
              onClick={() => onStepChange(STEPS[stepIndex + 1].id)}
              disabled={!canGoNext}
              title={nextBlockedReason || undefined}
            >
              Next
              <ChevronRight className="w-4 h-4" aria-hidden />
            </button>
          </span>
        ) : playReady ? (
          <span className="host-setup-flow__ready-hint">
            <CheckCircle2 className="w-4 h-4" aria-hidden />
            Ready to start
          </span>
        ) : (
          <span className="host-setup-flow__ready-hint host-setup-flow__ready-hint--muted">
            <Circle className="w-4 h-4" aria-hidden />
            Build the song pool to start
          </span>
        )}
      </div>
    </div>
  );
};

export default HostSetupFlow;
