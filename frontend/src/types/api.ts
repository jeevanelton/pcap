export interface AnalysisData {
    file_id: string;
    packet_count: number;
    protocols: Record<string, number>;
    top_sources: Array<{
        ip: string;
        packets: number;
        bytes: number;
        percentage: string;
    }>;
    top_destinations: Array<{
        ip: string;
        packets: number;
        bytes: number;
        percentage: string;
    }>;
    traffic_over_time: Array<{
        time: string;
        packets: number;
    }>;
    traffic_by_protocol?: Array<{
        time: string;
        [key: string]: string | number;
    }>;
    capture_duration: number;
    total_bytes: number;
}

export interface PacketsData {
    packets: Array<{
        time: string;
        pcap_id: string;
        number: number;
        src_ip: string;
        dst_ip: string;
        src_port: number;
        dst_port: number;
        protocol: string;
        length: number;
        file_offset: number;
        info: string;
    }>;
    total_count: number;
    returned_count: number;
    offset: number;
    has_more: boolean;
}

export interface OverviewData {
    file_id: string;
    totals: {
        packets: number;
        bytes: number;
        duration: number;
    };
    protocols: Record<string, number>;
    traffic_over_time: Array<{
        time: string;
        packets: number;
    }>;
    metrics: {
        unique_hosts: number;
        connections: number;
        open_ports: number;
        top_servers: Array<{
            ip: string;
            packets: number;
            bytes: number;
        }>;
        top_destination_ports: Array<{
            port: number;
            count: number;
        }>;
    };
    categories: Record<string, number>;
}

export interface Project {
    id: string;
    name: string;
    created_at: string;
}

export interface File {
    file_id: string;
    filename: string;
    upload_time: string;
    total_packets: number;
    total_bytes: number;
    capture_duration: number;
}
