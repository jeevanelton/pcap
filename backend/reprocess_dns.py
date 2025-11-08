#!/usr/bin/env python3
"""Manual DNS reprocessing script to populate dns_log from existing packets."""

import json
import uuid
from database import get_ch_client

# DNS mappings
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

def reprocess_dns(file_id):
    """Reprocess DNS packets for a specific file."""
    client = get_ch_client()
    
    # Get DNS packets
    query = f"""
    SELECT ts, src_ip, dst_ip, src_port, dst_port, layers_json
    FROM packets 
    WHERE pcap_id = '{file_id}' AND protocol = 'DNS'
    """
    result = client.query(query)
    print(f"Found {len(result.result_rows)} DNS packets to process")
    
    dns_records = []
    for idx, row in enumerate(result.result_rows):
        ts, src_ip, dst_ip, src_port, dst_port, layers_json_str = row
        
        try:
            layers = json.loads(layers_json_str) if layers_json_str else []
            dns_layer = next((l for l in layers if l.get('name', '').lower() == 'dns'), None)
            
            if not dns_layer:
                print(f"  Packet {idx+1}: No DNS layer found")
                continue
            
            fields = dns_layer.get('fields', {})
            
            # Extract DNS fields with proper hex handling
            trans_id_str = fields.get('id', '0')
            if trans_id_str.startswith('0x'):
                trans_id = int(trans_id_str, 16)
            else:
                trans_id = int(trans_id_str) if trans_id_str.isdigit() else 0
            
            query_name = fields.get('qry_name', '')
            
            qtype_raw = fields.get('qry_type', '1')
            qtype = int(qtype_raw) if str(qtype_raw).isdigit() else 1
            qtype_name = DNS_QTYPE_MAP.get(qtype, str(qtype))
            
            qclass_raw = fields.get('qry_class', '0x0001')
            if str(qclass_raw).startswith('0x'):
                qclass = int(qclass_raw, 16)
            else:
                qclass = int(qclass_raw) if str(qclass_raw).isdigit() else 1
            qclass_name = DNS_QCLASS_MAP.get(qclass, str(qclass))
            
            # Response code
            rcode = 0
            rcode_name = "NOERROR"
            if 'flags_rcode' in fields:
                rcode_raw = fields.get('flags_rcode', '0')
                if isinstance(rcode_raw, str):
                    if rcode_raw.startswith('0x'):
                        rcode = int(rcode_raw, 16)
                    elif rcode_raw.isdigit():
                        rcode = int(rcode_raw)
                rcode_name = DNS_RCODE_MAP.get(rcode, str(rcode))
            
            # DNS flags
            AA = fields.get('flags_authoritative', 'False') == 'True'
            TC = fields.get('flags_truncated', 'False') == 'True'
            RD = fields.get('flags_recdesired', 'False') == 'True'
            RA = fields.get('flags_recavail', 'False') == 'True'
            Z_raw = fields.get('flags_z', '0')
            Z = 1 if Z_raw == 'True' else 0
            
            # Answers
            answers = []
            for ans_field in ['a', 'aaaa', 'cname', 'ptr', 'ns', 'mx', 'txt', 'soa']:
                if ans_field in fields:
                    answers.append(str(fields[ans_field]))
            
            # Generate UID
            uid = f"C{hash(f'{src_ip}{src_port}{dst_ip}{dst_port}{trans_id}{ts}') % 100000000:08x}"
            
            dns_records.append((
                ts, uid, uuid.UUID(file_id), str(src_ip), int(src_port),
                str(dst_ip), int(dst_port), "udp", trans_id,
                query_name, qclass, qclass_name, qtype, qtype_name,
                rcode, rcode_name, AA, TC, RD, RA, Z,
                answers, [], False
            ))
            
            print(f"  Packet {idx+1}: query={query_name}, qtype={qtype_name}, rcode={rcode_name}")
            
        except Exception as e:
            print(f"  Packet {idx+1}: Error - {e}")
            import traceback
            traceback.print_exc()
    
    if dns_records:
        print(f"\nInserting {len(dns_records)} DNS records into dns_log...")
        client.insert(
            'dns_log',
            dns_records,
            column_names=[
                'ts', 'uid', 'pcap_id', 'id_orig_h', 'id_orig_p',
                'id_resp_h', 'id_resp_p', 'proto', 'trans_id',
                'query', 'qclass', 'qclass_name', 'qtype', 'qtype_name',
                'rcode', 'rcode_name', 'AA', 'TC', 'RD', 'RA',
                'Z', 'answers', 'TTLs', 'rejected'
            ]
        )
        print(f"Successfully inserted {len(dns_records)} DNS records!")
    else:
        print("No DNS records to insert")

if __name__ == "__main__":
    # Get the file ID from the database
    client = get_ch_client()
    result = client.query("SELECT DISTINCT pcap_id FROM packets WHERE protocol = 'DNS' LIMIT 1")
    if result.result_rows:
        file_id = str(result.result_rows[0][0])
        print(f"Processing file_id: {file_id}\n")
        reprocess_dns(file_id)
    else:
        print("No DNS packets found in database")
