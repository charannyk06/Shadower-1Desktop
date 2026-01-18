"use client";

import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class WorkflowErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[WorkflowErrorBoundary] Caught error:", error);
    console.error("[WorkflowErrorBoundary] Error info:", errorInfo);
    console.error(
      "[WorkflowErrorBoundary] Component stack:",
      errorInfo.componentStack,
    );

    // Show alert with error details
    alert(
      `React Error: ${error.message}\n\nComponent Stack: ${errorInfo.componentStack?.slice(0, 500)}`,
    );

    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="p-4 bg-red-50 border border-red-200 rounded-md">
            <h2 className="text-red-600 font-bold mb-2">
              Something went wrong
            </h2>
            <pre className="text-xs text-red-500 overflow-auto max-h-40">
              {this.state.error?.message}
            </pre>
            <pre className="text-xs text-red-400 overflow-auto max-h-60 mt-2">
              {this.state.errorInfo?.componentStack}
            </pre>
            <button
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded"
              onClick={() =>
                this.setState({ hasError: false, error: null, errorInfo: null })
              }
            >
              Try again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
