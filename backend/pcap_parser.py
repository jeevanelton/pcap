import pyshark
from datetime import datetime
import uuid
from typing import Dict, Any, Optional
import json
from pathlib import Path

from .database import ch_client

def extract_packet_info(packet: Any, pcap_id: uuid.UUID, packet_num_counter: int) -> Optional[Dict[str, Any]]:
    """Extracts relevant information from a pyshark packet for ClickHouse insertion."""
    try:
        timestamp = packet.sniff_time.replace(tzinfo=None) if hasattr(packet, 'sniff_time') else datetime.now()
        
        src_ip_str = None
        dst_ip_str = None
        src_port = None
        dst_port = None
        protocol = packet.highest_layer if hasattr(packet, 'highest_layer') else "Unknown"
        length = int(packet.length) if hasattr(packet, 'length') else 0
        
        if hasattr(packet, 'ip'):
            src_ip_str = packet.ip.src
            dst_ip_str = packet.ip.dst
        elif hasattr(packet, 'ipv6'):
            # ClickHouse IPv4 type cannot store IPv6, so we'll default to 0.0.0.0 for IPv6
            # If you need IPv6, change the table schema to IPv6 type
            src_ip_str = '0.0.0.0' # Placeholder for IPv6 if table is IPv4
            dst_ip_str = '0.0.0.0' # Placeholder for IPv6 if table is IPv4

        if hasattr(packet, 'tcp'):
            src_port = int(packet.tcp.srcport)
            dst_port = int(packet.tcp.dstport)
        elif hasattr(packet, 'udp'):
            src_port = int(packet.udp.srcport)
            dst_port = int(packet.udp.dstport)

        # Ensure IP addresses are valid for IPv4 type, default to 0.0.0.0 if not present or IPv6
        def is_valid_ipv4(ip_str):
            if not ip_str: return False
            parts = ip_str.split('.')
            if len(parts) != 4: return False
            for part in parts:
                if not part.isdigit() or not (0 <= int(part) <= 255): return False
            return True

        src_ip_final = src_ip_str if is_valid_ipv4(src_ip_str) else '0.0.0.0'
        dst_ip_final = dst_ip_str if is_valid_ipv4(dst_ip_str) else '0.0.0.0'

        # Create a basic info string
        info_str = f"{protocol} packet"
        if src_ip_final != '0.0.0.0' and dst_ip_final != '0.0.0.0':
            info_str += f" from {src_ip_final}"
            if src_port: info_str += f":{src_port}"
            info_str += f" to {dst_ip_final}"
            if dst_port: info_str += f":{dst_port}"
        info_str += f" (len={length})";

        # Extract all layers as JSON for detailed view
        layers_data = []
        for layer in packet.layers:
            layer_fields = {}
            for field_name in layer.field_names:
                try:
                    layer_fields[field_name] = getattr(layer, field_name)
                except AttributeError:
                    pass # Some fields might not be directly accessible
            layers_data.append({"name": layer.layer_name, "fields": layer_fields})
        layers_json = json.dumps(layers_data)

        return {
            "pcap_id": pcap_id,
            "ts": timestamp,
            "packet_number": packet_num_counter,
            "src_ip": src_ip_final,
            "dst_ip": dst_ip_final,
            "src_port": src_port if src_port is not None else 0,
            "dst_port": dst_port if dst_port is not None else 0,
            "protocol": protocol,
            "length": length,
            "file_offset": 0, # pyshark doesn't easily provide this, setting to 0
            "info": info_str,
            "layers_json": layers_json
        }
    except Exception as e:
        print(f"Error extracting packet info: {e}")
        return None

def parse_and_ingest_pcap_sync(file_path: Path, pcap_id: uuid.UUID, original_filename: str):
    """Synchronously parses a PCAP file and ingests data into ClickHouse."""
    cap = None
    packets_to_insert_dicts = []
    packet_count = 0
    total_bytes = 0
    start_time = None
    end_time = None
    batch_size = 1000 # Insert in batches

    print(f"[ClickHouse Ingestion] Attempting to open PCAP: {file_path}")
    try:
        cap = pyshark.FileCapture(str(file_path))
        print(f"[ClickHouse Ingestion] PCAP file opened successfully.")

        packet_num_counter = 0 # Initialize packet number counter
        for packet in cap:
            packet_num_counter += 1 # Increment for each packet
            packet_count += 1
            total_bytes += int(packet.length) if hasattr(packet, 'length') else 0

            if hasattr(packet, 'sniff_time'):
                current_time = packet.sniff_time.replace(tzinfo=None)
                if start_time is None: start_time = current_time
                end_time = current_time

            packet_data = extract_packet_info(packet, pcap_id, packet_num_counter) # Pass counter
            if packet_data:
                packets_to_insert_dicts.append(packet_data)

            if len(packets_to_insert_dicts) >= batch_size:
                # Convert dicts to tuples in the correct order for ClickHouse insertion
                rows = []
                for r in packets_to_insert_dicts:
                    rows.append((
                        r["ts"],
                        r["pcap_id"],
                        r["packet_number"],
                        r["src_ip"],
                        r["dst_ip"],
                        r["src_port"],
                        r["dst_port"],
                        r["protocol"],
                        r["length"],
                        r["file_offset"],
                        r["info"],
                        r["layers_json"],
                    ))
                
                print(f"[ClickHouse Ingestion] Inserting batch of {len(rows)} packets: {rows[0]} ... {rows[-1]}")
                ch_client.insert(
                    'packets',
                    rows,
                    column_names=[
                        "ts", "pcap_id", "packet_number", "src_ip", "dst_ip", "src_port", 
                        "dst_port", "protocol", "length", "file_offset", "info", "layers_json"
                    ]
                )
                print(f"[ClickHouse Ingestion] Inserted {len(rows)} packets. Total: {packet_count}")
                packets_to_insert_dicts = []

        # Insert any remaining packets
        if packets_to_insert_dicts:
            rows = []
            for r in packets_to_insert_dicts:
                rows.append((
                    r["ts"],
                    r["pcap_id"],
                    r["packet_number"],
                    r["src_ip"],
                    r["dst_ip"],
                    r["src_port"],
                    r["dst_port"],
                    r["protocol"],
                    r["length"],
                    r["file_offset"],
                    r["info"],
                    r["layers_json"],
                ))
            print(f"[ClickHouse Ingestion] Inserting final batch of {len(rows)} packets: {rows[0]} ... {rows[-1]}")
            ch_client.insert(
                'packets',
                rows,
                column_names=[
                    "ts", "pcap_id", "packet_number", "src_ip", "dst_ip", "src_port", 
                    "dst_port", "protocol", "length", "file_offset", "info", "layers_json"
                ]
            )
            print(f"[ClickHouse Ingestion] Inserted final {len(rows)} packets. Total: {packet_count}")

        capture_duration = (end_time - start_time).total_seconds() if start_time and end_time else 0.0

        # Insert metadata
        ch_client.insert(
            'pcap_metadata',
            [(
                pcap_id,
                original_filename,
                total_bytes,
                datetime.now().replace(tzinfo=None),
                packet_count,
                capture_duration,
                ""
            )],
            column_names=[
                "id", "file_name", "file_size", "upload_time", 
                "total_packets", "capture_duration", "notes"
            ]
        )
        print(f"[ClickHouse Ingestion] Metadata inserted for {original_filename}")

        return {"file_id": str(pcap_id), "total_packets": packet_count, "total_bytes": total_bytes}

    except Exception as e:
        print(f"[ClickHouse Ingestion] Error during ingestion: {e}")
        raise e
    finally:
        if cap:
            cap.close()
