# Simple Installation Guide - PCAP Analyzer

## ⚡ One-Command Installation

### Prerequisites (Install Once)
- **Docker Desktop** (or Docker Engine + Docker Compose)
  - Windows/Mac: Download from [docker.com](https://www.docker.com/products/docker-desktop/)
  - Linux: `sudo apt install docker.io docker-compose` or `sudo yum install docker docker-compose`

### Install & Run (3 Steps)

```bash
# 1. Clone the repository
git clone https://github.com/jeevanelton/pcap.git
cd pcap

# 2. Start everything with one command
docker-compose up -d

# 3. Open your browser
# Frontend: http://localhost
# Backend API: http://localhost:8000/docs
```

**That's it! Wait 30 seconds for services to start, then access http://localhost**

---

## 🎯 First Use

1. **Register Account**: Click "Register" and create your first user
2. **Create Project**: Click "New Project" in the dashboard
3. **Upload PCAP**: Drag & drop your `.pcap` or `.pcapng` file
4. **Analyze**: View packets, protocols, network graphs, and more!

---

## 🛑 Stop/Remove

```bash
# Stop services (keeps data)
docker-compose down

# Stop and remove all data
docker-compose down -v
```

---

## 🔧 Customization (Optional)

### Change Ports
Edit `docker-compose.yml`:
```yaml
services:
  frontend:
    ports:
      - "8080:80"    # Change 8080 to your preferred port
```

### Change JWT Secret (Recommended for Production)
Edit `docker-compose.yml`:
```yaml
backend:
  environment:
    - JWT_SECRET_KEY=your-strong-random-secret-here
```

### Increase Upload Size Limit
Already configured for 500MB files. To change, edit `nginx.conf`:
```nginx
client_max_body_size 1G;  # Allow 1GB files
```
Then rebuild: `docker-compose up --build -d frontend`

---

## 🗄️ Database Schema

**The schema is created automatically on first startup!**

Tables created:
- `users` - User accounts
- `projects` - Analysis projects  
- `packets` - Parsed packet data
- `pcap_metadata` - File metadata
- `pcap_project_map` - Project-file relationships

**No manual SQL required!** The backend runs `init_schema()` on startup.

---

## 📦 What's Included?

### Self-Contained Setup
- ✅ **Backend** (Python FastAPI) - Builds from `Dockerfile.backend`
- ✅ **Frontend** (React/Vite) - Builds from `Dockerfile.frontend`  
- ✅ **Database** (ClickHouse) - Official Docker image
- ✅ **Web Server** (Nginx) - Bundled in frontend container
- ✅ **Schema Init** - Auto-creates tables on first run
- ✅ **Sample Config** - `.env.example` with sensible defaults

### No External Dependencies
Everything runs in containers. No need to install:
- ❌ Python
- ❌ Node.js
- ❌ ClickHouse
- ❌ Nginx

---

## 🐛 Troubleshooting

### Services Won't Start
```bash
# Check logs
docker-compose logs

# Restart services
docker-compose restart
```

### Port Already in Use
```bash
# Find what's using port 80
sudo lsof -i :80

# Change ports in docker-compose.yml (see Customization above)
```

### ClickHouse Connection Failed
```bash
# Wait for healthcheck
docker-compose ps

# Check ClickHouse logs
docker logs pcap-clickhouse

# Restart ClickHouse
docker-compose restart clickhouse
```

### Frontend Can't Reach Backend
```bash
# Verify backend is running
curl http://localhost:8000/

# Check API health
curl http://localhost:8000/api/health/schema

# Rebuild if needed
docker-compose up --build -d
```

---

## 🚀 Production Deployment

### Quick Production Setup

1. **Set strong JWT secret**:
```bash
export JWT_SECRET_KEY=$(openssl rand -hex 32)
```

2. **Use environment file**:
```bash
cp .env.example .env
nano .env  # Edit JWT_SECRET_KEY
```

3. **Add SSL (Recommended)**:
Use a reverse proxy like Caddy or Traefik in front of the frontend container.

Example with Caddy:
```Caddyfile
yourdomain.com {
    reverse_proxy localhost:80
}
```

---

## 📊 System Requirements

### Minimum
- **CPU**: 2 cores
- **RAM**: 4GB
- **Disk**: 10GB free

### Recommended  
- **CPU**: 4+ cores
- **RAM**: 8GB+
- **Disk**: 50GB+ (for large PCAP storage)

---

## 🔄 Updates

```bash
# Pull latest code
git pull

# Rebuild containers
docker-compose up --build -d

# Database migrations are automatic!
```

---

## 📝 File Structure

```
pcap/
├── docker-compose.yml       # Main orchestration file
├── Dockerfile.backend       # Backend container build
├── Dockerfile.frontend      # Frontend container build  
├── nginx.conf              # Nginx config (500MB upload limit)
├── .env.example            # Environment template
├── backend/
│   ├── main.py            # API endpoints + startup logic
│   ├── database.py        # Schema init + DB connection
│   ├── pcap_parser.py     # PCAP ingestion logic
│   ├── auth.py            # JWT authentication
│   ├── config.py          # Environment variables
│   └── requirements.txt   # Python dependencies
├── frontend/
│   ├── src/               # React source code
│   ├── package.json       # Node dependencies
│   └── vite.config.ts     # Build configuration
└── README.md              # Full documentation
```

---

## ✅ Checklist: Ready to Install on Any System

- [x] **Docker-only** - No Python/Node required
- [x] **Auto-schema** - Tables created automatically
- [x] **Self-contained** - All dependencies in containers
- [x] **Single command** - `docker-compose up -d`
- [x] **Pre-configured** - Sensible defaults included
- [x] **Port customizable** - Easy to change via docker-compose.yml
- [x] **Data persistence** - Volumes for database & uploads
- [x] **Clean removal** - `docker-compose down -v` removes everything

---

**Questions? Issues?**  
Open an issue: https://github.com/jeevanelton/pcap/issues
