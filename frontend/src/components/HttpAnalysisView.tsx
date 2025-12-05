import React, { useEffect, useState, useMemo, useRef } from 'react';
import { authFetch } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/config';
import {
    Search, RefreshCw, Download, Globe, AlertTriangle,
    CheckCircle, Clock, ArrowUpRight, Filter, Server
} from 'lucide-react';
import {
    PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from 'recharts';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#84cc16', '#14b8a6'];

interface HttpAnalysisViewProps {
    fileId: string;
}

export const HttpAnalysisView: React.FC<HttpAnalysisViewProps> = ({ fileId }) => {
    const [data, setData] = useState<any>(null);
    const [records, setRecords] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    // Pagination state
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const limit = 50;

    const observerTarget = useRef<HTMLDivElement>(null);

    const fetchData = async (reset = false) => {
        if (reset) {
            setLoading(true);
            setOffset(0);
        } else {
            setLoadingMore(true);
        }

        try {
            const currentOffset = reset ? 0 : offset;
            const res = await authFetch(`${API_BASE_URL}/api/details/http/${fileId}?limit=${limit}&offset=${currentOffset}`);
            if (res.ok) {
                const json = await res.json();

                if (reset) {
                    setData(json);
                    setRecords(json.requests || []);
                } else {
                    // Update stats but keep existing structure
                    setData((prev: any) => ({ ...prev, ...json, requests: [...(prev?.requests || []), ...(json.requests || [])] }));
                    setRecords((prev) => [...prev, ...(json.requests || [])]);
                }

                setHasMore(json.has_more);
                setOffset(currentOffset + limit);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        fetchData(true);
    }, [fileId]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
                    fetchData(false);
                }
            },
            { threshold: 0.1 }
        );

        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }

        return () => observer.disconnect();
    }, [hasMore, loading, loadingMore, offset]);

    const filteredRequests = useMemo(() => {
        if (!records) return [];
        return records.filter((r: any) => {
            const matchesSearch =
                r.host.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.method.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.uri.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesStatus = statusFilter === 'all'
                ? true
                : statusFilter === 'error'
                    ? r.status_code >= 400
                    : statusFilter === 'success'
                        ? r.status_code < 400
                        : true;

            return matchesSearch && matchesStatus;
        });
    }, [records, searchTerm, statusFilter]);

    const stats = useMemo(() => {
        if (!data) return null;
        const total = data.total || 0;
        const errors = data.requests?.filter((r: any) => r.status_code >= 400).length || 0;
        const errorRate = total > 0 ? ((errors / total) * 100).toFixed(1) : '0';
        const uniqueHosts = data.top_hosts?.length || 0;
        const avgLatency = 'N/A'; // Placeholder if backend doesn't provide latency yet

        return { total, errors, errorRate, uniqueHosts, avgLatency };
    }, [data]);

    const methodData = useMemo(() => {
        if (!data?.methods) return [];
        return Object.entries(data.methods).map(([name, value]) => ({ name, value }));
    }, [data]);

    const statusData = useMemo(() => {
        if (!data?.status_codes) return [];
        return Object.entries(data.status_codes).map(([name, value]) => ({ name, value }));
    }, [data]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (!data) return <div className="p-8 text-center text-gray-500">No HTTP data available.</div>;

    return (
        <div className="space-y-6 pb-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Globe className="h-6 w-6 text-indigo-600" />
                        HTTP Traffic Analysis
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                        Comprehensive breakdown of HTTP requests, methods, and response codes.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchData}
                        className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Refresh Data"
                    >
                        <RefreshCw className="h-5 w-5" />
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm">
                        <Download className="h-4 w-4" />
                        <span className="text-sm font-medium">Export Report</span>
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    title="Total Requests"
                    value={stats?.total.toLocaleString()}
                    icon={<Globe className="h-5 w-5 text-blue-600" />}
                    trend="+12% vs last hour" // Mock trend
                    color="blue"
                />
                <KPICard
                    title="Error Rate"
                    value={`${stats?.errorRate}%`}
                    icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
                    subValue={`${stats?.errors} failed requests`}
                    color="red"
                />
                <KPICard
                    title="Unique Hosts"
                    value={stats?.uniqueHosts.toLocaleString()}
                    icon={<Server className="h-5 w-5 text-purple-600" />}
                    color="purple"
                />
                <KPICard
                    title="Avg Response Time"
                    value={stats?.avgLatency}
                    icon={<Clock className="h-5 w-5 text-green-600" />}
                    color="green"
                />
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Status Codes */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Response Status Distribution</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={statusData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {statusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.name.startsWith('2') ? '#22c55e' : entry.name.startsWith('3') ? '#3b82f6' : entry.name.startsWith('4') ? '#f59e0b' : '#ef4444'} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* HTTP Methods */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">HTTP Methods</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={methodData} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={60} tick={{ fontSize: 12 }} />
                                <Tooltip cursor={{ fill: '#f3f4f6' }} />
                                <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Detailed Request Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">Request Log</h3>
                        <span className="px-2 py-0.5 rounded-full bg-gray-200 text-xs text-gray-700 font-medium">
                            {filteredRequests.length}
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex items-center bg-white border border-gray-200 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all">
                            <Search className="h-4 w-4 text-gray-400 mr-2" />
                            <input
                                type="text"
                                placeholder="Search host, method, uri..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="text-sm outline-none w-48 placeholder-gray-400"
                            />
                        </div>
                        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
                            <button
                                onClick={() => setStatusFilter('all')}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusFilter === 'all' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setStatusFilter('error')}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusFilter === 'error' ? 'bg-red-50 text-red-700' : 'text-gray-600 hover:bg-gray-50'}`}
                            >
                                Errors
                            </button>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-100">
                            <tr>
                                <th className="px-6 py-3 w-32">Time</th>
                                <th className="px-6 py-3 w-24">Method</th>
                                <th className="px-6 py-3 w-24">Status</th>
                                <th className="px-6 py-3">Host & URI</th>
                                <th className="px-6 py-3">Source</th>
                                <th className="px-6 py-3 w-20"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredRequests.map((req: any, idx: number) => (
                                <tr key={idx} className="hover:bg-gray-50/80 transition-colors group">
                                    <td className="px-6 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                                        {new Date(req.time).toLocaleTimeString()}
                                    </td>
                                    <td className="px-6 py-3">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border ${getMethodColor(req.method)}`}>
                                            {req.method}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3">
                                        <span className={`inline-flex items-center gap-1.5 ${getStatusColor(req.status_code)}`}>
                                            {req.status_code ? (
                                                req.status_code >= 400 ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />
                                            ) : (
                                                <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                                            )}
                                            <span className="font-mono font-semibold">{req.status_code || '-'}</span>
                                        </span>
                                    </td>
                                    <td className="px-6 py-3">
                                        <div className="flex flex-col max-w-md">
                                            <span className="text-gray-900 font-medium truncate" title={req.host}>{req.host}</span>
                                            <span className="text-gray-500 text-xs truncate font-mono" title={req.uri}>{req.uri}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-3 text-gray-600 font-mono text-xs">
                                        {req.source}
                                    </td>
                                    <td className="px-6 py-3 text-right">
                                        <button className="text-gray-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <ArrowUpRight className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredRequests.length === 0 && (
                        <div className="p-8 text-center text-gray-500 bg-gray-50/30">
                            No requests match your filters.
                        </div>
                    )}
                </div>
            </div>

            {/* Loading indicator for infinite scroll */}
            {hasMore && (
                <div ref={observerTarget} className="p-4 flex justify-center">
                    {loadingMore ? (
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                    ) : (
                        <span className="text-gray-400 text-sm">Scroll for more...</span>
                    )}
                </div>
            )}
        </div>
    );
};

const KPICard = ({ title, value, icon, trend, subValue, color }: any) => {
    const colorClasses: any = {
        blue: 'bg-blue-50 text-blue-600 border-blue-100',
        red: 'bg-red-50 text-red-600 border-red-100',
        purple: 'bg-purple-50 text-purple-600 border-purple-100',
        green: 'bg-green-50 text-green-600 border-green-100',
    };

    return (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <p className="text-sm font-medium text-gray-500">{title}</p>
                    <h3 className="text-2xl font-bold text-gray-900 mt-1">{value}</h3>
                </div>
                <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
                    {icon}
                </div>
            </div>
            {(trend || subValue) && (
                <div className="flex items-center gap-2 text-xs">
                    {trend && <span className="text-green-600 font-medium bg-green-50 px-1.5 py-0.5 rounded">{trend}</span>}
                    {subValue && <span className="text-gray-500">{subValue}</span>}
                </div>
            )}
        </div>
    );
};

const getMethodColor = (method: string) => {
    switch (method.toUpperCase()) {
        case 'GET': return 'bg-blue-50 text-blue-700 border-blue-200';
        case 'POST': return 'bg-green-50 text-green-700 border-green-200';
        case 'PUT': return 'bg-orange-50 text-orange-700 border-orange-200';
        case 'DELETE': return 'bg-red-50 text-red-700 border-red-200';
        default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
};

const getStatusColor = (code: number) => {
    if (!code) return 'text-gray-400';
    if (code >= 500) return 'text-red-600';
    if (code >= 400) return 'text-orange-600';
    if (code >= 300) return 'text-blue-600';
    return 'text-green-600';
};
