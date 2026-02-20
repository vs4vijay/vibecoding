import React from 'react';
import { MutualFund } from '../types';
import FundCard from './FundCard';

interface FundListProps {
  funds: MutualFund[];
  onFundClick: (schemeCode: string) => void;
  isLoading?: boolean;
}

const FundList: React.FC<FundListProps> = ({
  funds,
  onFundClick,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (funds.length === 0) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-700/50 p-8 text-center">
        <svg className="w-16 h-16 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-slate-400">No mutual funds found matching your criteria.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {funds.map((fund) => (
        <FundCard key={fund.schemeCode} fund={fund} onClick={onFundClick} />
      ))}
    </div>
  );
};

export default FundList;
