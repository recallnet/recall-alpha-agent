-- Enable pgvector extension

-- -- Drop existing tables and extensions
-- DROP EXTENSION IF EXISTS vector CASCADE;
-- DROP TABLE IF EXISTS relationships CASCADE;
-- DROP TABLE IF EXISTS participants CASCADE;
-- DROP TABLE IF EXISTS logs CASCADE;
-- DROP TABLE IF EXISTS goals CASCADE;
-- DROP TABLE IF EXISTS memories CASCADE;
-- DROP TABLE IF EXISTS rooms CASCADE;
-- DROP TABLE IF EXISTS accounts CASCADE;
-- DROP TABLE IF EXISTS knowledge CASCADE;


CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Create a function to determine vector dimension
CREATE OR REPLACE FUNCTION get_embedding_dimension()
RETURNS INTEGER AS $$
BEGIN
    -- Check for OpenAI first
    IF current_setting('app.use_openai_embedding', TRUE) = 'true' THEN
        RETURN 1536;  -- OpenAI dimension
    -- Then check for Ollama
    ELSIF current_setting('app.use_ollama_embedding', TRUE) = 'true' THEN
        RETURN 1024;  -- Ollama mxbai-embed-large dimension
    -- Then check for GAIANET
    ELSIF current_setting('app.use_gaianet_embedding', TRUE) = 'true' THEN
        RETURN 768;  -- Gaianet nomic-embed dimension
    ELSE
        RETURN 384;   -- BGE/Other embedding dimension
    END IF;
END;
$$ LANGUAGE plpgsql;

BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
    "id" UUID PRIMARY KEY,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "username" TEXT,
    "email" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "details" JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS rooms (
    "id" UUID PRIMARY KEY,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DO $$
DECLARE
    vector_dim INTEGER;
BEGIN
    vector_dim := get_embedding_dimension();

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS memories (
            "id" UUID PRIMARY KEY,
            "type" TEXT NOT NULL,
            "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            "content" JSONB NOT NULL,
            "embedding" vector(%s),
            "userId" UUID REFERENCES accounts("id"),
            "agentId" UUID REFERENCES accounts("id"),
            "roomId" UUID REFERENCES rooms("id"),
            "unique" BOOLEAN DEFAULT true NOT NULL,
            CONSTRAINT fk_room FOREIGN KEY ("roomId") REFERENCES rooms("id") ON DELETE CASCADE,
            CONSTRAINT fk_user FOREIGN KEY ("userId") REFERENCES accounts("id") ON DELETE CASCADE,
            CONSTRAINT fk_agent FOREIGN KEY ("agentId") REFERENCES accounts("id") ON DELETE CASCADE
        )', vector_dim);
END $$;

CREATE TABLE IF NOT EXISTS  goals (
    "id" UUID PRIMARY KEY,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID REFERENCES accounts("id"),
    "name" TEXT,
    "status" TEXT,
    "description" TEXT,
    "roomId" UUID REFERENCES rooms("id"),
    "objectives" JSONB DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT fk_room FOREIGN KEY ("roomId") REFERENCES rooms("id") ON DELETE CASCADE,
    CONSTRAINT fk_user FOREIGN KEY ("userId") REFERENCES accounts("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS logs (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "agentId" UUID,
    "roomId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "isSynced" BOOLEAN NOT NULL DEFAULT FALSE,

    -- Foreign key constraints with explicit names for better error messages
    CONSTRAINT "fk_logs_user" 
        FOREIGN KEY ("userId") 
        REFERENCES accounts("id") 
        ON DELETE CASCADE,

    CONSTRAINT "fk_logs_agent" 
        FOREIGN KEY ("agentId") 
        REFERENCES accounts("id") 
        ON DELETE SET NULL,

    CONSTRAINT "fk_logs_room" 
        FOREIGN KEY ("roomId") 
        REFERENCES rooms("id") 
        ON DELETE CASCADE
);

-- Create an index on isSynced since we query on it
CREATE INDEX IF NOT EXISTS "idx_logs_synced" ON logs ("isSynced") WHERE NOT "isSynced";

-- Create index on createdAt for timestamp-based queries
CREATE INDEX IF NOT EXISTS "idx_logs_created" ON logs ("createdAt");

CREATE TABLE IF NOT EXISTS  participants (
    "id" UUID PRIMARY KEY,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID REFERENCES accounts("id"),
    "roomId" UUID REFERENCES rooms("id"),
    "userState" TEXT,
    "last_message_read" TEXT,
    UNIQUE("userId", "roomId"),
    CONSTRAINT fk_room FOREIGN KEY ("roomId") REFERENCES rooms("id") ON DELETE CASCADE,
    CONSTRAINT fk_user FOREIGN KEY ("userId") REFERENCES accounts("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS  relationships (
    "id" UUID PRIMARY KEY,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "userA" UUID NOT NULL REFERENCES accounts("id"),
    "userB" UUID NOT NULL REFERENCES accounts("id"),
    "status" TEXT,
    "userId" UUID NOT NULL REFERENCES accounts("id"),
    CONSTRAINT fk_user_a FOREIGN KEY ("userA") REFERENCES accounts("id") ON DELETE CASCADE,
    CONSTRAINT fk_user_b FOREIGN KEY ("userB") REFERENCES accounts("id") ON DELETE CASCADE,
    CONSTRAINT fk_user FOREIGN KEY ("userId") REFERENCES accounts("id") ON DELETE CASCADE
);

-- Add Alpha analysis table
CREATE TABLE IF NOT EXISTS alpha_analysis (
    tokenMint VARCHAR(44) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    bio TEXT,
    followersCount INTEGER NOT NULL,
    followingCount INTEGER NOT NULL,
    tweetsCount INTEGER NOT NULL,
    accountCreated TIMESTAMPTZ,
    isMintable BOOLEAN NOT NULL,
    hasPool BOOLEAN NOT NULL,
    wsolPoolAge REAL,
    usdcPoolAge REAL,
    wsolPoolTvl NUMERIC,
    usdcPoolTvl NUMERIC,
    wsolPoolVolume24h NUMERIC,
    usdcPoolVolume24h NUMERIC,
    wsolPoolPrice NUMERIC,
    usdcPoolPrice NUMERIC,
    addedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    hasTweeted BOOLEAN NOT NULL DEFAULT FALSE,
    tweetedAt TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_alpha_analysis_username ON alpha_analysis(username);
CREATE INDEX IF NOT EXISTS idx_alpha_analysis_addedAt ON alpha_analysis(addedAt DESC);


-- Add Twitter following table
CREATE TABLE IF NOT EXISTS twitter_following (
    username VARCHAR(255) NOT NULL,
    following_id VARCHAR(255) NOT NULL,
    following_username VARCHAR(255) NOT NULL,
    first_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    bio TEXT,
    PRIMARY KEY (username, following_id)
);

-- Add index for common queries
CREATE INDEX IF NOT EXISTS idx_twitter_following_username 
    ON twitter_following(username);

CREATE INDEX idx_following_id ON twitter_following (following_id);

CREATE TABLE IF NOT EXISTS  cache (
    "key" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "value" JSONB DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP,
    PRIMARY KEY ("key", "agentId")
);

DO $$
DECLARE
    vector_dim INTEGER;
BEGIN
    vector_dim := get_embedding_dimension();

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS knowledge (
            "id" UUID PRIMARY KEY,
            "agentId" UUID REFERENCES accounts("id"),
            "content" JSONB NOT NULL,
            "embedding" vector(%s),
            "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            "isMain" BOOLEAN DEFAULT FALSE,
            "originalId" UUID REFERENCES knowledge("id"),
            "chunkIndex" INTEGER,
            "isShared" BOOLEAN DEFAULT FALSE,
            CHECK(("isShared" = true AND "agentId" IS NULL) OR ("isShared" = false AND "agentId" IS NOT NULL))
        )', vector_dim);
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_memories_type_room ON memories("type", "roomId");
CREATE INDEX IF NOT EXISTS idx_participants_user ON participants("userId");
CREATE INDEX IF NOT EXISTS idx_participants_room ON participants("roomId");
CREATE INDEX IF NOT EXISTS idx_relationships_users ON relationships("userA", "userB");
CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge("agentId");
CREATE INDEX IF NOT EXISTS idx_knowledge_agent_main ON knowledge("agentId", "isMain");
CREATE INDEX IF NOT EXISTS idx_knowledge_original ON knowledge("originalId");
CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_knowledge_shared ON knowledge("isShared");
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge USING ivfflat (embedding vector_cosine_ops);

COMMIT;
