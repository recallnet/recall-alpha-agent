// import { ethers, Wallet } from "ethers";

// export class WalletHandshake {
//     wallet;

//     constructor() {
//         if (!process.env.EVM_PRIVATE_KEY) {
//             throw new Error("EVM_PRIVATE_KEY is required");
//         }
//         if (!process.env.EVM_PROVIDER_URL) {
//             throw new Error("EVM_PROVIDER_URL is required");
//         }
//         const wallet = new Wallet(process.env.EVM_PRIVATE_KEY);
//         this.wallet = wallet.connect(
//             new ethers.JsonRpcProvider(process.env.EVM_PROVIDER_URL)
//         );
//     }

//     /**
//      * Signs a message with the wallet's private key.
//      * @param message - The message to sign.
//      * @returns An object containing the signature and the address of the signer.
//      */
//     async signMessage(message: string) {
//         const signature = await this.wallet.signMessage(message);
//         return {
//             signature,
//             address: this.wallet.address, // Include the wallet address for verification
//         };
//     }

//     /**
//      * Verifies a signature against a message and an Ethereum address.
//      * @param message - The original message.
//      * @param signature - The signature to verify.
//      * @param expectedAddress - The Ethereum address to check against.
//      * @returns Boolean indicating if the signature is valid.
//      */
//     async verifySignature(
//         message: string,
//         signature: string,
//         expectedAddress: string
//     ): Promise<boolean> {
//         try {
//             try {
//                 const recoveredAddress = ethers.verifyMessage(
//                     message,
//                     signature
//                 );
//                 return (
//                     recoveredAddress.toLowerCase() ===
//                     expectedAddress.toLowerCase()
//                 );
//             } catch (error) {
//                 console.error("Error verifying signature:", error);
//                 return false;
//             }
//         } catch (error) {
//             console.error("Error verifying signature:", error);
//             return false;
//         }
//     }
// }
