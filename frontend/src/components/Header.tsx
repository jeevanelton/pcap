import React from 'react';
import { ShieldCheck, Upload, ArrowLeft } from 'lucide-react';

interface HeaderProps {
  onBack: () => void;
  onUpload: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onBack, onUpload }) => {
  return (
    <header className="relative bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 shadow-lg">
      <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div className="flex items-center space-x-3">
            <button onClick={onBack} className="text-white/80 hover:text-white transition-colors">
              <ArrowLeft className="h-6 w-6" />
            </button>
            <ShieldCheck className="h-10 w-10 text-white drop-shadow-lg" />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">PCAP Analyzer</h1>
              <p className="text-xs text-white/80">Network Traffic Analysis</p>
            </div>
          </div>
          <button
            onClick={onUpload}
            className="group relative inline-flex items-center px-6 py-3 text-sm font-medium text-white bg-white/20 backdrop-blur-md rounded-lg hover:bg-white/30 transition-all duration-300 hover:scale-105 hover:shadow-xl border border-white/30"
          >
            <Upload className="mr-2 h-5 w-5 group-hover:rotate-12 transition-transform duration-300" />
            <span className="relative">Upload PCAP</span>
          </button>
        </div>
      </div>
    </header>
  );
};
