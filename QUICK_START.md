# PCAP Analyzer - Quick Start Guide

## 🎯 Current Status
✅ **Backend** running on http://localhost:8000  
✅ **Frontend** running on http://localhost:5173  
✅ **Database** ClickHouse on localhost:8123  
✅ **Authentication** JWT-based with bcrypt  
✅ **Project Management** Multi-user, multi-project support  

## 🚀 Quick Start

### Start Services
```bash
# Terminal 1: Backend
cd /home/kali/Documents/pcap
source backend/venv/bin/activate
python -m backend.main

# Terminal 2: Frontend
cd /home/kali/Documents/pcap/frontend
npm run dev
```

### First Time Setup
1. Open http://localhost:5173
2. Click **"Sign Up"**
3. Enter email and password
4. Click **"+ New Project"**
5. Name your project (e.g., "Test Analysis")
6. Click project card to enter
7. Click **"Upload PCAP"** button
8. Select a .pcap file
9. View analysis in Dashboard, Packets, or Connections tabs

## 📁 Project Structure
```
/home/kali/Documents/pcap/
├── backend/
│   ├── auth.py           # JWT authentication logic
│   ├── config.py         # Configuration (SECRET_KEY, database)
│   ├── database.py       # ClickHouse client + schema init
│   ├── main.py           # FastAPI app + all endpoints
│   ├── pcap_parser.py    # PCAP parsing with pyshark
│   ├── requirements.txt  # Python dependencies
│   └── uploads/          # Uploaded PCAP files
├── frontend/
│   ├── src/
│   │   ├── App.tsx                      # Main app with auth flow
│   │   ├── main.tsx                     # Entry point with AuthProvider
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx         # Auth state management
│   │   └── components/
│   │       ├── auth/
│   │       │   └── AuthScreen.tsx      # Login/Signup UI
│   │       ├── ProjectSelector.tsx      # Project management UI
│   │       ├── UploadCard.tsx          # Project-scoped upload
│   │       ├── NetworkGraph.tsx        # Graph with auth
│   │       ├── CustomNode.tsx          # Enhanced node styling
│   │       ├── CustomEdge.tsx          # Enhanced edge styling
│   │       ├── Stats.tsx               # Analysis stats
│   │       ├── Charts.tsx              # Protocol/traffic charts
│   │       ├── IpTables.tsx            # Top IPs tables
│   │       └── PacketTable.tsx         # Packet list
│   └── package.json
└── AUTH_IMPLEMENTATION.md              # Detailed auth docs
```

## 🔐 Authentication Flow
1. **AuthScreen** → Sign up or log in → Receive JWT token
2. **ProjectSelector** → Create/select project
3. **Main App** → Upload PCAPs scoped to project
4. All API calls include `Authorization: Bearer <token>` header

## 📊 Database Tables
- **users** - User accounts (email, password_hash)
- **projects** - Projects per user
- **pcap_project_map** - Links PCAPs to projects and users
- **pcap_metadata** - PCAP file metadata
- **packets** - Individual packet data

## 🎨 UI Features
- **Search & Highlight** - Search IPs in network graph
- **Layout Toggle** - Switch between vertical/horizontal graph layouts
- **Re-layout & Fit** - Auto-fit graph to viewport
- **Node Tooltips** - Hover for IP and connection count
- **Responsive Design** - Mobile-friendly panels and controls
- **Glassmorphism** - Modern glass effect on controls
- **Gradient Styling** - Beautiful indigo → purple → pink gradients

## 🧪 Test with Sample PCAP
```bash
# Generate sample traffic (optional)
sudo tcpdump -i any -c 100 -w sample.pcap

# Or download a sample
wget https://wiki.wireshark.org/uploads/__moin_import__/attachments/SampleCaptures/http.cap -O sample.pcap
```

Then upload via UI.

## 🔧 Configuration
Edit `/home/kali/Documents/pcap/backend/config.py`:
```python
# ClickHouse
CH_HOST = "localhost"
CH_PORT = 8123
CH_DATABASE = "pcap_analyzer"

# Auth
SECRET_KEY = "dev-secret-change-me"  # ⚠️ Change in production!
ACCESS_TOKEN_EXPIRE_MINUTES = 1440   # 24 hours
```

## 📡 API Endpoints

### Auth
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Get JWT token
- `GET /api/me` - Current user info

### Projects
- `GET /api/projects` - List user's projects
- `POST /api/projects` - Create project
- `DELETE /api/projects/{id}` - Delete project
- `GET /api/projects/{id}/files` - List project files
- `POST /api/projects/{id}/upload` - Upload PCAP

### Analysis (protected)
- `GET /api/files` - List all user files
- `GET /api/analyze/{file_id}` - Get analysis stats
- `GET /api/packets/{file_id}` - Get packets (paginated)
- `GET /api/packet/{file_id}/{number}` - Get packet detail
- `GET /api/conversations/{file_id}` - Get network graph data
- `DELETE /api/files/{file_id}` - Delete file

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check ClickHouse is running
docker ps | grep clickhouse

# Reinstall dependencies
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

### Frontend won't compile
```bash
cd frontend
rm -rf node_modules
npm install
npm run dev
```

### "401 Unauthorized" errors
- Token expired (24 hours) - Log in again
- Token missing - Clear localStorage and log in
- Check browser console for auth errors

### Schema not initialized
The schema auto-creates on first backend startup. Check logs for "Successfully connected to ClickHouse".

## 🎯 Next Features to Add
1. **Password reset** - Email-based reset flow
2. **Project sharing** - Invite users to projects
3. **Export reports** - PDF/CSV export of analysis
4. **Real-time updates** - WebSocket for live capture
5. **Advanced filters** - Protocol, port, time range filters
6. **GeoIP integration** - Map external IPs
7. **Alerting** - Detect anomalies and port scans

---

**Version**: 1.0 with Auth & Projects  
**Last Updated**: November 1, 2025  
**Status**: ✅ Production Ready (with dev SECRET_KEY)
