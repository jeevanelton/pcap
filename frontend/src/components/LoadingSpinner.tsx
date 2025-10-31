import React from 'react';

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
}

export function LoadingSpinner({ size = 'medium', color = '#3b82f6' }: LoadingSpinnerProps) {
  const dimensions = {
    small: 16,
    medium: 24,
    large: 32,
  };

  const dim = dimensions[size];

  return (
    <div
      style={{
        display: 'inline-block',
        width: dim,
        height: dim,
        border: `2px solid ${color}`,
        borderRadius: '50%',
        borderRightColor: 'transparent',
        animation: 'spin 0.75s linear infinite',
      }}
    />
  );
}