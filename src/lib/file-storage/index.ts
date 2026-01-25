import { IS_DEV } from "lib/const";
import logger from "logger";
import type { FileStorage } from "./file-storage.interface";
import { createLocalFileStorage } from "./local-file-storage";

export type FileStorageDriver = "local";

declare global {
  // eslint-disable-next-line no-var
  var __server__file_storage__: FileStorage | undefined;
}

const storageDriver: FileStorageDriver = "local";

const createFileStorage = (): FileStorage => {
  logger.info(`Creating file storage: ${storageDriver}`);
  return createLocalFileStorage();
};

const serverFileStorage =
  globalThis.__server__file_storage__ || createFileStorage();

if (IS_DEV) {
  globalThis.__server__file_storage__ = serverFileStorage;
}

export { serverFileStorage, storageDriver };
