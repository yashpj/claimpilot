import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";
import { StorageService } from "./storage.service";

export const SUPABASE_STORAGE = Symbol("SUPABASE_STORAGE");

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createClient(
          config.getOrThrow("SUPABASE_URL"),
          config.getOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
        ),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
