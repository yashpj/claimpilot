import { PipeTransform, BadRequestException } from "@nestjs/common";
import type { z } from "zod";

// Use per-parameter: @Body(new ZodValidationPipe(schema)). Method-level
// @UsePipes would also run it against @Param/@Query values.
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues);
    }
    return result.data; // parsed + typed (unknown keys stripped)
  }
}
