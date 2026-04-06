#!/usr/bin/env node

import { CosmosDBTUI } from './ui/app';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  try {
    const app = new CosmosDBTUI();
    await app.start();
  } catch (error) {
    console.error('Failed to start Cosmos DB TUI:', error);
    process.exit(1);
  }
}

main();
