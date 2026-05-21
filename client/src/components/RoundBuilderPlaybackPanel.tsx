import React from 'react';
import { Radio } from 'lucide-react';

interface RoundBuilderPlaybackPanelProps {
  snippetLength: number;
  onSnippetLengthChange: (seconds: number) => void;
  randomStarts: 'none' | 'early' | 'random';
  onRandomStartsChange: (mode: 'none' | 'early' | 'random') => void;
}

const RoundBuilderPlaybackPanel: React.FC<RoundBuilderPlaybackPanelProps> = ({
  snippetLength,
  onSnippetLengthChange,
  randomStarts,
  onRandomStartsChange,
}) => (
  <section className="round-builder-playback" aria-labelledby="round-builder-playback-title">
    <h4 id="round-builder-playback-title" className="round-builder-playback__title">
      <Radio className="w-4 h-4" aria-hidden />
      Playback
    </h4>
    <div className="round-builder-playback__body">
      <label className="round-builder-playback__slider">
        <span>Snippet</span>
        <input
          type="range"
          className="host-range host-range--snippet"
          min={5}
          max={60}
          value={snippetLength}
          onChange={(e) => {
            const n = Number(e.target.value);
            onSnippetLengthChange(n);
            localStorage.setItem('game-snippet-length', String(n));
          }}
        />
        <span className="round-builder-playback__value">{snippetLength}s</span>
      </label>
      <div className="round-builder-playback__radios" role="radiogroup" aria-label="Snippet start position">
        <label>
          <input
            type="radio"
            name="round-builder-random-starts"
            checked={randomStarts === 'none'}
            onChange={() => {
              onRandomStartsChange('none');
              localStorage.setItem('game-random-starts', 'none');
            }}
          />
          From start
        </label>
        <label>
          <input
            type="radio"
            name="round-builder-random-starts"
            checked={randomStarts === 'early'}
            onChange={() => {
              onRandomStartsChange('early');
              localStorage.setItem('game-random-starts', 'early');
            }}
          />
          Early random
        </label>
        <label>
          <input
            type="radio"
            name="round-builder-random-starts"
            checked={randomStarts === 'random'}
            onChange={() => {
              onRandomStartsChange('random');
              localStorage.setItem('game-random-starts', 'random');
            }}
          />
          Random
        </label>
      </div>
      <p className="round-builder-playback__note">
        Applied when you <strong>Save round</strong> and during live play. Connection & playback device stay
        under <strong>Connection</strong> in the header.
      </p>
    </div>
  </section>
);

export default RoundBuilderPlaybackPanel;
