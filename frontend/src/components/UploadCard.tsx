import { useState } from 'react';
import { Upload, FileSearch, AlertCircle, CheckCircle } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

// UI: UploadCard component adapted for the new modal design
export function UploadCard({ setFileId, setAnalysisData, setPacketsData, onAnalysisComplete }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, analyzing, error, success
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && (selectedFile.name.endsWith('.pcap') || selectedFile.name.endsWith('.pcapng'))) {
      setFile(selectedFile);
      setStatus('idle');
      setError(null);
    } else {
      setError('Please select a valid .pcap or .pcapng file');
      setFile(null);
    }
  };

  const handleUploadAndAnalyze = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setStatus('uploading');
      const uploadResponse = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData });
      if (!uploadResponse.ok) throw new Error('Upload failed');
      const uploadData = await uploadResponse.json();
      setFileId(uploadData.file_id);

      setStatus('analyzing');
      const analysisResponse = await fetch(`${API_BASE}/api/analyze/${uploadData.file_id}`);
      if (!analysisResponse.ok) throw new Error('Analysis failed');
      const analysis = await analysisResponse.json();
      setAnalysisData(analysis);

      const packetsResponse = await fetch(`${API_BASE}/api/packets/${uploadData.file_id}?limit=50`);
      if (!packetsResponse.ok) throw new Error('Failed to fetch packets');
      const packets = await packetsResponse.json();
      setPacketsData(packets);

      setStatus('success');
      setError(null);
      // Close modal on success
      setTimeout(() => onAnalysisComplete(), 1000);

    } catch (err) {
      setStatus('error');
      setError(err.message || 'An unknown error occurred');
    }
  };

  const getStatusContent = () => {
    switch (status) {
      case 'uploading':
        return <><Upload size={16} className="mr-2 animate-spin" /> Uploading...</>;
      case 'analyzing':
        return <><FileSearch size={16} className="mr-2 animate-pulse" /> Analyzing...</>;
      case 'success':
        return <><CheckCircle size={16} className="mr-2" /> Success!</>;
      default:
        return 'Upload & Analyze';
    }
  };

  return (
    <div className="text-center">
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-10 mb-6">
        <Upload className="mx-auto h-12 w-12 text-gray-400" />
        <p className="mt-2 text-sm text-gray-600">
          {file ? `Selected: ${file.name}` : 'Drag and drop your PCAP file here'}
        </p>
        <label htmlFor="file-upload" className="mt-4 inline-flex items-center px-4 py-2 bg-white border border-gray-300 text-sm font-medium rounded-md cursor-pointer hover:bg-gray-50">
          Browse File
        </label>
        <input id="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".pcap,.pcapng" />
      </div>

      <button 
        onClick={handleUploadAndAnalyze} 
        disabled={!file || status === 'uploading' || status === 'analyzing'}
        className="w-full bg-indigo-600 text-white py-3 rounded-md hover:bg-indigo-700 disabled:bg-gray-400 flex items-center justify-center text-base font-medium"
      >
        {getStatusContent()}
      </button>

      {status === 'error' && (
        <div className="mt-4 text-sm text-red-600 flex items-center justify-center">
          <AlertCircle size={16} className="mr-2" />
          {error}
        </div>
      )}
    </div>
  );
}
