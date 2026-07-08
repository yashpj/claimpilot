import { Controller, Get, UseGuards, Req } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";

@Controller("policies")
export class PoliciesController {
  @Get()
  @UseGuards(AuthGuard) // this route now requires a valid token
  findMine(@Req() req: any) {
    return { userId: req.user.id }; // proves the guard attached the user
  }
}