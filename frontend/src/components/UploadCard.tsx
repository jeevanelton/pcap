import { useState, useEffect } from 'react';
import { Upload, FileSearch, AlertCircle, CheckCircle } from 'lucide-react';
import { authUploadWithProgress, authFetch } from '../contexts/AuthContext';

const API_BASE = 'http://localhost:8000';

// UI: UploadCard component adapted for the new modal design with project scoping
export function UploadCard({ projectId, setFileId, setAnalysisData, setPacketsData, setOverviewData, onAnalysisComplete }: any) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, analyzing, error, success
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [replacedCount, setReplacedCount] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && (selectedFile.name.endsWith('.pcap') || selectedFile.name.endsWith('.pcapng'))) {
      setFile(selectedFile);
      setStatus('idle');
      setError(null);
      setUploadProgress(0);
      setAnalysisProgress(0);
    } else {
      setError('Please select a valid .pcap or .pcapng file');
      setFile(null);
    }
  };

  const pollAnalysisProgress = async (taskId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await authFetch(`${API_BASE}/api/analyze/status/${taskId}`);
        if (!res.ok) throw new Error('Failed to get analysis status');
        const data = await res.json();

        if (data.status === 'processing') {
          setAnalysisProgress(data.progress);
        } else if (data.status === 'completed') {
          setAnalysisProgress(100);
          clearInterval(interval);
          const fileId = data.file_id;
          setFileId(fileId);

          const analysisResponse = await authFetch(`${API_BASE}/api/analyze/${fileId}`);
          if (!analysisResponse.ok) throw new Error('Analysis failed');
          const analysis = await analysisResponse.json();
          setAnalysisData(analysis);

          const packetsResponse = await authFetch(`${API_BASE}/api/packets/${fileId}?limit=50`);
          if (!packetsResponse.ok) throw new Error('Failed to fetch packets');
          const packets = await packetsResponse.json();
          setPacketsData(packets);

          const overviewResponse = await authFetch(`${API_BASE}/api/overview/${fileId}`);
          if (!overviewResponse.ok) throw new Error('Failed to fetch overview');
          const overview = await overviewResponse.json();
          setOverviewData(overview);

          setStatus('success');
          setError(null);
          setTimeout(() => onAnalysisComplete(), 1000);
        } else if (data.status === 'error') {
          clearInterval(interval);
          setStatus('error');
          setError(data.message || 'Analysis failed');
        }
      } catch (err: any) {
        clearInterval(interval);
        setStatus('error');
        setError(err.message || 'An unknown error occurred');
      }
    }, 2000);
  };

  const handleUploadAndAnalyze = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setStatus('uploading');
      const uploadData: any = await authUploadWithProgress(`${API_BASE}/api/projects/${projectId}/upload`, formData, (progress) => {
        setUploadProgress(progress);
      });
      console.log('Upload data:', uploadData);
      
      // Show notification if files were replaced
      if (uploadData.replaced && uploadData.replaced > 0) {
        setReplacedCount(uploadData.replaced);
      }
      
      setStatus('analyzing');
      await pollAnalysisProgress(uploadData.task_id);

    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'An unknown error occurred');
    }
  };

  const getStatusContent = () => {
    const totalProgress = uploadProgress / 2 + analysisProgress / 2;

    switch (status) {
      case 'uploading':
      case 'analyzing':
        return (
          <div className="w-full">
            <div className="flex justify-between mb-1">
              <span className="text-base font-medium text-white">{status === 'uploading' ? 'Uploading...' : 'Processing file...'}</span>
              <span className="text-sm font-medium text-white">{Math.round(totalProgress)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
              <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${totalProgress}%` }}></div>
            </div>
          </div>
        );
      case 'success':
        return <><CheckCircle size={16} className="mr-2" /> Analysis complete!</>;
      default:
        return 'Upload & Analyze';
    }
  };

  return (
    <div className="text-center">
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-10 mb-6">
        {file ? (
          <div>
            <p className="text-sm text-gray-600">Selected: {file.name}</p>
            <button onClick={() => setFile(null)} className="mt-2 text-sm text-red-600 hover:text-red-800">
              Remove
            </button>
          </div>
        ) : (
          <>
            <Upload className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-600">Drag and drop your PCAP file here</p>
            <label htmlFor="file-upload" className="mt-4 inline-flex items-center px-4 py-2 bg-white border border-gray-300 text-sm font-medium rounded-md cursor-pointer hover:bg-gray-50">
              Browse File
            </label>
            <input id="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".pcap,.pcapng" />
          </>
        )}
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
      
      {replacedCount > 0 && status !== 'error' && (
        <div className="mt-4 text-sm text-amber-600 flex items-center justify-center bg-amber-50 p-2 rounded-md border border-amber-200">
          <AlertCircle size={16} className="mr-2" />
          Replaced {replacedCount} existing file{replacedCount > 1 ? 's' : ''} in this project
        </div>
      )}
    </div>
  );
}
