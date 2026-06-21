import { model, Schema } from "mongoose"

const repoConfigSchema = new Schema({
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true },
    autoTrack: { type: Boolean, default: true },
    ignoreDraftPRs: { type: Boolean, default: true },
    excludeLabels: { type: [String], default: [] },
    excludeFilePatterns: { type: [String], default: [] },
    sameBaseBranchOnly: { type: Boolean, default: true },
    inactivityThreshold: {
        value: { type: Number, default: 14 },
        unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'days' }
    },
}, { timestamps: true })

export const RepoConfig = model("RepoConfig", repoConfigSchema);
