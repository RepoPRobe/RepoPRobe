import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { Repo } from "../../../db/schema/Repo";
import { InstallationRepositoriesRemoved } from "../../../types/queue-payloads";

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
        await Repo.updateMany(
            {
                installationId: installationId._id,
                githubId: { $in: reposToDelete.map(repo => repo.githubId) }
            },
            { $set: { deletedAt: new Date() } },
        );
        console.log(`Marked ${reposToDelete.length} repos as deleted for installation ${payload.installationId}`);
    } catch (error) {
        console.log("Error [installation_repositories.removed]:", error);
    }
}
