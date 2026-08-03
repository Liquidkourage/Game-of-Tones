import React, { useState, useEffect } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { resolveCustomPatternMask, saveCustomPattern, validatePatternPositions } from '../patternDefinitions';
import HostSubmodalPortal from './HostSubmodalPortal';
import './CustomPatternModal.css';

export interface CustomPatternSavePayload {
  name: string;
  positions: string[];
  matchReverse?: boolean;
  matchAllowRotation?: boolean;
  matchAllowMirror?: boolean;
}

interface CustomPatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (pattern: CustomPatternSavePayload) => void;
  initialPattern?: CustomPatternSavePayload;
}

const CustomPatternModal: React.FC<CustomPatternModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialPattern,
}) => {
  const [patternName, setPatternName] = useState('');
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [matchReverse, setMatchReverse] = useState(false);
  const [matchAllowRotation, setMatchAllowRotation] = useState(false);
  const [matchAllowMirror, setMatchAllowMirror] = useState(false);
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialPattern) {
        setPatternName(initialPattern.name);
        setSelectedPositions(initialPattern.positions);
        setMatchReverse(initialPattern.matchReverse === true);
        setMatchAllowRotation(initialPattern.matchAllowRotation === true);
        setMatchAllowMirror(initialPattern.matchAllowMirror === true);
      } else {
        setPatternName('');
        setSelectedPositions([]);
        setMatchReverse(false);
        setMatchAllowRotation(false);
        setMatchAllowMirror(false);
      }
    }
  }, [isOpen, initialPattern]);

  useEffect(() => {
    const effectivePositions = resolveCustomPatternMask(selectedPositions, matchReverse);
    setIsValid(
      patternName.trim().length > 0 &&
        selectedPositions.length > 0 &&
        effectivePositions.length > 0 &&
        validatePatternPositions(selectedPositions),
    );
  }, [patternName, selectedPositions, matchReverse]);

  const togglePosition = (row: number, col: number) => {
    const position = `${row}-${col}`;
    setSelectedPositions((prev) =>
      prev.includes(position) ? prev.filter((p) => p !== position) : [...prev, position],
    );
  };

  const handleSave = () => {
    if (isValid) {
      onSave({
        name: patternName.trim(),
        positions: selectedPositions,
        ...(matchReverse ? { matchReverse: true as const } : {}),
        ...(matchAllowRotation ? { matchAllowRotation: true as const } : {}),
        ...(matchAllowMirror ? { matchAllowMirror: true as const } : {}),
      });
      onClose();
    }
  };

  const handleClear = () => {
    setSelectedPositions([]);
  };

  if (!isOpen) return null;

  const modalTitle = initialPattern ? 'Edit custom pattern' : 'Create custom pattern';
  const displayedPositions = resolveCustomPatternMask(selectedPositions, matchReverse);

  return (
    <HostSubmodalPortal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      titleId="host-custom-pattern-title"
      maxWidth="520px"
    >
      <div className="host-ui host-custom-pattern">
        <div className="host-custom-pattern__field">
          <label className="host-custom-pattern__field-label" htmlFor="host-custom-pattern-name">
            Pattern name
          </label>
          <input
            id="host-custom-pattern-name"
            type="text"
            className="host-field-text host-custom-pattern__field-text--full"
            value={patternName}
            onChange={(e) => setPatternName(e.target.value)}
            placeholder="Enter pattern name…"
          />
        </div>

        <div className="host-custom-pattern__field host-custom-pattern__grid-field">
          <div className="host-custom-pattern__grid-header">
            <span className="host-custom-pattern__field-label">Select pattern squares</span>
            <div className="host-custom-pattern__grid-actions">
              <button type="button" className="btn-danger-outline host-btn--sm" onClick={handleClear}>
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
                Clear grid
              </button>
            </div>
          </div>

          <div className="host-custom-pattern__variants">
            <label className="host-check-row">
              <input
                type="checkbox"
                className="host-control-checkbox"
                checked={matchReverse}
                onChange={(e) => setMatchReverse(e.target.checked)}
              />
              <span>
                <strong>Reverse</strong> (use the unpainted squares)
              </span>
            </label>
            <label className="host-check-row">
              <input
                type="checkbox"
                className="host-control-checkbox"
                checked={matchAllowRotation}
                onChange={(e) => setMatchAllowRotation(e.target.checked)}
              />
              <span>
                <strong>Allow rotations</strong> (90° / 180° / 270°)
              </span>
            </label>
            <label className="host-check-row">
              <input
                type="checkbox"
                className="host-control-checkbox"
                checked={matchAllowMirror}
                onChange={(e) => setMatchAllowMirror(e.target.checked)}
              />
              <span>
                <strong>Allow mirrors</strong> (horizontal / vertical)
              </span>
            </label>
          </div>

          <div className="host-bingo-grid">
            {Array.from({ length: 25 }, (_, index) => {
              const row = Math.floor(index / 5);
              const col = index % 5;
              const position = `${row}-${col}`;
              const isSelected = displayedPositions.includes(position);

              return (
                <button
                  key={index}
                  type="button"
                  className={`host-bingo-cell${isSelected ? ' host-bingo-cell--on' : ''}`}
                  onClick={() => togglePosition(row, col)}
                  aria-pressed={isSelected}
                >
                  {isSelected ? '✓' : ''}
                </button>
              );
            })}
          </div>

          <p className="host-custom-pattern__count">{displayedPositions.length} squares in winning pattern</p>
        </div>

        <div className="host-footer-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!isValid}>
            <Save className="w-4 h-4" aria-hidden />
            {initialPattern ? 'Update pattern' : 'Save pattern'}
          </button>
        </div>
      </div>
    </HostSubmodalPortal>
  );
};

export default CustomPatternModal;
