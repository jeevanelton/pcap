# PCAP Analyzer - Network Packet Analysis Tool# PCAP Analyzer



A comprehensive web-based network packet analyzer built with FastAPI, React, and ClickHouse. This tool provides deep packet inspection, protocol analysis, network visualization, and detailed traffic insights.This project is a web-based network traffic analyzer. It allows users to upload `.pcap` and `.pcapng` files, view detailed information about the captured packets, and analyze the network traffic.



![PCAP Analyzer](https://img.shields.io/badge/version-1.0.0-blue.svg)## Technologies Used

![License](https://img.shields.io/badge/license-MIT-green.svg)

![Python](https://img.shields.io/badge/python-3.12-blue.svg)*   **Frontend:** React, TypeScript, Vite, Tailwind CSS, Recharts, @xyflow/react

![React](https://img.shields.io/badge/react-18.3-blue.svg)*   **Backend:** Python, FastAPI, Uvicorn, ClickHouse

*   **Database:** ClickHouse

## 🌟 Features

## Getting Started

### Core Capabilities

- **PCAP File Analysis**: Upload and analyze `.pcap` and `.pcapng` files### Prerequisites

- **Real-time Processing**: Live packet parsing with progress tracking

- **Multi-Protocol Support**: TCP, UDP, HTTP, HTTPS, DNS, QUIC, TLS, ARP, SMB, and more*   Node.js and npm

- **Deep Packet Inspection**: Extract and analyze packet layers and metadata*   Python 3.12+ and pip

*   Docker and Docker Compose (for running ClickHouse)

### Analysis Features

- **Protocol Distribution**: Visual breakdown of network traffic by protocol### Installation

- **Traffic Timeline**: Time-series analysis of packet flow

- **Connection Tracking**: Monitor unique IP conversations1.  **Clone the repository:**

- **Port Analysis**: Identify open ports and service detection    ```bash

- **DNS Query Analysis**: Track DNS requests, query types, and top domains    git clone <repository-url>

- **HTTP Traffic Analysis**: Analyze HTTP methods, status codes, hosts, and user agents    cd pcap-analyzer

- **TLS/SSL Analysis**: Inspect TLS versions, cipher suites, and SNI hostnames    ```

- **Geolocation**: Map IP addresses to geographic locations (with GeoIP database)

2.  **Backend Setup:**

### Visualization    *   Navigate to the `backend` directory:

- **Network Graph**: Interactive visualization of network topology        ```bash

- **Flow Diagram**: Packet flow visualization with protocol details        cd backend

- **Geographic Map**: World map showing traffic sources and destinations        ```

- **Statistics Dashboard**: Comprehensive charts and metrics    *   Install the required Python packages:

        ```bash

### Security & Management        pip install -r requirements.txt

- **User Authentication**: JWT-based secure authentication        ```

- **Project Management**: Organize analyses into projects    *   Start the ClickHouse database using Docker Compose:

- **Data Export**: Export analysis results to JSON        ```bash

- **Search & Filter**: Advanced filtering across all data views        docker-compose up -d

        ```

## 🚀 Quick Start with Docker

3.  **Frontend Setup:**

### Prerequisites    *   Navigate to the `frontend` directory:

- Docker Engine 20.10+        ```bash

- Docker Compose 2.0+        cd ../frontend

- 4GB RAM minimum (8GB recommended)        ```

- 10GB free disk space    *   Install the required npm packages:

        ```bash

### Installation        npm install

        ```

1. **Clone the repository**

```bash### Running the Application

git clone https://github.com/jeevanelton/pcap.git

cd pcap1.  **Start the backend server:**

```    *   From the `pcap-analyzer` root directory, run:

        ```bash

2. **Configure environment variables**        uvicorn backend.main:app --host 0.0.0.0 --port 8000

```bash        ```

cp .env.example .env    *   The backend API will be available at `http://localhost:8000`.

# Edit .env and set your JWT_SECRET_KEY

nano .env2.  **Start the frontend development server:**

```    *   Navigate to the `frontend` directory:

        ```bash

3. **Start the application**        cd frontend

```bash        ```

docker-compose up -d    *   Run the development server:

```        ```bash

        npm run dev

4. **Access the application**        ```

- Frontend: http://localhost    *   The frontend will be available at `http://localhost:5173`.

- Backend API: http://localhost:8000

- API Documentation: http://localhost:8000/docs## Project Structure



5. **Create your first user**```

```bashpcap-analyzer/

# The application will be ready in about 30 seconds├── backend/            # Backend FastAPI application

# Open http://localhost and click "Register" to create an account│   ├── main.py         # Main application file with API endpoints

```│   ├── auth.py         # Authentication logic

│   ├── database.py     # ClickHouse database connection and setup

### Stop the application│   ├── pcap_parser.py  # PCAP file parsing and ingestion logic

```bash│   └── requirements.txt# Python dependencies

docker-compose down├── frontend/           # Frontend React application

```│   ├── src/

│   │   ├── components/ # React components

### Remove all data (including database)│   │   ├── contexts/   # React contexts (e.g., AuthContext)

```bash│   │   ├── hooks/      # Custom React hooks

docker-compose down -v│   │   ├── services/   # API service calls

```│   │   └── ...

│   └── package.json    # Node.js dependencies

## 📋 Manual Installation (Without Docker)└── README.md           # This file

```

See [INSTALLATION.md](INSTALLATION.md) for detailed manual installation instructions.

## Additional Documentation

## 🏗️ Architecture

*   [Frontend Documentation](./frontend/README.md)

```*   [Backend Documentation](./backend/README.md)

┌─────────────────┐
│  React Frontend │ (Vite + TypeScript + TailwindCSS)
└────────┬────────┘
         │ HTTP/REST
         │
┌────────▼────────┐
│  FastAPI Backend│ (Python 3.12 + PyShark)
└────────┬────────┘
         │
         ├─────────┐
         │         │
┌────────▼──────┐ │
│  ClickHouse   │ │ File System
│   Database    │ │ (PCAP Storage)
└───────────────┘ └─────────────┘
```

### Tech Stack

**Backend:**
- FastAPI - Modern Python web framework
- PyShark - Python wrapper for TShark
- ClickHouse - High-performance columnar database
- JWT - Authentication & authorization
- GeoIP2 - IP geolocation

**Frontend:**
- React 18 - UI framework
- TypeScript - Type safety
- Vite - Build tool
- TailwindCSS - Styling
- React Flow - Network diagrams
- Recharts - Data visualization
- Leaflet - Geographic maps

## 📖 Usage Guide

### 1. Register/Login
- Create a new account or login with existing credentials
- JWT token is stored securely in the browser

### 2. Create a Project
- Click "New Project" in the dashboard
- Enter project name and description
- Projects help organize your PCAP analyses

### 3. Upload PCAP File
- Select a project
- Drag & drop or click to upload `.pcap` or `.pcapng` file
- Monitor upload progress and parsing status

### 4. Analyze Results
- **Dashboard**: Overview of protocol distribution and statistics
- **Packets**: Detailed packet table with filtering
- **Network Graph**: Visual topology of network connections
- **Flow Graph**: Sequential packet flow visualization
- **Geo Map**: Geographic visualization of traffic

### 5. Feature Details
Click "View" on any feature card to see detailed analysis:
- **DNS Queries**: All DNS requests with query types
- **HTTP Traffic**: Request/response analysis
- **TLS Sessions**: SSL/TLS handshake details
- **Open Ports**: Service identification
- **Connections**: IP conversation statistics
- **ARP Traffic**: Address resolution with spoofing detection
- **SMB Activity**: File sharing protocol analysis

### 6. Export Data
- Click "Export JSON" to download analysis results
- Use search and filter to narrow down data
- Export supports all detail views

## 🔧 Configuration

### Backend Environment Variables

```bash
# ClickHouse Configuration
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=9000
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=pcap_db

# JWT Authentication
JWT_SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

### Frontend Configuration

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8000',
      changeOrigin: true,
    }
  }
}
```

## 🐳 Docker Configuration

### Custom Port Mapping

Edit `docker-compose.yml`:
```yaml
services:
  frontend:
    ports:
      - "3000:80"  # Change 3000 to your desired port
  
  backend:
    ports:
      - "8001:8000"  # Change 8001 to your desired port
```

### Volume Management

Persist data across restarts:
```yaml
volumes:
  - ./uploads:/app/uploads
  - ./analysis-results:/app/analysis-results
```

## 🔒 Security Considerations

1. **Change JWT Secret**: Always set a strong `JWT_SECRET_KEY` in production
2. **HTTPS**: Use a reverse proxy (nginx/traefik) with SSL certificates
3. **File Upload**: Limit file sizes and validate PCAP files
4. **Network Isolation**: Use Docker networks to isolate services
5. **User Permissions**: Implement role-based access control (RBAC)

## 📊 Performance Tips

1. **ClickHouse Optimization**:
   - Increase memory limits for large PCAP files
   - Configure appropriate TTL for old data
   - Use partitioning for time-series data

2. **File Processing**:
   - Split large PCAP files (>1GB) for faster processing
   - Use filters to reduce packet count
   - Enable batch processing

3. **Frontend Performance**:
   - Enable pagination for large datasets
   - Use lazy loading for graphs
   - Optimize network graph node count

## 🐛 Troubleshooting

See [INSTALLATION.md](INSTALLATION.md#troubleshooting) for detailed troubleshooting guide.

### Quick Fixes

**ClickHouse Connection Issues:**
```bash
docker-compose logs clickhouse
docker-compose restart clickhouse
```

**Frontend API Connection:**
```bash
# Check backend is accessible
curl http://localhost:8000/api/health
```

**TShark Permission Errors:**
```bash
sudo usermod -aG wireshark $USER
newgrp wireshark
```

## 🛣️ Roadmap

- [ ] Real-time packet capture
- [ ] Advanced protocol parsers (ICMP, IGMP, IPv6)
- [ ] Machine learning anomaly detection
- [ ] Collaborative analysis features
- [ ] REST API rate limiting
- [ ] WebSocket support for live updates
- [ ] Custom filter expressions
- [ ] Report generation (PDF/HTML)

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👥 Authors

- **Jeevan Elton** - Initial work - [@jeevanelton](https://github.com/jeevanelton)

## 🙏 Acknowledgments

- [Wireshark](https://www.wireshark.org/) - Network protocol analyzer
- [ClickHouse](https://clickhouse.com/) - High-performance database
- [FastAPI](https://fastapi.tiangolo.com/) - Modern web framework
- [React Flow](https://reactflow.dev/) - Node-based UI library
- [MaxMind](https://www.maxmind.com/) - GeoIP database

## 📧 Support

For support, email support@example.com or open an issue on GitHub.

## 🔗 Links

- [Documentation](https://github.com/jeevanelton/pcap/wiki)
- [Issue Tracker](https://github.com/jeevanelton/pcap/issues)
- [Installation Guide](INSTALLATION.md)

---

**⭐ If you find this project useful, please consider giving it a star on GitHub!**
