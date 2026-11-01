import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { Repo } from "../../../db/schema/Repo";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { InstallationRepositoriesRemoved } from "../../../types/queue-payloads";
import { logActivity } from "../../common/activityLog";

export async function handleInstallationRepositoriesRemoved(payload: InstallationRepositoriesRemoved) {
    try {
        const installationId = await GithubInstallation.findOne(
            { installationId: payload.installationId },
            { _id: 1 },
        )
        if (!installationId) {
            console.log(`No GithubInstallation found for installation ${payload.installationId}`);
            return;
        }
        const reposToDelete = payload.repositoriesRemoved.map(repository => ({
            installationId: installationId._id,
            githubId: repository.id,
        }));
        const repoDocs = await Repo.find(
            {
                installationId: installationId._id,
                githubId: { $in: reposToDelete.map(repo => repo.githubId) },
            },
            { _id: 1, githubFullName: 1 },
        );
        await Repo.updateMany(
            {
                installationId: installationId._id,
                githubId: { $in: reposToDelete.map(repo => repo.githubId) }
            },
            { $set: { deletedAt: new Date() } },
        );
        const parentLogId = await logActivity({
            installationId: installationId._id,
            event: QUEUE_EVENTS.INSTALLATION_REPOSITORIES.REMOVED,
            status: 'success',
            message: 'Repositories removed from installation',
            metadata: { removedCount: repoDocs.length },
        });
        await Promise.all(repoDocs.map(repo => logActivity({
            installationId: installationId._id,
            repoId: repo._id,
            parentLogId: parentLogId,
            event: QUEUE_EVENTS.REPO.REMOVED,
            status: 'success',
            message: `Repository ${repo.githubFullName} removed from installation`,
        })));
        console.log(`Marked ${reposToDelete.length} repos as deleted for installation ${payload.installationId}`);
    } catch (error) {
        console.log("Error [installation_repositories.removed]:", error);
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
    }
}
