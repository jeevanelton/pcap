# PCAP Analyzer - Docker Deployment Guide

## Overview

The PCAP Analyzer is now fully containerized using Docker, making it easy to deploy on any system with Docker installed.

## What's Included

### Docker Files Created

1. **Dockerfile.backend** - Backend service container
   - Python 3.12 slim base image
   - TShark and system dependencies
   - FastAPI application
   - Automatic dependency installation

2. **Dockerfile.frontend** - Frontend service container
   - Multi-stage build (Node.js + Nginx)
   - Production-optimized React build
   - Nginx web server for static files

3. **docker-compose.yml** - Service orchestration
   - ClickHouse database service
   - Backend API service
   - Frontend web service
   - Volume management
   - Network configuration
   - Health checks

4. **nginx.conf** - Nginx configuration
   - Reverse proxy for backend API
   - Gzip compression
   - Security headers
   - Static asset caching

5. **.dockerignore** - Build optimization
   - Excludes unnecessary files from Docker builds
   - Reduces image size
   - Speeds up build process

6. **.env.example** - Environment template
   - All required environment variables
   - Default values provided
   - Security settings

## Quick Start

### Method 1: One-Command Start (Recommended)

**Linux/macOS:**
```bash
./start.sh
```

**Windows:**
```cmd
start.bat
```

The script will:
- Check Docker installation
- Generate secure JWT secret
- Create .env file
- Pull and build images
- Start all services
- Display access URLs

### Method 2: Manual Docker Compose

```bash
# Copy environment template
cp .env.example .env

# Edit JWT secret (important!)
nano .env

# Start services
docker-compose up -d

# View logs
docker-compose logs -f
```

## Service Architecture

```
┌─────────────────────────────────────┐
│         Docker Network              │
│                                     │
│  ┌──────────────┐                  │
│  │   Frontend   │ :80              │
│  │   (Nginx)    │◄─────── Users   │
│  └──────┬───────┘                  │
│         │                           │
│         │ Proxy /api/*              │
│         ▼                           │
│  ┌──────────────┐                  │
│  │   Backend    │ :8000            │
│  │   (FastAPI)  │                  │
│  └──────┬───────┘                  │
│         │                           │
│         │ ClickHouse Client         │
│         ▼                           │
│  ┌──────────────┐                  │
│  │  ClickHouse  │ :9000, :8123     │
│  │  (Database)  │                  │
│  └──────────────┘                  │
│                                     │
└─────────────────────────────────────┘
```

## Port Configuration

| Service    | Internal Port | External Port | Protocol |
|------------|---------------|---------------|----------|
| Frontend   | 80            | 80            | HTTP     |
| Backend    | 8000          | 8000          | HTTP     |
| ClickHouse | 9000          | 9000          | TCP      |
| ClickHouse | 8123          | 8123          | HTTP     |

### Changing Ports

Edit `docker-compose.yml`:

```yaml
services:
  frontend:
    ports:
      - "3000:80"  # Frontend now on port 3000
  
  backend:
    ports:
      - "8001:8000"  # Backend now on port 8001
```

## Volume Persistence

The application uses volumes to persist data:

```yaml
volumes:
  - ./backend/uploads:/app/uploads          # Uploaded PCAP files
  - ./analysis-results:/app/analysis-results # Analysis results
  - clickhouse_data:/var/lib/clickhouse     # Database data
```

### Backup Data

```bash
# Backup uploads
tar -czf uploads-backup.tar.gz backend/uploads/

# Backup ClickHouse data
docker-compose exec clickhouse clickhouse-client --query "BACKUP DATABASE pcap_db TO Disk('backups', 'backup.zip')"
```

## Environment Variables

### Required Variables

```env
# Database
CLICKHOUSE_HOST=clickhouse
CLICKHOUSE_PORT=9000
CLICKHOUSE_DATABASE=pcap_db

# Authentication (CHANGE THIS!)
JWT_SECRET_KEY=your-super-secret-key-min-32-chars
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

### Generating Secure Secret

```bash
# Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# OpenSSL
openssl rand -base64 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Management Commands

### Start Services
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose stop
```

### Restart Services
```bash
docker-compose restart
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f clickhouse
```

### Check Status
```bash
docker-compose ps
```

### Update Application
```bash
git pull
docker-compose down
docker-compose up -d --build
```

### Remove Everything
```bash
# Stop and remove containers, networks
docker-compose down

# Also remove volumes (DELETES ALL DATA!)
docker-compose down -v
```

## Production Deployment

### 1. Enable HTTPS

Use a reverse proxy like Nginx or Traefik:

```nginx
# /etc/nginx/sites-available/pcap
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 2. Resource Limits

Add to `docker-compose.yml`:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          memory: 2G
  
  clickhouse:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G
        reservations:
          memory: 4G
```

### 3. Enable Auto-Restart

```yaml
services:
  backend:
    restart: unless-stopped
  
  frontend:
    restart: unless-stopped
  
  clickhouse:
    restart: unless-stopped
```

### 4. Set Up Monitoring

```yaml
# Add Prometheus and Grafana
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
  
  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    depends_on:
      - prometheus
```

## Troubleshooting

### Services Won't Start

```bash
# Check Docker daemon
sudo systemctl status docker

# Check logs
docker-compose logs

# Restart Docker
sudo systemctl restart docker
```

### Port Conflicts

```bash
# Check what's using the port
sudo lsof -i :80
sudo lsof -i :8000

# Change ports in docker-compose.yml or stop conflicting service
```

### ClickHouse Connection Failed

```bash
# Check ClickHouse logs
docker-compose logs clickhouse

# Restart ClickHouse
docker-compose restart clickhouse

# Verify connection
docker-compose exec clickhouse clickhouse-client --query "SELECT 1"
```

### Frontend Can't Reach Backend

```bash
# Check nginx configuration
docker-compose exec frontend cat /etc/nginx/conf.d/default.conf

# Test backend directly
curl http://localhost:8000/api/health

# Restart frontend
docker-compose restart frontend
```

### Out of Disk Space

```bash
# Check Docker disk usage
docker system df

# Clean up unused images
docker image prune -a

# Clean up volumes
docker volume prune

# Clean up everything
docker system prune -a --volumes
```

## Advanced Configuration

### Custom Network

```yaml
networks:
  pcap-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.25.0.0/16

services:
  backend:
    networks:
      - pcap-network
```

### External Database

Use existing ClickHouse instance:

```yaml
services:
  backend:
    environment:
      - CLICKHOUSE_HOST=external-db.example.com
      - CLICKHOUSE_PORT=9000
  
  # Remove clickhouse service
```

### Multi-Stage Production Build

Already implemented in `Dockerfile.frontend`:
1. Build stage: Compiles React app
2. Production stage: Serves with Nginx

### Health Checks

Already configured:

```yaml
clickhouse:
  healthcheck:
    test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
    interval: 10s
    timeout: 5s
    retries: 5
```

## Security Best Practices

1. **Never commit .env file** - Already in .gitignore
2. **Change default JWT secret** - Use strong random key
3. **Use HTTPS in production** - Set up SSL certificates
4. **Limit exposed ports** - Only expose necessary ports
5. **Regular updates** - Keep Docker images updated
6. **Network isolation** - Use Docker networks
7. **Volume permissions** - Set appropriate file permissions

## Performance Optimization

### ClickHouse Tuning

Create `clickhouse-config.xml`:

```xml
<yandex>
    <max_memory_usage>10000000000</max_memory_usage>
    <max_concurrent_queries>100</max_concurrent_queries>
</yandex>
```

Mount in docker-compose.yml:

```yaml
clickhouse:
  volumes:
    - ./clickhouse-config.xml:/etc/clickhouse-server/config.d/custom.xml
```

### Frontend Caching

Already configured in nginx.conf:
- Static assets cached for 1 year
- Gzip compression enabled
- Browser caching headers set

## Scaling

### Horizontal Scaling

Use Docker Swarm or Kubernetes:

```bash
# Docker Swarm
docker swarm init
docker stack deploy -c docker-compose.yml pcap

# Scale backend
docker service scale pcap_backend=3
```

### Load Balancing

Add HAProxy or Nginx load balancer:

```yaml
  loadbalancer:
    image: haproxy:latest
    ports:
      - "80:80"
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg
```

## Support

- **Documentation**: [INSTALLATION.md](INSTALLATION.md)
- **Issues**: https://github.com/jeevanelton/pcap/issues
- **Discussions**: https://github.com/jeevanelton/pcap/discussions

---

**Happy Analyzing! 📊🔍**
