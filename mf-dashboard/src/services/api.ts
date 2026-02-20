import axios from 'axios';
import { FundDetail, MutualFund } from '../types';

const BASE_URL = 'https://api.mfapi.in';

class MFApiService {
  // Get all mutual funds
  async getAllFunds(): Promise<MutualFund[]> {
    try {
      const response = await axios.get(`${BASE_URL}/mf`);
      return response.data;
    } catch (error) {
      console.error('Error fetching all funds:', error);
      throw error;
    }
  }

  // Get fund details by scheme code
  async getFundDetails(schemeCode: string): Promise<FundDetail> {
    try {
      const response = await axios.get(`${BASE_URL}/mf/${schemeCode}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching fund details for ${schemeCode}:`, error);
      throw error;
    }
  }

  // Get latest NAV for a fund
  async getLatestNAV(schemeCode: string): Promise<FundDetail> {
    try {
      const response = await axios.get(`${BASE_URL}/mf/${schemeCode}/latest`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching latest NAV for ${schemeCode}:`, error);
      throw error;
    }
  }

  // Search funds by name
  searchFunds(funds: MutualFund[], searchTerm: string): MutualFund[] {
    if (!searchTerm) return funds;

    const term = searchTerm.toLowerCase();
    return funds.filter(fund =>
      fund.schemeName.toLowerCase().includes(term)
    );
  }
}

export const mfApiService = new MFApiService();
