# Frontend Documentation

This document provides a detailed overview of the frontend application.

## Overview

The frontend is a single-page application (SPA) built with React and TypeScript. It uses Vite for fast development and builds. The UI is styled with Tailwind CSS, and charts are rendered using Recharts.

## Project Structure

The `src` directory is organized as follows:

```
src/
├── assets/           # Static assets like images and SVGs
├── components/       # Reusable React components
│   ├── auth/         # Components related to authentication
│   └── ui/           # Generic UI components (Button, Card, etc.)
├── contexts/         # React contexts for global state management
├── hooks/            # Custom React hooks
├── lib/              # Utility functions
├── services/         # API service definitions
├── styles/           # Global and responsive styles
└── types/            # TypeScript type definitions
```

### Key Components

*   `App.tsx`: The main component that handles routing and the overall layout.
*   `ProjectSelector.tsx`: Allows users to select, create, and delete projects.
*   `UploadCard.tsx`: Handles file uploads, including progress tracking.
*   `PacketTable.tsx`: Displays a table of captured packets with pagination.
*   `NetworkGraph.tsx`: Renders a graph of network conversations using `@xyflow/react`.
*   `Charts.tsx`: Displays various charts, such as protocol distribution and traffic over time.

## State Management

The application's state is managed using a combination of React's built-in hooks (`useState`, `useEffect`) and the Context API.

*   **`AuthContext.tsx`**: Manages user authentication state, including the JWT token and user information. It provides the `useAuth` hook to access the authentication state and methods like `login`, `signup`, and `logout`.
*   **`useApi.ts`**: A custom hook for making API requests. It handles loading and error states, making it easy to fetch data from the backend.

## Authentication

Authentication is handled using JSON Web Tokens (JWT). When a user logs in or signs up, the backend issues a JWT, which is stored in the browser's local storage. This token is then sent with every subsequent request to the backend in the `Authorization` header.

The `authFetch` function in `AuthContext.tsx` is a helper that automatically attaches the JWT to API requests. The `authUploadWithProgress` function is a similar helper for file uploads that also provides progress tracking.

## API Interaction

All communication with the backend API is handled through the functions in `AuthContext.tsx` and the `useApi` hook.

The API base URL is configured in `frontend/src/contexts/AuthContext.tsx`.

The primary functions for API interaction are:

*   `authFetch`: For making authenticated GET, POST, DELETE, etc. requests.
*   `authUploadWithProgress`: For uploading files with progress tracking.