import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { Repo } from "../../../db/schema/Repo";
import { InstallationDeleted } from "../../../types/queue-payloads";



export async function handleInstallationDeleted(payload: InstallationDeleted) {
    try {
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId: payload.installationId,
                deletedAt: { $eq: null },
            },
            { $set: { deletedAt: new Date() } },
            { projection: { _id: 1 } },
        );

        if (!githubInstallation) {
            console.log(`No GithubInstallation found or already deleted found for installation ${payload.installationId}`);
            return;
        }

        await Repo.updateMany(
            { installationId: githubInstallation?._id },
            { $set: { deletedAt: new Date() } }
        );

        console.log(`Marked repos as deleted for installation ${payload.installationId}`);
    } catch (error) {
        console.log("Error [installation.deleted]:", error);
    }
}
