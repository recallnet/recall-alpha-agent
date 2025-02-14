import { BalanceManager } from './BalanceManager.ts';
import { PriceTracker } from './PriceTracker.ts';
import { TradeSimulator } from './TradeSimulator.ts';
import { Trade, TradeResult, AccountState } from '../types/index.ts';
import { Service, ServiceType } from '@elizaos/core';
import { ICotAgentRuntime } from '../../types/index.ts';

export class TradingService extends Service {
  static serviceType: ServiceType = 'trading' as ServiceType;
  private balanceManager: BalanceManager;
  private priceTracker: PriceTracker;
  public tradeSimulator: TradeSimulator;
  private runtime: ICotAgentRuntime;

  async initialize(_runtime: ICotAgentRuntime) {
    // Default initial balances if none provided
    const defaultBalances = new Map<string, number>([
      ['So11111111111111111111111111111111111111112', 10], // 10 SOL
      ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1000], // 1000 USDC
      ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 1000], // 1000 USDT
    ]);
    this.runtime = _runtime;
    this.balanceManager = new BalanceManager(defaultBalances);
    this.priceTracker = new PriceTracker();
    this.tradeSimulator = new TradeSimulator(this.balanceManager, this.priceTracker);
  }

  async executeTrade(fromToken: string, toToken: string, amount: number): Promise<TradeResult> {
    return this.tradeSimulator.executeTrade(fromToken, toToken, amount);
  }

  async getTokenPrice(tokenAddress: string): Promise<number | null> {
    return this.priceTracker.getPrice(tokenAddress);
  }

  getBalance(tokenAddress: string): number {
    return this.balanceManager.getBalance(tokenAddress);
  }

  getAllBalances() {
    return this.balanceManager.getAllBalances();
  }

  getTrades(): Trade[] {
    return this.tradeSimulator.getTrades();
  }

  async isTokenSupported(tokenAddress: string): Promise<boolean> {
    return this.priceTracker.isTokenSupported(tokenAddress);
  }

  getCurrentState(): AccountState {
    return {
      balances: new Map(this.balanceManager.getAllBalances().map((b) => [b.token, b.amount])),
      trades: this.getTrades(),
    };
  }

  updateBalance(tokenAddress: string, amount: number): void {
    this.balanceManager.updateBalance(tokenAddress, amount);
  }
}

// // Test code
const test = async () => {
  try {
    console.log('=== Testing SOL to TRUMP Trading ===');
    const module = new TradingService();
    module.initialize({} as any);

    // Constants for test
    const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const trumpToken = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';
    const tradeAmount = 1.0; // Trading 1 SOL

    // First get current prices
    console.log('\n=== Current Market Prices ===');
    const usdcPrice = await module.getTokenPrice(usdc);
    const trumpPrice = await module.getTokenPrice(trumpToken);
    console.log(`SOL Price: $${usdcPrice}`);
    console.log(`TRUMP Price: $${trumpPrice}`);
    if (usdc && trumpPrice) {
      console.log(`Current Market Rate: 1 USDC = ${usdcPrice / trumpPrice} TRUMP`);
    }

    console.log('\n=== Initial Balances ===');
    console.log(`USDC Balance: ${module.getBalance(usdc)} USDC`);
    console.log(`TRUMP Balance: ${module.getBalance(trumpToken)} TRUMP`);

    console.log(`\n=== Executing Trade: ${tradeAmount} USDC -> TRUMP ===`);
    const tradeResult = await module.executeTrade(usdc, trumpToken, tradeAmount);

    if (tradeResult.success && tradeResult.trade) {
      console.log('\n=== Trade Details ===');
      console.log(`Amount Sent: ${tradeResult.trade.fromAmount} USDC`);
      console.log(`Amount Received: ${tradeResult.trade.toAmount} TRUMP`);
      console.log(
        `Actual Exchange Rate: 1 USDC = ${tradeResult.trade.toAmount / tradeResult.trade.fromAmount} TRUMP`,
      );
    } else {
      console.log('Trade failed:', tradeResult.error);
    }

    console.log('\n=== Final Balances ===');
    console.log(`USDC Balance: ${module.getBalance(usdc)} USDC`);
    console.log(`TRUMP Balance: ${module.getBalance(trumpToken)} TRUMP`);
  } catch (error) {
    console.error(
      'Error during test:',
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : 'Unknown error',
    );
  }
};

test().catch(console.error);
