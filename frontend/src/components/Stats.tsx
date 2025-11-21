import { Activity, Network, FileSearch, Clock } from 'lucide-react';

// Helper to format duration
const formatDuration = (seconds: number) => {
  if (!seconds) return "0s";
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  
  return parts.join(' ');
};

// UI: Rewritten Stats.tsx for consistency and correctness.
const StatCard = ({ title, value, icon, colorClass = "text-indigo-600", bgClass = "bg-indigo-50" }) => (
  <div className="bg-white/80 backdrop-blur-sm p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-all duration-300 hover:-translate-y-1 group">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-500 group-hover:text-gray-700 transition-colors">{title}</p>
        <p className="mt-2 text-3xl font-bold text-gray-900 tracking-tight">{value}</p>
      </div>
      <div className={`p-3 rounded-lg ${bgClass} ${colorClass} group-hover:scale-110 transition-transform duration-300`}>
        {icon}
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
        colorClass="text-blue-600"
        bgClass="bg-blue-50"
      />
      <StatCard
        title="Unique IPs"
        value={uniqueIps}
        icon={<FileSearch size={24} />}
        colorClass="text-purple-600"
        bgClass="bg-purple-50"
      />
      <StatCard
        title="Protocols Detected"
        value={protocolCount}
        icon={<Network size={24} />}
        colorClass="text-pink-600"
        bgClass="bg-pink-50"
      />
      <StatCard
        title="Capture Duration"
        value={formatDuration(analysisData.capture_duration)}
        icon={<Clock size={24} />}
        colorClass="text-orange-600"
        bgClass="bg-orange-50"
      />
    </div>
  );
}
