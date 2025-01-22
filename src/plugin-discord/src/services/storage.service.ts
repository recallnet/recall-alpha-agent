// import { CeramicDocument } from "@useorbis/db-sdk";
// import { Lit } from "./access.service.ts";
// import { Orbis, type ServerMessage } from "./discord.service.ts";
// import { EmbeddingService } from "./embedding.service.ts";

// export class StorageService {
//     private static instance: StorageService;
//     private lit: Lit | null;
//     private orbis: Orbis | null;
//     private embeddingService: EmbeddingService;

//     private constructor() {
//         this.lit = null;
//         this.orbis = null;
//         this.embeddingService = new EmbeddingService();
//     }

//     public static getInstance(): StorageService {
//         if (!StorageService.instance) {
//             StorageService.instance = new StorageService();
//         }
//         return StorageService.instance;
//     }

//     public async start(): Promise<void> {
//         if (!process.env.ETHEREUM_PRIVATE_KEY) {
//             throw new Error("ETHEREUM_PRIVATE_KEY is required");
//         }

//         try {
//             this.lit = new Lit();
//             this.orbis = Orbis.getInstance();
//             return;
//         } catch (error: any) {
//             console.error("Error starting StorageService:", error);
//             throw error;
//         }
//     }

//     public async storeMessage(
//         context: string,
//         is_user: boolean
//     ): Promise<CeramicDocument> {
//         if (!this.orbis) {
//             throw new Error("Orbis is not initialized");
//         }

//         if (!this.lit) {
//             throw new Error("Lit is not initialized");
//         }

//         try {
//             const encryptedBody = await this.lit.encrypt(context);
//             const content = {
//                 content: JSON.stringify(encryptedBody),
//                 is_user,
//             };
//             return await this.orbis.updateOrbis(content as ServerMessage);
//         } catch (error: any) {
//             console.error("Error storing message:", error);
//             throw error;
//         }
//     }

//     public async verifyUser(
//         address: string,
//         user_id: string,
//         verified: boolean
//     ): Promise<CeramicDocument> {
//         try {
//             const content = {
//                 address,
//                 user_id,
//                 verified,
//             };
//             return await this.orbis.createVerifiedEntry(content);
//         } catch (error: any) {
//             console.error("Error storing message:", error);
//             throw error;
//         }
//     }

//     public async checkIsVerified(user_id: string): Promise<boolean> {
//         if (!this.orbis) {
//             throw new Error("Orbis is not initialized");
//         }

//         if (!process.env.VERIFIED_TABLE) {
//             throw new Error("Missing verified table");
//         }

//         try {
//             const query = `
//             SELECT *
//             FROM ${process.env.VERIFIED_TABLE}
//             WHERE user_id = '${user_id}';
//             `;
//             const verified = await this.orbis.queryVerifiedIndex(query);
//             return verified ? verified.rows[0].verified : false;
//         } catch (error: any) {
//             console.error("Error checking if user is verified:", error);
//             throw error;
//         }
//     }

//     public async storeMessageWithEmbedding(
//         context: string,
//         is_user: boolean
//     ): Promise<CeramicDocument[]> {
//         if (!this.orbis) {
//             throw new Error("Orbis is not initialized");
//         }

//         if (!this.lit) {
//             throw new Error("Lit is not initialized");
//         }

//         try {
//             const { chunks, embeddingsArrays } =
//                 await this.embeddingService.createEmbeddings(context);
//             const documents: CeramicDocument[] = [];
//             for (let idx = 0; idx < chunks.length; idx++) {
//                 const chunk = chunks[idx];
//                 const encryptedBody = await this.lit.encrypt(
//                     JSON.stringify(chunk.pageContent)
//                 );
//                 const content = {
//                     content: JSON.stringify(encryptedBody),
//                     embedding: embeddingsArrays[idx],
//                     is_user,
//                 };

//                 const doc = await this.orbis.updateOrbis(
//                     content as ServerMessage
//                 );
//                 documents.push(doc);
//             }
//             return documents;
//         } catch (error: any) {
//             console.error("Error storing message:", error);
//             throw error;
//         }
//     }

//     public async getConversation(): Promise<string | null> {
//         if (!this.orbis) {
//             throw new Error("Orbis is not initialized");
//         }
//         if (!this.lit) {
//             throw new Error("Lit is not initialized");
//         }
//         if (!process.env.TABLE_ID) {
//             throw new Error(
//                 "TABLE_ID is not defined in the environment variables."
//             );
//         }

//         try {
//             await this.orbis.getAuthenticatedInstance();
//             const controller = await this.orbis.getController();
//             console.log("this is the controller", controller);
//             const query = `
//             SELECT *
//             FROM ${process.env.TABLE_ID}
//             WHERE controller = '${controller}';
//             `;
//             const context = await this.orbis.queryKnowledgeIndex(query);
//             if (!context) {
//                 return null;
//             }

//             const decryptedRows = await Promise.all(
//                 context.rows.map(async (row) => {
//                     const lit = new Lit();
//                     const { ciphertext, dataToEncryptHash } = JSON.parse(
//                         row.content as string
//                     );
//                     const decryptedContent = await lit.decrypt(
//                         ciphertext,
//                         dataToEncryptHash
//                     );
//                     // indicate if the message is from the user or the server
//                     return `
//           ${row.is_user ? row.userId : row.agentId}: ${decryptedContent}`;
//                 })
//             );
//             const concatenatedContext = decryptedRows.join(" ");
//             return concatenatedContext;
//         } catch (error: any) {
//             console.error("Error getting context:", error);
//             throw error;
//         }
//     }

//     public async getEmbeddingContext(text: string): Promise<string | null> {
//         if (!this.orbis) {
//             throw new Error("Orbis is not initialized");
//         }
//         if (!this.lit) {
//             throw new Error("Lit is not initialized");
//         }
//         if (!process.env.TABLE_ID) {
//             throw new Error(
//                 "TABLE_ID is not defined in the environment variables."
//             );
//         }

//         try {
//             const array = await this.embeddingService.createEmbedding(text);
//             const formattedEmbedding = `ARRAY[${array.join(", ")}]::vector`;
//             const query = `
//             SELECT content, is_user, embedding <=> ${formattedEmbedding} AS similarity
//             FROM ${process.env.TABLE_ID}
//             ORDER BY similarity ASC
//             LIMIT 5;
//             `;
//             const context = await this.orbis.queryKnowledgeIndex(query);

//             if (!context) {
//                 return null;
//             }

//             const decryptedRows = await Promise.all(
//                 context.rows.map(async (row) => {
//                     const lit = new Lit();
//                     const { ciphertext, dataToEncryptHash } = JSON.parse(
//                         row.content as string
//                     );
//                     const decryptedContent = await lit.decrypt(
//                         ciphertext,
//                         dataToEncryptHash
//                     );
//                     // indicate if the message is from the user or the server
//                     return `
//           ${row.is_user ? "User" : "Agent"}: ${decryptedContent}`;
//                 })
//             );
//             const concatenatedContext = decryptedRows.join(" ");
//             return concatenatedContext;
//         } catch (error: any) {
//             console.error("Error getting context:", error);
//             throw error;
//         }
//     }

//     public async stop(): Promise<void> {
//         this.orbis = null;
//         this.lit = null;
//     }
// }
