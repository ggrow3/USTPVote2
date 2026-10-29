import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  createCommentSchema,
  createPostSchema,
  dismissReportsSchema,
  editCommentSchema,
  editPostSchema,
  forumBallotSchema,
  forumListQuerySchema,
  forumReportSchema,
  forumVoteSchema,
  moderationSchema,
  type CreateCommentInput,
  type CreatePostInput,
  type DismissReportsInput,
  type EditCommentInput,
  type EditPostInput,
  type ForumBallotInput,
  type ForumListQuery,
  type ForumReportInput,
  type ModerationInput,
} from 'ustp-domain';
import { z } from 'zod';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { consoleCaller, ForumService, memberCaller } from './forum.service.js';

type Vote = z.infer<typeof forumVoteSchema>;
const member = (ctx: RequestContext) => memberCaller(requireAccount(ctx));
const atConsole = (ctx: RequestContext) => consoleCaller(ctx, requireAccount(ctx));

/**
 * The forum for Active members (design §5.9): read the lists and threads, post discussions and proposals, comment and
 * reply, vote posts and comments up or down, report them to Membership Admins, and change or delete their own.
 */
@Controller('v1/forum')
export class ForumController {
  constructor(private readonly forum: ForumService) {}

  @Get('posts')
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(forumListQuerySchema)) query: ForumListQuery) {
    return this.forum.list(member(ctx), query);
  }

  @Post('posts')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createPostSchema)) body: CreatePostInput) {
    return this.forum.create(member(ctx), body);
  }

  @Get('posts/:postId')
  thread(@Ctx() ctx: RequestContext, @Param('postId') postId: string) {
    return this.forum.thread(member(ctx), postId);
  }

  @Put('posts/:postId')
  edit(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(editPostSchema)) body: EditPostInput) {
    return this.forum.edit(member(ctx), postId, body);
  }

  @Delete('posts/:postId')
  delete(@Ctx() ctx: RequestContext, @Param('postId') postId: string) {
    return this.forum.delete(member(ctx), postId);
  }

  @Put('posts/:postId/vote')
  votePost(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(forumVoteSchema)) body: Vote) {
    return this.forum.vote(member(ctx), 'post', postId, body.value);
  }

  @Post('posts/:postId/report')
  @HttpCode(204)
  async reportPost(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(forumReportSchema)) body: ForumReportInput) {
    await this.forum.report(member(ctx), 'post', postId, body);
  }

  /** A comment on the post, or with `parentId` a reply to one of its comments. */
  @Post('posts/:postId/comments')
  comment(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(createCommentSchema)) body: CreateCommentInput) {
    return this.forum.comment(member(ctx), postId, body);
  }

  @Put('comments/:commentId')
  editComment(@Ctx() ctx: RequestContext, @Param('commentId') commentId: string, @Body(new ZodPipe(editCommentSchema)) body: EditCommentInput) {
    return this.forum.editComment(member(ctx), commentId, body);
  }

  @Delete('comments/:commentId')
  deleteComment(@Ctx() ctx: RequestContext, @Param('commentId') commentId: string) {
    return this.forum.deleteComment(member(ctx), commentId);
  }

  @Put('comments/:commentId/vote')
  voteComment(@Ctx() ctx: RequestContext, @Param('commentId') commentId: string, @Body(new ZodPipe(forumVoteSchema)) body: Vote) {
    return this.forum.vote(member(ctx), 'comment', commentId, body.value);
  }

  @Post('comments/:commentId/report')
  @HttpCode(204)
  async reportComment(
    @Ctx() ctx: RequestContext,
    @Param('commentId') commentId: string,
    @Body(new ZodPipe(forumReportSchema)) body: ForumReportInput,
  ) {
    await this.forum.report(member(ctx), 'comment', commentId, body);
  }
}

/**
 * The forum at the console (design §5.9). Membership Admins see removed posts and comments and the reports, and remove,
 * restore, lock and pin; Election Admins read the forum without needing a membership and put proposals on ballots.
 */
@Controller('v1/admin/forum')
@Roles('membership_admin')
export class ForumAdminController {
  constructor(private readonly forum: ForumService) {}

  @Get('posts')
  @Roles('membership_admin', 'election_admin')
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(forumListQuerySchema)) query: ForumListQuery) {
    return this.forum.list(atConsole(ctx), query);
  }

  @Get('posts/:postId')
  @Roles('membership_admin', 'election_admin')
  thread(@Ctx() ctx: RequestContext, @Param('postId') postId: string) {
    return this.forum.thread(atConsole(ctx), postId);
  }

  @Post('posts/:postId/moderation')
  moderatePost(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(moderationSchema)) body: ModerationInput) {
    return this.forum.moderatePost(atConsole(ctx), postId, body);
  }

  @Post('comments/:commentId/moderation')
  moderateComment(@Ctx() ctx: RequestContext, @Param('commentId') commentId: string, @Body(new ZodPipe(moderationSchema)) body: ModerationInput) {
    return this.forum.moderateComment(atConsole(ctx), commentId, body);
  }

  @Get('reports')
  reports(@Ctx() ctx: RequestContext) {
    return this.forum.reports(atConsole(ctx));
  }

  @Post('reports/dismiss')
  @HttpCode(204)
  async dismiss(@Ctx() ctx: RequestContext, @Body(new ZodPipe(dismissReportsSchema)) body: DismissReportsInput) {
    await this.forum.dismiss(atConsole(ctx), body);
  }

  /** Puts the proposal on a draft election as a proposal question (design §5.9, §6.4). */
  @Post('posts/:postId/ballot')
  @Roles('election_admin')
  ballot(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body(new ZodPipe(forumBallotSchema)) body: ForumBallotInput) {
    return this.forum.putOnBallot(ctx, atConsole(ctx), postId, body);
  }
}
