import type { Provider } from '@nestjs/common';
import { CandidacyPreviews } from '../candidacies/candidacy-preview.js';
import { NewsPreviews } from '../communications/news-preview.js';
import { PollPreviews } from '../communications/poll-preview.js';
import { CoursePreviews } from '../course/course-preview.js';
import { ResultsPreviews } from '../elections/results-preview.js';
import { LinkCardsController, LinkPreviewPagesController } from './link-previews.controller.js';
import { HostedIndexHtml, INDEX_HTML, LINK_PREVIEW_SOURCES, LinkCardImages, LinkPreviewService, type LinkPreviewSource } from './link-previews.js';

/**
 * Each preview page's source (design §15, "Link previews"), one per entry of `PREVIEW_PAGES`; the service refuses to
 * start with one missing. A new preview page adds its source here and to `PREVIEW_PAGES` and `firebase.json`.
 */
const SOURCES = [NewsPreviews, CandidacyPreviews, CoursePreviews, ResultsPreviews, PollPreviews];

export const LINK_PREVIEW_PROVIDERS: Provider[] = [
  ...SOURCES,
  { provide: LINK_PREVIEW_SOURCES, inject: SOURCES, useFactory: (...sources: LinkPreviewSource[]) => sources },
  { provide: INDEX_HTML, useClass: HostedIndexHtml },
  LinkPreviewService,
  LinkCardImages,
];

export const LINK_PREVIEW_CONTROLLERS = [LinkPreviewPagesController, LinkCardsController];
