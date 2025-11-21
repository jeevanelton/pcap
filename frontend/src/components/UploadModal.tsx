import React from 'react';
import { Upload, X } from 'lucide-react';
import { UploadCard } from '@/components/UploadCard';

interface UploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string | null;
    setFileId: (id: string) => void;
    setAnalysisData: (data: any) => void;
    setPacketsData: (data: any) => void;
    setOverviewData: (data: any) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({
    isOpen,
    onClose,
    projectId,
    setFileId,
    setAnalysisData,
    setPacketsData,
    setOverviewData
}) => {
    const [isProcessing, setIsProcessing] = React.useState(false);

    if (!isOpen) return null;

    const handleClose = () => {
        if (!isProcessing) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
            onClick={handleClose} // Close on backdrop click if not processing
        >
            <div
                className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full relative overflow-hidden"
                onClick={e => e.stopPropagation()} // Prevent click from bubbling to backdrop
            >
                {/* Close button */}
                <button
                    onClick={handleClose}
                    disabled={isProcessing}
                    className={`absolute top-4 right-4 p-2 rounded-full transition-colors ${isProcessing
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                        }`}
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="flex items-center mb-8">
                    <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                        <Upload className="h-6 w-6 text-white" />
                    </div>
                    <div className="ml-4">
                        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Upload PCAP</h2>
                        <p className="text-sm text-gray-500 font-medium">Analyze network traffic patterns</p>
                    </div>
                </div>

                <UploadCard
                    projectId={projectId}
                    setFileId={setFileId}
                    setAnalysisData={setAnalysisData}
                    setPacketsData={setPacketsData}
                    setOverviewData={setOverviewData}
                    onAnalysisComplete={onClose}
                    onStatusChange={setIsProcessing}
                />
            </div>
        </div>
    );
};
