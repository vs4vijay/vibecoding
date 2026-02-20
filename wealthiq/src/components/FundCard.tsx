import React from 'react';
import { MutualFund } from '../types';

interface FundCardProps {
  fund: MutualFund;
  onClick: (schemeCode: string) => void;
}

const FundCard: React.FC<FundCardProps> = ({ fund, onClick }) => {
  return (
    <div
      onClick={() => onClick(fund.schemeCode)}
      className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 hover:bg-slate-800 hover:shadow-xl transition-all cursor-pointer border border-slate-700/50 hover:border-indigo-500/50 group"
    >
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white mb-1 line-clamp-2 group-hover:text-indigo-300 transition-colors">
            {fund.schemeName}
          </h3>
          <p className="text-xs text-slate-500">Code: {fund.schemeCode}</p>
        </div>
        <button className="ml-2 text-indigo-400 hover:text-indigo-300 text-sm font-medium flex items-center gap-1 transition-colors">
          View 
          <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default FundCard;
