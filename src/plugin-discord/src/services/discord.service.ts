import { elizaLogger } from "@elizaos/core";
import {
  Client,
  GatewayIntentBits,
  Guild,
  Message,
  TextChannel,
  BaseMessageOptions,
  ButtonInteraction,
  Interaction,
  EmbedBuilder,
} from "discord.js";

export class DiscordService {
  private client: Client;
  private guild: Guild;
  private discordChannelId: string;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async onModuleInit() {
    elizaLogger.log("Initializing Discord bot..."); 
    // Set up message handling
    this.client.on("messageCreate", this.handleMessage.bind(this));

    // Original event handlers
    this.client.on("ready", () => elizaLogger.log("Discord bot is ready!"));
    this.client.on("interactionCreate", this.handleInteraction.bind(this));

    if (!process.env.DISCORD_TOKEN) {
      throw new Error("DISCORD_TOKEN is required");
    }
    await this.client.login(process.env.DISCORD_TOKEN);

    if (!process.env.DISCORD_GUILD_ID) {
      throw new Error("DISCORD_GUILD_ID is required");
    }
    this.guild = await this.client.guilds.fetch(process.env.DISCORD_GUILD_ID);

    if (!process.env.DISCORD_CHANNEL_ID) {
      throw new Error("DISCORD_CHANNEL_ID is required");
    }
    this.discordChannelId = process.env.DISCORD_CHANNEL_ID;
  }

  private async handleMessage(message: Message) {
    // Ignore messages from bots to prevent potential loops
    if (message.author.bot) return;

    try {
      // You can add custom prefix checking here if needed
      // Example: if (!message.content.startsWith('!')) return;

      // Process the message
      elizaLogger.log(
        `Message received from ${message.author.username}: ${message.content}`
      );

      // Example of how to respond to messages
      // You can customize this based on your needs
      const response = await this.processMessage(message);
      if (response) {
        await message.reply(response);
      }
    } catch (error) {
      elizaLogger.error(`Error handling message: ${error.message}`, error.stack);
    }
  }

  private async processMessage(
    message: Message
  ): Promise<string | BaseMessageOptions | null> {
    // Add your message processing logic here
    // Example: Command handling
    const content = message.content.toLowerCase();

    // Example commands
    if (content === "!ping") {
      return "Pong!";
    }

    if (content === "!roles") {
      const roles = await this.getRolesByUserId(message.author.id);
      return `Your roles: ${roles?.join(", ") || "No roles found"}`;
    }

    // Return null if no response is needed
    return null;
  }

  private async handleInteraction(interaction: Interaction) {
    if (!interaction.isButton()) return;

    try {
      // Acknowledge the interaction immediately
      await interaction.deferUpdate();

      // Process the interaction
      elizaLogger.log("Interaction received:", interaction.customId);
    } catch (error) {
      elizaLogger.error(
        `Error handling interaction: ${error.message}`,
        error.stack
      );
    }
  }

  async getUsersAndRoles(): Promise<Array<{ user: string; roles: string[] }>> {
    await this.guild.members.fetch();

    return this.guild.members.cache.map((member) => ({
      user: `${member.user.username}`, // Updated to remove discriminator as it's being phased out
      roles: member.roles.cache
        .filter((role) => role.name !== "@everyone")
        .map((role) => role.name),
    }));
  }

  async getRolesByUserId(userId: string): Promise<string[] | null> {
    try {
      const member = await this.guild.members.fetch(userId);

      if (!member) {
        return null;
      }

      return member.roles.cache
        .filter((role) => role.name !== "@everyone")
        .map((role) => role.name);
    } catch (error) {
      elizaLogger.error(`Error fetching roles for user ${userId}:`, error);
      return null;
    }
  }

  async sendMessage(
    channelId: string,
    message: string | BaseMessageOptions
  ): Promise<void> {
    const channel = (await this.client.channels.fetch(
      channelId
    )) as TextChannel;
    await channel.send(message);
  }

  async getLatestMessage(channelId: string): Promise<Message | undefined> {
    const channel = (await this.client.channels.fetch(
      channelId
    )) as TextChannel;
    const messages = await channel.messages.fetch({ limit: 1 });
    return messages.first();
  }
  async stop() {
    try {
      // disconnect websocket
      // this unbinds all the listeners
      await this.client.destroy();
    } catch (e) {
      elizaLogger.error("client-discord instance stop err", e);
    }
  }
}
