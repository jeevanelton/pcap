import dpkt
import socket
import json
from datetime import datetime
import uuid
from typing import Dict, Any, Optional, List
from pathlib import Path
import sys
import subprocess
import shutil
import tempfile
import os

from database import get_ch_client

# Common IP Protocol Numbers
IP_PROTOCOLS = {
    1: 'ICMP', 2: 'IGMP', 4: 'IP-in-IP', 6: 'TCP', 17: 'UDP', 27: 'RDP', 41: 'IPv6', 47: 'GRE', 
    50: 'ESP', 51: 'AH', 58: 'ICMPv6', 88: 'EIGRP', 89: 'OSPF', 103: 'PIM', 112: 'VRRP', 
    115: 'L2TP', 132: 'SCTP', 137: 'MPLS-in-IP'
}

# Allowed columns for Zeek tables (must match ClickHouse schema)
ZEEK_TABLE_COLUMNS = {
    'conn_log': {'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p', 'id_resp_h', 'id_resp_p', 'proto', 'service', 'duration', 'orig_bytes', 'resp_bytes', 'conn_state', 'local_orig', 'local_resp', 'missed_bytes', 'history', 'orig_pkts', 'orig_ip_bytes', 'resp_pkts', 'resp_ip_bytes', 'tunnel_parents'},
    'dns_log': {'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p', 'id_resp_h', 'id_resp_p', 'proto', 'trans_id', 'query', 'qclass', 'qclass_name', 'qtype', 'qtype_name', 'rcode', 'rcode_name', 'AA', 'TC', 'RD', 'RA', 'Z', 'answers', 'TTLs', 'rejected'},
    'http_log': {'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p', 'id_resp_h', 'id_resp_p', 'trans_depth', 'method', 'host', 'uri', 'referrer', 'version', 'user_agent', 'request_body_len', 'response_body_len', 'status_code', 'status_msg', 'tags', 'username', 'password', 'proxied', 'orig_fuids', 'orig_filenames', 'orig_mime_types', 'resp_fuids', 'resp_filenames', 'resp_mime_types'},
    'ssl_log': {'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p', 'id_resp_h', 'id_resp_p', 'version', 'cipher', 'curve', 'server_name', 'resumed', 'last_alert', 'next_protocol', 'established', 'cert_chain_fuids', 'client_cert_chain_fuids', 'subject', 'issuer', 'client_subject', 'client_issuer', 'validation_status'}
}

# Default values for columns to avoid "Invalid None value" errors
ZEEK_COLUMN_DEFAULTS = {
    # Common
    'uid': '', 'id_orig_h': '', 'id_resp_h': '', 'proto': '', 'service': '',
    'id_orig_p': 0, 'id_resp_p': 0,
    
    # conn_log
    'duration': 0.0, 'orig_bytes': 0, 'resp_bytes': 0, 'conn_state': '',
    'local_orig': False, 'local_resp': False, 'missed_bytes': 0, 'history': '',
    'orig_pkts': 0, 'orig_ip_bytes': 0, 'resp_pkts': 0, 'resp_ip_bytes': 0,
    'tunnel_parents': [],
    
    # dns_log
    'trans_id': 0, 'query': '', 'qclass': 0, 'qclass_name': '', 'qtype': 0, 'qtype_name': '',
    'rcode': 0, 'rcode_name': '', 'AA': False, 'TC': False, 'RD': False, 'RA': False, 'Z': 0,
    'answers': [], 'TTLs': [], 'rejected': False,
    
    # http_log
    'trans_depth': 0, 'method': '', 'host': '', 'uri': '', 'referrer': '', 'version': '',
    'user_agent': '', 'request_body_len': 0, 'response_body_len': 0, 'status_code': 0,
    'status_msg': '', 'tags': [], 'username': '', 'password': '', 'proxied': [],
    'orig_fuids': [], 'orig_filenames': [], 'orig_mime_types': [],
    'resp_fuids': [], 'resp_filenames': [], 'resp_mime_types': [],
    
    # ssl_log
    'version': '', 'cipher': '', 'curve': '', 'server_name': '', 'resumed': False,
    'last_alert': '', 'next_protocol': '', 'established': False,
    'cert_chain_fuids': [], 'client_cert_chain_fuids': [], 'subject': '', 'issuer': '',
    'client_subject': '', 'client_issuer': '', 'validation_status': ''
}

def inet_to_str(inet):
    """Convert inet object to a string"""
    try:
        return socket.inet_ntop(socket.AF_INET, inet)
    except ValueError:
        return socket.inet_ntop(socket.AF_INET6, inet)

def mac_addr(address):
    """Convert a MAC address to a readable/printable string"""
    return ':'.join('%02x' % b for b in address)

def parse_zeek_ascii_log(log_path: Path):
    """Parse a Zeek ASCII log file yielding dictionaries."""
    with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
        fields = []
        types = []
        for line in f:
            line = line.strip()
            if not line or line.startswith('#close'):
                continue
            if line.startswith('#fields'):
                fields = line.split('\t')[1:]
                continue
            if line.startswith('#types'):
                types = line.split('\t')[1:]
                continue
            if line.startswith('#'):
                continue
            
            # Data line
            values = line.split('\t')
            if len(values) != len(fields):
                continue
            
            row = {}
            for i, field in enumerate(fields):
                val = values[i]
                if val == '-':
                    row[field] = None
                else:
                    row[field] = val
            yield row

def process_zeek_record(record: Dict[str, Any], table_name: str, pcap_id: str) -> Dict[str, Any]:
    """Clean and format a Zeek record for ClickHouse insertion."""
    # Add pcap_id - ensure it's a UUID object if possible, or string if CH expects string.
    # The error "ValueError: invalid literal for int() with base 16" suggests CH driver is trying to parse it as int?
    # Or maybe it's expecting a UUID object. Let's try passing UUID object.
    try:
        record['pcap_id'] = uuid.UUID(pcap_id)
    except:
        record['pcap_id'] = pcap_id # Fallback to string
    
    # Handle timestamp
    if 'ts' in record:
        try:
            val = record['ts']
            # JSON logs usually have float timestamps, ASCII might be string
            record['ts'] = datetime.fromtimestamp(float(val))
        except:
            record['ts'] = datetime.now()

    # Flatten nested keys (e.g. id.orig_h -> id_orig_h)
    # In JSON, they might be nested dicts or already flattened depending on Zeek config.
    # Standard Zeek JSON writer usually produces "id.orig_h": "..." keys if using default JSON.
    # But if we use the default ASCII writer with JSON format, it might be different.
    # Let's handle both "id": {"orig_h":...} and "id.orig_h": ...
    
    # First, flatten dictionary if needed (rare with standard JSON logs which use dot notation in keys)
    # But let's be safe.
    flat_record = {}
    for k, v in record.items():
        if isinstance(v, dict):
            for sub_k, sub_v in v.items():
                flat_record[f"{k}_{sub_k}"] = sub_v
        elif '.' in k:
            flat_record[k.replace('.', '_')] = v
        else:
            flat_record[k] = v
    record = flat_record

    # Handle specific table fields and type conversions
    if table_name == 'dns_log':
        if 'answers' in record:
            if isinstance(record['answers'], str): # ASCII or JSON string
                record['answers'] = record['answers'].split(',') if record['answers'] != '-' else []
            elif isinstance(record['answers'], list): # JSON list
                record['answers'] = [str(x) for x in record['answers']]
        else:
            record['answers'] = []
            
        if 'TTLs' in record:
            if isinstance(record['TTLs'], str):
                record['TTLs'] = [int(float(t)) for t in record['TTLs'].split(',')] if record['TTLs'] != '-' else []
            elif isinstance(record['TTLs'], list):
                record['TTLs'] = [int(float(x)) for x in record['TTLs']]
        else:
            record['TTLs'] = []
    
    elif table_name == 'http_log':
        list_fields = ['tags', 'proxied', 'orig_fuids', 'orig_filenames', 'orig_mime_types', 'resp_fuids', 'resp_filenames', 'resp_mime_types']
        for field in list_fields:
            if field in record:
                if isinstance(record[field], str):
                    record[field] = record[field].split(',') if record[field] != '-' else []
                elif not isinstance(record[field], list):
                    record[field] = []
            else:
                record[field] = []
                
        int_fields = ['request_body_len', 'response_body_len', 'status_code', 'trans_depth', 'id_orig_p', 'id_resp_p']
        for field in int_fields:
            if field in record and record[field] is not None:
                try: record[field] = int(record[field])
                except: record[field] = 0
            else:
                record[field] = 0

    elif table_name == 'conn_log':
        if 'tunnel_parents' in record:
            if isinstance(record['tunnel_parents'], str):
                record['tunnel_parents'] = record['tunnel_parents'].split(',') if record['tunnel_parents'] != '-' else []
            elif not isinstance(record['tunnel_parents'], list):
                record['tunnel_parents'] = []
        else:
            record['tunnel_parents'] = []
        
        # Floats
        if 'duration' in record:
            try: record['duration'] = float(record['duration'])
            except: record['duration'] = 0.0
        else: record['duration'] = 0.0
            
        int_fields = ['orig_bytes', 'resp_bytes', 'missed_bytes', 'orig_pkts', 'orig_ip_bytes', 'resp_pkts', 'resp_ip_bytes', 'id_orig_p', 'id_resp_p']
        for field in int_fields:
            if field in record and record[field] is not None:
                try: record[field] = int(record[field])
                except: record[field] = 0
            else:
                record[field] = 0
            
        # Booleans
        for field in ['local_orig', 'local_resp']:
            if field in record:
                if isinstance(record[field], bool):
                    pass
                elif isinstance(record[field], str):
                    record[field] = (record[field] == 'T' or record[field].lower() == 'true')
                else:
                    record[field] = bool(record[field])

    elif table_name == 'ssl_log':
        list_fields = ['cert_chain_fuids', 'client_cert_chain_fuids']
        for field in list_fields:
            if field in record:
                if isinstance(record[field], str):
                    record[field] = record[field].split(',') if record[field] != '-' else []
                elif not isinstance(record[field], list):
                    record[field] = []
            else:
                record[field] = []
        
        int_fields = ['id_orig_p', 'id_resp_p']
        for field in int_fields:
            if field in record and record[field] is not None:
                try: record[field] = int(record[field])
                except: record[field] = 0
            else:
                record[field] = 0
                
        for field in ['resumed', 'established']:
            if field in record:
                if isinstance(record[field], str):
                    record[field] = (record[field] == 'T' or record[field].lower() == 'true')
                else:
                    record[field] = bool(record[field])

    # Filter out unknown columns
    if table_name in ZEEK_TABLE_COLUMNS:
        allowed = ZEEK_TABLE_COLUMNS[table_name]
        record = {k: v for k, v in record.items() if k in allowed}

    # Ensure all allowed columns are present with default values (None)
    # This is crucial for consistent row structure in batch inserts
    if table_name in ZEEK_TABLE_COLUMNS:
        for col in ZEEK_TABLE_COLUMNS[table_name]:
            if col not in record or record[col] is None:
                # Use defined default or fallback based on type inference if possible, else None (which might fail)
                if col in ZEEK_COLUMN_DEFAULTS:
                    record[col] = ZEEK_COLUMN_DEFAULTS[col]
                else:
                    # Fallback defaults
                    if col == 'ts': record[col] = datetime.now()
                    elif col == 'pcap_id': pass # Should be set already
                    else: record[col] = '' # Default to empty string for unknown string fields

    return record

def ingest_zeek_log(log_path: Path, table_name: str, pcap_id: str):
    """Read a Zeek log (JSON or ASCII) and ingest into ClickHouse."""
    if not log_path.exists():
        return
    
    print(f"[Zeek] Ingesting {log_path.name} into {table_name}...")
    client = get_ch_client()
    batch = []
    batch_size = 5000
    
    # Determine format: check first char
    is_json = False
    try:
        with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
            first_char = f.read(1)
            if first_char == '{':
                is_json = True
    except Exception as e:
        print(f"Error reading {log_path}: {e}")
        return
    
    try:
        if is_json:
            with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
                for line in f:
                    if not line.strip(): continue
                    try:
                        record = json.loads(line)
                        processed = process_zeek_record(record, table_name, pcap_id)
                        batch.append(processed)
                    except json.JSONDecodeError:
                        continue
                    except Exception as e:
                        # print(f"Error processing record: {e}")
                        continue
                    
                    if len(batch) >= batch_size:
                        try:
                            # Use the keys from the first record, assuming all records have same keys now
                            keys = list(batch[0].keys())
                            data_rows = [[row.get(k) for k in keys] for row in batch]
                            client.insert(table_name, data_rows, column_names=keys)
                        except Exception as e:
                            print(f"Batch insert error for {table_name}: {repr(e)}")
                        batch = []
        else:
            # ASCII parsing
            for record in parse_zeek_ascii_log(log_path):
                try:
                    processed = process_zeek_record(record, table_name, pcap_id)
                    batch.append(processed)
                    
                    if len(batch) >= batch_size:
                        try:
                            keys = list(batch[0].keys())
                            data_rows = [[row.get(k) for k in keys] for row in batch]
                            client.insert(table_name, data_rows, column_names=keys)
                        except Exception as e:
                            print(f"Batch insert error for {table_name}: {repr(e)}")
                        batch = []
                except Exception as e:
                    pass
        
        if batch:
            try:
                keys = list(batch[0].keys())
                data_rows = [[row.get(k) for k in keys] for row in batch]
                client.insert(table_name, data_rows, column_names=keys)
            except Exception as e:
                print(f"Final batch insert error for {table_name}: {repr(e)}")
                
    except Exception as e:
        print(f"Error ingesting {log_path}: {e}")

def run_zeek_analysis(pcap_path: Path, pcap_id: str, task_id: str = None, progress_dict: Dict[str, Any] = None):
    """Run Zeek on the PCAP file and ingest logs."""
    # Find zeek executable
    zeek_cmd = shutil.which("zeek")
    if not zeek_cmd:
        if Path("/opt/zeek/bin/zeek").exists():
            zeek_cmd = "/opt/zeek/bin/zeek"
        else:
            print("[Zeek] Executable not found in PATH or /opt/zeek/bin/zeek")
            return

    if task_id and progress_dict:
        progress_dict[task_id]['status'] = 'analyzing_zeek'
        progress_dict[task_id]['message'] = 'Running Zeek analysis...'
        progress_dict[task_id]['progress'] = 5

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        print(f"[Zeek] Running analysis in {temp_path}")
        
        try:
            # Run Zeek with JSON logging enabled via command line
            # We use -e to redef the default writer to JSON
            cmd = [
                zeek_cmd, "-C", "-r", str(pcap_path),
                f"Log::default_logdir={str(temp_path)}",
                "policy/tuning/json-logs.zeek"
            ]
            
            # Add a timeout to prevent infinite hanging (e.g., 5 minutes)
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
            
            if task_id and progress_dict:
                progress_dict[task_id]['message'] = 'Ingesting Zeek logs...'
                progress_dict[task_id]['progress'] = 20

            # Ingest logs if they exist
            # Note: Zeek JSON logs usually end with .log too
            for log_file, table_name in [
                ("conn.log", "conn_log"),
                ("dns.log", "dns_log"),
                ("http.log", "http_log"),
                ("ssl.log", "ssl_log")
            ]:
                log_path = temp_path / log_file
                if log_path.exists():
                    ingest_zeek_log(log_path, table_name, pcap_id)
            
            if task_id and progress_dict:
                progress_dict[task_id]['progress'] = 30
            
        except subprocess.TimeoutExpired:
            print("[Zeek] Analysis timed out.")
            if task_id and progress_dict:
                progress_dict[task_id]['message'] = 'Zeek analysis timed out. Skipping...'
        except subprocess.CalledProcessError as e:
            print(f"[Zeek] Analysis failed: {e.stderr.decode()}")
            if task_id and progress_dict:
                progress_dict[task_id]['message'] = 'Zeek analysis failed. Skipping...'
        except Exception as e:
            print(f"[Zeek] Error: {e}")
            if task_id and progress_dict:
                progress_dict[task_id]['message'] = f'Zeek error: {str(e)}. Skipping...'

def parse_and_ingest_pcap_sync(file_path: Path, pcap_id: uuid.UUID, original_filename: str, task_id: str, progress_dict: Dict[str, Any]):
    """Synchronously parses a PCAP file using dpkt and ingests data into ClickHouse."""
    print(f"[Task {task_id}] Starting analysis for {file_path}")
    
    try:
        # 1. Run Zeek Analysis first (Metadata)
        run_zeek_analysis(file_path, str(pcap_id), task_id, progress_dict)
        
        # 2. Run DPKT for Packet List (Headers only)
        if task_id in progress_dict:
            progress_dict[task_id]['status'] = 'processing_packets'
            progress_dict[task_id]['message'] = 'Indexing packets...'
            progress_dict[task_id]['progress'] = 30

        packets_to_insert_rows = []
        
        packet_count = 0
        total_bytes = 0
        start_time = None
        end_time = None
        batch_size = 5000 

        print(f"[ClickHouse Ingestion] Attempting to parse PCAP with dpkt: {file_path}")
        
        if not file_path.exists():
            raise ValueError(f"PCAP file does not exist: {file_path}")
        
        file_size = file_path.stat().st_size
        if file_size == 0:
            raise ValueError("Uploaded file is empty.")

        f = open(file_path, 'rb')
        try:
            pcap = dpkt.pcap.Reader(f)
        except ValueError:
            f.seek(0)
            try:
                magic = f.read(4)
                if magic == b'\x0a\x0d\x0d\x0a':
                     f.seek(0)
                     pcap = dpkt.pcapng.Reader(f)
                else:
                     f.seek(0)
                     pcap = dpkt.pcap.Reader(f)
            except Exception as e:
                print(f"dpkt failed to open file: {e}")
                raise ValueError("Invalid PCAP file or format not supported by dpkt.")

        packet_num_counter = 0
        estimated_packets = file_size / 800 
        
        for ts, buf in pcap:
            if task_id in progress_dict and progress_dict[task_id].get('status') == 'cancelled':
                print(f"[Task {task_id}] Cancelled by user.")
                return

            packet_num_counter += 1
            packet_count += 1
            timestamp = datetime.fromtimestamp(ts)
            length = len(buf)
            total_bytes += length
            
            if start_time is None: start_time = timestamp
            end_time = timestamp

            # Parse Ethernet
            try:
                eth = dpkt.ethernet.Ethernet(buf)
            except:
                continue

            # Default values
            src_ip_str = '0.0.0.0'
            dst_ip_str = '0.0.0.0'
            src_port = 0
            dst_port = 0
            protocol = 'Other'
            info_str = ''
            
            # Unwrap VLANs and MPLS to find IP
            pkt = eth
            while hasattr(pkt, 'type') and pkt.type in (dpkt.ethernet.ETH_TYPE_8021Q, dpkt.ethernet.ETH_TYPE_8021AD, dpkt.ethernet.ETH_TYPE_MPLS, dpkt.ethernet.ETH_TYPE_MPLS_MCAST):
                if hasattr(pkt, 'data'):
                    pkt = pkt.data
                else:
                    break

            # IP Layer
            ip_pkt = None
            if hasattr(pkt, 'data') and (isinstance(pkt.data, dpkt.ip.IP) or isinstance(pkt.data, dpkt.ip6.IP6)):
                ip_pkt = pkt.data
                src_ip_str = inet_to_str(ip_pkt.src)
                dst_ip_str = inet_to_str(ip_pkt.dst)
                
                # Try to resolve protocol name from number if not yet set
                if protocol == 'Other':
                    protocol = IP_PROTOCOLS.get(ip_pkt.p, f'Proto-{ip_pkt.p}')

                if isinstance(ip_pkt.data, dpkt.tcp.TCP):
                    protocol = 'TCP'
                    src_port = ip_pkt.data.sport
                    dst_port = ip_pkt.data.dport
                    flags = []
                    if ip_pkt.data.flags & dpkt.tcp.TH_SYN: flags.append('SYN')
                    if ip_pkt.data.flags & dpkt.tcp.TH_ACK: flags.append('ACK')
                    if ip_pkt.data.flags & dpkt.tcp.TH_RST: flags.append('RST')
                    if ip_pkt.data.flags & dpkt.tcp.TH_FIN: flags.append('FIN')
                    if ip_pkt.data.flags & dpkt.tcp.TH_PUSH: flags.append('PSH')
                    info_str = f"{src_port} -> {dst_port} [{' '.join(flags)}] Seq={ip_pkt.data.seq} Ack={ip_pkt.data.ack}"
                    
                    # Simple Heuristics for Info column (Zeek handles the deep analysis now)
                    if src_port == 80 or dst_port == 80 or src_port == 8080 or dst_port == 8080:
                        protocol = 'HTTP'
                    elif src_port == 443 or dst_port == 443:
                        protocol = 'TLS'
                    elif src_port == 53 or dst_port == 53:
                        protocol = 'DNS'

                elif isinstance(ip_pkt.data, dpkt.udp.UDP):
                    protocol = 'UDP'
                    src_port = ip_pkt.data.sport
                    dst_port = ip_pkt.data.dport
                    info_str = f"{src_port} -> {dst_port} Len={ip_pkt.data.ulen}"
                    
                    if src_port == 53 or dst_port == 53:
                        protocol = 'DNS'

                elif isinstance(ip_pkt.data, dpkt.icmp.ICMP):
                    protocol = 'ICMP'
                    info_str = f"Type={ip_pkt.data.type} Code={ip_pkt.data.code}"
            
            elif isinstance(eth.data, dpkt.arp.ARP):
                protocol = 'ARP'
                info_str = f"Who has {inet_to_str(eth.data.tpa)}? Tell {inet_to_str(eth.data.spa)}"

            # Construct a simplified layers_json for frontend compatibility
            # We can't easily replicate tshark's full structure, but we can provide enough for basic display
            layers_data = [
                {
                    "name": "frame",
                    "fields": {
                        "frame.time": timestamp.isoformat(),
                        "frame.len": length,
                        "frame.number": packet_num_counter,
                        "frame.protocols": protocol.lower()
                    }
                },
                {
                    "name": "eth",
                    "fields": {
                        "eth.src": mac_addr(eth.src),
                        "eth.dst": mac_addr(eth.dst),
                        "eth.type": eth.type
                    }
                }
            ]
            
            if ip_pkt:
                ip_version = "ip" if isinstance(ip_pkt, dpkt.ip.IP) else "ipv6"
                layers_data.append({
                    "name": ip_version,
                    "fields": {
                        f"{ip_version}.src": src_ip_str,
                        f"{ip_version}.dst": dst_ip_str,
                        f"{ip_version}.len": ip_pkt.len,
                        f"{ip_version}.ttl": ip_pkt.ttl
                    }
                })
                
                if protocol == 'TCP':
                    layers_data.append({
                        "name": "tcp",
                        "fields": {
                            "tcp.srcport": src_port,
                            "tcp.dstport": dst_port,
                            "tcp.seq": ip_pkt.data.seq,
                            "tcp.ack": ip_pkt.data.ack,
                            "tcp.flags": ip_pkt.data.flags
                        }
                    })
                elif protocol == 'UDP':
                    layers_data.append({
                        "name": "udp",
                        "fields": {
                            "udp.srcport": src_port,
                            "udp.dstport": dst_port,
                            "udp.length": ip_pkt.data.ulen
                        }
                    })

            packets_to_insert_rows.append((
                timestamp,
                pcap_id,
                packet_num_counter,
                src_ip_str,
                dst_ip_str,
                src_port,
                dst_port,
                protocol,
                length,
                0,
                info_str,
                json.dumps(layers_data)
            ))

            if len(packets_to_insert_rows) >= batch_size:
                get_ch_client().insert('packets', packets_to_insert_rows, column_names=['ts', 'pcap_id', 'packet_number', 'src_ip', 'dst_ip', 'src_port', 'dst_port', 'protocol', 'length', 'file_offset', 'info', 'layers_json'])
                packets_to_insert_rows = []
                
                # Update progress
                if packet_num_counter % 2000 == 0:
                    # Scale progress from 30% to 99%
                    base_progress = 30
                    remaining_progress = 69
                    current_progress = min(remaining_progress, int((packet_num_counter / estimated_packets) * remaining_progress))
                    
                    if task_id in progress_dict:
                        progress_dict[task_id]['progress'] = base_progress + current_progress
                        # Optional: Update message to show packet count
                        progress_dict[task_id]['message'] = f"Indexing packets... ({packet_num_counter} processed)"

        # Insert remaining packets
        if packets_to_insert_rows:
            get_ch_client().insert('packets', packets_to_insert_rows, column_names=['ts', 'pcap_id', 'packet_number', 'src_ip', 'dst_ip', 'src_port', 'dst_port', 'protocol', 'length', 'file_offset', 'info', 'layers_json'])

        # Final metadata update
        duration = (end_time - start_time).total_seconds() if start_time and end_time else 0
        
        # Use insert instead of command to handle UUID serialization correctly
        get_ch_client().insert(
            'pcap_metadata',
            [[
                pcap_id,
                original_filename,
                file_size,
                datetime.now(),
                packet_count,
                duration,
                'Processed with Zeek + dpkt'
            ]],
            column_names=['id', 'file_name', 'file_size', 'upload_time', 'total_packets', 'capture_duration', 'notes']
        )
        
        if task_id in progress_dict:
            progress_dict[task_id]['status'] = 'completed'
            progress_dict[task_id]['progress'] = 100
            progress_dict[task_id]['file_id'] = str(pcap_id)
            
        print(f"[ClickHouse Ingestion] Finished. {packet_count} packets.")
        return {"total_bytes": total_bytes}

    except Exception as e:
        print(f"[ClickHouse Ingestion] CRITICAL ERROR: {repr(e)}")
        import traceback
        traceback.print_exc()
        if task_id in progress_dict:
            progress_dict[task_id]['status'] = 'failed'
            progress_dict[task_id]['error'] = f"{type(e).__name__}: {str(e)}"
            progress_dict[task_id]['message'] = f"Failed: {str(e)}"
        raise e
