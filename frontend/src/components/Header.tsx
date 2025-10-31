import { Network } from 'lucide-react';

export function Header() {
  return (
    <div className="text-center mb-12">
      <div className="flex items-center justify-center mb-4">
        <Network className="text-blue-500 mr-4" size={48} />
        <h1 className="text-4xl font-bold text-white">PCAP Analyzer</h1>
      </div>
      <p className="text-slate-400">Upload and analyze network packet capture files</p>
    </div>
  );
}
