import { Logger } from "./types.js";

export function createLogger(verboseEnabled: boolean): Logger {
  return {
    info(message: string) {
      console.log(message);
    },
    verbose(message: string) {
      if (verboseEnabled) {
        console.log(`[verbose] ${message}`);
      }
    },
    warn(message: string) {
      console.warn(`[warn] ${message}`);
    },
    error(message: string) {
      console.error(`[error] ${message}`);
    },
  };
}
