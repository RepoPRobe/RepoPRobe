import { githubApp } from "../../github/client";

/**
 * check: run conflict detection
 * status: PR info stored in our system, like: tracked, processingStatus and more
 * track: mark PR status to tracked
 * untrack: mark PR status to untracked
 * help: list all the commands supported by our system
 */
export const SupportedCommentCommands = [
    'check',
    'status',
    'track',
    'untrack',
    'help',
]

export async function postComment(installationId: number, repoName: string, repoOwnerLogin: string, issueNumber: number, body: string): Promise<number> {
    const octokit = await githubApp.getInstallationOctokit(installationId);
    const postedComment = await octokit.rest.issues.createComment({
        owner: repoOwnerLogin,
        repo: repoName,
        issue_number: issueNumber,
        body: body,
    });
    return postedComment.data.id;
}

export async function addCommentReaction(
    installationId: number,
    repoName: string,
    repoOwnerLogin: string,
    commentId: number,
    content: 'eyes' | '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket'
) {
    const octokit = await githubApp.getInstallationOctokit(installationId);
    await octokit.rest.reactions.createForIssueComment({
        owner: repoOwnerLogin,
        repo: repoName,
        comment_id: commentId,
        content: content,
    });
}
