# Eliza Discord Agent

## Edit the character files

Open `src/character.ts` to modify the default character. Uncomment and edit.

### Character

Edit the character file found in ./characters/recall.character.json. If you rename this file, you will need to update the hard-coded file path found on line 137 in [this file](src/index.ts).

## Duplicate the .env.example template

```bash
cp .env.example .env
```

\* Fill out the .env file with your own values.

### Add login credentials and keys to .env

```
DISCORD_APPLICATION_ID="discord-application-id"
DISCORD_API_TOKEN="discord-api-token"
DISCORD_CHANNEL_ID="your-channel-id"
DISCORD_GUILD_ID="your-server-id"
OPENAI_API_KEY="your-key"
POSTGRES_URL="your-pg-url"
```

This agent is currently constrained to only engage in the channel defined in your .env file. You can alter this behavior from the [messaging module](src/plugin-discord/src/messages.ts) on line 109.

### Knowledge Base

This Discord agent uses a `knowledge base` (specialized knowledge set in vector embedding format) to inject additional context into its responses based on similarity search. Once you've set up your PostgreSQL connection, connect to your database and perform the following:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE code_embeddings (
    id SERIAL PRIMARY KEY,
    file_path TEXT,
    content  TEXT,
    embedding VECTOR(1536)
);
```

To pre-load this knowledge base with specialized knowledge (for example, using documentation), you can run a script like the following in a separate file to recursively vectorize file contents within your ./documents directory:

```typescript
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'your-connection-url',
});
// Configure unified loader for all file types
const loader = new DirectoryLoader('./documents', {
  '.txt': (path) => new TextLoader(path),
  '.md': (path) => new TextLoader(path),
  '.pdf': (path) => new PDFLoader(path),
  '.tsx': (path) => new TextLoader(path),
  '.rs': (path) => new TextLoader(path),
});

const docs = await loader.load();
const embeddings = new OpenAIEmbeddings();

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
  separators: ['\n\n', '\n', ' ', ''],
});

for (const doc of docs) {
  console.log(`Processing document: ${doc.metadata.source}`);
  const txtPath = doc.metadata.source;
  const text = doc.pageContent;

  const chunks = await textSplitter.createDocuments([text]);
  console.log(`Text split into ${chunks.length} chunks`);

  const embeddingsArrays = await embeddings.embedDocuments(
    chunks.map((chunk) => chunk.pageContent.replace(/\n/g, ' ')),
  );

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const vector = {
      id: `${txtPath}_${idx}`,
      values: embeddingsArrays[idx],
      metadata: {
        ...chunk.metadata,
        loc: JSON.stringify(chunk.metadata.loc),
        pageContent: chunk.pageContent,
        txtPath: txtPath,
      },
    };

    const res = await pool.query(
      'INSERT INTO code_embeddings (content, file_path, embedding) VALUES ($1, $2, $3::vector)',
      [
        chunk.pageContent,
        txtPath,
        `[${vector.values.join(',')}]`, // Format as array string
      ],
    );
    console.log(res.rows[0], 'inserted from ', txtPath, ':', chunk.pageContent.slice);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Add your Postgres insertion logic here
  }
  console.log(`Postgres index updated with ${chunks.length} vectors`);
}
```

## Install dependencies and start your agent

```bash
pnpm i && pnpm start
```

Note: this requires node to be at least version 22 when you install packages and run the agent.

```

```
