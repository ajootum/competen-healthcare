"use client";
import { Component, type ReactNode } from "react";

// PW-014 §5.2 / PW-AC-07 — per-widget error isolation. Wrapping each async dashboard widget (under a Suspense
// boundary) means a throw in one widget is caught HERE and renders a compact fallback, while every sibling widget
// still loads. A single failing data source or render never blanks the whole dashboard.
type Props = { name: string; children: ReactNode };
type State = { failed: boolean };

export default class WidgetBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(err: unknown) { if (process.env.NODE_ENV !== "production") console.error(`[widget:${this.props.name}]`, err); }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="bg-white rounded-xl border border-gray-200 border-dashed p-5 flex flex-col items-center justify-center text-center h-full min-h-[120px]">
        <span className="text-lg opacity-50">⚠️</span>
        <p className="text-[12px] font-medium text-gray-500 mt-1">{this.props.name} is unavailable</p>
        <p className="text-[10px] text-gray-400">Other widgets are unaffected. Try refreshing.</p>
      </div>
    );
  }
}
