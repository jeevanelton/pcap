import React, { useEffect, useState } from 'react';
import './OverviewTab.css';
import { API_BASE_URL } from '../config';
import { ProtocolView } from './ProtocolView';
import DnsView from './DnsView';
import { HttpAnalysisView } from './HttpAnalysisView';

const API_BASE = API_BASE_URL;

interface TrafficPoint { time: string; packets: number; }
interface OverviewData {
  file_id: string;
  protocols: Record<string, number>;
  traffic_over_time: TrafficPoint[];
  totals: { packets: number; bytes: number; duration: number };
  metrics: { unique_hosts: number; connections: number; open_ports: number; top_servers: Array<{ip:string; packets:number; bytes:number}>; top_destination_ports: Array<{port:number; count:number}> };
  categories: Record<string, number>;
}

interface CardSpec {
  key: string;
  title: string;
  description: string;
  icon?: string; // could map to a sprite or emoji placeholder
  dependsOn?: string[]; // protocols or categories needed
}

const cards: CardSpec[] = [
  { key: 'credentials', title: 'Found credentials', description: 'Plain text passwords or hashes in auth protocols (HTTP Basic, FTP, Telnet).', dependsOn: ['HTTP','FTP','Telnet'] },
  { key: 'dns', title: 'DNS Queries', description: 'DNS/mDNS queries observed in capture.', dependsOn: ['DNS'] },
  { key: 'http', title: 'HTTP Communication', description: 'HTTP requests and responses.', dependsOn: ['HTTP'] },
  { key: 'smb', title: 'SMB Sniffer', description: 'SMB announcements; OS features; potential hash extraction.', dependsOn: ['SMB','NBNS'] },
  { key: 'arp', title: 'ARP', description: 'ARP communication; router and host discovery; spoofing indicators.', dependsOn: ['ARP'] },
  { key: 'network_map', title: 'Network Map', description: 'IP communications and device volume.', dependsOn: [] },
  { key: 'open_ports', title: 'Open Ports', description: 'Destination ports seen (top).', dependsOn: [] },
  { key: 'ssl', title: 'SSL/TLS', description: 'TLS handshakes, certificates, client/server hello.', dependsOn: ['TLS'] },
  { key: 'images', title: 'Images', description: 'Image transfers inside HTTP sessions.', dependsOn: ['HTTP'] },
  { key: 'ssdp', title: 'SSDP Announcements', description: 'Service discovery using SSDP protocol.', dependsOn: ['SSDP'] },
  { key: 'connections', title: 'Connections', description: 'IP endpoint pairs and traffic volume.', dependsOn: [] },
  { key: 'ethernet', title: 'Ethernet Devices', description: 'MAC/Ethernet broadcasts (placeholder).', dependsOn: [] },
  { key: 'wifi', title: 'WiFi', description: 'Wireless management frames (placeholder).', dependsOn: ['WLAN'] },
  { key: 'sip', title: 'SIP', description: 'VoIP signaling (SIP protocol).', dependsOn: ['SIP'] },
  { key: 'documents', title: 'Documents', description: 'Transferred office documents (pdf/doc/xls).', dependsOn: ['HTTP'] },
  { key: 'telnet', title: 'Telnet', description: 'Telnet sessions (unencrypted).', dependsOn: ['Telnet'] },
  { key: 'ftp', title: 'FTP', description: 'FTP sessions (control/data).', dependsOn: ['FTP'] },
  { key: 'servers', title: 'Servers', description: 'Potential server IPs from inbound connections.', dependsOn: [] },
  { key: 'hosts', title: 'Hosts', description: 'Unique IP hosts identified.', dependsOn: [] },
];

const OverviewTab: React.FC<{ fileId: string }>= ({ fileId }) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) return;
    setLoading(true); setError(null);
    const url = `${API_BASE}/api/overview/${fileId}`;
    console.log("Fetching overview data for fileId:", fileId, "from URL:", url);
  fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } })
      .then(r => { if(!r.ok) throw new Error(`Status ${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [fileId]);

  const handleCardClick = (card: CardSpec) => {
    const has = (card.dependsOn||[]).every(proto => data?.protocols[proto] !== undefined);
    if (!has) return;
    setActiveView(card.key);
  };

  if (activeView) {
    return <FeatureView featureKey={activeView} fileId={fileId} onBack={() => setActiveView(null)} />;
  }



  const totalProtocols = data ? Object.keys(data.protocols).length : 0;

  return <div className="overview-wrapper text-gray-200">
    <div className="flex items-center justify-between">
      <h2 className="text-xl font-semibold">Data Overview</h2>
    {data && <span className="text-sm opacity-70">Packets: {data.totals.packets} | Bytes: {data.totals.bytes} | Duration: {data.totals.duration}s</span>}
    </div>
    {loading && <div className="mt-4">Loading overview...</div>}
    {error && <div className="mt-4 text-red-400">Error: {error}</div>}

    {data && <>
      <section className="mt-6 bg-[#14181f] rounded-md p-4 border border-[#1f2833]">
        <h3 className="text-sm font-medium mb-2">Network Traffic by Protocol Over Time</h3>
        {/* Simple stacked area placeholder using inline SVG */}
        <ProtocolChart points={data.traffic_over_time} />
      </section>
      <section className="mt-8 grid gap-4 overview-grid">
        {cards.map(c => {
          const has = (c.dependsOn||[]).every(proto => data.protocols[proto] !== undefined);
          return <div key={c.key} onClick={() => handleCardClick(c)} className={`card-tile border border-[#1f2833] rounded-md p-4 bg-[#14181f] flex flex-col ${!has? 'opacity-40':'cursor-pointer hover:border-cyan-400 transition-colors'}`}> 
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">{c.title}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-[#1f2833]">{has? (data.categories[c.key] ?? 'Ready') : 'N/A'}</span>
            </div>
            <p className="text-xs leading-relaxed opacity-70 flex-grow">{c.description}</p>
            <div className="mt-3 text-[11px] flex items-center justify-between">
              <span>Protocols: {c.dependsOn && c.dependsOn.length? c.dependsOn.join(', '): 'Any'}</span>
              {has && <span className="text-cyan-400 cursor-pointer">View &raquo;</span>}
            </div>
          </div>;
        })}
      </section>
    </>}

  </div>;
};

const ProtocolChart: React.FC<{ points: TrafficPoint[] }> = ({ points }) => {
  if (!points.length) return <div className="text-xs opacity-70">No traffic points.</div>;
  const maxPackets = Math.max(...points.map(p => p.packets));
  const width = 900; const height = 180; const pad = 30;
  const path = points.map((p,i) => {
    const x = pad + (i/(points.length-1))*(width-pad*2);
    const y = height - pad - (p.packets/maxPackets)*(height-pad*2);
    return `${i===0? 'M':'L'}${x},${y}`;
  }).join(' ');
  return <svg width={width} height={height} className="protocol-chart">
    <rect x={0} y={0} width={width} height={height} fill="#0d1117" rx={4} />
    <path d={path} stroke="#00b5ff" strokeWidth={2} fill="none" />
    {/* area fill */}
    <path d={path + ` L ${width-pad},${height-pad} L ${pad},${height-pad} Z`} fill="url(#grad)" opacity={0.25} />
    <defs>
      <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#00b5ff" stopOpacity={0.6} />
        <stop offset="100%" stopColor="#00b5ff" stopOpacity={0} />
      </linearGradient>
    </defs>
    {/* axes */}
    <line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} stroke="#243447" />
    <line x1={pad} y1={pad} x2={pad} y2={height-pad} stroke="#243447" />
    {points.filter((_,i)=> i%Math.ceil(points.length/10)===0).map((p,i2) => {
      const idx = points.indexOf(p);
      const x = pad + (idx/(points.length-1))*(width-pad*2);
      return <text key={i2} x={x} y={height-8} fontSize={9} textAnchor="middle" fill="#6e7681">{new Date(p.time).toLocaleTimeString()}</text>;
    })}
    {Array.from({length:5}).map((_,i) => {
      const y = pad + (i/4)*(height-pad*2);
      const val = Math.round(maxPackets - (i/4)*maxPackets);
      return <text key={i} x={8} y={y+3} fontSize={9} fill="#6e7681">{val}</text>;
    })}
  </svg>;
};

// Feature View Component - Full page view for each feature
const FeatureView: React.FC<{ featureKey: string; fileId: string; onBack: () => void }> = ({ featureKey, fileId, onBack }) => {
  const card = cards.find(c => c.key === featureKey);
  const title = card?.title || featureKey;
  const description = card?.description || '';

  // Map feature keys to their protocols for the API
  const protocolMap: Record<string, string> = {
    'http': 'HTTP',
    'ssl': 'TLS',
    'smb': 'SMB,NBNS',
    'arp': 'ARP',
    'telnet': 'Telnet',
    'ftp': 'FTP',
    'ssdp': 'SSDP',
    'sip': 'SIP',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
            {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
          </div>
          <button 
            onClick={onBack} 
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800"
          >
            Back to Overview
          </button>
        </div>

        {featureKey === 'dns' ? (
          <DnsView fileId={fileId} />
        ) : featureKey === 'http' ? (
          <HttpAnalysisView fileId={fileId} />
        ) : protocolMap[featureKey] ? (
          <ProtocolView 
            fileId={fileId} 
            protocol={protocolMap[featureKey]} 
            title={title}
            description={description}
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-600">This feature view is not yet implemented.</p>
            <p className="text-sm text-gray-500 mt-2">Feature: {featureKey}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OverviewTab;
