import { useState, useEffect } from 'react';
import { MutualFund } from './types';
import { mfApiService } from './services/api';
import SearchBar from './components/SearchBar';
import FundList from './components/FundList';
import FundDetail from './components/FundDetail';
import StatsCard from './components/StatsCard';

function App() {
  const [allFunds, setAllFunds] = useState<MutualFund[]>([]);
  const [filteredFunds, setFilteredFunds] = useState<MutualFund[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedFund, setSelectedFund] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const fundsPerPage = 30;

  useEffect(() => {
    const fetchAllFunds = async () => {
      try {
        setIsLoading(true);
        const funds = await mfApiService.getAllFunds();
        setAllFunds(funds);
        setFilteredFunds(funds.slice(0, fundsPerPage));
      } catch (error) {
        console.error('Error fetching funds:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllFunds();
  }, []);

  useEffect(() => {
    let filtered = mfApiService.searchFunds(allFunds, searchTerm);

    if (selectedCategory !== 'All') {
      filtered = filtered.filter((fund) =>
        fund.schemeName.toLowerCase().includes(selectedCategory.toLowerCase())
      );
    }

    setFilteredFunds(filtered.slice(0, currentPage * fundsPerPage));
  }, [searchTerm, selectedCategory, allFunds, currentPage]);

  const handleLoadMore = () => {
    setCurrentPage((prev) => prev + 1);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    setCurrentPage(1);
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 text-white shadow-2xl">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">WealthIQ</h1>
              <p className="text-indigo-200 mt-2 text-lg">
                Smart Mutual Fund Analytics
              </p>
            </div>
            <div className="hidden md:flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
              <span className="text-sm text-indigo-100">Live Data</span>
            </div>
          </div>
        </div>
        <div className="h-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400"></div>
      </header>

      <main className="container mx-auto px-4 py-8 -mt-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <StatsCard
            title="Total Funds"
            value={allFunds.length.toLocaleString()}
            subtitle="Available to explore"
            icon="chart-bar"
          />
          <StatsCard
            title="Showing"
            value={filteredFunds.length.toLocaleString()}
            subtitle="Based on filters"
            icon="filter"
          />
          <StatsCard
            title="Data Source"
            value="MFapi.in"
            subtitle="Updated daily"
            icon="database"
          />
        </div>

        <SearchBar
          searchTerm={searchTerm}
          onSearchChange={handleSearchChange}
          onCategoryChange={handleCategoryChange}
          selectedCategory={selectedCategory}
        />

        <FundList
          funds={filteredFunds}
          onFundClick={setSelectedFund}
          isLoading={isLoading}
        />

        {!isLoading && filteredFunds.length < allFunds.length && (
          <div className="flex justify-center mt-8">
            <button
              onClick={handleLoadMore}
              className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 font-medium transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              Load More Funds
            </button>
          </div>
        )}
      </main>

      {selectedFund && (
        <FundDetail
          schemeCode={selectedFund}
          onClose={() => setSelectedFund(null)}
        />
      )}

      <footer className="bg-slate-950 text-slate-400 mt-12 border-t border-slate-800">
        <div className="container mx-auto px-4 py-8 text-center">
          <p className="text-slate-500">
            Data provided by{' '}
            <a
              href="https://www.mfapi.in"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              MFapi.in
            </a>
          </p>
          <p className="text-slate-600 text-sm mt-2">
            NAV data updated daily. For informational purposes only. Not investment advice.
          </p>
          <p className="text-slate-700 text-xs mt-4">
            © 2024 WealthIQ. Built with React + Vite + TailwindCSS
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
