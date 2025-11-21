import React, { useEffect, useState, useRef } from 'react';
import { authFetch } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/config';
import { Search, Filter, ChevronDown, ChevronUp, RefreshCw, ShieldAlert, Activity, List, BarChart2, AlertTriangle, Globe, Server } from 'lucide-react';
import { 
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, AreaChart, Area, CartesianGrid, Legend 
} from 'recharts';

const API_BASE = API_BASE_URL;

// --- Types ---

interface DNSRecord {
  time: string;
  source: string;
  destination: string;
  query: string;
  qtype_name: string;
  rcode_name: string;
  answers: string[];
  flags: { AA: boolean; TC: boolean; RD: boolean; RA: boolean };
  ttls: number[];
}

interface Aggregates {
  total: number;
  unique_domains: number;
  error_rate: number;
  query_types: Record<string, number>;
  rcodes: Record<string, number>;
  top_domains: { domain: string; count: number }[];
  qps_data: { time: string; count: number }[];
}

interface SecurityMetrics {
  dga_candidates: { domain: string; length: number; count: number; reason: string }[];
  tunneling_candidates: { domain: string; length: number; type: string; count: number; reason: string }[];
  top_clients: { ip: string; count: number; unique_queries: number }[];
  rare_domains: { domain: string; type: string }[];
}

interface DnsViewProps {
  fileId: string;
}

// --- Constants ---

const TYPE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#14b8a6', '#84cc16', '#fb7185'];
const RCODE_COLORS = ['#10b981', '#ef4444', '#f59e0b', '#6366f1', '#06b6d4', '#84cc16', '#eab308'];

// --- Components ---

export const DnsView: React.FC<DnsViewProps> = ({ fileId }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'explorer' | 'security'>('overview');
  
  // Data States
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [securityData, setSecurityData] = useState<SecurityMetrics | null>(null);
  const [records, setRecords] = useState<DNSRecord[]>([]);
  
  // Loading States
  const [loadingAggs, setLoadingAggs] = useState(false);
  const [loadingSec, setLoadingSec] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  
  // Explorer State
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const [search, setSearch] = useState('');
  const [qtypeFilter, setQtypeFilter] = useState<string[]>([]);
  const [rcodeFilter, setRcodeFilter] = useState<string[]>([]);
  const [sort, setSort] = useState('time_desc');
  const [showFilters, setShowFilters] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isFetchingMoreRef = useRef(false);

  // --- Fetchers ---

  const fetchAggregates = async () => {
    setLoadingAggs(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (qtypeFilter.length) params.set('qtype', qtypeFilter.join(','));
      if (rcodeFilter.length) params.set('rcode', rcodeFilter.join(','));
      
      const res = await authFetch(`${API_BASE}/api/dns/${fileId}/aggregates?${params.toString()}`);
      if (!res.ok) throw new Error('Failed aggregate fetch');
      setAggregates(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAggs(false);
    }
  };

  const fetchSecurity = async () => {
    setLoadingSec(true);
    try {
      const res = await authFetch(`${API_BASE}/api/dns/${fileId}/security`);
      if (!res.ok) throw new Error('Failed security fetch');
      setSecurityData(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSec(false);
    }
  };

  const fetchRecords = async (reset = false) => {
    setLoadingRecords(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (search) params.set('search', search);
      if (qtypeFilter.length) params.set('qtype', qtypeFilter.join(','));
      if (rcodeFilter.length) params.set('rcode', rcodeFilter.join(','));
      if (sort) params.set('sort', sort);

      const res = await authFetch(`${API_BASE}/api/dns/${fileId}/records?${params.toString()}`);
      if (!res.ok) throw new Error('Failed records fetch');
      const json = await res.json();
      
      setHasMore(json.has_more);
      if (reset) {
        setRecords(json.records || []);
      } else {
        setRecords(prev => [...prev, ...(json.records || [])]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingRecords(false);
      isFetchingMoreRef.current = false;
    }
  };

  // --- Effects ---

  useEffect(() => {
    fetchAggregates();
    fetchSecurity();
  }, [fileId]);

  useEffect(() => {
    setOffset(0);
    fetchRecords(true);
    fetchAggregates(); // Re-fetch aggregates when filters change
  }, [search, qtypeFilter.join(','), rcodeFilter.join(','), sort, fileId]);

  useEffect(() => {
    if (offset === 0) return;
    fetchRecords(false);
  }, [offset]);

  useEffect(() => {
    if (!sentinelRef.current || activeTab !== 'explorer') return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingRecords && !isFetchingMoreRef.current) {
        isFetchingMoreRef.current = true;
        setOffset(prev => prev + limit);
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingRecords, activeTab]);

  // --- Helpers ---

  const toggleQtype = (qt: string) => {
    setQtypeFilter(prev => prev.includes(qt) ? prev.filter(x => x !== qt) : [...prev, qt]);
  };
  const toggleRcode = (rc: string) => {
    setRcodeFilter(prev => prev.includes(rc) ? prev.filter(x => x !== rc) : [...prev, rc]);
  };
  const clearFilters = () => {
    setSearch('');
    setQtypeFilter([]);
    setRcodeFilter([]);
    setSort('time_desc');
  };
  const formatTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
  };
  const toggleExpand = (idx: number) => setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));

  // --- Renderers ---

  const renderOverview = () => {
    if (!aggregates) return <div className="p-8 text-center text-gray-500">Loading overview...</div>;

    const typeChartData = Object.entries(aggregates.query_types).map(([k, v]) => ({ name: k, value: v }));
    const rcodeChartData = Object.entries(aggregates.rcodes).map(([k, v]) => ({ name: k, value: v }));
    const topDomainData = aggregates.top_domains.slice(0, 10);

    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Queries</p>
              <List className="h-4 w-4 text-indigo-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{aggregates.total.toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Unique Domains</p>
              <Globe className="h-4 w-4 text-purple-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{aggregates.unique_domains.toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Error Rate</p>
              <AlertTriangle className={`h-4 w-4 ${aggregates.error_rate > 5 ? 'text-red-500' : 'text-green-500'}`} />
            </div>
            <p className={`text-2xl font-bold ${aggregates.error_rate > 5 ? 'text-red-600' : 'text-green-600'}`}>
              {aggregates.error_rate.toFixed(2)}%
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Query Types</p>
              <Activity className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{Object.keys(aggregates.query_types).length}</p>
          </div>
        </div>

        {/* QPS Chart */}
        <div className="bg-white p-6 rounded-xl border shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Query Volume Over Time</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={aggregates.qps_data}>
                <defs>
                  <linearGradient id="colorQps" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis 
                  dataKey="time" 
                  tick={{fontSize: 10, fill: '#6b7280'}} 
                  tickFormatter={(t) => new Date(t).toLocaleTimeString()} 
                  minTickGap={50}
                />
                <YAxis tick={{fontSize: 10, fill: '#6b7280'}} />
                <ReTooltip 
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                  labelFormatter={(l) => new Date(l).toLocaleString()}
                />
                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorQps)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distribution Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Query Types</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie 
                    data={typeChartData} 
                    dataKey="value" 
                    nameKey="name" 
                    cx="50%" 
                    cy="50%" 
                    outerRadius={100} 
                    innerRadius={60}
                    paddingAngle={2}
                  >
                    {typeChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={TYPE_COLORS[index % TYPE_COLORS.length]} />
                    ))}
                  </Pie>
                  <ReTooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Response Codes</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie 
                    data={rcodeChartData} 
                    dataKey="value" 
                    nameKey="name" 
                    cx="50%" 
                    cy="50%" 
                    outerRadius={100} 
                    innerRadius={60}
                    paddingAngle={2}
                  >
                    {rcodeChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={RCODE_COLORS[index % RCODE_COLORS.length]} />
                    ))}
                  </Pie>
                  <ReTooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Top Domains */}
        <div className="bg-white p-6 rounded-xl border shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Queried Domains</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topDomainData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                <XAxis type="number" hide />
                <YAxis dataKey="domain" type="category" width={200} tick={{fontSize: 11}} />
                <ReTooltip cursor={{fill: '#f3f4f6'}} />
                <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  };

  const renderSecurity = () => {
    if (!securityData) return <div className="p-8 text-center text-gray-500">Loading security analysis...</div>;

    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
          <div className="flex">
            <div className="flex-shrink-0">
              <ShieldAlert className="h-5 w-5 text-yellow-400" aria-hidden="true" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                These metrics are heuristic-based. High entropy or long domains may indicate DGA (Domain Generation Algorithms) or DNS Tunneling, but could also be benign CDN or tracking traffic.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* DGA Candidates */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="font-semibold text-gray-900 flex items-center">
                <AlertTriangle className="h-4 w-4 text-orange-500 mr-2" />
                Potential DGA / Suspicious Domains
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-500 font-medium">
                  <tr>
                    <th className="p-3">Domain</th>
                    <th className="p-3">Length</th>
                    <th className="p-3">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {securityData.dga_candidates.length === 0 ? (
                    <tr><td colSpan={3} className="p-4 text-center text-gray-500">No suspicious domains detected.</td></tr>
                  ) : (
                    securityData.dga_candidates.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-3 font-mono text-xs truncate max-w-[200px]" title={item.domain}>{item.domain}</td>
                        <td className="p-3">{item.length}</td>
                        <td className="p-3 font-semibold">{item.count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tunneling Candidates */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="font-semibold text-gray-900 flex items-center">
                <Activity className="h-4 w-4 text-red-500 mr-2" />
                Potential Tunneling (Long Queries)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-500 font-medium">
                  <tr>
                    <th className="p-3">Domain</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Length</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {securityData.tunneling_candidates.length === 0 ? (
                    <tr><td colSpan={3} className="p-4 text-center text-gray-500">No tunneling candidates detected.</td></tr>
                  ) : (
                    securityData.tunneling_candidates.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-3 font-mono text-xs truncate max-w-[200px]" title={item.domain}>{item.domain}</td>
                        <td className="p-3"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{item.type}</span></td>
                        <td className="p-3 text-red-600 font-medium">{item.length}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Clients */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="font-semibold text-gray-900 flex items-center">
                <Server className="h-4 w-4 text-blue-500 mr-2" />
                Top Talkers (Clients)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-500 font-medium">
                  <tr>
                    <th className="p-3">Client IP</th>
                    <th className="p-3">Total Queries</th>
                    <th className="p-3">Unique Domains</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {securityData.top_clients.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="p-3 font-mono text-indigo-600">{item.ip}</td>
                      <td className="p-3 font-semibold">{item.count}</td>
                      <td className="p-3 text-gray-600">{item.unique_queries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rare Domains */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="font-semibold text-gray-900 flex items-center">
                <Globe className="h-4 w-4 text-green-500 mr-2" />
                Rare Domains (Seen Once)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-500 font-medium">
                  <tr>
                    <th className="p-3">Domain</th>
                    <th className="p-3">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {securityData.rare_domains.length === 0 ? (
                    <tr><td colSpan={2} className="p-4 text-center text-gray-500">No rare domains found.</td></tr>
                  ) : (
                    securityData.rare_domains.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-3 font-mono text-xs truncate max-w-[250px]" title={item.domain}>{item.domain}</td>
                        <td className="p-3"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{item.type}</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderExplorer = () => {
    return (
      <div className="space-y-4 animate-in fade-in duration-500">
        {/* Filters */}
        <div className="bg-white rounded-xl border shadow-sm">
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center space-x-2">
              <Filter className="h-5 w-5 text-gray-500" />
              <h3 className="font-semibold text-gray-900">Advanced Filters</h3>
            </div>
            <button onClick={() => setShowFilters(s => !s)} className="text-sm text-indigo-600 flex items-center hover:text-indigo-800">
              {showFilters ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
              {showFilters ? 'Hide' : 'Show'}
            </button>
          </div>
          {showFilters && (
            <div className="p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-3 md:space-y-0">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search domain (e.g. google.com)..."
                    className="pl-9 pr-3 py-2 w-full border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
                <div className="flex items-center space-x-2 text-sm">
                  <label className="text-gray-600 font-medium">Sort:</label>
                  <select value={sort} onChange={(e) => setSort(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
                    <option value="time_desc">Time (Newest)</option>
                    <option value="time_asc">Time (Oldest)</option>
                    <option value="domain_asc">Domain (A-Z)</option>
                    <option value="domain_desc">Domain (Z-A)</option>
                  </select>
                </div>
                <button onClick={clearFilters} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                  Clear All
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Query Types</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(aggregates?.query_types || {}).map((qt) => {
                      const active = qtypeFilter.includes(qt);
                      return (
                        <button
                          key={qt}
                          onClick={() => toggleQtype(qt)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                            active 
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' 
                              : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50'
                          }`}
                        >
                          {qt} <span className={`ml-1 ${active ? 'text-indigo-200' : 'text-gray-400'}`}>
                            {aggregates?.query_types[qt]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Response Codes</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(aggregates?.rcodes || {}).map((rc) => {
                      const active = rcodeFilter.includes(rc);
                      const isError = rc !== 'NOERROR';
                      return (
                        <button
                          key={rc}
                          onClick={() => toggleRcode(rc)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                            active 
                              ? (isError ? 'bg-red-600 border-red-600 text-white' : 'bg-green-600 border-green-600 text-white')
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {rc} <span className={`ml-1 opacity-70`}>
                            {aggregates?.rcodes[rc]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900">Query Log</h3>
            <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border">
              {records.length} loaded
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 text-gray-700 uppercase tracking-wider font-medium">
                <tr>
                  <th className="p-3 text-left">Time</th>
                  <th className="p-3 text-left">Source</th>
                  <th className="p-3 text-left">Destination</th>
                  <th className="p-3 text-left">Query</th>
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-left">RCode</th>
                  <th className="p-3 text-left">Answers</th>
                  <th className="p-3 text-left">TTL</th>
                  <th className="p-3 text-center">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {records.map((rec, idx) => {
                  const isOpen = expanded[idx];
                  return (
                    <React.Fragment key={idx}>
                      <tr className={`hover:bg-indigo-50/50 transition-colors ${isOpen ? 'bg-indigo-50/50' : ''}`}>
                        <td className="p-3 whitespace-nowrap text-gray-600">{formatTime(rec.time)}</td>
                        <td className="p-3 font-mono text-gray-800">{rec.source}</td>
                        <td className="p-3 font-mono text-gray-800">{rec.destination}</td>
                        <td className="p-3 font-mono max-w-[250px] truncate text-indigo-700 font-medium" title={rec.query}>{rec.query}</td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded bg-gray-200 text-gray-700 font-semibold text-[10px]">{rec.qtype_name}</span></td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded font-semibold text-[10px] text-white ${rec.rcode_name === 'NOERROR' ? 'bg-green-500' : 'bg-red-500'}`}>
                            {rec.rcode_name}
                          </span>
                        </td>
                        <td className="p-3 max-w-[200px] truncate text-gray-600" title={rec.answers.join(', ')}>
                          {rec.answers.length ? rec.answers.join(', ') : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="p-3 text-gray-600">{rec.ttls.length ? rec.ttls[0] : '-'}</td>
                        <td className="p-3 text-center">
                          <button onClick={() => toggleExpand(idx)} className="text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-100 transition-colors">
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-indigo-50/30">
                          <td colSpan={9} className="p-4">
                            <div className="bg-white rounded-lg border p-4 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6">
                              <div>
                                <p className="text-xs font-bold text-gray-500 uppercase mb-2">Answers</p>
                                {rec.answers.length ? (
                                  <ul className="space-y-1">
                                    {rec.answers.map((a, i) => (
                                      <li key={i} className="font-mono text-xs bg-gray-50 p-1 rounded border border-gray-100">{a}</li>
                                    ))}
                                  </ul>
                                ) : <p className="text-gray-400 text-xs italic">No answers provided</p>}
                              </div>
                              <div>
                                <p className="text-xs font-bold text-gray-500 uppercase mb-2">Flags & Attributes</p>
                                <div className="flex flex-wrap gap-2 mb-3">
                                  {Object.entries(rec.flags).map(([k, v]) => (
                                    <span key={k} className={`px-2 py-1 rounded text-xs font-semibold border ${v ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                                      {k}
                                    </span>
                                  ))}
                                </div>
                                <p className="text-xs text-gray-600"><span className="font-semibold">TTLs:</span> {rec.ttls.join(', ') || 'None'}</p>
                              </div>
                              <div>
                                <p className="text-xs font-bold text-gray-500 uppercase mb-2">Raw Details</p>
                                <div className="text-xs text-gray-600 space-y-1">
                                  <p>Query Length: {rec.query.length}</p>
                                  <p>Full Timestamp: {rec.time}</p>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {loadingRecords && (
                  <tr><td colSpan={9} className="p-8 text-center text-gray-500">Loading records...</td></tr>
                )}
                {!loadingRecords && records.length === 0 && (
                  <tr><td colSpan={9} className="p-8 text-center text-gray-500">No records found matching your filters.</td></tr>
                )}
              </tbody>
            </table>
            <div ref={sentinelRef} className="h-4" />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">DNS Analytics</h2>
          <p className="text-sm text-gray-600">Comprehensive analysis of Domain Name System traffic.</p>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'overview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('explorer')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'explorer' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Explorer
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'security' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Security
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-[500px]">
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'explorer' && renderExplorer()}
        {activeTab === 'security' && renderSecurity()}
      </div>
    </div>
  );
};

export default DnsView;
