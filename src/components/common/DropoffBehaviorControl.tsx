/**
 * FlowSmart - Drop-off behavior control
 * Settings: dropoffPatienceSec, dropoffPatienceSpreadSec, dropoffDwellMinSec, dropoffDwellMaxSec.
 * Uses the same local-string-state pattern as VehicleMixControl: typing an empty field never snaps back,
 * values are clamped on change (to the store) and on blur (to the field). Ranges match sanitizeDropoffSettings.
 * Disabled (greyed, Lock icon in the header) while a simulation is running or paused.
 */

import React, { useState, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { useTrafficStore, DEFAULT_SETTINGS } from '../../context/TrafficStoreContext';

interface DropoffNumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onCommit: (value: number) => void;
  unit?: string;
  hideLabel?: boolean;
}

const clampValue = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

const DropoffNumberField: React.FC<DropoffNumberFieldProps> = ({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
  unit,
}) => {
  const [local, setLocal] = useState<string>(String(value));

  // Resync from the store only when it differs from what the user has typed (external change or coupled field)
  useEffect(() => {
    setLocal((prev) => {
      const n = Number(prev);
      if (prev.trim() !== '' && !Number.isNaN(n) && clampValue(n, min, max) === value) return prev;
      return String(value);
    });
  }, [value, min, max]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value;
    setLocal(raw);
    if (raw.trim() === '') return;
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) onCommit(clampValue(parsed, min, max));
  };

  const handleBlur = () => {
    if (disabled) return;
    const parsed = Number(local);
    if (local.trim() === '' || Number.isNaN(parsed)) {
      setLocal(String(value));
    } else {
      const clamped = clampValue(parsed, min, max);
      setLocal(String(clamped));
      onCommit(clamped);
    }
  };

  return (
    <div className="flex flex-col space-y-1 min-w-0">
      <label htmlFor={id} className="text-[12px] text-[#6B7A99]">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={local}
          onChange={handleChange}
          onBlur={handleBlur}
          className={`w-full h-9 px-2 bg-white border border-[#E2E6EF] rounded-lg text-[13px] focus:outline-none focus:border-[#254B98] ${
            disabled ? 'cursor-not-allowed bg-gray-100 text-[#6B7A99]' : ''
          }`}
        />
        {unit && <span className="text-[12px] text-[#6B7A99]">{unit}</span>}
      </div>
    </div>
  );
};

export interface DropoffBehaviorControlProps {
  disabled?: boolean;
}

export const DropoffBehaviorControl: React.FC<DropoffBehaviorControlProps> = ({ disabled = false }) => {
  const { state, updateSettings } = useTrafficStore();
  const s = state.settings;

  const patience = s.dropoffPatienceSec ?? DEFAULT_SETTINGS.dropoffPatienceSec!;
  const spread = s.dropoffPatienceSpreadSec ?? DEFAULT_SETTINGS.dropoffPatienceSpreadSec!;
  const dwellMin = s.dropoffDwellMinSec ?? DEFAULT_SETTINGS.dropoffDwellMinSec!;
  const dwellMax = s.dropoffDwellMaxSec ?? DEFAULT_SETTINGS.dropoffDwellMaxSec!;

  return (
    <div className={`flex flex-col space-y-1.5 ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[#6B7A99]">Drop-off behavior</span>
        {disabled && <Lock size={13} className="text-[#6B7A99]" aria-label="Locked while the simulation is running" />}
      </div>
      <div className="flex flex-col space-y-2 bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg p-3">
        <div className="grid grid-cols-2 gap-2">
          <DropoffNumberField
            id="dropoff-patience-input"
            label="Patience (s)"
            value={patience}
            min={5}
            max={300}
            step={5}
            disabled={disabled}
            onCommit={(v) => updateSettings({ dropoffPatienceSec: v })}
          />
          <DropoffNumberField
            id="dropoff-spread-input"
            label="Patience spread (s)"
            value={spread}
            min={0}
            max={120}
            step={5}
            disabled={disabled}
            onCommit={(v) => updateSettings({ dropoffPatienceSpreadSec: v })}
          />
          <DropoffNumberField
            id="dropoff-dwell-min-input"
            label="Drop-off time min (s)"
            value={dwellMin}
            min={5}
            max={300}
            step={5}
            disabled={disabled}
            onCommit={(v) => updateSettings({ dropoffDwellMinSec: v })}
          />
          <DropoffNumberField
            id="dropoff-dwell-max-input"
            label="Drop-off time max (s)"
            value={dwellMax}
            min={5}
            max={300}
            step={5}
            disabled={disabled}
            onCommit={(v) => updateSettings({ dropoffDwellMaxSec: v })}
          />
        </div>
        <p className="text-[11px] text-[#6B7A99] leading-snug">
          A car that has waited this long near the drop-off zone drops off where it is.
        </p>
      </div>
    </div>
  );
};
