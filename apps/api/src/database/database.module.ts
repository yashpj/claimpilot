import { Global, Module } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@claimpilot/db"; // your shared schema package

export const DRIZZLE = Symbol("DRIZZLE"); // the injection token

@Global() // makes the provider available app-wide
@Module({
  providers: [
    {
      provide: DRIZZLE, // inject by this token
      useFactory: () => {
        // factory provider: Nest runs this to build the value
        const client = postgres(process.env.DATABASE_URL!);
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
