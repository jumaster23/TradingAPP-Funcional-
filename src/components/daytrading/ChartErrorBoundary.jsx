import React from 'react';

export default class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorKey: 0 };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ChartErrorBoundary] Render crash:', error, info?.componentStack);
  }

  // Reset error state when children/key changes (e.g. new ticker)
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.prevResetKey) {
      return { hasError: false, prevResetKey: props.resetKey };
    }
    return null;
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-border/50 bg-card p-6 text-center text-sm text-muted-foreground">
          Hubo un error al renderizar. Intenta con otro ticker.
        </div>
      );
    }
    return this.props.children;
  }
}