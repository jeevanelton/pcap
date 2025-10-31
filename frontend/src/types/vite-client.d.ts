// Minimal module declaration to satisfy TypeScript when `vite/client` types aren't resolved.
// This prevents the "Cannot find type definition file for 'vite/client'" error.

declare module 'vite/client' {
  interface ImportMetaEnv {
    readonly MODE: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
    // add more env vars here as needed
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
