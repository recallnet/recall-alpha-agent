import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { elizaLogger } from "@elizaos/core";
import bs58 from "bs58";

export class SolanaService {
  private connection: Connection;
  private wallet: Keypair;

  constructor() {
    this.connection = new Connection("https://api.mainnet-beta.solana.com");
    if (!process.env.SOL_PRIVATE_KEY) {
      throw new Error("SOL_PRIVATE_KEY is required");
    }
    const privateKeyBytes = bs58.decode(process.env.SOL_PRIVATE_KEY);
    const keypair = Keypair.fromSecretKey(privateKeyBytes);
    this.wallet = keypair;
    elizaLogger.info(`✅ Wallet initialized: ${keypair.publicKey.toBase58()}`);
  }

  async isTokenMintable(tokenMintAddress: string): Promise<boolean> {
    try {
      const mintPublicKey = new PublicKey(tokenMintAddress);

      // Fetch mint information
      const mintInfo = await getMint(this.connection, mintPublicKey);

      elizaLogger.info(`🔍 Token ${tokenMintAddress} mint info:`, mintInfo);

      // Check if the mint authority is set
      const mintable = mintInfo.mintAuthority !== null;

      elizaLogger.info(
        `🔍 Token ${tokenMintAddress} is ${
          mintable ? "MINTABLE" : "NOT mintable"
        }`
      );

      return mintable;
    } catch (error) {
      elizaLogger.error(
        `❌ Error fetching mint info for ${tokenMintAddress}: ${error.message}`
      );
      return false;
    }
  }
}
