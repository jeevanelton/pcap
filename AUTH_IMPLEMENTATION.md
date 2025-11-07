# PCAP Analyzer - Authentication & Project Management

## ✅ Implementation Complete

### Backend Changes
- **Authentication** (`backend/auth.py`)
  - JWT-based authentication with bcrypt password hashing
  - OAuth2 password bearer token scheme
  - Token expiry: 24 hours (configurable)
  - User session management with dependency injection

- **Database Schema** (`backend/database.py`)
  - `users` table: id (UUID), email, password_hash, created_at
  - `projects` table: id (UUID), user_id (UUID), name, created_at
  - `pcap_project_map` table: pcap_id (UUID), project_id (UUID), user_id (UUID), created_at

- **API Endpoints** (`backend/main.py`)
  - `POST /api/auth/signup` - Create new user account
  - `POST /api/auth/login` - Login and receive JWT token
  - `GET /api/me` - Get current user info
  - `GET /api/projects` - List user's projects
  - `POST /api/projects` - Create new project
  - `DELETE /api/projects/{project_id}` - Delete project and files
  - `GET /api/projects/{project_id}/files` - List files in project
  - `POST /api/projects/{project_id}/upload` - Upload PCAP to project
  - All existing endpoints now protected with `current_user` dependency

### Frontend Changes
- **AuthContext** (`frontend/src/contexts/AuthContext.tsx`)
  - Global auth state management (token, user, login, signup, logout)
  - `authFetch` helper automatically adds Authorization header
  - Token persistence in localStorage

- **AuthScreen** (`frontend/src/components/auth/AuthScreen.tsx`)
  - Beautiful login/signup screen with gradient design
  - Form validation and error handling
  - Toggle between signup and login modes

- **ProjectSelector** (`frontend/src/components/ProjectSelector.tsx`)
  - Project list with create/delete actions
  - Card-based responsive layout
  - Select project to enter main app

- **App.tsx**
  - Flow: `AuthScreen` → `ProjectSelector` → main analysis UI
  - Pass `projectId` to UploadCard for scoped uploads

- **UploadCard.tsx**
  - Updated to use `/api/projects/{project_id}/upload`
  - Uses `authFetch` for authenticated requests

- **NetworkGraph.tsx**
  - Uses `authFetch` instead of axios
  - Properly handles auth headers for conversation endpoint

## 🚀 How to Use

### 1. Start Backend
```bash
cd /home/kali/Documents/pcap
source backend/venv/bin/activate
python -m backend.main
```
Backend runs on http://localhost:8000

### 2. Start Frontend
```bash
cd /home/kali/Documents/pcap/frontend
npm run dev
```
Frontend runs on http://localhost:5173

### 3. User Flow
1. **Sign Up** - Create a new account with email + password
2. **Log In** - Receive JWT token (stored in localStorage)
3. **Create Project** - Name your first project (e.g., "My Network Analysis")
4. **Select Project** - Click to enter the project
5. **Upload PCAP** - Files are now scoped to the selected project
6. **Analyze** - All dashboards, packets, and graphs work as before
7. **Switch Projects** - Return to project selector to switch contexts

### 4. Data Isolation
- Each user sees only their own projects and files
- PCAPs are linked to projects via `pcap_project_map`
- All API endpoints validate ownership before returning data
- JWT token required for all protected endpoints

## 🔐 Security Notes
- Passwords hashed with bcrypt (cost factor 12)
- JWT tokens use HS256 algorithm
- Secret key: `dev-secret-change-me` (⚠️ **CHANGE IN PRODUCTION**)
- Token expiry: 24 hours
- CORS configured for localhost:5173, 5174, 5175

## 📊 Database Structure
```sql
-- Users
CREATE TABLE users (
    id UUID,
    email String,
    password_hash String,
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree ORDER BY (id);

-- Projects
CREATE TABLE projects (
    id UUID,
    user_id UUID,
    name String,
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree ORDER BY (user_id, id);

-- PCAP to Project mapping
CREATE TABLE pcap_project_map (
    pcap_id UUID,
    project_id UUID,
    user_id UUID,
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree ORDER BY (user_id, project_id, pcap_id);
```

## 🧪 Testing
### Quick Test Flow
```bash
# 1. Sign up a user (frontend or curl)
curl -X POST http://localhost:8000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Response: {"access_token":"eyJ...","token_type":"bearer"}

# 2. Create a project
curl -X POST http://localhost:8000/api/projects \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Project"}'

# 3. Upload PCAP to project
curl -X POST http://localhost:8000/api/projects/<project_id>/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@sample.pcap"
```

## 🎨 UI Enhancements
- Gradient auth screen (indigo → purple → pink)
- Modern glassmorphism project cards
- Responsive grid layout for projects
- Loading states and error handling
- Smooth transitions and hover effects

## 🔧 Configuration
Edit `backend/config.py`:
```python
SECRET_KEY = "your-production-secret-key"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours
```

## 📝 Next Steps
- [ ] Add password reset flow
- [ ] Email verification
- [ ] Project sharing/collaboration
- [ ] Role-based access control (admin/viewer)
- [ ] Audit logs for user actions
- [ ] Rate limiting on auth endpoints
- [ ] Refresh tokens for extended sessions

---

**Status**: ✅ Backend & Frontend fully integrated and running
**Auth Flow**: Sign up → Login → Projects → Upload → Analyze
**Data Isolation**: Complete per-user/per-project separation
