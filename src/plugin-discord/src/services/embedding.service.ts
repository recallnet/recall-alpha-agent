// import { OpenAIEmbeddings } from "langchain/embeddings/openai";
// import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
// import { Document } from "langchain/document";

// export class EmbeddingService {
//   public async createEmbeddings(text: string): Promise<{
//     chunks: Document<Record<string, any>>[],
//     embeddingsArrays: number[][]
//   }> {
//     if (!process.env.OPENAI_API_KEY) {
//       throw new Error(
//         "OPENAI_API_KEY is not defined in the environment variables."
//       );
//     }
//     const textSplitter = new RecursiveCharacterTextSplitter({
//       chunkSize: 1000,
//     });
//     console.log("Splitting query into chunks...");
//     const chunks = await textSplitter.createDocuments([text]);
//     const embeddingsArrays = await new OpenAIEmbeddings().embedDocuments(
//       chunks.map((chunk) => chunk.pageContent.replace(/\n/g, " "))
//     );

//     return { chunks, embeddingsArrays };
//   }

//   public async createEmbedding(text: string) {
//     if (!process.env.OPENAI_API_KEY) {
//       throw new Error(
//         "OPENAI_API_KEY is not defined in the environment variables."
//       );
//     }
//     try {
//       const textSplitter = new RecursiveCharacterTextSplitter({
//         chunkSize: 1000,
//       });
//       console.log("Splitting query into chunks...");
//       // 5. Split text into chunks (documents)
//       const chunks = await textSplitter.createDocuments([text]);

//       const array = await new OpenAIEmbeddings().embedDocuments(
//         chunks.map((chunk) => chunk.pageContent.replace(/\n/g, " "))
//       );
//       return array;
//     } catch (error: any) {
//       console.error("Error creating embedding:", error);
//       throw error;
//     }
//   }
// }
