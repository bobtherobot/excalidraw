/**
 * flow addition (additive, standalone): pure canvas-search match computation,
 * extracted from the logic in `components/SearchMenu.tsx` so a host app can run
 * text search WITHOUT mounting Excalidraw's search sidebar. Kept as its own file
 * (helpers duplicated rather than refactored out of SearchMenu) so the fork diff
 * stays additive and easy to rebase on upstream.
 *
 * `getSearchMatches(query, elements)` returns, per match, the element id, the
 * character index, a text preview, and the per-line highlight rectangles
 * (`matchedLines`) in the element's local coordinate space — exactly the shape
 * `AppState.searchMatches` consumes, so the host can set it via `updateScene`
 * and the interactive canvas renders the highlights.
 */
import { measureText } from "./element/textMeasurements";
import { getFontString } from "./utils";
import { isTextElement } from "./element";
import type { ExcalidrawElement, ExcalidrawTextElement } from "./element/types";

export type SearchMatchLine = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

export type SearchMatchPreview = {
  indexInSearchQuery: number;
  previewText: string;
  moreBefore: boolean;
  moreAfter: boolean;
};

export type SearchResult = {
  id: string;
  index: number;
  preview: SearchMatchPreview;
  matchedLines: SearchMatchLine[];
};

const escapeSpecialCharacters = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
};

const normalizeWrappedText = (
  wrappedText: string,
  originalText: string,
): string => {
  const wrappedLines = wrappedText.split("\n");
  const normalizedLines: string[] = [];
  let originalIndex = 0;

  for (let i = 0; i < wrappedLines.length; i++) {
    let currentLine = wrappedLines[i];
    const nextLine = wrappedLines[i + 1];

    if (nextLine) {
      const nextLineIndexInOriginal = originalText.indexOf(
        nextLine,
        originalIndex,
      );

      if (nextLineIndexInOriginal > currentLine.length + originalIndex) {
        let j = nextLineIndexInOriginal - (currentLine.length + originalIndex);

        while (j > 0) {
          currentLine += " ";
          j--;
        }
      }
    }

    normalizedLines.push(currentLine);
    originalIndex = originalIndex + currentLine.length;
  }

  return normalizedLines.join("\n");
};

const getMatchedLines = (
  textElement: ExcalidrawTextElement,
  searchQuery: string,
  index: number,
): SearchMatchLine[] => {
  const normalizedText = normalizeWrappedText(
    textElement.text,
    textElement.originalText,
  );

  const lines = normalizedText.split("\n");

  const lineIndexRanges = [];
  let currentIndex = 0;
  let lineNumber = 0;

  for (const line of lines) {
    const startIndex = currentIndex;
    const endIndex = startIndex + line.length - 1;

    lineIndexRanges.push({
      line,
      startIndex,
      endIndex,
      lineNumber,
    });

    currentIndex = endIndex + 1;
    lineNumber++;
  }

  let startIndex = index;
  let remainingQuery = textElement.originalText.slice(
    index,
    index + searchQuery.length,
  );
  const matchedLines: SearchMatchLine[] = [];

  for (const lineIndexRange of lineIndexRanges) {
    if (remainingQuery === "") {
      break;
    }

    if (
      startIndex >= lineIndexRange.startIndex &&
      startIndex <= lineIndexRange.endIndex
    ) {
      const matchCapacity = lineIndexRange.endIndex + 1 - startIndex;
      const textToStart = lineIndexRange.line.slice(
        0,
        startIndex - lineIndexRange.startIndex,
      );

      const matchedWord = remainingQuery.slice(0, matchCapacity);
      remainingQuery = remainingQuery.slice(matchCapacity);

      const offset = measureText(
        textToStart,
        getFontString(textElement),
        textElement.lineHeight,
      );

      // measureText returns a non-zero width for the empty string
      // which is not what we're after here, hence the check and the correction
      if (textToStart === "") {
        offset.width = 0;
      }

      if (textElement.textAlign !== "left" && lineIndexRange.line.length > 0) {
        const lineLength = measureText(
          lineIndexRange.line,
          getFontString(textElement),
          textElement.lineHeight,
        );

        const spaceToStart =
          textElement.textAlign === "center"
            ? (textElement.width - lineLength.width) / 2
            : textElement.width - lineLength.width;
        offset.width += spaceToStart;
      }

      const { width, height } = measureText(
        matchedWord,
        getFontString(textElement),
        textElement.lineHeight,
      );

      const offsetX = offset.width;
      const offsetY = lineIndexRange.lineNumber * offset.height;

      matchedLines.push({
        offsetX,
        offsetY,
        width,
        height,
      });

      startIndex += matchCapacity;
    }
  }

  return matchedLines;
};

const getMatchPreview = (
  text: string,
  index: number,
  searchQuery: string,
): SearchMatchPreview => {
  const WORDS_BEFORE = 2;
  const WORDS_AFTER = 5;

  const substrBeforeQuery = text.slice(0, index);
  const wordsBeforeQuery = substrBeforeQuery.split(/\s+/);
  const isQueryCompleteBefore = substrBeforeQuery.endsWith(" ");
  const startWordIndex =
    wordsBeforeQuery.length -
    WORDS_BEFORE -
    1 -
    (isQueryCompleteBefore ? 0 : 1);
  let wordsBeforeAsString =
    wordsBeforeQuery.slice(startWordIndex <= 0 ? 0 : startWordIndex).join(" ") +
    (isQueryCompleteBefore ? " " : "");

  const MAX_ALLOWED_CHARS = 20;

  wordsBeforeAsString =
    wordsBeforeAsString.length > MAX_ALLOWED_CHARS
      ? wordsBeforeAsString.slice(-MAX_ALLOWED_CHARS)
      : wordsBeforeAsString;

  const substrAfterQuery = text.slice(index + searchQuery.length);
  const wordsAfter = substrAfterQuery.split(/\s+/);
  const isQueryCompleteAfter = !substrAfterQuery.startsWith(" ");
  const numberOfWordsToTake = isQueryCompleteAfter
    ? WORDS_AFTER + 1
    : WORDS_AFTER;
  const wordsAfterAsString =
    (isQueryCompleteAfter ? "" : " ") +
    wordsAfter.slice(0, numberOfWordsToTake).join(" ");

  return {
    indexInSearchQuery: wordsBeforeAsString.length,
    previewText: wordsBeforeAsString + searchQuery + wordsAfterAsString,
    moreBefore: startWordIndex > 0,
    moreAfter: wordsAfter.length > numberOfWordsToTake,
  };
};

/**
 * Compute all matches of `query` across the text elements in `elements`.
 * Results are ordered top-to-bottom (by element y). Returns an empty array for
 * an empty query. Mirrors SearchMenu's `handleSearch` minus the app-specific
 * visibility/focus bookkeeping, which the host owns.
 */
export const getSearchMatches = (
  query: string,
  elements: readonly ExcalidrawElement[],
): SearchResult[] => {
  if (!query) {
    return [];
  }

  const texts = (elements.filter((el) => isTextElement(el)) as ExcalidrawTextElement[])
    .slice()
    .sort((a, b) => a.y - b.y);

  const results: SearchResult[] = [];
  const regex = new RegExp(escapeSpecialCharacters(query), "gi");

  for (const textEl of texts) {
    let match = null;
    const text = textEl.originalText;

    while ((match = regex.exec(text)) !== null) {
      const preview = getMatchPreview(text, match.index, query);
      const matchedLines = getMatchedLines(textEl, query, match.index);

      if (matchedLines.length > 0) {
        results.push({
          id: textEl.id,
          index: match.index,
          preview,
          matchedLines,
        });
      }
    }
  }

  return results;
};
