// API Configuration
// Use environment variable if available, otherwise detect from browser location
const getApiBaseUrl = (): string => {
  // Check for Vite environment variable
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) {
    return (import.meta as any).env.VITE_API_BASE_URL;
  }
  
  // If running in production (served from same host), use relative path
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD) {
    // In production with nginx proxy, API is on same host
    return window.location.origin;
  }
  
  // For development, detect the host and use port 8000
  const hostname = window.location.hostname;
  return `http://${hostname}:8000`;
};

export const API_BASE_URL = getApiBaseUrl();

console.log('[Config] API Base URL:', API_BASE_URL);
