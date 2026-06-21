import { Schema, model } from "mongoose";

const repoSchema = new Schema({
    installationId: { type: Schema.Types.ObjectId, ref: 'GithubInstallation', required: true },
    installedOn: { type: Date, required: false, default: null },
    githubId: { type: String, required: true },
    githubName: { type: String, required: true },
    githubFullName: { type: String, required: true }, // includes user name also: username/repo-name
    deletedAt: { type: Date, required: false, default: null },
}, { timestamps: true });

repoSchema.index({ installationId: 1, githubId: 1 }, { unique: true });

export const Repo = model("Repo", repoSchema);
