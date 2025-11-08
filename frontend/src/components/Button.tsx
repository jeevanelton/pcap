import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { LoadingSpinner } from './LoadingSpinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success';
  isLoading?: boolean;
  children: ReactNode;
}

export function Button({ 
  variant = 'primary', 
  isLoading = false, 
  children, 
  className = '',
  disabled,
  ...props 
}: ButtonProps) {
  const baseStyles = 'flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-all';
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-slate-600 hover:bg-slate-700 text-white',
    success: 'bg-green-600 hover:bg-green-700 text-white'
  };
  const disabledStyles = 'opacity-50 cursor-not-allowed';

  return (
    <button
      className={`
        ${baseStyles}
        ${variants[variant]}
        ${disabled || isLoading ? disabledStyles : ''}
        ${className}
      `}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <LoadingSpinner size="small" />
          <span className="ml-2">Loading...</span>
        </>
      ) : children}
    </button>
  );
}