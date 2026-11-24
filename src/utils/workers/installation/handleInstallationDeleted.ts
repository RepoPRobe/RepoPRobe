import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { Repo } from "../../../db/schema/Repo.js";
import { InstallationDeleted } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { PullRequestFile } from "../../../db/schema/PullRequestFile.js";
import mongoose from "mongoose";
import { Conflict } from "../../../db/schema/Conflict.js";
import { RepoConfig } from "../../../db/schema/RepoConfig.js";
import { ActivityLog } from "../../../db/schema/ActivityLogs.js";

/**
 * Handles the GitHub App installation.deleted webhook event.
 *
 * Permanently removes the installation and all associated records from the database,
 * including repositories, pull requests, pull request files, conflicts, repository
 * configurations, and activity logs.
 *
 * All deletion operations are performed within a MongoDB transaction to ensure
 * atomicity and prevent partially deleted installation data.
 *
 * If the installation record does not exist, the operation is skipped.
 * If cleanup fails, the transaction is aborted and an error activity log is
 * recorded against the installation, provided its record still exists.
 *
 */
export async function handleInstallationDeleted(payload: InstallationDeleted) {
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            // fetch the installation record to get the internal _id
            const githubInstallationRecord = await GithubInstallation.findOne(
                { installationId: payload.installationId }, { _id: 1 }
            ).session(session);
            if (!githubInstallationRecord) {
                console.log(`No GithubInstallation found for installation ${payload.installationId}`);
                return;
            }

            // fetch all repositories associated with the installation
            const repositories = await Repo.find(
                { installationId: githubInstallationRecord._id }, { _id: 1 }
            ).session(session);
            const repoIds = repositories.map(repo => repo._id);

            // fetch all pull requests associated with the repositories
            const pullRequests = await PullRequest.find(
                { repoId: { $in: repoIds } },
                { _id: 1 }
            ).session(session);
            const pullRequestIds = pullRequests.map(pr => pr._id);

            // delete all associated records from less dependent collections first, then delete the main records
            await Conflict.deleteMany({
                $or: [
                    { prAId: { $in: pullRequestIds } },
                    { prBId: { $in: pullRequestIds } },
                ]
            }).session(session);
            await RepoConfig.deleteMany({ repoId: { $in: repoIds } }).session(session);
            await ActivityLog.deleteMany({ installationId: githubInstallationRecord._id }).session(session);
            await PullRequestFile.deleteMany({ pullRequestId: { $in: pullRequestIds } }).session(session);
            await PullRequest.deleteMany({ _id: { $in: pullRequestIds } }).session(session);
            await Repo.deleteMany({ _id: { $in: repoIds } }).session(session);
            await GithubInstallation.deleteOne({ _id: githubInstallationRecord._id }).session(session);
        });

        console.log(`Successfully deleted installation ${payload.installationId} and all associated records.`);
    } catch (error) {
        console.log("Error [installation.deleted]:", error);
        try {
            const githubInstallation = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            );
            if (githubInstallation) {
                await logActivity({
                    installationId: githubInstallation._id,
                    event: QUEUE_EVENTS.INSTALLATION.DELETED,
                    status: 'error',
                    message: 'Failed to delete GitHub App installation',
                }, session);
            }
        } catch (logError) {
            console.log("Error logging activity for installation.deleted:", logError);
        }
        throw error;
    } finally {
        await session.endSession();
    }
}
