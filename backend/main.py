from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
import pyshark
from datetime import datetime
import os
from pathlib import Path
import uuid
from typing import List, Dict
import shutil

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
# Use a path relative to this file for robustness
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Configuration

@app.get("/")
async def root():
    return {"message": "PCAP Analyzer API", "status": "running"}

@app.post("/api/upload")
async def upload_pcap(file: UploadFile = File(...)):
    """Upload PCAP file"""
    if not file.filename.endswith(('.pcap', '.pcapng')):
        raise HTTPException(status_code=400, detail="Invalid file format. Only .pcap and .pcapng allowed")
    
    # Generate unique filename
    file_id = str(uuid.uuid4())
    # Store all files with a consistent extension for easier lookup
    saved_filename = f"{file_id}.pcap"
    file_path = UPLOAD_DIR / saved_filename
    
    # Save file by streaming to avoid high memory usage
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    file_size = file_path.stat().st_size
    
    return {
        "file_id": file_id,
        "filename": file.filename,
        "size": file_size,
        "path": str(file_path)
    }

@app.get("/api/files", response_model=List[Dict])
async def list_pcap_files():
    """List all uploaded PCAP files."""
    files = []
    for file_path in UPLOAD_DIR.glob("*.pcap"):
        try:
            stats = file_path.stat()
            files.append({
                "file_id": file_path.stem,
                "size": stats.st_size,
                "modified_time": datetime.fromtimestamp(stats.st_mtime).isoformat()
            })
        except FileNotFoundError:
            # File might have been deleted between glob and stat
            continue
    # Sort files by modification time, newest first
    return sorted(files, key=lambda x: x["modified_time"], reverse=True)

@app.delete("/api/files/{file_id}")
async def delete_pcap_file(file_id: str):
    """Delete a specific PCAP file."""
    if not is_safe_path(file_id):
        raise HTTPException(status_code=400, detail="Invalid file_id format")
    file_path = UPLOAD_DIR / f"{file_id}.pcap"
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="PCAP file not found")
    file_path.unlink()
    return {"message": f"File {file_id} deleted successfully."}

def is_safe_path(file_id: str) -> bool:
    """Ensure file_id is a simple filename to prevent path traversal."""
    return not ("/" in file_id or "\\" in file_id or ".." in file_id)

def analyze_pcap_sync(file_path: str):
    """Synchronous function to analyze pcap, to be run in a thread pool."""
    cap = None
    try:
        # Open PCAP file
        cap = pyshark.FileCapture(file_path)
        
        # Basic analysis
        packet_count = 0
        protocols = {}
        src_ips = {}
        dst_ips = {}
        src_ip_bytes = {}
        dst_ip_bytes = {}
        total_bytes = 0
        
        # Time-series data
        traffic_over_time = {}
        start_time = None
        end_time = None

        # Use a generator to avoid loading all packets into memory
        for packet in cap: # This is blocking
            packet_count += 1
            
            # Get timestamp for time-series analysis
            if hasattr(packet, 'sniff_time'):
                current_time = packet.sniff_time
                if start_time is None:
                    start_time = current_time
                end_time = current_time
                
                # Round to nearest second for grouping
                timestamp_second = current_time.replace(microsecond=0)
                traffic_over_time[timestamp_second] = traffic_over_time.get(timestamp_second, 0) + 1

            # Protocol distribution
            if hasattr(packet, 'highest_layer'):
                protocol = packet.highest_layer
                protocols[protocol] = protocols.get(protocol, 0) + 1
            
            # IP analysis
            if hasattr(packet, 'ip'):
                src = packet.ip.src
                dst = packet.ip.dst
                length = int(packet.length) # packet.length is a string
                
                src_ips[src] = src_ips.get(src, 0) + 1
                dst_ips[dst] = dst_ips.get(dst, 0) + 1
                src_ip_bytes[src] = src_ip_bytes.get(src, 0) + length
                dst_ip_bytes[dst] = dst_ip_bytes.get(dst, 0) + length
                total_bytes += length
            
            # Limit processing for demo (first 1000 packets)
            if packet_count >= 1000:
                break
        
        # Convert time-series data to a sorted list of dicts
        sorted_traffic_over_time = sorted(
            [{ "time": k.isoformat(), "packets": v } for k, v in traffic_over_time.items()],
            key=lambda x: x["time"]
        )

        capture_duration = "N/A"
        if start_time and end_time:
            duration_seconds = (end_time - start_time).total_seconds()
            capture_duration = f"{duration_seconds:.2f} seconds"

        return packet_count, protocols, src_ips, dst_ips, src_ip_bytes, dst_ip_bytes, total_bytes, sorted_traffic_over_time, capture_duration
    finally:
        if cap:
            cap.close()

@app.get("/api/analyze/{file_id}")
async def analyze_pcap(file_id: str):
    """Analyze PCAP file and return basic statistics"""
    
    if not is_safe_path(file_id):
        raise HTTPException(status_code=400, detail="Invalid file_id")

    file_path = UPLOAD_DIR / f"{file_id}.pcap"
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="PCAP file not found")
    
    try:
        # Run the blocking analysis in a thread pool
        packet_count, protocols, src_ips, dst_ips, src_ip_bytes, dst_ip_bytes, total_bytes, traffic_over_time, capture_duration = await run_in_threadpool(
            analyze_pcap_sync, str(file_path)
        )
        
        # Get top talkers
        top_src = []
        for ip, count in sorted(src_ips.items(), key=lambda x: x[1], reverse=True)[:10]:
            bytes_sent = src_ip_bytes.get(ip, 0)
            percentage = (bytes_sent / total_bytes * 100) if total_bytes > 0 else 0
            top_src.append({"ip": ip, "packets": count, "bytes": bytes_sent, "percentage": f"{percentage:.2f}%"})

        top_dst = []
        for ip, count in sorted(dst_ips.items(), key=lambda x: x[1], reverse=True)[:10]:
            bytes_received = dst_ip_bytes.get(ip, 0)
            percentage = (bytes_received / total_bytes * 100) if total_bytes > 0 else 0
            top_dst.append({"ip": ip, "packets": count, "bytes": bytes_received, "percentage": f"{percentage:.2f}%"})
        
        return {
            "file_id": file_id,
            "packet_count": packet_count,
            "protocols": protocols,
            "top_sources": top_src,
            "top_destinations": top_dst,
            "traffic_over_time": traffic_over_time,
            "capture_duration": capture_duration,
            "total_bytes": total_bytes
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

def process_packets_sync(file_path: str, limit: int):
    """Synchronous function to process packets, to be run in a thread pool."""
    cap = None
    try:
        cap = pyshark.FileCapture(file_path)
        packets = []
        
        for i, packet in enumerate(cap):
            if i >= limit:
                break
                
            packet_info = {
                "number": i + 1,
                "time": str(packet.sniff_time) if hasattr(packet, 'sniff_time') else "N/A",
                "protocol": packet.highest_layer if hasattr(packet, 'highest_layer') else "Unknown",
                "length": packet.length if hasattr(packet, 'length') else 0,
            }
            
            # Add IP info if available
            if hasattr(packet, 'ip'):
                packet_info["src_ip"] = packet.ip.src
                packet_info["dst_ip"] = packet.ip.dst
            
            packets.append(packet_info)
        
        return {"packets": packets, "total_returned": len(packets)}
    finally:
        if cap:
            cap.close()

@app.get("/api/packets/{file_id}")
async def get_packets(file_id: str, limit: int = 100):
    """Get packet details"""
    
    if not is_safe_path(file_id):
        raise HTTPException(status_code=400, detail="Invalid file_id")

    file_path = UPLOAD_DIR / f"{file_id}.pcap"
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="PCAP file not found")
    
    try:
        # Run the blocking pyshark code in a thread pool
        result = await run_in_threadpool(process_packets_sync, str(file_path), limit)
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read packets: {str(e)}")

def get_packet_detail_sync(file_path: str, packet_number: int):
    """Synchronous function to get the full detail of a single packet."""
    cap = None
    try:
        # We only need to load one packet, so this should be fast.
        # The packet number from the UI is 1-based, pyshark is 0-based.
        cap = pyshark.FileCapture(file_path)
        packet = cap[packet_number - 1]

        packet_details = {
            "number": packet.number,
            "sniff_time": str(packet.sniff_time),
            "length": packet.length,
            "layers": []
        }

        for layer in packet.layers:
            layer_info = {
                "name": layer.layer_name.upper(),
                "fields": {}
            }
            # To get the values, we can create a dictionary from field names
            for field in layer.field_names:
                layer_info["fields"][field] = getattr(layer, field)
            packet_details["layers"].append(layer_info)
            
        return packet_details

    except IndexError:
        raise HTTPException(status_code=404, detail=f"Packet number {packet_number} not found in capture.")
    finally:
        if cap:
            cap.close()

@app.get("/api/packet/{file_id}/{packet_number}")
async def get_packet_detail(file_id: str, packet_number: int):
    """Get full details for a single packet."""
    if not is_safe_path(file_id):
        raise HTTPException(status_code=400, detail="Invalid file_id")

    file_path = UPLOAD_DIR / f"{file_id}.pcap"
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="PCAP file not found")

    try:
        result = await run_in_threadpool(get_packet_detail_sync, str(file_path), packet_number)
        return result
    except Exception as e:
        # Re-raise HTTPException from the sync function or handle other errors
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Failed to retrieve packet detail: {str(e)}")

def get_conversations_sync(file_path: str):
    """Synchronous function to get conversations, to be run in a thread pool."""
    cap = None
    try:
        cap = pyshark.FileCapture(file_path)
        conversations = {}
        for packet in cap:
            if hasattr(packet, 'ip'):
                src = packet.ip.src
                dst = packet.ip.dst
                # Store conversations uniquely, regardless of direction
                key = tuple(sorted((src, dst)))
                conversations[key] = conversations.get(key, 0) + 1
        
        nodes = []
        edges = []
        ip_to_id = {}
        
        # Create nodes and edges from conversations
        for (src, dst), count in conversations.items():
            if src not in ip_to_id:
                ip_to_id[src] = len(ip_to_id)
                nodes.append({"id": ip_to_id[src], "label": src})
            if dst not in ip_to_id:
                ip_to_id[dst] = len(ip_to_id)
                nodes.append({"id": ip_to_id[dst], "label": dst})
            
            edges.append({
                "from": ip_to_id[src],
                "to": ip_to_id[dst],
                "value": count,
                "title": f"{count} packets"
            })
            
        return {"nodes": nodes, "edges": edges}
    finally:
        if cap:
            cap.close()

@app.get("/api/conversations/{file_id}")
async def get_conversations(file_id: str):
    """Get network conversations for graph visualization."""
    if not is_safe_path(file_id):
        raise HTTPException(status_code=400, detail="Invalid file_id")

    file_path = UPLOAD_DIR / f"{file_id}.pcap"
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="PCAP file not found")

    try:
        result = await run_in_threadpool(get_conversations_sync, str(file_path))
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get conversations: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)