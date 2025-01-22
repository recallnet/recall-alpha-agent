import { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import pkg from "pg";
const { Pool } = pkg;
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

export const embeddingProvider: Provider = {
  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State
  ): Promise<Error | string> => {
    try {
      const pool = new Pool({
        connectionString: process.env.POSTGRES_URL,
       });

    const cleanCode = message.content.text.trim().replace(/\s+/g, ' ');

    // Generate embedding
    const embedding = await new OpenAIEmbeddings().embedQuery(cleanCode);

    const res = await pool.query(
        `SELECT content, embedding <=> $1::vector AS similarity 
         FROM code_embeddings 
         ORDER BY similarity ASC 
         LIMIT 5`,
        [`[${embedding.join(',')}]`]
      );

      const rows = res.rows;
      console.log('Relevant code snippets:', rows.length);
      // iterate over the rows to join a coherent single string response
      let response = `# Relevant code snippets or documentation references\n`;
      for (const row of rows) {
        response += `${row.content}\n`;
      }
      return response;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Unable to get storage provider";
    }
  },
};
