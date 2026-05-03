interface JobStatsProps {
  stats: {
    total: number;
    pending: number;
    active: number;
    scheduled: number;
    failed: number;
  };
}

export function JobStats({ stats }: JobStatsProps) {
  const statCards = [
    {
      label: 'Total Jobs',
      value: stats.total,
      color: 'bg-blue-500',
      textColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Pending',
      value: stats.pending,
      color: 'bg-gray-500',
      textColor: 'text-gray-600',
      bgColor: 'bg-gray-50',
    },
    {
      label: 'Active',
      value: stats.active,
      color: 'bg-green-500',
      textColor: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      label: 'Scheduled',
      value: stats.scheduled,
      color: 'bg-yellow-500',
      textColor: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
    },
    {
      label: 'Failed',
      value: stats.failed,
      color: 'bg-red-500',
      textColor: 'text-red-600',
      bgColor: 'bg-red-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      {statCards.map((stat) => (
        <div
          key={stat.label}
          className={`${stat.bgColor} rounded-lg p-6 border border-gray-200`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{stat.label}</p>
              <p className={`text-3xl font-bold ${stat.textColor} mt-2`}>
                {stat.value}
              </p>
            </div>
            <div className={`w-3 h-3 rounded-full ${stat.color}`}></div>
          </div>
        </div>
      ))}
    </div>
  );
}
