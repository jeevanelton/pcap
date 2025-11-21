export interface CardSpec {
    key: string;
    title: string;
    description: string;
    dependsOn?: string[];
}

export const CARD_SPECS: CardSpec[] = [
    { key: 'dns', title: 'DNS Queries', description: 'DNS/mDNS queries observed in capture.', dependsOn: ['DNS'] },
    { key: 'http', title: 'HTTP Communication', description: 'HTTP requests and responses.', dependsOn: ['HTTP'] },
    { key: 'ssl', title: 'SSL/TLS', description: 'TLS handshakes, certificates, client/server hello.', dependsOn: ['TLS'] },
    { key: 'tcp', title: 'TCP Analysis', description: 'TCP performance, retransmissions, and window analysis.', dependsOn: ['TCP'] },
    { key: 'icmp', title: 'ICMP', description: 'Network control messages (Ping, Unreachable).', dependsOn: ['ICMP'] },
    { key: 'dhcp', title: 'DHCP', description: 'IP address assignment and lease negotiation.', dependsOn: ['DHCP'] },
    { key: 'smb', title: 'SMB Sniffer', description: 'SMB announcements; OS features; potential hash extraction.', dependsOn: ['SMB', 'NBNS'] },
    { key: 'arp', title: 'ARP', description: 'ARP communication; router and host discovery; spoofing indicators.', dependsOn: ['ARP'] },
    { key: 'open_ports', title: 'Open Ports', description: 'Destination ports seen (top).', dependsOn: [] },
    { key: 'connections', title: 'Connections', description: 'IP endpoint pairs and traffic volume.', dependsOn: [] },
    { key: 'hosts', title: 'Hosts', description: 'Unique IP hosts identified.', dependsOn: [] },
    { key: 'servers', title: 'Servers', description: 'Potential server IPs from inbound connections.', dependsOn: [] },
    { key: 'sip', title: 'SIP', description: 'VoIP signaling (SIP protocol).', dependsOn: ['SIP'] },
    { key: 'telnet', title: 'Telnet', description: 'Telnet sessions (unencrypted).', dependsOn: ['Telnet'] },
    { key: 'ftp', title: 'FTP', description: 'FTP sessions (control/data).', dependsOn: ['FTP'] },
    { key: 'ssdp', title: 'SSDP Announcements', description: 'Service discovery using SSDP protocol.', dependsOn: ['SSDP'] },
    { key: 'credentials', title: 'Found credentials', description: 'Plain text passwords or hashes in auth protocols (HTTP Basic, FTP, Telnet).', dependsOn: ['HTTP', 'FTP', 'Telnet'] },
];
