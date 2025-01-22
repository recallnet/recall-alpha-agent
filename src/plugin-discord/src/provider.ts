// import { Provider, IAgentRuntime, Memory, State } from "@elizaos/core";
// import {
//     GateDataProviderResponseGet,
//     NonceProviderResponseGet,
// } from "./types.ts";
// import { StorageService } from "./services/storage.service.ts";
// import { randomBytes } from "crypto";

// export const gateDataProvider: Provider = {
//     get: async (
//         _runtime: IAgentRuntime,
//         _message: Memory,
//         _state?: State
//     ): Promise<GateDataProviderResponseGet> => {
//         try {
//             const storageService = StorageService.getInstance();
//             await storageService.start();

//             return {
//                 success: true,
//                 provider: storageService,
//             };
//         } catch (error) {
//             return {
//                 success: false,
//                 error:
//                     error instanceof Error
//                         ? error.message
//                         : "Failed to fetch weather data",
//             };
//         }
//     },
// };

// export const nonceProvider: Provider = {
//     get: async (
//         _runtime: IAgentRuntime,
//         _message: Memory,
//         _state?: State
//     ): Promise<NonceProviderResponseGet> => {
//         try {
//             const nonce = randomBytes(10).toString("hex");
//             return {
//                 success: true,
//                 nonce,
//             };
//         } catch (error) {
//             return {
//                 success: false,
//                 error:
//                     error instanceof Error
//                         ? error.message
//                         : "Failed to fetch weather data",
//             };
//         }
//     },
// };
