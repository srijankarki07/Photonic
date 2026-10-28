import { Component, type ReactNode } from "react";

/**
 * Last-resort UI guard. A render error must not leave a blank window with no
 * way back; the backup engine keeps running and history is on disk.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("photonic: unhandled UI error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-full place-items-center bg-ink-950 px-8 text-center font-sans text-stone-200">
          <div className="max-w-md">
            <h1 className="font-display text-[30px] text-stone-50">
              Something went wrong
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-stone-400">
              Photonic hit an unexpected error. Your photos and backup history
              are unchanged.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 cursor-pointer rounded-[10px] bg-photon-400 px-4 py-2.5 text-[15px] font-medium text-ink-950 transition hover:bg-photon-300"
            >
              Reload Photonic
            </button>
            <details className="mt-6 text-left text-[13px] text-stone-500">
              <summary className="cursor-pointer">Details</summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-white/[0.03] p-3 font-mono text-[12px]">
                {this.state.error.message}
              </pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
