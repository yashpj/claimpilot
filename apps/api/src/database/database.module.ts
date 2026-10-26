import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@claimpilot/db";

export const DRIZZLE = Symbol("DRIZZLE"); // the injection token
export type Db = PostgresJsDatabase<typeof schema>;

@Global() // makes the provider available app-wide
@Module({
  providers: [
    {
      provide: DRIZZLE, // inject by this token
      inject: [ConfigService],
      useFactory: (config: ConfigService): Db => {
        // factory provider: Nest runs this to build the value
        // getOrThrow (not process.env!) = fail at boot with the key's name.
        const client = postgres(config.getOrThrow<string>("DATABASE_URL"), {
          max: Number(config.get("DB_POOL_MAX") ?? 10),
          // Supabase's transaction pooler (6543) does not support prepared statements.
          prepare: config.get("DB_PREPARE") !== "false",
        });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
