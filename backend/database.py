import clickhouse_connect
from fastapi import HTTPException
from .config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DATABASE

# Initialize ClickHouse client
def get_clickhouse_client():
    try:
        client = clickhouse_connect.get_client(
            host=CH_HOST,
            port=CH_PORT,
            username=CH_USER,
            password=CH_PASSWORD,
            database=CH_DATABASE
        )
        client.ping() # Test connection
        print("Successfully connected to ClickHouse")
        return client
    except Exception as e:
        print(f"Error connecting to ClickHouse: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to connect to database: {e}")

ch_client = get_clickhouse_client()

def init_schema():
    # Ensure database exists
    ch_client.command(f"CREATE DATABASE IF NOT EXISTS {CH_DATABASE}")

    # Users table
    ch_client.command(
        """
        CREATE TABLE IF NOT EXISTS users (
            id UUID,
            email String,
            password_hash String,
            created_at DateTime DEFAULT now()
        ) ENGINE = MergeTree ORDER BY (id)
        """
    )

    # Projects table
    ch_client.command(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id UUID,
            user_id UUID,
            name String,
            created_at DateTime DEFAULT now()
        ) ENGINE = MergeTree ORDER BY (user_id, id)
        """
    )

    # Mapping table between PCAP and Projects/Users
    ch_client.command(
        """
        CREATE TABLE IF NOT EXISTS pcap_project_map (
            pcap_id UUID,
            project_id UUID,
            user_id UUID,
            created_at DateTime DEFAULT now()
        ) ENGINE = MergeTree ORDER BY (user_id, project_id, pcap_id)
        """
    )

# Initialize schema at import time
try:
    init_schema()
except Exception as e:
    # Do not crash app on startup; will surface via endpoints
    print(f"Schema init warning: {e}")
