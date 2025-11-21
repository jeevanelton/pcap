import React from 'react';
import { BarChart2, Table, GitMerge, Activity, MapIcon, Globe, Lock, Server, Shield, Wifi, FileText, Terminal, Database, Key } from 'lucide-react';

interface TabNavProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    disabled: boolean;
}

export const TabNav: React.FC<TabNavProps> = ({ activeTab, setActiveTab, disabled }) => {
    const mainTabs = ['Dashboard', 'Packets', 'Network Graph', 'GeoMap'];
    const protocolTabs = [
        'DNS', 'HTTP', 'SSL/TLS', 'TCP', 'ICMP', 'DHCP', 'SMB', 'ARP', 
        'SIP', 'Telnet', 'FTP', 'SSDP'
    ];
    const analysisTabs = ['Open Ports', 'Connections', 'Hosts', 'Servers', 'Credentials'];

    const getIcon = (tab: string) => {
        switch (tab) {
            case 'Dashboard': return <BarChart2 className="mr-2 h-4 w-4" />;
            case 'Packets': return <Table className="mr-2 h-4 w-4" />;
            case 'Network Graph': return <GitMerge className="mr-2 h-4 w-4" />;
            case 'GeoMap': return <MapIcon className="mr-2 h-4 w-4" />;
            case 'DNS': return <Globe className="mr-2 h-4 w-4" />;
            case 'HTTP': return <Globe className="mr-2 h-4 w-4" />;
            case 'SSL/TLS': return <Lock className="mr-2 h-4 w-4" />;
            case 'TCP': return <Activity className="mr-2 h-4 w-4" />;
            case 'ICMP': return <Activity className="mr-2 h-4 w-4" />;
            case 'DHCP': return <Wifi className="mr-2 h-4 w-4" />;
            case 'SMB': return <FileText className="mr-2 h-4 w-4" />;
            case 'ARP': return <Activity className="mr-2 h-4 w-4" />;
            case 'SIP': return <Activity className="mr-2 h-4 w-4" />;
            case 'Telnet': return <Terminal className="mr-2 h-4 w-4" />;
            case 'FTP': return <FileText className="mr-2 h-4 w-4" />;
            case 'SSDP': return <Wifi className="mr-2 h-4 w-4" />;
            case 'Open Ports': return <Server className="mr-2 h-4 w-4" />;
            case 'Connections': return <GitMerge className="mr-2 h-4 w-4" />;
            case 'Hosts': return <Server className="mr-2 h-4 w-4" />;
            case 'Servers': return <Database className="mr-2 h-4 w-4" />;
            case 'Credentials': return <Key className="mr-2 h-4 w-4" />;
            default: return <Activity className="mr-2 h-4 w-4" />;
        }
    };

    const renderButton = (tab: string) => (
        <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            disabled={disabled}
            className={`${activeTab === tab
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                } w-full text-left py-2 px-3 rounded-lg font-medium text-sm flex items-center transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
        >
            {getIcon(tab)}
            {tab}
        </button>
    );

    return (
        <div className="bg-white/80 backdrop-blur-md border-r border-gray-200 w-64 flex-shrink-0 h-full hidden md:flex flex-col overflow-hidden">
            <nav className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar" aria-label="Tabs">
                <div className="space-y-1">
                    <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Main</p>
                    {mainTabs.map(renderButton)}
                </div>
                
                <div className="space-y-1">
                    <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Protocols</p>
                    {protocolTabs.map(renderButton)}
                </div>

                <div className="space-y-1">
                    <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Analysis</p>
                    {analysisTabs.map(renderButton)}
                </div>
            </nav>
        </div>
    );
};
