import React, { useEffect, useState } from 'react';
import { FundDetail as FundDetailType } from '../types';
import { mfApiService } from '../services/api';
import { formatCurrency, formatDate, calculateReturn } from '../utils/formatters';
import NAVChart from './NAVChart';

interface FundDetailProps {
  schemeCode: string;
  onClose: () => void;
}

const FundDetail: React.FC<FundDetailProps> = ({ schemeCode, onClose }) => {
  const [fundData, setFundData] = useState<FundDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFundDetails = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await mfApiService.getFundDetails(schemeCode);
        setFundData(data);
      } catch (err) {
        setError('Failed to load fund details. Please try again.');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFundDetails();
  }, [schemeCode]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="text-slate-400 mt-4 text-center">Loading fund details...</p>
        </div>
      </div>
    );
  }

  if (error || !fundData) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-slate-800 rounded-2xl p-8 max-w-md shadow-2xl border border-slate-700">
          <h3 className="text-lg font-semibold text-red-400 mb-2">Error</h3>
          <p className="text-slate-400 mb-4">{error}</p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const latestNAV = fundData.data[0];
  const oldestNAV = fundData.data[fundData.data.length - 1];
  const returnValue = calculateReturn(
    parseFloat(oldestNAV.nav),
    parseFloat(latestNAV.nav)
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-900 rounded-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-700">
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700 p-6 flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {fundData.meta.scheme_name}
            </h2>
            <div className="flex gap-3 flex-wrap">
              <span className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-sm">
                {fundData.meta.scheme_type}
              </span>
              <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full text-sm">
                {fundData.meta.scheme_category}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-3xl font-light hover:bg-slate-800 rounded-full w-10 h-10 flex items-center justify-center transition-all"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-xl p-5 border border-indigo-500/20">
              <p className="text-sm text-indigo-300 mb-1">Current NAV</p>
              <p className="text-3xl font-bold text-white">
                {formatCurrency(parseFloat(latestNAV.nav))}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                as on {formatDate(latestNAV.date)}
              </p>
            </div>

            <div className={`bg-gradient-to-br rounded-xl p-5 border ${
              returnValue >= 0 
                ? 'from-emerald-500/20 to-green-500/20 border-emerald-500/20' 
                : 'from-red-500/20 to-rose-500/20 border-red-500/20'
            }`}>
              <p className={`text-sm mb-1 ${returnValue >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                Total Return
              </p>
              <p
                className={`text-3xl font-bold ${
                  returnValue >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {returnValue >= 0 ? '+' : ''}{returnValue.toFixed(2)}%
              </p>
              <p className="text-xs text-slate-400 mt-1">Since inception</p>
            </div>

            <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 rounded-xl p-5 border border-slate-600/50">
              <p className="text-sm text-slate-300 mb-1">Scheme Code</p>
              <p className="text-3xl font-bold text-white">
                {fundData.meta.scheme_code}
              </p>
              <p className="text-xs text-slate-400 mt-1">Unique identifier</p>
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              NAV History (Last 365 Days)
            </h3>
            <NAVChart data={fundData.data.slice(0, 365).reverse()} />
          </div>

          <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Recent NAV Values
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-700">
                <thead className="bg-slate-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      NAV
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {fundData.data.slice(0, 30).map((item, index) => {
                    const prevNAV =
                      index < fundData.data.length - 1
                        ? parseFloat(fundData.data[index + 1].nav)
                        : parseFloat(item.nav);
                    const change = parseFloat(item.nav) - prevNAV;
                    const changePercent = (change / prevNAV) * 100;

                    return (
                      <tr key={item.date} className="hover:bg-slate-800/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                          {formatDate(item.date)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          {formatCurrency(parseFloat(item.nav))}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span
                            className={
                              change >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }
                          >
                            {change >= 0 ? '+' : ''}
                            {formatCurrency(change)} ({changePercent.toFixed(2)}%)
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FundDetail;
