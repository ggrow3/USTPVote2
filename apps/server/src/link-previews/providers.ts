import type { Provider } from '@nestjs/common';
import { LegislationPreviews, PublicBillPreviews, ScorecardMemberPreviews, ScorecardPreviews } from '../bills/legislation-preview.js';
import { CandidacyPreviews } from '../candidacies/candidacy-preview.js';
import { EventPreviews } from '../communications/event-preview.js';
import { PersonPreviews, SeatRacePreviews, StateRacePreviews } from '../candidacies/race-preview.js';
import { NewsPreviews } from '../communications/news-preview.js';
import { CertificatePreviews } from '../course/certificate-preview.js';
import { CoursePreviews } from '../course/course-preview.js';
import { ResultsPreviews } from '../elections/results-preview.js';
import { LinkCardsController, LinkPreviewPagesController } from './link-previews.controller.js';
import { HostedIndexHtml, INDEX_HTML, LINK_PREVIEW_SOURCES, LinkCardImages, LinkPreviewService, type LinkPreviewSource } from './link-previews.js';

/**
 * Each preview page's source (design §15, "Link previews"), one per entry of `PREVIEW_PAGES`; the service refuses to
 * start with one missing. A new preview page adds its source here and to `PREVIEW_PAGES` and `firebase.json`.
 */
const SOURCES = [
  NewsPreviews,
  CandidacyPreviews,
  CoursePreviews,
  CertificatePreviews,
  ResultsPreviews,
  EventPreviews,
  LegislationPreviews,
  PublicBillPreviews,
  ScorecardPreviews,
  ScorecardMemberPreviews,
  StateRacePreviews,
  SeatRacePreviews,
  PersonPreviews,
];

export const LINK_PREVIEW_PROVIDERS: Provider[] = [
  ...SOURCES,
  { provide: LINK_PREVIEW_SOURCES, inject: SOURCES, useFactory: (...sources: LinkPreviewSource[]) => sources },
  { provide: INDEX_HTML, useClass: HostedIndexHtml },
  LinkPreviewService,
  LinkCardImages,
];

export const LINK_PREVIEW_CONTROLLERS = [LinkPreviewPagesController, LinkCardsController];
