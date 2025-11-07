# Backend Documentation

This document provides a detailed overview of the backend application.

## Overview

The backend is a Python application built with FastAPI. It provides a RESTful API for the frontend to interact with. It handles user authentication, project management, PCAP file uploads, and data analysis.

## API Endpoints

All endpoints are prefixed with `/api`.

### Authentication

*   **`POST /auth/signup`**: Creates a new user account.
    *   **Request Body**: `{ "email": "user@example.com", "password": "string" }`
    *   **Response**: `{ "access_token": "string", "token_type": "bearer" }`

*   **`POST /auth/login`**: Logs in a user.
    *   **Request Body**: `{ "email": "user@example.com", "password": "string" }`
    *   **Response**: `{ "access_token": "string", "token_type": "bearer" }`

*   **`GET /me`**: Returns the currently authenticated user.
    *   **Response**: `{ "id": "string", "email": "user@example.com" }`

### Projects

*   **`GET /projects`**: Returns a list of projects for the current user.
*   **`POST /projects`**: Creates a new project.
    *   **Request Body**: `{ "name": "string" }`
*   **`DELETE /projects/{project_id}`**: Deletes a project.
*   **`GET /projects/{project_id}/files`**: Returns a list of files for a project.
*   **`POST /projects/{project_id}/upload`**: Uploads a PCAP file to a project.

### Files

*   **`GET /files`**: Returns a list of all uploaded PCAP files for the current user.
*   **`DELETE /files/{file_id}`**: Deletes a PCAP file.

### Analysis

*   **`GET /analyze/{file_id}`**: Returns a statistical analysis of a PCAP file.
*   **`GET /packets/{file_id}`**: Returns a paginated list of packets from a PCAP file.
*   **`GET /packet/{file_id}/{packet_number}`**: Returns the details of a single packet.
*   **`GET /conversations/{file_id}`**: Returns a list of conversations for a PCAP file.

## Database

The backend uses ClickHouse as its database. The database schema is defined in the `database.py` file. It consists of the following tables:

*   `users`: Stores user information.
*   `projects`: Stores project information.
*   `pcap_metadata`: Stores metadata about uploaded PCAP files.
*   `pcap_project_map`: Maps PCAP files to projects.
*   `packets`: Stores the parsed packet data.

## PCAP Parsing

The PCAP parsing and ingestion process is handled by the `pcap_parser.py` file. When a PCAP file is uploaded, the `parse_and_ingest_pcap_sync` function is called. This function uses the `pyshark` library to parse the PCAP file and insert the packet data into the `packets` table in the ClickHouse database.
