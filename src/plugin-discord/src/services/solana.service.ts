import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from "@solana/spl-token";
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
  async mintToken(mintAddress: string, recipient: string, amount: number) {
    try {
      const mint = new PublicKey(mintAddress); // Token Mint Address
      const recipientPubKey = new PublicKey(recipient);

      // 🔹 Step 1: Find or create an associated token account for the recipient
      const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet, // Fee payer (your wallet)
        mint, // The token's mint address
        recipientPubKey // Recipient's wallet address
      );

      // 🔹 Step 2: Mint the tokens to the recipient's token account
      const mintTx = await mintTo(
        this.connection,
        this.wallet, // Fee payer
        mint, // Mint address (which token to mint)
        recipientTokenAccount.address, // Where to send the tokens
        this.wallet, // Authority that has permission to mint
        amount * Math.pow(10, 6) // Convert amount to smallest unit (assuming 6 decimals)
      );

      elizaLogger.info(
        `✅ Minted ${amount} tokens to ${recipient} in transaction ${mintTx}`
      );
      return mintTx;
    } catch (error) {
      elizaLogger.error(`❌ Minting failed: ${error}`);
      throw error;
    }
  }
}
