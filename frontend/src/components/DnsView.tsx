import React, { useEffect, useState, useRef, useCallback } from 'react';
import { authFetch } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/config';
import { Search, Filter, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts';

const API_BASE = API_BASE_URL;

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
  query_types: Record<string, number>;
  rcodes: Record<string, number>;
  top_domains: { domain: string; count: number }[];
}

interface DnsViewProps {
  fileId: string;
}

// Color palettes for charts
const TYPE_COLORS = ['#6366f1','#8b5cf6','#ec4899','#10b981','#f59e0b','#3b82f6','#ef4444','#14b8a6','#84cc16','#fb7185'];
const RCODE_COLORS = ['#10b981','#ef4444','#f59e0b','#6366f1','#06b6d4','#84cc16','#eab308'];

export const DnsView: React.FC<DnsViewProps> = ({ fileId }) => {
  const [records, setRecords] = useState<DNSRecord[]>([]);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [loading, setLoading] = useState(false);
  const [aggLoading, setAggLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 100;

  // Filter states (server-side; we only reflect UI selections, queries always go to backend)
  const [search, setSearch] = useState('');
  const [qtypeFilter, setQtypeFilter] = useState<string[]>([]);
  const [rcodeFilter, setRcodeFilter] = useState<string[]>([]);
  const [sort, setSort] = useState('time_desc');
  const [showFilters, setShowFilters] = useState(true);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isFetchingMoreRef = useRef(false);

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (search) params.set('search', search);
    if (qtypeFilter.length) params.set('qtype', qtypeFilter.join(','));
    if (rcodeFilter.length) params.set('rcode', rcodeFilter.join(','));
    if (sort) params.set('sort', sort);
    return params.toString();
  };

  const fetchAggregates = async () => {
    setAggLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (qtypeFilter.length) params.set('qtype', qtypeFilter.join(','));
      if (rcodeFilter.length) params.set('rcode', rcodeFilter.join(','));
      const res = await authFetch(`${API_BASE}/api/dns/${fileId}/aggregates?${params.toString()}`);
      if (!res.ok) throw new Error('Failed aggregate fetch');
      const json = await res.json();
      setAggregates(json);
    } catch (e: any) {
      console.error(e);
    } finally {
      setAggLoading(false);
    }
  };

  const fetchRecords = async (reset = false) => {
    setLoading(true);
    setError(null);
    try {
      const query = buildQueryParams();
      const res = await authFetch(`${API_BASE}/api/dns/${fileId}/records?${query}`);
      if (!res.ok) throw new Error('Failed records fetch');
      const json = await res.json();
      const newRecords: DNSRecord[] = json.records || [];
      setHasMore(json.has_more);
      if (reset) {
        setRecords(newRecords);
      } else {
        setRecords(prev => [...prev, ...newRecords]);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      isFetchingMoreRef.current = false;
    }
  };

  // Initial & filter-triggered load
  useEffect(() => {
    // Reset pagination when filters change
    setOffset(0);
    fetchRecords(true);
    fetchAggregates();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, qtypeFilter.join(','), rcodeFilter.join(','), sort, fileId]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(entries => {
      const first = entries[0];
      if (first.isIntersecting && hasMore && !loading && !isFetchingMoreRef.current) {
        isFetchingMoreRef.current = true;
        setOffset(prev => prev + limit);
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  // Fetch on offset increment (pagination advance)
  useEffect(() => {
    if (offset === 0) return; // initial handled by filter effect
    fetchRecords(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

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

  // Expandable row state
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const toggleExpand = (idx: number) => setExpanded(prev => ({...prev, [idx]: !prev[idx]}));

  // Prepare chart data
  const typeChartData = aggregates ? Object.entries(aggregates.query_types).map(([k,v]) => ({ name: k, value: v })) : [];
  const rcodeChartData = aggregates ? Object.entries(aggregates.rcodes).map(([k,v]) => ({ name: k, value: v })) : [];
  const topDomainData = aggregates ? aggregates.top_domains.slice(0, 15) : [];

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">DNS Analytics</h2>
          <p className="text-sm text-gray-600">Deep inspection of DNS queries with server-side filtering & lazy loading.</p>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={() => fetchRecords(true)} className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white flex items-center space-x-1 hover:bg-indigo-700">
            <RefreshCw className="h-4 w-4" /><span>Reload</span>
          </button>
          <button onClick={clearFilters} className="px-3 py-2 text-sm rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300">Clear Filters</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border shadow-sm">
          <p className="text-xs text-gray-500">Total Records (filtered)</p>
          <p className="text-xl font-bold text-indigo-600">{aggregates?.total ?? '—'}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border shadow-sm">
          <p className="text-xs text-gray-500">Unique Domains</p>
          <p className="text-xl font-bold text-purple-600">{aggregates?.unique_domains ?? '—'}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border shadow-sm">
          <p className="text-xs text-gray-500">Query Types</p>
            <p className="text-xl font-bold text-blue-600">{aggregates ? Object.keys(aggregates.query_types).length : '—'}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border shadow-sm">
          <p className="text-xs text-gray-500">Response Codes</p>
          <p className="text-xl font-bold text-green-600">{aggregates ? Object.keys(aggregates.rcodes).length : '—'}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-2">
            <Filter className="h-5 w-5 text-gray-500" />
            <h3 className="font-semibold text-gray-900">Server-side Filters</h3>
          </div>
          <button onClick={() => setShowFilters(s => !s)} className="text-sm text-indigo-600 flex items-center">
            {showFilters ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {showFilters ? 'Hide' : 'Show'}
          </button>
        </div>
        {showFilters && (
          <div className="p-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-3 md:space-y-0">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search domain..."
                  className="pl-9 pr-3 py-2 w-full border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center space-x-2 text-sm">
                <label className="text-gray-600">Sort:</label>
                <select value={sort} onChange={(e)=> setSort(e.target.value)} className="border rounded px-2 py-1 text-sm">
                  <option value="time_desc">Time ↓</option>
                  <option value="time_asc">Time ↑</option>
                  <option value="domain_asc">Domain A→Z</option>
                  <option value="domain_desc">Domain Z→A</option>
                </select>
              </div>
            </div>
            {/* Dynamic filter chips */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Query Types</p>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(aggregates?.query_types || {}).map((qt, idx) => {
                    const active = qtypeFilter.includes(qt);
                    return (
                      <button
                        key={qt}
                        onClick={() => toggleQtype(qt)}
                        className={`px-2 py-1 rounded text-xs font-medium border ${active? 'bg-indigo-600 text-white border-indigo-600':'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >{qt} <span className="opacity-70">({aggregates?.query_types[qt]||0})</span></button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Response Codes</p>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(aggregates?.rcodes || {}).map((rc, idx) => {
                    const active = rcodeFilter.includes(rc);
                    return (
                      <button
                        key={rc}
                        onClick={() => toggleRcode(rc)}
                        className={`px-2 py-1 rounded text-xs font-medium border ${active? 'bg-green-600 text-white border-green-600':'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >{rc} <span className="opacity-70">({aggregates?.rcodes[rc]||0})</span></button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-lg border shadow-sm flex flex-col">
          <h4 className="text-sm font-semibold mb-2">Top Queried Domains</h4>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topDomainData}>
                <XAxis dataKey="domain" tick={{ fontSize: 10 }} interval={0} height={60} angle={-30} textAnchor="end" />
                <YAxis />
                <TooltipFormatter />
                <Bar dataKey="count" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border shadow-sm flex flex-col">
          <h4 className="text-sm font-semibold mb-2">Query Type Distribution</h4>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={typeChartData} dataKey="value" nameKey="name" outerRadius={90} label={({name,percent})=> `${name} ${(percent*100).toFixed(0)}%`}>
                  {typeChartData.map((entry, i) => <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                </Pie>
                <ReTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border shadow-sm flex flex-col">
          <h4 className="text-sm font-semibold mb-2">Response Code Distribution</h4>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={rcodeChartData} dataKey="value" nameKey="name" outerRadius={90} label={({name,percent})=> `${name} ${(percent*100).toFixed(0)}%`}>
                  {rcodeChartData.map((entry, i) => <Cell key={i} fill={RCODE_COLORS[i % RCODE_COLORS.length]} />)}
                </Pie>
                <ReTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* DNS Records Table */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">DNS Query Records</h3>
          <span className="text-xs text-gray-500">Showing {records.length} / {aggregates?.total ?? '—'} (lazy loaded)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="p-2 text-left">Time</th>
                <th className="p-2 text-left">Source</th>
                <th className="p-2 text-left">Destination</th>
                <th className="p-2 text-left">Query</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">RCode</th>
                <th className="p-2 text-left">Answers</th>
                <th className="p-2 text-left">TTL</th>
                <th className="p-2 text-left">Flags</th>
                <th className="p-2 text-left">Expand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {records.map((rec, idx) => {
                const isOpen = expanded[idx];
                return (
                  <React.Fragment key={idx}>
                    <tr className="hover:bg-indigo-50">
                      <td className="p-2 whitespace-nowrap text-gray-600">{formatTime(rec.time)}</td>
                      <td className="p-2 font-mono text-gray-800">{rec.source}</td>
                      <td className="p-2 font-mono text-gray-800">{rec.destination}</td>
                      <td className="p-2 font-mono max-w-[220px] truncate" title={rec.query}>{rec.query}</td>
                      <td className="p-2"><span className="px-2 py-0.5 rounded bg-blue-600 text-white font-semibold">{rec.qtype_name}</span></td>
                      <td className="p-2"><span className={`px-2 py-0.5 rounded font-semibold text-white ${rec.rcode_name==='NOERROR'?'bg-green-600':'bg-red-600'}`}>{rec.rcode_name}</span></td>
                      <td className="p-2 max-w-[200px] truncate" title={rec.answers.join(', ')}>{rec.answers.length? rec.answers.join(', '): '—'}</td>
                      <td className="p-2">{rec.ttls.length? rec.ttls.join(', '): '—'}</td>
                      <td className="p-2 text-gray-500">{['AA','TC','RD','RA'].filter(f => (rec.flags as any)[f]).join(' ') || '—'}</td>
                      <td className="p-2">
                        <button onClick={()=> toggleExpand(idx)} className="text-indigo-600 hover:text-indigo-800">
                          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-indigo-50/40">
                        <td colSpan={10} className="p-3 text-[11px] leading-relaxed">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <p className="font-semibold text-gray-700 mb-1">Answers</p>
                              {rec.answers.length? (
                                <ul className="list-disc ml-4 space-y-1">
                                  {rec.answers.map((a,i)=> <li key={i} className="font-mono">{a}</li>)}
                                </ul>
                              ): <p className="text-gray-500">No answers</p>}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-700 mb-1">TTLs</p>
                              {rec.ttls.length? (
                                <p className="font-mono">{rec.ttls.join(', ')}</p>
                              ): <p className="text-gray-500">No TTLs captured</p>}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-700 mb-1">Flags</p>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(rec.flags).map(([k,v]) => (
                                  <span key={k} className={`px-2 py-0.5 rounded text-xs font-semibold ${v? 'bg-indigo-600 text-white':'bg-gray-200 text-gray-600'}`}>{k}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {loading && (
                <tr><td colSpan={10} className="p-4 text-center text-gray-500">Loading...</td></tr>
              )}
              {error && (
                <tr><td colSpan={10} className="p-4 text-center text-red-600">{error}</td></tr>
              )}
              {!loading && records.length===0 && !error && (
                <tr><td colSpan={10} className="p-4 text-center text-gray-500">No DNS records match filters.</td></tr>
              )}
            </tbody>
          </table>
          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} className="h-10" />
        </div>
      </div>
    </div>
  );
};

// Custom tooltip wrapper for BarChart (recharts Tooltip not directly imported above)
const TooltipFormatter: React.FC = () => {
  return <ReTooltip />;
};

export default DnsView;