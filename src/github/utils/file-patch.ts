import { HunkType } from "../../db/schema/PullRequestFile";

type Line = {
    type: 'context';
    oldFileLineNumber: number;
    newFileLineNumber: number;
    content: string;
} | {
    type: 'added';
    newFileLineNumber: number;
    content: string;
} | {
    type: 'removed';
    oldFileLineNumber: number;
    content: string;
};

type Hunk = {
    oldFileStartLine: number;
    oldFilePatchLinesCount: number;
    newFileStartLine: number;
    newFilePatchLinesCount: number;
    lines: Line[];
};

type Status = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

type PatchObject = {
    file: string;
    status: Status;
    previousFilePath?: string; // available when status is 'renamed'
    hunks: Hunk[];
}

type File = {
    filename: string;
    status: Status;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
    previous_filename?: string;
};

export function processPullRequestFiles(data: File[]) {
    const processedData: PatchObject[] = [];
    data.forEach(file => {
        processedData.push(getPatchObject(file));
    });
    return processedData;
}

/**
 * Parses a raw git patch string into structured hunk data.
 *
 * Expected input format (GitHub patch field from listFiles API):
 *
 * @@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@ <optional context>
 *  <context line>        (unchanged, starts with space)
 * -<removed line>        (removed from old file, starts with -)
 * +<added line>          (added in new file, starts with +)
 *  <context line>
 * @@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@   (next hunk)
 * ...
 *
 * Example:
 * @@ -5,7 +5,9 @@
 *  const a = 1;
 * -const b = 2;
 * +const b = 99;
 * +const b2 = 100;
 *  const c = 3;
 *
 * Special cases handled:
 * - '\ No newline at end of file' → skip, not a real line
 * - '-0,0' in hunk header → new file (added), old file didn't exist
 * - '+0,0' in hunk header → deleted file, new file doesn't exist
 * - 'patch' is undefined → binary file or GitHub truncated it, return empty
 * - count omitted in hunk header (e.g. '-1' instead of '-1,1') → count defaults to 1
 */
function getPatchObject(file: File): PatchObject {
    if (!file.patch) {
        return {
            file: file.filename,
            status: file.status,
            previousFilePath: file.previous_filename,
            hunks: [],
        };
    }
    const patchArr = file.patch.split("\n");
    const hunks: Hunk[] = [];
    let hunkIdx = -1;
    let contextLinesProcessed = 0;
    let removedLinesProcessed = 0;
    let addedLinesProcessed = 0;

    patchArr.forEach(patchLine => {
        if (patchLine.trimEnd() === '\\ No newline at end of file') {
            return;
        }

        if (patchLine.startsWith("@@")) { // hunk line
            const { oldFileStartLine, oldFilePatchLinesCount, newFileStartLine, newFilePatchLinesCount } = parseHunkLine(patchLine);
            hunks.push({
                oldFileStartLine,
                newFileStartLine,
                oldFilePatchLinesCount,
                newFilePatchLinesCount,
                lines: [],
            });
            hunkIdx++;
            contextLinesProcessed = 0;
            removedLinesProcessed = 0;
            addedLinesProcessed = 0;
        } else if (patchLine.charAt(0) == '+') { // addition line
            addedLinesProcessed++;

            const { newFileStartLine, lines } = hunks[hunkIdx];
            lines.push({
                type: 'added',
                newFileLineNumber: newFileStartLine + contextLinesProcessed + addedLinesProcessed - 1,
                content: patchLine,
            });
        } else if (patchLine.charAt(0) == '-') { // removal/modification line
            removedLinesProcessed++;

            const { oldFileStartLine, lines } = hunks[hunkIdx];
            lines.push({
                type: 'removed',
                oldFileLineNumber: oldFileStartLine + contextLinesProcessed + removedLinesProcessed - 1,
                content: patchLine,
            });
        } else if (patchLine.charAt(0) == ' ') { // context line
            contextLinesProcessed++;

            const { oldFileStartLine, newFileStartLine, lines } = hunks[hunkIdx];
            lines.push({
                type: 'context',
                oldFileLineNumber: oldFileStartLine + contextLinesProcessed + removedLinesProcessed - 1,
                newFileLineNumber: newFileStartLine + contextLinesProcessed + addedLinesProcessed - 1,
                content: patchLine,
            });
        }
    });

    return {
        file: file.filename,
        status: file.status,
        previousFilePath: file.previous_filename,
        hunks,
    } satisfies PatchObject;
}

/**
 * Parses hunk line like: @@ -2,4 +2,6 @@ function login() {
 *
 * Output:
 * {
 *  oldFileStartLine: 2,
 *  oldFilePatchLinesCount: 4,
 *  newFileStartLine: 2,
 *  newFilePatchLinesCount: 6
 * }
 */
function parseHunkLine(hunkLine: string) {
    const parsedHunk = hunkLine.substring(3, hunkLine.lastIndexOf('@@')).split(' ');
    const oldFileChanges = parsedHunk[0].split(',');
    const newFileChanges = parsedHunk[1].split(',');
    return {
        oldFileStartLine: Math.abs(parseInt(oldFileChanges[0])),
        oldFilePatchLinesCount: parseInt(oldFileChanges[1]),
        newFileStartLine: Math.abs(parseInt(newFileChanges[0])),
        newFilePatchLinesCount: parseInt(newFileChanges[1]),
    }
}

export function areOverlapingHunks(fileAHunk: Omit<Hunk, 'lines'>, fileBHunk: Omit<Hunk, 'lines'>): boolean {
    function doesRangesOverlap(
        aStart: number,
        aEnd: number,
        bStart: number,
        bEnd: number,
    ) {
        return aStart <= bEnd && bStart <= aEnd;
    }
    const {
        oldStart: fileAOldStart,
        oldEnd: fileAOldEnd,
        newStart: fileANewStart,
        newEnd: fileANewEnd,
    } = getHunkLineRange(fileAHunk);

    const {
        oldStart: fileBOldStart,
        oldEnd: fileBOldEnd,
        newStart: fileBNewStart,
        newEnd: fileBNewEnd,
    } = getHunkLineRange(fileBHunk);

    /**
     * In total 4 comparisions:
     * A.old -> B.old
     * A.old -> B.new
     * A.new -> B.old
     * A.new -> B.new
     */
    const isAOldOverlappingWithBOld = doesRangesOverlap(fileAOldStart, fileAOldEnd, fileBOldStart, fileBOldEnd);
    const isAOldOverlappingWithBNew = doesRangesOverlap(fileAOldStart, fileAOldEnd, fileBNewStart, fileBNewEnd);
    const isANewOverlappingWithBOld = doesRangesOverlap(fileANewStart, fileANewEnd, fileBOldStart, fileBOldEnd);
    const isANewOverlappingWithBNew = doesRangesOverlap(fileANewStart, fileANewEnd, fileBNewStart, fileBNewEnd);

    return (
        isAOldOverlappingWithBOld ||
        isAOldOverlappingWithBNew ||
        isANewOverlappingWithBOld ||
        isANewOverlappingWithBNew
    );
}

export function getHunkLineRange(hunk: Omit<Hunk, 'lines'>): { oldStart: number, oldEnd: number, newStart: number, newEnd: number } {
    return {
        oldStart: hunk.oldFileStartLine,
        oldEnd: hunk.oldFileStartLine + hunk.oldFilePatchLinesCount - 1,
        newStart: hunk.newFileStartLine,
        newEnd: hunk.newFileStartLine + hunk.newFilePatchLinesCount - 1,
    }
}

export function getConflictingLinesFromHunks(hunkA: HunkType, hunkB: HunkType): { hasConflicts: boolean, removedLines: number[], addedLines: number[] } {
    const conflictingRemovedLines: number[] = [];
    const conflictingAddedLines: number[] = [];
    const hunkBRemovedLineNumbers = new Map<number, string>();
    const hunkBAddedLineNumbers = new Map<number, string>();

    hunkB.lines.forEach(line => {
        if (line.type === 'added' && line.newFileLineNumber) {
            hunkBAddedLineNumbers.set(line.newFileLineNumber, line.content);
        }
        if (line.type === 'removed' && line.oldFileLineNumber) {
            hunkBRemovedLineNumbers.set(line.oldFileLineNumber, line.content);
        }
    });

    hunkA.lines.forEach(line => {
        const addedLineNumber = line.newFileLineNumber;
        const removedLineNumber = line.oldFileLineNumber;

        if (
            line.type === 'added'
            && addedLineNumber
            && hunkBAddedLineNumbers.has(addedLineNumber)
            && hunkBAddedLineNumbers.get(addedLineNumber) !== line.content
        ) {
            conflictingAddedLines.push(addedLineNumber);
        }
        if (
            line.type === 'removed'
            && removedLineNumber
            && hunkBRemovedLineNumbers.has(removedLineNumber)
            && hunkBRemovedLineNumbers.get(removedLineNumber) !== line.content
        ) {
            conflictingRemovedLines.push(removedLineNumber);
        }
    });

    return {
        hasConflicts: conflictingRemovedLines.length > 0 || conflictingAddedLines.length > 0,
        removedLines: conflictingRemovedLines,
        addedLines: conflictingAddedLines,
    }
}
