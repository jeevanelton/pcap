import pyshark
from datetime import datetime
import uuid
from typing import Dict, Any, Optional
import json
from pathlib import Path

from database import get_ch_client

def extract_packet_info(packet: Any, pcap_id: uuid.UUID, packet_num_counter: int) -> Optional[Dict[str, Any]]:
    """Extracts relevant information from a pyshark packet for ClickHouse insertion."""
    try:
        timestamp = packet.sniff_time.replace(tzinfo=None) if hasattr(packet, 'sniff_time') else datetime.now()
        
        src_ip_str = None
        dst_ip_str = None
        src_port = None
        dst_port = None
        # Determine protocol with sensible precedence (avoid generic DATA)
        # Prefer well-known app layers over transport; fall back to transport; never 'DATA'
        protocol = "Other"
        try:
            layer_names = [getattr(layer, 'layer_name', '').lower() for layer in getattr(packet, 'layers', [])]
        except Exception:
            layer_names = []

        def has_layer(name: str) -> bool:
            lname = name.lower()
            return lname in layer_names or hasattr(packet, lname)

        # Application protocols first
        if has_layer('dns'):
            protocol = 'DNS'
        elif has_layer('http'):
            protocol = 'HTTP'
        elif any('tls' in n for n in layer_names):
            protocol = 'TLS'
        elif any('quic' in n for n in layer_names):
            protocol = 'QUIC'
        elif has_layer('icmp'):
            protocol = 'ICMP'
        elif has_layer('arp'):
            protocol = 'ARP'
        elif has_layer('smb') or has_layer('smb2'):
            protocol = 'SMB'
        elif has_layer('telnet'):
            protocol = 'TELNET'
        elif has_layer('ftp'):
            protocol = 'FTP'
        elif has_layer('ssh'):
            protocol = 'SSH'
        elif has_layer('ssdp'):
            protocol = 'SSDP'
        elif has_layer('sip'):
            protocol = 'SIP'
        # Transport next
        elif has_layer('tcp'):
            protocol = 'TCP'
        elif has_layer('udp'):
            protocol = 'UDP'
        else:
            # Fallback to highest_layer if available, but normalize to avoid DATA
            protocol = getattr(packet, 'highest_layer', 'Other')
            if isinstance(protocol, str):
                protocol = protocol.upper()
            if protocol == 'DATA':
                # Map generic DATA to transport if available
                if has_layer('tcp'):
                    protocol = 'TCP'
                elif has_layer('udp'):
                    protocol = 'UDP'
                else:
                    protocol = 'Other'
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

        # Create a Wireshark-style info string based on protocol
        info_str = ""
        try:
            if protocol == 'DNS':
                # DNS specific info
                if hasattr(packet, 'dns'):
                    if hasattr(packet.dns, 'qry_name'):
                        query_type = getattr(packet.dns, 'qry_type', 'A')
                        info_str = f"Standard query {query_type} {packet.dns.qry_name}"
                    elif hasattr(packet.dns, 'resp_name'):
                        info_str = f"Standard query response"
                    else:
                        info_str = "DNS query/response"
            elif protocol == 'HTTP':
                # HTTP specific info
                if hasattr(packet, 'http'):
                    if hasattr(packet.http, 'request_method'):
                        method = packet.http.request_method
                        uri = getattr(packet.http, 'request_uri', '/')
                        info_str = f"{method} {uri}"
                    elif hasattr(packet.http, 'response_code'):
                        code = packet.http.response_code
                        phrase = getattr(packet.http, 'response_phrase', '')
                        info_str = f"HTTP/{getattr(packet.http, 'response_version', '1.1')} {code} {phrase}"
                    else:
                        info_str = "HTTP"
            elif protocol == 'TLS' or protocol == 'SSL':
                # TLS specific info
                if hasattr(packet, 'tls'):
                    if hasattr(packet.tls, 'handshake_type'):
                        handshake_type = packet.tls.handshake_type
                        if handshake_type == '1':
                            info_str = "Client Hello"
                        elif handshake_type == '2':
                            info_str = "Server Hello"
                        elif handshake_type == '11':
                            info_str = "Certificate"
                        else:
                            info_str = f"Handshake ({handshake_type})"
                    else:
                        info_str = "Application Data"
            elif protocol == 'TCP':
                # TCP specific info with flags
                if hasattr(packet, 'tcp'):
                    flags = []
                    if hasattr(packet.tcp, 'flags_syn') and packet.tcp.flags_syn == 'True':
                        flags.append('SYN')
                    if hasattr(packet.tcp, 'flags_ack') and packet.tcp.flags_ack == 'True':
                        flags.append('ACK')
                    if hasattr(packet.tcp, 'flags_fin') and packet.tcp.flags_fin == 'True':
                        flags.append('FIN')
                    if hasattr(packet.tcp, 'flags_reset') and packet.tcp.flags_reset == 'True':
                        flags.append('RST')
                    if hasattr(packet.tcp, 'flags_push') and packet.tcp.flags_push == 'True':
                        flags.append('PSH')
                    
                    seq = getattr(packet.tcp, 'seq', '')
                    ack = getattr(packet.tcp, 'ack', '')
                    win = getattr(packet.tcp, 'window_size_value', '')
                    
                    flag_str = ','.join(flags) if flags else 'None'
                    info_str = f"{src_port} → {dst_port} [{flag_str}] Seq={seq} Ack={ack} Win={win} Len={length}"
            elif protocol == 'UDP':
                # UDP specific info
                info_str = f"{src_port} → {dst_port} Len={length}"
            elif protocol == 'ARP':
                # ARP specific info
                if hasattr(packet, 'arp'):
                    if hasattr(packet.arp, 'opcode'):
                        opcode = packet.arp.opcode
                        if opcode == '1':
                            info_str = f"Who has {getattr(packet.arp, 'dst_proto_ipv4', '?')}? Tell {getattr(packet.arp, 'src_proto_ipv4', '?')}"
                        elif opcode == '2':
                            info_str = f"{getattr(packet.arp, 'src_proto_ipv4', '?')} is at {getattr(packet.arp, 'src_hw_mac', '?')}"
            elif protocol == 'ICMP':
                # ICMP specific info
                if hasattr(packet, 'icmp'):
                    icmp_type = getattr(packet.icmp, 'type', '')
                    if icmp_type == '8':
                        info_str = f"Echo (ping) request"
                    elif icmp_type == '0':
                        info_str = f"Echo (ping) reply"
                    else:
                        info_str = f"ICMP Type {icmp_type}"
            
            # Fallback to generic info if nothing specific was set
            if not info_str:
                info_str = f"{protocol}"
                if src_ip_final != '0.0.0.0' and dst_ip_final != '0.0.0.0':
                    info_str += f" {src_ip_final}"
                    if src_port: info_str += f":{src_port}"
                    info_str += f" → {dst_ip_final}"
                    if dst_port: info_str += f":{dst_port}"
                info_str += f" Len={length}"
        except Exception as e:
            # Fallback on any error
            info_str = f"{protocol} packet from {src_ip_final}:{src_port or 0} to {dst_ip_final}:{dst_port or 0} (len={length})"

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

def get_total_packets(file_path: Path) -> int:
    """Quickly count the number of packets in a PCAP file."""
    try:
        cap = pyshark.FileCapture(str(file_path))
        count = sum(1 for _ in cap)
        cap.close()
        return count
    except Exception as e:
        print(f"Error counting packets: {e}")
        return 0

def parse_and_ingest_pcap_sync(file_path: Path, pcap_id: uuid.UUID, original_filename: str, task_id: str, progress_dict: Dict[str, Any]):
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
        total_packets = get_total_packets(file_path)
        if total_packets == 0:
            raise ValueError("PCAP file is empty or could not be read.")

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
                get_ch_client().insert(
                    'packets',
                    rows,
                    column_names=[
                        "ts", "pcap_id", "packet_number", "src_ip", "dst_ip", "src_port", 
                        "dst_port", "protocol", "length", "file_offset", "info", "layers_json"
                    ]
                )
                print(f"[ClickHouse Ingestion] Inserted {len(rows)} packets. Total: {packet_count}")
                packets_to_insert_dicts = []
            
            # Update progress
            progress = (packet_num_counter / total_packets) * 100
            progress_dict[task_id] = {'status': 'processing', 'progress': progress}

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
            get_ch_client().insert(
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
        get_ch_client().insert(
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

        progress_dict[task_id] = {'status': 'completed', 'progress': 100, 'file_id': str(pcap_id)}

        return {"file_id": str(pcap_id), "total_packets": packet_count, "total_bytes": total_bytes}

    except Exception as e:
        progress_dict[task_id] = {'status': 'error', 'message': str(e)}
        print(f"[ClickHouse Ingestion] Error during ingestion: {e}")
        raise e
    finally:
        if cap:
            cap.close()
