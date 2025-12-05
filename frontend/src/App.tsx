import { useState, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Stats } from '@/components/Stats';
import { Charts } from '@/components/Charts';
import WiresharkViewer from '@/components/WiresharkViewer';
import NetworkGraph from '@/components/NetworkGraph';
import GeoMap from '@/components/GeoMap';

import DnsView from '@/components/DnsView';
import { ShieldCheck, Upload } from 'lucide-react';
import { useAuth, authFetch } from './contexts/AuthContext';
import { AuthScreen } from './components/auth/AuthScreen';
import { ProjectSelector } from './components/ProjectSelector';
import { API_BASE_URL } from './config';
import './components/OverviewTab.css';

// New imports
import { Header } from '@/components/Header';
import { TabNav } from '@/components/TabNav';
import { UploadModal } from '@/components/UploadModal';
import { CARD_SPECS } from '@/config/constants';
import { AnalysisData, PacketsData, OverviewData } from '@/types/api';
import { ProtocolView } from '@/components/ProtocolView';
import { AnalysisView } from '@/components/AnalysisView';
import { HttpAnalysisView } from '@/components/HttpAnalysisView';

const API_BASE = API_BASE_URL;

const CARD_TO_TAB: Record<string, string> = {
  'dns': 'DNS',
  'http': 'HTTP',
  'ssl': 'SSL/TLS',
  'tcp': 'TCP',
  'icmp': 'ICMP',
  'dhcp': 'DHCP',
  'smb': 'SMB',
  'arp': 'ARP',
  'sip': 'SIP',
  'telnet': 'Telnet',
  'ftp': 'FTP',
  'ssdp': 'SSDP',
  'open_ports': 'Open Ports',
  'connections': 'Connections',
  'hosts': 'Hosts',
  'servers': 'Servers',
  'credentials': 'Credentials',
};

// Protocol Chart Component
interface TrafficPoint { time: string; packets: number; }
const ProtocolChart: React.FC<{ points: TrafficPoint[] }> = ({ points }) => {
  if (!points.length) return <div className="text-xs text-gray-400">No traffic points.</div>;
  const maxPackets = Math.max(...points.map(p => p.packets));
  const width = 900; const height = 180; const pad = 30;
  const path = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - (p.packets / maxPackets) * (height - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="protocol-chart">
      <rect x={0} y={0} width={width} height={height} fill="#0d1117" rx={4} />
      <path d={path} stroke="#00b5ff" strokeWidth={2} fill="none" />
      <path d={path + ` L ${width - pad},${height - pad} L ${pad},${height - pad} Z`} fill="url(#grad)" opacity={0.25} />
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00b5ff" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#00b5ff" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#243447" />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#243447" />
      {points.filter((_, i) => i % Math.ceil(points.length / 10) === 0).map((p, i2) => {
        const idx = points.indexOf(p);
        const x = pad + (idx / (points.length - 1)) * (width - pad * 2);
        return <text key={i2} x={x} y={height - 8} fontSize={9} textAnchor="middle" fill="#6e7681">{new Date(p.time).toLocaleTimeString()}</text>;
      })}
      {Array.from({ length: 5 }).map((_, i) => {
        const y = pad + (i / 4) * (height - pad * 2);
        const val = Math.round(maxPackets - (i / 4) * maxPackets);
        return <text key={i} x={8} y={y + 3} fontSize={9} fill="#6e7681">{val}</text>;
      })}
    </svg>
  );
};

function App() {
  const { isAuthenticated } = useAuth();
  const [projectId, setProjectId] = useState<string | null>(localStorage.getItem('projectId'));
  const [fileId, setFileId] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [packetsData, setPacketsData] = useState<PacketsData | null>(null);
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [isUploadModalOpen, setUploadModalOpen] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);


  useEffect(() => {
    if (projectId) {
      localStorage.setItem('projectId', projectId);
      fetchProjectData(projectId);
    } else {
      localStorage.removeItem('projectId');
      // Clear state when switching projects
      setFileId(null);
      setAnalysisData(null);
      setPacketsData(null);
      setOverviewData(null);
    }
  }, [projectId]);

  const fetchProjectData = async (id: string) => {
    setIsLoadingProject(true);
    // Clear previous project data
    setFileId(null);
    setAnalysisData(null);
    setPacketsData(null);
    setOverviewData(null);

    try {
      const filesRes = await authFetch(`${API_BASE}/api/projects/${id}/files`);
      if (!filesRes.ok) {
        if (filesRes.status === 401) return; // Auth will handle redirect
        throw new Error('Failed to fetch project files');
      }
      const files = await filesRes.json();

      if (files && files.length > 0) {
        const latestFile = files[0];
        setFileId(latestFile.file_id);

        const analysisRes = await authFetch(`${API_BASE}/api/analyze/${latestFile.file_id}`);
        if (!analysisRes.ok) {
          if (analysisRes.status === 401) return;
          throw new Error('Failed to fetch analysis');
        }
        const analysis = await analysisRes.json();
        setAnalysisData(analysis);

        // Load initial batch of packets (1000) for better performance
        // WiresharkViewer and FlowGraph will lazy-load more as needed
        const packetsRes = await authFetch(`${API_BASE}/api/packets/${latestFile.file_id}?limit=1000`);
        if (!packetsRes.ok) {
          if (packetsRes.status === 401) return;
          throw new Error('Failed to fetch packets');
        }
        const packetsJson = await packetsRes.json();
        setPacketsData(packetsJson);

        const overviewRes = await authFetch(`${API_BASE}/api/overview/${latestFile.file_id}`);
        if (!overviewRes.ok) {
          if (overviewRes.status === 401) return;
          throw new Error('Failed to fetch overview');
        }
        const overview = await overviewRes.json();
        setOverviewData(overview);
      }
    } catch (err) {
      console.error(err);
      // Optionally, handle the error in the UI
    } finally {
      setIsLoadingProject(false);
    }
  };

  // Show auth screen if not authenticated
  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  // Show project selector if no project selected
  if (!projectId) {
    return <ProjectSelector onSelectProject={setProjectId} />;
  }

  if (isLoadingProject) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-600">Loading project...</p>
        </div>
      </div>
    );
  }

  // UI: Main content rendering based on active tab
  const renderContent = () => {
    if (!fileId || !analysisData) {
      return (
        <div className="text-center py-20 px-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 mb-6">
            <ShieldCheck className="h-10 w-10 text-indigo-600" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Welcome to PCAP Analyzer</h2>
          <p className="text-lg text-gray-600 mb-8 max-w-md mx-auto">
            Upload a PCAP file to begin analyzing network traffic patterns, protocols, and connections
          </p>
          <button
            onClick={() => setUploadModalOpen(true)}
            className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            <Upload className="mr-2 h-5 w-5" />
            Get Started
          </button>
        </div>
      )
    }

    switch (activeTab) {
      case 'Dashboard':
        return (
          <div className="space-y-6">
            <Stats analysisData={analysisData} />

            {/* Unified Traffic Analysis */}
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Network Traffic Analysis</h3>
                  <p className="text-sm text-gray-500">Real-time protocol distribution and traffic volume</p>
                </div>
              </div>

              <div style={{ height: '400px' }}>
                <Charts analysisData={analysisData} chartType="stackedArea" />
              </div>
            </div>            {/* Overview Cards */}
            {overviewData && (
              <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Protocol & Feature Overview</h3>
                <div className="grid gap-4 overview-grid">
                  {CARD_SPECS.map(c => {
                    const has = (c.dependsOn || []).every(proto => overviewData.protocols[proto] !== undefined);
                    const count = overviewData.categories[c.key];
                    const hasData = has && count !== undefined && count > 0;
                    const isImplemented = ['dns', 'http', 'ssl', 'open_ports', 'connections', 'arp', 'smb'].includes(c.key);

                    return (
                      <div
                        key={c.key}
                        className={`card-tile border border-gray-200 rounded-md p-4 bg-gray-50 flex flex-col ${!has ? 'opacity-40' : ''} ${hasData && isImplemented ? 'cursor-pointer hover:shadow-lg hover:border-indigo-300 transition-all' : ''}`}
                        onClick={() => {
                          if (hasData && isImplemented) {
                            const targetTab = CARD_TO_TAB[c.key];
                            if (targetTab) {
                              setActiveTab(targetTab);
                            }
                          }
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-sm text-gray-900">{c.title}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                            {has ? (count !== undefined ? count : 'Ready') : 'N/A'}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-gray-600 flex-grow">{c.description}</p>
                        <div className="mt-3 text-[11px] flex items-center justify-between text-gray-500">
                          <span>Protocols: {c.dependsOn && c.dependsOn.length ? c.dependsOn.join(', ') : 'Any'}</span>
                          {hasData && isImplemented && <span className="text-indigo-500 font-semibold">View &raquo;</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      case 'DNS':
        return (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
              <div>
                <h3 className="text-xl font-bold text-gray-900">DNS Analytics</h3>
                <p className="text-sm text-gray-600 mt-1">Server-driven filters, charts, and lazy loading</p>
              </div>
            </div>
            <div className="p-4">
              {fileId && <DnsView fileId={fileId} />}
            </div>
          </div>
        );
      case 'Packets':
        return (
          <div className="bg-[#1e1e1e] rounded-xl shadow-2xl border border-gray-700 overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
            <WiresharkViewer
              packetsData={packetsData}
              fileId={fileId}
              totalPacketsFromOverview={overviewData?.totals?.packets || 0}
            />
          </div>
        );
      case 'Network Graph':
        return (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Network Conversation Graph</h3>
                  <p className="text-sm text-gray-600 mt-1">Interactive visualization of network traffic flows</p>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-2 px-3 py-1 bg-white rounded-lg border border-gray-200">
                    <div className="w-3 h-3 rounded-full bg-blue-400"></div>
                    <span className="text-xs text-gray-600">Low Traffic</span>
                  </div>
                  <div className="flex items-center space-x-2 px-3 py-1 bg-white rounded-lg border border-gray-200">
                    <div className="w-3 h-3 rounded-full bg-orange-400"></div>
                    <span className="text-xs text-gray-600">Medium Traffic</span>
                  </div>
                  <div className="flex items-center space-x-2 px-3 py-1 bg-white rounded-lg border border-gray-200">
                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                    <span className="text-xs text-gray-600">High Traffic</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ height: 'calc(100vh - 280px)', minHeight: '600px' }}>
              <ReactFlowProvider>
                <NetworkGraph fileId={fileId} />
              </ReactFlowProvider>
            </div>
          </div>
        );
      case 'GeoMap':
        return (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-teal-50">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Geographic Distribution</h3>
                <p className="text-sm text-gray-600 mt-1">Global traffic visualization with GeoIP mapping</p>
              </div>
            </div>
            <div style={{ height: 'calc(100vh - 280px)', minHeight: '600px' }}>
              <GeoMap fileId={fileId} />
            </div>
          </div>
        );

      // Protocol Tabs
      case 'HTTP':
        return <HttpAnalysisView fileId={fileId} />;
      case 'SSL/TLS':
        return <ProtocolView fileId={fileId} protocol="TLS" title="SSL/TLS Traffic" description="Encrypted traffic handshakes and application data." />;
      case 'TCP':
        return <ProtocolView fileId={fileId} protocol="TCP" title="TCP Traffic" description="Transmission Control Protocol segments." />;
      case 'ICMP':
        return <ProtocolView fileId={fileId} protocol="ICMP" title="ICMP Traffic" description="Internet Control Message Protocol (Ping, Unreachable)." />;
      case 'DHCP':
        return <ProtocolView fileId={fileId} protocol="DHCP" title="DHCP Traffic" description="Dynamic Host Configuration Protocol exchanges." />;
      case 'SMB':
        return <ProtocolView fileId={fileId} protocol="SMB,NBNS" title="SMB/NetBIOS Traffic" description="Server Message Block and NetBIOS Name Service." />;
      case 'ARP':
        return <ProtocolView fileId={fileId} protocol="ARP" title="ARP Traffic" description="Address Resolution Protocol requests and replies." />;
      case 'SIP':
        return <ProtocolView fileId={fileId} protocol="SIP" title="SIP Traffic" description="Session Initiation Protocol for VoIP." />;
      case 'Telnet':
        return <ProtocolView fileId={fileId} protocol="Telnet" title="Telnet Traffic" description="Unencrypted remote terminal access." />;
      case 'FTP':
        return <ProtocolView fileId={fileId} protocol="FTP" title="FTP Traffic" description="File Transfer Protocol control and data connections." />;
      case 'SSDP':
        return <ProtocolView fileId={fileId} protocol="SSDP" title="SSDP Traffic" description="Simple Service Discovery Protocol." />;

      // Analysis Tabs
      case 'Open Ports':
        return <AnalysisView fileId={fileId} type="ports" title="Open Ports Analysis" />;
      case 'Connections':
        return <AnalysisView fileId={fileId} type="connections" title="Connection Analysis" />;
      case 'Hosts':
        return <AnalysisView fileId={fileId} type="hosts" title="Host Analysis" />;
      case 'Servers':
        return <AnalysisView fileId={fileId} type="servers" title="Server Analysis" />;
      case 'Credentials':
        return <AnalysisView fileId={fileId} type="credentials" title="Credential Analysis" />;

      default:
        return null;
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 flex flex-col overflow-hidden">
      <Header
        onBack={() => setProjectId(null)}
        onUpload={() => setUploadModalOpen(true)}
      />
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        projectId={projectId}
        setFileId={setFileId}
        setAnalysisData={setAnalysisData}
        setPacketsData={setPacketsData}
        setOverviewData={setOverviewData}
      />
      <div className="flex flex-1 h-[calc(100vh-64px)] overflow-hidden">
        <TabNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          disabled={!fileId}
        />
        <main className="flex-1 overflow-y-auto bg-gray-50/50 p-6">
          <div key={activeTab} className="fade-in max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;