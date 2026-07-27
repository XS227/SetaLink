/**
 * ChapterDetailScreen — reading/quiz view for a single chapter, opened from
 * RealGramChaptersScreen's native journey list. The actual chapter content
 * (story scenes, quiz, cinematic) is real interactive Shahnameh gameplay,
 * not something worth reimplementing natively — this just points the
 * shared ShahnamehEmbed at season2's own chapter.html for one slug, same
 * "10% RealGram / 90% Shahnameh" cinematic embed the Game tab already uses.
 */

import React from 'react';
import { ShahnamehEmbed } from '../components/ShahnamehEmbed';

interface Props {
  slug: string;
  onBack: () => void;
}

export function ChapterDetailScreen({ slug, onBack }: Props) {
  return (
    <ShahnamehEmbed
      path="/chapter.html"
      params={{ slug }}
      debugLabel="chapter"
      onBack={onBack}
    />
  );
}
