import time
import clickhouse_connect
from fastapi import HTTPException
from config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DATABASE

_ch_client = None  # Lazy singleton (DEPRECATED: Do not use global client for queries)

def _attempt_connect():
    return clickhouse_connect.get_client(
        host=CH_HOST,
        port=CH_PORT,
        username=CH_USER,
        password=CH_PASSWORD,
        database=CH_DATABASE,
    )

def get_ch_client(database=CH_DATABASE):
    """Return a new ClickHouse client for each request to avoid concurrency issues.
    """
    try:
        # Try connecting to the specified database
        try:
            client = clickhouse_connect.get_client(
                host=CH_HOST,
                port=CH_PORT,
                username=CH_USER,
                password=CH_PASSWORD,
                database=database,
            )
        except Exception as e:
            # If database doesn't exist, connect to default to create it
            if "UNKNOWN_DATABASE" in str(e) or "does not exist" in str(e):
                print(f"[ClickHouse] Database {database} not found, connecting to default...")
                temp_client = clickhouse_connect.get_client(
                    host=CH_HOST,
                    port=CH_PORT,
                    username=CH_USER,
                    password=CH_PASSWORD,
                    database="default",
                )
                temp_client.command(f"CREATE DATABASE IF NOT EXISTS {database}")
                print(f"[ClickHouse] Created database {database}")
                # Now connect to the new database
                client = clickhouse_connect.get_client(
                    host=CH_HOST,
                    port=CH_PORT,
                    username=CH_USER,
                    password=CH_PASSWORD,
                    database=database,
                )
            else:
                raise e

        # client.ping() # Optional, can be slow
        return client
    except Exception as e:
        print(f"[ClickHouse] Connect failed: {e}")
        raise HTTPException(status_code=500, detail=f"ClickHouse connect failed: {e}")

def wait_for_clickhouse(max_seconds: int = 30, interval: float = 2.0) -> bool:
    """Retry connection until ClickHouse is reachable or timeout."""
    deadline = time.time() + max_seconds
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        try:
            client = get_ch_client()
            client.ping()
            print(f"[ClickHouse] Ready after {attempt} attempt(s)")
            global _ch_client
            _ch_client = client
            return True
        except Exception as e:
            print(f"[ClickHouse] Not ready (attempt {attempt}): {e}")
            time.sleep(interval)
    print("[ClickHouse] Give up waiting for server")
    return False

def init_schema():
    client = get_ch_client()
    client.command(f"CREATE DATABASE IF NOT EXISTS {CH_DATABASE}")

    statements = [
        ("users", """
            CREATE TABLE IF NOT EXISTS users (
                id UUID,
                email String,
                password_hash String,
                created_at DateTime DEFAULT now()
            ) ENGINE = MergeTree ORDER BY (id)
        """),
        ("projects", """
            CREATE TABLE IF NOT EXISTS projects (
                id UUID,
                user_id UUID,
                name String,
                created_at DateTime DEFAULT now()
            ) ENGINE = MergeTree ORDER BY (user_id, id)
        """),
        ("pcap_project_map", """
            CREATE TABLE IF NOT EXISTS pcap_project_map (
                pcap_id UUID,
                project_id UUID,
                user_id UUID,
                created_at DateTime DEFAULT now()
            ) ENGINE = MergeTree ORDER BY (user_id, project_id, pcap_id)
        """),
        # Use String for IP fields to support both IPv4 and IPv6 uniformly
        ("packets", """
            CREATE TABLE IF NOT EXISTS packets (
                ts DateTime,
                pcap_id UUID,
                packet_number UInt32,
                src_ip String,
                dst_ip String,
                src_port UInt16,
                dst_port UInt16,
                protocol String,
                length UInt32,
                file_offset UInt64,
                info String,
                layers_json String
            ) ENGINE = MergeTree
            ORDER BY (pcap_id, packet_number)
        """),
        ("pcap_metadata", """
            CREATE TABLE IF NOT EXISTS pcap_metadata (
                id UUID,
                file_name String,
                file_size UInt64,
                upload_time DateTime,
                total_packets UInt32,
                capture_duration Float64,
                notes String
            ) ENGINE = MergeTree
            ORDER BY (upload_time)
        """),
        # Zeek-style dns.log table
        ("dns_log", """
            CREATE TABLE IF NOT EXISTS dns_log (
                ts DateTime,
                uid String,
                pcap_id UUID,
                id_orig_h String,
                id_orig_p UInt16,
                id_resp_h String,
                id_resp_p UInt16,
                proto String,
                trans_id UInt16,
                query String,
                qclass UInt16,
                qclass_name String,
                qtype UInt16,
                qtype_name String,
                rcode UInt16,
                rcode_name String,
                AA Bool,
                TC Bool,
                RD Bool,
                RA Bool,
                Z UInt8,
                answers Array(String),
                TTLs Array(UInt32),
                rejected Bool
            ) ENGINE = MergeTree
            ORDER BY (pcap_id, ts)
        """),
        # Zeek-style http.log table
        ("http_log", """
            CREATE TABLE IF NOT EXISTS http_log (
                ts DateTime,
                uid String,
                pcap_id UUID,
                id_orig_h String,
                id_orig_p UInt16,
                id_resp_h String,
                id_resp_p UInt16,
                trans_depth UInt16,
                method String,
                host String,
                uri String,
                referrer String,
                version String,
                user_agent String,
                request_body_len UInt64,
                response_body_len UInt64,
                status_code UInt16,
                status_msg String,
                tags Array(String),
                username String,
                password String,
                proxied Array(String),
                orig_fuids Array(String),
                orig_filenames Array(String),
                orig_mime_types Array(String),
                resp_fuids Array(String),
                resp_filenames Array(String),
                resp_mime_types Array(String)
            ) ENGINE = MergeTree
            ORDER BY (pcap_id, ts)
        """),
        # Zeek-style conn.log table
        ("conn_log", """
            CREATE TABLE IF NOT EXISTS conn_log (
                ts DateTime,
                uid String,
                pcap_id UUID,
                id_orig_h String,
                id_orig_p UInt16,
                id_resp_h String,
                id_resp_p UInt16,
                proto String,
                service String,
                duration Float64,
                orig_bytes UInt64,
                resp_bytes UInt64,
                conn_state String,
                local_orig Bool,
                local_resp Bool,
                missed_bytes UInt64,
                history String,
                orig_pkts UInt64,
                orig_ip_bytes UInt64,
                resp_pkts UInt64,
                resp_ip_bytes UInt64,
                tunnel_parents Array(String)
            ) ENGINE = MergeTree
            ORDER BY (pcap_id, ts)
        """),
        # Zeek-style ssl.log table
        ("ssl_log", """
            CREATE TABLE IF NOT EXISTS ssl_log (
                ts DateTime,
                uid String,
                pcap_id UUID,
                id_orig_h String,
                id_orig_p UInt16,
                id_resp_h String,
                id_resp_p UInt16,
                version String,
                cipher String,
                curve String,
                server_name String,
                resumed Bool,
                last_alert String,
                next_protocol String,
                established Bool,
                cert_chain_fuids Array(String),
                client_cert_chain_fuids Array(String),
                subject String,
                issuer String,
                client_subject String,
                client_issuer String,
                validation_status String
            ) ENGINE = MergeTree
            ORDER BY (pcap_id, ts)
        """)
    ]

    for name, ddl in statements:
        try:
            client.command(ddl)
            print(f"[ClickHouse] Ensured table: {name}")
        except Exception as e:
            print(f"[ClickHouse] Failed ensuring table {name}: {e}")

    # Final verification list
    existing = [r[0] for r in client.query(f"SHOW TABLES FROM {CH_DATABASE}").result_rows]
    print(f"[ClickHouse] Schema ensured. Tables present: {existing}")

