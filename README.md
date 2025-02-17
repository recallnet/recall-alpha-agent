# Recall Alpha Agent

_Forget the noise. The real action happens before the hype._

## 🚀 Overview

The **Recall Alpha Agent** is an advanced AI-driven system that combines **crypto trading intelligence** with **persistent memory storage**. It operates in two primary capacities:

1. **Alpha-Gathering Twitter Agent**:

   - Monitors selected **Twitter profiles** for new follows.
   - Extracts potential **token mints** from new follows' bios.
   - Queries **Raydium API** for token liquidity pool data.
   - Stores collected data in **PostgreSQL/SQLite databases**.
   - Detects early **memecoin** opportunities and generates **alpha tweets**.

2. **Recall Plugin for AI Memory**:
   - Integrates with **Recall storage** to persist chain-of-thought (CoT) logs.
   - Syncs reasoning history to **Recall buckets**.
   - Fetches **historical thought logs** to enhance inference.
   - Manages persistent memory through **Recall API**.

## 🛠 Alpha Service Workflow

The **Alpha Service** runs as an **Express server** in a continuous loop, monitoring specific Twitter accounts for potential trading signals.

## 🛠 Recall Service Workflow

The **Recall Service** runs as an **Express server** in a continuous loop, periodically performing batch syncing jobs, transferring chain-of-thought logs from the local database to Recall.

### **🔄 Flow of Operations**

1. The **agent scrapes** selected Twitter profiles for **new follows**.
2. It checks the **bio** of new follows for **token mints**.
3. If a mint is found, it **queries Raydium API** for liquidity pool data.
4. The collected **alpha data** is logged into the `alpha_analysis` table.
5. A **separate Twitter agent** queries `alpha_analysis` and **tweets** about new opportunities.
6. The system continuously refines **scanning intervals** based on activity levels.

### **🛠 Key Components**

| **Component**          | **Function**                                         |
| ---------------------- | ---------------------------------------------------- |
| **Twitter Scraper**    | Extracts new follows from selected accounts.         |
| **Raydium API**        | Fetches liquidity and pool data for detected tokens. |
| **Database Logging**   | Stores alpha signals in a structured database.       |
| **Automated Tweeting** | Posts insightful tweets based on analysis.           |
| **Recall Integration** | Stores chain-of-thought logs for AI reasoning.       |

## 🔥 **Modified Twitter Client**

The **Twitter posting client** has been updated to:

- Periodically **check the `alpha_analysis` table**.
- Detect **new token opportunities**.
- Generate **engaging tweets** based on collected data.
- Maintain **a structured posting schedule**.

## 🔥 **Modified Database Adapters**

The **SqliteDatabaseAdapter** and **PostgresDatabaseAdapter** have been updated to accommodate Alpha Agent's needs, including:

- Modified `logs` table and corresponding queries to keep track of synced logs to Recall
- New `twitter_following` and related queries to keep track of profiles the users Alpha Agent is observing are following, and which ones are new
- New `alpha_analysis` table to track collected Alpha for our agent to reference when creating Twitter posts

## 📌 Recall Plugin Functionality

This agent also provides **Recall storage** as a plugin for Eliza AI agents, allowing them to:

- ✅ Store and retrieve **chain-of-thought logs**.
- ✅ Persist agent context across sessions.
- ✅ Sync long-term memory with **Recall buckets**.
- ✅ Purchase additional storage credits.

### **🔄 Recall Storage Flow**

1. **Agent generates reasoning logs** and writes them locally.
2. **Logs are periodically uploaded** to Recall storage.
3. **Before inference**, past logs are retrieved for context.
4. The agent uses **historical thought chains** to improve decision-making.

## 📌 **Key Features & Actions**

| **Action**        | **Trigger Format**                            | **Description**                           |
| ----------------- | --------------------------------------------- | ----------------------------------------- |
| **Create Bucket** | `"Create a bucket named 'logs'"`              | Creates or retrieves a Recall bucket.     |
| **List Buckets**  | `"Show my Recall buckets"`                    | Fetches available storage buckets.        |
| **Store Object**  | `"Add object 'file.txt' to bucket 'backup'"`  | Saves an object (file, data) in a bucket. |
| **Retrieve Data** | `"Get object 'data.json' from bucket 'logs'"` | Downloads stored objects from Recall.     |
| **Buy Credits**   | `"Buy 2 Recall credits"`                      | Purchases more Recall storage credits.    |

## 📌 **Environment Variables (`.env`)**

Configure these settings to enable full functionality:

```dotenv
# Required APIs and Credentials
OPENAI_API_KEY=your-api-key
SOL_PRIVATE_KEY=your-solana-key

# Twitter Bot Credentials
TWITTER_USERNAME=your-twitter-username
TWITTER_PASSWORD=your-twitter-password
TWITTER_EMAIL=your-twitter-email

# Recall Storage
RECALL_PRIVATE_KEY=your-recall-key
RECALL_BUCKET_ALIAS=your-default-bucket
COT_LOG_PREFIX=cot/

# Database Configuration (Postgres/SQLite)
POSTGRES_URL=your-postgres-url

# Twitter Monitoring Targets
TWITTER_ACCOUNTS=comma-separated-list

# Posting Schedule
TWITTER_DRY_RUN=false
POST_INTERVAL_MIN=10
POST_INTERVAL_MAX=30

# AI Configuration
USE_OPENAI_EMBEDDING=TRUE
SERVER_PORT=3000
DAEMON_PROCESS=false
TWITTER_TARGET_USERS=
```

## 🚀 **Running the Services**

### **1️⃣ Setup & Install**

To ensure smooth operations and reduce the possibility of dependency errors, please ensure you're using the following node and pnpm versions:

```
pnpm -v 9.15.4
node -v v22.11.0
```
Next, install:

```bash
pnpm i
```

To start up only the main agent loop (and not the Alpha-gathering service or Recall), run:

```
pnpm start
```

### **2️⃣ Start the Alpha Monitoring Service**

```bash
pnpm run start:alpha
```

### **3️⃣ Start the Recall Service**

```bash
pnpm run start:recall
```

### **Start all three services in the same terminal**

Use the following if you prefer running all three services in the same terminal, instead of running in separate terminals using the three steps above.

```bash
pnpm run start:all
```

## 🏆 **Why Use This Agent?**

- **🚀 Early Crypto Alpha** – Detect promising tokens **before they trend**.
- **🤖 Smart Tweeting** – Automatically **analyze & tweet insights**.
- **🧠 Persistent AI Memory** – Integrates **Recall storage** for long-term reasoning.
- **💡 Automated Data Processing** – Fully **autonomous trading intelligence**.

This agent ensures **you stay ahead of the market** by combining **Twitter intelligence, liquidity monitoring, and AI-powered insights** into a single automated workflow. 🎯
