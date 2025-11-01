from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from datetime import datetime
import os
from pathlib import Path
import uuid
from typing import List, Dict, Any
import shutil
import json

from .database import ch_client
from .pcap_parser import parse_and_ingest_pcap_sync

app = FastAPI(title="PCAP Analyzer API")

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Configuration ---
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# --- API Endpoints ---

@app.get("/")
async def root():
    return {"message": "PCAP Analyzer API", "status": "running"}

@app.post("/api/upload")
async def upload_pcap(file: UploadFile = File(...)):
    """Upload PCAP file, parse, and ingest into ClickHouse."""
    if not file.filename.endswith((".pcap", ".pcapng")):
        raise HTTPException(status_code=400, detail="Invalid file format. Only .pcap and .pcapng allowed")
    
    file_id = uuid.uuid4()
    saved_filename = f"{file_id}.pcap"
    file_path = UPLOAD_DIR / saved_filename
    
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        ingestion_result = await run_in_threadpool(parse_and_ingest_pcap_sync, file_path, file_id, file.filename)
        return {"file_id": str(file_id), "filename": file.filename, "size": ingestion_result["total_bytes"], "path": str(file_path)}
    except Exception as e:
        # Clean up the file if ingestion fails
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=f"PCAP ingestion failed: {e}")

@app.get("/api/files", response_model=List[Dict])
async def list_pcap_files():
    """List all uploaded PCAP files from metadata."""
    try:
        result = ch_client.query("SELECT id, file_name, upload_time, total_packets, file_size, capture_duration FROM pcap_metadata ORDER BY upload_time DESC")
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
async def delete_pcap_file(file_id: str):
    """Delete a specific PCAP file's data from ClickHouse and the file itself."""
    try:
        # Delete from packets table
        ch_client.command(f"ALTER TABLE packets DELETE WHERE pcap_id = '{file_id}'")
        # Delete from metadata table
        ch_client.command(f"ALTER TABLE pcap_metadata DELETE WHERE id = '{file_id}'")
        
        # Delete the actual pcap file from disk (if it still exists)
        file_path = UPLOAD_DIR / f"{file_id}.pcap"
        if file_path.is_file():
            file_path.unlink()

        return {"message": f"Data for file {file_id} deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file data: {e}")

@app.get("/api/analyze/{file_id}")
async def analyze_pcap(file_id: str):
    """Analyze PCAP data from ClickHouse and return statistics."""
    try:
        # Get total packets and bytes from metadata
        metadata_result = ch_client.query(f"SELECT total_packets, file_size, capture_duration FROM pcap_metadata WHERE id = '{file_id}'")
        if not metadata_result.result_rows:
            raise HTTPException(status_code=404, detail="PCAP metadata not found")
        total_packets, file_size, capture_duration = metadata_result.result_rows[0]

        # Protocol distribution
        protocol_result = ch_client.query(f"SELECT protocol, COUNT() FROM packets WHERE pcap_id = '{file_id}' GROUP BY protocol")
        protocols = {row[0]: row[1] for row in protocol_result.result_rows}

        # Top sources
        top_src_result = ch_client.query(f"SELECT src_ip, COUNT() AS packets, SUM(length) AS bytes FROM packets WHERE pcap_id = '{file_id}' GROUP BY src_ip ORDER BY packets DESC LIMIT 10")
        top_sources = []
        for row in top_src_result.result_rows:
            percentage = (row[2] / file_size * 100) if file_size > 0 else 0 # Use file_size here
            top_sources.append({"ip": str(row[0]), "packets": row[1], "bytes": row[2], "percentage": f"{percentage:.2f}%"})

        # Top destinations
        top_dst_result = ch_client.query(f"SELECT dst_ip, COUNT() AS packets, SUM(length) AS bytes FROM packets WHERE pcap_id = '{file_id}' GROUP BY dst_ip ORDER BY packets DESC LIMIT 10")
        top_destinations = []
        for row in top_dst_result.result_rows:
            percentage = (row[2] / file_size * 100) if file_size > 0 else 0 # Use file_size here
            top_destinations.append({"ip": str(row[0]), "packets": row[1], "bytes": row[2], "percentage": f"{percentage:.2f}%"})

        # Traffic over time (e.g., per second or minute)
        # For simplicity, let's aggregate per second for now
        traffic_over_time_result = ch_client.query(f"SELECT toStartOfSecond(ts) AS time_sec, COUNT() AS packets FROM packets WHERE pcap_id = '{file_id}' GROUP BY time_sec ORDER BY time_sec ASC")
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

@app.get("/api/packets/{file_id}")
async def get_packets(file_id: str, limit: int = 100, offset: int = 0):
    """Get packet details from ClickHouse with pagination."""
    try:
        query = f"""
SELECT 
    ts, pcap_id, packet_number, src_ip, dst_ip, src_port, dst_port, protocol, length, file_offset, info, layers_json 
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
                "info": row[10],
                "layers_json": row[11]
            })
        
        # Get total count for pagination metadata
        total_count_result = ch_client.query(f"SELECT COUNT() FROM packets WHERE pcap_id = '{file_id}'")
        total_returned = total_count_result.result_rows[0][0]

        return {"packets": packets, "total_returned": total_returned}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve packets: {e}")

@app.get("/api/packet/{file_id}/{packet_number}")
async def get_packet_detail(file_id: str, packet_number: int):
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
            "layers": json.loads(row[11]) if row[11] else []
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
    src_ip, dst_ip, COUNT() AS packet_count 
    FROM packets 
    WHERE pcap_id = '{file_id}' 
    GROUP BY src_ip, dst_ip"""
        )
        
        nodes = []
        edges = []
        ip_to_id = {}
        node_id_counter = 0
        
        # Create nodes and edges from conversations
        for row in conversation_result.result_rows:
            src = str(row[0])
            dst = str(row[1])
            count = row[2]

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
                "value": count,
                "title": f"{count} packets"
            })
            
        return {"nodes": nodes, "edges": edges}
    except Exception as e:
        print(f"Error getting conversations from ClickHouse: {e}")
        raise e

@app.get("/api/conversations/{file_id}")
async def get_conversations(file_id: str):
    """Get network conversations for graph visualization."""
    if not file_id:
        raise HTTPException(status_code=400, detail="Invalid file_id")

    try:
        result = await run_in_threadpool(get_conversations_from_clickhouse, file_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get conversations: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)