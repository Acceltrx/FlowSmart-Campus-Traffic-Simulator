/**
 * FlowSmart - Error Boundary
 * Displays a clean fallback when an unhandled runtime error occurs:
 * - "Something went wrong" message
 * - "Reload" button to refresh the application
 * - "Export map JSON" button to extract and back up the current map state
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SAMPLE_MAP } from '../../utils/sampleMap';
import { MapConfig } from '../../types/traffic';

let currentMapRef: MapConfig | null = null;

export function registerCurrentMap(map: MapConfig): void {
  currentMapRef = map;
}

export function getCurrentMap(): MapConfig | null {
  return currentMapRef;
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(_error: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled app error:', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleExportMapJson = (): void => {
    try {
      let mapToExport: MapConfig = currentMapRef || SAMPLE_MAP;

      if (!currentMapRef) {
        try {
          const raw = localStorage.getItem('flowsmart_campus_map_v1');
          if (raw) {
            mapToExport = JSON.parse(raw);
          }
        } catch {
          // ignore read errors
        }
      }

      const cleanMap = { ...mapToExport };
      delete (cleanMap as Record<string, unknown>).baseMapImage;
      delete (cleanMap as Record<string, unknown>).imageUrl;
      delete (cleanMap as Record<string, unknown>).referenceImageUrl;

      const jsonStr = JSON.stringify(cleanMap, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(cleanMap.layoutName || 'flowsmart-backup').toLowerCase().replace(/\s+/g, '-')}-map.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export map JSON from error boundary:', err);
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-[#F5F6F8] p-6 font-sans select-none">
          <div className="w-full max-w-md bg-white rounded-xl border border-[#E2E6EF] p-6 shadow-sm flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-red-50 text-[#EF4444] flex items-center justify-center">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h1 className="text-[18px] font-semibold text-[#111C2D]">Something went wrong</h1>
              <p className="text-[13px] text-[#6B7A99] mt-1.5 leading-relaxed">
                An unexpected error occurred. You can reload the application or export your current map configuration to back up your work.
              </p>
            </div>
            <div className="flex items-center gap-3 mt-2 w-full justify-center">
              <button
                type="button"
                onClick={this.handleReload}
                className="h-9 px-4 bg-[#254B98] hover:bg-[#1f3c7a] text-white rounded-lg text-[13px] font-medium transition-colors cursor-pointer"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={this.handleExportMapJson}
                className="h-9 px-4 bg-white hover:bg-gray-50 text-[#111C2D] border border-[#E2E6EF] rounded-lg text-[13px] font-medium transition-colors cursor-pointer"
              >
                Export map JSON
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
