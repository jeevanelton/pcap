import dpkt
import socket
import json
from datetime import datetime
import uuid
from typing import Dict, Any, Optional, List
from pathlib import Path
import sys

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

# Common IP Protocol Numbers
IP_PROTOCOLS = {
    1: 'ICMP', 2: 'IGMP', 4: 'IP-in-IP', 6: 'TCP', 17: 'UDP', 27: 'RDP', 41: 'IPv6', 47: 'GRE', 
    50: 'ESP', 51: 'AH', 58: 'ICMPv6', 88: 'EIGRP', 89: 'OSPF', 103: 'PIM', 112: 'VRRP', 
    115: 'L2TP', 132: 'SCTP', 137: 'MPLS-in-IP'
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

def extract_dns_record(dns, ip_pkt, timestamp, pcap_id):
    """Extract Zeek-style DNS log fields from a dpkt DNS object."""
    try:
        # Basic packet info
        src_ip = inet_to_str(ip_pkt.src)
        dst_ip = inet_to_str(ip_pkt.dst)
        
        # Handle transport layer
        if isinstance(ip_pkt.data, dpkt.udp.UDP) or isinstance(ip_pkt.data, dpkt.tcp.TCP):
            src_port = ip_pkt.data.sport
            dst_port = ip_pkt.data.dport
            proto = "udp" if isinstance(ip_pkt.data, dpkt.udp.UDP) else "tcp"
        else:
            return None

        trans_id = dns.id
        
        # Query details
        query = ''
        qtype = 1
        qclass = 1
        
        if dns.qd:
            q = dns.qd[0]
            query = q.name
            qtype = q.type
            qclass = q.cls
            
        qtype_name = DNS_QTYPE_MAP.get(qtype, str(qtype))
        qclass_name = DNS_QCLASS_MAP.get(qclass, str(qclass))
        
        # Response code
        rcode = dns.rcode
        rcode_name = DNS_RCODE_MAP.get(rcode, str(rcode))
        
        # Flags
        AA = (dns.op & dpkt.dns.DNS_AA) != 0
        TC = (dns.op & dpkt.dns.DNS_TC) != 0
        RD = (dns.op & dpkt.dns.DNS_RD) != 0
        RA = (dns.op & dpkt.dns.DNS_RA) != 0
        Z = (dns.op & dpkt.dns.DNS_Z) != 0 # Not exactly Z bit in dpkt, but close enough for now
        
        # Answers
        answers = []
        ttls = []
        
        for ans in dns.an:
            ttls.append(ans.ttl)
            if ans.type == dpkt.dns.DNS_A:
                answers.append(inet_to_str(ans.rdata))
            elif ans.type == dpkt.dns.DNS_AAAA:
                answers.append(inet_to_str(ans.rdata))
            elif ans.type == dpkt.dns.DNS_CNAME:
                answers.append(ans.cname)
            elif ans.type == dpkt.dns.DNS_TXT:
                answers.append(str(ans.text))
            else:
                # Fallback for other types
                answers.append("...")

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
        return record
        
    except Exception as e:
        # print(f"[DNS EXTRACTION FAILED] Error: {e}")
        return None

def parse_and_ingest_pcap_sync(file_path: Path, pcap_id: uuid.UUID, original_filename: str, task_id: str, progress_dict: Dict[str, Any]):
    """Synchronously parses a PCAP file using dpkt and ingests data into ClickHouse."""
    packets_to_insert_dicts = []
    dns_records_to_insert = []
    packet_count = 0
    total_bytes = 0
    start_time = None
    end_time = None
    batch_size = 5000 # Larger batch size for speed
    dns_batch_size = 1000

    print(f"[ClickHouse Ingestion] Attempting to parse PCAP with dpkt: {file_path}")
    
    try:
        if not file_path.exists():
            raise ValueError(f"PCAP file does not exist: {file_path}")
        
        file_size = file_path.stat().st_size
        if file_size == 0:
            raise ValueError("Uploaded file is empty.")

        f = open(file_path, 'rb')
        try:
            pcap = dpkt.pcap.Reader(f)
        except ValueError:
            # Try pcapng if pcap fails (requires newer dpkt or fallback)
            # dpkt 1.9.x doesn't support pcapng well, but let's try just in case or fallback
            f.seek(0)
            try:
                # Basic check for pcapng magic number
                magic = f.read(4)
                if magic == b'\x0a\x0d\x0d\x0a':
                     # It is pcapng. dpkt might not support it.
                     # We will fallback to tshark -T ek if dpkt fails, but let's assume pcap for now
                     # or try to use a pcapng library if available.
                     # For now, let's assume standard pcap or that dpkt handles it.
                     pass
                f.seek(0)
                pcap = dpkt.pcap.Reader(f)
            except Exception as e:
                print(f"dpkt failed to open file: {e}")
                raise ValueError("Invalid PCAP file or format not supported by dpkt.")

        packet_num_counter = 0
        
        # Estimate total packets for progress (avg packet size ~800 bytes?)
        estimated_packets = file_size / 800 
        
        for ts, buf in pcap:
            # Check for cancellation
            if task_id in progress_dict and progress_dict[task_id].get('status') == 'cancelled':
                print(f"[ClickHouse Ingestion] Task {task_id} cancelled. Cleaning up...")
                try:
                    client = get_ch_client()
                    client.command(f"ALTER TABLE packets DELETE WHERE pcap_id = '{pcap_id}'")
                    client.command(f"ALTER TABLE dns_log DELETE WHERE pcap_id = '{pcap_id}'")
                except Exception as cleanup_error:
                    print(f"Cleanup failed: {cleanup_error}")
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
                    
                    # Check for HTTP/TLS/SSH based on ports (heuristic)
                    if src_port == 80 or dst_port == 80 or src_port == 8080 or dst_port == 8080:
                        protocol = 'HTTP'
                        try:
                            if src_port == 80 or src_port == 8080:
                                http = dpkt.http.Response(ip_pkt.data.data)
                                info_str = f"HTTP {http.status} {http.reason}"
                            else:
                                http = dpkt.http.Request(ip_pkt.data.data)
                                info_str = f"{http.method} {http.uri}"
                        except:
                            pass
                    elif src_port == 443 or dst_port == 443:
                        protocol = 'TLS'
                        info_str = "Application Data"
                    elif src_port == 22 or dst_port == 22:
                        protocol = 'SSH'
                        info_str = "Encrypted Packet"
                    
                    # Check for DNS over TCP
                    if src_port in (53, 5353, 5355) or dst_port in (53, 5353, 5355):
                        protocol = 'DNS'
                        try:
                            # DNS over TCP has a 2-byte length prefix which dpkt.dns.DNS doesn't handle automatically
                            # We need to skip it if parsing directly
                            dns_data = ip_pkt.data.data
                            if len(dns_data) > 2:
                                # Try parsing without length prefix
                                try:
                                    dns = dpkt.dns.DNS(dns_data[2:])
                                except:
                                    # Fallback to raw
                                    dns = dpkt.dns.DNS(dns_data)
                                
                                if dns.qd:
                                    info_str = f"Standard query {dns.qd[0].name}"
                                elif dns.an:
                                    info_str = f"Standard query response {dns.an[0].name if hasattr(dns.an[0], 'name') else ''}"
                                
                                dns_record = extract_dns_record(dns, ip_pkt, timestamp, pcap_id)
                                if dns_record:
                                    dns_records_to_insert.append(dns_record)
                        except Exception as e:
                            # print(f"DNS TCP Parse Error: {e}")
                            pass

                elif isinstance(ip_pkt.data, dpkt.udp.UDP):
                    protocol = 'UDP'
                    src_port = ip_pkt.data.sport
                    dst_port = ip_pkt.data.dport
                    info_str = f"{src_port} -> {dst_port} Len={ip_pkt.data.ulen}"
                    
                    # Check for DNS (53), mDNS (5353), LLMNR (5355), NBNS (137)
                    if src_port in (53, 5353, 5355, 137) or dst_port in (53, 5353, 5355, 137):
                        if src_port == 5353 or dst_port == 5353:
                            protocol = 'mDNS'
                        elif src_port == 5355 or dst_port == 5355:
                            protocol = 'LLMNR'
                        elif src_port == 137 or dst_port == 137:
                            protocol = 'NBNS'
                        else:
                            protocol = 'DNS'
                            
                        try:
                            dns = dpkt.dns.DNS(ip_pkt.data.data)
                            if dns.qd:
                                info_str = f"Standard query {dns.qd[0].name}"
                            elif dns.an:
                                info_str = f"Standard query response {dns.an[0].name if hasattr(dns.an[0], 'name') else ''}"
                            
                            # Extract DNS record
                            dns_record = extract_dns_record(dns, ip_pkt, timestamp, pcap_id)
                            if dns_record:
                                dns_records_to_insert.append(dns_record)
                        except Exception as e:
                            # print(f"DNS UDP Parse Error: {e}")
                            info_str += " (Malformed DNS)"
                            pass
                    elif src_port == 67 or dst_port == 67 or src_port == 68 or dst_port == 68:
                        protocol = 'DHCP'
                    elif src_port == 123 or dst_port == 123:
                        protocol = 'NTP'
                    elif src_port == 1900 or dst_port == 1900:
                        protocol = 'SSDP'

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
            
            layers_json = json.dumps(layers_data)

            packets_to_insert_dicts.append({
                "ts": timestamp, "pcap_id": pcap_id, "packet_number": packet_num_counter,
                "src_ip": src_ip_str, "dst_ip": dst_ip_str, "src_port": src_port,
                "dst_port": dst_port, "protocol": protocol, "length": length,
                "file_offset": 0, "info": info_str, "layers_json": layers_json
            })

            # Batch Insert
            if len(packets_to_insert_dicts) >= batch_size:
                rows = []
                for r in packets_to_insert_dicts:
                    rows.append((
                        r["ts"], r["pcap_id"], r["packet_number"], r["src_ip"], r["dst_ip"], 
                        r["src_port"], r["dst_port"], r["protocol"], r["length"], 
                        r["file_offset"], r["info"], r["layers_json"]
                    ))
                get_ch_client().insert('packets', rows, column_names=[
                    "ts", "pcap_id", "packet_number", "src_ip", "dst_ip", "src_port", 
                    "dst_port", "protocol", "length", "file_offset", "info", "layers_json"
                ])
                packets_to_insert_dicts = []
                
                # Update progress (approximate)
                progress = min(99, (packet_num_counter / estimated_packets) * 100) if estimated_packets > 0 else 0
                progress_dict[task_id] = {'status': 'processing', 'progress': progress}

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
                get_ch_client().insert('dns_log', dns_rows, column_names=[
                    'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p',
                    'id_resp_h', 'id_resp_p', 'proto', 'trans_id',
                    'query', 'qclass', 'qclass_name', 'qtype', 'qtype_name',
                    'rcode', 'rcode_name', 'AA', 'TC', 'RD', 'RA',
                    'Z', 'answers', 'TTLs', 'rejected'
                ])
                dns_records_to_insert = []

        # Final Batch
        if packets_to_insert_dicts:
            rows = []
            for r in packets_to_insert_dicts:
                rows.append((
                    r["ts"], r["pcap_id"], r["packet_number"], r["src_ip"], r["dst_ip"], 
                    r["src_port"], r["dst_port"], r["protocol"], r["length"], 
                    r["file_offset"], r["info"], r["layers_json"]
                ))
            get_ch_client().insert('packets', rows, column_names=[
                "ts", "pcap_id", "packet_number", "src_ip", "dst_ip", "src_port", 
                "dst_port", "protocol", "length", "file_offset", "info", "layers_json"
            ])

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
            get_ch_client().insert('dns_log', dns_rows, column_names=[
                'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p',
                'id_resp_h', 'id_resp_p', 'proto', 'trans_id',
                'query', 'qclass', 'qclass_name', 'qtype', 'qtype_name',
                'rcode', 'rcode_name', 'AA', 'TC', 'RD', 'RA',
                'Z', 'answers', 'TTLs', 'rejected'
            ])

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

    except Exception as e:
        progress_dict[task_id] = {'status': 'error', 'message': str(e)}
        print(f"[ClickHouse Ingestion] Error during ingestion: {e}")
        raise e
