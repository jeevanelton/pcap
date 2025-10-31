import { ReactNode } from 'react';

interface ButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'success';
  children: ReactNode;
  className?: string;
}

export function Button({ 
  onClick, 
  disabled = false, 
  variant = 'primary', 
  children,
  className = ''
}: ButtonProps) {
  const baseClasses = 'btn';
  const variantClasses = variant === 'primary' ? 'btn-primary' : 'btn-success';
  const disabledClasses = disabled ? 'btn-disabled' : '';
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses} ${disabledClasses} ${className}`}
    >
      {children}
    </button>
  );
}