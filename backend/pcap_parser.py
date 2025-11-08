import pyshark
from datetime import datetime
import uuid
from typing import Dict, Any, Optional
import json
from pathlib import Path

from database import get_ch_client

# DNS query/response type and rcode mappings (Zeek-compatible)
DNS_QTYPE_MAP = {
    1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX",
    16: "TXT", 28: "AAAA", 33: "SRV", 41: "OPT", 43: "DS", 44: "SSHFP",
    46: "RRSIG", 47: "NSEC", 48: "DNSKEY", 50: "NSEC3", 51: "NSEC3PARAM",
    52: "TLSA", 257: "CAA", 255: "ANY"
}

DNS_RCODE_MAP = {
    0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP",
    5: "REFUSED", 6: "YXDOMAIN", 7: "YXRRSET", 8: "NXRRSET", 9: "NOTAUTH",
    10: "NOTZONE", 16: "BADVERS"
}

DNS_QCLASS_MAP = {
    1: "C_INTERNET", 3: "C_CHAOS", 4: "C_HESIOD", 254: "C_NONE", 255: "C_ANY"
}

def extract_dns_record(packet: Any, pcap_id: uuid.UUID, timestamp: datetime) -> Optional[Dict[str, Any]]:
    """Extract Zeek-style DNS log fields from a DNS packet."""
    try:
        if not hasattr(packet, 'dns'):
            return None
        
        print(f"[DNS EXTRACTION] Processing packet for DNS data...")
        dns = packet.dns
        
        # Basic packet info
        src_ip = packet.ip.src if hasattr(packet, 'ip') else (packet.ipv6.src if hasattr(packet, 'ipv6') else '0.0.0.0')
        dst_ip = packet.ip.dst if hasattr(packet, 'ip') else (packet.ipv6.dst if hasattr(packet, 'ipv6') else '0.0.0.0')
        src_port = int(packet.udp.srcport) if hasattr(packet, 'udp') else (int(packet.tcp.srcport) if hasattr(packet, 'tcp') else 0)
        dst_port = int(packet.udp.dstport) if hasattr(packet, 'udp') else (int(packet.tcp.dstport) if hasattr(packet, 'tcp') else 0)
        proto = "udp" if hasattr(packet, 'udp') else ("tcp" if hasattr(packet, 'tcp') else "unknown")
        
        trans_id = int(dns.id, 16) if isinstance(dns.id, str) else int(dns.id)
        
        # Query details
        query = getattr(dns, 'qry_name', '')
        qtype_raw = getattr(dns, 'qry_type', '1')
        qclass_raw = getattr(dns, 'qry_class', '1')
        
        qtype = int(qtype_raw)
        qtype_name = DNS_QTYPE_MAP.get(qtype, str(qtype))
        
        qclass = int(qclass_raw, 16) if isinstance(qclass_raw, str) else int(qclass_raw)
        qclass_name = DNS_QCLASS_MAP.get(qclass, str(qclass))
        
        # Response code
        rcode = int(getattr(dns, 'flags_rcode', '0'))
        rcode_name = DNS_RCODE_MAP.get(rcode, str(rcode))
        
        # Flags
        AA = getattr(dns, 'flags_authoritative', '0') == '1'
        TC = getattr(dns, 'flags_truncated', '0') == '1'
        RD = getattr(dns, 'flags_recdesired', '0') == '1'
        RA = getattr(dns, 'flags_recavail', '0') == '1'
        
        # Handle Z flag - pyshark returns string "False"/"True" or "0"/"1"
        Z_raw = getattr(dns, 'flags_z', '0')
        if Z_raw in ('True', '1', 1):
            Z = 1
        else:
            Z = 0
        
        # Robust answer and TTL extraction
        answers = []
        ttls = []
        
        # pyshark can present answers in many ways. We need to check for all common attributes.
        # The `dns.answers` field is often a list of `DNSRR` objects.
        if hasattr(dns, 'answers') and isinstance(dns.answers, list):
            for answer in dns.answers:
                try:
                    if hasattr(answer, 'data'):
                        answers.append(str(answer.data))
                    elif hasattr(answer, 'cname'):
                        answers.append(str(answer.cname))
                    elif hasattr(answer, 'nsname'):
                        answers.append(str(answer.nsname))
                    elif hasattr(answer, 'mx_mail_exchange'):
                        answers.append(str(answer.mx_mail_exchange))
                    elif hasattr(answer, 'txt'):
                        answers.append(str(answer.txt))
                    
                    if hasattr(answer, 'ttl'):
                        ttls.append(int(answer.ttl))
                except Exception as e:
                    print(f"[DNS Answer Extraction] Error processing an answer object: {e}")

        # Fallback for when `dns.answers` is not available or not a list
        else:
            # A/AAAA records
            if hasattr(dns, 'a'):
                answers.append(dns.a)
                if hasattr(dns, 'a_ttl'): ttls.append(int(dns.a_ttl))
            if hasattr(dns, 'aaaa'):
                answers.append(dns.aaaa)
                if hasattr(dns, 'aaaa_ttl'): ttls.append(int(dns.aaaa_ttl))
            
            # CNAME
            if hasattr(dns, 'cname'):
                answers.append(dns.cname)
                if hasattr(dns, 'cname_ttl'): ttls.append(int(dns.cname_ttl))
            
            # MX
            if hasattr(dns, 'mx_mail_exchange'):
                answers.append(dns.mx_mail_exchange)
                if hasattr(dns, 'mx_mail_exchange_ttl'): ttls.append(int(dns.mx_mail_exchange_ttl))
            
            # TXT
            if hasattr(dns, 'txt'):
                answers.append(dns.txt)
                if hasattr(dns, 'txt_ttl'): ttls.append(int(dns.txt_ttl))

        uid = f"C{hash(f'{src_ip}{src_port}{dst_ip}{dst_port}{trans_id}{timestamp}') % 100000000:08x}"
        
        record = {
            'ts': timestamp, 'uid': uid, 'pcap_id': pcap_id,
            'id_orig_h': src_ip, 'id_orig_p': src_port,
            'id_resp_h': dst_ip, 'id_resp_p': dst_port,
            'proto': proto, 'trans_id': trans_id, 'query': query,
            'qclass': qclass, 'qclass_name': qclass_name,
            'qtype': qtype, 'qtype_name': qtype_name,
            'rcode': rcode, 'rcode_name': rcode_name,
            'AA': AA, 'TC': TC, 'RD': RD, 'RA': RA, 'Z': Z,
            'answers': answers, 'TTLs': ttls, 'rejected': False
        }
        print(f"[DNS EXTRACTION SUCCESS] Extracted record: {record}")
        return record
        
    except Exception as e:
        print(f"[DNS EXTRACTION FAILED] Packet: {packet.number}, Error: {e}")
        import traceback
        traceback.print_exc()
        return None


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
    dns_records_to_insert = []
    packet_count = 0
    total_bytes = 0
    start_time = None
    end_time = None
    batch_size = 1000 # Insert in batches
    dns_batch_size = 500

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
            
            # Extract DNS log if packet is DNS
            if packet_data and packet_data['protocol'] == 'DNS':
                dns_record = extract_dns_record(packet, pcap_id, packet_data['ts'])
                if dns_record:
                    dns_records_to_insert.append(dns_record)

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
                
                print(f"[ClickHouse Ingestion] Inserting batch of {len(rows)} packets")
                get_ch_client().insert(
                    'packets',
                    rows,
                    column_names=[
                        "ts", "pcap_id", "packet_number", "src_ip", "dst_ip", "src_port", 
                        "dst_port", "protocol", "length", "file_offset", "info", "layers_json"
                    ]
                )
                packets_to_insert_dicts = []
                
            # Insert DNS records batch
            if len(dns_records_to_insert) >= dns_batch_size:
                dns_rows = []
                for d in dns_records_to_insert:
                    dns_rows.append((
                        d['ts'], d['uid'], d['pcap_id'], d['id_orig_h'], d['id_orig_p'],
                        d['id_resp_h'], d['id_resp_p'], d['proto'], d['trans_id'],
                        d['query'], d['qclass'], d['qclass_name'], d['qtype'], d['qtype_name'],
                        d['rcode'], d['rcode_name'], d['AA'], d['TC'], d['RD'], d['RA'],
                        d['Z'], d['answers'], d['TTLs'], d['rejected']
                    ))
                get_ch_client().insert(
                    'dns_log',
                    dns_rows,
                    column_names=[
                        'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p',
                        'id_resp_h', 'id_resp_p', 'proto', 'trans_id',
                        'query', 'qclass', 'qclass_name', 'qtype', 'qtype_name',
                        'rcode', 'rcode_name', 'AA', 'TC', 'RD', 'RA',
                        'Z', 'answers', 'TTLs', 'rejected'
                    ]
                )
                print(f"[ClickHouse Ingestion] Inserted {len(dns_rows)} DNS records")
                dns_records_to_insert = []
            
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
            print(f"[ClickHouse Ingestion] Inserting final batch of {len(rows)} packets")
            get_ch_client().insert(
                'packets',
                rows,
                column_names=[
                    "ts", "pcap_id", "packet_number", "src_ip", "dst_ip", "src_port", 
                    "dst_port", "protocol", "length", "file_offset", "info", "layers_json"
                ]
            )
        
        # Insert remaining DNS records
        if dns_records_to_insert:
            dns_rows = []
            for d in dns_records_to_insert:
                dns_rows.append((
                    d['ts'], d['uid'], d['pcap_id'], d['id_orig_h'], d['id_orig_p'],
                    d['id_resp_h'], d['id_resp_p'], d['proto'], d['trans_id'],
                    d['query'], d['qclass'], d['qclass_name'], d['qtype'], d['qtype_name'],
                    d['rcode'], d['rcode_name'], d['AA'], d['TC'], d['RD'], d['RA'],
                    d['Z'], d['answers'], d['TTLs'], d['rejected']
                ))
            get_ch_client().insert(
                'dns_log',
                dns_rows,
                column_names=[
                    'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p',
                    'id_resp_h', 'id_resp_p', 'proto', 'trans_id',
                    'query', 'qclass', 'qclass_name', 'qtype', 'qtype_name',
                    'rcode', 'rcode_name', 'AA', 'TC', 'RD', 'RA',
                    'Z', 'answers', 'TTLs', 'rejected'
                ]
            )
            print(f"[ClickHouse Ingestion] Inserted final {len(dns_rows)} DNS records")

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
