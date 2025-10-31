import { ResponsiveContainer } from 'recharts';
import type { ReactNode } from 'react';

interface ChartWrapperProps {
  children: ReactNode;
  height?: number;
  className?: string;
}

export function ChartWrapper({ children, height = 300, className = '' }: ChartWrapperProps) {
  return (
    <div className={`chart-container ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}