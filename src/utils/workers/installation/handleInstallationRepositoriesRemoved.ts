import mongoose from "mongoose";
import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { Repo } from "../../../db/schema/Repo.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { InstallationRepositoriesRemoved } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { Conflict } from "../../../db/schema/Conflict.js";
import { RepoConfig } from "../../../db/schema/RepoConfig.js";
import { ActivityLog } from "../../../db/schema/ActivityLogs.js";
import { PullRequestFile } from "../../../db/schema/PullRequestFile.js";

export async function handleInstallationRepositoriesRemoved(payload: InstallationRepositoriesRemoved) {
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            const installationId = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            ).session(session);
            if (!installationId) {
                console.log(`No GithubInstallation found for installation ${payload.installationId}`);
                return;
            }

            // repositories selected for removal from the installation
            const reposToDeleteIds = payload.repositoriesRemoved.map(repo => repo.id);

            // fetch the repositories to be deleted from the database
            const repositories = await Repo.find(
                {
                    installationId: installationId._id,
                    githubId: { $in: reposToDeleteIds },
                },
                { _id: 1, githubFullName: 1 },
            ).session(session);
            const repoIds = repositories.map(repo => repo._id);

            // fetch all pull requests associated with the repositories
            const pullRequests = await PullRequest.find(
                { repoId: { $in: repoIds } },
                { _id: 1 },
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
            await ActivityLog.deleteMany({ repoId: { $in: repoIds } }).session(session);
            await PullRequestFile.deleteMany({ pullRequestId: { $in: pullRequestIds } }).session(session);
            await PullRequest.deleteMany({ _id: { $in: pullRequestIds } }).session(session);
            await Repo.deleteMany({ _id: { $in: repoIds } }).session(session);

            // Log the removal of repositories and their associated pull requests
            const parentLogId = await logActivity({
                installationId: installationId._id,
                event: QUEUE_EVENTS.INSTALLATION_REPOSITORIES.REMOVED,
                status: 'success',
                message: 'Repositories removed from installation',
                metadata: { removedCount: repositories.length },
            }, session);
            for (const repo of repositories) {
                await logActivity({
                    installationId: installationId._id,
                    repoId: repo._id,
                    parentLogId,
                    event: QUEUE_EVENTS.REPO.REMOVED,
                    status: 'success',
                    message: `Repository ${repo.githubFullName} removed from installation`,
                }, session);
            }
            console.log(`Marked ${reposToDeleteIds.length} repos as deleted for installation ${payload.installationId}`);
        });
    } catch (error) {
        console.log("Error [installation_repositories.removed]:", error);
        try {
            const installationDoc = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            );
            if (installationDoc) {
                await logActivity({
                    installationId: installationDoc._id,
                    event: QUEUE_EVENTS.INSTALLATION_REPOSITORIES.REMOVED,
                    status: 'error',
                    message: 'Failed to remove repositories from installation',
                });
            }
        } catch (logError) {
            console.log("Error while logging activity for installation_repositories.removed:", logError);
        }
    } finally {
        await session.endSession();
    }
}
