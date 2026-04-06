export class QueryHistory {
  private queries: string[] = [];
  private maxSize: number = 50;
  private currentIndex: number = -1;

  addQuery(query: string): void {
    if (!query.trim() || query === this.queries[0]) {
      return;
    }

    this.queries.unshift(query);
    
    if (this.queries.length > this.maxSize) {
      this.queries = this.queries.slice(0, this.maxSize);
    }
    
    this.currentIndex = -1;
  }

  getPreviousQuery(): string | null {
    if (this.queries.length === 0) {
      return null;
    }

    this.currentIndex = Math.min(this.currentIndex + 1, this.queries.length - 1);
    return this.queries[this.currentIndex];
  }

  getNextQuery(): string | null {
    if (this.queries.length === 0 || this.currentIndex <= 0) {
      this.currentIndex = -1;
      return null;
    }

    this.currentIndex = Math.max(this.currentIndex - 1, 0);
    return this.queries[this.currentIndex];
  }

  resetIndex(): void {
    this.currentIndex = -1;
  }

  getAllQueries(): string[] {
    return [...this.queries];
  }

  clearHistory(): void {
    this.queries = [];
    this.currentIndex = -1;
  }

  getRecentQueries(count: number = 10): string[] {
    return this.queries.slice(0, count);
  }
}

export const commonQueries = {
  selectAll: 'SELECT * FROM c',
  selectTop10: 'SELECT TOP 10 * FROM c',
  selectTop100: 'SELECT TOP 100 * FROM c',
  countAll: 'SELECT VALUE COUNT(1) FROM c',
  selectById: "SELECT * FROM c WHERE c.id = 'YOUR_ID'",
  orderByDesc: 'SELECT * FROM c ORDER BY c._ts DESC',
  orderByAsc: 'SELECT * FROM c ORDER BY c._ts ASC',
  whereClause: "SELECT * FROM c WHERE c.status = 'active'",
  distinctValues: 'SELECT DISTINCT c.category FROM c',
  aggregateCount: 'SELECT c.category, COUNT(1) as count FROM c GROUP BY c.category',
  joinArray: 'SELECT c.id, item FROM c JOIN item IN c.items',
  dateRange: "SELECT * FROM c WHERE c._ts >= 1609459200 AND c._ts <= 1640995199",
};

export const queryTemplates = [
  {
    name: 'Select All',
    query: commonQueries.selectAll,
    description: 'Retrieve all documents from the container',
  },
  {
    name: 'Top 10',
    query: commonQueries.selectTop10,
    description: 'Retrieve the first 10 documents',
  },
  {
    name: 'Count Documents',
    query: commonQueries.countAll,
    description: 'Count total number of documents',
  },
  {
    name: 'Filter by Status',
    query: commonQueries.whereClause,
    description: 'Filter documents by status field',
  },
  {
    name: 'Recent First',
    query: commonQueries.orderByDesc,
    description: 'Order documents by timestamp (newest first)',
  },
  {
    name: 'Group By Category',
    query: commonQueries.aggregateCount,
    description: 'Aggregate documents by category',
  },
];
