import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";
import { StorageService } from "./storage.service";
import { SupabaseStorageService } from "./supabase-storage.service";
import { LocalStorageService } from "./local-storage.service";

@Global()
@Module({
  providers: [
    {
      // The abstract class is the token: inject `StorageService`, get a driver.
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService => {
        const driver = config.get<string>("STORAGE_DRIVER") ?? "local";
        if (driver === "supabase") {
          return new SupabaseStorageService(
            createClient(
              config.getOrThrow("SUPABASE_URL"),
              config.getOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
            ),
          );
        }
        return new LocalStorageService(
          config.get<string>("LOCAL_STORAGE_DIR") ?? ".data/uploads",
        );
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
