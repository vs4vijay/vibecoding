export interface MutualFund {
  schemeCode: string;
  schemeName: string;
}

export interface FundDetail {
  meta: {
    scheme_type: string;
    scheme_category: string;
    scheme_code: string;
    scheme_name: string;
    scheme_start_date?: {
      date: string;
      nav: string;
    };
  };
  data: NAVData[];
  status: string;
}

export interface NAVData {
  date: string;
  nav: string;
}

export interface FundSearchResult {
  schemeCode: string;
  schemeName: string;
}
