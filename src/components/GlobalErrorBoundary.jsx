import React from 'react';

export default class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // Ignore removeChild errors completely — they're non-critical cleanup issues
    if (error?.message?.includes('removeChild') || error?.message?.includes('No es hijo')) {
      console.warn('Widget cleanup error (non-critical):', error.message);
      return null; // Don't set hasError state
    }
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (!(error?.message?.includes('removeChild') || error?.message?.includes('No es hijo'))) {
      console.error('GlobalErrorBoundary caught:', error, info);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground space-y-4 p-8">
          <div className="text-5xl">⚠️</div>
          <h2 className="text-lg font-bold text-foreground">Ocurrió un error inesperado</h2>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {this.state.error?.message || 'Error desconocido'}
          </p>
          <button
            onClick={this.handleReset}
            className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}