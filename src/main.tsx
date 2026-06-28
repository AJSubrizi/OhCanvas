import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[OhCanvas] render failed", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot-error">
        <strong>OhCanvas failed to render</strong>
        <span>{this.state.error.message}</span>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
