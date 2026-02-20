export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return new Intl.DateFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

export const calculateReturn = (
  initialNAV: number,
  finalNAV: number
): number => {
  return ((finalNAV - initialNAV) / initialNAV) * 100;
};

export const getReturnColor = (returnValue: number): string => {
  if (returnValue > 0) return 'text-green-600';
  if (returnValue < 0) return 'text-red-600';
  return 'text-gray-600';
};
