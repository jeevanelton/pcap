const API_BASE_URL = 'http://localhost:5000';

export interface UploadResponse {
  message: string;
  filename: string;
}

export interface AnalysisResult {
  filename: string;
  packet_count: number;
  protocols: { [key: string]: number };
  top_ips: { [key: string]: number };
  conversation_stats: Array<{
    src_ip: string;
    dst_ip: string;
    packet_count: number;
    total_bytes: number;
  }>;
  time_series_data: Array<{
    timestamp: string;
    packet_count: number;
  }>;
}

export const api = {
  async uploadFile(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('File upload failed');
    }

    return response.json();
  },

  async getAnalysis(filename: string): Promise<AnalysisResult> {
    const response = await fetch(`${API_BASE_URL}/analyze/${filename}`);
    
    if (!response.ok) {
      throw new Error('Analysis failed');
    }

    return response.json();
  },

  async getFiles(): Promise<string[]> {
    const response = await fetch(`${API_BASE_URL}/files`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch files');
    }

    return response.json();
  },
};