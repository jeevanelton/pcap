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
