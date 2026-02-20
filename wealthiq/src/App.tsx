import { useState, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { MutualFund, FundDetail as FundDetailType, NAVData } from './types';
import { mfApiService } from './services/api';
import { formatCurrency } from './utils/formatters';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

type Tab = 'explorer' | 'suggest' | 'compare' | 'sip' | 'portfolio' | 'details';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('explorer');
  const [allFunds, setAllFunds] = useState<MutualFund[]>([]);
  const [fundPrices, setFundPrices] = useState<Record<string, string>>({});
  const [fundDetailsCache, setFundDetailsCache] = useState<Record<string, FundDetailType>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFundCode, setSelectedFundCode] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const saved = localStorage.getItem('wealthiq_watchlist');
    return saved ? JSON.parse(saved) : [];
  });
  const [recentViews, setRecentViews] = useState<string[]>(() => {
    const saved = localStorage.getItem('wealthiq_recent');
    return saved ? JSON.parse(saved) : [];
  });
  const [compareFunds, setCompareFunds] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem('wealthiq_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem('wealthiq_recent', JSON.stringify(recentViews.slice(0, 10)));
  }, [recentViews]);

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

  const handleViewDetails = (code: string) => {
    if (!recentViews.includes(code)) {
      setRecentViews(prev => [code, ...prev].slice(0, 10));
    }
    setSelectedFundCode(code);
    setActiveTab('details');
  };

  const toggleWatchlist = (code: string) => {
    setWatchlist(prev => 
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const addToCompare = (code: string) => {
    if (!compareFunds.includes(code) && compareFunds.length < 3) {
      setCompareFunds(prev => [...prev, code]);
    }
  };

  const removeFromCompare = (code: string) => {
    setCompareFunds(prev => prev.filter(c => c !== code));
  };

  const selectedFund = selectedFundCode ? fundDetailsCache[selectedFundCode] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('explorer')}>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-lg">W</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">WealthIQ</h1>
                <p className="text-xs text-gray-500">Mutual Fund Analytics</p>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              {[
                { id: 'explorer', label: 'Explorer' },
                { id: 'compare', label: 'Compare' },
                { id: 'sip', label: 'SIP Calculator' },
                { id: 'suggest', label: 'Suggest' },
                { id: 'portfolio', label: 'Portfolio' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as Tab)}
                  className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    activeTab === tab.id 
                      ? 'bg-white text-blue-600 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
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
            watchlist={watchlist}
            recentViews={recentViews}
            onViewDetails={handleViewDetails}
            onToggleWatchlist={toggleWatchlist}
            onAddToCompare={addToCompare}
          />
        )}
        {activeTab === 'suggest' && (
          <SuggestFunds 
            funds={allFunds} 
            prices={fundPrices}
            fundDetails={fundDetailsCache}
            isLoading={isLoading}
            onViewDetails={handleViewDetails}
          />
        )}
        {activeTab === 'compare' && (
          <CompareFunds 
            funds={allFunds}
            prices={fundPrices}
            fundDetails={fundDetailsCache}
            compareFunds={compareFunds}
            onRemove={removeFromCompare}
            onAddMore={() => setActiveTab('explorer')}
            onViewDetails={handleViewDetails}
          />
        )}
        {activeTab === 'sip' && (
          <SIPCalculator funds={allFunds} prices={fundPrices} fundDetails={fundDetailsCache} />
        )}
        {activeTab === 'portfolio' && (
          <Portfolio 
            watchlist={watchlist}
            recentViews={recentViews}
            funds={allFunds}
            prices={fundPrices}
            fundDetails={fundDetailsCache}
            onViewDetails={handleViewDetails}
            onToggleWatchlist={toggleWatchlist}
          />
        )}
        {activeTab === 'details' && selectedFund && (
          <FundDetailsPage 
            fund={selectedFund}
            fundCode={selectedFundCode!}
            onBack={() => { setActiveTab('explorer'); setSelectedFundCode(null); }}
            isWatchlisted={watchlist.includes(selectedFundCode!)}
            onToggleWatchlist={() => toggleWatchlist(selectedFundCode!)}
            onAddToCompare={() => addToCompare(selectedFundCode!)}
          />
        )}
      </main>

      <footer className="bg-white border-t border-gray-200 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-sm text-gray-500">
          Data provided by <a href="https://www.mfapi.in" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">MFapi.in</a> • For informational purposes only
        </div>
      </footer>
    </div>
  );
}

function FundsExplorer({ funds, prices, isLoading, watchlist, recentViews, onViewDetails, onToggleWatchlist, onAddToCompare }: {
  funds: MutualFund[];
  prices: Record<string, string>;
  isLoading: boolean;
  watchlist: string[];
  recentViews: string[];
  onViewDetails: (code: string) => void;
  onToggleWatchlist: (code: string) => void;
  onAddToCompare: (code: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MutualFund; direction: 'asc' | 'desc' } | null>(null);
  const [columnFilters, setColumnFilters] = useState({ code: '', name: '' });

  const categories = useMemo(() => {
    const cats = new Set(funds.map(f => {
      const name = String(f.schemeName).toLowerCase();
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
    const name = String(fundName).toLowerCase();
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
    const searchLower = searchTerm.toLowerCase();
    if (searchLower) {
      result = result.filter(f => 
        String(f.schemeName).toLowerCase().includes(searchLower) ||
        String(f.schemeCode).toLowerCase().includes(searchLower)
      );
    }
    if (columnFilters.code) {
      result = result.filter(f => String(f.schemeCode).toLowerCase().includes(columnFilters.code.toLowerCase()));
    }
    if (columnFilters.name) {
      result = result.filter(f => String(f.schemeName).toLowerCase().includes(columnFilters.name.toLowerCase()));
    }
    if (categoryFilter !== 'All') {
      result = result.filter(f => getCategory(f.schemeName) === categoryFilter);
    }
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const aVal = String(a[sortConfig.key]);
        const bVal = String(b[sortConfig.key]);
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [funds, searchTerm, categoryFilter, sortConfig, columnFilters]);

  const handleSort = (key: keyof MutualFund) => {
    setSortConfig(current => ({
      key,
      direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
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
            placeholder="Search funds..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <div className="text-sm text-gray-500">
          {filteredFunds.length.toLocaleString()} funds
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
                <th className="px-3 py-3 text-left w-24">
                  <span className="text-xs font-semibold text-gray-600 uppercase">Watch</span>
                </th>
                <th className="px-3 py-3">
                  <div className="flex items-center">
                    <span className="text-xs font-semibold text-gray-600 uppercase cursor-pointer" onClick={() => handleSort('schemeCode')}>
                      Code <SortIcon column="schemeCode" />
                    </span>
                  </div>
                  <input type="text" placeholder="Filter..." value={columnFilters.code} onChange={(e) => setColumnFilters(f => ({ ...f, code: e.target.value }))} className="mt-1 w-full text-xs px-2 py-1 border rounded" />
                </th>
                <th className="px-3 py-3">
                  <div className="flex items-center">
                    <span className="text-xs font-semibold text-gray-600 uppercase cursor-pointer" onClick={() => handleSort('schemeName')}>
                      Fund Name <SortIcon column="schemeName" />
                    </span>
                  </div>
                  <input type="text" placeholder="Filter..." value={columnFilters.name} onChange={(e) => setColumnFilters(f => ({ ...f, name: e.target.value }))} className="mt-1 w-full text-xs px-2 py-1 border rounded" />
                </th>
                <th className="px-3 py-3 text-left"><span className="text-xs font-semibold text-gray-600 uppercase">Category</span></th>
                <th className="px-3 py-3 text-left"><span className="text-xs font-semibold text-gray-600 uppercase">NAV (₹)</span></th>
                <th className="px-3 py-3 text-right"><span className="text-xs font-semibold text-gray-600 uppercase">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredFunds.slice(0, 100).map((fund) => (
                <tr key={fund.schemeCode} className="hover:bg-blue-50 transition-colors">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => onToggleWatchlist(fund.schemeCode)} className={`text-lg ${watchlist.includes(fund.schemeCode) ? 'text-yellow-500' : 'text-gray-300'}`}>
                        ★
                      </button>
                      <button onClick={() => onAddToCompare(fund.schemeCode)} className="text-gray-400 hover:text-blue-500" title="Compare">
                        ⚖
                      </button>
                    </div>
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
                    <button onClick={() => onViewDetails(fund.schemeCode)} className="text-blue-600 hover:text-blue-800 text-sm font-medium">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompareFunds({ funds, prices, fundDetails, compareFunds, onRemove, onAddMore, onViewDetails }: {
  funds: MutualFund[];
  prices: Record<string, string>;
  fundDetails: Record<string, FundDetailType>;
  compareFunds: string[];
  onRemove: (code: string) => void;
  onAddMore: () => void;
  onViewDetails: (code: string) => void;
}) {
  const getReturns = (code: string, period: number) => {
    const details = fundDetails[code];
    if (!details || details.data.length < period) return null;
    const current = parseFloat(details.data[0].nav);
    const past = parseFloat(details.data[Math.min(period - 1, details.data.length - 1)].nav);
    return ((current - past) / past) * 100;
  };

  const compareData = compareFunds.map(code => {
    const fund = funds.find(f => String(f.schemeCode) === String(code));
    const details = fundDetails[code];
    return {
      code,
      name: fund?.schemeName || code,
      nav: prices[code] || '-',
      returns1M: getReturns(code, 22),
      returns3M: getReturns(code, 66),
      returns6M: getReturns(code, 132),
      returns1Y: getReturns(code, 264),
      returnsAll: details?.data?.length ? ((parseFloat(details.data[0].nav) - parseFloat(details.data[details.data.length - 1].nav)) / parseFloat(details.data[details.data.length - 1].nav)) * 100 : null,
      details,
    };
  });

  const getCategory = (fundName: string) => {
    const name = String(fundName).toLowerCase();
    if (name.includes('liquid')) return 'Liquid';
    if (name.includes('elss') || name.includes('tax')) return 'ELSS';
    if (name.includes('debt') || name.includes('bond')) return 'Debt';
    if (name.includes('hybrid') || name.includes('balanced')) return 'Hybrid';
    if (name.includes('index')) return 'Index';
    if (name.includes('equity') || name.includes('growth')) return 'Equity';
    return 'Other';
  };

  const chartData = {
    labels: compareData.map(c => c.name.substring(0, 20) + '...'),
    datasets: compareData.map((fund, idx) => {
      const colors = ['#3B82F6', '#10B981', '#F59E0B'];
      const details = fundDetails[fund.code];
      if (!details) return null;
      const navData = details.data.slice(0, 365).reverse();
      return {
        label: fund.name,
        data: navData.map(d => parseFloat(d.nav)),
        borderColor: colors[idx],
        backgroundColor: colors[idx] + '20',
        fill: false,
        tension: 0.4,
      };
    }).filter(Boolean),
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' as const } },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: '#f3f4f6' } },
    },
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Compare Funds</h2>
          <button onClick={onAddMore} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            + Add Fund
          </button>
        </div>

        {compareFunds.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No funds selected for comparison.</p>
            <button onClick={onAddMore} className="mt-2 text-blue-600 hover:underline">Add funds to compare</button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600"></th>
                    {compareData.map(c => (
                      <th key={c.code} className="px-3 py-2 text-left">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-900 truncate max-w-[150px]">{c.name}</span>
                          <button onClick={() => onRemove(c.code)} className="ml-2 text-red-500 hover:text-red-700">×</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="px-3 py-2 font-medium text-gray-600">Category</td>
                    {compareData.map(c => <td key={c.code} className="px-3 py-2">{getCategory(c.name)}</td>)}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-gray-600">NAV</td>
                    {compareData.map(c => <td key={c.code} className="px-3 py-2 font-semibold">₹{c.nav}</td>)}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-gray-600">1 Month</td>
                    {compareData.map(c => <td key={c.code} className={`px-3 py-2 ${c.returns1M && c.returns1M >= 0 ? 'text-green-600' : 'text-red-600'}`}>{c.returns1M ? c.returns1M.toFixed(1) + '%' : '-'}</td>)}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-gray-600">3 Months</td>
                    {compareData.map(c => <td key={c.code} className={`px-3 py-2 ${c.returns3M && c.returns3M >= 0 ? 'text-green-600' : 'text-red-600'}`}>{c.returns3M ? c.returns3M.toFixed(1) + '%' : '-'}</td>)}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-gray-600">6 Months</td>
                    {compareData.map(c => <td key={c.code} className={`px-3 py-2 ${c.returns6M && c.returns6M >= 0 ? 'text-green-600' : 'text-red-600'}`}>{c.returns6M ? c.returns6M.toFixed(1) + '%' : '-'}</td>)}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-gray-600">1 Year</td>
                    {compareData.map(c => <td key={c.code} className={`px-3 py-2 ${c.returns1Y && c.returns1Y >= 0 ? 'text-green-600' : 'text-red-600'}`}>{c.returns1Y ? c.returns1Y.toFixed(1) + '%' : '-'}</td>)}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-gray-600">All Time</td>
                    {compareData.map(c => <td key={c.code} className={`px-3 py-2 ${c.returnsAll && c.returnsAll >= 0 ? 'text-green-600' : 'text-red-600'}`}>{c.returnsAll ? c.returnsAll.toFixed(1) + '%' : '-'}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>

            {chartData.datasets[0] && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium text-gray-700 mb-3">NAV History Comparison</h3>
                <div style={{ height: '300px' }}>
                  <Line data={chartData} options={chartOptions} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SIPCalculator({ funds, prices, fundDetails }: {
  funds: MutualFund[];
  prices: Record<string, string>;
  fundDetails: Record<string, FundDetailType>;
}) {
  const [selectedFund, setSelectedFund] = useState<string>('');
  const [monthlyInvestment, setMonthlyInvestment] = useState<string>('5000');
  const [years, setYears] = useState<string>('10');
  const [expectedReturn, setExpectedReturn] = useState<string>('12');

  const calculateSIP = () => {
    const P = parseFloat(monthlyInvestment) || 0;
    const n = (parseFloat(years) || 0) * 12;
    const r = (parseFloat(expectedReturn) || 0) / 12 / 100;
    
    if (P <= 0 || n <= 0) return null;
    
    const futureValue = P * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
    const totalInvested = P * n;
    const returns = futureValue - totalInvested;
    
    return { futureValue, totalInvested, returns };
  };

  const result = calculateSIP();
  const selectedDetails = selectedFund ? fundDetails[selectedFund] : null;
  const historicalReturn = selectedDetails?.data?.length ? ((parseFloat(selectedDetails.data[0].nav) - parseFloat(selectedDetails.data[selectedDetails.data.length - 1].nav)) / parseFloat(selectedDetails.data[selectedDetails.data.length - 1].nav)) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">SIP Calculator</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Fund</label>
            <select value={selectedFund} onChange={(e) => setSelectedFund(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
              <option value="">-- Select Fund --</option>
              {funds.slice(0, 50).map(f => (
                <option key={f.schemeCode} value={f.schemeCode}>{f.schemeName}</option>
              ))}
            </select>
            {selectedFund && prices[selectedFund] && (
              <p className="text-sm text-gray-500 mt-1">Current NAV: ₹{prices[selectedFund]}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Monthly Investment (₹)</label>
            <input type="number" value={monthlyInvestment} onChange={(e) => setMonthlyInvestment(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Investment Period (Years)</label>
            <input type="number" value={years} onChange={(e) => setYears(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Expected Return (% p.a.)</label>
            <input type="number" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            {historicalReturn !== null && (
              <p className="text-xs text-gray-500 mt-1">Fund avg: {historicalReturn.toFixed(1)}%</p>
            )}
          </div>
        </div>

        {result && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-blue-50 rounded-xl p-6 text-center">
              <p className="text-sm text-blue-600 mb-1">Total Invested</p>
              <p className="text-3xl font-bold text-gray-900">₹{result.totalInvested.toLocaleString()}</p>
            </div>
            <div className="bg-green-50 rounded-xl p-6 text-center">
              <p className="text-sm text-green-600 mb-1">Est. Returns</p>
              <p className="text-3xl font-bold text-green-700">₹{result.returns.toLocaleString()}</p>
            </div>
            <div className="bg-purple-50 rounded-xl p-6 text-center">
              <p className="text-sm text-purple-600 mb-1">Total Value</p>
              <p className="text-3xl font-bold text-purple-700">₹{result.futureValue.toLocaleString()}</p>
              <p className="text-sm text-purple-600 mt-1">{((result.returns / result.totalInvested) * 100).toFixed(0)}% gains</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestFunds({ funds, prices, fundDetails, isLoading, onViewDetails }: {
  funds: MutualFund[];
  prices: Record<string, string>;
  fundDetails: Record<string, FundDetailType>;
  isLoading: boolean;
  onViewDetails: (code: string) => void;
}) {
  const [investmentAmount, setInvestmentAmount] = useState<string>('10000');
  const [riskProfile, setRiskProfile] = useState<'low' | 'medium' | 'high'>('medium');
  const [suggestions, setSuggestions] = useState<{
    allocation: { category: string; amount: number; percentage: number; funds: MutualFund[] }[];
  } | null>(null);

  const calculateSuggestions = () => {
    const amount = parseFloat(investmentAmount) || 0;
    if (amount <= 0) return;

    const categoryFunds: Record<string, MutualFund[]> = {
      'Equity Large Cap': [], 'Equity Mid Cap': [], 'Equity Small Cap': [],
      'Debt': [], 'Hybrid': [], 'Liquid': [],
    };

    funds.forEach(fund => {
      const name = String(fund.schemeName).toLowerCase();
      const nav = prices[fund.schemeCode];
      if (!nav) return;
      if (name.includes('liquid')) categoryFunds['Liquid'].push(fund);
      else if (name.includes('debt') || name.includes('bond')) categoryFunds['Debt'].push(fund);
      else if (name.includes('hybrid') || name.includes('balanced')) categoryFunds['Hybrid'].push(fund);
      else if (name.includes('small cap')) categoryFunds['Equity Small Cap'].push(fund);
      else if (name.includes('mid cap')) categoryFunds['Equity Mid Cap'].push(fund);
      else categoryFunds['Equity Large Cap'].push(fund);
    });

    const allocations = {
      low: { 'Equity Large Cap': 20, 'Debt': 50, 'Hybrid': 20, 'Liquid': 10 },
      medium: { 'Equity Large Cap': 35, 'Equity Mid Cap': 15, 'Debt': 30, 'Hybrid': 15, 'Liquid': 5 },
      high: { 'Equity Large Cap': 30, 'Equity Mid Cap': 20, 'Equity Small Cap': 15, 'Hybrid': 25, 'Debt': 10 },
    };

    const result = Object.entries(allocations[riskProfile]).map(([category, pct]) => ({
      category,
      percentage: pct,
      amount: (amount * pct) / 100,
      funds: categoryFunds[category as keyof typeof categoryFunds]?.slice(0, 2) || [],
    })).filter(a => a.percentage > 0);

    setSuggestions({ allocation: result });
  };

  const getColor = (cat: string) => {
    if (cat.includes('Large')) return 'bg-purple-100 text-purple-700';
    if (cat.includes('Mid')) return 'bg-indigo-100 text-indigo-700';
    if (cat.includes('Small')) return 'bg-pink-100 text-pink-700';
    if (cat.includes('Debt')) return 'bg-blue-100 text-blue-700';
    if (cat.includes('Hybrid')) return 'bg-green-100 text-green-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Investment Parameters</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Investment Amount (₹)</label>
            <input type="number" value={investmentAmount} onChange={(e) => setInvestmentAmount(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="Enter amount" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Risk Profile</label>
            <select value={riskProfile} onChange={(e) => setRiskProfile(e.target.value as 'low' | 'medium' | 'high')} className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white">
              <option value="low">Low Risk - Conservative</option>
              <option value="medium">Medium Risk - Balanced</option>
              <option value="high">High Risk - Aggressive</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">&nbsp;</label>
            <button onClick={calculateSuggestions} disabled={isLoading} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
              {isLoading ? 'Loading...' : 'Get Suggestions'}
            </button>
          </div>
        </div>
        {riskProfile === 'low' && <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700"><strong>Low Risk:</strong> Focus on capital preservation.</div>}
        {riskProfile === 'medium' && <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700"><strong>Medium Risk:</strong> Balanced approach with mix of equity and debt.</div>}
        {riskProfile === 'high' && <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700"><strong>High Risk:</strong> Aggressive growth with higher equity exposure.</div>}
      </div>

      {suggestions && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Suggested Portfolio</h2>
            <p className="text-2xl font-bold text-gray-900">₹{parseFloat(investmentAmount).toLocaleString()}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {suggestions.allocation.map(item => (
              <div key={item.category} className={`p-3 rounded-lg ${getColor(item.category)}`}>
                <p className="text-xs font-medium">{item.category}</p>
                <p className="text-lg font-bold">₹{item.amount.toLocaleString()}</p>
                <p className="text-xs opacity-75">{item.percentage}%</p>
              </div>
            ))}
          </div>
          <div className="border-t pt-4">
            <h3 className="font-medium text-gray-900 mb-3">Recommended Funds</h3>
            <div className="space-y-2">
              {suggestions.allocation.flatMap(item => item.funds.map(fund => (
                <div key={fund.schemeCode} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <span className={`px-2 py-0.5 rounded text-xs ${getColor(item.category)}`}>{item.category}</span>
                    <p className="font-medium text-gray-900 mt-1">{fund.schemeName}</p>
                  </div>
                  <button onClick={() => onViewDetails(fund.schemeCode)} className="text-blue-600 hover:underline text-sm">View</button>
                </div>
              )))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Portfolio({ watchlist, recentViews, funds, prices, fundDetails, onViewDetails, onToggleWatchlist }: {
  watchlist: string[];
  recentViews: string[];
  funds: MutualFund[];
  prices: Record<string, string>;
  fundDetails: Record<string, FundDetailType>;
  onViewDetails: (code: string) => void;
  onToggleWatchlist: (code: string) => void;
}) {
  const [activeSection, setActiveSection] = useState<'watchlist' | 'recent'>('watchlist');

  const getFundData = (code: string) => {
    const fund = funds.find(f => String(f.schemeCode) === String(code));
    const details = fundDetails[code];
    return { fund, details };
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex gap-2 mb-6">
          <button onClick={() => setActiveSection('watchlist')} className={`px-4 py-2 rounded-lg font-medium ${activeSection === 'watchlist' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            ★ Watchlist ({watchlist.length})
          </button>
          <button onClick={() => setActiveSection('recent')} className={`px-4 py-2 rounded-lg font-medium ${activeSection === 'recent' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            🕐 Recent Views ({recentViews.length})
          </button>
        </div>

        {(activeSection === 'watchlist' ? watchlist : recentViews).length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>{activeSection === 'watchlist' ? 'No funds in watchlist' : 'No recently viewed funds'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(activeSection === 'watchlist' ? watchlist : recentViews).map(code => {
              const { fund, details } = getFundData(code);
              if (!fund) return null;
              const nav = prices[code];
              const returns = details?.data?.length ? ((parseFloat(details.data[0].nav) - parseFloat(details.data[details.data.length - 1].nav)) / parseFloat(details.data[details.data.length - 1].nav)) * 100 : null;
              
              return (
                <div key={code} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <button onClick={() => onToggleWatchlist(code)} className={`text-lg ${watchlist.includes(code) ? 'text-yellow-500' : 'text-gray-300'}`}>★</button>
                      <span className="font-medium text-gray-900">{fund.schemeName}</span>
                    </div>
                    <p className="text-sm text-gray-500">Code: {fund.schemeCode}</p>
                  </div>
                  <div className="text-right mr-4">
                    <p className="font-semibold text-gray-900">{nav ? formatCurrency(parseFloat(nav)) : '-'}</p>
                    {returns !== null && <p className={`text-sm ${returns >= 0 ? 'text-green-600' : 'text-red-600'}`}>{returns >= 0 ? '+' : ''}{returns.toFixed(1)}%</p>}
                  </div>
                  <button onClick={() => onViewDetails(code)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">View</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FundDetailsPage({ fund, fundCode, onBack, isWatchlisted, onToggleWatchlist, onAddToCompare }: {
  fund: FundDetailType;
  fundCode: string;
  onBack: () => void;
  isWatchlisted: boolean;
  onToggleWatchlist: () => void;
  onAddToCompare: () => void;
}) {
  const [chartRange, setChartRange] = useState<number>(365);

  const navData = fund.data.slice(0, chartRange).reverse();
  
  const calculateReturns = (days: number) => {
    if (fund.data.length < days) return null;
    const current = parseFloat(fund.data[0].nav);
    const past = parseFloat(fund.data[Math.min(days - 1, fund.data.length - 1)].nav);
    return ((current - past) / past) * 100;
  };

  const returns1M = calculateReturns(22);
  const returns3M = calculateReturns(66);
  const returns6M = calculateReturns(132);
  const returns1Y = calculateReturns(264);
  const returnsAll = fund.data.length > 1 ? ((parseFloat(fund.data[0].nav) - parseFloat(fund.data[fund.data.length - 1].nav)) / parseFloat(fund.data[fund.data.length - 1].nav)) * 100 : null;

  const chartData = {
    labels: navData.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    }),
    datasets: [{
      label: 'NAV',
      data: navData.map(d => parseFloat(d.nav)),
      borderColor: '#3B82F6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 6,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'index' as const, intersect: false },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
      y: { grid: { color: '#f3f4f6' } },
    },
    interaction: { mode: 'nearest' as const, axis: 'x' as const, intersect: false },
  };

  const getCategory = () => {
    const name = String(fund.meta.scheme_name).toLowerCase();
    if (name.includes('liquid')) return 'Liquid';
    if (name.includes('elss') || name.includes('tax')) return 'ELSS';
    if (name.includes('debt') || name.includes('bond')) return 'Debt';
    if (name.includes('hybrid') || name.includes('balanced')) return 'Hybrid';
    if (name.includes('index')) return 'Index';
    return 'Equity';
  };

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
        ← Back to Explorer
      </button>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{fund.meta.scheme_name}</h1>
            <div className="flex gap-2 mt-2">
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm">{fund.meta.scheme_type}</span>
              <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-sm">{fund.meta.scheme_category}</span>
              <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm">{getCategory()}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onToggleWatchlist} className={`px-4 py-2 rounded-lg border ${isWatchlisted ? 'bg-yellow-50 border-yellow-300 text-yellow-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              {isWatchlisted ? '★ In Watchlist' : '☆ Add to Watchlist'}
            </button>
            <button onClick={onAddToCompare} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
              ⚖ Compare
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-blue-50 rounded-lg p-4 text-center">
            <p className="text-sm text-blue-600">Current NAV</p>
            <p className="text-2xl font-bold text-gray-900">₹{parseFloat(fund.data[0]?.nav || '0').toFixed(2)}</p>
            <p className="text-xs text-gray-500">{fund.data[0]?.date}</p>
          </div>
          <div className={`rounded-lg p-4 text-center ${returns1M !== null && returns1M >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-sm text-gray-600">1 Month</p>
            <p className={`text-xl font-bold ${returns1M !== null && returns1M >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {returns1M !== null ? returns1M.toFixed(1) + '%' : '-'}
            </p>
          </div>
          <div className={`rounded-lg p-4 text-center ${returns3M !== null && returns3M >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-sm text-gray-600">3 Months</p>
            <p className={`text-xl font-bold ${returns3M !== null && returns3M >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {returns3M !== null ? returns3M.toFixed(1) + '%' : '-'}
            </p>
          </div>
          <div className={`rounded-lg p-4 text-center ${returns1Y !== null && returns1Y >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-sm text-gray-600">1 Year</p>
            <p className={`text-xl font-bold ${returns1Y !== null && returns1Y >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {returns1Y !== null ? returns1Y.toFixed(1) + '%' : '-'}
            </p>
          </div>
          <div className={`rounded-lg p-4 text-center ${returnsAll !== null && returnsAll >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-sm text-gray-600">All Time</p>
            <p className={`text-xl font-bold ${returnsAll !== null && returnsAll >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {returnsAll !== null ? returnsAll.toFixed(1) + '%' : '-'}
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">NAV History</h3>
            <div className="flex gap-2">
              {[
                { label: '1M', value: 30 },
                { label: '3M', value: 90 },
                { label: '6M', value: 180 },
                { label: '1Y', value: 365 },
                { label: 'All', value: fund.data.length },
              ].map(range => (
                <button
                  key={range.label}
                  onClick={() => setChartRange(range.value)}
                  className={`px-3 py-1 text-sm rounded ${chartRange === range.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: '300px' }}>
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Recent NAV Values</h3>
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-600">Date</th>
                  <th className="px-3 py-2 text-right text-gray-600">NAV (₹)</th>
                  <th className="px-3 py-2 text-right text-gray-600">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {fund.data.slice(0, 30).map((item, idx) => {
                  const prev = idx < fund.data.length - 1 ? parseFloat(fund.data[idx + 1].nav) : parseFloat(item.nav);
                  const curr = parseFloat(item.nav);
                  const change = ((curr - prev) / prev) * 100;
                  return (
                    <tr key={item.date} className="hover:bg-white">
                      <td className="px-3 py-2 text-gray-700">{item.date}</td>
                      <td className="px-3 py-2 text-right font-medium">{curr.toFixed(2)}</td>
                      <td className={`px-3 py-2 text-right ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {change >= 0 ? '+' : ''}{change.toFixed(2)}%
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
  );
}

export default App;
