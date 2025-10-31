import type { ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';

interface ChartContainerProps {
  children: ReactNode;
  height?: number;
  className?: string;
}

export function ChartContainer({ 
  children, 
  height = 300, 
  className = '' 
}: ChartContainerProps) {
  return (
    <div style={{ height }} className={`w-full ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}