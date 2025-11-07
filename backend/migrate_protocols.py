"""
ClickHouse Protocol Migration Script
Fixes existing DATA protocol entries to proper UDP/TCP based on layers_json
Run this once to clean up existing data
"""

import clickhouse_connect
import json
from .config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DATABASE

# Connect to ClickHouse
client = clickhouse_connect.get_client(
    host=CH_HOST,
    port=CH_PORT,
    username=CH_USER,
    password=CH_PASSWORD,
    database=CH_DATABASE
)

def migrate_protocols():
    """Migrate DATA protocols to UDP/TCP based on layers_json"""
    
    print("Starting protocol migration...")
    
    # Get all packets with DATA protocol
    query = """
    SELECT pcap_id, packet_number, layers_json 
    FROM packets 
    WHERE protocol = 'DATA'
    LIMIT 10000
    """
    
    result = client.query(query)
    rows = result.result_rows
    
    print(f"Found {len(rows)} packets with DATA protocol")
    
    udp_updates = []
    tcp_updates = []
    
    for pcap_id, packet_num, layers_json_str in rows:
        try:
            layers = json.loads(layers_json_str) if layers_json_str else []
            layer_names = [layer.get('name', '').lower() for layer in layers]
            
            if 'udp' in layer_names:
                udp_updates.append((str(pcap_id), packet_num))
            elif 'tcp' in layer_names:
                tcp_updates.append((str(pcap_id), packet_num))
        except Exception as e:
            print(f"Error processing packet {pcap_id}:{packet_num}: {e}")
            continue
    
    print(f"Updating {len(udp_updates)} packets to UDP...")
    for pcap_id, packet_num in udp_updates:
        client.command(f"""
            ALTER TABLE packets 
            UPDATE protocol = 'UDP' 
            WHERE pcap_id = '{pcap_id}' AND packet_number = {packet_num}
        """)
    
    print(f"Updating {len(tcp_updates)} packets to TCP...")
    for pcap_id, packet_num in tcp_updates:
        client.command(f"""
            ALTER TABLE packets 
            UPDATE protocol = 'TCP' 
            WHERE pcap_id = '{pcap_id}' AND packet_number = {packet_num}
        """)
    
    print("Migration complete!")
    print(f"  UDP: {len(udp_updates)} packets")
    print(f"  TCP: {len(tcp_updates)} packets")

if __name__ == "__main__":
    migrate_protocols()
