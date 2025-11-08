import { useState, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Stats } from '@/components/Stats';
import { Charts } from '@/components/Charts';
import WiresharkViewer from '@/components/WiresharkViewer';
import NetworkGraph from '@/components/NetworkGraph';
import FlowGraphEnhanced from '@/components/FlowGraphEnhanced';
import GeoMap from '@/components/GeoMap';
import FeatureDetailModal from '@/components/FeatureDetailModal';
import { UploadCard } from '@/components/UploadCard';
import './components/OverviewTab.css';
import { ShieldCheck, Upload, BarChart2, Table, GitMerge, ArrowLeft, Activity, MapIcon } from 'lucide-react';
import { useAuth, authFetch } from './contexts/AuthContext';
import { AuthScreen } from './components/auth/AuthScreen';
import { ProjectSelector } from './components/ProjectSelector';
import { API_BASE_URL } from './config';

const API_BASE = API_BASE_URL;

// Card specifications for overview
interface CardSpec {
  key: string;
  title: string;
  description: string;
  dependsOn?: string[];
}

const cardSpecs: CardSpec[] = [
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

// Protocol Chart Component
interface TrafficPoint { time: string; packets: number; }
const ProtocolChart: React.FC<{ points: TrafficPoint[] }> = ({ points }) => {
  if (!points.length) return <div className="text-xs text-gray-400">No traffic points.</div>;
  const maxPackets = Math.max(...points.map(p => p.packets));
  const width = 900; const height = 180; const pad = 30;
  const path = points.map((p,i) => {
    const x = pad + (i/(points.length-1))*(width-pad*2);
    const y = height - pad - (p.packets/maxPackets)*(height-pad*2);
    return `${i===0? 'M':'L'}${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="protocol-chart">
      <rect x={0} y={0} width={width} height={height} fill="#0d1117" rx={4} />
      <path d={path} stroke="#00b5ff" strokeWidth={2} fill="none" />
      <path d={path + ` L ${width-pad},${height-pad} L ${pad},${height-pad} Z`} fill="url(#grad)" opacity={0.25} />
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00b5ff" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#00b5ff" stopOpacity={0} />
        </linearGradient>
      </defs>
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
    </svg>
  );
};

// UI: Rewritten App.tsx for a clean, functional, and consistent UI with authentication and project management.
function App() {
  const { isAuthenticated } = useAuth();
  const [projectId, setProjectId] = useState<string | null>(localStorage.getItem('projectId'));
  const [fileId, setFileId] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<any | null>(null);
  const [packetsData, setPacketsData] = useState<any | null>(null);
  const [overviewData, setOverviewData] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [isUploadModalOpen, setUploadModalOpen] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<{key: string; title: string} | null>(null);

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
      if (!filesRes.ok) throw new Error('Failed to fetch project files');
      const files = await filesRes.json();

      if (files && files.length > 0) {
        const latestFile = files[0];
        setFileId(latestFile.file_id);

        const analysisRes = await authFetch(`${API_BASE}/api/analyze/${latestFile.file_id}`);
        if (!analysisRes.ok) throw new Error('Failed to fetch analysis');
        const analysis = await analysisRes.json();
        setAnalysisData(analysis);

        // Load initial batch of packets (1000) for better performance
        // WiresharkViewer and FlowGraph will lazy-load more as needed
        const packetsRes = await authFetch(`${API_BASE}/api/packets/${latestFile.file_id}?limit=1000`);
        if (!packetsRes.ok) throw new Error('Failed to fetch packets');
        const packetsJson = await packetsRes.json();
        setPacketsData(packetsJson);

        const overviewRes = await authFetch(`${API_BASE}/api/overview/${latestFile.file_id}`);
        if (!overviewRes.ok) throw new Error('Failed to fetch overview');
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

  // UI: Header component with modern gradient design
  const Header = () => (
    <header className="relative bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 shadow-lg">
      <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div className="flex items-center space-x-3">
            <button onClick={() => setProjectId(null)} className="text-white/80 hover:text-white transition-colors">
              <ArrowLeft className="h-6 w-6" />
            </button>
            <ShieldCheck className="h-10 w-10 text-white drop-shadow-lg" />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">PCAP Analyzer</h1>
              <p className="text-xs text-white/80">Network Traffic Analysis</p>
            </div>
          </div>
          <button 
            onClick={() => setUploadModalOpen(true)}
            className="group relative inline-flex items-center px-6 py-3 text-sm font-medium text-white bg-white/20 backdrop-blur-md rounded-lg hover:bg-white/30 transition-all duration-300 hover:scale-105 hover:shadow-xl border border-white/30"
          >
            <Upload className="mr-2 h-5 w-5 group-hover:rotate-12 transition-transform duration-300" />
            <span className="relative">Upload PCAP</span>
          </button>
        </div>
      </div>
    </header>
  );

  // UI: Tab navigation with sticky positioning
  const TabNav = () => (
    <div className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <nav className="-mb-px flex space-x-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Tabs">
        {['Dashboard', 'Packets', 'Network Graph', 'Flow Graph', 'GeoMap'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            disabled={!fileId}
            className={`${ activeTab === tab
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {
              {
                'Dashboard': <BarChart2 className="mr-2 h-5 w-5" />,
                'Packets': <Table className="mr-2 h-5 w-5" />,
                'Network Graph': <GitMerge className="mr-2 h-5 w-5" />,
                'Flow Graph': <Activity className="mr-2 h-5 w-5" />,
                'GeoMap': <MapIcon className="mr-2 h-5 w-5" />
              }[tab]
            }
            {tab}
          </button>
        ))}
      </nav>
    </div>
  );

  // UI: Upload Modal with backdrop blur
  const UploadModal = () => (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full">
        <div className="flex items-center mb-6">
          <div className="flex-shrink-0 h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Upload className="h-6 w-6 text-white" />
          </div>
          <div className="ml-4">
            <h2 className="text-2xl font-bold text-gray-900">Upload PCAP File</h2>
            <p className="text-sm text-gray-500">Analyze network traffic patterns</p>
          </div>
        </div>
        <UploadCard
          projectId={projectId}
          setFileId={setFileId}
          setAnalysisData={setAnalysisData}
          setPacketsData={setPacketsData}
          setOverviewData={setOverviewData}
          onAnalysisComplete={() => setUploadModalOpen(false)}
        />
        <button onClick={() => setUploadModalOpen(false)} className="mt-4 w-full text-center py-2 text-gray-600 hover:text-gray-800">
          Cancel
        </button>
      </div>
    </div>
  );

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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Protocol Distribution</h3>
                    <div style={{height: '260px'}}>
                        <Charts analysisData={analysisData} chartType="protocol" />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Traffic Over Time</h3>
                    <div style={{height: '260px'}}>
                        <Charts analysisData={analysisData} chartType="trafficOverTime" />
                    </div>
                </div>
            </div>
            
            {/* Protocol Chart and Overview Cards */}
            {overviewData && (
              <>
                <div className="bg-[#14181f] rounded-2xl shadow-lg border border-[#1f2833] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-100">Network Traffic by Protocol Over Time</h3>
                    <span className="text-sm text-gray-400">
                      Packets: {overviewData.totals.packets} | Bytes: {overviewData.totals.bytes} | Duration: {overviewData.totals.duration}s
                    </span>
                  </div>
                  <ProtocolChart points={overviewData.traffic_over_time} />
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Protocol & Feature Overview</h3>
                  <div className="grid gap-4 overview-grid">
                    {cardSpecs.map(c => {
                      const has = (c.dependsOn||[]).every(proto => overviewData.protocols[proto] !== undefined);
                      const count = overviewData.categories[c.key];
                      const hasData = has && count !== undefined && count > 0;
                      const isImplemented = ['dns', 'http', 'ssl', 'open_ports', 'connections', 'arp', 'smb'].includes(c.key);
                      
                      return (
                        <div 
                          key={c.key} 
                          className={`card-tile border border-gray-200 rounded-md p-4 bg-gray-50 flex flex-col ${!has? 'opacity-40':''} ${hasData && isImplemented ? 'cursor-pointer hover:shadow-lg hover:border-indigo-300 transition-all' : ''}`}
                          onClick={() => hasData && isImplemented && setSelectedFeature({key: c.key, title: c.title})}
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
              </>
            )}
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
            <div style={{height: 'calc(100vh - 280px)', minHeight: '600px'}}>
              <ReactFlowProvider>
                <NetworkGraph fileId={fileId} />
              </ReactFlowProvider>
            </div>
          </div>
        );
      case 'Flow Graph':
        return (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-blue-50">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Packet Flow Sequence</h3>
                <p className="text-sm text-gray-600 mt-1">Temporal visualization with advanced analytics</p>
              </div>
            </div>
            <div style={{height: 'calc(100vh - 280px)', minHeight: '600px'}}>
              <FlowGraphEnhanced fileId={fileId} />
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
            <div style={{height: 'calc(100vh - 280px)', minHeight: '600px'}}>
              <GeoMap fileId={fileId} />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50">
      <Header />
      {isUploadModalOpen && <UploadModal />}
      {selectedFeature && fileId && (
        <FeatureDetailModal
          featureKey={selectedFeature.key}
          featureTitle={selectedFeature.title}
          fileId={fileId}
          onClose={() => setSelectedFeature(null)}
        />
      )}
      <main>
        <TabNav />
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

export default App;