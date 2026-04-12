import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || '發生未知錯誤',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ margin: '2rem', padding: '2rem', textAlign: 'center' }}>
          <p className="eyebrow">System Error</p>
          <h2>{this.props.fallbackMessage ?? '頁面暫時無法顯示'}</h2>
          <p className="status-message">{this.state.errorMessage}</p>
          <button
            className="button button-primary"
            type="button"
            style={{ marginTop: '1rem' }}
            onClick={() => this.setState({ hasError: false, errorMessage: '' })}
          >
            重試
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
