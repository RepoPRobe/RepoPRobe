import { ConflictType } from "../../db/schema/Conflict.js";
import { PullRequest, PullRequestType } from "../../db/schema/PullRequest.js";

/**
 * Generates below format markdown:
 * ============================================
 * 
 * ## 🔍 RepoProbe detected conflicts
 *
 * This PR has potential conflicts with other open PRs. Please coordinate with the authors before merging.
 *
 * ### PR #12
 *
 * | File | Conflicting lines |
 * |---|---:|
 * | `apps/frontend/app/dashboard/page.tsx` | 86–99 |
 *
 * ### PR #15
 *
 * | File | Conflicting lines |
 * |---|---:|
 * | `apps/websocket/src/index.ts` | 379, 385–387 |
 * | `apps/websocket/src/index.ts` | 461, 464 |
 *
 * > 🤖 Detected by [RepoProbe](https://github.com/apps/repoprobe) · Run `@RepoPRobe check` to re-scan · `@RepoPRobe help` for all commands
 */
export async function getConflictDetectionMarkdown(conflictData: ConflictType[]): Promise<string> {
    const comment: string[] = [];

    comment.push('## 🔍 RepoProbe detected conflicts');
    comment.push('This PR has potential conflicts with other open PRs. Please coordinate with the authors before merging.');

    // Group conflicts by PR and file
    const groupedConflicts = new Map<string, Map<string, ConflictType[]>>();
    
    for (const conflict of conflictData) {
        const prBKey = conflict.prBId.toString();
        if (!groupedConflicts.has(prBKey)) {
            groupedConflicts.set(prBKey, new Map());
        }
        
        const fileMap = groupedConflicts.get(prBKey)!;
        if (!fileMap.has(conflict.file)) {
            fileMap.set(conflict.file, []);
        }
        
        fileMap.get(conflict.file)!.push(conflict);
    }

    // Generate markdown per PR
    for (const [prBId, fileMap] of groupedConflicts) {
        const prBRecord = await PullRequest.findById(prBId);
        if (!prBRecord) {
            console.log(`No PR record found for conflicting PR ${prBId}`);
            continue;
        }

        // PR header
        comment.push(`### PR #${prBRecord.prNumber}`);

        // Table header
        comment.push(`| File | Conflicting removed lines | Conflicting added lines |`);
        comment.push(`|---|---:|---:|`);

        // Table body - one row per file, merging all conflicts for that file
        for (const [file, conflictsForFile] of fileMap) {
            const fileNameMarkdown = `\`${file}\``;
            
            // Merge all removed/added lines for this file
            const allRemovedLines = conflictsForFile.flatMap(c => c.conflictingLineNumbers.removed);
            const allAddedLines = conflictsForFile.flatMap(c => c.conflictingLineNumbers.added);
            
            const removedLinesMarkdown = convertLineNumbersIntoRangesMarkdown(
                allRemovedLines,
                file,
                prBRecord,
                true,
            );
            const addedLinesMarkdown = convertLineNumbersIntoRangesMarkdown(
                allAddedLines,
                file,
                prBRecord,
                false,
            );
            comment.push(`| ${fileNameMarkdown} | ${removedLinesMarkdown} | ${addedLinesMarkdown} |`);
        }
    }

    // Footer (kindof)
    comment.push(`> 🤖 Detected by [RepoProbe](https://github.com/apps/repoprobe) · Run \`@RepoPRobe check\` to re-scan · \`@RepoPRobe help\` for all commands`);

    return comment.join('\n');
}

function convertLineNumbersIntoRangesMarkdown(lineNumbers: number[], file: string, prRecord: PullRequestType, removedLines: boolean): string {
    if(lineNumbers.length === 0) return '-';

    const baseHref = prRecord.htmlUrl.split("/pull")[0];
    const sha = removedLines ? prRecord.baseBranchHeadSha : prRecord.headBranchHeadSha;
    const lineNumbersMarkdown: string[] = [];
    let start = lineNumbers[0];
    let previous = lineNumbers[0];

    const pushRange = (start: number, end: number) => {
        const range = start === end
            ? `L${start}`
            : `L${start}-L${end}`;

        const url = `${baseHref}/blob/${sha}/${file}#${range}`;
        lineNumbersMarkdown.push(`[${range}](${url})`);
    };

    for (let i = 1; i < lineNumbers.length; i++) {
        const current = lineNumbers[i];

        if (current === previous + 1) {
            previous = current;
            continue;
        }
        pushRange(start, previous);
        start = current;
        previous = current;
    }

    // Push the final range
    pushRange(start, previous);

    return lineNumbersMarkdown.join(', ');
}
