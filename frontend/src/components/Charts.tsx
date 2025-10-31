import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#84cc16', '#14b8a6'];

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
            label={({ name, value }) => `${name}: ${value}`}
          >
            {protocolData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
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
            top: 5,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="packets" stroke="#8884d8" activeDot={{ r: 8 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return <div className="flex items-center justify-center h-full text-gray-400">Invalid chart type.</div>;
}
