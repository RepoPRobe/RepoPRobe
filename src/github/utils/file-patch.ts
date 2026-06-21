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


// const testData: File[] = [
//     {
//         filename: 'gpt.js',
//         status: 'modified',
//         additions: 3,
//         deletions: 1,
//         changes: 4,
//         patch: '@@ -2,4 +2,6 @@ function login() {\n' +
//             '     console.log("Hello");\n' +
//             '     console.log("Another hello");\n' +
//             '     console.log("Last Hello");\n' +
//             '-}\n' +
//             '\\ No newline at end of file\n' +
//             '+    const c = 1231;\n' +
//             '+    const d = 412312;\n' +
//             '+}'
//     },
//     {
//         filename: 'claude.js',
//         status: 'modified',
//         additions: 6,
//         deletions: 6,
//         changes: 12,
//         patch: '@@ -4,17 +4,17 @@ const c = 3;\n' +
//             ' const d = 4;\n' +
//             ' const e = 5;\n' +
//             ' const f = 6;\n' +
//             '-const g = 7;\n' +
//             '+const g = 700;\n' +
//             ' const h = 8;\n' +
//             ' const i = 9;\n' +
//             '-const j = 10;\n' +
//             '+const j = 100;\n' +
//             ' const k = 11;\n' +
//             ' const l = 12;\n' +
//             '-const m = 13;\n' +
//             '+const m = 1300;\n' +
//             ' const n = 14;\n' +
//             ' const o = 15;\n' +
//             ' const p = 16;\n' +
//             '-const q = 17;\n' +
//             '+const q = 1700;\n' +
//             ' const r = 18;\n' +
//             '-const s = 19;\n' +
//             '-const t = 20;\n' +
//             '\\ No newline at end of file\n' +
//             '+const s = 190;\n' +
//             '+const t = 200;'
//     }
// ];

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
function getPatchObject(file: File) {
    if (!file.patch) {
        return {
            file: file.filename,
            status: file.status,
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

            const { oldFileStartLine, newFileStartLine, lines } = hunks[hunkIdx];
            lines.push({
                type: 'added',
                newFileLineNumber: newFileStartLine + contextLinesProcessed + addedLinesProcessed - 1,
                content: patchLine,
            });
        } else if (patchLine.charAt(0) == '-') { // removal/modification line
            removedLinesProcessed++;

            const { oldFileStartLine, newFileStartLine, lines } = hunks[hunkIdx];
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
