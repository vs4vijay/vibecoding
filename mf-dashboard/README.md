# Indian Mutual Fund Dashboard

A comprehensive dashboard for tracking and analyzing Indian mutual funds using real-time data from MFapi.in.

## Features

- **Real-time Data**: Daily updated NAV data from MFapi.in
- **Search & Filter**: Search mutual funds by name and filter by category
- **Interactive Charts**: Visualize NAV history with interactive Chart.js graphs
- **Detailed View**: View complete fund details including:
  - Current NAV
  - Historical NAV data
  - Total returns since inception
  - Recent NAV values with daily changes
- **Responsive Design**: Mobile-friendly interface built with TailwindCSS
- **Performance Optimized**: Load more funds on demand

## Tech Stack

- **Frontend**: React 19 with TypeScript
- **Build Tool**: Vite
- **Styling**: TailwindCSS
- **Charts**: Chart.js with react-chartjs-2
- **API Client**: Axios
- **Package Manager**: Bun

## API Data Source

This dashboard uses the free **MFapi.in** API, which provides:
- Complete historical data for Indian mutual funds
- Daily NAV updates
- JSON REST API
- No authentication required

## Getting Started

### Prerequisites

- Bun installed on your system

### Installation

1. Install dependencies:
```bash
bun install
```

2. Start the development server:
```bash
bun run dev
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

### Build for Production

```bash
bun run build
```

The built files will be in the `dist` directory.

### Preview Production Build

```bash
bun run preview
```

## Usage

1. **Browse Funds**: The dashboard displays all available mutual funds on load
2. **Search**: Use the search bar to find specific funds by name
3. **Filter**: Select a category to filter funds (Equity, Debt, Hybrid, etc.)
4. **View Details**: Click on any fund card to view detailed information
5. **Analyze**: Review the NAV chart and historical data
6. **Load More**: Click "Load More Funds" to see additional results

## Project Structure

```
mf-dashboard/
├── src/
│   ├── components/         # React components
│   │   ├── FundCard.tsx
│   │   ├── FundDetail.tsx
│   │   ├── FundList.tsx
│   │   ├── NAVChart.tsx
│   │   ├── SearchBar.tsx
│   │   └── StatsCard.tsx
│   ├── services/          # API services
│   │   └── api.ts
│   ├── types/             # TypeScript types
│   │   └── index.ts
│   ├── utils/             # Utility functions
│   │   └── formatters.ts
│   ├── App.tsx            # Main application component
│   ├── main.tsx           # Application entry point
│   └── index.css          # Global styles
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── postcss.config.js
```

## API Endpoints Used

- `GET https://api.mfapi.in/mf` - Fetch all mutual funds
- `GET https://api.mfapi.in/mf/{schemeCode}` - Get fund details with historical NAV
- `GET https://api.mfapi.in/mf/{schemeCode}/latest` - Get latest NAV

## Disclaimer

This dashboard is for informational purposes only. NAV data is updated daily and should not be considered as investment advice. Always consult with a financial advisor before making investment decisions.

## Data Attribution

Data provided by [MFapi.in](https://www.mfapi.in/) - India's first free mutual fund API.

## License

This project is open source and available for educational purposes.
