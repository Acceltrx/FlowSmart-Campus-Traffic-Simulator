/**
 * FlowSmart - Results View Placeholder
 * Placeholder for simulation run logs, bottleneck analytics, and actionable insights.
 */

import React from 'react';
import { BarChart3, ArrowLeft } from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';

export const ResultsPlaceholder: React.FC = () => {
  const { setActiveTab } = useTrafficStore();

  return (
    <div className="flex-1 bg-[#F5F6F8] flex items-center justify-center p-6 select-none">
      <div className="max-w-md w-full bg-white rounded-lg border border-[#E2E6EF] p-6 flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-[#25A76B]/10 text-[#25A76B] flex items-center justify-center">
          <BarChart3 size={24} />
        </div>
        <div>
          <h2 className="text-[16px] font-medium text-[#111C2D]">Simulation results</h2>
          <p className="text-[12px] text-[#6B7A99] mt-1 leading-relaxed">
            Evaluation metrics, throughput analysis, queue bottlenecks, and run history comparison will appear here
            after running an active simulation session.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('simulation')}
          className="mt-2 h-9 px-4 bg-[#254B98] hover:bg-[#1f3c7a] text-white rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>Back to simulation</span>
        </button>
      </div>
    </div>
  );
};
