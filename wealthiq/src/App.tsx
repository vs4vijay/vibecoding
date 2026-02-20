import { useState, useEffect, useMemo } from 'react';
import { MutualFund, FundDetail as FundDetailType } from './types';
import { mfApiService } from './services/api';
import { formatCurrency } from './utils/formatters';

type Tab = 'explorer' | 'suggest' | 'portfolio';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('explorer');
  const [allFunds, setAllFunds] = useState<MutualFund[]>([]);
  const [fundPrices, setFundPrices] = useState<Record<string, string>>({});
  const [fundDetailsCache, setFundDetailsCache] = useState<Record<string, FundDetailType>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFund, setSelectedFund] = useState<FundDetailType | null>(null);

  useEffect(() => {
    const fetchAllFunds = async () => {
      try {
        setIsLoading(true);
        const funds = await mfApiService.getAllFunds();
        setAllFunds(funds);
        
        const prices: Record<string, string> = {};
        const sampleFunds = funds.slice(0, 100);
        await Promise.all(
          sampleFunds.map(async (fund) => {
            try {
              const details = await mfApiService.getFundDetails(fund.schemeCode);
              prices[fund.schemeCode] = details.data[0]?.nav || '';
              setFundDetailsCache(prev => ({ ...prev, [fund.schemeCode]: details }));
            } catch (e) {}
          })
        );
        setFundPrices(prices);
      } catch (error) {
        console.error('Error fetching funds:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllFunds();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-lg">W</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">WealthIQ</h1>
                <p className="text-xs text-gray-500">Mutual Fund Analytics</p>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('explorer')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'explorer' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Funds Explorer
              </button>
              <button
                onClick={() => setActiveTab('suggest')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'suggest' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Suggest Funds
              </button>
              <button
                onClick={() => setActiveTab('portfolio')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'portfolio' 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                My Portfolio
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              {allFunds.length.toLocaleString()} funds
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'explorer' && (
          <FundsExplorer 
            funds={allFunds} 
            prices={fundPrices} 
            isLoading={isLoading}
            onViewDetails={(code) => {
              if (fundDetailsCache[code]) {
                setSelectedFund(fundDetailsCache[code]);
              }
            }}
          />
        )}
        {activeTab === 'suggest' && (
          <SuggestFunds 
            funds={allFunds} 
            prices={fundPrices}
            fundDetails={fundDetailsCache}
            isLoading={isLoading}
            onViewDetails={(code) => {
              if (fundDetailsCache[code]) {
                setSelectedFund(fundDetailsCache[code]);
              }
            }}
          />
        )}
        {activeTab === 'portfolio' && (
          <Portfolio />
        )}
      </main>

      {selectedFund && (
        <FundModal fund={selectedFund} onClose={() => setSelectedFund(null)} />
      )}

      <footer className="bg-white border-t border-gray-200 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-sm text-gray-500">
          Data provided by <a href="https://www.mfapi.in" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">MFapi.in</a> • For informational purposes only
        </div>
      </footer>
    </div>
  );
}

interface FundsExplorerProps {
  funds: MutualFund[];
  prices: Record<string, string>;
  isLoading: boolean;
  onViewDetails: (code: string) => void;
}

function FundsExplorer({ funds, prices, isLoading, onViewDetails }: FundsExplorerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MutualFund; direction: 'asc' | 'desc' } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    code: '',
    name: '',
    nav: '',
  });

  const categories = useMemo(() => {
    const cats = new Set(funds.map(f => {
      const name = f.schemeName.toLowerCase();
      if (name.includes('liquid')) return 'Liquid';
      if (name.includes('elss') || name.includes('tax')) return 'ELSS';
      if (name.includes('debt') || name.includes('bond') || name.includes('fixed income')) return 'Debt';
      if (name.includes('hybrid') || name.includes('balanced')) return 'Hybrid';
      if (name.includes('index') || name.includes('nifty') || name.includes('sensex')) return 'Index';
      if (name.includes('equity') || name.includes('growth')) return 'Equity';
      return 'Other';
    }));
    return ['All', ...Array.from(cats).sort()];
  }, [funds]);

  const getCategory = (fundName: string) => {
    const name = fundName.toLowerCase();
    if (name.includes('liquid')) return 'Liquid';
    if (name.includes('elss') || name.includes('tax')) return 'ELSS';
    if (name.includes('debt') || name.includes('bond') || name.includes('fixed income')) return 'Debt';
    if (name.includes('hybrid') || name.includes('balanced')) return 'Hybrid';
    if (name.includes('index') || name.includes('nifty') || name.includes('sensex')) return 'Index';
    if (name.includes('equity') || name.includes('growth')) return 'Equity';
    return 'Other';
  };

  const filteredFunds = useMemo(() => {
    let result = [...funds];
    
    if (filters.code) {
      result = result.filter(f => f.schemeCode.toLowerCase().includes(filters.code.toLowerCase()));
    }
    if (filters.name) {
      result = result.filter(f => f.schemeName.toLowerCase().includes(filters.name.toLowerCase()));
    }
    if (searchTerm) {
      result = result.filter(f => 
        f.schemeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.schemeCode.includes(searchTerm)
      );
    }
    if (categoryFilter !== 'All') {
      result = result.filter(f => getCategory(f.schemeName) === categoryFilter);
    }

    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [funds, searchTerm, categoryFilter, sortConfig, filters]);

  const handleSort = (key: keyof MutualFund) => {
    setSortConfig(current => ({
      key,
      direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleSelectAll = () => {
    if (selectedRows.size === filteredFunds.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredFunds.map(f => f.schemeCode)));
    }
  };

  const handleSelectRow = (code: string) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(code)) {
      newSelected.delete(code);
    } else {
      newSelected.add(code);
    }
    setSelectedRows(newSelected);
  };

  const SortIcon = ({ column }: { column: keyof MutualFund }) => {
    if (sortConfig?.key !== column) return <span className="text-gray-300 ml-1">⇅</span>;
    return sortConfig.direction === 'asc' ? <span className="ml-1">↑</span> : <span className="ml-1">↓</span>;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Quick search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <div className="text-sm text-gray-500">
          {filteredFunds.length.toLocaleString()} funds
          {selectedRows.size > 0 && <span className="ml-2 text-blue-600">({selectedRows.size} selected)</span>}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === filteredFunds.length && filteredFunds.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600"
                  />
                </th>
                <th className="px-3 py-3">
                  <div className="flex items-center">
                    <span 
                      className="text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 px-2 py-1 rounded"
                      onClick={() => handleSort('schemeCode')}
                    >
                      Code <SortIcon column="schemeCode" />
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={filters.code}
                    onChange={(e) => setFilters(f => ({ ...f, code: e.target.value }))}
                    className="mt-1 w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </th>
                <th className="px-3 py-3">
                  <div className="flex items-center">
                    <span 
                      className="text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 px-2 py-1 rounded"
                      onClick={() => handleSort('schemeName')}
                    >
                      Fund Name <SortIcon column="schemeName" />
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={filters.name}
                    onChange={(e) => setFilters(f => ({ ...f, name: e.target.value }))}
                    className="mt-1 w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </th>
                <th className="px-3 py-3 text-left">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Category</span>
                </th>
                <th className="px-3 py-3 text-left">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">NAV (₹)</span>
                </th>
                <th className="px-3 py-3 text-right">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredFunds.slice(0, 100).map((fund) => (
                <tr key={fund.schemeCode} className={`hover:bg-blue-50 transition-colors ${selectedRows.has(fund.schemeCode) ? 'bg-blue-50' : ''}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(fund.schemeCode)}
                      onChange={() => handleSelectRow(fund.schemeCode)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600"
                    />
                  </td>
                  <td className="px-3 py-3 text-sm font-medium text-gray-900">{fund.schemeCode}</td>
                  <td className="px-3 py-3 text-sm text-gray-700 max-w-md truncate">{fund.schemeName}</td>
                  <td className="px-3 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      getCategory(fund.schemeName) === 'Equity' ? 'bg-purple-100 text-purple-700' :
                      getCategory(fund.schemeName) === 'Debt' ? 'bg-blue-100 text-blue-700' :
                      getCategory(fund.schemeName) === 'Hybrid' ? 'bg-green-100 text-green-700' :
                      getCategory(fund.schemeName) === 'Liquid' ? 'bg-yellow-100 text-yellow-700' :
                      getCategory(fund.schemeName) === 'ELSS' ? 'bg-red-100 text-red-700' :
                      getCategory(fund.schemeName) === 'Index' ? 'bg-cyan-100 text-cyan-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {getCategory(fund.schemeName)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm font-semibold text-gray-900">
                    {prices[fund.schemeCode] ? formatCurrency(parseFloat(prices[fund.schemeCode])) : '-'}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => onViewDetails(fund.schemeCode)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filteredFunds.length > 100 && (
        <div className="p-3 border-t border-gray-200 text-center text-sm text-gray-500">
          Showing first 100 of {filteredFunds.length.toLocaleString()} results
        </div>
      )}
    </div>
  );
}

interface SuggestFundsProps {
  funds: MutualFund[];
  prices: Record<string, string>;
  fundDetails: Record<string, FundDetailType>;
  isLoading: boolean;
  onViewDetails: (code: string) => void;
}

function SuggestFunds({ funds, prices, fundDetails, isLoading, onViewDetails }: SuggestFundsProps) {
  const [investmentAmount, setInvestmentAmount] = useState<string>('10000');
  const [riskProfile, setRiskProfile] = useState<'low' | 'medium' | 'high'>('medium');
  const [suggestions, setSuggestions] = useState<{
    allocation: { category: string; amount: number; percentage: number; funds: MutualFund[] }[];
    totalExpected: number;
  } | null>(null);

  const calculateSuggestions = () => {
    const amount = parseFloat(investmentAmount) || 0;
    if (amount <= 0) return;

    const categoryAllocations: Record<string, { percentage: number; funds: MutualFund[] }> = {
      'Equity Large Cap': { percentage: 0, funds: [] },
      'Equity Mid Cap': { percentage: 0, funds: [] },
      'Equity Small Cap': { percentage: 0, funds: [] },
      'Debt': { percentage: 0, funds: [] },
      'Hybrid': { percentage: 0, funds: [] },
      'Liquid': { percentage: 0, funds: [] },
    };

    funds.forEach(fund => {
      const name = fund.schemeName.toLowerCase();
      const nav = prices[fund.schemeCode] ? parseFloat(prices[fund.schemeCode]) : 0;
      if (!nav) return;

      if (name.includes('liquid')) {
        categoryAllocations['Liquid'].funds.push(fund);
      } else if (name.includes('debt') || name.includes('bond') || name.includes('fixed income')) {
        categoryAllocations['Debt'].funds.push(fund);
      } else if (name.includes('hybrid') || name.includes('balanced')) {
        categoryAllocations['Hybrid'].funds.push(fund);
      } else if (name.includes('small cap')) {
        categoryAllocations['Equity Small Cap'].funds.push(fund);
      } else if (name.includes('mid cap')) {
        categoryAllocations['Equity Mid Cap'].funds.push(fund);
      } else if (name.includes('large cap') || name.includes('equity') || name.includes('growth')) {
        categoryAllocations['Equity Large Cap'].funds.push(fund);
      }
    });

    const riskAllocations = {
      low: { 'Equity Large Cap': 20, 'Debt': 50, 'Hybrid': 20, 'Liquid': 10 },
      medium: { 'Equity Large Cap': 35, 'Equity Mid Cap': 15, 'Debt': 30, 'Hybrid': 15, 'Liquid': 5 },
      high: { 'Equity Large Cap': 30, 'Equity Mid Cap': 20, 'Equity Small Cap': 15, 'Hybrid': 25, 'Debt': 10 },
    };

    const allocation = Object.entries(riskAllocations[riskProfile]).map(([category, percentage]) => ({
      category,
      percentage,
      amount: (amount * percentage) / 100,
      funds: categoryAllocations[category as keyof typeof categoryAllocations]?.funds.slice(0, 2) || [],
    })).filter(a => a.percentage > 0);

    const totalExpected = allocation.reduce((sum, a) => sum + a.amount, 0);

    setSuggestions({ allocation, totalExpected });
  };

  const getCategoryColor = (category: string) => {
    if (category.includes('Equity Large')) return 'bg-purple-100 text-purple-700 border-purple-200';
    if (category.includes('Equity Mid')) return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    if (category.includes('Equity Small')) return 'bg-pink-100 text-pink-700 border-pink-200';
    if (category.includes('Debt')) return 'bg-blue-100 text-blue-700 border-blue-200';
    if (category.includes('Hybrid')) return 'bg-green-100 text-green-700 border-green-200';
    return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Investment Parameters</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Investment Amount (₹)</label>
            <input
              type="number"
              value={investmentAmount}
              onChange={(e) => setInvestmentAmount(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Enter amount"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Risk Profile</label>
            <select
              value={riskProfile}
              onChange={(e) => setRiskProfile(e.target.value as 'low' | 'medium' | 'high')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
            >
              <option value="low">Low Risk - Conservative</option>
              <option value="medium">Medium Risk - Balanced</option>
              <option value="high">High Risk - Aggressive</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">&nbsp;</label>
            <button
              onClick={calculateSuggestions}
              disabled={isLoading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {isLoading ? 'Loading...' : 'Get Suggestions'}
            </button>
          </div>
        </div>

        {riskProfile === 'low' && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            <strong>Low Risk:</strong> Focus on capital preservation with higher allocation to debt funds and liquid instruments.
          </div>
        )}
        {riskProfile === 'medium' && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <strong>Medium Risk:</strong> Balanced approach with mix of equity for growth and debt for stability.
          </div>
        )}
        {riskProfile === 'high' && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
            <strong>High Risk:</strong> Aggressive growth strategy with higher equity exposure including mid and small cap.
          </div>
        )}
      </div>

      {suggestions && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Suggested Portfolio</h2>
            <div className="text-right">
              <p className="text-sm text-gray-500">Total Investment</p>
              <p className="text-2xl font-bold text-gray-900">₹{parseFloat(investmentAmount).toLocaleString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {suggestions.allocation.map((item) => (
              <div key={item.category} className={`p-4 rounded-xl border ${getCategoryColor(item.category)}`}>
                <div className="flex justify-between items-start mb-2">
                  <span className="font-semibold">{item.category}</span>
                  <span className="text-sm bg-white/50 px-2 py-1 rounded">{item.percentage}%</span>
                </div>
                <p className="text-2xl font-bold">₹{item.amount.toLocaleString()}</p>
                <p className="text-sm opacity-75">{item.funds.length} fund(s) suggested</p>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="font-semibold text-gray-900 mb-4">Recommended Funds</h3>
            <div className="space-y-3">
              {suggestions.allocation.flatMap(item => 
                item.funds.map(fund => {
                  const details = fundDetails[fund.schemeCode];
                  const nav = prices[fund.schemeCode];
                  const navChange = details?.data?.length > 1 
                    ? ((parseFloat(details.data[0].nav) - parseFloat(details.data[details.data.length - 1].nav)) / parseFloat(details.data[details.data.length - 1].nav) * 100)
                    : 0;
                  
                  return (
                    <div key={fund.schemeCode} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor(item.category)}`}>
                            {item.category}
                          </span>
                          <span className="font-medium text-gray-900">{fund.schemeName}</span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">Code: {fund.schemeCode}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900">{nav ? formatCurrency(parseFloat(nav)) : '-'}</p>
                        <p className={`text-sm ${navChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {navChange >= 0 ? '+' : ''}{navChange.toFixed(1)}% (all time)
                        </p>
                      </div>
                      <button
                        onClick={() => onViewDetails(fund.schemeCode)}
                        className="ml-4 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        View
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>Disclaimer:</strong> These are algorithmic suggestions based on historical data. 
              Please consult a financial advisor before making investment decisions. 
              Past performance does not guarantee future results.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Portfolio() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">My Portfolio</h2>
      <p className="text-gray-500 mb-4">Track and analyze your mutual fund investments</p>
      <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
        Add Holdings
      </button>
      <p className="text-sm text-gray-400 mt-6">Coming soon...</p>
    </div>
  );
}

interface FundModalProps {
  fund: FundDetailType;
  onClose: () => void;
}

function FundModal({ fund, onClose }: FundModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{fund.meta.scheme_name}</h2>
            <div className="flex gap-2 mt-2">
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs">{fund.meta.scheme_type}</span>
              <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs">{fund.meta.scheme_category}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-sm text-blue-600">Current NAV</p>
              <p className="text-2xl font-bold text-gray-900">₹{parseFloat(fund.data[0]?.nav || '0').toFixed(2)}</p>
              <p className="text-xs text-gray-500">{fund.data[0]?.date}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-sm text-green-600">Inception NAV</p>
              <p className="text-2xl font-bold text-gray-900">₹{parseFloat(fund.data[fund.data.length - 1]?.nav || '0').toFixed(2)}</p>
              <p className="text-xs text-gray-500">{fund.data[fund.data.length - 1]?.date}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600">Data Points</p>
              <p className="text-2xl font-bold text-gray-900">{fund.data.length}</p>
              <p className="text-xs text-gray-500">Records</p>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Recent NAV</h3>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-600">Date</th>
                    <th className="px-3 py-2 text-right text-gray-600">NAV (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {fund.data.slice(0, 30).map((item) => (
                    <tr key={item.date} className="hover:bg-white">
                      <td className="px-3 py-2 text-gray-700">{item.date}</td>
                      <td className="px-3 py-2 text-right font-medium">{parseFloat(item.nav).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
