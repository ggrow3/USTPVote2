import { PHOTO_FLAGS, type PhotoFlag, type ProfilePhotoRecord } from 'ustp-domain';

/** What a member can do about each thing the automatic check flags (design §5.3). */
export const FLAG_ADVICE: Readonly<Record<PhotoFlag, string>> = {
  [PHOTO_FLAGS.noFace]: 'Use a photo that shows your face.',
  [PHOTO_FLAGS.severalFaces]: 'Use a photo of just you.',
  [PHOTO_FLAGS.faceUnclear]: 'Face the camera, with nothing covering your face.',
  [PHOTO_FLAGS.blurry]: 'Use a sharper photo, with the camera held steady.',
  [PHOTO_FLAGS.dark]: 'Take the photo in better light.',
  [PHOTO_FLAGS.inappropriate]: 'Use an ordinary portrait photo.',
};

export interface FaceCheckMessage {
  /** `passed`: nothing to do; `flagged`: waiting for a person; `rejected`: a person turned it down. */
  readonly tone: 'passed' | 'flagged' | 'rejected';
  readonly text: string;
  /** One tip per flag, in the check's order. */
  readonly advice: readonly string[];
}

/** The member's own photo, as the automatic face and quality check and any review left it, in words. */
export function faceCheckMessage(photo: Pick<ProfilePhotoRecord, 'status' | 'flags' | 'decisionReason'>): FaceCheckMessage {
  const found = photo.flags.join(', ');
  const advice = photo.flags.map((f) => FLAG_ADVICE[f as PhotoFlag]).filter((a): a is string => !!a);
  switch (photo.status) {
    case 'rejected':
      return {
        tone: 'rejected',
        text: `A Membership Admin did not accept this photo${photo.decisionReason ? `: ${photo.decisionReason}` : ''}. Please upload a new one.`,
        advice,
      };
    case 'needs_review':
      return {
        tone: 'flagged',
        text: `The automatic check found: ${found}. A Membership Admin will look at it, or you can upload a better photo now.`,
        advice,
      };
    default:
      return photo.flags.length
        ? { tone: 'passed', text: `A Membership Admin accepted this photo after the automatic check found: ${found}.`, advice: [] }
        : { tone: 'passed', text: 'The automatic check passed: one face, clearly visible, in focus and well lit.', advice: [] };
  }
}

/**
 * Why the member's Gravatar could not be fetched (`GET /v1/me/photo/gravatar` answered `status` with `detail`), in
 * words; each case points to uploading instead.
 */
export function gravatarProblem(status: number, detail: string, email: string | null): string {
  if (status === 404) return `Gravatar has no picture for ${email ?? 'your address'}, or none rated G. You can upload a photo instead.`;
  if (status === 503) return 'Gravatar is not answering right now. Try again shortly, or upload a photo instead.';
  const sentence = detail.replace(/\.$/, '');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. You can upload a photo instead.`;
}
