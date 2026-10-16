/**
 * FlowSmart - Map Setup View Placeholder
 * Placeholder for the Map setup tool dock and lane geometry editor.
 */

import React from 'react';
import { Map, ArrowRight } from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';

export const MapSetupPlaceholder: React.FC = () => {
  const { setActiveTab } = useTrafficStore();

  return (
    <div className="flex-1 bg-[#F5F6F8] flex items-center justify-center p-6 select-none">
      <div className="max-w-md w-full bg-white rounded-lg border border-[#E2E6EF] p-6 flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-[#254B98]/10 text-[#254B98] flex items-center justify-center">
          <Map size={24} />
        </div>
        <div>
          <h2 className="text-[16px] font-medium text-[#111C2D]">Map setup</h2>
          <p className="text-[12px] text-[#6B7A99] mt-1 leading-relaxed">
            Configure campus road geometry, lane access controls (shared, sticker-only, non-sticker-only),
            entrance/exit gates, and drop-off zones.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('simulation')}
          className="mt-2 h-9 px-4 bg-[#254B98] hover:bg-[#1f3c7a] text-white rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors cursor-pointer"
        >
          <span>Go to simulation</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
