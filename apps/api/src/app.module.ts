import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { PoliciesModule } from "./policies/policies.module";

@Module({
  imports: [DatabaseModule, PoliciesModule],
})
export class AppModule {}