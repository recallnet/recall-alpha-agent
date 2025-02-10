import express from 'express';
import { elizaLogger } from '@elizaos/core';
import { RecallService } from './services/recall.service.ts';
import { initializeDatabase } from '../database/index.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import { ICotDatabaseAdapter } from '../types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.RECALL_MONITOR_PORT || 3002;

async function startServer() {
  try {
    // Initialize database with same path as main app
    const dataDir = path.join(__dirname, '../../../data');
    const db = initializeDatabase(dataDir);
    await db.init();

    // Initialize alpha service
    const recallService = new RecallService();
    await recallService.initializeMonitoring(db as ICotDatabaseAdapter);

    // Basic health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    // Start the server
    app.listen(PORT, () => {
      elizaLogger.info(`🚀 Recall monitoring service running on port ${PORT}`);
    });

    // Handle shutdown gracefully
    process.on('SIGTERM', async () => {
      elizaLogger.info('SIGTERM received. Shutting down Recall monitor...');
      await recallService.stopPeriodicSync();
      await db.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      elizaLogger.info('SIGINT received. Shutting down Recall monitor...');
      await recallService.stopPeriodicSync();
      await db.close();
      process.exit(0);
    });
  } catch (error) {
    elizaLogger.error('Failed to start Recall monitoring service:', error);
    process.exit(1);
  }
}

startServer();
