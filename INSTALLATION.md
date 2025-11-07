# Installation Guide

This guide provides detailed installation instructions for the PCAP Analyzer.

## Table of Contents
- [Docker Installation (Recommended)](#docker-installation-recommended)
- [Manual Installation](#manual-installation)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

## Docker Installation (Recommended)

### System Requirements
- Operating System: Linux, macOS, or Windows 10/11
- Docker Engine 20.10 or higher
- Docker Compose 2.0 or higher
- RAM: 4GB minimum, 8GB recommended
- Disk Space: 10GB free space
- CPU: 2+ cores recommended

### Step-by-Step Installation

#### 1. Install Docker

**Ubuntu/Debian:**
```bash
# Update package index
sudo apt-get update

# Install dependencies
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

**macOS:**
```bash
# Using Homebrew
brew install --cask docker

# Or download Docker Desktop from:
# https://www.docker.com/products/docker-desktop
```

**Windows:**
Download and install Docker Desktop from:
https://www.docker.com/products/docker-desktop

#### 2. Verify Docker Installation
```bash
docker --version
docker-compose --version
```

#### 3. Clone the Repository
```bash
git clone https://github.com/jeevanelton/pcap.git
cd pcap
```

#### 4. Configure Environment
```bash
# Copy example environment file
cp .env.example .env

# Edit environment variables (IMPORTANT: Change JWT_SECRET_KEY)
nano .env

# Generate a secure secret key
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Update `.env`:
```env
JWT_SECRET_KEY=<paste-generated-key-here>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

#### 5. Start the Application
```bash
# Build and start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

#### 6. Access the Application
- **Frontend**: http://localhost
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **ClickHouse**: localhost:8123 (HTTP), localhost:9000 (Native)

#### 7. Create First User
1. Open http://localhost in your browser
2. Click "Register" 
3. Fill in registration form
4. Login with your credentials

### Managing the Application

**Start services:**
```bash
docker-compose start
```

**Stop services:**
```bash
docker-compose stop
```

**Restart services:**
```bash
docker-compose restart
```

**View logs:**
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f clickhouse
```

**Update application:**
```bash
git pull
docker-compose down
docker-compose up -d --build
```

**Remove everything (including data):**
```bash
docker-compose down -v
```

## Manual Installation

### Prerequisites

**Operating System:**
- Ubuntu 20.04+ / Debian 11+
- macOS 12+
- Windows 10/11 (with WSL2)

**Software Requirements:**
- Python 3.12 or higher
- Node.js 20 or higher
- ClickHouse Server 23.8+
- TShark (Wireshark CLI tools)
- Git

### Backend Installation

#### 1. Install System Dependencies

**Ubuntu/Debian:**
```bash
# Update system
sudo apt-get update

# Install TShark
sudo apt-get install -y tshark libpcap-dev

# Configure TShark for non-root users
sudo dpkg-reconfigure wireshark-common
sudo usermod -aG wireshark $USER
newgrp wireshark

# Install Python 3.12
sudo apt-get install -y python3.12 python3.12-venv python3-pip
```

**macOS:**
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Wireshark (includes TShark)
brew install wireshark

# Install Python 3.12
brew install python@3.12
```

#### 2. Install ClickHouse

**Ubuntu/Debian:**
```bash
# Download and install
curl https://clickhouse.com/ | sh
sudo ./clickhouse install

# Start ClickHouse
sudo clickhouse start

# Create database
clickhouse-client --query "CREATE DATABASE IF NOT EXISTS pcap_db"
```

**macOS:**
```bash
brew install clickhouse
brew services start clickhouse

# Create database
clickhouse-client --query "CREATE DATABASE IF NOT EXISTS pcap_db"
```

#### 3. Set Up Python Environment

```bash
# Navigate to project
cd backend

# Create virtual environment
python3.12 -m venv venv

# Activate virtual environment
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Upgrade pip
pip install --upgrade pip

# Install dependencies
pip install -r requirements.txt
pip install -r requirements_geoip.txt
```

#### 4. Configure Backend

```bash
# Create uploads directory
mkdir -p uploads

# Configure environment (optional)
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_PORT=9000
export JWT_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
```

#### 5. Download GeoIP Database (Optional)

```bash
# Sign up for free account at:
# https://dev.maxmind.com/geoip/geolite2-free-geolocation-data

# Download GeoLite2-City.mmdb
# Place it in the backend directory
wget "YOUR_DOWNLOAD_LINK" -O GeoLite2-City.mmdb
```

#### 6. Run Backend Server

```bash
# Development mode
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Production mode
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Frontend Installation

#### 1. Install Node.js

**Ubuntu/Debian:**
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**macOS:**
```bash
brew install node@20
```

#### 2. Install Dependencies

```bash
cd frontend

# Install packages
npm install

# Or use npm ci for exact versions
npm ci
```

#### 3. Configure Frontend

Edit `vite.config.ts` if needed:
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
```

#### 4. Run Frontend

**Development mode:**
```bash
npm run dev
```

**Production build:**
```bash
npm run build
npm run preview
```

## Production Deployment

### Using Docker with Nginx Reverse Proxy

#### 1. Install Nginx
```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

#### 2. Configure Nginx
Create `/etc/nginx/sites-available/pcap`:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://localhost:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/pcap /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 3. Enable SSL
```bash
sudo certbot --nginx -d yourdomain.com
```

### Using Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml pcap

# Check services
docker stack services pcap
```

### Using Kubernetes

See `k8s/` directory for Kubernetes manifests (coming soon).

## Troubleshooting

### Docker Issues

**Issue: Port already in use**
```bash
# Check what's using the port
sudo lsof -i :80
sudo lsof -i :8000

# Change ports in docker-compose.yml
```

**Issue: Permission denied**
```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

**Issue: Container won't start**
```bash
# Check logs
docker-compose logs <service-name>

# Rebuild containers
docker-compose up -d --build --force-recreate
```

### ClickHouse Issues

**Issue: Connection refused**
```bash
# Check ClickHouse is running
sudo systemctl status clickhouse-server

# Check logs
sudo tail -f /var/log/clickhouse-server/clickhouse-server.log

# Restart service
sudo systemctl restart clickhouse-server
```

**Issue: Out of memory**
```bash
# Increase max_memory_usage in /etc/clickhouse-server/config.xml
<max_memory_usage>10000000000</max_memory_usage>
```

### TShark Issues

**Issue: Permission denied when capturing**
```bash
# Add user to wireshark group
sudo usermod -aG wireshark $USER
newgrp wireshark

# Reconfigure dumpcap permissions
sudo dpkg-reconfigure wireshark-common
```

**Issue: TShark not found**
```bash
# Install TShark
sudo apt-get install -y tshark

# Verify installation
tshark --version
```

### Frontend Issues

**Issue: API connection failed**
```bash
# Check backend is running
curl http://localhost:8000/api/health

# Verify CORS settings
# Check frontend/vite.config.ts proxy configuration
```

**Issue: Build fails**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Try with legacy peer deps
npm install --legacy-peer-deps
```

### Performance Issues

**Issue: Slow PCAP processing**
- Split large PCAP files into smaller chunks
- Increase ClickHouse memory limits
- Use SSD storage for faster I/O

**Issue: High memory usage**
- Reduce batch size in pcap_parser.py
- Limit concurrent uploads
- Configure ClickHouse memory limits

## Getting Help

If you encounter issues not covered here:

1. Check [GitHub Issues](https://github.com/jeevanelton/pcap/issues)
2. Read the [FAQ](FAQ.md)
3. Join our [Discord Community](#)
4. Email support: jeevanelton@example.com

## Next Steps

After successful installation:
1. Read the [User Guide](USER_GUIDE.md)
2. Check out [Examples](examples/)
3. Review [Best Practices](BEST_PRACTICES.md)
