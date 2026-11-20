import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
  details?: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = error.message || 'An unexpected error occurred.';
    let details: string | undefined;
    try {
      const parsed = JSON.parse(error.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed.error && parsed.operationType) {
        message = parsed.error.includes('Quota exceeded')
          ? 'Daily Firestore free-tier read quota reached. Quota resets tomorrow; see Firebase Console for details.'
          : `Database permission or validation error during ${parsed.operationType} on ${parsed.path || 'document'}.`;
        details = parsed.error;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message, details };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('BullionBridge ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#E5E3DD] p-8">
            <div className="flex items-center gap-3 text-[#B91C1C] mb-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-xl font-semibold text-[#141413]">
                Application Error
              </h2>
            </div>
            <p className="text-sm text-[#4B4A45] leading-relaxed mb-4">
              {this.state.message}
            </p>
            {this.state.details && (
              <pre className="text-xs font-mono bg-[#F3F1EC] border border-[#E5E3DD] p-3 overflow-x-auto text-[#4B4A45] mb-6">
                {this.state.details}
              </pre>
            )}
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '', details: undefined });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#141413] text-white hover:bg-[#2A2A28] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
