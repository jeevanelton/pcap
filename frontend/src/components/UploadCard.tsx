import { useState, useEffect } from 'react';
import { Upload, FileSearch, AlertCircle, CheckCircle, X } from 'lucide-react';
import { authUploadWithProgress, authFetch } from '../contexts/AuthContext';
import { API_BASE_URL } from '../config';

const API_BASE = API_BASE_URL;

// UI: UploadCard component adapted for the new modal design with project scoping
export function UploadCard({ projectId, setFileId, setAnalysisData, setPacketsData, setOverviewData, onAnalysisComplete, onStatusChange }: any) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, analyzing, error, success
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [replacedCount, setReplacedCount] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);

  // Notify parent of status changes
  useEffect(() => {
    if (onStatusChange) {
      onStatusChange(status === 'uploading' || status === 'analyzing');
    }
  }, [status, onStatusChange]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (taskId && (status === 'uploading' || status === 'analyzing')) {
        const token = localStorage.getItem('token');
        if (token) {
          fetch(`${API_BASE}/api/analyze/cancel/${taskId}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            keepalive: true
          });
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [taskId, status]);

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

  const handleCancel = async () => {
    if (taskId) {
      try {
        await authFetch(`${API_BASE}/api/analyze/cancel/${taskId}`, { method: 'POST' });
      } catch (e) {
        console.error("Failed to cancel", e);
      }
    }
    setStatus('idle');
    setFile(null);
    setUploadProgress(0);
    setAnalysisProgress(0);
    setTaskId(null);
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
          setTaskId(null);
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
          setTaskId(null);
        } else if (data.status === 'cancelled') {
          clearInterval(interval);
          setStatus('idle');
          setTaskId(null);
        }
      } catch (err: any) {
        clearInterval(interval);
        setStatus('error');
        setError(err.message || 'An unknown error occurred');
        setTaskId(null);
      }
    }, 1000); // Poll faster
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

      if (uploadData.task_id) {
        setTaskId(uploadData.task_id);
      }

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
          <div className="w-full px-1">
            <div className="flex justify-between mb-2 items-center">
              <span className="text-xs font-bold text-indigo-100 tracking-wider uppercase">
                {status === 'uploading' ? 'Uploading...' : 'Analyzing...'}
              </span>
              <span className="text-xs font-bold text-white">{Math.round(totalProgress)}%</span>
            </div>
            <div className="w-full bg-black/20 rounded-full h-1.5 overflow-hidden backdrop-blur-sm">
              <div
                className="bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300 h-1.5 rounded-full transition-all duration-300 ease-out shadow-[0_0_12px_rgba(167,139,250,0.6)] relative"
                style={{ width: `${totalProgress}%` }}
              >
                <div className="absolute inset-0 bg-white/30 animate-[shimmer_1.5s_infinite] skew-x-12"></div>
              </div>
            </div>
            <p className="text-[10px] text-indigo-200 mt-2 text-left font-medium opacity-80">
              {status === 'uploading' ? 'Encrypting & transferring...' : 'Deep packet inspection in progress...'}
            </p>
          </div>
        );
      case 'success':
        return <><CheckCircle size={18} className="mr-2" /> Analysis Complete</>;
      default:
        return 'Upload & Analyze';
    }
  };

  return (
    <div className="text-center">
      <div
        className={`border-2 border-dashed rounded-2xl p-10 mb-8 relative group transition-all duration-300 ease-in-out ${file
          ? 'border-indigo-500 bg-indigo-50/50 shadow-[0_0_20px_rgba(99,102,241,0.1)]'
          : 'border-gray-200 hover:border-indigo-400 hover:bg-gray-50/80 hover:shadow-lg'
          }`}
      >
        {file ? (
          <div className="relative flex flex-col items-center animate-in fade-in zoom-in duration-300">
            <div className="bg-white p-4 rounded-2xl shadow-lg shadow-indigo-100 mb-4 ring-1 ring-indigo-50">
              <FileSearch className="text-indigo-600" size={36} />
            </div>
            <p className="text-lg font-bold text-gray-900 tracking-tight">{file.name}</p>
            <p className="text-sm text-gray-500 mt-1 font-medium bg-white/50 px-3 py-1 rounded-full border border-gray-100 shadow-sm">
              {(file.size / (1024 * 1024)).toFixed(2)} MB
            </p>

            {status === 'idle' && (
              <button
                onClick={() => setFile(null)}
                className="absolute -top-12 -right-12 p-2 bg-white text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full shadow-md border border-gray-100 transition-all duration-200 hover:scale-110 hover:rotate-90"
                title="Remove file"
              >
                <X size={18} />
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="bg-indigo-50 p-5 rounded-2xl mb-5 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-sm">
              <Upload className="h-10 w-10 text-indigo-600" />
            </div>
            <p className="mt-2 text-lg font-semibold text-gray-900">Drag and drop your PCAP</p>
            <p className="text-sm text-gray-500 mt-1 mb-6 max-w-xs mx-auto leading-relaxed">
              Support for .pcap and .pcapng files. <br /> Max file size 500MB.
            </p>
            <label htmlFor="file-upload" className="relative inline-flex items-center px-8 py-3 bg-white border border-gray-200 text-sm font-bold text-gray-700 rounded-xl cursor-pointer hover:bg-gray-50 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm hover:shadow-md group-hover:-translate-y-0.5">
              Browse Files
            </label>
            <input id="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".pcap,.pcapng" />
          </div>
        )}
      </div>

      <div className="flex space-x-4">
        <button
          onClick={handleUploadAndAnalyze}
          disabled={!file || status === 'uploading' || status === 'analyzing'}
          className={`flex-1 py-3.5 rounded-lg flex items-center justify-center text-base font-semibold transition-all shadow-md
                ${(!file || status === 'uploading' || status === 'analyzing')
              ? 'bg-indigo-600 text-white cursor-not-allowed opacity-90'
              : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-700 hover:to-blue-700 hover:shadow-lg transform hover:-translate-y-0.5'
            }`}
        >
          {getStatusContent()}
        </button>

        {(status === 'uploading' || status === 'analyzing') && (
          <button
            onClick={handleCancel}
            className="px-6 py-3.5 bg-white text-red-600 border border-red-200 rounded-lg hover:bg-red-50 hover:border-red-300 font-semibold transition-all shadow-sm hover:shadow-md"
            title="Cancel Analysis"
          >
            Cancel
          </button>
        )}
      </div>

      {status === 'error' && (
        <div className="mt-4 text-sm text-red-600 flex items-center justify-center bg-red-50 p-3 rounded-md border border-red-200">
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
