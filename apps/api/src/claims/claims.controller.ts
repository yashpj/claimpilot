import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import {
  createClaimSchema,
  sendMessageSchema,
  uploadDocumentsSchema,
  type CreateClaimInput,
  type SendMessageInput,
  type UploadDocumentsInput,
} from "@claimpilot/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  ALLOWED_MIME,
  ClaimsService,
  type UploadedFile,
} from "./claims.service";

const MAX_FILES = 6;
const MAX_BYTES = 8 * 1024 * 1024;

@Controller("claims")
@UseGuards(AuthGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.claims.list(user.id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createClaimSchema)) body: CreateClaimInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.claims.create(user.id, body.policyId);
  }

  // ParseUUIDPipe: a malformed id is a 400 here, not a 500 from Postgres.
  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.claims.getClaim(user.id, id);
  }

  @Post(":id/messages")
  message(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.claims.sendMessage(user.id, id, body.text);
  }

  // multipart/form-data: files[] + type. Memory storage is fine at 8MB x 6;
  // bytes go straight to object storage, never to local disk in the pod.
  @Post(":id/documents")
  @UseInterceptors(
    FilesInterceptor("files", MAX_FILES, {
      limits: { fileSize: MAX_BYTES },
      fileFilter: (_req, file, cb) =>
        ALLOWED_MIME.includes(file.mimetype)
          ? cb(null, true)
          : cb(
              new BadRequestException(`Unsupported file type ${file.mimetype}`),
              false,
            ),
    }),
  )
  upload(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(uploadDocumentsSchema))
    body: UploadDocumentsInput,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!files?.length) throw new BadRequestException("No files uploaded");
    return this.claims.uploadDocuments(user.id, id, body, files);
  }

  @Get(":id/documents/:docId/content")
  async document(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("docId", ParseUUIDPipe) docId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const { data, mimeType } = await this.claims.getDocumentContent(
      user.id,
      id,
      docId,
    );
    return new StreamableFile(data, { type: mimeType });
  }
}
