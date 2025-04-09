import { settings } from '@elizaos/core';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

interface AgentMessage {
  text: string;
  userId?: string;
  agentId?: string;
  // any other properties that might be in the response
}

rl.on('SIGINT', () => {
  rl.close();
  process.exit(0);
});

export async function handleUserInput(input, agentId): Promise<AgentMessage[] | undefined> {
  if (input.toLowerCase() === 'exit') {
    rl.close();
    process.exit(0);
  }

  try {
    const serverPort = parseInt(process.env.SERVER_PORT || '3000');

    const response = await fetch(`http://localhost:${serverPort}/${agentId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input,
        userId: 'user',
        userName: 'User',
      }),
    });

    const data = await response.json();
    data.forEach((message) => console.log(`${'Agent'}: ${message.text}`));
    return data;
  } catch (error) {
    console.error('Error fetching response:', error);
  }
}

export function startChat(characters) {
  function chat() {
    const agentId = characters[0].name ?? 'Agent';
    rl.question('You: ', async (input) => {
      await handleUserInput(input, agentId);
      if (input.toLowerCase() !== 'exit') {
        chat(); // Loop back to ask another question
      }
    });
  }

  return chat;
}
