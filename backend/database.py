import time
import clickhouse_connect
from fastapi import HTTPException
from config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DATABASE

_ch_client = None  # Lazy singleton

def _attempt_connect():
    return clickhouse_connect.get_client(
        host=CH_HOST,
        port=CH_PORT,
        username=CH_USER,
        password=CH_PASSWORD,
        database=CH_DATABASE,
    )

def get_ch_client():
    """Return a cached ClickHouse client, connecting on first use.
    Raises HTTPException(500) if connection cannot be established.
    """
    global _ch_client
    if _ch_client is not None:
        return _ch_client
    try:
        _ch_client = _attempt_connect()
        _ch_client.ping()
        print(f"[ClickHouse] Connected -> {CH_HOST}:{CH_PORT} / DB={CH_DATABASE}")
        return _ch_client
    except Exception as e:
        print(f"[ClickHouse] Initial connect failed: {e}")
        raise HTTPException(status_code=500, detail=f"ClickHouse connect failed: {e}")

def wait_for_clickhouse(max_seconds: int = 30, interval: float = 2.0) -> bool:
    """Retry connection until ClickHouse is reachable or timeout."""
    deadline = time.time() + max_seconds
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        try:
            client = _attempt_connect()
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

