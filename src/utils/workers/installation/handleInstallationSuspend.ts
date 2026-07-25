import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { InstallationSuspend } from "../../../types/queue-payloads";

export async function handleInstallationSuspend(payload: InstallationSuspend) {
    try {
        const installationId = payload.installationId;
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId: installationId,
                deletedAt: { $eq: null },
                suspendedAt: { $eq: null },
            },
            { $set: { suspendedAt: new Date() } },
            { projection: { _id: 1 } },
        );
        if (githubInstallation) {
            console.log(`Marked installation ${installationId} as suspended`);
        } else {
            console.log(`No GithubInstallation found or deleted one or already suspended one for installation ${installationId}`);
        }
    } catch (error) {
        console.log("Error [installation.suspend]:", error)
    }
}
