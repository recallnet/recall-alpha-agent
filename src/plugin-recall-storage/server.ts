import express from 'express';
import { elizaLogger } from '@elizaos/core';
import { RecallService } from './services/recall.service.ts';
import { initializeDatabase } from '../database/index.ts';
import path from 'path';

const app = express();
const PORT = process.env.RECALL_MONITOR_PORT || 3002;

async function startServer() {
  try {
    // Initialize database with same path as main app
    const dataDir = path.resolve(process.cwd(), 'data');
    const db = initializeDatabase(dataDir);
    await db.init();

    // Initialize recall service
    const recallService = new RecallService();
    await recallService.initializeMonitoring(db);

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
