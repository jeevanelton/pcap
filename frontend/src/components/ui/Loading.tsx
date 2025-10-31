import type { ReactNode } from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <div className="animate-spin rounded-full border-4 border-slate-700 border-t-blue-500 h-full w-full"></div>
    </div>
  );
}

interface LoadingOverlayProps {
  children?: ReactNode;
}

export function LoadingOverlay({ children }: LoadingOverlayProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="text-center">
        <LoadingSpinner size="lg" className="mb-4" />
        {children && <p className="text-slate-300">{children}</p>}
      </div>
    </div>
  );
}