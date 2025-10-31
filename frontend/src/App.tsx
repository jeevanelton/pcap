import { useState } from 'react';
import { Stats } from '@/components/Stats';
import { Charts } from '@/components/Charts';
import { IpTables } from '@/components/IpTables';
import { PacketTable } from '@/components/PacketTable';
import NetworkGraph from '@/components/NetworkGraph';
import { UploadCard } from '@/components/UploadCard';
import { ShieldCheck, Upload, BarChart2, Table, GitMerge } from 'lucide-react';

// UI: Rewritten App.tsx for a clean, functional, and consistent UI.
function App() {
  const [fileId, setFileId] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<any | null>(null);
  const [packetsData, setPacketsData] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [isUploadModalOpen, setUploadModalOpen] = useState(false);

  // UI: Header component
  const Header = () => (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <ShieldCheck className="h-8 w-8 text-indigo-600" />
            <span className="ml-2 text-xl font-semibold text-gray-800">PCAP Analyzer</span>
          </div>
          <button 
            onClick={() => setUploadModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Upload className="-ml-1 mr-2 h-5 w-5" />
            Upload PCAP
          </button>
        </div>
      </div>
    </header>
  );

  // UI: Tab navigation
  const TabNav = () => (
    <div className="border-b border-gray-200">
      <nav className="-mb-px flex space-x-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Tabs">
        {['Dashboard', 'Packets', 'Connections'].map(tab => (
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
                'Connections': <GitMerge className="mr-2 h-5 w-5" />
              }[tab]
            }
            {tab}
          </button>
        ))}
      </nav>
    </div>
  );

  // UI: Upload Modal
  const UploadModal = () => (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-lg w-full">
        <h2 className="text-2xl font-bold mb-4">Upload PCAP File</h2>
        <UploadCard 
          setFileId={setFileId} 
          setAnalysisData={setAnalysisData} 
          setPacketsData={setPacketsData} 
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
        <div className="text-center py-20">
          <h2 className="text-2xl font-semibold text-gray-700">Welcome to PCAP Analyzer</h2>
          <p className="mt-2 text-gray-500">Upload a PCAP file to begin analysis.</p>
        </div>
      )
    }

    switch (activeTab) {
      case 'Dashboard':
        return (
          <div className="space-y-6">
            <Stats analysisData={analysisData} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Protocol Distribution</h3>
                    <div style={{height: '260px'}}>
                        <Charts analysisData={analysisData} chartType="protocol" />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Traffic Over Time</h3>
                    <div style={{height: '260px'}}>
                        <Charts analysisData={analysisData} chartType="trafficOverTime" />
                    </div>
                </div>
            </div>
          </div>
        );
      case 'Packets':
        return (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Packet Table</h3>
                <PacketTable packetsData={packetsData} fileId={fileId} />
            </div>
        );
      case 'Connections':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">IP Tables</h3>
              <IpTables analysisData={analysisData} />
            </div>
            <div className="lg:col-span-3 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversation Graph</h3>
                <div style={{height: '400px'}}>
                    <NetworkGraph fileId={fileId} />
                </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      {isUploadModalOpen && <UploadModal />}
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