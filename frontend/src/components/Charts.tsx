import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, AreaChart, Area, Legend, Brush } from 'recharts';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#84cc16', '#14b8a6'];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    // Calculate total packets for this timestamp
    const total = payload.reduce((sum, entry) => sum + (typeof entry.value === 'number' ? entry.value : 0), 0);
    
    // Sort payload by value descending
    const sortedPayload = [...payload].sort((a, b) => (b.value as number) - (a.value as number));

    return (
      <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700 p-3 rounded-lg shadow-xl z-50 min-w-[180px]">
        <div className="mb-2 border-b border-gray-700 pb-2">
          <p className="text-gray-300 text-xs font-medium">{label}</p>
          <p className="text-white text-sm font-bold mt-1">Total: {total.toLocaleString()}</p>
        </div>
        <div className="space-y-1">
          {sortedPayload.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                <span className="text-gray-300">{entry.name}</span>
              </span>
              <span className="text-white font-mono font-bold">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export function Charts({ analysisData, chartType }) {
  if (!analysisData) {
    return <div className="flex items-center justify-center h-full text-gray-400">No data available.</div>;
  }

  if (chartType === 'protocol') {
    if (!analysisData.protocols) {
      return <div className="flex items-center justify-center h-full text-gray-400">No protocol data available.</div>;
    }
    const protocolData = Object.entries(analysisData.protocols).map(([name, value]) => ({
      name,
      value,
    }));

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={protocolData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            fill="#8884d8"
            paddingAngle={5}
            dataKey="value"
            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
          >
            {protocolData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={CustomTooltip as any} />
        </PieChart>
      </ResponsiveContainer>
    );
  } else if (chartType === 'trafficOverTime') {
    if (!analysisData.traffic_over_time || analysisData.traffic_over_time.length === 0) {
      return <div className="flex items-center justify-center h-full text-gray-400">No traffic over time data available.</div>;
    }

    // Format time for better display on X-axis
    const formattedTrafficData = analysisData.traffic_over_time.map(item => ({
      ...item,
      time: new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }));

    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={formattedTrafficData}
          margin={{
            top: 10,
            right: 30,
            left: 0,
            bottom: 0,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="time"
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={CustomTooltip as any} />
          <Line
            type="linear"
            dataKey="packets"
            stroke="#6366f1"
            strokeWidth={3}
            dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
            activeDot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  } else if (chartType === 'stackedArea') {
    if (!analysisData.traffic_by_protocol || analysisData.traffic_by_protocol.length === 0) {
       return <div className="flex items-center justify-center h-full text-gray-400">No traffic data available.</div>;
    }

    const data = analysisData.traffic_by_protocol.map(item => ({
      ...item,
      time: new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }));

    // Extract all unique protocol keys from the data
    const protocols = Array.from(new Set(data.flatMap(item => Object.keys(item).filter(k => k !== 'time'))));

    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{
            top: 10,
            right: 30,
            left: 0,
            bottom: 0,
          }}
        >
          <defs>
            {protocols.map((proto, index) => (
              <linearGradient key={`grad-${proto}`} id={`color-${proto}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.8}/>
                <stop offset="95%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.1}/>
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="time"
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={CustomTooltip as any} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
          <Brush 
            dataKey="time" 
            height={30} 
            stroke="#6366f1" 
            fill="#f3f4f6"
            tickFormatter={() => ''}
          />
          {protocols.map((proto, index) => (
            <Area
              key={proto}
              type="linear"
              dataKey={proto}
              stackId="1"
              stroke={COLORS[index % COLORS.length]}
              fill={`url(#color-${proto})`}
              activeDot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return <div className="flex items-center justify-center h-full text-gray-400">Invalid chart type.</div>;
}
