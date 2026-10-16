import React from 'react';
import { getScaleBarData } from '../../utils/scale';

interface ScaleBarProps {
  metersPerUnit: number;
  screenPixelsPerUnit: number;
  className?: string;
}

export const ScaleBar: React.FC<ScaleBarProps> = ({
  metersPerUnit,
  screenPixelsPerUnit,
  className = '',
}) => {
  const data = getScaleBarData(metersPerUnit, screenPixelsPerUnit);

  return (
    <div
      className={`bg-white/95 backdrop-blur px-2.5 py-1.5 rounded-lg border border-[#E2E6EF] shadow-sm flex flex-col items-start gap-1 w-fit select-none ${className}`}
    >
      <span className="text-[11px] font-semibold text-[#111C2D] leading-none tabular-nums">
        {data.label}
      </span>
      <div
        className="relative h-2 flex items-end"
        style={{ width: `${data.widthPx}px` }}
      >
        {/* Left tick */}
        <div className="absolute left-0 bottom-0 w-[1.5px] h-2 bg-[#111C2D]" />
        {/* Horizontal bar */}
        <div className="w-full h-[1.5px] bg-[#111C2D]" />
        {/* Right tick */}
        <div className="absolute right-0 bottom-0 w-[1.5px] h-2 bg-[#111C2D]" />
      </div>
    </div>
  );
};
