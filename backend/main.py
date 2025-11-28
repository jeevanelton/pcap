from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from datetime import datetime
import os
from pathlib import Path
import uuid
from typing import List, Dict, Any
import shutil
import json

from database import get_ch_client, wait_for_clickhouse, init_schema
from config import CH_DATABASE
from pcap_parser import parse_and_ingest_pcap_sync

# Optional GeoIP support
try:
    import geoip2.database
    import geoip2.errors
    GEOIP_AVAILABLE = True
    GEOIP_DB_PATH = Path(__file__).parent / "GeoLite2-City.mmdb"
    if not GEOIP_DB_PATH.exists():
        print(f"GeoIP database not found at {GEOIP_DB_PATH}. GeoIP features disabled.")
        GEOIP_AVAILABLE = False
        geoip_reader = None
    else:
        geoip_reader = geoip2.database.Reader(str(GEOIP_DB_PATH))
        print(f"GeoIP database loaded from {GEOIP_DB_PATH}")
except ImportError:
    GEOIP_AVAILABLE = False
    geoip_reader = None
    print("geoip2 library not installed. GeoIP features disabled. Install with: pip install geoip2")

app = FastAPI(title="PCAP Analyzer API")

from auth import get_current_user, hash_password, verify_password, create_access_token, get_user_by_email

@app.on_event("startup")
async def _startup():
    ready = wait_for_clickhouse(max_seconds=45, interval=2)
    if not ready:
        print("[Startup] ClickHouse not ready after retries")
        return
    try:
        init_schema()
        get_ch_client()
    except Exception as e:
        print(f"[Startup] Schema init failed: {e}")

# Generic exception handlers to avoid leaking internal details
from fastapi.responses import JSONResponse
from starlette.requests import Request

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    # Log full error server-side, send sanitized message to client
    print(f"[Error] {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    # Pass through 4xx details, sanitize 5xx
    if 400 <= exc.status_code < 500:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    print(f"[HTTPError] {exc.detail}")
    return JSONResponse(status_code=exc.status_code, content={"detail": "Server error"})

ANALYSIS_PROGRESS: Dict[str, Dict[str, Any]] = {}

# Lightweight proxy so scattered ch_client usages route to the cached client
class _CHProxy:
    def query(self, *args, **kwargs):
        return get_ch_client().query(*args, **kwargs)
    def command(self, *args, **kwargs):
        return get_ch_client().command(*args, **kwargs)

ch_client = _CHProxy()

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Configuration ---
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# --- API Endpoints ---

# --- Auth & Projects Endpoints ---
from pydantic import BaseModel
from typing import Optional
from datetime import timedelta

class SignupRequest(BaseModel):
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class ProjectCreateRequest(BaseModel):
    name: str

@app.post("/api/auth/signup", response_model=TokenResponse)
async def signup(payload: SignupRequest):
    exists = get_ch_client().query("SELECT COUNT() FROM users WHERE email = {email:String}", parameters={'email': payload.email}).result_rows[0][0]
    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    get_ch_client().command(
        "INSERT INTO users (id, email, password_hash) VALUES ({id:String}, {email:String}, {password_hash:String})",
        parameters={'id': user_id, 'email': payload.email, 'password_hash': hash_password(payload.password)}
    )
    token = create_access_token({"sub": user_id}, expires_delta=timedelta(days=7))
    return TokenResponse(access_token=token)

@app.post("/api/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    user = get_user_by_email(payload.email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"sub": user["id"]}, expires_delta=timedelta(days=7))
    return TokenResponse(access_token=token)

@app.get("/api/me")
async def me(current_user: dict = Depends(get_current_user)):
    return {"id": current_user["id"], "email": current_user["email"]}

@app.get("/api/projects")
async def list_projects(current_user: dict = Depends(get_current_user)):
    res = get_ch_client().query("SELECT id, name, created_at FROM projects WHERE user_id = {user_id:String} ORDER BY created_at DESC", parameters={'user_id': current_user['id']})
    return [{"id": str(r[0]), "name": r[1], "created_at": r[2].isoformat()} for r in res.result_rows]

@app.post("/api/projects")
async def create_project(payload: ProjectCreateRequest, current_user: dict = Depends(get_current_user)):
    pid = str(uuid.uuid4())
    get_ch_client().command("INSERT INTO projects (id, user_id, name) VALUES ({id:String}, {user_id:String}, {name:String})", parameters={'id': pid, 'user_id': current_user['id'], 'name': payload.name})
    return {"id": pid, "name": payload.name}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):
    # Delete all PCAP data associated with this project (packets, dns_log, metadata, files), then mappings and project
    client = get_ch_client()
    # Find all pcaps mapped to this project for this user
    pcaps = client.query(
        "SELECT pcap_id FROM pcap_project_map WHERE user_id = {user_id:String} AND project_id = {project_id:String}",
        parameters={'user_id': current_user['id'], 'project_id': project_id}
    ).result_rows
    for (pcap_id,) in pcaps:
        try:
            client.command("ALTER TABLE packets DELETE WHERE pcap_id = {pcap_id:String}", parameters={'pcap_id': str(pcap_id)})
            client.command("ALTER TABLE dns_log DELETE WHERE pcap_id = {pcap_id:String}", parameters={'pcap_id': str(pcap_id)})
            client.command("ALTER TABLE pcap_metadata DELETE WHERE id = {pcap_id:String}", parameters={'pcap_id': str(pcap_id)})
            # Remove file from disk
            file_path = UPLOAD_DIR / f"{pcap_id}.pcap"
            if file_path.exists():
                file_path.unlink()
        except Exception as e:
            print(f"[Project Delete] Error cleaning pcap {pcap_id}: {e}")
    # Remove mappings and the project record
    client.command("ALTER TABLE pcap_project_map DELETE WHERE user_id = {user_id:String} AND project_id = {project_id:String}", parameters={'user_id': current_user['id'], 'project_id': project_id})
    client.command("ALTER TABLE projects DELETE WHERE user_id = {user_id:String} AND id = {project_id:String}", parameters={'user_id': current_user['id'], 'project_id': project_id})
    return {"ok": True, "deleted_pcaps": len(pcaps)}

@app.get("/api/projects/{project_id}/files")
async def list_project_files(project_id: str, current_user: dict = Depends(get_current_user)):
    query = """
    SELECT m.id, m.file_name, m.upload_time, m.total_packets, m.file_size, m.capture_duration
    FROM pcap_project_map map
    INNER JOIN pcap_metadata m ON map.pcap_id = m.id
    WHERE map.user_id = {user_id:String} AND map.project_id = {project_id:String}
    ORDER BY m.upload_time DESC
    """
    res = get_ch_client().query(query, parameters={'user_id': current_user['id'], 'project_id': project_id})
    return [{
        "file_id": str(r[0]),
        "filename": r[1],
        "upload_time": r[2].isoformat(),
        "total_packets": r[3],
        "total_bytes": r[4],
        "capture_duration": r[5],
    } for r in res.result_rows]

@app.post("/api/projects/{project_id}/upload")
async def upload_pcap_to_project(project_id: str, background_tasks: BackgroundTasks, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    try:
        # Authorization and validation
        owns = get_ch_client().query(
            "SELECT COUNT() FROM projects WHERE id = {project_id:String} AND user_id = {user_id:String}",
            parameters={'project_id': project_id, 'user_id': current_user['id']}
        ).result_rows[0][0]
        if not owns:
            raise HTTPException(status_code=403, detail="Not authorized for this project")
        if not file.filename.endswith((".pcap", ".pcapng")):
            raise HTTPException(status_code=400, detail="Invalid file format. Only .pcap and .pcapng allowed")

        # Get existing files in this project
        existing_files_query = "SELECT pcap_id FROM pcap_project_map WHERE project_id = {project_id:String} AND user_id = {user_id:String}"
        existing_files = get_ch_client().query(existing_files_query, parameters={'project_id': project_id, 'user_id': current_user['id']}).result_rows

        # Delete old PCAP data and files
        for (old_pcap_id,) in existing_files:
            try:
                get_ch_client().command("ALTER TABLE packets DELETE WHERE pcap_id = {pcap_id:String}", parameters={'pcap_id': str(old_pcap_id)})
                get_ch_client().command("ALTER TABLE dns_log DELETE WHERE pcap_id = {pcap_id:String}", parameters={'pcap_id': str(old_pcap_id)})
                get_ch_client().command("ALTER TABLE pcap_metadata DELETE WHERE id = {pcap_id:String}", parameters={'pcap_id': str(old_pcap_id)})
                get_ch_client().command("ALTER TABLE pcap_project_map DELETE WHERE pcap_id = {pcap_id:String}", parameters={'pcap_id': str(old_pcap_id)})
                old_file = UPLOAD_DIR / f"{old_pcap_id}.pcap"
                if old_file.exists():
                    old_file.unlink()
                print(f"Deleted old PCAP: {old_pcap_id}")
            except Exception as e:
                print(f"[Cleanup] Error deleting old PCAP {old_pcap_id}: {e}")

        # Save new file
        file_id = uuid.uuid4()
        task_id = str(uuid.uuid4())
        saved_filename = f"{file_id}.pcap"
        file_path = UPLOAD_DIR / saved_filename

        # Ensure file is fully written to disk
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            buffer.flush()
            os.fsync(buffer.fileno())
        
        # Verify file was written successfully
        if not file_path.exists() or file_path.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="Failed to save uploaded file")
        
        print(f"[Upload] Saved file {saved_filename}, size: {file_path.stat().st_size} bytes")

        # Kick off background ingestion and map to project
        ANALYSIS_PROGRESS[task_id] = {"status": "processing", "progress": 0}
        background_tasks.add_task(parse_and_ingest_pcap_sync, file_path, file_id, file.filename, task_id, ANALYSIS_PROGRESS)
        get_ch_client().command(
            "INSERT INTO pcap_project_map (pcap_id, project_id, user_id) VALUES ({pcap_id:String}, {project_id:String}, {user_id:String})",
            parameters={'pcap_id': str(file_id), 'project_id': project_id, 'user_id': current_user['id']}
        )
        return {"task_id": task_id, "file_id": str(file_id), "replaced": len(existing_files)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Upload] Error: {e}")
        return {"error": "Upload failed"}


@app.get("/api/analyze/status/{task_id}")
async def get_analysis_status(task_id: str):
    progress = ANALYSIS_PROGRESS.get(task_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return progress

@app.post("/api/analyze/cancel/{task_id}")
async def cancel_analysis(task_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel a running analysis task."""
    if task_id in ANALYSIS_PROGRESS:
        ANALYSIS_PROGRESS[task_id]['status'] = 'cancelled'
        # We can't easily kill the thread, but the thread will check this status
        return {"message": "Cancellation requested"}
    raise HTTPException(status_code=404, detail="Task not found")

# --- End Auth & Projects ---

@app.get("/")
async def root():
    return {"message": "PCAP Analyzer API", "status": "running"}

@app.get("/api/health/schema")
async def schema_health():
    """Return current tables and any missing required tables."""
    client = get_ch_client()
    existing = [r[0] for r in client.query(f"SHOW TABLES FROM {CH_DATABASE}").result_rows]
    required = ["users", "projects", "pcap_project_map", "packets", "pcap_metadata"]
    missing = [t for t in required if t not in existing]
    return {
        "database": CH_DATABASE,
        "tables": existing,
        "missing": missing,
        "ok": len(missing) == 0
    }

@app.post("/api/upload")
async def upload_pcap(file: UploadFile = File(...)):
    """Upload PCAP file, parse, and ingest into ClickHouse (standalone)."""
    try:
        if not file.filename.endswith((".pcap", ".pcapng")):
            raise HTTPException(status_code=400, detail="Invalid file format. Only .pcap and .pcapng allowed")
        file_id = uuid.uuid4()
        saved_filename = f"{file_id}.pcap"
        file_path = UPLOAD_DIR / saved_filename
        
        # Ensure file is fully written to disk
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            buffer.flush()
            os.fsync(buffer.fileno())
        
        # Verify file was written successfully
        if not file_path.exists() or file_path.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="Failed to save uploaded file")
        
        print(f"[Upload] Saved file {saved_filename}, size: {file_path.stat().st_size} bytes")
        # Run ingestion in threadpool
        ingestion_result = await run_in_threadpool(parse_and_ingest_pcap_sync, file_path, file_id, file.filename, str(file_id), ANALYSIS_PROGRESS)
        return {"file_id": str(file_id), "filename": file.filename, "size": ingestion_result["total_bytes"], "path": str(file_path)}
    except HTTPException:
        raise
    except Exception:
        # Clean up the file if ingestion fails
        if 'file_path' in locals() and file_path.exists():
            file_path.unlink()
        return {"error": "Upload failed"}

@app.get("/api/files", response_model=List[Dict])
async def list_pcap_files(current_user: dict = Depends(get_current_user)):
    """List all uploaded PCAP files for the current user across projects."""
    try:
        query = """
        SELECT m.id, m.file_name, m.upload_time, m.total_packets, m.file_size, m.capture_duration
        FROM pcap_project_map map
        INNER JOIN pcap_metadata m ON map.pcap_id = m.id
        WHERE map.user_id = {user_id:String}
        ORDER BY m.upload_time DESC
        """
        result = get_ch_client().query(query, parameters={'user_id': current_user['id']})
        files = []
        for row in result.result_rows:
            files.append({
                "file_id": str(row[0]),
                "filename": row[1],
                "upload_time": row[2].isoformat(),
                "total_packets": row[3],
                "total_bytes": row[4],
                "capture_duration": row[5]
            })
        return files
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve file list: {e}")

@app.delete("/api/files/{file_id}")
async def delete_pcap_file(file_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a specific PCAP file's data from ClickHouse and the file itself."""
    try:
        # Delete from packets and dns tables
        get_ch_client().command("ALTER TABLE packets DELETE WHERE pcap_id = {pcap_id:String}", parameters={'pcap_id': file_id})
        get_ch_client().command("ALTER TABLE dns_log DELETE WHERE pcap_id = {pcap_id:String}", parameters={'pcap_id': file_id})
        # Delete from metadata table
        get_ch_client().command("ALTER TABLE pcap_metadata DELETE WHERE id = {pcap_id:String}", parameters={'pcap_id': file_id})
        
        # Delete the actual pcap file from disk (if it still exists)
        file_path = UPLOAD_DIR / f"{file_id}.pcap"
        if file_path.is_file():
            file_path.unlink()

        # Remove mapping entries
        get_ch_client().command("ALTER TABLE pcap_project_map DELETE WHERE pcap_id = {pcap_id:String} AND user_id = {user_id:String}", parameters={'pcap_id': file_id, 'user_id': current_user['id']})

        return {"message": f"Data for file {file_id} deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file data: {e}")

@app.get("/api/analyze/{file_id}")
async def analyze_pcap(file_id: str, current_user: dict = Depends(get_current_user)):
    """Analyze PCAP data from ClickHouse and return statistics."""
    try:
        # Get total packets and bytes from metadata
        metadata_result = get_ch_client().query("SELECT total_packets, file_size, capture_duration FROM pcap_metadata WHERE id = {pcap_id:String}", parameters={'pcap_id': file_id})
        if not metadata_result.result_rows:
            raise HTTPException(status_code=404, detail="PCAP metadata not found")
        total_packets, file_size, capture_duration = metadata_result.result_rows[0]

        # Protocol distribution
        protocol_result = get_ch_client().query("SELECT protocol, COUNT() FROM packets WHERE pcap_id = {pcap_id:String} GROUP BY protocol", parameters={'pcap_id': file_id})
        protocols = {row[0]: row[1] for row in protocol_result.result_rows}

        # Top sources
        top_src_result = get_ch_client().query("SELECT src_ip, COUNT() AS packets, SUM(length) AS bytes FROM packets WHERE pcap_id = {pcap_id:String} GROUP BY src_ip ORDER BY packets DESC LIMIT 10", parameters={'pcap_id': file_id})
        top_sources = []
        for row in top_src_result.result_rows:
            percentage = (row[2] / file_size * 100) if file_size > 0 else 0 # Use file_size here
            top_sources.append({"ip": str(row[0]), "packets": row[1], "bytes": row[2], "percentage": f"{percentage:.2f}%"})

        # Top destinations
        top_dst_result = get_ch_client().query("SELECT dst_ip, COUNT() AS packets, SUM(length) AS bytes FROM packets WHERE pcap_id = {pcap_id:String} GROUP BY dst_ip ORDER BY packets DESC LIMIT 10", parameters={'pcap_id': file_id})
        top_destinations = []
        for row in top_dst_result.result_rows:
            percentage = (row[2] / file_size * 100) if file_size > 0 else 0 # Use file_size here
            top_destinations.append({"ip": str(row[0]), "packets": row[1], "bytes": row[2], "percentage": f"{percentage:.2f}%"})

        # Traffic over time (dynamic interval based on duration)
        # Target ~500 points for the chart
        interval_seconds = 1
        if capture_duration > 0:
            if capture_duration > 3600 * 24: # > 1 day
                interval_seconds = 3600 # 1 hour
            elif capture_duration > 3600: # > 1 hour
                interval_seconds = 60 # 1 minute
            elif capture_duration > 600: # > 10 minutes
                interval_seconds = 10 # 10 seconds
            
        traffic_over_time_result = get_ch_client().query(
            f"SELECT toStartOfInterval(ts, INTERVAL {interval_seconds} second) AS time_sec, COUNT() AS packets FROM packets WHERE pcap_id = {{pcap_id:String}} GROUP BY time_sec ORDER BY time_sec ASC", 
            parameters={'pcap_id': file_id}
        )
        traffic_over_time = [{
            "time": row[0].isoformat(),
            "packets": row[1]
        } for row in traffic_over_time_result.result_rows]

        # Traffic by protocol over time (for stacked area chart)
        traffic_proto_result = get_ch_client().query(
            f"SELECT toStartOfInterval(ts, INTERVAL {interval_seconds} second) AS time_sec, protocol, COUNT() AS packets FROM packets WHERE pcap_id = {{pcap_id:String}} GROUP BY time_sec, protocol ORDER BY time_sec ASC",
            parameters={'pcap_id': file_id}
        )
        
        traffic_by_protocol_map = {}
        for row in traffic_proto_result.result_rows:
            ts_str = row[0].isoformat()
            proto = row[1]
            count = row[2]
            
            if ts_str not in traffic_by_protocol_map:
                traffic_by_protocol_map[ts_str] = {"time": ts_str}
            
            traffic_by_protocol_map[ts_str][proto] = count
            
        traffic_by_protocol = sorted(traffic_by_protocol_map.values(), key=lambda x: x['time'])

        return {
            "file_id": file_id,
            "packet_count": total_packets,
            "protocols": protocols,
            "top_sources": top_sources,
            "top_destinations": top_destinations,
            "traffic_over_time": traffic_over_time,
            "traffic_by_protocol": traffic_by_protocol,
            "capture_duration": capture_duration,
            "total_bytes": file_size # Use file_size here
        }

    except HTTPException:
        raise # Re-raise 404
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")

@app.get("/api/overview/{file_id}")
async def overview(file_id: str, current_user: dict = Depends(get_current_user)):
    """Return extended overview metrics for dashboard cards.
    Lightweight aggregates only (no deep inspection parsing yet).
    """
    try:
        # Basic metadata
        print(f"Executing meta query for file_id: {file_id}")
        meta = get_ch_client().query(
            "SELECT total_packets, file_size, capture_duration FROM pcap_metadata WHERE id = {pcap_id:String}",
            parameters={'pcap_id': file_id}
        )
        print(f"Meta query result: {meta.result_rows}")
        if not meta.result_rows:
            raise HTTPException(status_code=404, detail="PCAP metadata not found")
        total_packets, file_size, capture_duration = meta.result_rows[0]

        # Protocol counts
        print(f"Executing protocols query for file_id: {file_id}")
        protos_q = get_ch_client().query(
            "SELECT protocol, COUNT() FROM packets WHERE pcap_id = {pcap_id:String} GROUP BY protocol",
            parameters={'pcap_id': file_id}
        )
        print(f"Protocols query result: {protos_q.result_rows}")
        protocols = {r[0]: r[1] for r in protos_q.result_rows}

        # Traffic over time (dynamic interval)
        print(f"Executing traffic over time query for file_id: {file_id}")
        interval_seconds = 1
        if capture_duration > 0:
            if capture_duration > 3600 * 24: # > 1 day
                interval_seconds = 3600 # 1 hour
            elif capture_duration > 3600: # > 1 hour
                interval_seconds = 60 # 1 minute
            elif capture_duration > 600: # > 10 minutes
                interval_seconds = 10 # 10 seconds

        traffic_q = get_ch_client().query(
            f"SELECT toStartOfInterval(ts, INTERVAL {interval_seconds} second) AS t, COUNT() FROM packets WHERE pcap_id = {{pcap_id:String}} GROUP BY t ORDER BY t ASC",
            parameters={'pcap_id': file_id}
        )
        print(f"Traffic over time query result: {traffic_q.result_rows}")
        traffic = [{"time": r[0].isoformat(), "packets": r[1]} for r in traffic_q.result_rows]

        # Unique hosts
        print(f"Executing unique hosts query for file_id: {file_id}")
        hosts_q = get_ch_client().query(
            "SELECT uniq(ip) FROM (SELECT src_ip AS ip FROM packets WHERE pcap_id={pcap_id:String} UNION ALL SELECT dst_ip AS ip FROM packets WHERE pcap_id={pcap_id:String})",
            parameters={'pcap_id': file_id}
        )
        print(f"Unique hosts query result: {hosts_q.result_rows}")
        unique_hosts = hosts_q.result_rows[0][0] if hosts_q.result_rows else 0

        # Unique connections (src,dst pairs)
        print(f"Executing connections query for file_id: {file_id}")
        conns_q = get_ch_client().query(
            "SELECT COUNT() FROM (SELECT src_ip, dst_ip FROM packets WHERE pcap_id={pcap_id:String} GROUP BY src_ip, dst_ip)",
            parameters={'pcap_id': file_id}
        )
        print(f"Connections query result: {conns_q.result_rows}")
        connections = conns_q.result_rows[0][0] if conns_q.result_rows else 0

        # Open ports (unique destination ports >0)
        print(f"Executing open ports query for file_id: {file_id}")
        open_ports_q = get_ch_client().query(
            "SELECT uniq(dst_port) FROM packets WHERE pcap_id={pcap_id:String} AND dst_port != 0",
            parameters={'pcap_id': file_id}
        )
        print(f"Open ports query result: {open_ports_q.result_rows}")
        open_ports = open_ports_q.result_rows[0][0] if open_ports_q.result_rows else 0

        # Top destination IPs (heuristic servers)
        print(f"Executing top servers query for file_id: {file_id}")
        servers_q = get_ch_client().query(
            "SELECT dst_ip, COUNT() AS c, SUM(length) AS b FROM packets WHERE pcap_id={pcap_id:String} GROUP BY dst_ip ORDER BY c DESC LIMIT 10",
            parameters={'pcap_id': file_id}
        )
        print(f"Top servers query result: {servers_q.result_rows}")
        top_servers = [{"ip": str(r[0]), "packets": r[1], "bytes": r[2]} for r in servers_q.result_rows if str(r[0]) != '0.0.0.0']

        # Top destination ports overall
        print(f"Executing top ports query for file_id: {file_id}")
        top_ports_q = get_ch_client().query(
            "SELECT dst_port, COUNT() AS c FROM packets WHERE pcap_id={pcap_id:String} AND dst_port != 0 GROUP BY dst_port ORDER BY c DESC LIMIT 10",
            parameters={'pcap_id': file_id}
        )
        print(f"Top ports query result: {top_ports_q.result_rows}")
        top_ports = [{"port": int(r[0]), "count": r[1]} for r in top_ports_q.result_rows]

        categories = {
            "dns": protocols.get("DNS", 0) + protocols.get("mDNS", 0) + protocols.get("LLMNR", 0) + protocols.get("NBNS", 0),
            "http": protocols.get("HTTP", 0),
            "ssl": protocols.get("TLS", 0),
            "quic": protocols.get("QUIC", 0),
            "smb": protocols.get("SMB", 0) + protocols.get("NBNS", 0),
            "arp": protocols.get("ARP", 0),
            "telnet": protocols.get("Telnet", 0),
            "ftp": protocols.get("FTP", 0),
            "ssdp": protocols.get("SSDP", 0),
            "sip": protocols.get("SIP", 0),
            "dhcp": protocols.get("DHCP", 0),
            "icmp": protocols.get("ICMP", 0),
            "tcp": protocols.get("TCP", 0),
            "udp": protocols.get("UDP", 0),
            "open_ports": open_ports,
            "connections": connections,
            "hosts": unique_hosts,
            "servers": len(top_servers),
        }

        return {
            "file_id": file_id,
            "totals": {"packets": total_packets, "bytes": file_size, "duration": capture_duration},
            "protocols": protocols,
            "traffic_over_time": traffic,
            "metrics": {
                "unique_hosts": unique_hosts,
                "connections": connections,
                "open_ports": open_ports,
                "top_servers": top_servers,
                "top_destination_ports": top_ports,
            },
            "categories": categories,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Caught exception in overview: {e}")
        raise HTTPException(status_code=500, detail=f"Overview failed: {e}")

@app.get("/api/packets/{file_id}")
async def get_packets(file_id: str, limit: int = 1000, offset: int = 0, current_user: dict = Depends(get_current_user)):
    """Get packet details from ClickHouse with pagination. Default limit increased to 1000 for better UX."""
    try:
        # Cap max limit to prevent memory issues
        limit = min(limit, 10000)
        
        query = f"""
SELECT 
    ts, pcap_id, packet_number, src_ip, dst_ip, src_port, dst_port, protocol, length, file_offset, info 
    FROM packets 
    WHERE pcap_id = {{pcap_id:String}} 
    ORDER BY ts ASC, packet_number ASC 
    LIMIT {{limit:UInt32}} OFFSET {{offset:UInt32}}"""
        result = ch_client.query(query, parameters={'pcap_id': file_id, 'limit': limit, 'offset': offset})
        
        packets = []
        for row in result.result_rows:
            packets.append({
                "time": row[0].isoformat(),
                "pcap_id": str(row[1]),
                "number": row[2], # packet_number from DB
                "src_ip": str(row[3]),
                "dst_ip": str(row[4]),
                "src_port": row[5],
                "dst_port": row[6],
                "protocol": row[7],
                "length": row[8],
                "file_offset": row[9],
                "info": row[10]
            })
        
        # Get total count for pagination metadata
        total_count_result = ch_client.query("SELECT COUNT() FROM packets WHERE pcap_id = {pcap_id:String}", parameters={'pcap_id': file_id})
        total_count = total_count_result.result_rows[0][0]

        return {
            "packets": packets, 
            "total_count": total_count,
            "returned_count": len(packets),
            "offset": offset,
            "has_more": (offset + len(packets)) < total_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve packets: {e}")

@app.get("/api/packet/{file_id}/{packet_number}")
async def get_packet_detail(file_id: str, packet_number: int, current_user: dict = Depends(get_current_user)):
    """Get full details for a single packet from ClickHouse."""
    try:
        query = """
SELECT 
    ts, pcap_id, packet_number, src_ip, dst_ip, src_port, dst_port, protocol, length, file_offset, info, layers_json 
    FROM packets 
    WHERE pcap_id = {pcap_id:String} AND packet_number = {packet_number:UInt32}"""
        result = ch_client.query(query, parameters={'pcap_id': file_id, 'packet_number': packet_number})
        
        if not result.result_rows:
            raise HTTPException(status_code=404, detail=f"Packet {packet_number} not found for file {file_id}")
        
        row = result.result_rows[0]
        layers = json.loads(row[11]) if row[11] else []
        
        # Add Frame summary as first layer (like Wireshark)
        frame_info = {
            "name": "Frame",
            "fields": {
                "frame.number": row[2],
                "frame.time": row[0].isoformat(),
                "frame.len": row[8],
                "frame.protocols": row[7],
            }
        }
        
        # Prepend frame info to layers
        all_layers = [frame_info] + layers
        
        packet_detail = {
            "time": row[0].isoformat(),
            "pcap_id": str(row[1]),
            "number": row[2],
            "src_ip": str(row[3]),
            "dst_ip": str(row[4]),
            "src_port": row[5],
            "dst_port": row[6],
            "protocol": row[7],
            "length": row[8],
            "file_offset": row[9],
            "info": row[10],
            "layers": all_layers
        }
        return packet_detail
    except HTTPException:
        raise # Re-raise 404
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve packet detail: {e}")

def get_conversations_from_clickhouse(file_id: str):
    """Get network conversations for graph visualization from ClickHouse."""
    try:
        # Aggregate conversations
        conversation_result = ch_client.query("""
SELECT 
    src_ip, dst_ip, COUNT() AS packets, SUM(length) AS bytes
FROM packets 
WHERE pcap_id = {pcap_id:String} 
GROUP BY src_ip, dst_ip""", parameters={'pcap_id': file_id})
        
        nodes = []
        edges = []
        ip_to_id = {}
        node_id_counter = 0
        
        # Create nodes and edges from conversations
        for row in conversation_result.result_rows:
            src = str(row[0])
            dst = str(row[1])
            count = row[2]
            bytes_ = row[3]

            # Ensure consistent node IDs regardless of direction
            if src not in ip_to_id:
                ip_to_id[src] = node_id_counter
                nodes.append({"id": str(node_id_counter), "label": src})
                node_id_counter += 1
            if dst not in ip_to_id:
                ip_to_id[dst] = node_id_counter
                nodes.append({"id": str(node_id_counter), "label": dst})
                node_id_counter += 1
            
            edges.append({
                "from": str(ip_to_id[src]),
                "to": str(ip_to_id[dst]),
                "value": int(count),
                "bytes": int(bytes_),
                "title": f"{count} packets, {bytes_} bytes"
            })
            
        return {"nodes": nodes, "edges": edges}
    except Exception as e:
        print(f"Error getting conversations from ClickHouse: {e}")
        raise e

@app.get("/api/conversations/{file_id}")
async def get_conversations(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get network conversations for graph visualization."""
    if not file_id:
        raise HTTPException(status_code=400, detail="Invalid file_id")

    try:
        result = await run_in_threadpool(get_conversations_from_clickhouse, file_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get conversations: {e}")


@app.get("/api/node/{file_id}/{ip}")
async def get_node_summary(file_id: str, ip: str, current_user: dict = Depends(get_current_user)):
    """Return lightweight summary about a node (IP).
    Avoid heavy computations; simple aggregates only.
    """
    try:
        # Total inbound/outbound packets
        inbound = ch_client.query(
            "SELECT COUNT(), SUM(length) FROM packets WHERE pcap_id = {pcap_id:String} AND dst_ip = {ip:String}",
            parameters={'pcap_id': file_id, 'ip': ip}
        ).result_rows
        outbound = ch_client.query(
            "SELECT COUNT(), SUM(length) FROM packets WHERE pcap_id = {pcap_id:String} AND src_ip = {ip:String}",
            parameters={'pcap_id': file_id, 'ip': ip}
        ).result_rows

        inbound_packets, inbound_bytes = (inbound[0][0], inbound[0][1] or 0) if inbound else (0, 0)
        outbound_packets, outbound_bytes = (outbound[0][0], outbound[0][1] or 0) if outbound else (0, 0)

        # Top protocols across both directions
        protos = ch_client.query(
            """
            SELECT protocol, COUNT() AS c
            FROM packets
            WHERE pcap_id = {pcap_id:String} AND (src_ip = {ip:String} OR dst_ip = {ip:String})
            GROUP BY protocol
            ORDER BY c DESC
            LIMIT 5
            """,
            parameters={'pcap_id': file_id, 'ip': ip}
        )
        top_protocols = [{"protocol": r[0], "count": r[1]} for r in protos.result_rows]

        # Top destination ports for outbound traffic
        top_dst_ports_q = ch_client.query(
            "SELECT dst_port, COUNT() AS c FROM packets WHERE pcap_id = {pcap_id:String} AND src_ip = {ip:String} AND dst_port != 0 GROUP BY dst_port ORDER BY c DESC LIMIT 5",
            parameters={'pcap_id': file_id, 'ip': ip}
        )
        top_dst_ports = [{"port": int(r[0]), "count": r[1]} for r in top_dst_ports_q.result_rows]

        # Top source ports for inbound traffic
        top_src_ports_q = ch_client.query(
            "SELECT src_port, COUNT() AS c FROM packets WHERE pcap_id = {pcap_id:String} AND dst_ip = {ip:String} AND src_port != 0 GROUP BY src_port ORDER BY c DESC LIMIT 5",
            parameters={'pcap_id': file_id, 'ip': ip}
        )
        top_src_ports = [{"port": int(r[0]), "count": r[1]} for r in top_src_ports_q.result_rows]
        
        # GeoIP lookup
        geo_info = None
        if GEOIP_AVAILABLE and geoip_reader and ip != '0.0.0.0':
            try:
                response = geoip_reader.city(ip)
                geo_info = {
                    "country": response.country.name,
                    "country_code": response.country.iso_code,
                    "city": response.city.name,
                    "latitude": response.location.latitude,
                    "longitude": response.location.longitude,
                }
            except geoip2.errors.AddressNotFoundError:
                geo_info = {"error": "IP not found in GeoIP database (likely private/local)"}
            except Exception as e:
                geo_info = {"error": f"GeoIP lookup failed: {str(e)}"}

        return {
            "ip": ip,
            "inbound_packets": inbound_packets,
            "inbound_bytes": inbound_bytes,
            "outbound_packets": outbound_packets,
            "outbound_bytes": outbound_bytes,
            "top_protocols": top_protocols,
            "top_destination_ports": top_dst_ports,
            "top_source_ports": top_src_ports,
            "geo": geo_info,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get node summary: {e}")


@app.get("/api/geomap/{file_id}")
async def get_geomap_data(file_id: str, current_user: dict = Depends(get_current_user)):
    """Return all unique IPs with their geo locations and traffic stats for map visualization."""
    if not GEOIP_AVAILABLE or not geoip_reader:
        raise HTTPException(status_code=503, detail="GeoIP service not available. Install geoip2 library and download GeoLite2-City.mmdb")
    
    try:
        # Get unique IPs with packet/byte counts
        query = """
        SELECT 
            ip,
            SUM(packets) AS total_packets,
            SUM(bytes) AS total_bytes
        FROM (
            SELECT src_ip AS ip, COUNT() AS packets, SUM(length) AS bytes
            FROM packets
            WHERE pcap_id = {pcap_id:String} AND src_ip != '0.0.0.0'
            GROUP BY src_ip
            
            UNION ALL
            
            SELECT dst_ip AS ip, COUNT() AS packets, SUM(length) AS bytes
            FROM packets
            WHERE pcap_id = {pcap_id:String} AND dst_ip != '0.0.0.0'
            GROUP BY dst_ip
        )
        GROUP BY ip
        ORDER BY total_packets DESC
        LIMIT 100
        """
        
        result = ch_client.query(query, parameters={'pcap_id': file_id})
        
        locations = []
        for row in result.result_rows:
            ip = str(row[0])
            packets = row[1]
            bytes_ = row[2]
            
            try:
                response = geoip_reader.city(ip)
                if response.location.latitude and response.location.longitude:
                    locations.append({
                        "ip": ip,
                        "lat": response.location.latitude,
                        "lon": response.location.longitude,
                        "country": response.country.name or "Unknown",
                        "country_code": response.country.iso_code or "??",
                        "city": response.city.name or "Unknown",
                        "packets": packets,
                        "bytes": bytes_,
                    })
            except geoip2.errors.AddressNotFoundError:
                # Skip private/local IPs
                continue
            except Exception as e:
                print(f"GeoIP error for {ip}: {e}")
                continue
        
        return {
            "locations": locations,
            "total": len(locations),
            "geoip_available": True,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get geomap data: {e}")


# Feature Card Detail Endpoints

@app.get("/api/details/dns/{file_id}")
async def get_dns_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed DNS query information."""
    try:
        # Backward-compatible basic DNS details (will be superseded by /api/dns/... endpoints)
        base_query = """
        SELECT 
            ts, id_orig_h, id_resp_h, query, qtype_name, rcode_name, answers, AA, TC, RD, RA, TTLs
        FROM dns_log 
        WHERE pcap_id = {file_id:String}
        ORDER BY ts DESC
        LIMIT 300
        """
        result = ch_client.query(base_query, parameters={'file_id': file_id})

        dns_queries = []
        query_types: Dict[str, int] = {}
        rcodes: Dict[str, int] = {}
        domain_counts: Dict[str, int] = {}

        for row in result.result_rows:
            ts, src_ip, dst_ip, query_name, qtype_name, rcode_name, answers, AA, TC, RD, RA, TTLs = row
            answers = answers or []
            TTLs = TTLs or []
            dns_queries.append({
                "time": ts.isoformat(),
                "source": str(src_ip),
                "destination": str(dst_ip),
                "query": query_name,
                "qtype_name": qtype_name,
                "rcode_name": rcode_name,
                "answers": answers,
                "flags": {"AA": AA, "TC": TC, "RD": RD, "RA": RA},
                "ttls": TTLs,
            })
            if qtype_name:
                query_types[qtype_name] = query_types.get(qtype_name, 0) + 1
            if rcode_name:
                rcodes[rcode_name] = rcodes.get(rcode_name, 0) + 1
            if query_name:
                domain_counts[query_name] = domain_counts.get(query_name, 0) + 1

        top_domains_list = sorted(domain_counts.items(), key=lambda x: x[1], reverse=True)[:20]

        return {
            "total": len(dns_queries),
            "queries": dns_queries,  # Frontend will paginate soon
            "query_types": query_types,
            "rcodes": rcodes,
            "unique_domains": len(domain_counts),
            "top_domains": [{"domain": d, "count": c} for d, c in top_domains_list]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get DNS details: {e}")

@app.get("/api/dns/{file_id}/records")
async def dns_records(
    file_id: str,
    limit: int = 100,
    offset: int = 0,
    search: str = "",
    qtype: str = "",
    rcode: str = "",
    sort: str = "time_desc",
    current_user: dict = Depends(get_current_user)
):
    """Paginated DNS query records with server-side filtering.
    Filters:
      - search: substring match on query domain (case-insensitive)
      - qtype: comma-separated list of qtype_name
      - rcode: comma-separated list of rcode_name
    Sorting:
      - time_desc (default), time_asc, domain_asc, domain_desc
    """
    try:
        limit = max(1, min(limit, 500))
        # Build WHERE clauses
        where_clauses = ["pcap_id = {file_id:String}"]
        parameters = {'file_id': file_id}

        if search:
            # Note: Parameterized LIKE needs careful handling or using position() or similar
            # ClickHouse supports ilike or position(lower(str), lower(substr)) > 0
            where_clauses.append("position(lower(query), {search:String}) > 0")
            parameters['search'] = search.lower()

        if qtype:
            qtypes = [qt.strip() for qt in qtype.split(',') if qt.strip()]
            if qtypes:
                # ClickHouse parameter arrays for IN clause
                where_clauses.append("qtype_name IN {qtypes:Array(String)}")
                parameters['qtypes'] = qtypes

        if rcode:
            rcodes_list = [rc.strip() for rc in rcode.split(',') if rc.strip()]
            if rcodes_list:
                where_clauses.append("rcode_name IN {rcodes:Array(String)}")
                parameters['rcodes'] = rcodes_list

        where_sql = " AND ".join(where_clauses)

        sort_map = {
            "time_desc": "ts DESC",
            "time_asc": "ts ASC",
            "domain_asc": "query ASC",
            "domain_desc": "query DESC"
        }
        # Validate sort parameter to prevent injection
        if sort not in sort_map:
            sort = "time_desc"

        order_clause = sort_map.get(sort, "ts DESC")

        base_sql = f"""
        SELECT ts, id_orig_h, id_resp_h, query, qtype_name, rcode_name, answers, AA, TC, RD, RA, TTLs
        FROM dns_log
        WHERE {where_sql}
        ORDER BY {order_clause}
        LIMIT {{limit:UInt32}} OFFSET {{offset:UInt32}}
        """
        parameters['limit'] = limit
        parameters['offset'] = offset

        rows = ch_client.query(base_sql, parameters=parameters).result_rows

        # Total count for pagination
        count_sql = f"SELECT COUNT() FROM dns_log WHERE {where_sql}"
        total_count = ch_client.query(count_sql, parameters=parameters).result_rows[0][0]

        records = []
        for r in rows:
            ts, src_ip, dst_ip, domain, qtype_name, rcode_name, answers, AA, TC, RD, RA, TTLs = r
            records.append({
                "time": ts.isoformat(),
                "source": src_ip,
                "destination": dst_ip,
                "query": domain,
                "qtype_name": qtype_name,
                "rcode_name": rcode_name,
                "answers": answers or [],
                "flags": {"AA": AA, "TC": TC, "RD": RD, "RA": RA},
                "ttls": TTLs or []
            })

        return {
            "total": total_count,
            "returned": len(records),
            "offset": offset,
            "limit": limit,
            "has_more": (offset + len(records)) < total_count,
            "records": records
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch DNS records: {e}")

@app.get("/api/dns/{file_id}/aggregates")
async def dns_aggregates(
    file_id: str,
    search: str = "",
    qtype: str = "",
    rcode: str = "",
    top_limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Aggregated DNS statistics supporting filters matching /records."""
    try:
        # Reuse filter building logic
        where_clauses = ["pcap_id = {file_id:String}"]
        parameters = {'file_id': file_id}

        if search:
            where_clauses.append("position(lower(query), {search:String}) > 0")
            parameters['search'] = search.lower()
        if qtype:
            qtypes = [qt.strip() for qt in qtype.split(',') if qt.strip()]
            if qtypes:
                where_clauses.append("qtype_name IN {qtypes:Array(String)}")
                parameters['qtypes'] = qtypes
        if rcode:
            rcodes_list = [rc.strip() for rc in rcode.split(',') if rc.strip()]
            if rcodes_list:
                where_clauses.append("rcode_name IN {rcodes:Array(String)}")
                parameters['rcodes'] = rcodes_list

        where_sql = " AND ".join(where_clauses)

        total_sql = f"SELECT COUNT() FROM dns_log WHERE {where_sql}"
        total = ch_client.query(total_sql, parameters=parameters).result_rows[0][0]

        unique_domains_sql = f"SELECT uniq(query) FROM dns_log WHERE {where_sql}"
        unique_domains = ch_client.query(unique_domains_sql, parameters=parameters).result_rows[0][0]

        # Error Rate (NXDOMAIN / Total)
        nxdomain_sql = f"SELECT COUNT() FROM dns_log WHERE {where_sql} AND rcode_name = 'NXDOMAIN'"
        nxdomain_count = ch_client.query(nxdomain_sql, parameters=parameters).result_rows[0][0]
        error_rate = (nxdomain_count / total * 100) if total > 0 else 0

        qtypes_sql = f"SELECT qtype_name, COUNT() FROM dns_log WHERE {where_sql} GROUP BY qtype_name"
        qtype_rows = ch_client.query(qtypes_sql, parameters=parameters).result_rows
        qtype_map = {r[0]: r[1] for r in qtype_rows if r[0]}

        rcodes_sql = f"SELECT rcode_name, COUNT() FROM dns_log WHERE {where_sql} GROUP BY rcode_name"
        rcode_rows = ch_client.query(rcodes_sql, parameters=parameters).result_rows
        rcode_map = {r[0]: r[1] for r in rcode_rows if r[0]}

        top_domains_sql = f"""
        SELECT query, COUNT() AS c
        FROM dns_log
        WHERE {where_sql}
        GROUP BY query
        ORDER BY c DESC
        LIMIT {{top_limit:UInt32}}
        """
        parameters['top_limit'] = top_limit
        top_rows = ch_client.query(top_domains_sql, parameters=parameters).result_rows
        top_domains = [{"domain": r[0], "count": r[1]} for r in top_rows if r[0]]

        # QPS Over Time (dynamic interval)
        # First get time range to determine interval
        range_sql = f"SELECT min(ts), max(ts) FROM dns_log WHERE {where_sql}"
        range_res = ch_client.query(range_sql, parameters=parameters).result_rows
        
        interval_seconds = 1
        if range_res and range_res[0][0] and range_res[0][1]:
            start_ts, end_ts = range_res[0]
            duration = (end_ts - start_ts).total_seconds()
            if duration > 3600 * 24:
                interval_seconds = 3600
            elif duration > 3600:
                interval_seconds = 60
            elif duration > 600:
                interval_seconds = 10

        qps_sql = f"""
        SELECT toStartOfInterval(ts, INTERVAL {interval_seconds} second) AS t, COUNT() 
        FROM dns_log 
        WHERE {where_sql} 
        GROUP BY t 
        ORDER BY t ASC
        """
        qps_rows = ch_client.query(qps_sql, parameters=parameters).result_rows
        qps_data = [{"time": r[0].isoformat(), "count": r[1]} for r in qps_rows]

        return {
            "total": total,
            "unique_domains": unique_domains,
            "error_rate": error_rate,
            "query_types": qtype_map,
            "rcodes": rcode_map,
            "top_domains": top_domains,
            "qps_data": qps_data,
            "filters_applied": {
                "search": search or None,
                "qtype": qtype.split(',') if qtype else [],
                "rcode": rcode.split(',') if rcode else [],
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute DNS aggregates: {e}")

@app.get("/api/dns/{file_id}/security")
async def dns_security(file_id: str, current_user: dict = Depends(get_current_user)):
    """Security analysis for DNS traffic."""
    try:
        parameters = {'file_id': file_id}
        # 1. Potential DGA (High Entropy / Long Random-looking domains)
        # Heuristic: Length > 15 and NXDOMAIN or just long queries
        dga_sql = """
        SELECT query, length(query) as len, COUNT() as c
        FROM dns_log
        WHERE pcap_id = {file_id:String} AND length(query) > 15 AND rcode_name = 'NXDOMAIN'
        GROUP BY query
        ORDER BY len DESC, c DESC
        LIMIT 20
        """
        dga_rows = ch_client.query(dga_sql, parameters=parameters).result_rows
        dga_candidates = [{"domain": r[0], "length": r[1], "count": r[2], "reason": "Long NXDOMAIN"} for r in dga_rows]

        # 2. Potential Tunneling (Very long queries or TXT records with large responses)
        # Note: We don't have response size in dns_log yet, so we rely on query length
        tunnel_sql = """
        SELECT query, length(query) as len, qtype_name, COUNT() as c
        FROM dns_log
        WHERE pcap_id = {file_id:String} AND length(query) > 50
        GROUP BY query, qtype_name
        ORDER BY len DESC
        LIMIT 20
        """
        tunnel_rows = ch_client.query(tunnel_sql, parameters=parameters).result_rows
        tunnel_candidates = [{"domain": r[0], "length": r[1], "type": r[2], "count": r[3], "reason": "Excessive Length"} for r in tunnel_rows]

        # 3. Top Talkers (Clients)
        clients_sql = """
        SELECT id_orig_h, COUNT() as c, uniq(query) as unique_queries
        FROM dns_log
        WHERE pcap_id = {file_id:String}
        GROUP BY id_orig_h
        ORDER BY c DESC
        LIMIT 10
        """
        clients_rows = ch_client.query(clients_sql, parameters=parameters).result_rows
        top_clients = [{"ip": r[0], "count": r[1], "unique_queries": r[2]} for r in clients_rows]

        # 4. Rare Domains (Seen only once)
        rare_sql = """
        SELECT query, qtype_name
        FROM dns_log
        WHERE pcap_id = {file_id:String}
        GROUP BY query, qtype_name
        HAVING COUNT() = 1
        LIMIT 20
        """
        rare_rows = ch_client.query(rare_sql, parameters=parameters).result_rows
        rare_domains = [{"domain": r[0], "type": r[1]} for r in rare_rows]

        return {
            "dga_candidates": dga_candidates,
            "tunneling_candidates": tunnel_candidates,
            "top_clients": top_clients,
            "rare_domains": rare_domains
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute DNS security metrics: {e}")

@app.get("/api/details/http/{file_id}")
async def get_http_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed HTTP request/response information."""
    try:
        query = """
        SELECT 
            ts, src_ip, dst_ip, src_port, dst_port, info, layers_json
        FROM packets 
        WHERE pcap_id = {file_id:String} AND protocol = 'HTTP'
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query, parameters={'file_id': file_id})
        
        http_requests = []
        methods = {}
        hosts = {}
        user_agents = {}
        status_codes = {}
        
        for row in result.result_rows:
            ts, src_ip, dst_ip, src_port, dst_port, info, layers_json_str = row
            
            try:
                layers = json.loads(layers_json_str) if layers_json_str else []
                http_layer = next((l for l in layers if l.get('name', '').lower() == 'http'), None)
                
                if http_layer:
                    fields = http_layer.get('fields', {})
                    method = fields.get('http.request.method', fields.get('http.response.code', 'Unknown'))
                    host = fields.get('http.host', 'Unknown')
                    user_agent = fields.get('http.user_agent', 'Unknown')
                    uri = fields.get('http.request.uri', '')
                    
                    http_requests.append({
                        "time": ts.isoformat(),
                        "source": f"{src_ip}:{src_port}",
                        "destination": f"{dst_ip}:{dst_port}",
                        "method": method,
                        "host": host,
                        "uri": uri,
                        "user_agent": user_agent,
                        "info": info
                    })
                    
                    if method.isdigit():  # Response code
                        status_codes[method] = status_codes.get(method, 0) + 1
                    else:
                        methods[method] = methods.get(method, 0) + 1
                    
                    if host != 'Unknown':
                        hosts[host] = hosts.get(host, 0) + 1
                    if user_agent != 'Unknown':
                        user_agents[user_agent] = user_agents.get(user_agent, 0) + 1
            except:
                http_requests.append({
                    "time": ts.isoformat(),
                    "source": f"{src_ip}:{src_port}",
                    "destination": f"{dst_ip}:{dst_port}",
                    "method": "Unknown",
                    "host": "Unknown",
                    "uri": "",
                    "user_agent": "Unknown",
                    "info": info
                })
        
        top_hosts = sorted(hosts.items(), key=lambda x: x[1], reverse=True)[:20]
        top_user_agents = sorted(user_agents.items(), key=lambda x: x[1], reverse=True)[:10]
        
        return {
            "total": len(http_requests),
            "requests": http_requests[:100],
            "methods": methods,
            "status_codes": status_codes,
            "top_hosts": [{"host": h[0], "count": h[1]} for h in top_hosts],
            "top_user_agents": [{"user_agent": ua[0], "count": ua[1]} for ua in top_user_agents]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get HTTP details: {e}")


@app.get("/api/details/tls/{file_id}")
async def get_tls_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed TLS/SSL session information."""
    try:
        query = """
        SELECT 
            ts, src_ip, dst_ip, src_port, dst_port, info, layers_json
        FROM packets 
        WHERE pcap_id = {file_id:String} AND protocol = 'TLS'
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query, parameters={'file_id': file_id})
        
        tls_sessions = []
        tls_versions = {}
        cipher_suites = {}
        sni_hosts = {}
        
        for row in result.result_rows:
            ts, src_ip, dst_ip, src_port, dst_port, info, layers_json_str = row
            
            try:
                layers = json.loads(layers_json_str) if layers_json_str else []
                tls_layer = next((l for l in layers if 'tls' in l.get('name', '').lower()), None)
                
                if tls_layer:
                    fields = tls_layer.get('fields', {})
                    version = fields.get('tls.handshake.version', 'Unknown')
                    cipher = fields.get('tls.handshake.ciphersuite', 'Unknown')
                    sni = fields.get('tls.handshake.extensions_server_name', 'Unknown')
                    
                    tls_sessions.append({
                        "time": ts.isoformat(),
                        "source": f"{src_ip}:{src_port}",
                        "destination": f"{dst_ip}:{dst_port}",
                        "version": version,
                        "cipher": cipher,
                        "sni": sni,
                        "info": info
                    })
                    
                    if version != 'Unknown':
                        tls_versions[version] = tls_versions.get(version, 0) + 1
                    if cipher != 'Unknown':
                        cipher_suites[cipher] = cipher_suites.get(cipher, 0) + 1
                    if sni != 'Unknown':
                        sni_hosts[sni] = sni_hosts.get(sni, 0) + 1
            except:
                tls_sessions.append({
                    "time": ts.isoformat(),
                    "source": f"{src_ip}:{src_port}",
                    "destination": f"{dst_ip}:{dst_port}",
                    "version": "Unknown",
                    "cipher": "Unknown",
                    "sni": "Unknown",
                    "info": info
                })
        
        return {
            "total": len(tls_sessions),
            "sessions": tls_sessions[:100],
            "versions": tls_versions,
            "top_ciphers": dict(sorted(cipher_suites.items(), key=lambda x: x[1], reverse=True)[:10]),
            "top_sni": dict(sorted(sni_hosts.items(), key=lambda x: x[1], reverse=True)[:20])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get TLS details: {e}")


@app.get("/api/details/ports/{file_id}")
async def get_open_ports_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed open ports information."""
    try:
        query = """
        SELECT 
            dst_port, 
            protocol,
            COUNT() AS connections,
            uniq(src_ip) AS unique_sources,
            uniq(dst_ip) AS unique_destinations,
            SUM(length) AS total_bytes
        FROM packets 
        WHERE pcap_id = {file_id:String} AND dst_port != 0
        GROUP BY dst_port, protocol
        ORDER BY connections DESC
        LIMIT 100
        """
        result = ch_client.query(query, parameters={'file_id': file_id})
        
        ports_data = []
        port_services = {
            21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
            80: "HTTP", 110: "POP3", 143: "IMAP", 443: "HTTPS", 3306: "MySQL",
            3389: "RDP", 5432: "PostgreSQL", 6379: "Redis", 8080: "HTTP-Alt", 27017: "MongoDB"
        }
        
        for row in result.result_rows:
            port, protocol, connections, unique_src, unique_dst, total_bytes = row
            service = port_services.get(port, "Unknown")
            
            ports_data.append({
                "port": port,
                "protocol": protocol,
                "service": service,
                "connections": connections,
                "unique_sources": unique_src,
                "unique_destinations": unique_dst,
                "bytes": total_bytes
            })
        
        return {
            "total_ports": len(ports_data),
            "ports": ports_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get ports details: {e}")


@app.get("/api/details/connections/{file_id}")
async def get_connections_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed connection information."""
    try:
        query = """
        SELECT 
            src_ip, dst_ip, protocol,
            COUNT() AS packets,
            SUM(length) AS bytes,
            min(ts) AS first_seen,
            max(ts) AS last_seen
        FROM packets 
        WHERE pcap_id = {file_id:String}
        GROUP BY src_ip, dst_ip, protocol
        ORDER BY packets DESC
        LIMIT 200
        """
        result = ch_client.query(query, parameters={'file_id': file_id})
        
        connections = []
        for row in result.result_rows:
            src_ip, dst_ip, protocol, packets, bytes_val, first_seen, last_seen = row
            duration = (last_seen - first_seen).total_seconds() if last_seen and first_seen else 0
            
            connections.append({
                "source": str(src_ip),
                "destination": str(dst_ip),
                "protocol": protocol,
                "packets": packets,
                "bytes": bytes_val,
                "first_seen": first_seen.isoformat() if first_seen else None,
                "last_seen": last_seen.isoformat() if last_seen else None,
                "duration": duration
            })
        
        return {
            "total": len(connections),
            "connections": connections
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get connections details: {e}")


@app.get("/api/details/arp/{file_id}")
async def get_arp_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed ARP information."""
    try:
        query = """
        SELECT 
            ts, src_ip, dst_ip, info, layers_json
        FROM packets 
        WHERE pcap_id = {file_id:String} AND protocol = 'ARP'
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query, parameters={'file_id': file_id})
        
        arp_packets = []
        ip_mac_map = {}
        
        for row in result.result_rows:
            ts, src_ip, dst_ip, info, layers_json_str = row
            
            try:
                layers = json.loads(layers_json_str) if layers_json_str else []
                arp_layer = next((l for l in layers if l.get('name', '').lower() == 'arp'), None)
                
                if arp_layer:
                    fields = arp_layer.get('fields', {})
                    src_mac = fields.get('arp.src.hw_mac', 'Unknown')
                    dst_mac = fields.get('arp.dst.hw_mac', 'Unknown')
                    src_proto = fields.get('arp.src.proto_ipv4', str(src_ip))
                    dst_proto = fields.get('arp.dst.proto_ipv4', str(dst_ip))
                    opcode = fields.get('arp.opcode', 'Unknown')
                    
                    arp_packets.append({
                        "time": ts.isoformat(),
                        "src_ip": src_proto,
                        "src_mac": src_mac,
                        "dst_ip": dst_proto,
                        "dst_mac": dst_mac,
                        "opcode": opcode,
                        "info": info
                    })
                    
                    # Track IP-MAC mappings
                    if src_proto and src_mac != 'Unknown':
                        if src_proto not in ip_mac_map:
                            ip_mac_map[src_proto] = set()
                        ip_mac_map[src_proto].add(src_mac)
            except:
                arp_packets.append({
                    "time": ts.isoformat(),
                    "src_ip": str(src_ip),
                    "src_mac": "Unknown",
                    "dst_ip": str(dst_ip),
                    "dst_mac": "Unknown",
                    "opcode": "Unknown",
                    "info": info
                })
        
        # Detect potential spoofing (multiple MACs for same IP)
        conflicts = []
        for ip, macs in ip_mac_map.items():
            if len(macs) > 1:
                conflicts.append({"ip": ip, "macs": list(macs)})
        
        return {
            "total": len(arp_packets),
            "packets": arp_packets[:100],
            "conflicts": conflicts
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get ARP details: {e}")


@app.get("/api/details/smb/{file_id}")
async def get_smb_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed SMB information."""
    try:
        query = """
        SELECT 
            ts, src_ip, dst_ip, src_port, dst_port, info
        FROM packets 
        WHERE pcap_id = {file_id:String} AND (protocol = 'SMB' OR protocol = 'NBNS')
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query, parameters={'file_id': file_id})
        
        smb_activity = []
        for row in result.result_rows:
            ts, src_ip, dst_ip, src_port, dst_port, info = row
            
            smb_activity.append({
                "time": ts.isoformat(),
                "source": f"{src_ip}:{src_port}",
                "destination": f"{dst_ip}:{dst_port}",
                "info": info
            })
        
        return {
            "total": len(smb_activity),
            "activity": smb_activity[:100]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get SMB details: {e}")


@app.get("/api/details/generic/{file_id}")
async def get_generic_protocol_details(file_id: str, protocol: str, current_user: dict = Depends(get_current_user)):
    """Get generic packet details for a specific protocol."""
    try:
        # Sanitize protocol to prevent injection (though ClickHouse parameters handle this)
        # We allow comma separated protocols for grouping
        protocols = [p.strip() for p in protocol.split(',')]
        
        if not protocols:
             raise HTTPException(status_code=400, detail="Protocol required")

        # Build IN clause
        # ClickHouse driver can handle lists/arrays for IN clauses if passed as parameters
        
        query = """
        SELECT 
            ts, src_ip, dst_ip, src_port, dst_port, info, length
        FROM packets 
        WHERE pcap_id = {file_id:String} AND protocol IN {protocols:Array(String)}
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query, parameters={'file_id': file_id, 'protocols': protocols})
        
        packets = []
        for row in result.result_rows:
            ts, src_ip, dst_ip, src_port, dst_port, info, length = row
            
            packets.append({
                "time": ts.isoformat(),
                "source": f"{src_ip}:{src_port}" if src_port else src_ip,
                "destination": f"{dst_ip}:{dst_port}" if dst_port else dst_ip,
                "info": info,
                "length": length
            })
        
        return {
            "protocol": protocol,
            "total": len(packets),
            "packets": packets
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get generic details: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)