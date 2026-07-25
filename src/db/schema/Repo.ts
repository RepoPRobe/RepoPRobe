import { Schema, model, Types } from "mongoose";

export interface RepoType {
    _id: Types.ObjectId;
    installationId: Types.ObjectId;
    installedOn?: Date | null;
    githubId: string;
    githubName: string;
    githubFullName: string;
    deletedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const repoSchema = new Schema<RepoType>({
    installationId: { type: Schema.Types.ObjectId, ref: 'GithubInstallation', required: true },
    installedOn: { type: Date, required: false, default: null },
    githubId: { type: String, required: true },
    githubName: { type: String, required: true },
    githubFullName: { type: String, required: true }, // includes user name also: username/repo-name
    deletedAt: { type: Date, required: false, default: null },
}, { timestamps: true });

repoSchema.index({ installationId: 1, githubId: 1 }, { unique: true });

export const Repo = model<RepoType>("Repo", repoSchema);
