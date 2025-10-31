import { Activity, Network, FileSearch, Clock } from 'lucide-react';

// UI: Rewritten Stats.tsx for consistency and correctness.
const StatCard = ({ title, value, icon }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
    <div className="flex items-center">
      <div className="mr-4 text-indigo-500">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  </div>
);

export function Stats({ analysisData }) {
  if (!analysisData) return null;

  const uniqueIps = new Set([...analysisData.top_sources.map(s => s.ip), ...analysisData.top_destinations.map(d => d.ip)]).size;
  const protocolCount = Object.keys(analysisData.protocols).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard 
        title="Total Packets" 
        value={analysisData.packet_count.toLocaleString()} 
        icon={<Activity size={24} />} 
      />
      <StatCard 
        title="Unique IPs" 
        value={uniqueIps} 
        icon={<FileSearch size={24} />} 
      />
      <StatCard 
        title="Protocols Detected" 
        value={protocolCount} 
        icon={<Network size={24} />} 
      />
      <StatCard 
        title="Capture Duration" 
        value={analysisData.capture_duration || "N/A"} 
        icon={<Clock size={24} />} 
      />
    </div>
  );
}
