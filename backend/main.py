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
    exists = get_ch_client().query(f"SELECT COUNT() FROM users WHERE email = '{payload.email}'").result_rows[0][0]
    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    get_ch_client().command(
        f"""
        INSERT INTO users (id, email, password_hash) VALUES ('{user_id}', '{payload.email}', '{hash_password(payload.password)}')
        """
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
    res = get_ch_client().query(f"SELECT id, name, created_at FROM projects WHERE user_id = '{current_user['id']}' ORDER BY created_at DESC")
    return [{"id": str(r[0]), "name": r[1], "created_at": r[2].isoformat()} for r in res.result_rows]

@app.post("/api/projects")
async def create_project(payload: ProjectCreateRequest, current_user: dict = Depends(get_current_user)):
    pid = str(uuid.uuid4())
    get_ch_client().command(f"INSERT INTO projects (id, user_id, name) VALUES ('{pid}', '{current_user['id']}', '{payload.name}')")
    return {"id": pid, "name": payload.name}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):
    get_ch_client().command(f"ALTER TABLE pcap_project_map DELETE WHERE user_id = '{current_user['id']}' AND project_id = '{project_id}'")
    get_ch_client().command(f"ALTER TABLE projects DELETE WHERE user_id = '{current_user['id']}' AND id = '{project_id}'")
    return {"ok": True}

@app.get("/api/projects/{project_id}/files")
async def list_project_files(project_id: str, current_user: dict = Depends(get_current_user)):
    query = f"""
    SELECT m.id, m.file_name, m.upload_time, m.total_packets, m.file_size, m.capture_duration
    FROM pcap_project_map map
    INNER JOIN pcap_metadata m ON map.pcap_id = m.id
    WHERE map.user_id = '{current_user['id']}' AND map.project_id = '{project_id}'
    ORDER BY m.upload_time DESC
    """
    res = get_ch_client().query(query)
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
            f"SELECT COUNT() FROM projects WHERE id = '{project_id}' AND user_id = '{current_user['id']}'"
        ).result_rows[0][0]
        if not owns:
            raise HTTPException(status_code=403, detail="Not authorized for this project")
        if not file.filename.endswith((".pcap", ".pcapng")):
            raise HTTPException(status_code=400, detail="Invalid file format. Only .pcap and .pcapng allowed")

        # Get existing files in this project
        existing_files_query = f"SELECT pcap_id FROM pcap_project_map WHERE project_id = '{project_id}' AND user_id = '{current_user['id']}'"
        existing_files = get_ch_client().query(existing_files_query).result_rows

        # Delete old PCAP data and files
        for (old_pcap_id,) in existing_files:
            try:
                get_ch_client().command(f"ALTER TABLE packets DELETE WHERE pcap_id = '{old_pcap_id}'")
                get_ch_client().command(f"ALTER TABLE pcap_metadata DELETE WHERE id = '{old_pcap_id}'")
                get_ch_client().command(f"ALTER TABLE pcap_project_map DELETE WHERE pcap_id = '{old_pcap_id}'")
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

        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Kick off background ingestion and map to project
        ANALYSIS_PROGRESS[task_id] = {"status": "processing", "progress": 0}
        background_tasks.add_task(parse_and_ingest_pcap_sync, file_path, file_id, file.filename, task_id, ANALYSIS_PROGRESS)
        get_ch_client().command(
            f"INSERT INTO pcap_project_map (pcap_id, project_id, user_id) VALUES ('{file_id}', '{project_id}', '{current_user['id']}')"
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
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
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
        query = f"""
        SELECT m.id, m.file_name, m.upload_time, m.total_packets, m.file_size, m.capture_duration
        FROM pcap_project_map map
        INNER JOIN pcap_metadata m ON map.pcap_id = m.id
        WHERE map.user_id = '{current_user['id']}'
        ORDER BY m.upload_time DESC
        """
        result = get_ch_client().query(query)
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
        # Delete from packets table
        get_ch_client().command(f"ALTER TABLE packets DELETE WHERE pcap_id = '{file_id}'")
        # Delete from metadata table
        get_ch_client().command(f"ALTER TABLE pcap_metadata DELETE WHERE id = '{file_id}'")
        
        # Delete the actual pcap file from disk (if it still exists)
        file_path = UPLOAD_DIR / f"{file_id}.pcap"
        if file_path.is_file():
            file_path.unlink()

        return {"message": f"Data for file {file_id} deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file data: {e}")

@app.get("/api/analyze/{file_id}")
async def analyze_pcap(file_id: str, current_user: dict = Depends(get_current_user)):
    """Analyze PCAP data from ClickHouse and return statistics."""
    try:
        # Get total packets and bytes from metadata
        metadata_result = get_ch_client().query(f"SELECT total_packets, file_size, capture_duration FROM pcap_metadata WHERE id = '{file_id}'")
        if not metadata_result.result_rows:
            raise HTTPException(status_code=404, detail="PCAP metadata not found")
        total_packets, file_size, capture_duration = metadata_result.result_rows[0]

        # Protocol distribution
        protocol_result = get_ch_client().query(f"SELECT protocol, COUNT() FROM packets WHERE pcap_id = '{file_id}' GROUP BY protocol")
        protocols = {row[0]: row[1] for row in protocol_result.result_rows}

        # Top sources
        top_src_result = get_ch_client().query(f"SELECT src_ip, COUNT() AS packets, SUM(length) AS bytes FROM packets WHERE pcap_id = '{file_id}' GROUP BY src_ip ORDER BY packets DESC LIMIT 10")
        top_sources = []
        for row in top_src_result.result_rows:
            percentage = (row[2] / file_size * 100) if file_size > 0 else 0 # Use file_size here
            top_sources.append({"ip": str(row[0]), "packets": row[1], "bytes": row[2], "percentage": f"{percentage:.2f}%"})

        # Top destinations
        top_dst_result = get_ch_client().query(f"SELECT dst_ip, COUNT() AS packets, SUM(length) AS bytes FROM packets WHERE pcap_id = '{file_id}' GROUP BY dst_ip ORDER BY packets DESC LIMIT 10")
        top_destinations = []
        for row in top_dst_result.result_rows:
            percentage = (row[2] / file_size * 100) if file_size > 0 else 0 # Use file_size here
            top_destinations.append({"ip": str(row[0]), "packets": row[1], "bytes": row[2], "percentage": f"{percentage:.2f}%"})

        # Traffic over time (e.g., per second or minute)
        # For simplicity, let's aggregate per second for now
        # Use toStartOfInterval with 1 second instead of toStartOfSecond for DateTime compatibility
        traffic_over_time_result = get_ch_client().query(f"SELECT toStartOfInterval(ts, INTERVAL 1 second) AS time_sec, COUNT() AS packets FROM packets WHERE pcap_id = '{file_id}' GROUP BY time_sec ORDER BY time_sec ASC")
        traffic_over_time = [{
            "time": row[0].isoformat(),
            "packets": row[1]
        } for row in traffic_over_time_result.result_rows]

        return {
            "file_id": file_id,
            "packet_count": total_packets,
            "protocols": protocols,
            "top_sources": top_sources,
            "top_destinations": top_destinations,
            "traffic_over_time": traffic_over_time,
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
            f"SELECT total_packets, file_size, capture_duration FROM pcap_metadata WHERE id = '{file_id}'"
        )
        print(f"Meta query result: {meta.result_rows}")
        if not meta.result_rows:
            raise HTTPException(status_code=404, detail="PCAP metadata not found")
        total_packets, file_size, capture_duration = meta.result_rows[0]

        # Protocol counts
        print(f"Executing protocols query for file_id: {file_id}")
        protos_q = get_ch_client().query(
            f"SELECT protocol, COUNT() FROM packets WHERE pcap_id = '{file_id}' GROUP BY protocol"
        )
        print(f"Protocols query result: {protos_q.result_rows}")
        protocols = {r[0]: r[1] for r in protos_q.result_rows}

        # Traffic over time (second resolution)
        print(f"Executing traffic over time query for file_id: {file_id}")
        traffic_q = get_ch_client().query(
            f"SELECT toStartOfInterval(ts, INTERVAL 1 second) AS t, COUNT() FROM packets WHERE pcap_id = '{file_id}' GROUP BY t ORDER BY t ASC"
        )
        print(f"Traffic over time query result: {traffic_q.result_rows}")
        traffic = [{"time": r[0].isoformat(), "packets": r[1]} for r in traffic_q.result_rows]

        # Unique hosts
        print(f"Executing unique hosts query for file_id: {file_id}")
        hosts_q = get_ch_client().query(
            f"SELECT uniq(ip) FROM (SELECT src_ip AS ip FROM packets WHERE pcap_id='{file_id}' UNION ALL SELECT dst_ip AS ip FROM packets WHERE pcap_id='{file_id}')"
        )
        print(f"Unique hosts query result: {hosts_q.result_rows}")
        unique_hosts = hosts_q.result_rows[0][0] if hosts_q.result_rows else 0

        # Unique connections (src,dst pairs)
        print(f"Executing connections query for file_id: {file_id}")
        conns_q = get_ch_client().query(
            f"SELECT COUNT() FROM (SELECT src_ip, dst_ip FROM packets WHERE pcap_id='{file_id}' GROUP BY src_ip, dst_ip)"
        )
        print(f"Connections query result: {conns_q.result_rows}")
        connections = conns_q.result_rows[0][0] if conns_q.result_rows else 0

        # Open ports (unique destination ports >0)
        print(f"Executing open ports query for file_id: {file_id}")
        open_ports_q = get_ch_client().query(
            f"SELECT uniq(dst_port) FROM packets WHERE pcap_id='{file_id}' AND dst_port != 0"
        )
        print(f"Open ports query result: {open_ports_q.result_rows}")
        open_ports = open_ports_q.result_rows[0][0] if open_ports_q.result_rows else 0

        # Top destination IPs (heuristic servers)
        print(f"Executing top servers query for file_id: {file_id}")
        servers_q = get_ch_client().query(
            f"SELECT dst_ip, COUNT() AS c, SUM(length) AS b FROM packets WHERE pcap_id='{file_id}' GROUP BY dst_ip ORDER BY c DESC LIMIT 10"
        )
        print(f"Top servers query result: {servers_q.result_rows}")
        top_servers = [{"ip": str(r[0]), "packets": r[1], "bytes": r[2]} for r in servers_q.result_rows if str(r[0]) != '0.0.0.0']

        # Top destination ports overall
        print(f"Executing top ports query for file_id: {file_id}")
        top_ports_q = get_ch_client().query(
            f"SELECT dst_port, COUNT() AS c FROM packets WHERE pcap_id='{file_id}' AND dst_port != 0 GROUP BY dst_port ORDER BY c DESC LIMIT 10"
        )
        print(f"Top ports query result: {top_ports_q.result_rows}")
        top_ports = [{"port": int(r[0]), "count": r[1]} for r in top_ports_q.result_rows]

        categories = {
            "dns": protocols.get("DNS", 0),
            "http": protocols.get("HTTP", 0),
            "ssl": protocols.get("TLS", 0),
            "quic": protocols.get("QUIC", 0),
            "smb": protocols.get("SMB", 0) + protocols.get("NBNS", 0),
            "arp": protocols.get("ARP", 0),
            "telnet": protocols.get("Telnet", 0),
            "ftp": protocols.get("FTP", 0),
            "ssdp": protocols.get("SSDP", 0),
            "sip": protocols.get("SIP", 0),
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
    WHERE pcap_id = '{file_id}' 
    ORDER BY ts ASC, packet_number ASC 
    LIMIT {limit} OFFSET {offset}"""
        result = ch_client.query(query)
        
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
        total_count_result = ch_client.query(f"SELECT COUNT() FROM packets WHERE pcap_id = '{file_id}'")
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
        query = f"""
SELECT 
    ts, pcap_id, packet_number, src_ip, dst_ip, src_port, dst_port, protocol, length, file_offset, info, layers_json 
    FROM packets 
    WHERE pcap_id = '{file_id}' AND packet_number = {packet_number}"""
        result = ch_client.query(query)
        
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
        conversation_result = ch_client.query(f"""
SELECT 
    src_ip, dst_ip, COUNT() AS packets, SUM(length) AS bytes
FROM packets 
WHERE pcap_id = '{file_id}' 
GROUP BY src_ip, dst_ip""")
        
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
            f"SELECT COUNT(), SUM(length) FROM packets WHERE pcap_id = '{file_id}' AND dst_ip = '{ip}'"
        ).result_rows
        outbound = ch_client.query(
            f"SELECT COUNT(), SUM(length) FROM packets WHERE pcap_id = '{file_id}' AND src_ip = '{ip}'"
        ).result_rows

        inbound_packets, inbound_bytes = (inbound[0][0], inbound[0][1] or 0) if inbound else (0, 0)
        outbound_packets, outbound_bytes = (outbound[0][0], outbound[0][1] or 0) if outbound else (0, 0)

        # Top protocols across both directions
        protos = ch_client.query(
            f"""
            SELECT protocol, COUNT() AS c
            FROM packets
            WHERE pcap_id = '{file_id}' AND (src_ip = '{ip}' OR dst_ip = '{ip}')
            GROUP BY protocol
            ORDER BY c DESC
            LIMIT 5
            """
        )
        top_protocols = [{"protocol": r[0], "count": r[1]} for r in protos.result_rows]

        # Top destination ports for outbound traffic
        top_dst_ports_q = ch_client.query(
            f"SELECT dst_port, COUNT() AS c FROM packets WHERE pcap_id = '{file_id}' AND src_ip = '{ip}' AND dst_port != 0 GROUP BY dst_port ORDER BY c DESC LIMIT 5"
        )
        top_dst_ports = [{"port": int(r[0]), "count": r[1]} for r in top_dst_ports_q.result_rows]

        # Top source ports for inbound traffic
        top_src_ports_q = ch_client.query(
            f"SELECT src_port, COUNT() AS c FROM packets WHERE pcap_id = '{file_id}' AND dst_ip = '{ip}' AND src_port != 0 GROUP BY src_port ORDER BY c DESC LIMIT 5"
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
        query = f"""
        SELECT 
            ip,
            SUM(packets) AS total_packets,
            SUM(bytes) AS total_bytes
        FROM (
            SELECT src_ip AS ip, COUNT() AS packets, SUM(length) AS bytes
            FROM packets
            WHERE pcap_id = '{file_id}' AND src_ip != '0.0.0.0'
            GROUP BY src_ip
            
            UNION ALL
            
            SELECT dst_ip AS ip, COUNT() AS packets, SUM(length) AS bytes
            FROM packets
            WHERE pcap_id = '{file_id}' AND dst_ip != '0.0.0.0'
            GROUP BY dst_ip
        )
        GROUP BY ip
        ORDER BY total_packets DESC
        LIMIT 100
        """
        
        result = ch_client.query(query)
        
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
        # Query from the dns_log table (Zeek-compatible format)
        query = f"""
        SELECT 
            ts, id_orig_h, id_resp_h, query, qtype_name, rcode_name, answers
        FROM dns_log 
        WHERE pcap_id = '{file_id}'
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query)
        
        dns_queries = []
        query_types = {}
        top_domains = {}
        
        for row in result.result_rows:
            ts, src_ip, dst_ip, query_name, qtype_name, rcode_name, answers = row
            
            dns_queries.append({
                "time": ts.isoformat(),
                "source": str(src_ip),
                "destination": str(dst_ip),
                "query": query_name,
                "type": qtype_name,
                "rcode": rcode_name,
                "answers": answers if answers else []
            })
            
            # Aggregate stats
            query_types[qtype_name] = query_types.get(qtype_name, 0) + 1
            top_domains[query_name] = top_domains.get(query_name, 0) + 1
        
        # Get top 20 domains
        top_domains_list = sorted(top_domains.items(), key=lambda x: x[1], reverse=True)[:20]
        
        return {
            "total": len(dns_queries),
            "queries": dns_queries[:100],  # Return first 100 for display
            "query_types": query_types,
            "top_domains": [{"domain": d[0], "count": d[1]} for d in top_domains_list]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get DNS details: {e}")


@app.get("/api/details/http/{file_id}")
async def get_http_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed HTTP request/response information."""
    try:
        query = f"""
        SELECT 
            ts, src_ip, dst_ip, src_port, dst_port, info, layers_json
        FROM packets 
        WHERE pcap_id = '{file_id}' AND protocol = 'HTTP'
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query)
        
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
        query = f"""
        SELECT 
            ts, src_ip, dst_ip, src_port, dst_port, info, layers_json
        FROM packets 
        WHERE pcap_id = '{file_id}' AND protocol = 'TLS'
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query)
        
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
        query = f"""
        SELECT 
            dst_port, 
            protocol,
            COUNT() AS connections,
            uniq(src_ip) AS unique_sources,
            uniq(dst_ip) AS unique_destinations,
            SUM(length) AS total_bytes
        FROM packets 
        WHERE pcap_id = '{file_id}' AND dst_port != 0
        GROUP BY dst_port, protocol
        ORDER BY connections DESC
        LIMIT 100
        """
        result = ch_client.query(query)
        
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
        query = f"""
        SELECT 
            src_ip, dst_ip, protocol,
            COUNT() AS packets,
            SUM(length) AS bytes,
            min(ts) AS first_seen,
            max(ts) AS last_seen
        FROM packets 
        WHERE pcap_id = '{file_id}'
        GROUP BY src_ip, dst_ip, protocol
        ORDER BY packets DESC
        LIMIT 200
        """
        result = ch_client.query(query)
        
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
        query = f"""
        SELECT 
            ts, src_ip, dst_ip, info, layers_json
        FROM packets 
        WHERE pcap_id = '{file_id}' AND protocol = 'ARP'
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query)
        
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
        query = f"""
        SELECT 
            ts, src_ip, dst_ip, src_port, dst_port, info
        FROM packets 
        WHERE pcap_id = '{file_id}' AND (protocol = 'SMB' OR protocol = 'NBNS')
        ORDER BY ts DESC
        LIMIT 500
        """
        result = ch_client.query(query)
        
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)