import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { InstallationUnsuspend } from "../../../types/queue-payloads";

export async function handleInstallationUnsuspend(payload: InstallationUnsuspend) {
    try {
        const installationId = payload.installationId;
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId,
                deletedAt: { $eq: null },
                suspendedAt: { $ne: null },
            },
            { $set: { suspendedAt: null } },
            { projection: { _id: 1 } },
        );
        if (githubInstallation) {
            console.log(`Marked installation ${installationId} as unsuspended`);
        } else {
            console.log(`No GithubInstallation found for installation ${installationId}`);
        }
    } catch (error) {
        console.log("Error [installation.unsuspend]:", error)
    }
}
